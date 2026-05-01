$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$chrome = Join-Path $root "altyazidb-arr-bridge-chrome-0.1.1\assets\jackett-reference.png"
$firefox = Join-Path $root "altyazidb-arr-bridge-firefox-0.1.1\assets\jackett-reference.png"
$src = Get-ChildItem "C:\Users\Mert\AppData\Roaming\Qoder\SharedClientCache\cache\images\b3258473\" -Filter "*13_51_37-Jackett*.png" | Select-Object -First 1
if (-not $src) { throw "Source Jackett silhouette PNG not found" }
Write-Host "Source : $($src.FullName)  ($($src.Length) bytes)"
Copy-Item -LiteralPath $src.FullName -Destination $chrome -Force
Copy-Item -LiteralPath $src.FullName -Destination $firefox -Force
Write-Host "Chrome : $chrome  ($((Get-Item $chrome).Length) bytes)"
Write-Host "Firefox: $firefox  ($((Get-Item $firefox).Length) bytes)"
# Re-emit base64 for Tampermonkey
$b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($chrome))
$dst = Join-Path $PSScriptRoot "jackett-b64.txt"
[IO.File]::WriteAllText($dst, $b64)
Write-Host "Base64 : $($b64.Length) chars -> $dst"
