@echo off
setlocal
pushd "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-City-Raid.ps1"
set "exit_code=%errorlevel%"
popd
exit /b %exit_code%
