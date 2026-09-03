# Apply GPU .env on RACE and restart inference (from laptop).
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "race-common.ps1")

$cfg = Get-RaceConfig
$remoteAbs = Expand-RemoteRepoPath -RemoteRepo $cfg.RemoteRepo -User $cfg.SshUser

Write-Host "==> Upload fresh inference .env (RUN_MODE=real, DEVICE=cuda)"
$tempEnv = Join-Path $env:TEMP "highlife-race-inference.env"
New-RaceInferenceEnvFile -Config $cfg -OutPath $tempEnv
Invoke-RaceScp -Config $cfg -LocalPath $tempEnv -RemotePath "$remoteAbs/services/inference/.env"
Remove-Item -LiteralPath $tempEnv -Force -ErrorAction SilentlyContinue

Write-Host "==> Run race-enable-gpu.sh on RACE"
Invoke-RaceSsh -Config $cfg -RemoteCommand "sed -i 's/\r$//' '$remoteAbs/scripts/race-enable-gpu.sh' '$remoteAbs/scripts/race-services.sh' && bash '$remoteAbs/scripts/race-enable-gpu.sh'"

Write-Host ""
Write-Host "On laptop (tunnel on :8008):" -ForegroundColor Cyan
Write-Host "  npm run race:check"
