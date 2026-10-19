@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo   ATLAS // SECTOR 04 - visual concept
echo   starting local server on http://localhost:4173/
echo.

start "" /min powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1"
timeout /t 2 /nobreak >nul
start "" http://localhost:4173/

echo   server is running. close this window or press Ctrl+C to stop it.
echo.
pause
