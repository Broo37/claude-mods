# Cuts a rectangle out of a picture and enlarges it pixel for pixel (no smoothing).
param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][string]$Out,
  [int]$X = 0, [int]$Y = 0, [int]$Width = 100, [int]$Height = 100, [int]$Scale = 3)

Add-Type -AssemblyName System.Drawing
$Source = [System.Drawing.Bitmap]::new($Path)
$Target = [System.Drawing.Bitmap]::new($Width * $Scale, $Height * $Scale)
$Graphics = [System.Drawing.Graphics]::FromImage($Target)
$Graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
$Graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
$Graphics.DrawImage($Source, [System.Drawing.Rectangle]::new(0, 0, $Width * $Scale, $Height * $Scale),
  [System.Drawing.Rectangle]::new($X, $Y, $Width, $Height), [System.Drawing.GraphicsUnit]::Pixel)
$Graphics.Dispose()
$Target.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
"$Out  $($Target.Width)x$($Target.Height)"
$Target.Dispose(); $Source.Dispose()
