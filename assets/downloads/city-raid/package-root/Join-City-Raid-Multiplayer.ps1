$ErrorActionPreference = 'Stop'

param(
    [string]$RoomCode = ''
)

function Invoke-CityRaidJson {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Uri
    )

    return Invoke-RestMethod -Uri $Uri -Method Get -Headers @{
        Accept = 'application/json'
    }
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$gameExe = Join-Path $scriptDir 'FIRSTPERSON.exe'
$apiBase = 'https://backend-ujaa.onrender.com'

if (-not (Test-Path -LiteralPath $gameExe)) {
    throw 'Could not find FIRSTPERSON.exe beside the join helper.'
}

if ([string]::IsNullOrWhiteSpace($RoomCode)) {
    $RoomCode = Read-Host 'Enter the City Raid room code'
}

$RoomCode = [string]$RoomCode
$RoomCode = $RoomCode.Trim().ToUpper().Replace(' ', '')
if ([string]::IsNullOrWhiteSpace($RoomCode)) {
    throw 'A room code is required.'
}

$resolved = Invoke-CityRaidJson -Uri "$apiBase/api/cityraid/lobbies/resolve?roomCode=$([uri]::EscapeDataString($RoomCode))"
$joinAddress = [string]$resolved.joinAddress
if ([string]::IsNullOrWhiteSpace($joinAddress)) {
    throw 'That room did not include a join address.'
}

Write-Host ''
Write-Host "Joining room $RoomCode" -ForegroundColor Cyan
Write-Host "Address: $joinAddress" -ForegroundColor Yellow
Write-Host ''

Start-Process -FilePath $gameExe -WorkingDirectory $scriptDir -ArgumentList @($joinAddress)
