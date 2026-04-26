Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Net.Http

$script:ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$script:PublicRoot = Join-Path $script:ProjectRoot "public"
$script:Rooms = @{}
$script:RoomLock = New-Object object
$script:HostAddress = if ($env:HOST) { $env:HOST } else { "127.0.0.1" }
$script:Port = if ($env:PORT) { [int] $env:PORT } else { 8080 }
$script:ETradeBridgeBaseUrl = if ($env:ETRADE_BRIDGE_URL) { $env:ETRADE_BRIDGE_URL.TrimEnd("/") } else { "http://127.0.0.1:8765" }
$script:BridgeHttpClient = [System.Net.Http.HttpClient]::new()
$script:BridgeHttpClient.Timeout = [TimeSpan]::FromSeconds(20)
$script:DebugErrors = $false
$script:EnablePublicETradeProxy = $false
$script:ETradeProxyToken = ""
$script:KalshiLabToken = ""
$script:MaxRequestBodyBytes = 65536
$script:AllowedOriginPatterns = @()
$script:KalshiApiBaseUrl = "https://api.elections.kalshi.com/trade-api/v2"
$script:WeatherLabLocations = @(
    @{ series = "KXHIGHNY"; label = "New York"; lat = 40.78; lon = -73.97; stationHint = "Central Park / NYC market" }
    @{ series = "KXHIGHMIA"; label = "Miami"; lat = 25.79; lon = -80.29; stationHint = "Miami International Airport" }
    @{ series = "KXHIGHDEN"; label = "Denver"; lat = 39.86; lon = -104.67; stationHint = "Denver airport area" }
    @{ series = "KXHIGHLAX"; label = "Los Angeles"; lat = 33.94; lon = -118.40; stationHint = "Los Angeles airport area" }
    @{ series = "KXHIGHTDAL"; label = "Dallas"; lat = 32.85; lon = -96.85; stationHint = "Dallas airport area" }
    @{ series = "KXHIGHTLV"; label = "Las Vegas"; lat = 36.08; lon = -115.15; stationHint = "Las Vegas airport area" }
    @{ series = "KXHIGHTSEA"; label = "Seattle"; lat = 47.45; lon = -122.31; stationHint = "Seattle airport area" }
    @{ series = "KXHIGHTNOLA"; label = "New Orleans"; lat = 29.99; lon = -90.26; stationHint = "New Orleans airport area" }
    @{ series = "KXHIGHTHOU"; label = "Houston"; lat = 29.98; lon = -95.34; stationHint = "Houston airport area" }
    @{ series = "KXHIGHTMIN"; label = "Minneapolis"; lat = 44.88; lon = -93.22; stationHint = "Minneapolis airport area" }
)

function Test-EnvFlag {
    param(
        [string] $Value,
        [bool] $Default = $false
    )

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return $Default
    }

    return (@("1", "true", "yes", "on") -contains $Value.Trim().ToLowerInvariant())
}

function Read-IntEnvValue {
    param(
        [string] $Value,
        [int] $Default
    )

    $parsedValue = 0
    if (-not [string]::IsNullOrWhiteSpace($Value) -and [int]::TryParse($Value, [ref] $parsedValue) -and $parsedValue -gt 0) {
        return $parsedValue
    }

    return $Default
}

function Get-AllowedOriginPatterns {
    param([string] $RawValue)

    if ([string]::IsNullOrWhiteSpace($RawValue)) {
        return @(
            "http://localhost:*"
            "http://127.0.0.1:*"
            "https://bnapsen.com"
            "https://www.bnapsen.com"
            "https://*.github.io"
        )
    }

    $items = @()
    foreach ($value in ($RawValue -split "[,;]")) {
        $trimmed = $value.Trim()
        if (-not [string]::IsNullOrWhiteSpace($trimmed)) {
            $items += $trimmed
        }
    }

    return $items
}

function New-HttpException {
    param(
        [int] $StatusCode,
        [string] $Message
    )

    $exception = [System.Exception]::new($Message)
    $exception.Data["StatusCode"] = $StatusCode
    return $exception
}

$script:DebugErrors = Test-EnvFlag -Value $env:DEBUG_ERRORS
$script:EnablePublicETradeProxy = Test-EnvFlag -Value $env:ENABLE_PUBLIC_ETRADE_PROXY
$script:ETradeProxyToken = [string] $env:ETRADE_PROXY_TOKEN
$script:KalshiLabToken = [string] $env:KALSHI_LAB_TOKEN
$script:MaxRequestBodyBytes = Read-IntEnvValue -Value $env:MAX_REQUEST_BODY_BYTES -Default 65536
$script:AllowedOriginPatterns = Get-AllowedOriginPatterns -RawValue $env:ALLOWED_ORIGINS

function ConvertTo-Hashtable {
    param($InputObject)

    if ($null -eq $InputObject) {
        return @{}
    }

    if ($InputObject -is [System.Collections.IDictionary]) {
        $result = @{}
        foreach ($key in $InputObject.Keys) {
            $result[$key] = ConvertTo-Hashtable -InputObject $InputObject[$key]
        }
        return $result
    }

    if ($InputObject -is [string] -or $InputObject -is [ValueType]) {
        return $InputObject
    }

    if ($InputObject -is [System.Collections.IEnumerable] -and $InputObject -isnot [string]) {
        $items = @()
        foreach ($item in $InputObject) {
            $items += ConvertTo-Hashtable -InputObject $item
        }
        return $items
    }

    $properties = @($InputObject.PSObject.Properties)
    if ($properties.Count -gt 0) {
        $result = @{}
        foreach ($property in $properties) {
            $result[$property.Name] = ConvertTo-Hashtable -InputObject $property.Value
        }
        return $result
    }

    return $InputObject
}

function New-JsonPayload {
    param(
        [Parameter(Mandatory)] $Body,
        [int] $StatusCode = 200
    )

    return @{
        StatusCode = $StatusCode
        ContentType = "application/json; charset=utf-8"
        Body = [System.Text.Encoding]::UTF8.GetBytes(($Body | ConvertTo-Json -Depth 8))
    }
}

function New-TextPayload {
    param(
        [Parameter(Mandatory)] [string] $Body,
        [string] $ContentType = "text/plain; charset=utf-8",
        [int] $StatusCode = 200
    )

    return @{
        StatusCode = $StatusCode
        ContentType = $ContentType
        Body = [System.Text.Encoding]::UTF8.GetBytes($Body)
    }
}

function Get-ReasonPhrase {
    param([int] $StatusCode)

    switch ($StatusCode) {
        200 { "OK" }
        204 { "No Content" }
        400 { "Bad Request" }
        403 { "Forbidden" }
        404 { "Not Found" }
        405 { "Method Not Allowed" }
        413 { "Payload Too Large" }
        502 { "Bad Gateway" }
        500 { "Internal Server Error" }
        default { "OK" }
    }
}

function Read-JsonBody {
    param([string] $BodyText)

    if ([string]::IsNullOrWhiteSpace($BodyText)) {
        return @{}
    }

    return ConvertTo-Hashtable -InputObject ($BodyText | ConvertFrom-Json)
}

function New-RoomCode {
    do {
        $chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789".ToCharArray()
        $code = -join (1..5 | ForEach-Object { $chars[(Get-Random -Minimum 0 -Maximum $chars.Length)] })
    } while ($script:Rooms.ContainsKey($code))

    return $code
}

function New-PlayerId {
    return ([guid]::NewGuid().ToString("N").Substring(0, 10))
}

function New-Star {
    param($Room)

    do {
        $x = Get-Random -Minimum 0 -Maximum $Room.Width
        $y = Get-Random -Minimum 0 -Maximum $Room.Height
        $occupied = $false
        foreach ($player in $Room.Players.Values) {
            if ($player.X -eq $x -and $player.Y -eq $y) {
                $occupied = $true
                break
            }
        }
    } while ($occupied)

    return @{ x = $x; y = $y }
}

function New-Room {
    $room = @{
        Code = New-RoomCode
        Width = 12
        Height = 12
        Goal = 5
        Tick = 0
        WinnerId = $null
        WinnerName = $null
        LastUpdated = [DateTime]::UtcNow
        Players = @{}
        Star = $null
    }
    $room.Star = New-Star -Room $room
    return $room
}

function Get-RoomState {
    param($Room, [string] $ViewerId)

    $players = @()
    foreach ($player in $Room.Players.Values) {
        $players += @{
            id = $player.Id
            name = $player.Name
            x = $player.X
            y = $player.Y
            score = $player.Score
            color = $player.Color
            connected = $player.Connected
            isYou = ($player.Id -eq $ViewerId)
        }
    }

    return @{
        roomCode = $Room.Code
        width = $Room.Width
        height = $Room.Height
        goal = $Room.Goal
        tick = $Room.Tick
        winnerId = $Room.WinnerId
        winnerName = $Room.WinnerName
        star = $Room.Star
        players = $players
    }
}

function Touch-Room {
    param($Room)
    $Room.Tick += 1
    $Room.LastUpdated = [DateTime]::UtcNow
}

function Add-PlayerToRoom {
    param($Room, [string] $Name)

    $colors = @("#ff6b6b", "#4dabf7", "#ffd43b", "#69db7c", "#f783ac", "#b197fc")
    $playerCount = @($Room.Players.Keys).Count
    $color = $colors[$playerCount % @($colors).Count]

    do {
        $x = Get-Random -Minimum 0 -Maximum $Room.Width
        $y = Get-Random -Minimum 0 -Maximum $Room.Height
        $occupied = $false
        foreach ($existing in $Room.Players.Values) {
            if ($existing.X -eq $x -and $existing.Y -eq $y) {
                $occupied = $true
                break
            }
        }
    } while ($occupied)

    $player = @{
        Id = New-PlayerId
        Name = $Name
        X = $x
        Y = $y
        Score = 0
        Color = $color
        Connected = $true
    }

    $Room.Players[$player.Id] = $player
    Touch-Room -Room $Room
    return $player
}

function Move-Player {
    param($Room, $Player, [string] $Direction)

    if ($Room.WinnerId) {
        return
    }

    $newX = $Player.X
    $newY = $Player.Y

    switch ($Direction) {
        "up" { $newY -= 1 }
        "down" { $newY += 1 }
        "left" { $newX -= 1 }
        "right" { $newX += 1 }
        default { return }
    }

    if ($newX -lt 0 -or $newX -ge $Room.Width -or $newY -lt 0 -or $newY -ge $Room.Height) {
        return
    }

    foreach ($other in $Room.Players.Values) {
        if ($other.Id -ne $Player.Id -and $other.X -eq $newX -and $other.Y -eq $newY) {
            return
        }
    }

    $Player.X = $newX
    $Player.Y = $newY

    if ($Room.Star.x -eq $Player.X -and $Room.Star.y -eq $Player.Y) {
        $Player.Score += 1
        if ($Player.Score -ge $Room.Goal) {
            $Room.WinnerId = $Player.Id
            $Room.WinnerName = $Player.Name
        }
        $Room.Star = New-Star -Room $Room
    }

    Touch-Room -Room $Room
}

function Reset-Room {
    param($Room)

    $Room.WinnerId = $null
    $Room.WinnerName = $null
    $usedPositions = @{}

    foreach ($player in $Room.Players.Values) {
        $player.Score = 0
        do {
            $x = Get-Random -Minimum 0 -Maximum $Room.Width
            $y = Get-Random -Minimum 0 -Maximum $Room.Height
            $key = "$x,$y"
        } while ($usedPositions.ContainsKey($key))

        $usedPositions[$key] = $true
        $player.X = $x
        $player.Y = $y
    }

    $Room.Star = New-Star -Room $Room
    Touch-Room -Room $Room
}

function Get-ContentType {
    param([string] $Path)

    switch ([System.IO.Path]::GetExtension($Path).ToLowerInvariant()) {
        ".html" { "text/html; charset=utf-8" }
        ".css" { "text/css; charset=utf-8" }
        ".js" { "application/javascript; charset=utf-8" }
        ".json" { "application/json; charset=utf-8" }
        ".svg" { "image/svg+xml" }
        default { "application/octet-stream" }
    }
}

function Get-StaticPayload {
    param([string] $RequestPath)

    $relative = $RequestPath.TrimStart("/")
    if ([string]::IsNullOrWhiteSpace($relative)) {
        $relative = "index.html"
    }

    $separator = [System.IO.Path]::DirectorySeparatorChar
    $relative = $relative -replace "[\\/]", [string] $separator
    $resolvedRoot = [System.IO.Path]::GetFullPath($script:PublicRoot)
    $candidate = Join-Path $script:PublicRoot $relative
    $resolvedPath = [System.IO.Path]::GetFullPath($candidate)

    if (-not $resolvedPath.StartsWith($resolvedRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        return New-TextPayload -Body "Not found" -StatusCode 404
    }

    if (-not (Test-Path $resolvedPath -PathType Leaf)) {
        return New-TextPayload -Body "Not found" -StatusCode 404
    }

    return @{
        StatusCode = 200
        ContentType = Get-ContentType -Path $resolvedPath
        Body = [System.IO.File]::ReadAllBytes($resolvedPath)
    }
}

function ConvertTo-QueryString {
    param([hashtable] $Query)

    if ($null -eq $Query -or $Query.Count -eq 0) {
        return ""
    }

    $pairs = foreach ($key in $Query.Keys) {
        $encodedName = [System.Uri]::EscapeDataString([string] $key)
        $encodedValue = [System.Uri]::EscapeDataString([string] $Query[$key])
        "$encodedName=$encodedValue"
    }

    return ($pairs -join "&")
}

function Test-OriginAllowed {
    param([string] $Origin)

    if ([string]::IsNullOrWhiteSpace($Origin)) {
        return $false
    }

    foreach ($pattern in $script:AllowedOriginPatterns) {
        if ([WildcardPattern]::new($pattern, [System.Management.Automation.WildcardOptions]::IgnoreCase).IsMatch($Origin)) {
            return $true
        }
    }

    return $false
}

function Get-CorsHeaderLines {
    param($Request)

    if ($null -eq $Request) {
        return @()
    }

    $origin = [string] $Request.Headers["Origin"]
    if (-not (Test-OriginAllowed -Origin $origin)) {
        return @()
    }

    return @(
        "Access-Control-Allow-Origin: $origin"
        "Access-Control-Allow-Headers: Content-Type, X-ETrade-Proxy-Token"
        "Access-Control-Allow-Methods: GET, POST, OPTIONS"
        "Access-Control-Max-Age: 600"
        "Vary: Origin"
    )
}

function Get-SecurityHeaderLines {
    return @(
        "X-Content-Type-Options: nosniff"
        "X-Frame-Options: DENY"
        "Referrer-Policy: no-referrer"
        "Permissions-Policy: camera=(), microphone=(), geolocation=()"
        "Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https:; connect-src 'self' https: http://localhost:* http://127.0.0.1:*; font-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
    )
}

function Test-IsLoopbackRequest {
    param($Request)

    $remoteAddress = [string] $Request.RemoteAddress
    if ([string]::IsNullOrWhiteSpace($remoteAddress)) {
        return $false
    }

    try {
        return [System.Net.IPAddress]::IsLoopback([System.Net.IPAddress]::Parse($remoteAddress))
    }
    catch {
        return $remoteAddress -eq "localhost"
    }
}

function Assert-ETradeProxyAccess {
    param($Request)

    if (Test-IsLoopbackRequest -Request $Request) {
        return
    }

    if (-not $script:EnablePublicETradeProxy) {
        throw (New-HttpException -StatusCode 403 -Message "The E*TRADE proxy is only available from localhost unless ENABLE_PUBLIC_ETRADE_PROXY=true.")
    }

    if (-not [string]::IsNullOrWhiteSpace($script:ETradeProxyToken)) {
        $providedToken = [string] $Request.Headers["X-ETrade-Proxy-Token"]
        if ($providedToken -ne $script:ETradeProxyToken) {
            throw (New-HttpException -StatusCode 403 -Message "A valid E*TRADE proxy token is required.")
        }
    }
}

function New-ErrorPayloadForException {
    param([Parameter(Mandatory)] [System.Exception] $Exception)

    $statusCode = 500
    if ($Exception.Data.Contains("StatusCode")) {
        $statusCode = [int] $Exception.Data["StatusCode"]
    }

    $message = if ($statusCode -ge 500) {
        "Internal server error."
    }
    elseif (-not [string]::IsNullOrWhiteSpace($Exception.Message)) {
        $Exception.Message
    }
    else {
        Get-ReasonPhrase -StatusCode $statusCode
    }

    $body = @{ error = $message }
    if ($script:DebugErrors -and $statusCode -ge 500) {
        $body.detail = $Exception.ToString()
    }

    return New-JsonPayload -Body $body -StatusCode $statusCode
}

function Invoke-ETradeBridgeApi {
    param($Request)

    Assert-ETradeProxyAccess -Request $Request

    $targetPath = $Request.Path -replace "^/etrade-api", "/api"
    $uriBuilder = "$($script:ETradeBridgeBaseUrl)$targetPath"
    $queryString = ConvertTo-QueryString -Query $Request.Query
    if (-not [string]::IsNullOrWhiteSpace($queryString)) {
        $uriBuilder = "$uriBuilder`?$queryString"
    }

    $httpRequest = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::new($Request.Method), $uriBuilder)

    if (-not [string]::IsNullOrWhiteSpace($Request.Body)) {
        $bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($Request.Body)
        $content = [System.Net.Http.ByteArrayContent]::new($bodyBytes)
        $contentType = if ($Request.Headers.ContainsKey("Content-Type")) {
            [string] $Request.Headers["Content-Type"]
        }
        else {
            "application/json; charset=utf-8"
        }

        $content.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::Parse($contentType)
        $httpRequest.Content = $content
    }

    try {
        $response = $script:BridgeHttpClient.SendAsync($httpRequest).GetAwaiter().GetResult()
        $responseBytes = $response.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult()
        $responseContentType = if ($response.Content.Headers.ContentType) {
            $response.Content.Headers.ContentType.ToString()
        }
        else {
            "application/json; charset=utf-8"
        }

        return @{
            StatusCode = [int] $response.StatusCode
            ContentType = $responseContentType
            Body = $responseBytes
        }
    }
    catch {
        $body = @{
            error = "Unable to reach the E*TRADE bridge."
        }

        if ($script:DebugErrors) {
            $body.detail = $_.Exception.Message
            $body.bridgeUrl = $script:ETradeBridgeBaseUrl
            $body.suggestion = "Start the bridge with 'py -m etrade_bridge' or update ETRADE_BRIDGE_URL."
        }

        return New-JsonPayload -Body $body -StatusCode 502
    }
    finally {
        $httpRequest.Dispose()
    }
}

function Invoke-Api {
    param($Request)

    switch ($Request.Path) {
        "/api/health" {
            return New-JsonPayload -Body @{ ok = $true; rooms = $script:Rooms.Count }
        }
        "/api/kalshi/weather/scan" {
            if ($Request.Method -ne "GET") {
                return New-TextPayload -Body "Method not allowed" -StatusCode 405
            }

            return Invoke-KalshiWeatherLabScan -Request $Request
        }
        "/api/kalshi/weather/locations" {
            if ($Request.Method -ne "GET") {
                return New-TextPayload -Body "Method not allowed" -StatusCode 405
            }

            Assert-KalshiLabAccess -Request $Request
            return New-JsonPayload -Body @{ locations = $script:WeatherLabLocations }
        }
        "/api/create-room" {
            if ($Request.Method -ne "POST") {
                return New-TextPayload -Body "Method not allowed" -StatusCode 405
            }

            $body = Read-JsonBody -BodyText $Request.Body
            $name = [string] $body.name
            if ([string]::IsNullOrWhiteSpace($name)) {
                $name = "Host"
            }

            [System.Threading.Monitor]::Enter($script:RoomLock)
            try {
                $room = New-Room
                $script:Rooms[$room.Code] = $room
                $player = Add-PlayerToRoom -Room $room -Name $name.Trim()
                $state = Get-RoomState -Room $room -ViewerId $player.Id
            }
            finally {
                [System.Threading.Monitor]::Exit($script:RoomLock)
            }

            return New-JsonPayload -Body @{
                playerId = $player.Id
                roomCode = $room.Code
                state = $state
            }
        }
        "/api/join-room" {
            if ($Request.Method -ne "POST") {
                return New-TextPayload -Body "Method not allowed" -StatusCode 405
            }

            $body = Read-JsonBody -BodyText $Request.Body
            $name = [string] $body.name
            $code = ([string] $body.roomCode).Trim().ToUpperInvariant()

            if ([string]::IsNullOrWhiteSpace($name) -or [string]::IsNullOrWhiteSpace($code)) {
                return New-JsonPayload -Body @{ error = "Name and room code are required." } -StatusCode 400
            }

            [System.Threading.Monitor]::Enter($script:RoomLock)
            try {
                if (-not $script:Rooms.ContainsKey($code)) {
                    return New-JsonPayload -Body @{ error = "Room not found." } -StatusCode 404
                }

                $room = $script:Rooms[$code]
                if (@($room.Players.Keys).Count -ge 6) {
                    return New-JsonPayload -Body @{ error = "Room is full." } -StatusCode 400
                }

                $player = Add-PlayerToRoom -Room $room -Name $name.Trim()
                $state = Get-RoomState -Room $room -ViewerId $player.Id
            }
            finally {
                [System.Threading.Monitor]::Exit($script:RoomLock)
            }

            return New-JsonPayload -Body @{
                playerId = $player.Id
                roomCode = $room.Code
                state = $state
            }
        }
        "/api/state" {
            $code = ([string] $Request.Query["roomCode"]).Trim().ToUpperInvariant()
            $playerId = [string] $Request.Query["playerId"]

            if ([string]::IsNullOrWhiteSpace($code)) {
                return New-JsonPayload -Body @{ error = "roomCode is required." } -StatusCode 400
            }

            [System.Threading.Monitor]::Enter($script:RoomLock)
            try {
                if (-not $script:Rooms.ContainsKey($code)) {
                    return New-JsonPayload -Body @{ error = "Room not found." } -StatusCode 404
                }

                $room = $script:Rooms[$code]
                $state = Get-RoomState -Room $room -ViewerId $playerId
            }
            finally {
                [System.Threading.Monitor]::Exit($script:RoomLock)
            }

            return New-JsonPayload -Body $state
        }
        "/api/move" {
            if ($Request.Method -ne "POST") {
                return New-TextPayload -Body "Method not allowed" -StatusCode 405
            }

            $body = Read-JsonBody -BodyText $Request.Body
            $code = ([string] $body.roomCode).Trim().ToUpperInvariant()
            $playerId = [string] $body.playerId
            $direction = [string] $body.direction

            [System.Threading.Monitor]::Enter($script:RoomLock)
            try {
                if (-not $script:Rooms.ContainsKey($code)) {
                    return New-JsonPayload -Body @{ error = "Room not found." } -StatusCode 404
                }

                $room = $script:Rooms[$code]
                if (-not $room.Players.ContainsKey($playerId)) {
                    return New-JsonPayload -Body @{ error = "Player not found." } -StatusCode 404
                }

                Move-Player -Room $room -Player $room.Players[$playerId] -Direction $direction
                $state = Get-RoomState -Room $room -ViewerId $playerId
            }
            finally {
                [System.Threading.Monitor]::Exit($script:RoomLock)
            }

            return New-JsonPayload -Body $state
        }
        "/api/reset-room" {
            if ($Request.Method -ne "POST") {
                return New-TextPayload -Body "Method not allowed" -StatusCode 405
            }

            $body = Read-JsonBody -BodyText $Request.Body
            $code = ([string] $body.roomCode).Trim().ToUpperInvariant()

            [System.Threading.Monitor]::Enter($script:RoomLock)
            try {
                if (-not $script:Rooms.ContainsKey($code)) {
                    return New-JsonPayload -Body @{ error = "Room not found." } -StatusCode 404
                }

                $room = $script:Rooms[$code]
                Reset-Room -Room $room
                $state = Get-RoomState -Room $room -ViewerId ([string] $body.playerId)
            }
            finally {
                [System.Threading.Monitor]::Exit($script:RoomLock)
            }

            return New-JsonPayload -Body $state
        }
        default {
            return New-TextPayload -Body "Not found" -StatusCode 404
        }
    }
}

function Parse-QueryString {
    param([string] $QueryString)

    $result = @{}
    if ([string]::IsNullOrWhiteSpace($QueryString)) {
        return $result
    }

    foreach ($pair in $QueryString.TrimStart("?").Split("&", [System.StringSplitOptions]::RemoveEmptyEntries)) {
        $parts = $pair.Split("=", 2)
        $name = [System.Uri]::UnescapeDataString($parts[0])
        $value = if ($parts.Length -gt 1) { [System.Uri]::UnescapeDataString($parts[1]) } else { "" }
        $result[$name] = $value
    }

    return $result
}

function Read-Request {
    param([System.Net.Sockets.TcpClient] $Client)

    $stream = $Client.GetStream()
    $reader = [System.IO.StreamReader]::new($stream, [System.Text.Encoding]::UTF8, $false, 4096, $true)

    $requestLine = $reader.ReadLine()
    if ([string]::IsNullOrWhiteSpace($requestLine)) {
        return $null
    }

    $parts = $requestLine.Split(" ")
    if ($parts.Length -lt 2) {
        throw "Malformed request line."
    }

    $headers = @{}
    while ($true) {
        $line = $reader.ReadLine()
        if ($null -eq $line -or $line -eq "") {
            break
        }

        $separatorIndex = $line.IndexOf(":")
        if ($separatorIndex -lt 1) {
            continue
        }

        $name = $line.Substring(0, $separatorIndex).Trim()
        $value = $line.Substring($separatorIndex + 1).Trim()
        $headers[$name] = $value
    }

    $body = ""
    $contentLength = 0
    if ($headers.ContainsKey("Content-Length")) {
        [int]::TryParse([string] $headers["Content-Length"], [ref] $contentLength) | Out-Null
    }

    if ($contentLength -gt $script:MaxRequestBodyBytes) {
        throw (New-HttpException -StatusCode 413 -Message "Request body too large.")
    }

    if ($contentLength -gt 0) {
        $chars = New-Object char[] $contentLength
        $read = 0
        while ($read -lt $contentLength) {
            $count = $reader.Read($chars, $read, $contentLength - $read)
            if ($count -le 0) {
                break
            }
            $read += $count
        }
        if ($read -gt 0) {
            $body = -join $chars[0..($read - 1)]
        }
    }

    $rawTarget = $parts[1]
    $urlParts = $rawTarget.Split("?", 2)
    $path = [System.Uri]::UnescapeDataString($urlParts[0])
    $query = if ($urlParts.Length -gt 1) { Parse-QueryString -QueryString $urlParts[1] } else { @{} }
    $remoteAddress = $null
    try {
        if ($null -ne $Client.Client.RemoteEndPoint) {
            $remoteAddress = $Client.Client.RemoteEndPoint.Address.ToString()
        }
    }
    catch {
        $remoteAddress = $null
    }

    return @{
        Method = $parts[0].ToUpperInvariant()
        Path = $path
        Query = $query
        Headers = $headers
        Body = $body
        RemoteAddress = $remoteAddress
    }
}

function Assert-KalshiLabAccess {
    param($Request)

    if ([string]::IsNullOrWhiteSpace($script:KalshiLabToken)) {
        return
    }

    $providedToken = [string] $Request.Headers["X-Kalshi-Lab-Token"]
    if ([string]::IsNullOrWhiteSpace($providedToken) -and $Request.Query.ContainsKey("token")) {
        $providedToken = [string] $Request.Query["token"]
    }

    if ($providedToken -ne $script:KalshiLabToken) {
        throw (New-HttpException -StatusCode 403 -Message "A valid Kalshi Weather Lab token is required.")
    }
}

function Invoke-JsonGetWithRetry {
    param(
        [Parameter(Mandatory)] [string] $Url,
        [int] $Attempts = 4
    )

    $lastError = $null
    for ($attempt = 1; $attempt -le $Attempts; $attempt += 1) {
        $requestMessage = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::Get, $Url)
        $requestMessage.Headers.UserAgent.ParseAdd("bnapsen-weather-lab/0.1")
        try {
            $response = $script:BridgeHttpClient.SendAsync($requestMessage).GetAwaiter().GetResult()
            $text = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
            $statusCode = [int] $response.StatusCode
            if ($statusCode -eq 429 -or $statusCode -ge 500) {
                $lastError = [System.Exception]::new("GET $Url failed: $statusCode")
                Start-Sleep -Milliseconds (600 * $attempt * $attempt)
                continue
            }

            if (-not $response.IsSuccessStatusCode) {
                throw [System.Exception]::new("GET $Url failed: $statusCode $($text.Substring(0, [Math]::Min(240, $text.Length)))")
            }

            if ([string]::IsNullOrWhiteSpace($text)) {
                return @{}
            }

            return ConvertTo-Hashtable -InputObject ($text | ConvertFrom-Json)
        }
        catch {
            $lastError = $_.Exception
            Start-Sleep -Milliseconds (350 * $attempt)
        }
        finally {
            $requestMessage.Dispose()
        }
    }

    throw $lastError
}

function Get-DecimalQueryValue {
    param($Query, [string] $Name, [double] $Default)

    if ($null -ne $Query -and $Query.ContainsKey($Name)) {
        $parsed = 0.0
        if ([double]::TryParse([string] $Query[$Name], [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref] $parsed)) {
            return $parsed
        }
    }

    return $Default
}

function Get-TomorrowIsoDate {
    return ([DateTime]::UtcNow.AddDays(1).ToString("yyyy-MM-dd"))
}

function Get-DateTickerPart {
    param([string] $Date)

    $parsed = [DateTime]::ParseExact($Date, "yyyy-MM-dd", [Globalization.CultureInfo]::InvariantCulture)
    return $parsed.ToString("yyMMMd", [Globalization.CultureInfo]::InvariantCulture).ToUpperInvariant()
}

function Get-KalshiMarketUrl {
    param($Market)

    $series = if ($Market.ContainsKey("series_ticker") -and -not [string]::IsNullOrWhiteSpace([string] $Market["series_ticker"])) {
        [string] $Market["series_ticker"]
    }
    else {
        ([string] $Market["event_ticker"]).Split("-")[0]
    }
    $ticker = ([string] $Market["ticker"]).ToLowerInvariant()
    $base = switch ($series.ToLowerInvariant()) {
        "kxhighny" { "https://kalshi.com/markets/kxhighny/new-york-city-high-temperature" }
        "kxhighmia" { "https://kalshi.com/markets/kxhighmia/miami-high-temperature" }
        "kxhighden" { "https://kalshi.com/markets/kxhighden/denver-high-temperature" }
        "kxhighlax" { "https://kalshi.com/markets/kxhighlax/los-angeles-high-temperature" }
        "kxhightdal" { "https://kalshi.com/markets/kxhightdal/dallas-maximum-temperature" }
        "kxhightlv" { "https://kalshi.com/markets/kxhightlv/las-vegas-max-daily-temperature" }
        "kxhightsea" { "https://kalshi.com/markets/kxhightsea/seattle-maximum-temperature-daily" }
        "kxhightnola" { "https://kalshi.com/markets/kxhightnola/new-orleans-max-temp-daily" }
        "kxhighthou" { "https://kalshi.com/markets/kxhighthou/daily-high-temperature-houston" }
        "kxhightmin" { "https://kalshi.com/markets/kxhightmin/minneapolis-daily-high-temperature" }
        default { "https://kalshi.com/markets/$($series.ToLowerInvariant())" }
    }

    return "$base#$ticker"
}

function Get-KalshiMarkets {
    param([string] $Series, [int] $Limit = 200)

    $encodedSeries = [System.Uri]::EscapeDataString($Series)
    $data = Invoke-JsonGetWithRetry -Url "$($script:KalshiApiBaseUrl)/markets?series_ticker=$encodedSeries&status=open&limit=$Limit"
    if ($data.ContainsKey("markets")) {
        return @($data.markets)
    }

    return @()
}

function Get-DollarValue {
    param($Value)

    if ($null -eq $Value -or [string]::IsNullOrWhiteSpace([string] $Value)) {
        return 0.0
    }

    $parsed = 0.0
    if ([double]::TryParse([string] $Value, [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref] $parsed)) {
        return $parsed
    }

    return 0.0
}

function Get-KalshiFeeDollars {
    param([int] $Contracts, [double] $PriceDollars)

    return ([Math]::Ceiling(0.07 * $Contracts * $PriceDollars * (1.0 - $PriceDollars) * 100.0) / 100.0)
}

function Get-ErfApprox {
    param([double] $Value)

    $x = $Value
    $sign = 1.0
    if ($x -lt 0) {
        $sign = -1.0
        $x = -$x
    }

    $a1 = 0.254829592
    $a2 = -0.284496736
    $a3 = 1.421413741
    $a4 = -1.453152027
    $a5 = 1.061405429
    $p = 0.3275911
    $t = 1.0 / (1.0 + $p * $x)
    $y = 1.0 - (((((($a5 * $t + $a4) * $t + $a3) * $t + $a2) * $t + $a1) * $t) * [Math]::Exp(-$x * $x))
    Write-Output -NoEnumerate ([double] ($sign * $y))
    return
}

function Get-NormalCdf {
    param([double] $X)

    $z = $X / [Math]::Sqrt(2.0)
    $erf = [double] (Get-ErfApprox -Value $z)
    $result = 0.5 * (1.0 + $erf)
    Write-Output -NoEnumerate ([double] $result)
    return
}

function Get-WeatherProbability {
    param($Range, [double] $MeanHigh, [double] $Sigma)

    $lowerBound = $Range["lowerBound"]
    $upperBound = $Range["upperBound"]

    if ($null -eq $lowerBound) {
        return Get-NormalCdf -X (([double] $upperBound - $MeanHigh) / $Sigma)
    }

    if ($null -eq $upperBound) {
        return (1.0 - (Get-NormalCdf -X (([double] $lowerBound - $MeanHigh) / $Sigma)))
    }

    return ((Get-NormalCdf -X (([double] $upperBound - $MeanHigh) / $Sigma)) - (Get-NormalCdf -X (([double] $lowerBound - $MeanHigh) / $Sigma)))
}

function Get-WeatherMarketRange {
    param($Market)

    $subtitle = [string] $Market.yes_sub_title
    $match = [regex]::Match($subtitle, "([0-9]+)\D+to\D+([0-9]+)", [Text.RegularExpressions.RegexOptions]::IgnoreCase)
    if ($match.Success) {
        $low = [double] $match.Groups[1].Value
        $high = [double] $match.Groups[2].Value
        return ,@{
            label = $subtitle
            kind = "between"
            low = $low
            high = $high
            center = (($low + $high) / 2.0)
            lowerBound = ($low - 0.5)
            upperBound = ($high + 0.5)
        }
    }

    $match = [regex]::Match($subtitle, "([0-9]+)\D+or below", [Text.RegularExpressions.RegexOptions]::IgnoreCase)
    if ($match.Success) {
        $high = [double] $match.Groups[1].Value
        return ,@{
            label = $subtitle
            kind = "below"
            low = $null
            high = $high
            center = ($high - 1.5)
            lowerBound = $null
            upperBound = ($high + 0.5)
        }
    }

    $match = [regex]::Match($subtitle, "([0-9]+)\D+or above", [Text.RegularExpressions.RegexOptions]::IgnoreCase)
    if ($match.Success) {
        $low = [double] $match.Groups[1].Value
        return ,@{
            label = $subtitle
            kind = "above"
            low = $low
            high = $null
            center = ($low + 1.5)
            lowerBound = ($low - 0.5)
            upperBound = $null
        }
    }

    return $null
}

function Get-WeatherLabContext {
    param($Location, [string] $Date)

    $point = Invoke-JsonGetWithRetry -Url ("https://api.weather.gov/points/{0},{1}" -f $Location.lat, $Location.lon)
    $hourly = Invoke-JsonGetWithRetry -Url ([string] $point.properties.forecastHourly)
    $daily = Invoke-JsonGetWithRetry -Url ([string] $point.properties.forecast)

    $dayHours = @($hourly.properties.periods | Where-Object { ([string] $_.startTime).StartsWith($Date) })
    $temps = @($dayHours | ForEach-Object { [double] $_.temperature })
    $hourlyMax = if ($temps.Count -gt 0) { ($temps | Measure-Object -Maximum).Maximum } else { $null }
    $dailyPeriod = @($daily.properties.periods | Where-Object { ([string] $_.startTime).StartsWith($Date) -and ($_.isDaytime -or ([string] $_.name) -match "day|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday") } | Select-Object -First 1)
    $dailyHigh = if ($dailyPeriod.Count -gt 0) { [double] $dailyPeriod[0].temperature } else { $null }
    $parts = @()
    if ($null -ne $hourlyMax) { $parts += [double] $hourlyMax }
    if ($null -ne $dailyHigh) { $parts += [double] $dailyHigh }
    if ($parts.Count -eq 0) {
        throw [System.Exception]::new("No NWS high forecast found for $($Location.label) $Date.")
    }

    $meanHigh = ($parts | Measure-Object -Average).Average
    $peakHours = @($dayHours | Where-Object {
        $hourMatch = [regex]::Match([string] $_.startTime, "T(\d{2})")
        $hourMatch.Success -and [int] $hourMatch.Groups[1].Value -ge 11 -and [int] $hourMatch.Groups[1].Value -le 17
    })
    $text = ""
    if ($dailyPeriod.Count -gt 0) {
        $text += " $($dailyPeriod[0].shortForecast) $($dailyPeriod[0].detailedForecast)"
    }
    $text += " " + (($peakHours | ForEach-Object { [string] $_.shortForecast }) -join " ")
    $text = $text.ToLowerInvariant()
    $precipValues = @($dayHours | ForEach-Object {
        if ($null -ne $_.probabilityOfPrecipitation -and $null -ne $_.probabilityOfPrecipitation.value) {
            [double] $_.probabilityOfPrecipitation.value
        }
    })
    $maxPrecip = if ($precipValues.Count -gt 0) { ($precipValues | Measure-Object -Maximum).Maximum } else { 0.0 }
    $peakWindDirections = @($peakHours | ForEach-Object { [string] $_.windDirection } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique)
    $hasDenverUpslope = $false
    foreach ($direction in $peakWindDirections) {
        if ($direction -match "^(N|NE|NNE|ENE|E)$") {
            $hasDenverUpslope = $true
        }
    }

    return @{
        location = $Location
        date = $Date
        point = @{
            gridId = $point.properties.gridId
            gridX = $point.properties.gridX
            gridY = $point.properties.gridY
            relativeLocation = $point.properties.relativeLocation.properties
        }
        forecast = @{
            hourlyMax = $hourlyMax
            dailyHigh = $dailyHigh
            meanHigh = $meanHigh
            shortForecast = if ($dailyPeriod.Count -gt 0) { $dailyPeriod[0].shortForecast } else { $null }
            detailedForecast = if ($dailyPeriod.Count -gt 0) { $dailyPeriod[0].detailedForecast } else { $null }
        }
        regime = @{
            maxPrecipProbability = $maxPrecip
            peakWindDirections = $peakWindDirections
            hasDenverUpslope = $hasDenverUpslope
            precipWords = ($text -match "rain|shower|thunderstorm|drizzle|snow")
            cloudWords = ($text -match "cloud|overcast|fog|mist|haze")
        }
    }
}

function Get-AdjustedWeatherProbability {
    param($Range, $Context)

    $meanHigh = [double] $Context.forecast.meanHigh
    $raw = Get-WeatherProbability -Range $Range -MeanHigh $meanHigh -Sigma 3.0
    $tight = Get-WeatherProbability -Range $Range -MeanHigh $meanHigh -Sigma 2.0
    $wide = Get-WeatherProbability -Range $Range -MeanHigh $meanHigh -Sigma 4.0
    $probability = 0.45 * $raw + 0.35 * $tight + 0.20 * $wide
    $reasons = @("Raw sigma=3 model {0:P1}, tight sigma=2 {1:P1}, wide sigma=4 {2:P1}." -f $raw, $tight, $wide)
    $riskFlags = @()

    $center = [double] $Range["center"]
    $aboveMean = $center -gt ($meanHigh + 1.0)
    $belowMean = $center -lt ($meanHigh - 1.0)
    $nearMean = [Math]::Abs($center - $meanHigh) -le 1.0
    $wet = ([double] $Context.regime.maxPrecipProbability) -ge 40.0 -or [bool] $Context.regime.precipWords
    $cloud = [bool] $Context.regime.cloudWords
    $upslope = ([string] $Context.location.series) -eq "KXHIGHDEN" -and [bool] $Context.regime.hasDenverUpslope

    if ($upslope -and $wet) {
        $riskFlags += "Denver upslope/rain regime"
        $reasons += "Denver N/NE/E upslope with precipitation can cap daytime highs; hotter buckets get discounted."
    }

    if (($wet -or $cloud) -and $aboveMean) {
        $multiplier = if ($upslope) { 0.68 } else { 0.78 }
        $probability *= $multiplier
        $riskFlags += "Hotter-than-forecast bucket in wet/cloudy setup"
    }
    elseif (($wet -or $cloud) -and $belowMean) {
        $multiplier = if ($upslope) { 1.12 } else { 1.06 }
        $probability *= $multiplier
        $riskFlags += "Cool-side bucket helped by wet/cloudy setup"
    }

    if ($nearMean) {
        $reasons += "Bucket is near the NWS mean high, so the model treats it as a central forecast bucket."
    }

    $spreadPenalty = [Math]::Min(0.28, [Math]::Abs($tight - $wide) * 0.8)
    $confidenceScore = 0.78 - $spreadPenalty
    if ($wet) { $confidenceScore -= 0.08 }
    if ($upslope) { $confidenceScore -= 0.08 }
    if ($null -eq $Context.forecast.hourlyMax -or $null -eq $Context.forecast.dailyHigh) { $confidenceScore -= 0.12 }
    $confidenceScore = [Math]::Min(0.9, [Math]::Max(0.2, $confidenceScore))
    $confidence = if ($confidenceScore -ge 0.68) { "high" } elseif ($confidenceScore -ge 0.48) { "medium" } else { "low" }
    if ($confidence -ne "high") {
        $riskFlags += "$confidence model confidence"
    }

    return @{
        adjustedProbability = [Math]::Min(0.999, [Math]::Max(0.001, $probability))
        rawProbability = $raw
        tightProbability = $tight
        wideProbability = $wide
        confidence = $confidence
        riskFlags = $riskFlags
        reasons = $reasons
    }
}

function Get-WeatherRecommendation {
    param([double] $Edge, [string] $Confidence, [double] $Ask, [double] $Probability)

    if ($Edge -ge 0.12 -and $Confidence -ne "low" -and $Probability -ge 0.12) { return "research-buy" }
    if ($Edge -ge 0.06 -and $Confidence -eq "high") { return "small-buy" }
    if ($Edge -ge 0.03 -and $Ask -le 0.05) { return "tiny-only" }
    if ($Edge -le -0.04) { return "avoid-or-sell" }
    return "pass"
}

function Get-WeatherCandidateScore {
    param($Market, $Location, $Context, $Range, [string] $Side, [double] $MaxCost)

    $ask = if ($Side -eq "yes") { Get-DollarValue -Value $Market["yes_ask_dollars"] } else { Get-DollarValue -Value $Market["no_ask_dollars"] }
    $bid = if ($Side -eq "yes") { Get-DollarValue -Value $Market["yes_bid_dollars"] } else { Get-DollarValue -Value $Market["no_bid_dollars"] }
    $sizeValue = if ($Side -eq "yes") {
        $Market["yes_ask_size_fp"]
    }
    elseif ($Market.ContainsKey("no_ask_size_fp")) {
        $Market["no_ask_size_fp"]
    }
    else {
        25
    }
    $size = Get-DollarValue -Value $sizeValue
    if ($ask -le 0 -or $ask -ge 1 -or $size -lt 1) {
        return $null
    }

    $yesModel = Get-AdjustedWeatherProbability -Range $Range -Context $Context
    $probability = if ($Side -eq "yes") { [double] $yesModel.adjustedProbability } else { 1.0 - [double] $yesModel.adjustedProbability }
    $rawProbability = if ($Side -eq "yes") { [double] $yesModel.rawProbability } else { 1.0 - [double] $yesModel.rawProbability }
    $tightProbability = if ($Side -eq "yes") { [double] $yesModel.tightProbability } else { 1.0 - [double] $yesModel.tightProbability }
    $wideProbability = if ($Side -eq "yes") { [double] $yesModel.wideProbability } else { 1.0 - [double] $yesModel.wideProbability }
    $contracts = [Math]::Max(1, [Math]::Min([Math]::Floor($size), [Math]::Min([Math]::Floor($MaxCost / $ask), 25)))
    $fee = Get-KalshiFeeDollars -Contracts $contracts -PriceDollars $ask
    $cost = $contracts * $ask + $fee
    if ($cost -gt ($MaxCost + 0.00001)) {
        return $null
    }

    $breakEven = $cost / $contracts
    $edge = $probability - $breakEven
    $recommendation = Get-WeatherRecommendation -Edge $edge -Confidence ([string] $yesModel.confidence) -Ask $ask -Probability $probability
    $rank = switch ($recommendation) {
        "research-buy" { 4 }
        "small-buy" { 3 }
        "tiny-only" { 2 }
        "pass" { 1 }
        default { 0 }
    }

    return @{
        ticker = $Market.ticker
        eventTicker = $Market.event_ticker
        series = $Location.series
        location = $Location.label
        stationHint = $Location.stationHint
        side = $Side
        subtitle = $Market.yes_sub_title
        title = $Market.title
        range = @{
            label = $Range["label"]
            kind = $Range["kind"]
            low = $Range["low"]
            high = $Range["high"]
            center = $Range["center"]
        }
        price = @{
            ask = $ask
            bid = $bid
            askCents = [Math]::Round($ask * 100)
            bidCents = [Math]::Round($bid * 100)
            askSize = [Math]::Round($size, 2)
            last = Get-DollarValue -Value $Market.last_price_dollars
        }
        probability = [Math]::Round($probability, 4)
        rawProbability = [Math]::Round($rawProbability, 4)
        tightProbability = [Math]::Round($tightProbability, 4)
        wideProbability = [Math]::Round($wideProbability, 4)
        breakEven = [Math]::Round($breakEven, 4)
        adjustedEdge = [Math]::Round($edge, 4)
        rawEdge = [Math]::Round(($rawProbability - $breakEven), 4)
        confidence = $yesModel.confidence
        riskFlags = $yesModel.riskFlags
        recommendation = $recommendation
        rank = $rank
        suggested = @{
            contracts = $contracts
            maxCost = [Math]::Round($cost, 2)
            fee = [Math]::Round($fee, 2)
            maxPriceCents = [Math]::Round($ask * 100)
        }
        context = @{
            meanHigh = $Context.forecast.meanHigh
            hourlyMax = $Context.forecast.hourlyMax
            dailyHigh = $Context.forecast.dailyHigh
            shortForecast = $Context.forecast.shortForecast
            detailedForecast = $Context.forecast.detailedForecast
            maxPrecipProbability = $Context.regime.maxPrecipProbability
            peakWindDirections = $Context.regime.peakWindDirections
        }
        closeTime = $Market.close_time
        expectedExpirationTime = $Market.expected_expiration_time
        url = Get-KalshiMarketUrl -Market $Market
        rationale = @(
            "$($Location.label) NWS mean high $([Math]::Round([double] $Context.forecast.meanHigh, 1))F from hourly max $($Context.forecast.hourlyMax)F and daily high $($Context.forecast.dailyHigh)F."
            "$($Side.ToUpperInvariant()) fair probability after weather adjustments: {0:P1}; fee-adjusted break-even: {1:P1}." -f $probability, $breakEven
        ) + $yesModel.reasons
    }
}

function Invoke-KalshiWeatherLabScan {
    param($Request)

    Assert-KalshiLabAccess -Request $Request

    $date = if ($Request.Query.ContainsKey("date") -and -not [string]::IsNullOrWhiteSpace([string] $Request.Query["date"])) { [string] $Request.Query["date"] } else { Get-TomorrowIsoDate }
    $minEdge = Get-DecimalQueryValue -Query $Request.Query -Name "minEdge" -Default 0.03
    $maxCost = Get-DecimalQueryValue -Query $Request.Query -Name "maxCost" -Default 3.0
    $includeNegative = ($Request.Query.ContainsKey("includeNegative") -and [string] $Request.Query["includeNegative"] -eq "1")
    $datePart = Get-DateTickerPart -Date $date
    $candidates = @()
    $contexts = @()
    $errors = @()

    foreach ($location in $script:WeatherLabLocations) {
        try {
            $context = Get-WeatherLabContext -Location $location -Date $date
            $contexts += $context
            $markets = Get-KalshiMarkets -Series ([string] $location.series)
            foreach ($market in $markets) {
                if (-not ([string] $market.ticker).Contains($datePart)) {
                    continue
                }

                $range = Get-WeatherMarketRange -Market $market
                if ($null -eq $range) {
                    continue
                }

                foreach ($side in @("yes", "no")) {
                    $candidate = Get-WeatherCandidateScore -Market $market -Location $location -Context $context -Range $range -Side $side -MaxCost $maxCost
                    if ($null -ne $candidate -and ($includeNegative -or [double] $candidate.adjustedEdge -ge $minEdge)) {
                        $candidates += $candidate
                    }
                }
            }
        }
        catch {
            $errorItem = @{
                location = $location.label
                series = $location.series
                message = $_.Exception.Message
            }
            if ($script:DebugErrors) {
                $errorItem.detail = $_.ScriptStackTrace
            }
            $errors += $errorItem
        }
    }

    $candidates = @($candidates | Sort-Object -Property @{ Expression = { [int] $_.rank }; Descending = $true }, @{ Expression = { [double] $_.adjustedEdge }; Descending = $true })

    return New-JsonPayload -Body @{
        asOf = [DateTime]::UtcNow.ToString("o")
        date = $date
        assumptions = @{
            rawSigmaF = 3
            tightSigmaF = 2
            wideSigmaF = 4
            note = "Weather Lab blends raw normal models and weather-regime penalties. It is a research model, not proof of edge."
        }
        filters = @{
            minEdge = $minEdge
            maxCost = $maxCost
            includeNegative = $includeNegative
        }
        contexts = $contexts
        candidates = $candidates
        errors = $errors
    }
}

function Send-Response {
    param(
        [System.Net.Sockets.TcpClient] $Client,
        [hashtable] $Payload,
        $Request = $null
    )

    $stream = $Client.GetStream()
    $statusCode = [int] $Payload.StatusCode
    $reasonPhrase = Get-ReasonPhrase -StatusCode $statusCode
    $headers = @(
        "HTTP/1.1 $statusCode $reasonPhrase"
        "Content-Type: $($Payload.ContentType)"
        "Content-Length: $($Payload.Body.Length)"
        "Connection: close"
        "Cache-Control: no-store"
    )
    $headers += Get-SecurityHeaderLines
    $headers += Get-CorsHeaderLines -Request $Request
    $headers += @("", "")
    $headers = $headers -join "`r`n"

    $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($headers)
    $stream.Write($headerBytes, 0, $headerBytes.Length)
    if ($Payload.Body.Length -gt 0) {
        $stream.Write($Payload.Body, 0, $Payload.Body.Length)
    }
    $stream.Flush()
}

$ipAddress = switch ($script:HostAddress) {
    "0.0.0.0" { [System.Net.IPAddress]::Any; break }
    "*" { [System.Net.IPAddress]::Any; break }
    "127.0.0.1" { [System.Net.IPAddress]::Loopback; break }
    "localhost" { [System.Net.IPAddress]::Loopback; break }
    default { [System.Net.IPAddress]::Parse($script:HostAddress) }
}

$listener = [System.Net.Sockets.TcpListener]::new($ipAddress, $script:Port)
$listener.Start()

Write-Host "Star Sprint server running at http://$($script:HostAddress):$($script:Port)/"
Write-Host "Press Ctrl+C to stop."

try {
    while ($true) {
        $client = $listener.AcceptTcpClient()
        $client.ReceiveTimeout = 5000
        $client.SendTimeout = 5000

        $request = $null
        try {
            $request = Read-Request -Client $client
            if ($null -eq $request) {
                continue
            }

            if ($request.Method -eq "OPTIONS") {
                $payload = New-TextPayload -Body "" -StatusCode 204
            }
            elseif ($request.Path.StartsWith("/etrade-api/") -or $request.Path -eq "/etrade-api") {
                $payload = Invoke-ETradeBridgeApi -Request $request
            }
            elseif ($request.Path.StartsWith("/api/")) {
                $payload = Invoke-Api -Request $request
            }
            else {
                $payload = Get-StaticPayload -RequestPath $request.Path
            }
        }
        catch {
            Write-Warning $_.Exception.ToString()
            $payload = New-ErrorPayloadForException -Exception $_.Exception
        }

        try {
            Send-Response -Client $client -Payload $payload -Request $request
        }
        finally {
            $client.Close()
        }
    }
}
finally {
    $listener.Stop()
}
