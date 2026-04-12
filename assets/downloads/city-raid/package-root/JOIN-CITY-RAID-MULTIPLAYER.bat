@echo off
setlocal
pushd "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Join-City-Raid-Multiplayer.ps1"
set "exit_code=%errorlevel%"
popd
exit /b %exit_code%
