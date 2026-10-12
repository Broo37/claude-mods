# Starts a real Claude Code session in a new Windows Terminal window drawn with the user's
# own profile, photographs that one window a number of times while the band appears, and
# closes it. No prompt is sent, so no model turn runs. What is photographed went through
# Claude Code's own drawing, which a script that prints colors itself does not show.
param(
  [string]$OutDir = (Join-Path $env:TEMP 'status-band-live'),
  [string]$Profile = 'Posh',
  [string]$Cwd = 'C:\Users\admin\.config\yasb',
  [int]$Columns = 150, [int]$Rows = 24,
  [int]$FirstMs = 1500, [int]$EveryMs = 90, [int]$Frames = 60,
  [string[]]$ClaudeArgs = @(),   # more arguments for the session, e.g. '--plugin-dir', '<folder>'
  [string[]]$ModeArgs = @('--dangerously-skip-permissions'),   # how the session decides permissions
  [switch]$All   # keep every frame, not only those unlike all before: a two-state animation repeats
)

Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;

public static class LiveWindow {
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

[void][LiveWindow]::SetProcessDPIAware()
[void](New-Item -ItemType Directory -Force $OutDir)
Get-ChildItem $OutDir -Filter 'frame-*.png' | ForEach-Object { [System.IO.File]::Delete($_.FullName) }
$Log = Join-Path $OutDir 'debug.log'
if (Test-Path $Log) { [System.IO.File]::Delete($Log) }

# The new window inherits this shell's environment. A tool shell sets NO_COLOR, which
# would draw the whole session without color and say nothing about the band's.
$env:NO_COLOR = $null

$Title = "status-band-live-$PID"
$Arguments = @('--size', "$Columns,$Rows", '-w', 'new', 'nt', '-p', "`"$Profile`"", '--title', $Title,
  '--suppressApplicationTitle', '-d', "`"$Cwd`"", 'claude', '--debug-file', "`"$Log`"") + $ModeArgs + $ClaudeArgs
Start-Process -FilePath 'wt.exe' -ArgumentList $Arguments

$Window = [IntPtr]::Zero
for ($Try = 0; $Try -lt 60 -and $Window -eq [IntPtr]::Zero; $Try++) {
  Start-Sleep -Milliseconds 100
  $Window = [LiveWindow]::Find($Title)
}
if ($Window -eq [IntPtr]::Zero) { 'the session window did not appear'; return }

Start-Sleep -Milliseconds $FirstMs
$Rect = New-Object LiveWindow+RECT
[void][LiveWindow]::GetWindowRect($Window, [ref]$Rect)
$Seen = @{}
for ($Frame = 0; $Frame -lt $Frames; $Frame++) {
  $Bitmap = [System.Drawing.Bitmap]::new($Rect.Right - $Rect.Left, $Rect.Bottom - $Rect.Top)
  $Graphics = [System.Drawing.Graphics]::FromImage($Bitmap)
  $Hdc = $Graphics.GetHdc()
  [void][LiveWindow]::PrintWindow($Window, $Hdc, 2)
  $Graphics.ReleaseHdc($Hdc)
  $Graphics.Dispose()
  $Stream = [System.IO.MemoryStream]::new()
  $Bitmap.Save($Stream, [System.Drawing.Imaging.ImageFormat]::Png)
  $Bitmap.Dispose()
  $Bytes = $Stream.ToArray()
  $Hash = [System.BitConverter]::ToString([System.Security.Cryptography.SHA1]::HashData($Bytes))
  # Only a frame that differs from every one before it is kept.
  if ($All -or -not $Seen.ContainsKey($Hash)) {
    $Seen[$Hash] = $Frame
    [System.IO.File]::WriteAllBytes((Join-Path $OutDir ('frame-{0:d2}.png' -f $Frame)), $Bytes)
  }
  Start-Sleep -Milliseconds $EveryMs
}

# WM_CLOSE: the window closes and the session ends with it.
[void][LiveWindow]::PostMessage($Window, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
"kept $($Seen.Count) distinct frames of $Frames in $OutDir : " + ((Get-ChildItem $OutDir -Filter 'frame-*.png' | ForEach-Object { $_.Name }) -join ' ')
if (Test-Path $Log) {
  '--- what the session logged about the band'
  Select-String -Path $Log -Pattern 'refused|threw while drawn|nothing was drawn|does not validate|status-band.*(failed|error)|answered ui.render' |
    Select-Object -First 8 | ForEach-Object { $_.Line.Substring(0, [Math]::Min(300, $_.Line.Length)) }
}
