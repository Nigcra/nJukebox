#!/bin/bash

# Set colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

PORT=5500
URL="http://127.0.0.1:$PORT/jukebox.html"
CHROME_PATH=""

echo "========================================"
echo "  🎵 Jukebox Player Starter"
echo "========================================"
echo ""
echo -e "${BLUE}📋 System Information:${NC}"
echo "   - Web Server Port: $PORT"
echo "   - Data Server Port: 3001"
echo "   - Web Interface: $URL"
echo "   - Auto-detects executable vs Node.js"
echo ""

# Try to find Chrome/Chromium browser
echo -e "${BLUE}🔍 Looking for Chrome Browser...${NC}"
if command -v google-chrome &> /dev/null; then
    CHROME_PATH="google-chrome"
    echo -e "   ${GREEN}✓ Chrome found: google-chrome${NC}"
elif command -v chromium-browser &> /dev/null; then
    CHROME_PATH="chromium-browser"
    echo -e "   ${GREEN}✓ Chromium found: chromium-browser${NC}"
elif command -v chromium &> /dev/null; then
    CHROME_PATH="chromium"
    echo -e "   ${GREEN}✓ Chromium found: chromium${NC}"
elif command -v firefox &> /dev/null; then
    CHROME_PATH="firefox"
    echo -e "   ${YELLOW}⚠ Firefox found (fallback): firefox${NC}"
else
    echo -e "   ${RED}❌ No supported browser found.${NC}"
    echo "      Please install Google Chrome, Chromium, or Firefox."
    echo ""
    echo "Press Enter to exit..."
    read
    exit 1
fi

echo ""
echo -e "${GREEN}🚀 Starting Player Server...${NC}"

# Check if executable exists and use it, otherwise use node
if [ -f "jukebox" ]; then
    echo -e "${GREEN}Using executable version for player...${NC}"
    ./jukebox &
    SERVER_PID=$!
else
    echo -e "${GREEN}Using Node.js version for player...${NC}"
    node jukebox_server.js &
    SERVER_PID=$!
fi

echo -e "${YELLOW}⏳ Waiting for player server startup (3 seconds)...${NC}"
sleep 3

echo -e "${BLUE}🌍 Opening Browser in Kiosk Mode...${NC}"
if [[ "$CHROME_PATH" == "firefox" ]]; then
    # Firefox kiosk mode
    firefox --kiosk "$URL" &
else
    # Chrome/Chromium kiosk mode
    $CHROME_PATH --kiosk --no-first-run --disable-infobars --disable-restore-session-state --disable-session-crashed-bubble --disable-features=TranslateUI "$URL" &
fi

echo ""
echo -e "${GREEN}✅ Jukebox Player ready! Start Data Server separately if needed.${NC}"
echo ""
echo -e "${YELLOW}💡 To stop: Close browser and press Ctrl+C${NC}"
echo ""

# Keep the script running and wait for Ctrl+C
echo "Press Ctrl+C to stop the server..."
trap "echo ''; echo 'Stopping server...'; kill $SERVER_PID 2>/dev/null; exit 0" INT

# Wait loop
while true; do
    sleep 5
done
