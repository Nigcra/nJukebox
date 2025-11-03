@echo off
chcp 65001 >nul
setlocal
set PORT=5500
set URL=http://127.0.0.1:%PORT%/jukebox.html
set CHROME_PATH=

echo ========================================
echo 🎵 Jukebox Player Starter
echo ========================================
echo.
echo 📋 System Information:
echo - Web Server Port: %PORT%
echo - Data Server Port: 3001
echo - Web Interface: %URL%
echo - Auto-detects EXE vs Node.js
echo.

REM Try to find Chrome in standard paths
echo 🔍 Looking for Chrome Browser...
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" (
  set "CHROME_PATH=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
  echo ✓ Chrome found: Program Files
)
if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" (
  set "CHROME_PATH=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
  echo ✓ Chrome found: Program Files (x86)
)
if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" (
  set "CHROME_PATH=%LocalAppData%\Google\Chrome\Application\chrome.exe"
  echo ✓ Chrome found: Local AppData
)

if "%CHROME_PATH%"=="" (
  echo ❌ Chrome could not be found automatically.
  echo Please install Google Chrome or adjust the path.
  echo.
  echo Press any key to exit...
  pause >nul
  exit /b 1
)

echo.
echo 🚀 Starting Player Server...

:: Check if player server exe exists and use it, otherwise use node
if exist "jukebox.exe" (
    echo Using executable version for player...
    start /B "" .\jukebox.exe
) else (
    echo Using Node.js version for player...
    start /B "" node jukebox_server.js
)

echo ⏳ Waiting for player server startup...
timeout /t 4 >nul

echo 🌍 Opening Chrome Browser in Kiosk Mode...
start "" "%CHROME_PATH%" --kiosk --no-first-run --disable-infobars --disable-restore-session-state --disable-session-crashed-bubble --disable-features=TranslateUI "%URL%"

echo.
echo ✅ Jukebox Player ready! Start Data Server separately if needed.
echo.
echo 💡 To stop: Close Chrome (Alt+F4) and this window (Ctrl+C)
echo.

pause >nul