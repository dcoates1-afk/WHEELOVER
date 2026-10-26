#!/usr/bin/env python3
"""Build spatially indexed display contours from GEBCO and optional EMODnet grids.

These are visualization contours only, not chart-grade and never suitable for
navigation or safety at sea. Start with --bounds and a small regional raster.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

try:
    from osgeo import gdal, ogr, osr
except ImportError as exc:
    raise SystemExit("GDAL Python bindings are required; activate Miniforge env `osm-tools`.") from exc

GEBCO_ATTRIBUTION = (
    "GEBCO Bathymetric Compilation Group 2026 (2026). The GEBCO_2026 Grid - "
    "a continuous terrain model for oceans and land at 15 arc-second intervals. "
    "doi:10.5285/4f68d5c7-45eb-f999-e063-7086abc036fa"
)
EMODNET_ATTRIBUTION = (
    "EMODnet Bathymetry Consortium, EMODnet Digital Bathymetry (DTM 2024), "
    "doi:10.12770/cf51df64-56f9-4a99-b1aa-36b8d7b743a1"
)
PARTITION_DEGREES = 10


def find_gdal_program(name: str) -> str:
    """Find a GDAL CLI executable, including Miniforge's Python-script tools."""
    executable = shutil.which(name) or shutil.which(f"{name}.exe")
    if executable:
        return executable
    for candidate in (
        Path(sys.prefix) / "Scripts" / f"{name}.exe",
        Path(sys.prefix) / "Library" / "bin" / f"{name}.exe",
        Path(sys.prefix) / "bin" / name,
    ):
        if candidate.is_file():
            return str(candidate)
    raise FileNotFoundError(
        f"{name} was not found on PATH or in the active Python environment. "
        "Activate the Miniforge GDAL environment before running this builder."
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--gebco", type=Path, action="append", default=[], help="GEBCO elevation GeoTIFF(s), not the accompanying TID raster")
    parser.add_argument("--emodnet", type=Path, action="append", default=[], help="EMODnet DTM GeoTIFF tile(s); standard product datum is LAT")
    parser.add_argument("--output", type=Path, required=True, help="New output directory; existing archives are never overwritten")
    parser.add_argument("--work-dir", type=Path, help="Optional scratch directory on a drive with ample free space")
    parser.add_argument("--bounds", type=float, nargs=4, metavar=("WEST", "SOUTH", "EAST", "NORTH"), help="Optional pilot bounds; omit for complete source extents")
    parser.add_argument("--intervals", default="2,5,10,25,50,100,200,500,1000,2000,4000,6000", help="Band boundaries; 2 m intervals from 2-5 m, 5 m intervals from 5-10 m, then progressively coarser")
    parser.add_argument("--min-depth", type=float, default=2, help="Shallowest contour depth in metres")
    parser.add_argument("--max-depth", type=float, default=12000, help="Deepest contour depth in metres")
    return parser.parse_args()


def validate_bounds(values: list[float] | tuple[float, float, float, float]) -> tuple[float, float, float, float]:
    west, south, east, north = values
    if not (-180 <= west < east <= 180 and -90 <= south < north <= 90):
        raise ValueError("Bounds must satisfy -180 <= west < east <= 180 and -90 <= south < north <= 90")
    return west, south, east, north


def make_levels(raw: str, minimum: float, maximum: float) -> list[float]:
    boundaries = sorted({float(item.strip()) for item in raw.split(",") if item.strip()})
    if len(boundaries) < 2 or any(not math.isfinite(item) or item <= 0 for item in boundaries):
        raise ValueError("Provide at least two positive finite band boundaries, e.g. 2,5,10,25,50,100")
    if not (0 < minimum < maximum <= 12000):
        raise ValueError("Depth range must be positive and max depth may not exceed 12000 m")
    if minimum < boundaries[0]:
        boundaries.insert(0, minimum)
    # Use a requested 2 m interval throughout the shoals below 5 m and 5 m
    # intervals for the next band. Deeper bands retain the original progressively
    # coarser interval rule.
    depths: set[int] = set()
    for index, start in enumerate(boundaries):
        if index == 0:
            spacing = 2
        elif index < 3:
            spacing = 5
        else:
            spacing = max(1, int(round(boundaries[index - 1])))
        end = min(maximum, boundaries[index + 1] if index + 1 < len(boundaries) else maximum)
        start = max(minimum, start)
        if start >= end:
            continue
        for depth in range(math.ceil(start / spacing) * spacing, int(end) + 1, spacing):
            depths.add(depth)
    if len(depths) > 2500:
        raise ValueError("Intervals create over 2500 contour levels; use wider bands")
    return sorted(-float(depth) for depth in depths)


def elevation_dataset(path: Path):
    dataset = gdal.Open(str(path), gdal.GA_ReadOnly)
    if dataset is None:
        raise ValueError(f"Cannot open raster {path}")
    subdatasets = dataset.GetSubDatasets()
    if subdatasets:
        candidates = [(name, description) for name, description in subdatasets
                      if "tid" not in name.lower() and "type identifier" not in description.lower()]
        preferred = [(name, description) for name, description in candidates
                     if any(token in f"{name} {description}".lower() for token in ("elev", "gebco", "z"))]
        if not candidates:
            raise ValueError(f"No elevation subdataset found in {path}; this may be the TID raster")
        dataset = gdal.Open((preferred or candidates)[0][0], gdal.GA_ReadOnly)
        if dataset is None:
            raise ValueError(f"Cannot open elevation subdataset in {path}")
    if dataset.RasterCount < 1:
        raise ValueError(f"No raster band in {path}")
    projection_text = dataset.GetProjection()
    projection = osr.SpatialReference(wkt=projection_text) if projection_text else None
    if not projection or not projection.IsGeographic():
        raise ValueError(f"Expected a geographic longitude/latitude raster in {path}")
    transform = dataset.GetGeoTransform()
    if abs(transform[2]) > 1e-12 or abs(transform[4]) > 1e-12:
        raise ValueError(f"Rotated source grids are not supported: {path}")
    x1 = transform[0] + transform[1] * dataset.RasterXSize
    y1 = transform[3] + transform[5] * dataset.RasterYSize
    extent = (min(transform[0], x1), min(transform[3], y1), max(transform[0], x1), max(transform[3], y1))
    resolution = max(abs(transform[1]), abs(transform[5]))
    if resolution <= 0 or extent[0] < -180.01 or extent[2] > 180.01 or extent[1] < -90.01 or extent[3] > 90.01:
        raise ValueError(f"Invalid geographic extent or resolution in {path}: {extent}, {resolution}")
    band = dataset.GetRasterBand(1)
    nodata = band.GetNoDataValue()
    sample = band.ReadAsArray(0, 0, min(256, dataset.RasterXSize), min(256, dataset.RasterYSize))
    if sample is None or sample.size == 0:
        raise ValueError(f"Cannot sample raster values in {path}")
    if nodata is not None:
        sample = sample[sample != nodata]
    if sample.size == 0 or not (sample < 0).any():
        raise ValueError(f"Sampled raster values contain no negative underwater elevations in {path}; check band and units")
    return dataset, extent, resolution, nodata


def partition_bounds(bounds: tuple[float, float, float, float]):
    west, south, east, north = bounds
    grid_x = math.floor((west + 180) / PARTITION_DEGREES) * PARTITION_DEGREES - 180
    while grid_x < east:
        grid_y = math.floor((south + 90) / PARTITION_DEGREES) * PARTITION_DEGREES - 90
        while grid_y < north:
            core = (max(west, grid_x), max(south, grid_y), min(east, grid_x + PARTITION_DEGREES), min(north, grid_y + PARTITION_DEGREES))
            if core[0] < core[2] and core[1] < core[3]:
                yield core, grid_x, grid_y
            grid_y += PARTITION_DEGREES
        grid_x += PARTITION_DEGREES


def run(command: list[str], env: dict[str, str]) -> None:
    print("[contours]", subprocess.list2cmdline(command), flush=True)
    subprocess.run(command, check=True, env=env)


def create_contours(source_path: Path, source_id: str, source_name: str, attribution: str, datum: str,
                    stage: Path, work: Path, bounds: tuple[float, float, float, float], resolution: float,
                    nodata: float | None, levels: list[float], env: dict[str, str]) -> list[dict]:
    shards = []
    safe_id = source_id.replace("/", "_").replace("\\", "_").replace(" ", "_")
    source, _, _, _ = elevation_dataset(source_path)
    transform = source.GetGeoTransform()
    gdal_contour = find_gdal_program("gdal_contour")
    ogr2ogr = find_gdal_program("ogr2ogr")
    source_res_x, source_res_y = abs(transform[1]), abs(transform[5])
    for core, grid_x, grid_y in partition_bounds(bounds):
        west, south, east, north = core
        suffix = f"{grid_x + 180}_{grid_y + 90}"
        relative_path = f"{source_id}/{safe_id}_{suffix}.fgb"
        output = stage / relative_path
        output.parent.mkdir(parents=True, exist_ok=True)
        crop = work / f"{safe_id}_{suffix}.tif"
        gpkg = work / f"{safe_id}_{suffix}.gpkg"
        halo = max(resolution, 1e-6)
        padded = (max(bounds[0], west - halo), max(bounds[1], south - halo), min(bounds[2], east + halo), min(bounds[3], north + halo))
        # Translate crops on the exact source pixel grid: no interpolating or
        # upsampling to create a false impression of extra sounding detail.
        crop_options = gdal.TranslateOptions(
            format="GTiff",
            projWin=[padded[0], padded[3], padded[2], padded[1]],
            creationOptions=["TILED=YES", "COMPRESS=DEFLATE", "PREDICTOR=2"],
        )
        cropped = gdal.Translate(str(crop), source, options=crop_options)
        if cropped is None:
            raise RuntimeError(f"Could not crop {source_path} to {padded}")
        cropped_transform = cropped.GetGeoTransform()
        if abs(cropped_transform[1]) > source_res_x * 1.0001 or abs(cropped_transform[5]) > source_res_y * 1.0001:
            raise RuntimeError(f"Crop resolution is coarser than the source grid: {crop}")
        cropped_nodata = cropped.GetRasterBand(1).GetNoDataValue()
        if cropped_nodata is None and nodata is not None:
            cropped.GetRasterBand(1).SetNoDataValue(nodata)
            cropped_nodata = nodata
        cropped = None
        command = [gdal_contour, "-f", "GPKG", "-a", "elev_m", "-nln", "contours"]
        if cropped_nodata is not None:
            command.extend(["-snodata", str(cropped_nodata)])
        command.extend(["-fl", *(str(level) for level in levels), str(crop), str(gpkg)])
        run(command, env)
        result = subprocess.run(
            [ogr2ogr, "-f", "FlatGeobuf", str(output), str(gpkg), "contours", "-clipsrc",
             str(west), str(south), str(east), str(north), "-t_srs", "EPSG:4326", "-nlt", "PROMOTE_TO_MULTI",
             "-lco", "SPATIAL_INDEX=YES", "-nln", "contours"],
            env=env, capture_output=True, text=True,
        )
        if result.returncode != 0:
            raise RuntimeError(f"ogr2ogr FlatGeobuf export failed ({result.returncode}): {result.stderr.strip()}")
        vector = ogr.Open(str(output), 0)
        if vector is None or vector.GetLayerCount() < 1:
            raise RuntimeError(f"FlatGeobuf output is unreadable: {output}")
        layer = vector.GetLayer(0)
        count = layer.GetFeatureCount()
        spatial_ref = layer.GetSpatialRef()
        if spatial_ref is None or not spatial_ref.IsGeographic():
            raise RuntimeError(f"FlatGeobuf output is not geographic: {output}")
        total_bytes = output.stat().st_size
        vector = None
        if not count:
            output.unlink(missing_ok=True)
            continue
        shards.append({"path": relative_path, "bounds": [south, west, north, east], "count": count,
                       "totalBytes": total_bytes, "source": source_name, "sourceId": source_id,
                       "attribution": attribution, "datum": datum, "resolutionDegrees": resolution,
                       "contourProperty": "elev_m"})
        print(f"[contours] {count} indexed contours ({total_bytes:,} bytes): {output}", flush=True)
    source = None
    return shards


def main() -> int:
    args = parse_args()
    levels = make_levels(args.intervals, args.min_depth, args.max_depth)
    inputs = []
    for index, path in enumerate(args.gebco, start=1):
        inputs.append((path, f"gebco-{index}", "GEBCO_2026", GEBCO_ATTRIBUTION,
                       "Generally assumed mean sea level; source datum may differ in shallow regions"))
    for index, path in enumerate(args.emodnet, start=1):
        inputs.append((path, f"emodnet-{index}", "EMODnet DTM 2024", EMODNET_ATTRIBUTION,
                       "Lowest Astronomical Tide (LAT)"))
    if not inputs:
        raise ValueError("Pass one or more --gebco and/or --emodnet raster tiles")
    for path, *_ in inputs:
        if not path.is_file():
            raise FileNotFoundError(f"Source grid not found: {path}")
    requested = validate_bounds(args.bounds) if args.bounds else None
    output = args.output.resolve()
    if output.exists():
        raise FileExistsError(f"Output already exists; use a new path to preserve it: {output}")
    stage = output.with_name(output.name + ".building")
    if stage.exists():
        raise FileExistsError(f"Build staging directory exists; inspect before continuing: {stage}")
    work_root = args.work_dir.resolve() if args.work_dir else None
    if work_root:
        work_root.mkdir(parents=True, exist_ok=True)
        if not work_root.is_dir():
            raise NotADirectoryError(f"Scratch path is not a directory: {work_root}")
    stage.mkdir(parents=True)
    gdal.SetCacheMax(512 * 1024 * 1024)
    command_env = os.environ.copy()
    command_env["GDAL_CACHEMAX"] = "512"
    all_shards: list[dict] = []
    source_metadata: list[dict] = []
    try:
        with tempfile.TemporaryDirectory(prefix="wheel-contours-", dir=str(work_root) if work_root else None) as temporary:
            work = Path(temporary)
            for source_path, source_id, source_name, attribution, datum in inputs:
                raster, extent, resolution, nodata = elevation_dataset(source_path)
                bounds = extent if requested is None else (max(extent[0], requested[0]), max(extent[1], requested[1]),
                                                           min(extent[2], requested[2]), min(extent[3], requested[3]))
                if bounds[0] >= bounds[2] or bounds[1] >= bounds[3]:
                    print(f"[contours] skip {source_name} {source_path.name}: no overlap", flush=True)
                    raster = None
                    continue
                print(f"[contours] {source_name} {source_path.name}: {raster.RasterXSize}x{raster.RasterYSize}, "
                      f"~{resolution * 60:.4f} arc-min, selected={bounds}", flush=True)
                raster = None
                all_shards.extend(create_contours(source_path, source_id, source_name, attribution, datum,
                                                   stage, work, bounds, resolution, nodata, levels, command_env))
                source_metadata.append({"id": source_id, "name": source_name, "attribution": attribution, "datum": datum})
        if not all_shards:
            raise RuntimeError("No contour features generated; check raster band, depth signs and bounds")
        coverage_bounds = []
        for shard in all_shards:
            candidate = tuple(shard["bounds"])
            if candidate not in coverage_bounds:
                coverage_bounds.append(candidate)
        manifest = {
            "schema": 1,
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "bounds": [min(s["bounds"][0] for s in all_shards), min(s["bounds"][1] for s in all_shards),
                       max(s["bounds"][2] for s in all_shards), max(s["bounds"][3] for s in all_shards)],
            "coverageBounds": [list(bounds) for bounds in coverage_bounds],
            "shardDegrees": PARTITION_DEGREES,
            "contourLevelsMetres": sorted({abs(level) for level in levels}),
            "sources": source_metadata,
            "shards": all_shards,
            "notice": "Interpolated grid contours only; not chart-grade or for navigation/safety at sea. Nominal GEBCO spacing does not indicate uniform measurement detail. Source coverage and vertical datum vary; do not use for navigation.",
            "processing": {"partitionDegrees": PARTITION_DEGREES, "sourceResampling": "source-grid-aligned crop; no resampling"},
        }
        (stage / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        output.parent.mkdir(parents=True, exist_ok=True)
        stage.rename(output)
    except Exception:
        print(f"[contours] incomplete staging preserved at {stage}; no existing archive was overwritten", file=sys.stderr)
        raise
    total_bytes = sum(shard["totalBytes"] for shard in all_shards)
    print(f"[contours] complete: {len(all_shards)} shards, {sum(shard['count'] for shard in all_shards)} features, "
          f"{total_bytes:,} bytes in {output}", flush=True)
    return 0


if __name__ == "__main__":
    gdal.UseExceptions()
    ogr.UseExceptions()
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(1)
