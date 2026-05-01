# Generate a simple Jackett reference icon (64x64 PNG) — dark navy background
# with a stylised white "J" letterform, evoking the Jackett jacket logo.
# The user can replace this with the official Jackett art anytime.

Add-Type -AssemblyName System.Drawing

$size = 64
$bmp  = New-Object System.Drawing.Bitmap $size, $size
$gfx  = [System.Drawing.Graphics]::FromImage($bmp)
$gfx.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$gfx.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

# Rounded-rect background in Jackett brand navy.
$rect = New-Object System.Drawing.Rectangle 2, 2, ($size - 4), ($size - 4)
$bgBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 30, 58, 95))
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$r = 14
$path.AddArc($rect.X, $rect.Y, $r, $r, 180, 90)
$path.AddArc($rect.Right - $r, $rect.Y, $r, $r, 270, 90)
$path.AddArc($rect.Right - $r, $rect.Bottom - $r, $r, $r, 0, 90)
$path.AddArc($rect.X, $rect.Bottom - $r, $r, $r, 90, 90)
$path.CloseAllFigures()
$gfx.FillPath($bgBrush, $path)

# Thin accent border.
$borderPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 74, 144, 226)), 2
$gfx.DrawPath($borderPen, $path)

# Centered "J" glyph in white.
$font = New-Object System.Drawing.Font ("Segoe UI", 38, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$txt  = "J"
$sz   = $gfx.MeasureString($txt, $font)
$x    = ($size - $sz.Width)  / 2
$y    = ($size - $sz.Height) / 2 - 2
$gfx.DrawString($txt, $font, [System.Drawing.Brushes]::White, $x, $y)

$gfx.Dispose()

$target = Join-Path $PSScriptRoot "..\altyazidb-arr-bridge-chrome-0.1.1\assets\jackett-reference.png"
$resolved = [System.IO.Path]::GetFullPath($target)
$bmp.Save($resolved, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()

Write-Host "Wrote $resolved"
