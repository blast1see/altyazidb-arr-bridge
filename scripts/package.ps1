$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$chromeDir = Join-Path $root "altyazidb-arr-bridge-chrome-0.1.1"
$firefoxDir = Join-Path $root "altyazidb-arr-bridge-firefox-0.1.1"
$tampermonkeyDir = Join-Path $root "tampermonkey"
$releaseRoot = Join-Path $root "release"
$releaseDir = Join-Path $releaseRoot "altyazidb-arr-bridge-complete-0.1.3"

$chromeZip = Join-Path $root "altyazidb-arr-bridge-chrome-0.1.3.zip"
$firefoxZip = Join-Path $root "altyazidb-arr-bridge-firefox-0.1.3.zip"
$firefoxXpi = Join-Path $root "altyazidb-arr-bridge-firefox-0.1.3.xpi"
$releaseZip = Join-Path $releaseRoot "altyazidb-arr-bridge-complete-0.1.3.zip"

foreach ($path in @($chromeDir, $firefoxDir, $tampermonkeyDir)) {
  if (-not (Test-Path -LiteralPath $path)) {
    throw "Missing required source path: $path"
  }
}

foreach ($file in @($chromeZip, $firefoxZip, $firefoxXpi, $releaseZip)) {
  if (Test-Path -LiteralPath $file) {
    Remove-Item -LiteralPath $file -Force
  }
}

Compress-Archive -Path (Join-Path $chromeDir "*") -DestinationPath $chromeZip -CompressionLevel Optimal
Compress-Archive -Path (Join-Path $firefoxDir "*") -DestinationPath $firefoxZip -CompressionLevel Optimal
Copy-Item -LiteralPath $firefoxZip -Destination $firefoxXpi -Force

New-Item -ItemType Directory -Path $releaseRoot -Force | Out-Null

$fullReleaseDir = [IO.Path]::GetFullPath($releaseDir)
$fullReleaseRoot = [IO.Path]::GetFullPath($releaseRoot)

if (-not $fullReleaseDir.StartsWith($fullReleaseRoot, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to remove unexpected path: $fullReleaseDir"
}

if (Test-Path -LiteralPath $releaseDir) {
  Remove-Item -LiteralPath $releaseDir -Recurse -Force
}

New-Item -ItemType Directory -Path $releaseDir | Out-Null
Copy-Item -LiteralPath $chromeDir -Destination $releaseDir -Recurse
Copy-Item -LiteralPath $firefoxDir -Destination $releaseDir -Recurse
Copy-Item -LiteralPath $tampermonkeyDir -Destination $releaseDir -Recurse
Copy-Item -LiteralPath $chromeZip, $firefoxZip, $firefoxXpi -Destination $releaseDir -Force
Copy-Item -LiteralPath (Join-Path $root "README.md"), (Join-Path $root "OPTIMIZATIONS.md") -Destination $releaseDir -Force

Compress-Archive -Path (Join-Path $releaseDir "*") -DestinationPath $releaseZip -CompressionLevel Optimal

Write-Host "Created:"
Write-Host "  $chromeZip"
Write-Host "  $firefoxZip"
Write-Host "  $firefoxXpi"
Write-Host "  $releaseZip"
