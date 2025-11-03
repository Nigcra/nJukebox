#!/bin/bash

# Set colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo "========================================"
echo "  🎵 Jukebox Data Server"
echo "========================================"
echo ""
echo -e "${BLUE}📊 Server Information:${NC}"
echo "   - Port: 3001"
echo "   - API: http://127.0.0.1:3001/api/"
echo "   - Music Folder: ./music/"
echo "   - Database: ./data/music.db"
echo ""
echo -e "${GREEN}🚀 Starting Data Server...${NC}"
echo ""
echo -e "${YELLOW}💡 Commands:${NC}"
echo "   - To stop: Press Ctrl+C"
echo "   - API Status: http://127.0.0.1:3001/api/health"
echo ""

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js not found. Please install Node.js first.${NC}"
    echo ""
    echo "Press Enter to exit..."
    read
    exit 1
fi

# Check if executable exists and use it, otherwise use node
if [ -f "jukebox_data_server" ]; then
    echo -e "${GREEN}Using executable version...${NC}"
    ./jukebox_data_server
else
    echo -e "${GREEN}Using Node.js version...${NC}"
    node data_server.js
fi

echo ""
echo -e "${RED}⚠️ Data Server stopped${NC}"
echo "   Press Enter to close..."
read
