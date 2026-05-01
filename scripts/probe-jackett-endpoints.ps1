$ErrorActionPreference = "Stop"
$cfg = Get-Content -LiteralPath "C:\ProgramData\Jackett\ServerConfig.json" -Raw | ConvertFrom-Json
$key = $cfg.APIKey
$base = "http://localhost:9117"

# What we want: a JSON-returning endpoint that
#   1. Accepts ?apikey= query auth (no cookie required)
#   2. Returns 200 and a small, parseable payload on valid key
#   3. Returns 401/403 on invalid key (so Test Jackett can distinguish)
$tests = @(
    "/api/v2.0/indexers/all/results"                           # no query
    "/api/v2.0/indexers/all/results?_=ping"                    # stub param
    "/api/v2.0/server/Config"                                  # capital C
)
foreach ($e in $tests) {
    $sep = if ($e.Contains("?")) { "&" } else { "?" }
    $url = "$base$e${sep}apikey=$key"
    try {
        $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 10 -MaximumRedirection 0 -ErrorAction Stop
        Write-Host ("{0,-55} -> HTTP {1}  len={2}" -f $e, $r.StatusCode, $r.Content.Length)
    } catch {
        $code = $_.Exception.Response.StatusCode.value__
        Write-Host ("{0,-55} -> ERROR HTTP {1}" -f $e, $code)
    }
}

Write-Host ""
Write-Host "--- Now try with INVALID key (should NOT 200) ---"
$bad = "00000000000000000000000000000000"
foreach ($e in @("/api/v2.0/indexers/all/results")) {
    $url = "$base$e`?apikey=$bad"
    try {
        $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 10 -MaximumRedirection 0 -ErrorAction Stop
        Write-Host ("{0,-55} -> HTTP {1}  len={2} (unexpected success?)" -f $e, $r.StatusCode, $r.Content.Length)
    } catch {
        $code = $_.Exception.Response.StatusCode.value__
        Write-Host ("{0,-55} -> HTTP {1} (good)" -f $e, $code)
    }
}
