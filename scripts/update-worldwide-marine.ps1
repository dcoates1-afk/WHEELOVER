param(
  [string]$WorkDir = "$env:USERPROFILE\WHEELOVER\data-worldwide",
  [string]$ReplicationUrl = "https://planet.openstreetmap.org/replication/day/",
  [switch]$SkipReplicationBootstrap
)
$ErrorActionPreference = "Stop"
$WorkDir = [System.IO.Path]::GetFullPath($WorkDir)
$Planet = Join-Path $WorkDir "planet-latest.osm.pbf"
$BuildLockPath = Join-Path $WorkDir "marine-build-lock.json"
$Candidate = Join-Path $WorkDir "planet-candidate.osm.pbf"
$Previous = Join-Path $WorkDir "planet-previous.osm.pbf"
$JournalPath = Join-Path $WorkDir "promotion-journal.json"
$BootstrapMarker = Join-Path $WorkDir "replication-bootstrap.json"
$UpdateLog = Join-Path $WorkDir "pyosmium-update.log"
$PipelineCli = Join-Path $PSScriptRoot "marine-pipeline-cli.mjs"
$PathsJson = ConvertTo-Json -Compress @{ planet=$Planet; candidate=$Candidate; previous=$Previous; journal=$JournalPath; bootstrapMarker=$BootstrapMarker }

if (-not (Test-Path $Planet)) { throw "Missing $Planet. Run build-worldwide-marine.ps1 first." }
if (Test-Path $BuildLockPath) { throw "Marine archive build lock exists at $BuildLockPath; refusing concurrent planet update." }
if ($SkipReplicationBootstrap -and -not (Test-Path $BootstrapMarker)) {
  Write-Warning "Skipping replication bootstrap; archive will represent the downloaded planet snapshot, not current OSM state."
  exit 0
}
if (-not (Get-Command pyosmium-up-to-date -ErrorAction SilentlyContinue)) { throw "Install Pyosmium: py -m pip install pyosmium" }
if (-not (Get-Command osmium -ErrorAction SilentlyContinue)) { throw "Install Osmium Tool and add osmium.exe to PATH." }

if (Test-Path $JournalPath) {
  $Journal = Get-Content -Raw $JournalPath | ConvertFrom-Json
  if ($Journal.phase -notin @("cleanup-previous", "candidate-ready", "promoted")) { throw "Unknown promotion phase '$($Journal.phase)'. Preserve and inspect the journal and all PBFs." }
  if ($Journal.bootstrap -and -not $Journal.replicationUrl) { $Journal | Add-Member -NotePropertyName replicationUrl -NotePropertyValue $ReplicationUrl -Force }
  node $PipelineCli recover $PathsJson (ConvertTo-Json -Compress $Journal)
  if ($LASTEXITCODE -ne 0) { throw "Interrupted promotion could not be safely recovered. Preserve all files and inspect $JournalPath." }
  Write-Host "Recovered the interrupted PBF promotion."
}
if (Test-Path $Candidate) { throw "Unjournaled candidate exists at $Candidate. Inspect it; it will not be overwritten." }
$IsBootstrap = -not (Test-Path $BootstrapMarker)
if ($IsBootstrap -and (Test-Path $Previous)) {
  throw "A previous snapshot exists at $Previous but no bootstrap marker is present. Inspect the PBF and promotion state before retrying."
}

$BatchCount = 0
$UpdateStatus = 1
while ($UpdateStatus -eq 1) {
  $BatchCount++
  if ($BatchCount -gt 100) { throw "More than 100 update batches remain. The current planet is valid; rerun this script later to continue." }
  if ($IsBootstrap) {
    Write-Host "Bootstrapping replication from snapshot (Pyosmium estimates the sequence by timestamp; batch $BatchCount)."
    $Arguments = @("--ignore-osmosis-headers", "--server", $ReplicationUrl, "--wind-back", "60", "--size", "1024", "--outfile", $Candidate, $Planet)
  } else {
    Write-Host "Applying published replication diffs from $ReplicationUrl (batch $BatchCount)."
    $Arguments = @("--server", $ReplicationUrl, "--size", "1024", "--outfile", $Candidate, $Planet)
  }
  & pyosmium-up-to-date @Arguments *> $UpdateLog
  $UpdateStatus = $LASTEXITCODE
  Get-Content -LiteralPath $UpdateLog
  if ($UpdateStatus -gt 1) { throw "pyosmium-up-to-date failed ($UpdateStatus); original planet remains unchanged." }
  if (-not (Test-Path $Candidate)) {
    if ($BatchCount -eq 1) { Write-Host "No newer diffs were applied; planet file unchanged."; return }
    throw "Pyosmium reported more diffs but did not create a candidate. Inspect $UpdateLog."
  }

  & osmium fileinfo --extended --checksums $Candidate
  if ($LASTEXITCODE -ne 0) { throw "Candidate fileinfo validation failed; original planet remains unchanged." }
  & osmium check-refs --check-relations $Candidate
  if ($LASTEXITCODE -ne 0) { throw "Candidate has missing references; original planet remains unchanged." }

  $Journal = @{
    schema=1; phase="candidate-ready"; createdAt=[DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    bootstrap=$IsBootstrap; replicationUrl=$ReplicationUrl
  }
  $JournalJson = ConvertTo-Json -Compress $Journal
  node $PipelineCli write-journal $JournalPath $JournalJson
  if ($LASTEXITCODE -ne 0) { throw "Could not save promotion journal; preserve current and candidate PBFs." }
  node $PipelineCli promote $PathsJson $JournalJson
  if ($LASTEXITCODE -ne 0) { throw "Promotion failed. Preserve candidate, previous PBF, and journal; rerun to recover." }
  $IsBootstrap = $false
  if ($UpdateStatus -eq 0) { Write-Host "Replication caught up to all changes currently available." }
}
Write-Host "Update complete after $BatchCount batch(es). Current PBF: $Planet. Previous validated PBF: $Previous."
