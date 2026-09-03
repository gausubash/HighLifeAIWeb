# Sync HighLifeAIWeb to RACE over SSH and bootstrap GPU inference + training.
# Reads repo-root .env: RACE_HOST, RACE_USER, RACE_KEY, RACE_REPO, Supabase keys.
#
# Usage (from repo root):
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/race-remote-setup.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/race-remote-setup.ps1 -SkipSync
param(
    [switch]$SkipSync,
    [switch]$SkipSetup,
    [switch]$SkipStart
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "race-common.ps1")

$cfg = Get-RaceConfig
$remoteAbs = Expand-RemoteRepoPath -RemoteRepo $cfg.RemoteRepo -User $cfg.SshUser

Write-Host "==> RACE target: $($cfg.SshTarget)"
Write-Host "==> Remote repo: $remoteAbs"

Write-Host "`n==> SSH connectivity + GPU check"
Invoke-RaceSsh -Config $cfg -RemoteCommand "uname -sr; nvidia-smi --query-gpu=name,memory.total --format=csv,noheader; df -h / | tail -1"

if (-not $SkipSync) {
    Write-Host "`n==> Syncing repo to RACE (excluding node_modules, venvs, weights)..."
    $excludes = @(
        "--exclude=node_modules"
        "--exclude=apps/web/.next"
        "--exclude=.venv"
        "--exclude=.venv-ocr"
        "--exclude=.venv-tf"
        "--exclude=**/.pytest_cache"
        "--exclude=**/__pycache__"
        "--exclude=**/*.pt"
        "--exclude=**/*.pth"
        "--exclude=**/*.onnx"
        "--exclude=**/*.h5"
        "--exclude=**/*.pdf"
        "--exclude=.race-logs"
        "--exclude=.race-pids"
        "--exclude=services/inference/models/roboflow_cache"
        "--exclude=services/inference/models/paddleocr-vl"
        "--exclude=.git"
    )

    $archive = Join-Path $env:TEMP "highlife-race-sync.tgz"
    if (Test-Path $archive) { Remove-Item -LiteralPath $archive -Force }

    Invoke-RaceSsh -Config $cfg -RemoteCommand "mkdir -p '$remoteAbs'"

    Push-Location $cfg.RepoRoot
    try {
        $tarArgs = @("-czf", $archive) + $excludes + @(".")
        & tar @tarArgs
        if ($LASTEXITCODE -ne 0) {
            throw "Local tar failed ($LASTEXITCODE)"
        }
    } finally {
        Pop-Location
    }

    $remoteArchive = "/tmp/highlife-race-sync.tgz"
    Invoke-RaceScp -Config $cfg -LocalPath $archive -RemotePath $remoteArchive
    Invoke-RaceSsh -Config $cfg -RemoteCommand "tar -xzf '$remoteArchive' -C '$remoteAbs' && rm -f '$remoteArchive'"
    Remove-Item -LiteralPath $archive -Force -ErrorAction SilentlyContinue
    Write-Host "Sync complete."
}

if (-not $SkipSetup) {
    Write-Host "`n==> Building RACE inference .env"
    $tempEnv = Join-Path $env:TEMP "highlife-race-inference.env"
    New-RaceInferenceEnvFile -Config $cfg -OutPath $tempEnv
    $remoteEnv = "$remoteAbs/services/inference/.env"
    Invoke-RaceScp -Config $cfg -LocalPath $tempEnv -RemotePath $remoteEnv
    Remove-Item -LiteralPath $tempEnv -Force -ErrorAction SilentlyContinue

    if (-not $cfg.SupabaseServiceRole) {
        Write-Warning @"
SUPABASE_SERVICE_ROLE_KEY not found in repo-root .env or services/inference/.env.
The inference API + GPU detect will work via SSH tunnel, but the Supabase job worker may not.
"@
    } elseif ($cfg.ServiceRoleIsLocalDemo -and $cfg.SupabaseUrl -notmatch '127\.0\.0\.1|localhost') {
        Write-Warning @"
services/inference/.env has the local Supabase demo service-role key, but RACE will use your cloud Supabase URL.
For the job worker on RACE, replace SUPABASE_SERVICE_ROLE_KEY in services/inference/.env with your cloud project's service_role key
(from Supabase dashboard -> Project Settings -> API), then re-run: npm run race:setup
"@
    } else {
        Write-Host "Using SUPABASE_SERVICE_ROLE_KEY from services/inference/.env"
    }

    Write-Host "`n==> Running setup-race.sh on RACE in tmux (apt + GPU venv; may take 10-20 min)..."
    $setupCmd = @(
        "set -euo pipefail"
        "cd '$remoteAbs'"
        "chmod +x scripts/setup-race.sh scripts/race-services.sh scripts/race-train.sh"
        "./scripts/setup-race.sh --skip-vscode --skip-gh --skip-clone"
    ) -join " && "
    Invoke-RaceSshLong -Config $cfg -RemoteCommand $setupCmd

    Write-Host "`n==> Enable GPU .env + restart services"
    Invoke-RaceSsh -Config $cfg -RemoteCommand "sed -i 's/\r$//' '$remoteAbs/scripts/race-enable-gpu.sh' '$remoteAbs/scripts/race-services.sh' && bash '$remoteAbs/scripts/race-enable-gpu.sh'"
}

if (-not $SkipStart) {
    Write-Host "`n==> Starting inference API + worker on RACE"
    $startCmd = @(
        "set -euo pipefail"
        "cd '$remoteAbs'"
        "bash '$remoteAbs/scripts/race-services.sh' stop || true"
        "bash '$remoteAbs/scripts/race-services.sh' start"
        "sleep 2"
        "bash '$remoteAbs/scripts/race-services.sh' status"
        "curl -sf http://127.0.0.1:8000/health | python3 -m json.tool || true"
    ) -join " && "
    Invoke-RaceSsh -Config $cfg -RemoteCommand $startCmd
}

Write-Host @"

================================================================================
RACE setup finished.

On this PC (new terminal):
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/race-tunnel.ps1

Then run the frontend:
  npm run dev

Inference API on RACE: http://127.0.0.1:8000/health (via tunnel)
Remote logs:           ssh race 'tail -f ~/HighLifeAIWeb/.race-logs/inference-api.log'
================================================================================
"@
