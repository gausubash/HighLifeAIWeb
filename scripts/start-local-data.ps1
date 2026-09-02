# Start local Supabase in Docker (Postgres, Auth, Storage). Data stays on this PC.

[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location -LiteralPath $Root

docker info 1>$null 2>$null
if ($LASTEXITCODE -ne 0) {
    throw "Docker is not running. Start Docker Desktop, then retry."
}

Write-Host "Starting local Supabase (first run downloads images)…" -ForegroundColor Cyan
npx --yes supabase start
if ($LASTEXITCODE -ne 0) {
    throw "supabase start failed."
}

& (Join-Path $PSScriptRoot "write-local-env.ps1")
