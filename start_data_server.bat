@echo off
chcp 65001 >nul
echo ========================================
echo   🎵 Jukebox Data Server
echo ========================================
echo.
echo 📊 Server Information:
echo    - Port: 3001
echo    - API: http://127.0.0.1:3001/api/
echo    - Music Folder: ./music/
echo    - Database: ./data/music.db
echo.
echo 🚀 Starting Data Server...
echo.
echo 💡 Commands:
echo    - To stop: Press Ctrl+C or close window
echo    - API Status: http://127.0.0.1:3001/api/health
echo.

:: Check if exe exists and use it, otherwise use node
if exist "jukebox_data_server.exe" (
    echo Using executable version...
    .\jukebox_data_server.exe
) else (
    echo Using Node.js version...
    node data_server.js
)

echo.
echo ⚠️  Data Server stopped
echo    Press any key to close...
pause >nul
