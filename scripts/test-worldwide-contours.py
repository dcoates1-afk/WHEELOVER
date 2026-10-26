#!/usr/bin/env python3
"""End-to-end builder test from synthetic bathymetry GeoTIFFs."""
from __future__ import annotations

import array
import json
from pathlib import Path
import subprocess
import sys
import tempfile

from osgeo import gdal, ogr, osr

gdal.UseExceptions()
ogr.UseExceptions()

ROOT = Path(__file__).resolve().parents[1]
BUILDER = ROOT / "scripts" / "build-worldwide-contours.py"


def make_raster(path: Path, bounds: tuple[float, float, float, float], resolution: float = 0.01) -> None:
    west, south, east, north = bounds
    columns = round((east - west) / resolution)
    rows = round((north - south) / resolution)
    raster = gdal.GetDriverByName("GTiff").Create(str(path), columns, rows, 1, gdal.GDT_Int16)
    raster.SetGeoTransform((west, resolution, 0.0, north, 0.0, -resolution))
    srs = osr.SpatialReference()
    srs.ImportFromEPSG(4326)
    raster.SetProjection(srs.ExportToWkt())
    band = raster.GetRasterBand(1)
    band.SetNoDataValue(32767)
    for row in range(rows):
        values = [-int(5 + ((((col - columns // 2) ** 2 + (row - rows // 2) ** 2) ** 0.5) * 1.5))
                  for col in range(columns)]
        band.WriteRaster(0, row, columns, 1, array.array("h", values).tobytes())
    raster = None


def run_builder(source: Path, output: Path, bounds: tuple[float, float, float, float], work: Path) -> subprocess.CompletedProcess:
    west, south, east, north = bounds
    return subprocess.run([
        sys.executable, str(BUILDER), "--gebco", str(source), "--output", str(output), "--work-dir", str(work),
        "--bounds", str(west), str(south), str(east), str(north), "--intervals", "2,5,10,25,50,100",
        "--min-depth", "2", "--max-depth", "100",
    ], check=False, cwd=ROOT, capture_output=True, text=True)


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="wheel-contours-test-") as temporary:
        temp = Path(temporary)
        source_path = temp / "synthetic-gebco.tif"
        output_path = temp / "contours"
        work = temp / "scratch"
        make_raster(source_path, (-2.0, 49.8, -0.8, 51.0))
        result = run_builder(source_path, output_path, (-2.0, 49.8, -0.8, 51.0), work)
        if result.returncode:
            raise AssertionError(f"Builder failed:\n{result.stdout}\n{result.stderr}")

        manifest = json.loads((output_path / "manifest.json").read_text(encoding="utf-8"))
        assert manifest["sources"][0]["name"] == "GEBCO_2026"
        assert manifest["shards"]
        assert manifest["coverageBounds"]
        assert "not chart-grade" in manifest["notice"]
        assert manifest["processing"]["sourceResampling"] == "source-grid-aligned crop; no resampling"
        levels = manifest["contourLevelsMetres"]
        assert all(depth in levels for depth in (2.0, 4.0, 5.0, 10.0, 15.0, 20.0))
        assert [depth for depth in levels if depth < 5] == [2.0, 4.0]
        assert [depth for depth in levels if 5 <= depth < 10] == [5.0]
        assert [depth for depth in levels if 10 <= depth < 25] == [10.0, 15.0, 20.0]
        assert 25.0 in levels and 50.0 in levels and 100.0 in levels
        total = 0
        for shard in manifest["shards"]:
            vector = ogr.Open(str(output_path / shard["path"]))
            assert vector is not None, f"unreadable FlatGeobuf: {shard['path']}"
            layer = vector.GetLayer(0)
            assert layer.GetFeatureCount() == shard["count"]
            assert layer.GetSpatialRef().IsGeographic()
            assert layer.GetMetadataItem("SPATIAL_INDEX", "FLATGEOBUF") != "NO"
            elevations = [feature.GetField("elev_m") for feature in layer]
            assert elevations and all(value < 0 for value in elevations)
            total += len(elevations)
            vector = None
        assert total > 0
        assert not list(work.glob("wheel-contours-*")), "temporary work directory should be cleaned after success"

        # Two adjacent global 10-degree cells must produce distinct viewport shards.
        seam_source = temp / "seam-gebco.tif"
        seam_output = temp / "seam-contours"
        make_raster(seam_source, (-1, -1, 1, 1), 0.05)
        seam_result = run_builder(seam_source, seam_output, (-1, -1, 1, 1), work)
        if seam_result.returncode:
            raise AssertionError(f"Seam builder failed:\n{seam_result.stdout}\n{seam_result.stderr}")
        seam_manifest = json.loads((seam_output / "manifest.json").read_text(encoding="utf-8"))
        assert len(seam_manifest["shards"]) == 4, seam_manifest["shards"]
        assert len({shard["path"] for shard in seam_manifest["shards"]}) == 4
        assert len(seam_manifest["coverageBounds"]) == 4

        # Positive elevation input should be refused rather than labelled as depth.
        land = temp / "land.tif"
        make_raster(land, (-2, 49.8, -0.8, 51), 0.01)
        raster = gdal.Open(str(land), gdal.GA_Update)
        band = raster.GetRasterBand(1)
        band.Fill(50)
        raster = None
        invalid = run_builder(land, temp / "invalid-output", (-2, 49.8, -0.8, 51), work)
        assert invalid.returncode != 0 and "negative underwater elevations" in invalid.stderr
        print(f"PASS contour builder: {len(manifest['shards'])} indexed shards, {total} lines, 4 seam shards and land-value rejection")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())