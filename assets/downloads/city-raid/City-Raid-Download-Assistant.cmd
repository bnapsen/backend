@echo off
setlocal

set "SCRIPT_URL=https://bnapsen.com/assets/downloads/city-raid/City-Raid-Download-Assistant.ps1"
set "SCRIPT_PATH=%TEMP%\City-Raid-Download-Assistant.ps1"

echo Downloading the City Raid assistant...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -UseBasicParsing '%SCRIPT_URL%' -OutFile '%SCRIPT_PATH%'; & '%SCRIPT_PATH%'"

if errorlevel 1 (
  echo.
  echo City Raid download failed. Try the manual part links on the website.
  pause
)

endlocal
