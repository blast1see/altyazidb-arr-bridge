$ErrorActionPreference = "Stop"
$cfg = Get-Content -LiteralPath "C:\ProgramData\Jackett\ServerConfig.json" -Raw | ConvertFrom-Json
$key = $cfg.APIKey
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
    $env:JACKETT_APIKEY = $key
    $env:JACKETT_BASE_URL = "http://127.0.0.1:9117"
    & node "scripts\manual-test-jackett.js"
} finally {
    Remove-Item Env:JACKETT_APIKEY -ErrorAction SilentlyContinue
    Remove-Item Env:JACKETT_BASE_URL -ErrorAction SilentlyContinue
    Pop-Location
}
