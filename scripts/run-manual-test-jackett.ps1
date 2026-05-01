$ErrorActionPreference = "Stop"
$cfgPath = "C:\ProgramData\Jackett\ServerConfig.json"
$cfg = Get-Content -LiteralPath $cfgPath -Raw | ConvertFrom-Json
$key = $cfg.APIKey
if (-not $key) { throw "APIKey field missing in $cfgPath" }
$env:JACKETT_APIKEY = $key
Write-Host ("Loaded APIKey from ServerConfig.json (len=" + $key.Length + ")  [redacted]")
Write-Host ""
Write-Host "--- Running manual-test-jackett.js ---"
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
    & node "scripts\manual-test-jackett.js" $key
} finally {
    Pop-Location
}
