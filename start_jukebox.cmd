@echo off
chcp 65001 >nul
REM Delayed expansion is required for the readiness loop below.
setlocal enabledelayedexpansion

REM start_jukebox.cmd
REM Starts the server and opens the jukebox in a kiosk browser
REM Version: 2026.08.13

set WEBPORT=5500
set URL=http://127.0.0.1:%WEBPORT%/jukebox.html
set BINARY=njukebox.exe
set CHROME_PATH=

echo ========================================
echo   nJukebox Player
echo ========================================
echo.
echo   Web interface : %URL%
echo   Data API      : http://127.0.0.1:3001/api/
echo   Binary        : %BINARY%
echo.

if not exist "%BINARY%" (
  echo ERROR: %BINARY% not found.
  echo Build it first:  go build -o %BINARY% .\cmd\njukebox
  echo.
  pause >nul
  exit /b 1
)

echo Looking for Chrome...
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" (
  set "CHROME_PATH=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
)
if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" (
  set "CHROME_PATH=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
)
if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" (
  set "CHROME_PATH=%LocalAppData%\Google\Chrome\Application\chrome.exe"
)

if "%CHROME_PATH%"=="" (
  echo ERROR: Chrome could not be found.
  echo Install Google Chrome or open %URL% manually.
  echo.
  echo Spotify playback needs Widevine, which Chrome and Edge provide.
  echo.
  pause >nul
  exit /b 1
)
echo   found: %CHROME_PATH%
echo.

REM Ports pruefen, bevor gestartet wird. Sonst laeuft der neue Prozess in ein
REM "address already in use" und der Kiosk-Browser zeigt nur eine leere Seite.
powershell -NoProfile -Command "$busy = @(); foreach ($p in @(%WEBPORT%, 3001)) { foreach ($c in @(Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue)) { $proc = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue; $name = if ($proc) { $proc.ProcessName } else { 'unknown' }; $busy += ('  port {0} is held by PID {1} ({2})' -f $p, $c.OwningProcess, $name) } }; if ($busy) { $busy | ForEach-Object { Write-Host $_ }; exit 1 }; exit 0"
if errorlevel 1 (
  echo.
  echo ERROR: the ports are already in use.
  echo Run stop_jukebox.cmd first, then start again.
  echo.
  pause >nul
  exit /b 1
)

echo Starting server...
REM --no-tui on purpose: the server shares this console with the script, which
REM keeps printing below. A TUI would take over the alt screen and the two would
REM overwrite each other. Run the binary on its own to get the interface.
start /B "" .\%BINARY% --no-tui

echo Waiting for the server to answer...
set READY=0
for /L %%i in (1,1,30) do (
  if !READY!==0 (
    ping -n 2 127.0.0.1 >nul
    curl -s -o nul -f http://127.0.0.1:3001/api/health && set READY=1
  )
)

echo Opening Chrome in kiosk mode...
start "" "%CHROME_PATH%" --kiosk --no-first-run --disable-infobars ^
  --disable-restore-session-state --disable-session-crashed-bubble ^
  --disable-features=TranslateUI "%URL%"

echo.
echo Ready. Close Chrome with Alt+F4, stop the server with Ctrl+C.
echo.
pause >nul
