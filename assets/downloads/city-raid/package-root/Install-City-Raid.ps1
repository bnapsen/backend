$ErrorActionPreference = 'Stop'

function New-Shortcut {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ShortcutPath,
        [Parameter(Mandatory = $true)]
        [string]$TargetPath,
        [string]$Arguments = '',
        [string]$WorkingDirectory = '',
        [string]$IconLocation = ''
    )

    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($ShortcutPath)
    $shortcut.TargetPath = $TargetPath
    $shortcut.Arguments = $Arguments
    if ($WorkingDirectory) {
        $shortcut.WorkingDirectory = $WorkingDirectory
    }
    if ($IconLocation) {
        $shortcut.IconLocation = $IconLocation
    }
    $shortcut.Save()
}

$sourceDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$defaultInstallDir = Join-Path $env:LOCALAPPDATA 'Programs\City Raid'

Write-Host ''
Write-Host 'City Raid installer' -ForegroundColor Cyan
Write-Host 'This copies the game to a local install folder and creates shortcuts.' -ForegroundColor Gray
Write-Host ''
Write-Host "Default install folder: $defaultInstallDir" -ForegroundColor Yellow
$requestedDir = Read-Host 'Press Enter to use the default folder, or type a different install path'

if ([string]::IsNullOrWhiteSpace($requestedDir)) {
    $installDir = $defaultInstallDir
}
else {
    $installDir = [Environment]::ExpandEnvironmentVariables($requestedDir.Trim())
}

$installDir = [System.IO.Path]::GetFullPath($installDir)
$sourceExe = Join-Path $sourceDir 'FIRSTPERSON.exe'
if (-not (Test-Path -LiteralPath $sourceExe)) {
    throw 'Could not find FIRSTPERSON.exe beside the installer.'
}

New-Item -ItemType Directory -Force -Path $installDir | Out-Null

Write-Host ''
Write-Host "Installing to $installDir" -ForegroundColor Cyan

$robocopyArgs = @(
    $sourceDir,
    $installDir,
    '/E',
    '/R:1',
    '/W:1',
    '/NFL',
    '/NDL',
    '/NJH',
    '/NJS',
    '/NP'
)

& robocopy @robocopyArgs | Out-Null
$robocopyExit = $LASTEXITCODE
if ($robocopyExit -ge 8) {
    throw "File copy failed with robocopy exit code $robocopyExit."
}

$installedExe = Join-Path $installDir 'FIRSTPERSON.exe'
if (-not (Test-Path -LiteralPath $installedExe)) {
    throw 'The installed game executable was not found after copy.'
}

$desktopPath = [Environment]::GetFolderPath('Desktop')
$programsPath = [Environment]::GetFolderPath('Programs')
$startMenuFolder = Join-Path $programsPath 'City Raid'
New-Item -ItemType Directory -Force -Path $startMenuFolder | Out-Null

$desktopShortcut = Join-Path $desktopPath 'City Raid.lnk'
$startMenuShortcut = Join-Path $startMenuFolder 'City Raid.lnk'
$hostShortcut = Join-Path $startMenuFolder 'City Raid Host Multiplayer.lnk'
$joinShortcut = Join-Path $startMenuFolder 'City Raid Join Multiplayer.lnk'

New-Shortcut -ShortcutPath $desktopShortcut -TargetPath $installedExe -WorkingDirectory $installDir -IconLocation $installedExe
New-Shortcut -ShortcutPath $startMenuShortcut -TargetPath $installedExe -WorkingDirectory $installDir -IconLocation $installedExe
New-Shortcut -ShortcutPath $hostShortcut -TargetPath (Join-Path $installDir 'HOST-CITY-RAID-MULTIPLAYER.bat') -WorkingDirectory $installDir -IconLocation $installedExe
New-Shortcut -ShortcutPath $joinShortcut -TargetPath (Join-Path $installDir 'JOIN-CITY-RAID-MULTIPLAYER.bat') -WorkingDirectory $installDir -IconLocation $installedExe

$websiteShortcut = Join-Path $startMenuFolder 'City Raid Website.url'
Set-Content -LiteralPath $websiteShortcut -Encoding Ascii -Value @(
    '[InternetShortcut]'
    'URL=https://bnapsen.com/city-raid.html'
)

Write-Host ''
Write-Host 'Install complete.' -ForegroundColor Green
Write-Host "Desktop shortcut: $desktopShortcut" -ForegroundColor Gray
Write-Host "Start menu shortcut: $startMenuShortcut" -ForegroundColor Gray
Write-Host "Host shortcut: $hostShortcut" -ForegroundColor Gray
Write-Host "Join shortcut: $joinShortcut" -ForegroundColor Gray
Write-Host ''

$launchNow = Read-Host 'Launch City Raid now? (Y/N)'
if ($launchNow -match '^(y|yes)$') {
    Start-Process -FilePath $installedExe -WorkingDirectory $installDir
}
