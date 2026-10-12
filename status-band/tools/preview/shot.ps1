# Opens preview.mjs in a new Windows Terminal window drawn with the user's own profile,
# photographs that one window, and lets it close by itself. Nothing else on screen is captured.
param(
  [string]$Variants = '',
  [string]$Out = (Join-Path $env:TEMP 'status-band-preview.png'),
  [string]$Profile = 'Posh',
  [int]$Columns = 100, [int]$Rows = 44, [int]$Stay = 7, [string]$Script = 'preview.mjs'
)

Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;

public static class LabWindow {
  public delegate bool EnumProc(IntPtr window, IntPtr state);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }

  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr state);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr window, StringBuilder text, int max);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window, out RECT rect);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr window, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();

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

[void][LabWindow]::SetProcessDPIAware()
$Title = "status-band-preview-$PID"
$Lab = Join-Path $PSScriptRoot $Script
$Arguments = @('--size', "$Columns,$Rows", '-w', 'new', 'nt', '-p', "`"$Profile`"", '--title', $Title,
  '--suppressApplicationTitle', 'node', '--no-warnings', "`"$Lab`"", "$Stay") + $(if ($Variants -ne '') { @($Variants) } else { @() })
Start-Process -FilePath 'wt.exe' -ArgumentList $Arguments

$Window = [IntPtr]::Zero
for ($Try = 0; $Try -lt 40 -and $Window -eq [IntPtr]::Zero; $Try++) {
  Start-Sleep -Milliseconds 150
  $Window = [LabWindow]::Find($Title)
}
if ($Window -eq [IntPtr]::Zero) { 'the preview window did not appear'; return }

# Give the terminal a moment to draw the text before the picture is taken.
Start-Sleep -Milliseconds 1800
$Rect = New-Object LabWindow+RECT
[void][LabWindow]::GetWindowRect($Window, [ref]$Rect)
$Bitmap = [System.Drawing.Bitmap]::new($Rect.Right - $Rect.Left, $Rect.Bottom - $Rect.Top)
$Graphics = [System.Drawing.Graphics]::FromImage($Bitmap)
$Hdc = $Graphics.GetHdc()
$Printed = [LabWindow]::PrintWindow($Window, $Hdc, 2)
$Graphics.ReleaseHdc($Hdc)
$Graphics.Dispose()
$Bitmap.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
"printed=$Printed  $($Bitmap.Width)x$($Bitmap.Height)  $Out"
$Bitmap.Dispose()
