# Compare local inference (laptop) vs RACE (via tunnel).
# Usage: powershell -File scripts/race-check.ps1 [-LocalPort 8008]
param([int]$LocalPort = 8008)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Continue"

function Get-Health([string]$Url) {
    try {
        $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5
        return $r.Content | ConvertFrom-Json
    } catch {
        return $null
    }
}

Write-Host "HighLife inference check`n"

$local8000 = Get-Health "http://127.0.0.1:8000/health"
$tunneled = Get-Health "http://127.0.0.1:$LocalPort/health"

if ($local8000) {
    Write-Host "Port 8000 (often local dev.ps1 / laptop CPU):" -ForegroundColor Yellow
    Write-Host "  run_mode=$($local8000.run_mode)  device=$($local8000.device)"
} else {
    Write-Host "Port 8000: nothing responding"
}

Write-Host ""
if ($tunneled) {
    $cudaOk = $false
    if ($tunneled.PSObject.Properties.Name -contains "cuda_available") {
        $cudaOk = [bool]$tunneled.cuda_available
    } else {
        $cudaOk = ($tunneled.device -eq "cuda")
    }
    $color = if ($cudaOk) { "Green" } else { "Yellow" }
    Write-Host "Port $LocalPort (RACE tunnel — use this for GPU):" -ForegroundColor $color
    Write-Host "  run_mode=$($tunneled.run_mode)  device=$($tunneled.device)"
    if ($tunneled.PSObject.Properties.Name -contains "cuda_available") {
        Write-Host "  cuda_available=$($tunneled.cuda_available)"
    }
    if (-not $cudaOk) {
        Write-Host "  WARN: GPU not active — inference runs on CPU (slow)." -ForegroundColor Yellow
        Write-Host "  Fix PyTorch on RACE (driver 12.x needs cu124 wheels, not cu130):" -ForegroundColor Yellow
        Write-Host "    npm run race:fix-gpu"
        Write-Host "  Or on RACE:"
        Write-Host "    source ~/HighLifeAIWeb/services/inference/.venv/bin/activate"
        Write-Host "    pip install -U torch torchvision --index-url https://download.pytorch.org/whl/cu124 --force-reinstall"
        Write-Host "    bash ~/HighLifeAIWeb/scripts/race-services.sh restart"
    }
} else {
    Write-Host "Port ${LocalPort}: no response — start tunnel: npm run race:tunnel" -ForegroundColor Red
}

Write-Host ""
if ($local8000 -and $local8000.device -eq "cpu" -and (-not $tunneled -or $tunneled.device -eq "cpu")) {
    Write-Host "Tip: dev.ps1 binds laptop CPU inference on :8000." -ForegroundColor Cyan
    Write-Host "  1) npm run race:tunnel   (forwards RACE -> localhost:$LocalPort)"
    Write-Host "  2) Set apps/web/.env.local:"
    Write-Host "       NEXT_PUBLIC_INFERENCE_API_URL=http://127.0.0.1:$LocalPort"
    Write-Host "  3) Restart npm run dev"
}
