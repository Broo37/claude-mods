# clawd-mods: which projects used this account's limits this week, estimated
# from the session logs on this PC. Read-only, no network.
#
#   -ProjectsDir  <config dir>\projects (one .jsonl log per session)
#   -Since        epoch ms; only replies newer than this count
#
# Every log written since then is read a line at a time (logs run to tens of
# MB; nothing is read whole). An assistant line carries the folder the session
# ran in, the model and the tokens; a reply spans several lines with the same
# message id, counted once. Tokens are weighted by a relative price: input 1,
# output 5, cache read 0.1, cache write 1.25, times the model family's price.
# Prints one line of JSON: { "projects": [{ "cwd", "weight" }] }.
param(
    [Parameter(Mandatory)][string]$ProjectsDir,
    [Parameter(Mandatory)][long]$Since
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$sinceIso = [DateTimeOffset]::FromUnixTimeMilliseconds($Since).UtcDateTime.ToString('yyyy-MM-ddTHH:mm:ss')
$sinceTime = [DateTimeOffset]::FromUnixTimeMilliseconds($Since).LocalDateTime
$family = @{ fable = 5.0; opus = 5.0; sonnet = 3.0; haiku = 1.0 }

function Field([string]$line, [string]$name) {
    $key = '"' + $name + '":"'
    $at = $line.IndexOf($key)
    if ($at -lt 0) { return $null }
    $from = $at + $key.Length
    $to = $line.IndexOf('"', $from)
    if ($to -lt 0) { return $null }
    $line.Substring($from, $to - $from)
}

function Count([string]$usage, [string]$name) {
    $m = [regex]::Match($usage, '"' + $name + '":(\d+)')
    if ($m.Success) { [double]$m.Groups[1].Value } else { 0.0 }
}

$weights = @{}
$seen = New-Object 'System.Collections.Generic.HashSet[string]'
$files = Get-ChildItem -LiteralPath $ProjectsDir -Recurse -Filter *.jsonl -File -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -gt $sinceTime }
foreach ($file in $files) {
    $reader = $null
    try {
        $reader = New-Object System.IO.StreamReader($file.FullName, [Text.Encoding]::UTF8)
        while ($null -ne ($line = $reader.ReadLine())) {
            if ($line.IndexOf('"type":"assistant"') -lt 0) { continue }
            $at = $line.IndexOf('"usage":{')
            if ($at -lt 0) { continue }
            $stamp = Field $line 'timestamp'
            if (-not $stamp -or [string]::CompareOrdinal($stamp, $sinceIso) -lt 0) { continue }
            $id = Field ($line.Substring($line.IndexOf('"message":{') + 1)) 'id'
            if ($id -and -not $seen.Add($id)) { continue }
            $cwd = (Field $line 'cwd') -replace '\\\\', '\'
            if (-not $cwd) { continue }
            $model = [string](Field $line 'model')
            $price = 3.0
            foreach ($name in $family.Keys) { if ($model.Contains($name)) { $price = $family[$name] } }
            $end = $line.IndexOf('}', $at)
            $usage = $line.Substring($at, [Math]::Max(0, $end - $at))
            $weight = $price * ((Count $usage 'input_tokens') + 5 * (Count $usage 'output_tokens') +
                0.1 * (Count $usage 'cache_read_input_tokens') + 1.25 * (Count $usage 'cache_creation_input_tokens'))
            $weights[$cwd] = [double]$weights[$cwd] + $weight
        }
    } catch {
        # A log that is being written or locked: its share is left out this time.
    } finally {
        if ($reader) { $reader.Dispose() }
    }
}

# A session that moved into a subfolder (a project's hooks folder) counts for
# its project: the nearest folder up that looks like one (a git repository, a
# mod, a Node or .NET project), never the home folder or a drive above it.
$userHome = [Environment]::GetFolderPath('UserProfile').TrimEnd('\').ToLower()
$roots = @{}
function RootOf([string]$cwd) {
    if ($roots.ContainsKey($cwd)) { return $roots[$cwd] }
    $dir = $cwd.TrimEnd('\')
    $root = $cwd
    while ($dir -and $dir.ToLower() -ne $userHome -and $dir.Length -gt 3) {
        $isProject = (Test-Path -LiteralPath "$dir\.git") -or (Test-Path -LiteralPath "$dir\.claude-plugin") -or
            (Test-Path -LiteralPath "$dir\package.json") -or
            @(Get-ChildItem -LiteralPath $dir -File -Filter *.sln -ErrorAction SilentlyContinue).Count -gt 0 -or
            @(Get-ChildItem -LiteralPath $dir -File -Filter *.csproj -ErrorAction SilentlyContinue).Count -gt 0
        if ($isProject) { $root = $dir; break }
        $dir = Split-Path -Parent $dir
    }
    $roots[$cwd] = $root
    $root
}
$byRoot = @{}
foreach ($cwd in @($weights.Keys)) {
    $root = RootOf $cwd
    $byRoot[$root] = [double]$byRoot[$root] + $weights[$cwd]
}

$projects = @($byRoot.GetEnumerator() | Sort-Object Value -Descending | ForEach-Object {
    [ordered]@{ cwd = $_.Key; weight = [math]::Round($_.Value) }
})
@{ projects = $projects } | ConvertTo-Json -Compress -Depth 3
