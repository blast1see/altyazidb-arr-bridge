Param()
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$src  = Join-Path $root "altyazidb-arr-bridge-chrome-0.1.1"
$dst  = Join-Path $root "altyazidb-arr-bridge-firefox-0.1.1"

Copy-Item -Force -Recurse -Path (Join-Path $src "src\*")    -Destination (Join-Path $dst "src\")
Copy-Item -Force -Recurse -Path (Join-Path $src "styles\*") -Destination (Join-Path $dst "styles\")
Copy-Item -Force          -Path (Join-Path $src "assets\jackett-reference.png") -Destination (Join-Path $dst "assets\")
Copy-Item -Force          -Path (Join-Path $src "options.html") -Destination $dst

Write-Host "Mirrored Chrome sources into Firefox folder."
