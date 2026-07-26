$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$package = Get-Content -LiteralPath (Join-Path $root "package.json") -Raw | ConvertFrom-Json
$version = $package.version
if (-not $version) { throw "package.json does not contain a version" }
$chromeDir = Join-Path $root "altyazidb-arr-bridge-chrome-0.1.1"
$firefoxDir = Join-Path $root "altyazidb-arr-bridge-firefox-0.1.1"
$tampermonkeyDir = Join-Path $root "tampermonkey"
$releaseRoot = Join-Path $root "release"
$releaseDir = Join-Path $releaseRoot "altyazidb-arr-bridge-complete-$version"

$chromeZip = Join-Path $root "altyazidb-arr-bridge-chrome-$version.zip"
$firefoxZip = Join-Path $root "altyazidb-arr-bridge-firefox-$version.zip"
$firefoxXpi = Join-Path $root "altyazidb-arr-bridge-firefox-$version.xpi"
$releaseZip = Join-Path $releaseRoot "altyazidb-arr-bridge-complete-$version.zip"
$extensionPackageEntries = @("assets", "src", "styles", "manifest.json", "options.html")

foreach ($path in @($chromeDir, $firefoxDir, $tampermonkeyDir)) {
  if (-not (Test-Path -LiteralPath $path)) {
    throw "Missing required source path: $path"
  }
}

function Get-ExtensionPackagePaths {
  param([Parameter(Mandatory)][string]$SourceDir)

  return $extensionPackageEntries | ForEach-Object {
    $path = Join-Path $SourceDir $_
    if (-not (Test-Path -LiteralPath $path)) {
      throw "Missing required extension package path: $path"
    }
    $path
  }
}

function Copy-ExtensionPackageSource {
  param(
    [Parameter(Mandatory)][string]$SourceDir,
    [Parameter(Mandatory)][string]$DestinationRoot
  )

  $destination = Join-Path $DestinationRoot (Split-Path -Leaf $SourceDir)
  New-Item -ItemType Directory -Path $destination | Out-Null

  foreach ($path in (Get-ExtensionPackagePaths -SourceDir $SourceDir)) {
    Copy-Item -LiteralPath $path -Destination $destination -Recurse
  }
}

foreach ($file in @($chromeZip, $firefoxZip, $firefoxXpi, $releaseZip)) {
  if (Test-Path -LiteralPath $file) {
    Remove-Item -LiteralPath $file -Force
  }
}

Compress-Archive -Path (Get-ExtensionPackagePaths -SourceDir $chromeDir) -DestinationPath $chromeZip -CompressionLevel Optimal
Compress-Archive -Path (Get-ExtensionPackagePaths -SourceDir $firefoxDir) -DestinationPath $firefoxZip -CompressionLevel Optimal
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
Copy-ExtensionPackageSource -SourceDir $chromeDir -DestinationRoot $releaseDir
Copy-ExtensionPackageSource -SourceDir $firefoxDir -DestinationRoot $releaseDir
Copy-Item -LiteralPath $tampermonkeyDir -Destination $releaseDir -Recurse
Copy-Item -LiteralPath $chromeZip, $firefoxZip, $firefoxXpi -Destination $releaseDir -Force
Copy-Item -LiteralPath (Join-Path $root "README.md"), (Join-Path $root "CHANGELOG.md"), (Join-Path $root "OPTIMIZATIONS.md") -Destination $releaseDir -Force

Compress-Archive -Path (Join-Path $releaseDir "*") -DestinationPath $releaseZip -CompressionLevel Optimal

Write-Host "Created:"
Write-Host "  $chromeZip"
Write-Host "  $firefoxZip"
Write-Host "  $firefoxXpi"
Write-Host "  $releaseZip"
