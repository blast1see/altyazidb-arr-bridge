$ErrorActionPreference = "Stop"
$cfgPath = "C:\ProgramData\Jackett\ServerConfig.json"
$cfg = Get-Content -LiteralPath $cfgPath -Raw | ConvertFrom-Json
$key = $cfg.APIKey
if (-not $key) { throw "APIKey field missing in $cfgPath" }
Write-Host ("Loaded APIKey from ServerConfig.json (len=" + $key.Length + ")  [redacted]")
Write-Host ""
Write-Host "--- Running manual-test-jackett.js ---"
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
    $env:JACKETT_APIKEY = $key
    & node "scripts\manual-test-jackett.js"
} finally {
    Remove-Item Env:JACKETT_APIKEY -ErrorAction SilentlyContinue
    Pop-Location
}
