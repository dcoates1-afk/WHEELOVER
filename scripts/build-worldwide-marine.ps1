param(
  [string]$PlanetUrl = "https://planet.openstreetmap.org/pbf/planet-latest.osm.pbf",
  [string]$WorkDir = "$env:USERPROFILE\WHEELOVER\data-worldwide",
  [string]$ArchiveOutDir = "$PSScriptRoot\..\public\marine-db",
  [string]$GdalConfig = "$PSScriptRoot\osmconf-marine.ini"
)
$ErrorActionPreference = "Stop"
$WorkDir = [System.IO.Path]::GetFullPath($WorkDir)
$ArchiveOutDir = [System.IO.Path]::GetFullPath($ArchiveOutDir)
$GdalConfig = [System.IO.Path]::GetFullPath($GdalConfig)
if (-not $WorkDir.StartsWith("$env:USERPROFILE\", [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "WorkDir must be inside your Windows user profile. Got $WorkDir"
}
New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null
$Planet = Join-Path $WorkDir "planet-latest.osm.pbf"
$PlanetPartial = "$Planet.partial"
$PlanetMd5 = "$Planet.md5"
$Filtered = Join-Path $WorkDir "marine-filtered.osm.pbf"
$GeoJsonSeq = Join-Path $WorkDir "marine.geojsonseq"
$FilteredWays = Join-Path $WorkDir "marine-lines.geojsonseq"
$FerryRelations = Join-Path $WorkDir "ferry-relations.geojsonseq"
$MergedGeoJsonSeq = Join-Path $WorkDir "marine-with-ferry-relations.geojsonseq"
$MarineSource = Join-Path $WorkDir "marine-source.json"
$PipelineCli = Join-Path $PSScriptRoot "marine-pipeline-cli.mjs"

foreach ($Tool in @("curl.exe", "osmium", "ogr2ogr", "pyosmium-up-to-date", "node")) {
  if (-not (Get-Command $Tool -ErrorAction SilentlyContinue)) { throw "Required tool '$Tool' is missing from PATH." }
}
if (-not (Test-Path $GdalConfig)) { throw "Missing GDAL config: $GdalConfig" }

# Download a resumable partial; only promote it after verifying the official MD5.
if (-not (Test-Path $Planet)) {
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
& $UpdateScript -WorkDir $WorkDir -ReplicationUrl "https://planet.openstreetmap.org/replication/day/"
if ($LASTEXITCODE -ne 0) { throw "Planet replication update failed ($LASTEXITCODE)." }

# The filtered PBF and every derived extract are tied to the current PBF's size
# and write time. A changed planet forces a rebuild instead of reusing stale data.
$PlanetInfo = Get-Item -LiteralPath $Planet
$PlanetFingerprint = "$($PlanetInfo.Length):$($PlanetInfo.LastWriteTimeUtc.Ticks)"
$ReuseFiltered = $false
if ((Test-Path $Filtered) -and (Test-Path $MarineSource)) {
  $SourceRecord = Get-Content -Raw $MarineSource | ConvertFrom-Json
  $ReuseFiltered = $SourceRecord.version -eq 1 -and $SourceRecord.planetFingerprint -eq $PlanetFingerprint
}
if (-not $ReuseFiltered) {
  Write-Host "Filtering marine features for this snapshot (full planet scan; may take hours)."
  $PartialFiltered = "$Filtered.partial.osm.pbf"
  if (Test-Path $PartialFiltered) { Remove-Item -LiteralPath $PartialFiltered -Force }
  & osmium tags-filter --output $PartialFiltered $Planet `
    "nwr/seamark" "nwr/seamark:*" "n/man_made=lighthouse" "route=ferry"
  if ($LASTEXITCODE -ne 0) { throw "osmium tags-filter failed ($LASTEXITCODE); original planet is unchanged." }
  Move-Item -LiteralPath $PartialFiltered -Destination $Filtered
  node $PipelineCli write-journal $MarineSource (ConvertTo-Json -Compress @{ version=1; planetFingerprint=$PlanetFingerprint })
  if ($LASTEXITCODE -ne 0) { throw "Could not record the filtered data's source fingerprint." }
  foreach ($Stale in @($GeoJsonSeq, $FilteredWays, $FerryRelations, $MergedGeoJsonSeq)) {
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

# GDAL's OSM driver assembles ferry route relations in multilinestrings. Export
# them separately because osmium export intentionally drops general relations.
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
if (-not (Test-Path $MergedGeoJsonSeq)) {
  Write-Host "Combining marine features into the streamed builder input."
  $PartialMerged = "$MergedGeoJsonSeq.partial"
  if (Test-Path $PartialMerged) { Remove-Item -LiteralPath $PartialMerged -Force }
  $Output = [System.IO.File]::Create($PartialMerged)
  try {
    foreach ($Source in @($GeoJsonSeq, $FilteredWays, $FerryRelations)) {
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
