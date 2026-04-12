$ErrorActionPreference = 'Stop'

param(
    [int]$Port = 7777
)

function Invoke-CityRaidJson {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Uri,
        [ValidateSet('Get', 'Post')]
        [string]$Method = 'Get',
        [object]$Body
    )

    $headers = @{
        Accept = 'application/json'
    }

    if ($Method -eq 'Post') {
        return Invoke-RestMethod -Uri $Uri -Method Post -Headers $headers -ContentType 'application/json' -Body ($Body | ConvertTo-Json -Depth 6)
    }

    return Invoke-RestMethod -Uri $Uri -Method Get -Headers $headers
}

function Resolve-PublicIp {
    $services = @(
        'https://api.ipify.org?format=json',
        'https://ifconfig.me/all.json'
    )

    foreach ($service in $services) {
        try {
            $response = Invoke-RestMethod -Uri $service -Method Get
            foreach ($property in 'ip', 'ip_addr') {
                $value = [string]($response.$property)
                if (-not [string]::IsNullOrWhiteSpace($value)) {
                    return $value.Trim()
                }
            }
        }
        catch {
        }
    }

    return ''
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$gameExe = Join-Path $scriptDir 'FIRSTPERSON.exe'
$apiBase = 'https://backend-ujaa.onrender.com'
$mapPath = '/Game/ThirdPerson/Maps/CityRaid_FirstLevel?listen'
$version = 'City Raid Win64'

if (-not (Test-Path -LiteralPath $gameExe)) {
    throw 'Could not find FIRSTPERSON.exe beside the host helper.'
}

Write-Host ''
Write-Host 'City Raid multiplayer host' -ForegroundColor Cyan
Write-Host 'This starts a listen-server, registers your room on bnapsen.com, and keeps the room alive while the game is open.' -ForegroundColor Gray
Write-Host ''

$publicIp = Resolve-PublicIp
if ([string]::IsNullOrWhiteSpace($publicIp)) {
    $publicIp = Read-Host 'Could not detect your public IP automatically. Enter the IP or hostname friends should use'
}

if ([string]::IsNullOrWhiteSpace($publicIp)) {
    throw 'A public IP or hostname is required to host a public room.'
}

$publicIp = $publicIp.Trim()
$hostName = if ([string]::IsNullOrWhiteSpace($env:USERNAME)) { $env:COMPUTERNAME } else { "$($env:USERNAME) on $($env:COMPUTERNAME)" }
$publicHint = "${publicIp}:$Port"

$createPayload = @{
    hostName = $hostName
    version = $version
    joinAddress = $publicHint
    publicAddressHint = $publicHint
    isPublic = $true
}

$lobby = Invoke-CityRaidJson -Uri "$apiBase/api/cityraid/lobbies" -Method Post -Body $createPayload
$roomCode = [string]$lobby.roomCode
$heartbeatToken = [string]$lobby.heartbeatToken
$shareUrl = [string]$lobby.shareUrl

if ([string]::IsNullOrWhiteSpace($roomCode) -or [string]::IsNullOrWhiteSpace($heartbeatToken)) {
    throw 'The website did not return a valid room code.'
}

Write-Host ''
Write-Host "Room code: $roomCode" -ForegroundColor Green
Write-Host "Join address: $publicHint" -ForegroundColor Yellow
Write-Host "Share link: $shareUrl" -ForegroundColor Yellow
Write-Host ''
Write-Host 'If friends cannot connect, forward UDP port 7777 on your router and allow the game through Windows Firewall.' -ForegroundColor Gray
Write-Host ''

$process = $null
try {
    $process = Start-Process -FilePath $gameExe -WorkingDirectory $scriptDir -ArgumentList @($mapPath, "-port=$Port") -PassThru

    while (-not $process.HasExited) {
        Start-Sleep -Seconds 20
        if ($process.HasExited) {
            break
        }

        try {
            Invoke-CityRaidJson -Uri "$apiBase/api/cityraid/lobbies/heartbeat" -Method Post -Body @{
                roomCode = $roomCode
                heartbeatToken = $heartbeatToken
                joinAddress = $publicHint
                publicAddressHint = $publicHint
                version = $version
            } | Out-Null
        }
        catch {
            Write-Host "Room heartbeat warning: $($_.Exception.Message)" -ForegroundColor Yellow
        }
    }
}
finally {
    if (-not [string]::IsNullOrWhiteSpace($roomCode) -and -not [string]::IsNullOrWhiteSpace($heartbeatToken)) {
        try {
            Invoke-CityRaidJson -Uri "$apiBase/api/cityraid/lobbies/close" -Method Post -Body @{
                roomCode = $roomCode
                heartbeatToken = $heartbeatToken
            } | Out-Null
        }
        catch {
            Write-Host "Room close warning: $($_.Exception.Message)" -ForegroundColor Yellow
        }
    }
}
