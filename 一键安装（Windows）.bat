@echo off
rem Yan one-click installer: double-click to install the theme, the dashboard plugin and the snippet.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0installer\install.ps1"
echo.
pause
