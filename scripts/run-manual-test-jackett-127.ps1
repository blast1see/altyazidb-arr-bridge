$ErrorActionPreference = "Stop"
$cfg = Get-Content -LiteralPath "C:\ProgramData\Jackett\ServerConfig.json" -Raw | ConvertFrom-Json
$key = $cfg.APIKey
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
    & node "scripts\manual-test-jackett.js" $key "http://127.0.0.1:9117"
} finally {
    Pop-Location
}
