@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

REM build.cmd
REM Builds nJukebox on Windows without make
REM Version: 2026.08.16
REM
REM   build.cmd            binary for this machine
REM   build.cmd check      gofmt, vet and the tests
REM   build.cmd all        check, then build
REM   build.cmd dist       complete release packages (ZIP) into _release\
REM   build.cmd verify     the full acceptance suite, needs PowerShell 7
REM   build.cmd clean      remove the binary, dist\ and _release\
REM
REM CGO stays off throughout. That is the whole point of the Go port: no native
REM modules, no toolchain on the target machine, one file to copy.

set BINARY=njukebox.exe
set CGO_ENABLED=0
set LDFLAGS=-s -w

set TARGET=%~1
if "%TARGET%"=="" set TARGET=build

where go >nul 2>&1
if errorlevel 1 (
  echo ERROR: go was not found in PATH.
  echo Install Go 1.26 or newer, then run this again.
  exit /b 1
)

if /I "%TARGET%"=="build"  goto :build
if /I "%TARGET%"=="check"  goto :check
if /I "%TARGET%"=="all"    goto :all
if /I "%TARGET%"=="dist"   goto :dist
if /I "%TARGET%"=="verify" goto :verify
if /I "%TARGET%"=="clean"  goto :clean
if /I "%TARGET%"=="help"   goto :help

echo ERROR: unknown target "%TARGET%".
echo.
goto :help


:build
call :stopserver
if errorlevel 1 exit /b 1

echo Building %BINARY%...
go build -ldflags "%LDFLAGS%" -o %BINARY% .\cmd\njukebox
if errorlevel 1 (
  echo.
  echo Build failed.
  exit /b 1
)

for %%F in (%BINARY%) do set SIZE=%%~zF
set /a MB=!SIZE! / 1048576
echo   %BINARY%  !MB! MB
echo.
echo Done. Start with dev.cmd or start_jukebox.cmd.
exit /b 0


:check
echo === gofmt ===
REM gofmt -l lists what is not formatted; anything listed is a failure.
set UNFORMATTED=
for /f "delims=" %%F in ('gofmt -l cmd internal tools 2^>nul') do set UNFORMATTED=!UNFORMATTED! %%F
if not "!UNFORMATTED!"=="" (
  echo   not formatted:!UNFORMATTED!
  echo   run: gofmt -w cmd internal tools
  exit /b 1
)
echo   clean
echo.

echo === go vet ===
go vet ./...
if errorlevel 1 exit /b 1
echo   clean
echo.

echo === go test ===
go test ./... -count=1
if errorlevel 1 exit /b 1
echo.
echo All checks passed.
exit /b 0


:all
call "%~f0" check
if errorlevel 1 exit /b 1
echo.
call "%~f0" build
exit /b %ERRORLEVEL%


:dist
if exist _release rmdir /S /Q _release
mkdir _release
echo Building release packages for all platforms...
echo.

call :buildone windows amd64 njukebox.exe
if errorlevel 1 exit /b 1
call :buildone linux   amd64 njukebox
if errorlevel 1 exit /b 1
call :buildone darwin  amd64 njukebox
if errorlevel 1 exit /b 1
call :buildone darwin  arm64 njukebox
if errorlevel 1 exit /b 1

echo.
echo Done. The packages in _release\ contain everything the server needs at
echo runtime: the binary, web\, the licenses and the start/stop scripts.
echo On Linux and macOS run once after unzipping:
echo   chmod +x njukebox start_jukebox.sh stop_jukebox.sh
exit /b 0


:stopserver
REM Windows keeps the binary locked while the process lives, so a build would
REM fail with a bare access error. The running server is stopped first - it is
REM about to be replaced anyway, and leaving the old one alive next to a new
REM binary only invites confusion about which code is actually serving.
REM
REM Only the server. Browser windows are left alone; they are not in the way of
REM a build, and closing them is not this script's business.
tasklist /FI "IMAGENAME eq %BINARY%" /NH 2>nul | find /I "%BINARY%" >nul
if errorlevel 1 exit /b 0

echo Stopping the running server...
taskkill /IM %BINARY% /F >nul 2>&1

REM Terminating is not instant, and the file stays locked until the handle is
REM gone. Wait for it instead of racing the build against it.
for /L %%i in (1,1,20) do (
  tasklist /FI "IMAGENAME eq %BINARY%" /NH 2>nul | find /I "%BINARY%" >nul
  if errorlevel 1 (
    echo   stopped
    echo.
    exit /b 0
  )
  ping -n 2 127.0.0.1 >nul
)

echo ERROR: %BINARY% could not be stopped.
echo Run this as administrator if the process belongs to another user.
exit /b 1


:buildone
REM %1 = GOOS, %2 = GOARCH, %3 = binary name inside the package
REM Stages a complete, runnable package - binary, web\, licenses, README and
REM the matching start/stop scripts - then zips it. The folder layout is what
REM the server expects at runtime: the binary next to web\.
setlocal
set PKG=njukebox-%~1-%~2
set DEST=_release\%PKG%
mkdir "%DEST%"

set GOOS=%~1
set GOARCH=%~2
go build -ldflags "%LDFLAGS%" -o "%DEST%\%~3" .\cmd\njukebox
if errorlevel 1 (
  echo   FAILED: %~1/%~2
  endlocal
  exit /b 1
)

xcopy /E /I /Q web "%DEST%\web" >nul
copy /Y LICENSE "%DEST%" >nul
copy /Y THIRD-PARTY-NOTICES.md "%DEST%" >nul
copy /Y README.md "%DEST%" >nul
if /I "%~1"=="windows" (
  copy /Y start_jukebox.cmd "%DEST%" >nul
  copy /Y stop_jukebox.cmd "%DEST%" >nul
) else (
  copy /Y start_jukebox.sh "%DEST%" >nul
  copy /Y stop_jukebox.sh "%DEST%" >nul
)

powershell -NoProfile -Command "try { Compress-Archive -Path '_release\%PKG%' -DestinationPath '_release\%PKG%.zip' -Force -ErrorAction Stop } catch { exit 1 }"
if errorlevel 1 (
  echo   FAILED: zip for %PKG%
  endlocal
  exit /b 1
)

for %%F in ("_release\%PKG%.zip") do set SIZE=%%~zF
set /a MB=!SIZE! / 1048576
echo   %~1/%~2  ^-^>  _release\%PKG%.zip  (!MB! MB^)
endlocal
exit /b 0


:verify
where pwsh >nul 2>&1
if errorlevel 1 (
  echo ERROR: pwsh was not found. The verification scripts need PowerShell 7.
  exit /b 1
)

echo === web server ===
pwsh tools\verify_web.ps1
if errorlevel 1 exit /b 1
echo.
echo Everything verified.
exit /b 0


:clean
call :stopserver
if errorlevel 1 exit /b 1

if exist %BINARY% (
  del /Q %BINARY% 2>nul
  if exist %BINARY% (
    echo ERROR: %BINARY% could not be deleted, something still holds it.
    exit /b 1
  )
  echo   removed %BINARY%
)
if exist dist (
  rmdir /S /Q dist
  echo   removed dist\
)
if exist _release (
  rmdir /S /Q _release
  echo   removed _release\
)
echo Clean.
exit /b 0


:help
echo build.cmd - build nJukebox without make
echo.
echo   build.cmd            binary for this machine
echo   build.cmd check      gofmt, vet and the tests
echo   build.cmd all        check, then build
echo   build.cmd dist       complete release packages (ZIP) into _release\
echo   build.cmd verify     the full acceptance suite, needs PowerShell 7
echo   build.cmd clean      remove the binary, dist\ and _release\
echo.
exit /b 1
