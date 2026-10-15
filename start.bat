@echo off
title Waterfall - IDM ^& JDownloader Suite
cd /d "%~dp0"

:: Ensure Node.js, local binaries (yt-dlp, ffmpeg), and system tools are available in PATH
set "PATH=%~dp0bin;%PATH%;C:\Program Files\nodejs;%LOCALAPPDATA%\Microsoft\WindowsApps;%APPDATA%\npm;%LOCALAPPDATA%\Microsoft\WinGet\Links"

echo ========================================================
echo   WATERFALL - IDM + JDownloader Modern Hybrid Engine
echo ========================================================
echo Launching Native Desktop App (Electron Engine)...

:: Check if Waterfall instance is already alive and running
curl -s -m 1 http://localhost:4567/api/settings >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    echo Existing Waterfall instance detected. Focusing window...
    if exist "%~dp0node_modules\electron\dist\electron.exe" (
        start "" "%~dp0node_modules\electron\dist\electron.exe" .
        exit /b
    )
)

:: If a stale process is lingering on port 4567, request save and terminate ONLY that specific PID
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :4567 ^| findstr LISTENING') do (
    curl -s -m 1 -X POST http://localhost:4567/api/save >nul 2>nul
    timeout /t 1 /nobreak >nul 2>nul
    taskkill /F /PID %%a >nul 2>nul
)

:: Ensure Electron binary has Waterfall icon stamped
if not exist "%~dp0.icon_stamped" (
    call node -e "try { const { rcedit } = require('rcedit'); rcedit('node_modules/electron/dist/electron.exe', { icon: 'assets/icon.ico', 'version-string': { ProductName: 'Waterfall' } }); require('fs').writeFileSync('.icon_stamped', '1'); } catch (_) {}" >nul 2>nul
)

:: Launch Electron native shell
if exist "%~dp0node_modules\electron\dist\electron.exe" (
    start "" "%~dp0node_modules\electron\dist\electron.exe" .
    echo Waterfall launched successfully!
    exit /b
)

if exist "%~dp0node_modules\.bin\electron.cmd" (
    start "" "%~dp0node_modules\.bin\electron.cmd" .
    exit /b
)

:: Fallback web interface
echo Electron executable not found, starting web interface...
start /B "" node server.js
start http://localhost:4567
exit /b
