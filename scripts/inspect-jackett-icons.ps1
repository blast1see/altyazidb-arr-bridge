$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$chrome = Join-Path $root "altyazidb-arr-bridge-chrome-0.1.1\assets\jackett-reference.png"
$firefox = Join-Path $root "altyazidb-arr-bridge-firefox-0.1.1\assets\jackett-reference.png"
$imgA = "C:\Users\Mert\AppData\Roaming\Qoder\SharedClientCache\cache\images\b3258473\2026-05-01 09_05_39-Jackett -- Zen Browser-567a0cc6.png"
$imgB = "C:\Users\Mert\AppData\Roaming\Qoder\SharedClientCache\cache\images\b3258473\2026-05-01 13_51_37-Jackett -- Zen Browser-63d2dc5a.png"
# Fallback: find any jackett image (the em-dash may differ)
$imgs = Get-ChildItem "C:\Users\Mert\AppData\Roaming\Qoder\SharedClientCache\cache\images\b3258473\" -Filter "*Jackett*.png" | Sort-Object LastWriteTime
foreach ($f in @($chrome, $firefox) + $imgs.FullName) {
    if (Test-Path -LiteralPath $f) {
        $h = (Get-FileHash -LiteralPath $f -Algorithm SHA256).Hash
        $sz = (Get-Item -LiteralPath $f).Length
        Write-Host ("{0,12} bytes  {1}  {2}" -f $sz, $h.Substring(0,16), $f)
    } else {
        Write-Host "MISSING $f"
    }
}
