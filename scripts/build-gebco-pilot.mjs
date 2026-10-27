#!/usr/bin/env node
/** Build local indexed GEBCO display contour shards from a regional source GeoTIFF.
 * Uses rasterio/GDAL, contourpy and pyogrio from the active Python environment.
 * Contours are interpolated model data and are not for navigation.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(process.argv[2] ?? join(root, 'data-raw', 'gebco_2026_n51.0_s49.8_w-2.0_e-0.8_geotiff.tif'));
const output = resolve(process.argv[3] ?? join(root, 'public', 'contours'));
const staging = `${output}.building`;
const python = process.env.PYTHON ?? 'python';
if (!existsSync(source)) throw new Error(`GEBCO input not found: ${source}`);
if (existsSync(output)) throw new Error(`Output already exists; refusing to overwrite: ${output}`);
if (existsSync(staging)) throw new Error(`Staging directory already exists; inspect it before retrying: ${staging}`);
const probe = spawnSync(python, ['-c', "import json,rasterio,sys; d=rasterio.open(sys.argv[1]); print(json.dumps({'bounds':[d.bounds.bottom,d.bounds.left,d.bounds.top,d.bounds.right],'width':d.width,'height':d.height,'resolution':max(abs(d.transform.a),abs(d.transform.e)),'crs':str(d.crs),'nodata':d.nodata,'dtype':d.dtypes[0]}))", source], { encoding: 'utf8' });
if (probe.status !== 0 || !probe.stdout.trim()) throw new Error(`Could not read GEBCO raster metadata: ${probe.stderr}`);
const sourceDetails = JSON.parse(probe.stdout);
if (sourceDetails.crs !== 'EPSG:4326') throw new Error(`Expected geographic EPSG:4326 raster, got ${sourceDetails.crs}`);
mkdirSync(staging, { recursive: false });
const worker = String.raw`
import json, math, sys
from datetime import datetime, timezone
from pathlib import Path
import contourpy, geopandas as gpd, numpy as np, pyogrio, rasterio
from shapely.geometry import LineString

source=Path(sys.argv[1]); output=Path(sys.argv[2]); bounds=tuple(map(float,sys.argv[3:7]))
# Input bounds are south, west, north, east; rasterio windows are col,row.
with rasterio.open(source) as ds:
    if ds.crs is None or ds.crs.to_epsg()!=4326: raise ValueError('Expected an EPSG:4326 GeoTIFF')
    south,west,north,east=bounds
    win=rasterio.windows.from_bounds(west,south,east,north,ds.transform).round_offsets().round_lengths()
    data=ds.read(1,window=win,masked=True).astype('float64')
    transform=ds.window_transform(win)
    height,width=data.shape
    x=transform.c+(np.arange(width)+0.5)*transform.a
    y=transform.f+(np.arange(height)+0.5)*transform.e
    z=np.ma.array(data,mask=np.ma.getmaskarray(data)|(data>=0))
    if not np.any(z.compressed()<0): raise ValueError('Source window has no underwater elevations')
    extent=[float(ds.bounds.bottom),float(ds.bounds.left),float(ds.bounds.top),float(ds.bounds.right)]
    resolution=max(abs(transform.a),abs(transform.e))
    levels=[]
    for depth in list(range(2,5,2))+[5]+list(range(10,25,5))+[25,50,75,100,150,200,300,400,500,750,1000,1500,2000,3000,4000,5000,6000,8000,10000,12000]:
        if 0<depth<=max(12000,-int(z.min())): levels.append(-float(depth))
    cg=contourpy.contour_generator(x=x,y=y,z=z,name='serial',corner_mask=False)
    groups={}
    for level in levels:
        for coords in cg.lines(level):
            if len(coords)<2: continue
            geom=LineString(coords)
            if geom.is_empty or not geom.is_valid: continue
            groups.setdefault((math.floor(geom.centroid.x/10)*10,math.floor(geom.centroid.y/10)*10),[]).append((level,geom))

manifest={'schema':1,'generatedAt':datetime.now(timezone.utc).isoformat(),'bounds':extent,'coverageBounds':[],'shardDegrees':10,'contourLevelsMetres':sorted(abs(x) for x in levels),'sources':[{'id':'gebco-2026-pilot','name':'GEBCO_2026','attribution':'GEBCO Bathymetric Compilation Group 2026 (2026). GEBCO_2026 Grid, 15 arc-second intervals. doi:10.5285/4f68d5c7-45eb-f999-e063-7086abc036fa','datum':'Generally assumed mean sea level; source datum may differ in shallow regions'}],'shards':[],'notice':'Interpolated GEBCO grid contours are model display aids, not chart-grade and not for navigation or safety at sea. Source coverage and vertical datum vary; do not use for navigation.','processing':{'source':'GEBCO_2026 source-grid sample points','contourEngine':'contourpy marching squares','sourceResampling':'none','windowResolutionDegrees':resolution}}
for (gx,gy),features in sorted(groups.items()):
    path=f'gebco-2026/gebco-2026_{gx+180}_{gy+90}.fgb'
    target=output/path
    target.parent.mkdir(parents=True,exist_ok=True)
    frame=gpd.GeoDataFrame({'elev_m':np.asarray([f[0] for f in features],dtype='int16')},geometry=[f[1] for f in features],crs='EPSG:4326')
    pyogrio.write_dataframe(frame,str(target),driver='FlatGeobuf',layer='contours',layer_options={'SPATIAL_INDEX':'YES'})
    info=pyogrio.read_info(str(target))
    if info['features']!=len(features) or info['geometry_type'] not in ('LineString','MultiLineString'):
        raise RuntimeError(f'Invalid FlatGeobuf output: {target}')
    b=info['total_bounds']
    shard_bounds=[max(south,gy),max(west,gx),min(north,gy+10),min(east,gx+10)]
    clipped_bounds=[max(south,shard_bounds[0]),max(west,shard_bounds[1]),min(north,shard_bounds[2]),min(east,shard_bounds[3])]
    manifest['shards'].append({'path':path,'bounds':clipped_bounds,'count':len(features),'totalBytes':target.stat().st_size,'source':'GEBCO_2026','sourceId':'gebco-2026-pilot','attribution':manifest['sources'][0]['attribution'],'datum':manifest['sources'][0]['datum'],'resolutionDegrees':resolution,'contourProperty':'elev_m'})
    manifest['coverageBounds'].append(clipped_bounds)
if not manifest['shards']: raise RuntimeError('No contour geometries generated from the requested GEBCO bounds')
(output/'manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf8')
print(json.dumps({'shards':len(manifest['shards']),'features':sum(s['count'] for s in manifest['shards']),'bytes':sum(s['totalBytes'] for s in manifest['shards']),'coverage':manifest['coverageBounds']},indent=2))
`;
const result = spawnSync(python, ['-c', worker, source, staging, ...sourceDetails.bounds.map(String)], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'inherit', 'inherit'] });
if (result.status !== 0) throw new Error(`Contour build failed (exit ${result.status ?? 'unknown'})`);
const manifestPath = join(staging, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
if (!manifest.shards.length || !manifest.shards.every((shard) => existsSync(join(staging, shard.path)) && statSync(join(staging, shard.path)).size === shard.totalBytes)) throw new Error('Contour archive validation failed');
writeFileSync(join(staging, 'BUILD-INFO.txt'), `Source: ${source}\nSource bounds: ${sourceDetails.bounds.join(', ')}\nShards: ${manifest.shards.length}\nFeatures: ${manifest.shards.reduce((sum, shard) => sum + shard.count, 0)}\n`);
renameSync(staging, output);
console.log(`Validated archive: ${output}`);
