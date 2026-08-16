@echo off
chcp 65001 >nul
REM Delayed expansion is required for the readiness loop below.
setlocal enabledelayedexpansion

REM dev.cmd
REM Development start: windowed browser with DevTools open, verbose server log
REM Version: 2026.08.13
REM
REM Differences to start_jukebox.cmd:
REM   - no kiosk mode, a normal resizable window
REM   - DevTools open right away, so the console is visible from the first paint
REM   - a separate browser profile, which keeps the kiosk session untouched and
REM     makes localStorage and sessionStorage easy to inspect and clear
REM   - the server runs in this window, so its log is right here

set WEBPORT=5500
set URL=http://127.0.0.1:%WEBPORT%/
set BINARY=njukebox.exe
set PROFILE=%TEMP%\njukebox-dev-profile
set CHROME_PATH=

echo ========================================
echo   nJukebox Development
echo ========================================
echo.
echo   Web interface : %URL%
echo   Data API      : http://127.0.0.1:3001/api/
echo   Browser profile: %PROFILE%
echo.

if not exist "%BINARY%" (
  echo Building %BINARY%...
  set CGO_ENABLED=0
  go build -o %BINARY% .\cmd\njukebox
  if errorlevel 1 (
    echo.
    echo ERROR: build failed.
    pause >nul
    exit /b 1
  )
  echo.
)

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
  echo Open %URL% manually instead.
  echo.
  pause >nul
  exit /b 1
)

REM Ports pruefen, bevor gestartet wird. Sonst laeuft der neue Prozess in ein
REM "address already in use", beendet sich sofort, und im Browser steht nur
REM "Verbindung abgelehnt" - ohne Hinweis darauf, wer den Port haelt.
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
if !READY!==0 (
  echo.
  echo ERROR: the server did not answer on port 3001.
  pause >nul
  exit /b 1
)

echo Opening Chrome with DevTools...
start "" "%CHROME_PATH%" ^
  --new-window ^
  --auto-open-devtools-for-tabs ^
  --window-size=1600,1000 ^
  --user-data-dir="%PROFILE%" ^
  --no-first-run ^
  --no-default-browser-check ^
  --disable-features=TranslateUI ^
  "%URL%"

echo.
echo ========================================
echo   Ready. The server log follows below.
echo   Press any key here to stop the server.
echo ========================================
echo.

REM A key press is the defined way out. Ctrl+C would end this script but leave
REM the server running, because start /B detaches it from the console handler.
pause >nul

echo.
echo Stopping server...
taskkill /IM %BINARY% /F >nul 2>&1
if errorlevel 1 (
  echo   server was not running any more
) else (
  echo   server stopped
)
echo.
echo The browser window stays open. Its profile lives in
echo %PROFILE%
echo and can be deleted to start from a clean storage state.
timeout /t 3 >nul
