# Enables AllowCORS=true in Jackett ServerConfig.json so browser extensions
# can read responses. Closes Jackett tray, patches JSON, restarts Jackett.

$ErrorActionPreference = "Stop"

$cfgPath = "C:\ProgramData\Jackett\ServerConfig.json"

Write-Host "=== Enable Jackett AllowCORS ===" -ForegroundColor Cyan
Write-Host ""

# [1] Find Jackett process
$proc = Get-Process -Name "JackettConsole", "JackettService", "jackett" -ErrorAction SilentlyContinue
if ($proc) {
    Write-Host ("[1/4] Found Jackett process(es): {0}" -f ($proc | ForEach-Object { "$($_.ProcessName) PID=$($_.Id)" }) ) -ForegroundColor Yellow
    $exePath = $proc[0].Path
    Write-Host ("      exe path: {0}" -f $exePath)
} else {
    Write-Host "[1/4] Jackett not running (will just patch config)" -ForegroundColor Yellow
    $exePath = $null
}
Write-Host ""

# [2] Backup config
Write-Host "[2/4] Backing up config" -ForegroundColor Yellow
$backup = "$cfgPath.backup-" + (Get-Date -Format "yyyyMMdd-HHmmss")
Copy-Item $cfgPath $backup -Force
Write-Host ("      backup: {0}" -f $backup)
Write-Host ""

# [3] Stop Jackett (if running)
if ($proc) {
    Write-Host "[3/4] Stopping Jackett" -ForegroundColor Yellow
    $proc | Stop-Process -Force
    Start-Sleep -Seconds 2
    Write-Host "      stopped"
} else {
    Write-Host "[3/4] Skipped (Jackett was not running)" -ForegroundColor Yellow
}
Write-Host ""

# [4] Patch config + restart
Write-Host "[4/4] Patching AllowCORS=true" -ForegroundColor Yellow
$cfg = Get-Content $cfgPath -Raw | ConvertFrom-Json
$cfg.AllowCORS = $true
$cfg | ConvertTo-Json -Depth 10 | Set-Content $cfgPath -Encoding UTF8
Write-Host ("      new value: AllowCORS = {0}" -f (Get-Content $cfgPath -Raw | ConvertFrom-Json).AllowCORS)
Write-Host ""

# [5] Restart Jackett if we had a path
if ($exePath -and (Test-Path $exePath)) {
    Write-Host "[5/5] Restarting Jackett" -ForegroundColor Yellow
    Start-Process -FilePath $exePath -WorkingDirectory (Split-Path $exePath -Parent)
    Start-Sleep -Seconds 3
    Write-Host "      started, giving it 3s to boot"
} else {
    Write-Host "[5/5] Please start Jackett manually (tray icon)" -ForegroundColor Yellow
}
Write-Host ""

# [6] Verify CORS header is now present
Write-Host "=== Verification ===" -ForegroundColor Cyan
Start-Sleep -Seconds 2
try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:9117/api/v2.0/indexers/all/results?apikey=TEST&Query=__adb_ping__" `
        -Method Get -Headers @{ "Origin" = "moz-extension://test" } `
        -MaximumRedirection 0 -TimeoutSec 5 -SkipHttpErrorCheck
    Write-Host ("  Status       : HTTP {0}" -f $r.StatusCode)
    if ($r.Headers["Access-Control-Allow-Origin"]) {
        Write-Host ("  ACAO header  : {0}" -f $r.Headers["Access-Control-Allow-Origin"]) -ForegroundColor Green
        Write-Host "  CORS is now enabled — extension should work." -ForegroundColor Green
    } else {
        Write-Host "  ACAO header  : MISSING" -ForegroundColor Red
        Write-Host "  Jackett may not have reloaded yet. Wait a few more seconds and retry." -ForegroundColor Yellow
    }
} catch {
    Write-Host ("  Probe failed: {0}" -f $_.Exception.Message) -ForegroundColor Red
    Write-Host "  If Jackett is not yet up, wait and try http://127.0.0.1:9117 in a browser." -ForegroundColor Yellow
}
