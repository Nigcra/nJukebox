@echo off
chcp 65001 >nul
REM Delayed expansion is required for the counters in the loops below.
setlocal enabledelayedexpansion

REM stop_jukebox.cmd
REM Stops the nJukebox server, whatever holds its ports, and the browser it opened
REM Version: 2026.08.14
REM
REM Exit code 0 means both ports are free afterwards, 1 means something survived.
REM
REM The port handling deliberately goes through Get-NetTCPConnection instead of
REM parsing netstat: netstat prints its state column in the system language -
REM "ABHOEREN" on a German Windows, not "LISTENING" - so every filter built on
REM that word silently matches nothing and the script would report success while
REM the port stays occupied.

set WEBPORT=5500
set DATAPORT=3001
set KILLED=0

echo ========================================
echo   Stopping nJukebox
echo ========================================
echo.

REM --- 1. The server itself, by image name -------------------------------
REM Covers njukebox.exe and the platform builds from dist\, which carry a
REM suffix like njukebox-windows-amd64.exe.
for %%N in (njukebox.exe njukebox-windows-amd64.exe) do (
  tasklist /FI "IMAGENAME eq %%N" /NH 2>nul | find /I "%%N" >nul
  if not errorlevel 1 (
    taskkill /IM %%N /F >nul 2>&1
    echo   server        %%N stopped
    set /a KILLED+=1
  )
)

REM --- 2. Anything still listening on the ports ---------------------------
REM The decisive step. A binary started under a different name, an orphan from
REM a crashed run or the Node server of the original project would all survive
REM step 1 and keep the port. Whatever answers there has to go, otherwise the
REM next start fails with "address already in use".
powershell -NoProfile -Command "$killed = 0; foreach ($p in @(%WEBPORT%, %DATAPORT%)) { foreach ($c in @(Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue)) { $proc = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue; $name = if ($proc) { $proc.ProcessName } else { 'unknown' }; Write-Host ('  port {0}     PID {1} ({2}) stopped' -f $p, $c.OwningProcess, $name); Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue; $killed++ } }; exit $killed"
set /a KILLED+=%ERRORLEVEL%

REM --- 3. The browser windows this project opened -------------------------
REM Only ours: the kiosk window by its title, the development window by its
REM separate profile directory. Every other Chrome window stays untouched.
set FOUNDBROWSER=0
for /f "tokens=1" %%p in ('tasklist /FI "IMAGENAME eq chrome.exe" /FI "WINDOWTITLE eq nJukebox*" /NH 2^>nul ^| find /I "chrome.exe"') do set FOUNDBROWSER=1

if "!FOUNDBROWSER!"=="1" (
  taskkill /FI "WINDOWTITLE eq nJukebox*" /IM chrome.exe /F >nul 2>&1
  echo   kiosk browser stopped
  set /a KILLED+=1
)

powershell -NoProfile -Command "$p = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.Name -eq 'chrome.exe' -and $_.CommandLine -like '*njukebox-dev-profile*' }); $p | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; exit $p.Count" >nul 2>&1
if %ERRORLEVEL% GTR 0 (
  echo   dev browser   stopped
  set /a KILLED+=%ERRORLEVEL%
)

echo.
if !KILLED!==0 (
  echo Nothing was running.
) else (
  echo !KILLED! item^(s^) stopped.
)

REM --- 4. Verify ---------------------------------------------------------
REM Terminating a process is not instant. Give the ports a moment, then check
REM instead of assuming.
ping -n 3 127.0.0.1 >nul

powershell -NoProfile -Command "$busy = @(); foreach ($p in @(%WEBPORT%, %DATAPORT%)) { foreach ($c in @(Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue)) { $proc = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue; $name = if ($proc) { $proc.ProcessName } else { 'unknown' }; $busy += ('  port {0} is still held by PID {1} ({2})' -f $p, $c.OwningProcess, $name) } }; if ($busy) { Write-Host ''; Write-Host 'ERROR: not everything could be stopped.'; $busy | ForEach-Object { Write-Host $_ }; exit 1 }; exit 0"

if errorlevel 1 (
  echo.
  echo Run this script as administrator if the process belongs to another user.
  exit /b 1
)

echo.
echo Ports %WEBPORT% and %DATAPORT% are free.
exit /b 0
