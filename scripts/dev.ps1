# Start local HighLife stack: local Supabase (Docker) + inference venv + Next.js.
# PDFs, auth, and project rows stay on this machine — not supabase.co.
# OCR uses services/inference/.venv-ocr automatically (subprocess, not a separate server).
#
# Usage (from repo root):
#   npm run dev:stack
#   .\scripts\dev.ps1
#   .\scripts\dev.ps1 -SkipData         # skip starting local Supabase
#   .\scripts\dev.ps1 -WithApi          # also start services/api on :8001
#   .\scripts\dev.ps1 -Stay             # leave Python windows open after Next.js stops

[CmdletBinding()]
param(
    [switch]$WithApi,
    [switch]$Stay,
    [switch]$SkipData
)

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$InfRoot = Join-Path $Root "services\inference"
$ApiRoot = Join-Path $Root "services\api"

function Get-VenvPython([string]$venvDir, [string]$label) {
    $py = Join-Path $venvDir "Scripts\python.exe"
    if (-not (Test-Path $py)) {
        throw "$label venv not found: $py`nCreate it first (see services/inference/README.md)."
    }
    return $py
}

function Start-VenvWindow {
    param(
        [string]$Title,
        [string]$WorkingDirectory,
        [string]$Python,
        [string]$UvicornApp,
        [string]$HostAddr,
        [int]$Port,
        [hashtable]$ExtraEnv
    )
    $envAssign = ""
    foreach ($key in $ExtraEnv.Keys) {
        $val = [string]$ExtraEnv[$key]
        $envAssign += "`$env:$key = '$($val.Replace("'", "''"))'; "
    }
    $command = @"
`$Host.UI.RawUI.WindowTitle = '$Title'
Set-Location -LiteralPath '$WorkingDirectory'
$envAssign
Write-Host '$Title — $Python -m uvicorn $UvicornApp --reload --host $HostAddr --port $Port' -ForegroundColor Cyan
& '$Python' -m uvicorn $UvicornApp --reload --host $HostAddr --port $Port
"@
    return Start-Process -FilePath "powershell.exe" -PassThru -WorkingDirectory $WorkingDirectory -ArgumentList @(
        "-NoLogo",
        "-NoExit",
        "-Command",
        $command
    )
}

$infPy = Get-VenvPython (Join-Path $InfRoot ".venv") "Inference"
$ocrPy = Join-Path $InfRoot ".venv-ocr\Scripts\python.exe"
$tfPy = Join-Path $InfRoot ".venv-tf\Scripts\python.exe"

if (-not $SkipData) {
    Write-Host "Starting local data plane (Docker Supabase) — files stay on this PC" -ForegroundColor Cyan
    & (Join-Path $PSScriptRoot "start-local-data.ps1")
}

$infEnv = @{}
if (Test-Path $ocrPy) {
    $infEnv["PADDLE_OCR_PYTHON"] = $ocrPy
    Write-Host "OCR venv: $ocrPy" -ForegroundColor DarkGray
} else {
    Write-Host "Warning: .venv-ocr not found — PaddleOCR will be unavailable until you create it." -ForegroundColor Yellow
}
if (Test-Path $tfPy) {
    $infEnv["TENSORFLOW_PYTHON"] = $tfPy
}
$infEnv["SUPABASE_URL"] = "http://127.0.0.1:54321"

function Test-TcpPort([string]$TargetHost, [int]$Port, [int]$TimeoutMs = 800) {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $iar = $client.BeginConnect($TargetHost, $Port, $null, $null)
        if (-not $iar.AsyncWaitHandle.WaitOne($TimeoutMs, $false)) {
            return $false
        }
        $client.EndConnect($iar) | Out-Null
        return $true
    } catch {
        return $false
    } finally {
        $client.Close()
    }
}

function Test-InferenceLive([string]$BaseUrl) {
    foreach ($path in @("/live", "/health")) {
        try {
            $r = Invoke-WebRequest -Uri "$BaseUrl$path" -UseBasicParsing -TimeoutSec 5
            if ($r.StatusCode -eq 200) { return $true }
        } catch {
            $code = $null
            try { $code = [int]$_.Exception.Response.StatusCode } catch { }
            if ($path -eq "/live" -and $code -eq 404) { return $true }
        }
    }
    return $false
}

$started = @()

$tunnelPortOpen = Test-TcpPort "127.0.0.1" 8008
$tunnelUp = $tunnelPortOpen -or (Test-InferenceLive "http://127.0.0.1:8008")
if ($tunnelUp) {
    Write-Host "RACE tunnel detected on :8008 — using remote GPU inference (skipping local :8000)" -ForegroundColor Green
    Write-Host "Studio tiling and Detect go to http://127.0.0.1:8008  (keep npm run race:tunnel running)" -ForegroundColor DarkGray
} else {
    Write-Host "No RACE tunnel — starting local inference API on http://127.0.0.1:8000" -ForegroundColor Cyan
    $started += Start-VenvWindow -Title "HighLife inference :8000" -WorkingDirectory $InfRoot -Python $infPy -UvicornApp "app.api:app" -HostAddr "127.0.0.1" -Port 8000 -ExtraEnv $infEnv
    $ready = $false
    for ($i = 0; $i -lt 40; $i++) {
        if (Test-InferenceLive "http://127.0.0.1:8000") {
            $ready = $true
            break
        }
        Start-Sleep -Milliseconds 500
    }
    if ($ready) {
        Write-Host "Local inference ready on http://127.0.0.1:8000" -ForegroundColor Green
    } else {
        Write-Host "Warning: local :8000 is not answering /live yet. Tiling will fail until uvicorn finishes starting." -ForegroundColor Yellow
    }
}

if ($WithApi) {
    $apiPy = Get-VenvPython (Join-Path $ApiRoot ".venv") "Floor-plan API"
    Write-Host "Starting floor-plan API on http://127.0.0.1:8001" -ForegroundColor Cyan
    $started += Start-VenvWindow -Title "HighLife API :8001" -WorkingDirectory $ApiRoot -Python $apiPy -UvicornApp "app.main:app" -HostAddr "127.0.0.1" -Port 8001 -ExtraEnv @{}
}

function Stop-Started {
    foreach ($proc in $started) {
        if ($null -eq $proc) { continue }
        if ($proc.HasExited) { continue }
        Write-Host "Stopping $($proc.ProcessName) PID $($proc.Id)" -ForegroundColor DarkGray
        & taskkill.exe /PID $proc.Id /T /F 2>$null | Out-Null
    }
}

Set-Location -LiteralPath $Root
Write-Host "Starting Next.js (npm run dev) — http://localhost:3000" -ForegroundColor Cyan
Write-Host "Ctrl+C stops the web app$(if (-not $Stay) { ' and the Python windows' } else { '; Python windows stay open' })." -ForegroundColor DarkGray

$code = 0
try {
    npm run dev
    if ($null -ne $LASTEXITCODE) { $code = $LASTEXITCODE }
} finally {
    if (-not $Stay) { Stop-Started }
}

exit $code
