# SSH tunnel: laptop localhost -> RACE inference API.
# Default local port 8008 avoids conflict with dev.ps1 (local CPU API on :8000).
#
# Usage:
#   npm run race:tunnel
#   powershell -File scripts/race-tunnel.ps1 -LocalPort 8008
param([int]$LocalPort = 8008)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "race-common.ps1")

$cfg = Get-RaceConfig
$inv = Get-SshInvocation $cfg

Write-Host "Tunneling http://127.0.0.1:$LocalPort -> RACE http://127.0.0.1:8000"
Write-Host "Target: $($inv.Target)  (Ctrl+C to stop)"
Write-Host ""
Write-Host "Set in apps/web/.env.local (then restart npm run dev):" -ForegroundColor Cyan
Write-Host "  NEXT_PUBLIC_INFERENCE_API_URL=auto"
Write-Host ""
Write-Host "Check GPU: npm run race:check" -ForegroundColor Cyan
Write-Host ""

& ssh @($inv.ExtraArgs) -N -L "${LocalPort}:127.0.0.1:8000" $inv.Target
