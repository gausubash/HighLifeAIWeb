# Write local Supabase URL/keys into apps/web/.env.local and services/inference/.env.
# Requires: Docker running, then `npx supabase start` (or npm run data:start).

[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location -LiteralPath $Root

function Set-DotEnvValue([string]$Path, [string]$Key, [string]$Value) {
    $line = "$Key=$Value"
    if (-not (Test-Path $Path)) {
        $dir = Split-Path -Parent $Path
        if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
        Set-Content -Path $Path -Value $line -Encoding utf8
        return
    }
    $lines = [System.Collections.Generic.List[string]]::new()
    $found = $false
    foreach ($existing in Get-Content -Path $Path) {
        if ($existing -match "^\s*$([regex]::Escape($Key))\s*=") {
            $lines.Add($line) | Out-Null
            $found = $true
        } else {
            $lines.Add($existing) | Out-Null
        }
    }
    if (-not $found) { $lines.Add($line) | Out-Null }
    Set-Content -Path $Path -Value $lines -Encoding utf8
}

Write-Host "Reading local Supabase status…" -ForegroundColor Cyan
$raw = npx --yes supabase status --output env
if ($LASTEXITCODE -ne 0) {
    throw "Local Supabase is not running. Start it with: npm run data:start"
}

$map = @{}
foreach ($row in ($raw -split "`n")) {
    $trim = $row.Trim()
    if ($trim -match '^(API_URL|ANON_KEY|SERVICE_ROLE_KEY)="(.+)"\s*$') {
        $map[$Matches[1]] = $Matches[2]
    }
}
if (-not $map.API_URL) {
    $jsonMatch = [regex]::Match($raw, '"API_URL"\s*:\s*"([^"]+)"')
    $anonMatch = [regex]::Match($raw, '"ANON_KEY"\s*:\s*"([^"]+)"')
    $svcMatch = [regex]::Match($raw, '"SERVICE_ROLE_KEY"\s*:\s*"([^"]+)"')
    if ($jsonMatch.Success -and $anonMatch.Success -and $svcMatch.Success) {
        $map.API_URL = $jsonMatch.Groups[1].Value
        $map.ANON_KEY = $anonMatch.Groups[1].Value
        $map.SERVICE_ROLE_KEY = $svcMatch.Groups[1].Value
    }
}

if (-not $map.API_URL -or -not $map.ANON_KEY -or -not $map.SERVICE_ROLE_KEY) {
    throw "Could not parse supabase status. Output was:`n$raw"
}

$webEnv = Join-Path $Root "apps\web\.env.local"
$infEnv = Join-Path $Root "services\inference\.env"

Set-DotEnvValue $webEnv "NEXT_PUBLIC_SUPABASE_URL" $map.API_URL
Set-DotEnvValue $webEnv "NEXT_PUBLIC_SUPABASE_ANON_KEY" $map.ANON_KEY
Set-DotEnvValue $webEnv "NEXT_PUBLIC_INFERENCE_API_URL" "auto"
Set-DotEnvValue $infEnv "SUPABASE_URL" $map.API_URL
Set-DotEnvValue $infEnv "SUPABASE_SERVICE_ROLE_KEY" $map.SERVICE_ROLE_KEY

Write-Host "Wrote local keys to:" -ForegroundColor Green
Write-Host "  $webEnv"
Write-Host "  $infEnv"
Write-Host "API $($map.API_URL)  (this machine only — not supabase.co)"
