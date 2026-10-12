# Starts a real Claude Code session in a new Windows Terminal window, types a text into
# its prompt (never sent: no Enter), photographs the window while it is typed, and closes it.
param(
  [string]$OutDir,
  [string]$Text,
  [string]$Profile = 'Posh',
  [string]$Cwd = 'C:\Users\admin\.config\yasb',
  [int]$Columns = 150, [int]$Rows = 40,
  [int]$ReadyMs = 5000, [int]$DelayMs = 40, [int]$EveryMs = 350, [int]$Frames = 14,
  [string[]]$ClaudeArgs = @()
)

Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;

public static class TypeWindow {
  public delegate bool EnumProc(IntPtr window, IntPtr state);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }

  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr state);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr window, StringBuilder text, int max);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window, out RECT rect);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr window, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr window, uint message, IntPtr w, IntPtr l);

  public static IntPtr Find(string title) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((window, state) => {
      var text = new StringBuilder(512);
      GetWindowText(window, text, 512);
      if (IsWindowVisible(window) && text.ToString() == title) { found = window; return false; }
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
'@

[void][TypeWindow]::SetProcessDPIAware()
[void](New-Item -ItemType Directory -Force $OutDir)
Get-ChildItem $OutDir -Filter 'frame-*.png' | ForEach-Object { [System.IO.File]::Delete($_.FullName) }
$Log = Join-Path $OutDir 'debug.log'
if (Test-Path $Log) { [System.IO.File]::Delete($Log) }
$env:NO_COLOR = $null

$Title = "type-live-$PID"
$Arguments = @('--size', "$Columns,$Rows", '-w', 'new', 'nt', '-p', "`"$Profile`"", '--title', $Title,
  '--suppressApplicationTitle', '-d', "`"$Cwd`"", 'claude', '--debug-file', "`"$Log`"", '--dangerously-skip-permissions') + $ClaudeArgs
Start-Process -FilePath 'wt.exe' -ArgumentList $Arguments

$Window = [IntPtr]::Zero
for ($Try = 0; $Try -lt 60 -and $Window -eq [IntPtr]::Zero; $Try++) {
  Start-Sleep -Milliseconds 100
  $Window = [TypeWindow]::Find($Title)
}
if ($Window -eq [IntPtr]::Zero) { 'the session window did not appear'; return }

Start-Sleep -Milliseconds $ReadyMs
# The one session to type into is the one that logs to this run's own file.
$Session = Get-CimInstance Win32_Process -Filter "Name = 'claude.exe'" |
  Where-Object { $_.CommandLine -like "*$Log*" } | Select-Object -First 1
if ($null -eq $Session) {
  'the session process was not found; nothing was typed'
} else {
  $Typer = Join-Path $PSScriptRoot 'typer.ps1'
  Start-Process -FilePath 'pwsh' -WindowStyle Hidden -ArgumentList @('-NoProfile', '-File', "`"$Typer`"",
    '-TargetPid', $Session.ProcessId, '-Text', "`"$Text`"", '-DelayMs', $DelayMs) -RedirectStandardOutput (Join-Path $OutDir 'typer.txt')
}

$Rect = New-Object TypeWindow+RECT
[void][TypeWindow]::GetWindowRect($Window, [ref]$Rect)
for ($Frame = 0; $Frame -lt $Frames; $Frame++) {
  Start-Sleep -Milliseconds $EveryMs
  $Bitmap = [System.Drawing.Bitmap]::new($Rect.Right - $Rect.Left, $Rect.Bottom - $Rect.Top)
  $Graphics = [System.Drawing.Graphics]::FromImage($Bitmap)
  $Hdc = $Graphics.GetHdc()
  [void][TypeWindow]::PrintWindow($Window, $Hdc, 2)
  $Graphics.ReleaseHdc($Hdc)
  $Graphics.Dispose()
  $Bitmap.Save((Join-Path $OutDir ('frame-{0:d2}.png' -f $Frame)), [System.Drawing.Imaging.ImageFormat]::Png)
  $Bitmap.Dispose()
}

[void][TypeWindow]::PostMessage($Window, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
"session pid $($Session.ProcessId); typer said: $(Get-Content (Join-Path $OutDir 'typer.txt') -ErrorAction SilentlyContinue)"
