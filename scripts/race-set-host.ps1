# Update RACE public DNS after stop/start (EC2 assigns a new host each time
# unless you attach an Elastic IP).
#
#   npm run race:host -- ec2-xx-xx-xx-xx.ap-southeast-2.compute.amazonaws.com
#   .\scripts\race-set-host.ps1 -HostName ec2-xx-xx-xx-xx.ap-southeast-2.compute.amazonaws.com
#
# Permanent fix: attach an Elastic IP to the workstation so the DNS never changes.

[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [string]$HostName
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "race-common.ps1")

if (-not $HostName -and $args.Count -gt 0) {
    $HostName = [string]$args[0]
}

$HostName = ($HostName -replace '^\s+|\s+$', '')
$HostName = $HostName -replace '^https?://', ''
$HostName = $HostName -replace '^[^@]+@', ''
$HostName = $HostName -replace '/.*$', ''
$HostName = $HostName.Trim().Trim('"').Trim("'")

if (-not $HostName) {
    throw "Pass the new public DNS from the RACE portal.`n  npm run race:host -- ec2-xx-xx-xx-xx.ap-southeast-2.compute.amazonaws.com"
}

if ($HostName -notmatch '^(ec2-|[\d.]+|[A-Za-z0-9.-]+\.compute\.amazonaws\.com)') {
    Write-Host "WARN: '$HostName' does not look like an EC2 public DNS or IP." -ForegroundColor Yellow
}

$root = Get-RepoRoot
$envPath = Join-Path $root ".env"
if (-not (Test-Path $envPath)) {
    throw "Missing $envPath"
}

$oldHost = $null
$envLines = Get-Content -LiteralPath $envPath
$wroteEnv = $false
$nextEnv = foreach ($line in $envLines) {
    if ($line -match '^\s*RACE_HOST_NAME\s*=') {
        $oldHost = ($line -split '=', 2)[1].Trim()
        $wroteEnv = $true
        "RACE_HOST_NAME=$HostName"
    } else {
        $line
    }
}
if (-not $wroteEnv) {
    $nextEnv = @($nextEnv) + "RACE_HOST_NAME=$HostName"
}
$utf8 = New-Object System.Text.UTF8Encoding $false
$text = (($nextEnv | ForEach-Object { $_ }) -join "`n").TrimEnd() + "`n"
[IO.File]::WriteAllText($envPath, $text, $utf8)
Write-Host "Updated $envPath  RACE_HOST_NAME=$HostName"

$sshConfig = Join-Path $HOME ".ssh\config"
if (Test-Path $sshConfig) {
    $cfg = Get-Content -LiteralPath $sshConfig
    $inRace = $false
    $replaced = $false
    $nextCfg = foreach ($line in $cfg) {
        if ($line -match '^\s*Host\s+(.+)$') {
            $names = ($Matches[1] -split '\s+')
            $inRace = $names -contains "race"
        }
        if ($inRace -and $line -match '^\s*HostName\s+') {
            $replaced = $true
            ($line -replace '^(\s*HostName\s+)\S+', "`${1}$HostName")
            continue
        }
        $line
    }
    if ($replaced) {
        $cfgUtf8 = New-Object System.Text.UTF8Encoding $false
        $cfgText = (($nextCfg | ForEach-Object { $_ }) -join "`n").TrimEnd() + "`n"
        [IO.File]::WriteAllText($sshConfig, $cfgText, $cfgUtf8)
        Write-Host "Updated $sshConfig  Host race → $HostName"
    } else {
        Write-Host "No HostName line under 'Host race' in $sshConfig — add:" -ForegroundColor Yellow
        Write-Host "  HostName $HostName"
    }
} else {
    Write-Host "No ~/.ssh/config yet. Tunnel still uses RACE_HOST=race — create a Host race block." -ForegroundColor Yellow
}

function Remove-KnownHost([string]$Name) {
    if (-not $Name) { return }
    $prev = $ErrorActionPreference
    $ErrorActionPreference = "SilentlyContinue"
    try {
        & ssh-keygen -R $Name 2>&1 | Out-Null
    } finally {
        $ErrorActionPreference = $prev
    }
}

Remove-KnownHost $oldHost
if ($oldHost -and $oldHost -ne $HostName) { Remove-KnownHost $HostName }
Write-Host "SSH config is ready. Next: npm run race:tunnel"

Write-Host ""
Write-Host "Next: npm run race:tunnel" -ForegroundColor Cyan
Write-Host "To stop changing hosts: attach an Elastic IP to this workstation in AWS/RACE."
