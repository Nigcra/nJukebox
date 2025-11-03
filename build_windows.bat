@echo off
chcp 65001 >nul
title Optimized Jukebox Build Script

echo ========================================
echo   JUKEBOX OPTIMIZED BUILD SCRIPT
echo ========================================
echo.
echo This script creates a minimal distribution with:
echo - EXE files (all assets embedded)
echo - External config.json (for user customization)
echo - Node.js fallback (in case EXE fails)
echo - Essential runtime dependencies only
echo.

echo 🧹 Cleaning up old distribution...
if exist ".dist" (
    rmdir /s /q ".dist"
)
mkdir ".dist"
echo.

echo 🔨 Building executables...
call npm run build-all
if %errorlevel% neq 0 (
    echo ❌ Build failed!
    pause
    exit /b 1
)
echo.

echo 📋 Creating minimal distribution...

:: Copy executables (contain all embedded assets)
if exist "jukebox.exe" (
    echo   ✓ jukebox.exe (main player)
    copy "jukebox.exe" ".dist\" >nul
    del "jukebox.exe" >nul
)
if exist "jukebox_data_server.exe" (
    echo   ✓ jukebox_data_server.exe (data server)
    copy "jukebox_data_server.exe" ".dist\" >nul
    del "jukebox_data_server.exe" >nul
)

:: Copy external configuration (must be editable)
echo   ✓ config.json (user configuration)
copy "config.json" ".dist\" >nul

:: Copy start scripts
echo   ✓ Start scripts
copy "start_jukebox.bat" ".dist\" >nul
copy "start_data_server.bat" ".dist\" >nul

:: Copy Node.js fallback files (in case EXE fails)
echo   ✓ Node.js fallback files
copy "jukebox_server.js" ".dist\" >nul
copy "data_server.js" ".dist\" >nul
copy "package.json" ".dist\" >nul

:: Create essential data directories
echo   ✓ Data directories
mkdir ".dist\data" >nul 2>&1
mkdir ".dist\data\artist-covers" >nul 2>&1
mkdir ".dist\data\covers" >nul 2>&1
mkdir ".dist\data\converted" >nul 2>&1
mkdir ".dist\cache" >nul 2>&1
mkdir ".dist\music" >nul 2>&1

:: Copy web application files (external for EXE compatibility)
echo   ✓ Web application files
copy "jukebox.html" ".dist\" >nul
copy "spotify_login.html" ".dist\" >nul
copy "style.css" ".dist\" >nul

:: Copy JavaScript modules
echo   ✓ JavaScript modules
mkdir ".dist\js" >nul 2>&1
xcopy "js\*" ".dist\js\" /Q >nul

:: Copy library files
echo   ✓ Library files
mkdir ".dist\lib" >nul 2>&1
xcopy "lib\*" ".dist\lib\" /Q >nul

:: Copy localization files
echo   ✓ Localization files
mkdir ".dist\locales" >nul 2>&1
xcopy "locales\*" ".dist\locales\" /Q >nul

:: Copy assets
echo   ✓ Assets
mkdir ".dist\assets" >nul 2>&1
xcopy "assets\*" ".dist\assets\" /Q >nul

:: Create installation README
echo   ✓ Creating INSTALL.txt
(
echo ╔══════════════════════════════════════════════════════════════╗
echo ║                  JUKEBOX - OPTIMIZED BUILD                  ║
echo ║                    Installation Guide                       ║
echo ╚══════════════════════════════════════════════════════════════╝
echo.
echo 🎵 JUKEBOX MUSIC PLAYER ^(Optimized Distribution^)
echo    This build contains executable files with all assets embedded.
echo.
echo 📋 WHAT'S INCLUDED:
echo    ✓ jukebox.exe              ^(Main player with embedded UI^)
echo    ✓ jukebox_data_server.exe  ^(Data server^)
echo    ✓ config.json              ^(Editable configuration^)
echo    ✓ Node.js fallback files   ^(If EXE fails^)
echo    ✓ Start scripts            ^(Easy launching^)
echo.
echo 🚀 QUICK START:
echo    1. Add music files to the 'music/' folder
echo    2. Double-click 'start_jukebox.bat'
echo    3. Browser opens automatically
echo    4. Admin access: Click gear icon ^(PIN: 1234^)
echo.
echo 🔧 CONFIGURATION:
echo    - Edit config.json for ports, paths, settings
echo    - Music folder: ./music/
echo    - Database: data/music.db ^(auto-created^)
echo.
echo 💡 TROUBLESHOOTING:
echo    If EXE files don't work:
echo    1. Install Node.js from https://nodejs.org/
echo    2. Run: npm install ^(in this folder^)
echo    3. Use start scripts ^(will auto-detect Node.js mode^)
echo.
echo 🎉 Enjoy your music! 🎵
) > ".dist\INSTALL.txt"

echo.
echo 🎉 Optimized distribution created successfully!
echo.
echo 📊 Distribution summary:
echo    📂 Location: .dist/ directory
echo    🎯 Type: Standalone executables with minimal dependencies
echo    📦 Size: Minimal ^(only essential files^)
echo.
echo 💡 What's COPIED (external for EXE compatibility):
echo    - HTML files ^(jukebox.html, spotify_login.html^)
echo    - CSS files ^(style.css^)  
echo    - JavaScript modules ^(js/*, lib/*^)
echo    - Localization files ^(locales/*^)
echo    - Assets ^(assets/*^)
echo.
echo ✅ Ready for deployment!
echo.
pause