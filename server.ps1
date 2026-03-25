Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$script:ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$script:PublicRoot = Join-Path $script:ProjectRoot "public"
$script:Rooms = @{}
$script:RoomLock = New-Object object
$script:HostAddress = if ($env:HOST) { $env:HOST } else { "127.0.0.1" }
$script:Port = if ($env:PORT) { [int] $env:PORT } else { 8080 }

function ConvertTo-Hashtable {
    param([Parameter(Mandatory)] $InputObject)

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
        404 { "Not Found" }
        405 { "Method Not Allowed" }
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

function Invoke-Api {
    param($Request)

    switch ($Request.Path) {
        "/api/health" {
            return New-JsonPayload -Body @{ ok = $true; rooms = $script:Rooms.Count }
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

    return @{
        Method = $parts[0].ToUpperInvariant()
        Path = $path
        Query = $query
        Headers = $headers
        Body = $body
    }
}

function Send-Response {
    param(
        [System.Net.Sockets.TcpClient] $Client,
        [hashtable] $Payload
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
        "Access-Control-Allow-Origin: *"
        "Access-Control-Allow-Headers: Content-Type"
        "Access-Control-Allow-Methods: GET, POST, OPTIONS"
        ""
        ""
    ) -join "`r`n"

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

        try {
            $request = Read-Request -Client $client
            if ($null -eq $request) {
                continue
            }

            if ($request.Method -eq "OPTIONS") {
                $payload = New-TextPayload -Body "" -StatusCode 204
            }
            elseif ($request.Path.StartsWith("/api/")) {
                $payload = Invoke-Api -Request $request
            }
            else {
                $payload = Get-StaticPayload -RequestPath $request.Path
            }
        }
        catch {
            $payload = New-JsonPayload -Body @{ error = $_.Exception.Message } -StatusCode 500
        }

        try {
            Send-Response -Client $client -Payload $payload
        }
        finally {
            $client.Close()
        }
    }
}
finally {
    $listener.Stop()
}
