# Shared helpers for RACE remote scripts (reads repo-root .env).
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-RepoRoot {
    $root = Split-Path -Parent $PSScriptRoot
    if (-not (Test-Path (Join-Path $root "services\inference"))) {
        throw "Could not locate repo root from $PSScriptRoot"
    }
    return (Resolve-Path $root).Path
}

function Read-DotEnv {
    param([Parameter(Mandatory)][string]$Path)
    $vars = @{}
    if (-not (Test-Path $Path)) {
        throw "Missing env file: $Path"
    }
    Get-Content -LiteralPath $Path | ForEach-Object {
        $line = $_.Trim()
        if ($line -eq "" -or $line.StartsWith("#")) { return }
        $idx = $line.IndexOf("=")
        if ($idx -lt 1) { return }
        $name = $line.Substring(0, $idx).Trim()
        $value = $line.Substring($idx + 1).Trim()
        $vars[$name] = $value
    }
    return $vars
}

function Get-RaceConfig {
    $root = Get-RepoRoot
    $envPath = Join-Path $root ".env"
    $vars = Read-DotEnv -Path $envPath

    $infEnvPath = Join-Path $root "services\inference\.env"
    $infVars = @{}
    if (Test-Path $infEnvPath) {
        $infVars = Read-DotEnv -Path $infEnvPath
    }

    $sshHost = if ($vars["RACE_HOST"]) { $vars["RACE_HOST"] } else { $null }
    $hostName = if ($vars["RACE_HOST_NAME"]) { $vars["RACE_HOST_NAME"] } else { $null }
    $user = if ($vars["RACE_USER"]) { $vars["RACE_USER"] } else { "ubuntu" }
    $key = if ($vars["RACE_KEY"]) { $vars["RACE_KEY"] -replace "\\", "/" } else { $null }
    $repo = if ($vars["RACE_REPO"]) { $vars["RACE_REPO"] } else { "~/HighLifeAIWeb" }

    if (-not $key -or -not (Test-Path $key)) {
        throw "RACE_KEY missing or not found in .env (expected path to .pem)"
    }
    if (-not $sshHost -and -not $hostName) {
        throw "Set RACE_HOST or RACE_HOST_NAME in repo-root .env"
    }

    $target = if ($sshHost) { $sshHost } else { "${user}@${hostName}" }

    # Supabase: RACE cannot reach laptop-local 127.0.0.1 — prefer cloud URL from repo root.
    $supabaseUrl = $vars["SUPABASE_URL"]
    if (-not $supabaseUrl) { $supabaseUrl = $vars["NEXT_PUBLIC_SUPABASE_URL"] }
    if (-not $supabaseUrl) { $supabaseUrl = $infVars["SUPABASE_URL"] }
    if ($supabaseUrl -match '127\.0\.0\.1|localhost') {
        $cloudUrl = $vars["NEXT_PUBLIC_SUPABASE_URL"]
        if ($cloudUrl -and $cloudUrl -notmatch '127\.0\.0\.1|localhost') {
            $supabaseUrl = $cloudUrl
        }
    }

    $serviceRole = $vars["SUPABASE_SERVICE_ROLE_KEY"]
    if (-not $serviceRole) { $serviceRole = $infVars["SUPABASE_SERVICE_ROLE_KEY"] }

    $roboflowKey = $vars["ROBOFLOW_API_KEY"]
    if (-not $roboflowKey) { $roboflowKey = $infVars["ROBOFLOW_API_KEY"] }

    return [PSCustomObject]@{
        RepoRoot              = $root
        EnvPath               = $envPath
        InferenceEnvPath      = $infEnvPath
        Env                   = $vars
        InferenceEnv          = $infVars
        SshTarget             = $target
        SshUser               = $user
        SshKey                = $key
        RemoteRepo            = $repo
        SupabaseUrl           = $supabaseUrl
        SupabaseServiceRole   = $serviceRole
        PublicSupabaseUrl     = $vars["NEXT_PUBLIC_SUPABASE_URL"]
        RoboflowKey           = $roboflowKey
        ServiceRoleIsLocalDemo = ($serviceRole -match 'supabase-demo')
    }
}

function Get-SshInvocation {
    param($Config)
    $alias = $Config.Env["RACE_HOST"]
    # Prefer ~/.ssh/config Host alias (e.g. "race") — explicit -i can fail on Windows.
    if ($alias -and $alias -notmatch '[.@\\]') {
        return @{
            Target    = $alias
            ExtraArgs = @(
                "-o", "StrictHostKeyChecking=accept-new"
                "-o", "ServerAliveInterval=30"
                "-o", "ServerAliveCountMax=120"
                "-o", "ConnectTimeout=120"
                "-o", "TCPKeepAlive=yes"
            )
        }
    }
    $hostName = $Config.Env["RACE_HOST_NAME"]
    if (-not $hostName) {
        throw "Set RACE_HOST (ssh config alias) or RACE_HOST_NAME in .env"
    }
    return @{
        Target    = "$($Config.SshUser)@$hostName"
        ExtraArgs = (Get-SshBaseArgs $Config)
    }
}

function Get-SshBaseArgs {
    param($Config)
    @(
        "-i", ($Config.SshKey -replace "/", "\")
        "-o", "IdentitiesOnly=yes"
        "-o", "StrictHostKeyChecking=accept-new"
        "-o", "ServerAliveInterval=30"
        "-o", "ServerAliveCountMax=120"
        "-o", "ConnectTimeout=120"
        "-o", "TCPKeepAlive=yes"
    )
}

function Invoke-RaceSsh {
    param(
        [Parameter(Mandatory)]$Config,
        [Parameter(Mandatory)][string]$RemoteCommand
    )
    $inv = Get-SshInvocation $Config
    & ssh @($inv.ExtraArgs) $inv.Target $RemoteCommand
    if ($LASTEXITCODE -ne 0) {
        throw "SSH command failed ($LASTEXITCODE): $RemoteCommand"
    }
}

function Invoke-RaceSshLong {
    param(
        [Parameter(Mandatory)]$Config,
        [Parameter(Mandatory)][string]$RemoteCommand,
        [string]$LogLabel = "race-remote.log"
    )
    # Run long jobs in tmux so RACE browser SSH (often ~60s idle cap) cannot kill pip/apt.
    $escaped = $RemoteCommand -replace "'", "'\\''"
    $tmuxCmd = @(
        "tmux kill-session -t highlife-setup 2>/dev/null || true"
        "tmux new-session -d -s highlife-setup `"bash -lc '$escaped 2>&1 | tee ~/highlife-setup.log; echo __HIGHLIFE_SETUP_DONE__ >> ~/highlife-setup.log' `""
        "echo 'Started in tmux session highlife-setup (log: ~/highlife-setup.log)'"
    ) -join "; "
    Invoke-RaceSsh -Config $Config -RemoteCommand $tmuxCmd

    Write-Host "Waiting for remote setup (GPU venv can take 10-20 min)..."
    $deadline = (Get-Date).AddMinutes(45)
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Seconds 15
        $tail = & ssh @(Get-SshInvocation $Config).ExtraArgs (Get-SshInvocation $Config).Target "tail -n 3 ~/highlife-setup.log 2>/dev/null || true"
        if ($tail -match "__HIGHLIFE_SETUP_DONE__") {
            Write-Host "Remote setup finished."
            & ssh @(Get-SshInvocation $Config).ExtraArgs (Get-SshInvocation $Config).Target "tail -n 30 ~/highlife-setup.log"
            return
        }
        $last = ($tail | Select-Object -Last 1)
        if ($last) { Write-Host "  ... $last" }
    }
    throw "Remote setup timed out after 45 min. Check: ssh race 'tail -f ~/highlife-setup.log'"
}

function Invoke-RaceScp {
    param(
        [Parameter(Mandatory)]$Config,
        [Parameter(Mandatory)][string]$LocalPath,
        [Parameter(Mandatory)][string]$RemotePath
    )
    $inv = Get-SshInvocation $Config
    & scp @($inv.ExtraArgs) $LocalPath "${($inv.Target)}:${RemotePath}"
    if ($LASTEXITCODE -ne 0) {
        throw "SCP failed: $LocalPath -> $RemotePath"
    }
}

function Expand-RemoteRepoPath {
    param([string]$RemoteRepo, [string]$User)
    if ($RemoteRepo.StartsWith("~/")) {
        return "/home/$User/" + $RemoteRepo.Substring(2)
    }
    return $RemoteRepo
}

function New-RaceInferenceEnvFile {
    param(
        [Parameter(Mandatory)]$Config,
        [Parameter(Mandatory)][string]$OutPath
    )

    $root = $Config.RepoRoot
    $example = Join-Path $root "services\inference\.env.example"
    if (-not (Test-Path $example)) {
        throw "Missing $example"
    }

    $text = Get-Content -LiteralPath $example -Raw

    $supabaseUrl = $Config.SupabaseUrl
    if (-not $supabaseUrl) {
        $supabaseUrl = $Config.PublicSupabaseUrl
    }

    $replacements = [ordered]@{
        "RUN_MODE=mock"  = "RUN_MODE=real"
        "RUN_MODE=real"  = "RUN_MODE=real"
        "DEVICE=cpu"     = "DEVICE=auto"
        "DEVICE=cuda"    = "DEVICE=auto"
        "DEVICE=auto"    = "DEVICE=auto"
        "API_HOST=127.0.0.1" = "API_HOST=127.0.0.1"
        "API_PORT=8000"  = "API_PORT=8000"
    }

    foreach ($kv in $replacements.GetEnumerator()) {
        if ($text -match "(?m)^$([regex]::Escape($kv.Key))") {
            $text = [regex]::Replace($text, "(?m)^$([regex]::Escape($kv.Key)).*", $kv.Value)
        }
    }

    if ($supabaseUrl) {
        if ($text -match "(?m)^SUPABASE_URL=") {
            $text = [regex]::Replace($text, "(?m)^SUPABASE_URL=.*", "SUPABASE_URL=$supabaseUrl")
        } else {
            $text += "`nSUPABASE_URL=$supabaseUrl`n"
        }
    }

    if ($Config.SupabaseServiceRole) {
        if ($text -match "(?m)^SUPABASE_SERVICE_ROLE_KEY=") {
            $text = [regex]::Replace(
                $text,
                "(?m)^SUPABASE_SERVICE_ROLE_KEY=.*",
                "SUPABASE_SERVICE_ROLE_KEY=$($Config.SupabaseServiceRole)"
            )
        } else {
            $text += "`nSUPABASE_SERVICE_ROLE_KEY=$($Config.SupabaseServiceRole)`n"
        }
    }

    if ($Config.RoboflowKey) {
        if ($text -match "(?m)^ROBOFLOW_API_KEY=") {
            $text = [regex]::Replace($text, "(?m)^ROBOFLOW_API_KEY=.*", "ROBOFLOW_API_KEY=$($Config.RoboflowKey)")
        }
    }

    # Merge non-path keys from local inference .env when present.
    $local = $Config.InferenceEnv
    if ($local.Count -gt 0) {
        $mergeKeys = @(
            "USE_ROOM_DETECTOR", "YOLO_ROOM_WEIGHTS", "YOLO_ROOM_CONF", "YOLO_ROOM_IMGSZ",
            "USE_LAYOUT_DETECTOR", "YOLO_WEIGHTS", "YOLO_CONF", "YOLO_IMGSZ",
            "WALL_BACKEND", "MITUNET_WALL_WEIGHTS", "ROBOFLOW_MODEL_ID",
            "ROBOFLOW_WALL_MODEL_ID", "ROBOFLOW_ROOM_MODEL_ID", "ROBOFLOW_FLOORPLAN_SEG_MODEL_ID",
            "ROBOFLOW_CONF", "DETECT_TILE_ENABLED", "DETECT_TILE_SIZE",
            "VLM_ENABLED", "VLM_PROVIDER", "VLM_API_URL", "VLM_API_KEY", "VLM_MODEL",
            "VLM_ALLOW_REMOTE_IMAGES"
        )
        foreach ($key in $mergeKeys) {
            $val = $local[$key]
            if (-not $val) { continue }
            if ($val -match '\\' -or $val -match '^[A-Za-z]:') { continue }
            if ($text -match "(?m)^$([regex]::Escape($key))=") {
                $text = [regex]::Replace($text, "(?m)^$([regex]::Escape($key))=.*", "$key=$val")
            } else {
                $text += "`n$key=$val"
            }
        }
    }

    if (-not ($text -match "(?m)^USE_ROOM_DETECTOR=")) {
        $text += "`nUSE_ROOM_DETECTOR=true`n"
    }

    [System.IO.File]::WriteAllText($OutPath, $text.TrimEnd() + "`n")
}
