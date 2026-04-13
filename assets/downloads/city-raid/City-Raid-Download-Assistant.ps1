$ErrorActionPreference = 'Stop'

$baseUrl = 'https://bnapsen.com/assets/downloads/city-raid'
$partNames = @(
    'City-Raid-Win64.zip.part01',
    'City-Raid-Win64.zip.part02',
    'City-Raid-Win64.zip.part03',
    'City-Raid-Win64.zip.part04',
    'City-Raid-Win64.zip.part05'
)

$downloadsRoot = Join-Path ([Environment]::GetFolderPath('UserProfile')) 'Downloads'
$destinationRoot = Join-Path $downloadsRoot 'City-Raid'
$zipPath = Join-Path $destinationRoot 'City-Raid-Win64.zip'
$launchPath = Join-Path $destinationRoot 'FIRSTPERSON.exe'

New-Item -ItemType Directory -Path $destinationRoot -Force | Out-Null

if (Test-Path $zipPath)
{
    Remove-Item $zipPath -Force
}

$zipStream = [System.IO.File]::Open($zipPath, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)

try
{
    foreach ($partName in $partNames)
    {
        $partUrl = "$baseUrl/$partName"
        $partPath = Join-Path $destinationRoot $partName

        Write-Host "Downloading $partName ..." -ForegroundColor Cyan
        Invoke-WebRequest -UseBasicParsing -Uri $partUrl -OutFile $partPath

        $partStream = [System.IO.File]::OpenRead($partPath)
        try
        {
            $partStream.CopyTo($zipStream)
        }
        finally
        {
            $partStream.Dispose()
        }

        Remove-Item $partPath -Force
    }
}
finally
{
    $zipStream.Dispose()
}

Write-Host "Extracting City Raid ..." -ForegroundColor Cyan
Expand-Archive -LiteralPath $zipPath -DestinationPath $destinationRoot -Force

Write-Host ''
Write-Host "City Raid is ready." -ForegroundColor Green
Write-Host "Folder: $destinationRoot"
Write-Host "Launch: $launchPath"
Write-Host ''

Read-Host 'Press Enter to close this window'
