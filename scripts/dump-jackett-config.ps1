$ErrorActionPreference = "Stop"
$cfg = Get-Content "C:\ProgramData\Jackett\ServerConfig.json" -Raw | ConvertFrom-Json
Write-Host "=== All Jackett ServerConfig.json fields ===" -ForegroundColor Cyan
$cfg.PSObject.Properties | ForEach-Object {
    $val = if ($_.Name -eq "APIKey") { "[REDACTED]" } else { $_.Value }
    Write-Host ("  {0,-28} = {1}" -f $_.Name, $val)
}
