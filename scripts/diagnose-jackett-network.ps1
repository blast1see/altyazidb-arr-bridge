$ErrorActionPreference = "Continue"

Write-Host "=== Jackett Network Diagnostic ===" -ForegroundColor Cyan
Write-Host ""

# 1) What is listening on port 9117?
Write-Host "[1/5] Listeners on port 9117" -ForegroundColor Yellow
$listeners = Get-NetTCPConnection -LocalPort 9117 -State Listen -ErrorAction SilentlyContinue
if ($listeners) {
    $listeners | ForEach-Object {
        $pidVal = $_.OwningProcess
        $proc = Get-Process -Id $pidVal -ErrorAction SilentlyContinue
        $procName = if ($proc) { $proc.ProcessName } else { "?" }
        Write-Host ("  LocalAddress={0,-30} PID={1,-6} Process={2}" -f $_.LocalAddress, $pidVal, $procName)
    }
} else {
    Write-Host "  (nothing listening on 9117)" -ForegroundColor Red
}
Write-Host ""

# 2) Jackett BindAddress from ServerConfig
Write-Host "[2/5] Jackett BindAddress config" -ForegroundColor Yellow
$cfgPath = "C:\ProgramData\Jackett\ServerConfig.json"
if (Test-Path $cfgPath) {
    $cfg = Get-Content -LiteralPath $cfgPath -Raw | ConvertFrom-Json
    Write-Host ("  BindAddress : {0}" -f $cfg.BindAddress)
    Write-Host ("  Port        : {0}" -f $cfg.Port)
    Write-Host ("  BasePathOverride: '{0}'" -f $cfg.BasePathOverride)
    Write-Host ("  AllowExternal   : {0}" -f $cfg.AllowExternal)
} else {
    Write-Host "  ServerConfig.json not found at $cfgPath" -ForegroundColor Red
}
Write-Host ""

# 3) TCP reachability on IPv4 + IPv6
Write-Host "[3/5] TCP reachability probe" -ForegroundColor Yellow
foreach ($target in @("127.0.0.1", "::1", "localhost")) {
    $r = Test-NetConnection -ComputerName $target -Port 9117 -WarningAction SilentlyContinue -InformationLevel Quiet
    $color = if ($r) { "Green" } else { "Red" }
    Write-Host ("  {0,-12} -> {1}" -f $target, $(if ($r) { "REACHABLE" } else { "FAIL" })) -ForegroundColor $color
}
Write-Host ""

# 4) HTTP HEAD on each address form
Write-Host "[4/5] HTTP probe" -ForegroundColor Yellow
foreach ($url in @("http://127.0.0.1:9117/", "http://localhost:9117/", "http://[::1]:9117/")) {
    try {
        $resp = Invoke-WebRequest -Uri $url -Method Get -MaximumRedirection 0 -TimeoutSec 3 -ErrorAction Stop
        Write-Host ("  {0,-28} -> HTTP {1}" -f $url, $resp.StatusCode) -ForegroundColor Green
    } catch [System.Net.WebException] {
        $sc = $null
        if ($_.Exception.Response) { $sc = [int]$_.Exception.Response.StatusCode }
        if ($sc) {
            Write-Host ("  {0,-28} -> HTTP {1} (redirect/error)" -f $url, $sc) -ForegroundColor Yellow
        } else {
            Write-Host ("  {0,-28} -> {1}" -f $url, $_.Exception.Message) -ForegroundColor Red
        }
    } catch {
        Write-Host ("  {0,-28} -> {1}" -f $url, $_.Exception.Message) -ForegroundColor Red
    }
}
Write-Host ""

# 5) DNS: how does Windows resolve 'localhost'?
Write-Host "[5/5] DNS resolution for 'localhost'" -ForegroundColor Yellow
try {
    $addrs = [System.Net.Dns]::GetHostAddresses("localhost")
    foreach ($a in $addrs) {
        Write-Host ("  localhost -> {0} ({1})" -f $a.IPAddressToString, $a.AddressFamily)
    }
} catch {
    Write-Host "  DNS resolution failed: $($_.Exception.Message)" -ForegroundColor Red
}
Write-Host ""

Write-Host "=== Diagnostic complete ===" -ForegroundColor Cyan
