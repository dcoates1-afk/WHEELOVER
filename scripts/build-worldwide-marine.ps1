param(
  [string]$PlanetUrl = "https://planet.openstreetmap.org/pbf/planet-latest.osm.pbf",
  [string]$WorkDir = "$env:USERPROFILE\WHEELOVER\data-worldwide",
  [string]$PlanetPath = "",
  [switch]$SkipReplicationBootstrap,
  [switch]$AdoptCompletedFilter,
  [string]$ArchiveOutDir = "$PSScriptRoot\..\public\marine-db",
  [string]$GdalConfig = "$PSScriptRoot\osmconf-marine.ini"
)
$ErrorActionPreference = "Stop"
$WorkDir = [System.IO.Path]::GetFullPath($WorkDir)
$ArchiveOutDir = [System.IO.Path]::GetFullPath($ArchiveOutDir)
$GdalConfig = [System.IO.Path]::GetFullPath($GdalConfig)
New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null
$Planet = if ($PlanetPath) { [System.IO.Path]::GetFullPath($PlanetPath) } else { Join-Path $WorkDir "planet-latest.osm.pbf" }
if ($Planet -ne (Join-Path $WorkDir "planet-latest.osm.pbf")) { throw "PlanetPath must be WorkDir\\planet-latest.osm.pbf because replication updates use fixed candidate and rollback paths." }
$PlanetPartial = "$Planet.partial"
$PlanetMd5 = "$Planet.md5"
if (-not $Planet.StartsWith("$WorkDir\", [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "PlanetPath must be inside WorkDir so the update pipeline can keep its candidate and rollback files together. Got $Planet"
}
$PlanetParent = [System.IO.Path]::GetDirectoryName($Planet)
if (-not (Test-Path -LiteralPath $PlanetParent)) { throw "Planet directory does not exist: $PlanetParent" }
$Filtered = Join-Path $WorkDir "marine-filtered.osm.pbf"
$GeoJsonSeq = Join-Path $WorkDir "marine.geojsonseq"
$FilteredWays = Join-Path $WorkDir "marine-lines.geojsonseq"
$FerryRelations = Join-Path $WorkDir "ferry-relations.geojsonseq"
$TssLines = Join-Path $WorkDir "tss-lines-v2.geojsonseq"
$TssPolygons = Join-Path $WorkDir "tss-polygons-v2.geojsonseq"
$TssMultiLines = Join-Path $WorkDir "tss-multilines-v2.geojsonseq"
$TssOtherRelations = Join-Path $WorkDir "tss-other-relations-v2.geojsonseq"
$SeamarkLines = Join-Path $WorkDir "seamark-lines-v1.geojsonseq"
$SeamarkPolygons = Join-Path $WorkDir "seamark-polygons-v1.geojsonseq"
$SeamarkMultiLines = Join-Path $WorkDir "seamark-multilines-v1.geojsonseq"
$SeamarkOtherRelations = Join-Path $WorkDir "seamark-other-relations-v1.geojsonseq"
$MergedGeoJsonSeq = Join-Path $WorkDir "marine-with-ferry-relations.geojsonseq"
$MarineSource = Join-Path $WorkDir "marine-source.json"
$PipelineCli = Join-Path $PSScriptRoot "marine-pipeline-cli.mjs"

foreach ($Tool in @("curl.exe", "osmium", "ogr2ogr", "pyosmium-up-to-date", "node")) {
  if (-not (Get-Command $Tool -ErrorAction SilentlyContinue)) { throw "Required tool '$Tool' is missing from PATH." }
}
if (-not (Test-Path $GdalConfig)) { throw "Missing GDAL config: $GdalConfig" }

# Download a resumable partial; only promote it after verifying the official MD5.
if (-not (Test-Path $Planet)) {
  if (Test-Path $PlanetPath) { throw "Specified planet PBF is missing: $Planet" }
  $ChecksumDownload = "$PlanetMd5.download"
  Invoke-WebRequest -Uri "$PlanetUrl.md5" -OutFile $ChecksumDownload
  if (Test-Path $PlanetPartial) {
    Write-Host "Resuming planet download: $PlanetPartial"
  } else {
    Write-Host "Downloading the OSM planet to $PlanetPartial. Check free disk space first; the PBF is very large."
  }
  & curl.exe --fail --location --retry 8 --retry-all-errors --continue-at - --output $PlanetPartial $PlanetUrl
  if ($LASTEXITCODE -ne 0) { throw "Planet download failed ($LASTEXITCODE). Keep the .partial file and rerun to resume." }
  node $PipelineCli checksum $ChecksumDownload $PlanetPartial
  if ($LASTEXITCODE -ne 0) { throw "Planet checksum validation failed; no planet file was promoted." }
  [System.IO.File]::Move($PlanetPartial, $Planet)
  Move-Item -LiteralPath $ChecksumDownload -Destination $PlanetMd5 -Force
  Write-Host "Verified and saved the OSM planet snapshot."
} elseif (-not (Test-Path $PlanetMd5)) {
  Invoke-WebRequest -Uri "$PlanetUrl.md5" -OutFile "$PlanetMd5.download"
  node $PipelineCli checksum "$PlanetMd5.download" $Planet
  if ($LASTEXITCODE -ne 0) { throw "Existing planet PBF failed the official checksum." }
  Move-Item -LiteralPath "$PlanetMd5.download" -Destination $PlanetMd5 -Force
}

# Bootstrap the PBF's replication metadata once, then catch up later with diffs.
$UpdateScript = Join-Path $PSScriptRoot "update-worldwide-marine.ps1"
if (-not $SkipReplicationBootstrap) {
  & $UpdateScript -WorkDir $WorkDir -ReplicationUrl "https://planet.openstreetmap.org/replication/day/"
  if ($LASTEXITCODE -ne 0) { throw "Planet replication update failed ($LASTEXITCODE)." }
} else {
  Write-Warning "Skipping replication updates; the archive will represent the downloaded planet snapshot, not current OSM state."
}

# The filtered PBF and every derived extract are tied to the current PBF's size,
# write time, and extraction schema. Bump schema when export fields/logic change;
# otherwise a valid planet snapshot may reuse a sector-truncated cached archive.
$PlanetInfo = Get-Item -LiteralPath $Planet
$ExportSchema = 4
$PlanetFingerprint = "$($PlanetInfo.Length):$($PlanetInfo.LastWriteTimeUtc.Ticks):$ExportSchema"
$ReuseFiltered = $false
if ((Test-Path $Filtered) -and (Test-Path $MarineSource)) {
  $SourceRecord = Get-Content -Raw $MarineSource | ConvertFrom-Json
  $ReuseFiltered = $SourceRecord.version -eq 4 -and $SourceRecord.planetFingerprint -eq $PlanetFingerprint
}
if (-not $ReuseFiltered -and $AdoptCompletedFilter) {
  if (-not (Test-Path $Filtered)) { throw "Cannot adopt completed filter; missing $Filtered" }
  if (Test-Path $MarineSource) { throw "Cannot adopt a filter with an existing source record that does not match the current planet." }
  Write-Host "Validating the completed filtered PBF and recording its source; the full-planet scan will not be repeated."
  & osmium fileinfo --extended $Filtered
  if ($LASTEXITCODE -ne 0) { throw "Completed filtered PBF failed validation; preserve all inputs and intermediates." }
  node $PipelineCli write-source $MarineSource $PlanetFingerprint
  if ($LASTEXITCODE -ne 0) { throw "Could not record the completed filtered PBF's source fingerprint." }
  foreach ($Stale in @($GeoJsonSeq, $FilteredWays, $FerryRelations, $TssLines, $TssPolygons, $TssMultiLines, $TssOtherRelations, $SeamarkLines, $SeamarkPolygons, $SeamarkMultiLines, $SeamarkOtherRelations, $MergedGeoJsonSeq)) {
    if (Test-Path $Stale) { Remove-Item -LiteralPath $Stale -Force }
  }
  $ReuseFiltered = $true
}
if (-not $ReuseFiltered) {
  Write-Host "Filtering marine features for this snapshot (full planet scan; may take hours)."
  $PartialFiltered = "$Filtered.partial.osm.pbf"
  if (Test-Path $PartialFiltered) { Remove-Item -LiteralPath $PartialFiltered -Force }
  & osmium tags-filter --output $PartialFiltered $Planet `
    "nwr/seamark" "nwr/seamark:*" "n/man_made=lighthouse" "nwr/historic=wreck" "nwr/man_made=wreck" "route=ferry" "nwr/bridge" "nwr/tidal" "nwr/tidal:range" "nwr/water=tidal" "nwr/waterway=tidal_channel"
  if ($LASTEXITCODE -ne 0) { throw "osmium tags-filter failed ($LASTEXITCODE); original planet is unchanged." }
  Move-Item -LiteralPath $PartialFiltered -Destination $Filtered
  node $PipelineCli write-source $MarineSource $PlanetFingerprint
  if ($LASTEXITCODE -ne 0) { throw "Could not record the filtered data's source fingerprint." }
  foreach ($Stale in @($GeoJsonSeq, $FilteredWays, $FerryRelations, $TssLines, $TssPolygons, $TssMultiLines, $TssOtherRelations, $SeamarkLines, $SeamarkPolygons, $SeamarkMultiLines, $SeamarkOtherRelations, $MergedGeoJsonSeq)) {
    if (Test-Path $Stale) { Remove-Item -LiteralPath $Stale -Force }
  }
}

if (-not (Test-Path $GeoJsonSeq)) {
  Write-Host "Reconstructing feature geometry as streamed GeoJSON Text Sequences."
  $PartialGeoJsonSeq = "$GeoJsonSeq.partial"
  if (Test-Path $PartialGeoJsonSeq) { Remove-Item -LiteralPath $PartialGeoJsonSeq -Force }
  & osmium export --output-format=geojsonseq --output $PartialGeoJsonSeq --add-unique-id=type_id $Filtered
  if ($LASTEXITCODE -ne 0) { throw "osmium export failed ($LASTEXITCODE); keep the planet and filtered PBF." }
  Move-Item -LiteralPath $PartialGeoJsonSeq -Destination $GeoJsonSeq
}

# GDAL's OSM driver assembles ferry routes and seamark relations/areas in its
# geometry layers. Export those explicitly because osmium export does not reliably
# emit general relations or area geometries. all_tags preserves every OSM tag,
# including numbered light-sector fields, in these OGR exports.
$env:OSM_CONFIG_FILE = $GdalConfig
if (-not (Test-Path $FilteredWays)) {
  Write-Host "Exporting tagged ferry ways from GDAL's lines layer."
  $PartialWays = "$FilteredWays.partial"
  if (Test-Path $PartialWays) { Remove-Item -LiteralPath $PartialWays -Force }
  & ogr2ogr -f GeoJSONSeq $PartialWays $Filtered -dialect SQLite -sql "SELECT * FROM lines WHERE route = 'ferry'"
  if ($LASTEXITCODE -ne 0) { throw "GDAL ferry-way export failed ($LASTEXITCODE)." }
  Move-Item -LiteralPath $PartialWays -Destination $FilteredWays
}
if (-not (Test-Path $FerryRelations)) {
  Write-Host "Exporting assembled ferry route relations from GDAL's multilinestrings layer."
  $PartialRelations = "$FerryRelations.partial"
  if (Test-Path $PartialRelations) { Remove-Item -LiteralPath $PartialRelations -Force }
  & ogr2ogr -f GeoJSONSeq $PartialRelations $Filtered -dialect SQLite -sql "SELECT * FROM multilinestrings WHERE route = 'ferry'"
  if ($LASTEXITCODE -ne 0) { throw "GDAL ferry-relation export failed ($LASTEXITCODE)." }
  Move-Item -LiteralPath $PartialRelations -Destination $FerryRelations
}
if (-not (Test-Path $TssLines)) {
  Write-Host "Exporting TSS line geometries from GDAL's reconstructed lines layer."
  $PartialTssLines = "$TssLines.partial"
  if (Test-Path $PartialTssLines) { Remove-Item -LiteralPath $PartialTssLines -Force }
  & ogr2ogr -f GeoJSONSeq $PartialTssLines $Filtered -dialect SQLite -sql "SELECT *, 'w' || osm_id AS osm_ref FROM lines WHERE seamark_type LIKE 'separation_%'"
  if ($LASTEXITCODE -ne 0) { throw "GDAL TSS line export failed ($LASTEXITCODE)." }
  Move-Item -LiteralPath $PartialTssLines -Destination $TssLines
}
if (-not (Test-Path $TssPolygons)) {
  Write-Host "Exporting TSS polygon geometries from GDAL's multipolygons layer."
  $PartialTssPolygons = "$TssPolygons.partial"
  if (Test-Path $PartialTssPolygons) { Remove-Item -LiteralPath $PartialTssPolygons -Force }
  & ogr2ogr -f GeoJSONSeq $PartialTssPolygons $Filtered -dialect SQLite -sql "SELECT *, CASE WHEN osm_way_id IS NOT NULL THEN 'w' || osm_way_id ELSE 'r' || osm_id END AS osm_ref FROM multipolygons WHERE seamark_type LIKE 'separation_%'"
  if ($LASTEXITCODE -ne 0) { throw "GDAL TSS polygon export failed ($LASTEXITCODE)." }
  Move-Item -LiteralPath $PartialTssPolygons -Destination $TssPolygons
}
if (-not (Test-Path $TssMultiLines)) {
  Write-Host "Exporting TSS relation lines from GDAL's multilinestrings layer."
  $PartialTssMultiLines = "$TssMultiLines.partial"
  if (Test-Path $PartialTssMultiLines) { Remove-Item -LiteralPath $PartialTssMultiLines -Force }
  & ogr2ogr -f GeoJSONSeq $PartialTssMultiLines $Filtered -dialect SQLite -sql "SELECT *, 'r' || osm_id AS osm_ref FROM multilinestrings WHERE seamark_type LIKE 'separation_%'"
  if ($LASTEXITCODE -ne 0) { throw "GDAL TSS multilinestring export failed ($LASTEXITCODE)." }
  Move-Item -LiteralPath $PartialTssMultiLines -Destination $TssMultiLines
}
if (-not (Test-Path $TssOtherRelations)) {
  Write-Host "Exporting other TSS relation geometries from GDAL's other_relations layer."
  $PartialTssOtherRelations = "$TssOtherRelations.partial"
  if (Test-Path $PartialTssOtherRelations) { Remove-Item -LiteralPath $PartialTssOtherRelations -Force }
  & ogr2ogr -f GeoJSONSeq $PartialTssOtherRelations $Filtered -dialect SQLite -sql "SELECT *, 'r' || osm_id AS osm_ref FROM other_relations WHERE seamark_type LIKE 'separation_%'"
  if ($LASTEXITCODE -ne 0) { throw "GDAL TSS other-relations export failed ($LASTEXITCODE)." }
  Move-Item -LiteralPath $PartialTssOtherRelations -Destination $TssOtherRelations
}
if (-not (Test-Path $SeamarkLines)) {
  Write-Host "Exporting all seamark line geometry from GDAL's reconstructed lines layer."
  $PartialSeamarkLines = "$SeamarkLines.partial"
  if (Test-Path $PartialSeamarkLines) { Remove-Item -LiteralPath $PartialSeamarkLines -Force }
  & ogr2ogr -f GeoJSONSeq $PartialSeamarkLines $Filtered -dialect SQLite -sql "SELECT *, 'w' || osm_id AS osm_ref FROM lines WHERE seamark_type IS NOT NULL"
  if ($LASTEXITCODE -ne 0) { throw "GDAL seamark-line export failed ($LASTEXITCODE)." }
  Move-Item -LiteralPath $PartialSeamarkLines -Destination $SeamarkLines
}
if (-not (Test-Path $SeamarkPolygons)) {
  Write-Host "Exporting all seamark polygon geometry from GDAL's multipolygons layer."
  $PartialSeamarkPolygons = "$SeamarkPolygons.partial"
  if (Test-Path $PartialSeamarkPolygons) { Remove-Item -LiteralPath $PartialSeamarkPolygons -Force }
  & ogr2ogr -f GeoJSONSeq $PartialSeamarkPolygons $Filtered -dialect SQLite -sql "SELECT *, CASE WHEN osm_way_id IS NOT NULL THEN 'w' || osm_way_id ELSE 'r' || osm_id END AS osm_ref FROM multipolygons WHERE seamark_type IS NOT NULL"
  if ($LASTEXITCODE -ne 0) { throw "GDAL seamark-polygon export failed ($LASTEXITCODE)." }
  Move-Item -LiteralPath $PartialSeamarkPolygons -Destination $SeamarkPolygons
}
if (-not (Test-Path $SeamarkMultiLines)) {
  Write-Host "Exporting all seamark relation line geometry from GDAL's multilinestrings layer."
  $PartialSeamarkMultiLines = "$SeamarkMultiLines.partial"
  if (Test-Path $PartialSeamarkMultiLines) { Remove-Item -LiteralPath $PartialSeamarkMultiLines -Force }
  & ogr2ogr -f GeoJSONSeq $PartialSeamarkMultiLines $Filtered -dialect SQLite -sql "SELECT *, 'r' || osm_id AS osm_ref FROM multilinestrings WHERE seamark_type IS NOT NULL"
  if ($LASTEXITCODE -ne 0) { throw "GDAL seamark-multiline export failed ($LASTEXITCODE)." }
  Move-Item -LiteralPath $PartialSeamarkMultiLines -Destination $SeamarkMultiLines
}
if (-not (Test-Path $SeamarkOtherRelations)) {
  Write-Host "Exporting all seamark relation area geometry from GDAL's other_relations layer."
  $PartialSeamarkOtherRelations = "$SeamarkOtherRelations.partial"
  if (Test-Path $PartialSeamarkOtherRelations) { Remove-Item -LiteralPath $PartialSeamarkOtherRelations -Force }
  & ogr2ogr -f GeoJSONSeq $PartialSeamarkOtherRelations $Filtered -dialect SQLite -sql "SELECT *, 'r' || osm_id AS osm_ref FROM other_relations WHERE seamark_type IS NOT NULL"
  if ($LASTEXITCODE -ne 0) { throw "GDAL seamark other-relations export failed ($LASTEXITCODE)." }
  Move-Item -LiteralPath $PartialSeamarkOtherRelations -Destination $SeamarkOtherRelations
}
$MarineSources = @($GeoJsonSeq, $FilteredWays, $FerryRelations, $TssLines, $TssPolygons, $TssMultiLines, $TssOtherRelations, $SeamarkLines, $SeamarkPolygons, $SeamarkMultiLines, $SeamarkOtherRelations)
$RebuildMerged = -not (Test-Path $MergedGeoJsonSeq)
if (-not $RebuildMerged) {
  $MergedTime = (Get-Item -LiteralPath $MergedGeoJsonSeq).LastWriteTimeUtc
  $RebuildMerged = @($MarineSources | Where-Object { (Get-Item -LiteralPath $_).LastWriteTimeUtc -gt $MergedTime }).Count -gt 0
}
if ($RebuildMerged) {
  Write-Host "Combining marine features into the streamed builder input."
  $PartialMerged = "$MergedGeoJsonSeq.partial"
  if (Test-Path $PartialMerged) { Remove-Item -LiteralPath $PartialMerged -Force }
  $Output = [System.IO.File]::Create($PartialMerged)
  try {
    foreach ($Source in $MarineSources) {
      $Input = [System.IO.File]::OpenRead($Source)
      try { $Input.CopyTo($Output) } finally { $Input.Dispose() }
      $Output.WriteByte(10)
    }
  } finally { $Output.Dispose() }
  Move-Item -LiteralPath $PartialMerged -Destination $MergedGeoJsonSeq
}

$ProjectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
Push-Location $ProjectRoot
try {
  node scripts/build-marine-db.mjs $MergedGeoJsonSeq --out $ArchiveOutDir
  if ($LASTEXITCODE -ne 0) { throw "Marine archive builder failed ($LASTEXITCODE)." }
  node scripts/verify-marine-db.mjs $ArchiveOutDir
  if ($LASTEXITCODE -ne 0) { throw "Marine archive verification failed ($LASTEXITCODE)." }
} finally { Pop-Location }
Write-Host "Complete. Local chart archive: $ArchiveOutDir. Planet and intermediate data remain under $WorkDir, outside the repository."
