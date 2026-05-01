# Requires: Admin PowerShell (Run as Administrator)
# Purpose : Map IPv6 [::1]:9117 -> IPv4 127.0.0.1:9117 so Firefox/Zen
#           (which resolves 'localhost' to ::1 first) can reach Jackett
#           without touching Jackett config or firewall rules.

$ErrorActionPreference = "Stop"

# Self-elevation check
$currentId = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($currentId)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "This script must be run as Administrator." -ForegroundColor Red
    Write-Host "Right-click PowerShell -> 'Run as Administrator', then run this script again." -ForegroundColor Yellow
    exit 1
}

Write-Host "=== Install v6tov4 port proxy for Jackett ===" -ForegroundColor Cyan
Write-Host ""

# Remove any stale rule on the same listen address/port
Write-Host "[1/3] Removing any existing rule on [::1]:9117" -ForegroundColor Yellow
netsh interface portproxy delete v6tov4 listenport=9117 listenaddress=::1 2>$null | Out-Null
Write-Host "  done"
Write-Host ""

# Add the new forwarding rule
Write-Host "[2/3] Adding new rule: [::1]:9117 -> 127.0.0.1:9117" -ForegroundColor Yellow
netsh interface portproxy add v6tov4 `
    listenport=9117 listenaddress=::1 `
    connectport=9117 connectaddress=127.0.0.1
Write-Host "  done"
Write-Host ""

# Show current portproxy rules
Write-Host "[3/3] Current portproxy rules" -ForegroundColor Yellow
netsh interface portproxy show all
Write-Host ""

# Verify the proxy actually works
Write-Host "=== Verification ===" -ForegroundColor Cyan
Start-Sleep -Milliseconds 500
foreach ($url in @("http://127.0.0.1:9117/", "http://localhost:9117/", "http://[::1]:9117/")) {
    try {
        $resp = Invoke-WebRequest -Uri $url -Method Get -MaximumRedirection 0 -TimeoutSec 3 -ErrorAction Stop
        Write-Host ("  {0,-28} -> HTTP {1}" -f $url, $resp.StatusCode) -ForegroundColor Green
    } catch [System.Net.WebException] {
        $sc = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { $null }
        if ($sc) {
            Write-Host ("  {0,-28} -> HTTP {1} (OK, redirect)" -f $url, $sc) -ForegroundColor Green
        } else {
            Write-Host ("  {0,-28} -> {1}" -f $url, $_.Exception.Message) -ForegroundColor Red
        }
    } catch {
        Write-Host ("  {0,-28} -> {1}" -f $url, $_.Exception.Message) -ForegroundColor Red
    }
}
Write-Host ""
Write-Host "If [::1]:9117 now returns HTTP 301, the proxy is active and Firefox/Zen" -ForegroundColor Cyan
Write-Host "will successfully reach Jackett via 'localhost'." -ForegroundColor Cyan
Write-Host ""
Write-Host "To REMOVE the proxy later, run (as Admin):" -ForegroundColor Yellow
Write-Host "  netsh interface portproxy delete v6tov4 listenport=9117 listenaddress=::1" -ForegroundColor Gray
