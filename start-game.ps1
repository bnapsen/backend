Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$serverScript = Join-Path $projectRoot "server.ps1"
$url = "http://localhost:8080"

Start-Process powershell -ArgumentList @(
    "-NoExit"
    "-ExecutionPolicy", "Bypass"
    "-File", "`"$serverScript`""
) -WorkingDirectory $projectRoot

$isReady = $false
for ($attempt = 0; $attempt -lt 20; $attempt += 1) {
    Start-Sleep -Milliseconds 500
    try {
        Invoke-WebRequest -UseBasicParsing -Uri "$url/api/health" -TimeoutSec 2 | Out-Null
        $isReady = $true
        break
    }
    catch {
    }
}

if ($isReady) {
    Start-Process $url
}
else {
    Write-Host "The server window opened, but the game did not start listening on $url." -ForegroundColor Yellow
    Write-Host "Check the server PowerShell window for an error message." -ForegroundColor Yellow
}
