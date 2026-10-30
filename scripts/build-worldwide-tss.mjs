#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const archive = resolve(root, 'public/marine-db');
const manifest = JSON.parse(readFileSync(join(archive, 'manifest.json'), 'utf8'));
const temp = mkdtempSync(join(tmpdir(), 'wheel-over-tss-'));
const output = join(temp, 'worldwide-tss.geojsonseq');
const records = [];
const recordByGeometry = new Map();
const sourceIds = new Map();
const OSM = 'https://www.openstreetmap.org';
const SHOM = 'https://services.data.shom.fr/INSPIRE/wfs';
const CANADA = 'https://egisp.dfo-mpo.gc.ca/arcgis/rest/services/open_data_donnees_ouvertes/vessel_traffic_routes_en/MapServer';
const WELSH_WFS = 'https://datamap.gov.wales/geoserver/wfs';

function geometrySignature(geometry) {
  const paths = [];
  const collect = value => {
    if (!value) return;
    if (value.type === 'LineString') paths.push(['line', value.coordinates]);
    else if (value.type === 'MultiLineString') paths.push(...value.coordinates.map(path => ['line', path]));
    else if (value.type === 'Polygon') paths.push(...value.coordinates.map(path => ['ring', path]));
    else if (value.type === 'MultiPolygon') paths.push(...value.coordinates.flatMap(polygon => polygon.map(path => ['ring', path])));
    else if (value.type === 'GeometryCollection') value.geometries.forEach(collect);
  };
  const canonicalPath = (path, ring) => {
    let points = path.map(([lon, lat]) => `${Number(lon).toFixed(5)},${Number(lat).toFixed(5)}`);
    if (ring && points.length > 1 && points[0] === points.at(-1)) points = points.slice(0, -1);
    if (!ring) {
      const forward = points.join(';');
      const reverse = points.slice().reverse().join(';');
      return forward < reverse ? forward : reverse;
    }
    const rotations = sequence => {
      const smallest = sequence.reduce((min, point, index) => point < sequence[min] ? index : min, 0);
      return [...sequence.slice(smallest), ...sequence.slice(0, smallest)].join(';');
    };
    const forward = rotations(points);
    const reverse = rotations(points.slice().reverse());
    return forward < reverse ? forward : reverse;
  };
  collect(geometry);
  return paths.map(([kind, path]) => `${kind}:${canonicalPath(path, kind === 'ring')}`).sort().join('|');
}

function add(properties, geometry) {
  if (!geometry || !['LineString', 'MultiLineString', 'Polygon', 'MultiPolygon', 'GeometryCollection'].includes(geometry.type)) return;
  if (!properties.marine_source_id) throw new Error('TSS source feature is missing a stable source ID');
  const sourceId = String(properties.marine_source_id);
  const source = sourceId.startsWith('tss:') ? 'osm' : sourceId.split(':', 1)[0];
  const sourceSet = sourceIds.get(source) ?? new Set();
  sourceSet.add(String(properties.marine_source_id));
  sourceIds.set(source, sourceSet);
  const signature = geometrySignature(geometry);
  const existing = recordByGeometry.get(signature);
  if (existing && existing.properties['seamark:type'] === properties['seamark:type']) {
    const sourceNames = new Set([...(existing.properties.source_name ?? '').split('; '), properties.source_name].filter(Boolean));
    existing.properties.source_name = [...sourceNames].join('; ');
    for (const [key, value] of Object.entries(properties)) {
      if (existing.properties[key] == null || existing.properties[key] === '') existing.properties[key] = value;
    }
    return;
  }
  const record = { type: 'Feature', id: String(properties.marine_source_id), properties, geometry };
  records.push(record);
  recordByGeometry.set(signature, record);
}

async function readJson(url, label) {
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`${label} download failed (HTTP ${response.status})`);
  const payload = await response.json();
  if (!payload || !Array.isArray(payload.features)) throw new Error(`${label} response is not a GeoJSON FeatureCollection`);
  return payload;
}

async function readWfsPages(baseUrl, parameters, label, pageSize = 1000) {
  const features = [];
  let startIndex = 0;
  for (let page = 0; page < 1000; page += 1) {
    const url = new URL(baseUrl);
    for (const [key, value] of Object.entries({ ...parameters, count: String(pageSize), startIndex: String(startIndex) })) {
      url.searchParams.set(key, value);
    }
    const collection = await readJson(url, `${label} page ${page + 1}`);
    const pageFeatures = collection.features;
    if (pageFeatures.length === 0) break;
    features.push(...pageFeatures);
    startIndex += pageFeatures.length;
    const matched = Number(collection.numberMatched);
    if (Number.isFinite(matched) && startIndex >= matched) break;
    if (pageFeatures.length < pageSize) break;
    if (page === 999) throw new Error(`${label} exceeded the 1,000-page safety limit`);
  }
  return features;
}

try {
  // Keep every current OSM TSS feature and its disconnected components intact.
  for (const shard of manifest.layers.tss.shards) {
    const payload = JSON.parse(readFileSync(join(archive, shard.path), 'utf8'));
    for (const feature of payload.features) {
      const geometries = [];
      if (feature.paths?.length) geometries.push({ type: 'MultiLineString', coordinates: feature.paths.map(path => path.map(([lat, lon]) => [lon, lat])) });
      else if (feature.path?.length >= 2 && !feature.polygons?.length) geometries.push({ type: 'LineString', coordinates: feature.path.map(([lat, lon]) => [lon, lat]) });
      if (feature.polygons?.length) geometries.push({ type: 'MultiPolygon', coordinates: feature.polygons.map(polygon => polygon.map(ring => ring.map(([lat, lon]) => [lon, lat]))) });
      if (!geometries.length) continue;
      const geometry = geometries.length === 1 ? geometries[0] : { type: 'GeometryCollection', geometries };
      const osmMatch = feature.id.match(/(?:^|:)([nwr])(\d+)$/);
      const sourceUrl = feature.sourceUrl ?? (osmMatch ? `${OSM}/${osmMatch[1] === 'r' ? 'relation' : osmMatch[1] === 'w' ? 'way' : 'node'}/${osmMatch[2]}` : OSM);
      add({ 'seamark:type': feature.type, name: feature.name, marine_source_id: feature.id, source_name: 'OpenStreetMap contributors (ODbL)', source_url: sourceUrl, ...(feature.details ?? {}) }, geometry);
    }
  }

  // Shom INSPIRE: only actual TSS feature types, not precautionary/deep-water routes.
  const shomLayers = [
    ['tsslpt', 'separation_lane'], ['tssbnd', 'separation_boundary'],
    ['tselne', 'separation_line'], ['tsezne', 'separation_zone'],
  ];
  for (const [layer, type] of shomLayers) {
    try {
      const features = await readWfsPages(SHOM, {
        service: 'WFS', version: '2.0.0', request: 'GetFeature',
        typenames: `DST_BDD_WFS:${layer}`, outputFormat: 'application/json', srsName: 'EPSG:4326',
      }, `Shom ${layer}`);
      for (const [index, feature] of features.entries()) {
        const p = feature.properties ?? {};
        const name = p.nom || `Shom ${layer}`;
        add({ 'seamark:type': type, name, marine_source_id: `shom:${layer}:${p.inspireid ?? feature.id ?? index}`, source_name: 'Shom, 2021. Traffic separation schemes.', source_url: p.referencelink_omi || 'https://services.data.shom.fr/geonetwork/srv/api/records/BDML_DST.xml', ...(p.reference_omi ? { reference: p.reference_omi } : {}), ...(p.validfrom ? { valid_from: p.validfrom } : {}), ...(p.validto ? { valid_to: p.validto } : {}) }, feature.geometry);
      }
    } catch (error) {
      console.warn(`[worldwide-tss] ${error instanceof Error ? error.message : String(error)}; retaining available sources.`);
    }
  }

  // Fisheries and Oceans Canada ENC classes. Exclude general routes, recommended
  // lanes and fairways; MERGE_SRC identifies the specific TSS object class.
  const canadaLayers = [
    [2, { TSELNE_L: 'separation_line', TSSBND_L: 'separation_boundary' }],
    [3, { TSEZNE_A: 'separation_zone', TSSCRS_A: 'separation_zone' }],
    [4, { TSSLPT_A: 'separation_lane' }],
  ];
  for (const [layer, classes] of canadaLayers) {
    try {
    const query = new URL(`${CANADA}/${layer}/query`);
    for (const [key, value] of Object.entries({ where: '1=1', outFields: '*', returnGeometry: 'true', outSR: '4326', f: 'geojson', resultRecordCount: '2000', resultOffset: '0' })) query.searchParams.set(key, value);
    let offset = 0;
    let page = 0;
    while (true) {
      query.searchParams.set('resultOffset', String(offset));
      const collection = await readJson(query, `Canada TSS layer ${layer} page ${page + 1}`);
      for (const [index, feature] of collection.features.entries()) {
        const p = feature.properties ?? {};
        const type = classes[p.MERGE_SRC];
        if (!type) continue;
        const id = p.LNAM || `${p.ENC_NAME ?? 'enc'}:${p.RCID ?? offset + index}:${p.MERGE_SRC}`;
        const name = p.OBJNAM || `${p.ENC_NAME ?? 'Canadian ENC'} ${p.MERGE_SRC}`;
        add({ 'seamark:type': type, name, marine_source_id: `canada:${id}`, source_name: 'Fisheries and Oceans Canada — Vessel Traffic Routes (Open Government Licence — Canada)', source_url: 'https://open.canada.ca/data/en/dataset/6ab2803a-aace-4e60-83ed-44a7e0ccd1d8', source_class: p.MERGE_SRC, ...(p.INFORM?.trim() ? { information: p.INFORM.trim() } : {}), ...(p.SORDAT?.trim() ? { source_date: p.SORDAT.trim() } : {}), ...(p.DATSTA?.trim() ? { valid_from: p.DATSTA.trim() } : {}), ...(p.DATEND?.trim() ? { valid_to: p.DATEND.trim() } : {}) }, feature.geometry);
      }
      offset += collection.features.length;
      page += 1;
      if (collection.features.length === 0) break;
      if (collection.exceededTransferLimit !== true && collection.features.length < 2000) break;
    }
    } catch (error) {
      console.warn(`[worldwide-tss] ${error instanceof Error ? error.message : String(error)}; retaining available sources.`);
    }
  }

  // UKHO's openly licensed DataMapWales layer contains routeing measures for
  // Wales. Retain only traffic-separation lanes and zones, not areas to avoid.
  try {
    const welshFeatures = await readWfsPages(WELSH_WFS, {
      service: 'WFS', version: '2.0.0', request: 'GetFeature',
      typeNames: 'appdata-wg-marine:ukho_ship_routeing_measures_areas',
      outputFormat: 'application/json', srsName: 'EPSG:4326',
    }, 'UKHO / DataMapWales routeing measures', 1000);
    for (const [index, feature] of welshFeatures.entries()) {
      const p = feature.properties ?? {};
      const featureType = String(p.feature_ty ?? '');
      const type = /traffic separation scheme lanes/i.test(featureType)
        ? 'separation_lane'
        : /traffic separation zones/i.test(featureType)
          ? 'separation_zone'
          : null;
      if (!type) continue;
      add({
        'seamark:type': type,
        name: [p.inform, featureType].filter(Boolean).join(' — ') || 'UKHO traffic separation measure',
        marine_source_id: `ukho-wales:${feature.id ?? index}`,
        source_name: 'Contains public sector information, licensed under the Open Government Licence v3.0, from UKHO',
        source_url: 'https://datamap.gov.wales/layers/appdata-wg-marine:ukho_ship_routeing_measures_areas/metadata_detail',
        ...(p.inform ? { information: String(p.inform) } : {}),
        ...(p.orient ? { orientation: String(p.orient) } : {}),
        ...(p.trafic ? { traffic_flow: String(p.trafic) } : {}),
      }, feature.geometry);
    }
  } catch (error) {
    console.warn(`[worldwide-tss] ${error instanceof Error ? error.message : String(error)}; retaining available sources.`);
  }

  // NOAA's hosted layer has no layer-specific licence statement, and Hong
  // Kong's terms do not clearly grant derivative works; both stay excluded
  // until their providers clarify reuse rights.
  if (records.length === 0) throw new Error('No TSS records were available; refusing to replace the current overlay with an empty archive.');

  writeFileSync(output, records.map(record => JSON.stringify(record)).join('\n') + '\n');
  const build = spawnSync(process.execPath, ['scripts/build-marine-db.mjs', output, '--out', archive, '--tss-only'], { cwd: root, stdio: 'inherit' });
  if (build.status !== 0) throw new Error(`Marine TSS archive build failed (${build.status ?? build.signal})`);
  const sourceCounts = Object.fromEntries([...sourceIds].map(([provider, ids]) => [provider, ids.size]));
  console.log(`[worldwide-tss] Built ${records.length} deduplicated geometries from ${JSON.stringify(sourceCounts)} source records. This is an incomplete, illustrative worldwide overlay.`);
} finally {
  rmSync(temp, { recursive: true, force: true });
}
