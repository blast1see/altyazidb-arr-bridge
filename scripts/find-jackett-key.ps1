$ErrorActionPreference = "SilentlyContinue"
if ($env:JACKETT_APIKEY) {
    Write-Host ("JACKETT_APIKEY env var set (len=" + $env:JACKETT_APIKEY.Length + ")")
} else {
    Write-Host "JACKETT_APIKEY env var NOT set"
}
$candidates = @(
    "$env:ProgramData\Jackett\ServerConfig.json",
    "$env:APPDATA\Jackett\ServerConfig.json",
    "$env:LOCALAPPDATA\Jackett\ServerConfig.json",
    "C:\Tools\Jackett\ServerConfig.json",
    "C:\Jackett\ServerConfig.json"
)
foreach ($p in $candidates) {
    if ($p -and (Test-Path -LiteralPath $p)) {
        Write-Host ("FOUND: $p  ($((Get-Item -LiteralPath $p).Length) bytes)")
    }
}
Write-Host "(If none listed, pass the key on the command line.)"
