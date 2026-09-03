# Build/repair the single RACE GPU venv (Python 3.11 .venv — torch + paddle + OCR).
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "race-common.ps1")

$cfg = Get-RaceConfig
$remoteAbs = Expand-RemoteRepoPath -RemoteRepo $cfg.RemoteRepo -User $cfg.SshUser
$localScript = Join-Path $PSScriptRoot "race-setup-venv.sh"
$remoteScript = "$remoteAbs/scripts/race-setup-venv.sh"
$localReq = Join-Path $cfg.RepoRoot "services\inference\requirements-race-gpu.txt"
$remoteReq = "$remoteAbs/services/inference/requirements-race-gpu.txt"

Write-Host "==> Upload unified RACE venv scripts"
Invoke-RaceScp -Config $cfg -LocalPath $localScript -RemotePath $remoteScript
Invoke-RaceScp -Config $cfg -LocalPath $localReq -RemotePath $remoteReq

# Sync app fixes if present locally
$syncFiles = @(
  "services\inference\app\detect_catalog.py",
  "services\inference\app\pipeline\paddle_ocr.py"
)
foreach ($rel in $syncFiles) {
  $local = Join-Path $cfg.RepoRoot $rel
  if (Test-Path $local) {
    $remote = "$remoteAbs/" + ($rel -replace '\\', '/')
    Invoke-RaceScp -Config $cfg -LocalPath $local -RemotePath $remote
  }
}

Write-Host "==> Run race-setup-venv.sh on RACE (10-20 min first time)"
Invoke-RaceSsh -Config $cfg -RemoteCommand "sed -i 's/\r$//' '$remoteScript' '$remoteAbs/scripts/race-services.sh' && bash '$remoteScript'"

Write-Host ""
Write-Host "Verify (tunnel on :8008):" -ForegroundColor Cyan
Write-Host "  npm run race:check"
Write-Host "  curl http://127.0.0.1:8008/health"
