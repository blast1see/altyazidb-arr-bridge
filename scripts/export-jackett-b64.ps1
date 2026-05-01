$root = Split-Path -Parent $PSScriptRoot
$src  = Join-Path $root "altyazidb-arr-bridge-chrome-0.1.1\assets\jackett-reference.png"
$dst  = Join-Path $PSScriptRoot "jackett-b64.txt"
$b64  = [Convert]::ToBase64String([IO.File]::ReadAllBytes($src))
[IO.File]::WriteAllText($dst, $b64)
Write-Host "Wrote $($b64.Length) chars to $dst"
