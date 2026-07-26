Param()
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$src = Join-Path $root "altyazidb-arr-bridge-chrome-0.1.1"
$dst = Join-Path $root "altyazidb-arr-bridge-firefox-0.1.1"
$srcPrefix = $src.TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar

foreach ($file in Get-ChildItem -LiteralPath $src -Recurse -File) {
  $relativePath = $file.FullName.Substring($srcPrefix.Length)

  if ($relativePath -eq "manifest.json") {
    continue
  }

  $target = Join-Path $dst $relativePath
  $targetDirectory = Split-Path -Parent $target
  New-Item -ItemType Directory -Path $targetDirectory -Force | Out-Null
  Copy-Item -LiteralPath $file.FullName -Destination $target -Force
}

Write-Host "Mirrored all non-manifest Chrome files into the Firefox folder."
