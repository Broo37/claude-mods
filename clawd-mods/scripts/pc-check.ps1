# clawd-mods: facts about this PC for Clawd's tips. Read-only, no network.
#
#   -Kind fast  memory and the processes (every 2 minutes)
#   -Kind slow  pending restart, uptime, the startup list, and the installed
#               apps with when each last ran (every 30 minutes)
#
# Prints one line of JSON (the shapes are parseFast and parseSlow in hooks/pc.ts).
# Where to look on Windows follows lib/advisor.ps1 of clawd-usage-winwidget by
# Enhed (MIT): https://github.com/Enhed/clawd-usage-winwidget
param([ValidateSet('fast', 'slow')][string]$Kind = 'fast')

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

function EpochMs([datetime]$when) { ([DateTimeOffset]$when).ToUnixTimeMilliseconds() }

if ($Kind -eq 'fast') {
    $os = Get-CimInstance Win32_OperatingSystem -Property TotalVisibleMemorySize, FreePhysicalMemory
    # Every process: a CPU hog is told by its seconds growing between two checks,
    # and Claude's children (MCP servers) by their parent's id, whatever their size.
    $procs = foreach ($p in Get-CimInstance Win32_Process -Property Name, ProcessId, ParentProcessId, WorkingSetSize, KernelModeTime, UserModeTime) {
        [ordered]@{
            name   = [IO.Path]::GetFileNameWithoutExtension([string]$p.Name)
            pid    = [int]$p.ProcessId
            ppid   = [int]$p.ParentProcessId
            memMb  = [math]::Round([double]$p.WorkingSetSize / 1MB)
            cpuSec = [math]::Round(([double]$p.KernelModeTime + [double]$p.UserModeTime) / 1e7)
        }
    }
    [ordered]@{
        totalMb = [math]::Round([double]$os.TotalVisibleMemorySize / 1KB)
        freeMb  = [math]::Round([double]$os.FreePhysicalMemory / 1KB)
        cores   = [Environment]::ProcessorCount
        procs   = @($procs)
    } | ConvertTo-Json -Compress -Depth 4
    exit 0
}

# --- restart: Windows Update waiting, and the last real boot ------------------
$reboot = $false
foreach ($k in 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired',
               'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending') {
    if (Test-Path $k) { $reboot = $true }
}
# Fast Startup keeps the kernel across "shut down": this counts from a real restart.
$bootAt = EpochMs (Get-CimInstance Win32_OperatingSystem -Property LastBootUpTime).LastBootUpTime

# --- startup: Run keys and Startup folders, minus what is switched off ---------
$off = @{}
foreach ($hive in 'HKCU:', 'HKLM:') {
    foreach ($sub in 'Run', 'Run32', 'StartupFolder') {
        try {
            $item = Get-Item "$hive\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\$sub"
            foreach ($n in $item.GetValueNames()) {
                $b = $item.GetValue($n)
                # An odd first byte: switched off in Task Manager or Settings.
                if ($b -is [byte[]] -and $b.Length -and ($b[0] -band 1)) { $off[$n] = $true }
            }
        } catch {}
    }
}
$startup = @()
foreach ($k in 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run',
               'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run',
               'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Run') {
    try {
        foreach ($n in (Get-Item $k).GetValueNames()) { if ($n -and -not $off[$n]) { $startup += $n } }
    } catch {}
}
foreach ($folder in [Environment]::GetFolderPath('Startup'), [Environment]::GetFolderPath('CommonStartup')) {
    foreach ($f in @(Get-ChildItem $folder -File -ErrorAction SilentlyContinue)) {
        if ($f.Name -eq 'desktop.ini' -or $off[$f.Name]) { continue }
        $startup += [IO.Path]::GetFileNameWithoutExtension($f.Name)
    }
}
$startup = @($startup | Sort-Object -Unique)

# --- when each program last ran: UserAssist, and what runs now -----------------
# Paths there start with known folder GUIDs and are ROT13; Start and taskbar
# entries are shortcuts, resolved to their targets.
$known = @{
    '{6D809377-6AF0-444B-8957-A3773F02200E}' = $env:ProgramW6432
    '{7C5A40EF-A0FB-4BFC-874A-C0F2E0B9FA8E}' = ${env:ProgramFiles(x86)}
    '{F38BF404-1D43-42F2-9305-67DE0B28FC23}' = $env:windir
    '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}' = Join-Path $env:windir 'System32'
    '{0139D44E-6AFE-49F2-8690-3DAFCAE6FFB8}' = [Environment]::GetFolderPath('CommonPrograms')
    '{A77F5D77-2E2B-44C3-A6A2-ABA601054A51}' = [Environment]::GetFolderPath('Programs')
    '{9E3995AB-1F9C-4F13-B827-48B24B6C7174}' = Join-Path $env:APPDATA 'Microsoft\Internet Explorer\Quick Launch\User Pinned'
    '{B4BFCC3A-DB2C-424C-B029-7FE99A87C641}' = [Environment]::GetFolderPath('Desktop')
}
function Rot13([string]$s) {
    $a = $s.ToCharArray()
    for ($i = 0; $i -lt $a.Length; $i++) {
        $c = [int]$a[$i]
        if ($c -ge 65 -and $c -le 90) { $a[$i] = [char]((($c - 65 + 13) % 26) + 65) }
        elseif ($c -ge 97 -and $c -le 122) { $a[$i] = [char]((($c - 97 + 13) % 26) + 97) }
    }
    -join $a
}
$shell = $null
try { $shell = New-Object -ComObject WScript.Shell } catch {}
$lastRun = @{} # lower-case exe path -> epoch ms
foreach ($g in @(Get-ChildItem 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\UserAssist' -ErrorAction SilentlyContinue)) {
    try { $count = Get-Item (Join-Path $g.PSPath 'Count') } catch { continue }
    foreach ($n in $count.GetValueNames()) {
        $d = $count.GetValue($n)
        if (-not ($d -is [byte[]]) -or $d.Length -lt 68) { continue }
        $ft = [BitConverter]::ToInt64($d, 60)
        if ($ft -le 0) { continue }
        $path = Rot13 $n
        $m = [regex]::Match($path, '^(\{[0-9A-Fa-f-]{36}\})(.*)$')
        if ($m.Success -and $known[$m.Groups[1].Value.ToUpper()]) { $path = $known[$m.Groups[1].Value.ToUpper()] + $m.Groups[2].Value }
        if ($path -like '*.lnk' -and $shell) {
            try { $target = $shell.CreateShortcut($path).TargetPath; if ($target) { $path = $target } } catch {}
        }
        $when = [DateTimeOffset]::FromFileTime($ft).ToUnixTimeMilliseconds()
        $key = $path.ToLower()
        if (-not $lastRun[$key] -or $lastRun[$key] -lt $when) { $lastRun[$key] = $when }
    }
}
$now = EpochMs (Get-Date)
foreach ($p in @(Get-CimInstance Win32_Process -Property ExecutablePath)) {
    if ($p.ExecutablePath) { $lastRun[([string]$p.ExecutablePath).ToLower()] = $now }
}

# Command-line tools and services run without Explorer seeing them: an app with
# a folder in PATH or a service started from it counts as used.
$inUse = @()
foreach ($dir in ([Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')) -split ';') {
    if ($dir) { $inUse += [Environment]::ExpandEnvironmentVariables($dir).Trim('"').TrimEnd('\').ToLower() }
}
try {
    foreach ($s in @(Get-CimInstance Win32_Service -Property PathName)) {
        $m = [regex]::Match([string]$s.PathName, '^"?([^"]+?\.exe)')
        if ($m.Success) { $inUse += (Split-Path -Parent $m.Groups[1].Value).ToLower() }
    }
} catch {}

# --- installed apps -------------------------------------------------------------
$tooNew = (Get-Date).AddDays(-90)
$seen = @{}
$apps = @()
foreach ($root in 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
                  'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
                  'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*') {
    foreach ($a in @(Get-ItemProperty $root -ErrorAction SilentlyContinue)) {
        $name = [string]$a.DisplayName
        if (-not $name -or $a.SystemComponent -eq 1 -or $a.ParentKeyName -or $a.ReleaseType -or $seen[$name]) { continue }
        # Drivers, runtimes and the like are not apps anyone forgets about.
        if ($name -match 'Redistributable|Runtime|Driver|SDK|Update|Helper|Service') { continue }
        if ([string]$a.Publisher -match 'Microsoft|NVIDIA|Intel|Advanced Micro|AMD|Realtek') { continue }
        if ([double]$a.EstimatedSize -lt 50 * 1024) { continue } # under 50 MB: not worth a tip
        $dir = [string]$a.InstallLocation
        if (-not $dir -and $a.DisplayIcon) {
            $icon = ([string]$a.DisplayIcon -replace ',\s*-?\d+$', '').Trim('"')
            if ($icon -like '*.exe') { $dir = Split-Path -Parent $icon }
        }
        $dir = ([string]$dir).Trim('"').TrimEnd('\').ToLower()
        if (-not $dir -or $dir -like '*\package cache*' -or -not [IO.Directory]::Exists($dir)) { continue }
        # Installed lately: too early to call it unused.
        $installed = $null
        try { $installed = [datetime]::ParseExact([string]$a.InstallDate, 'yyyyMMdd', $null) } catch {}
        if (-not $installed) { try { $installed = [IO.Directory]::GetCreationTime($dir) } catch {} }
        if ($installed -and $installed -gt $tooNew) { continue }
        $last = $null
        foreach ($exe in $lastRun.Keys) {
            if ($exe.StartsWith($dir + '\') -and (-not $last -or $lastRun[$exe] -gt $last)) { $last = $lastRun[$exe] }
        }
        $isUsed = $false
        foreach ($u in $inUse) { if ($u -eq $dir -or $u.StartsWith($dir + '\')) { $isUsed = $true; break } }
        $seen[$name] = $true
        $apps += [ordered]@{ name = $name; lastRun = $last; isUsed = $isUsed }
    }
}

[ordered]@{
    rebootPending = $reboot
    bootAt        = $bootAt
    startup       = @($startup)
    apps          = @($apps)
} | ConvertTo-Json -Compress -Depth 4
