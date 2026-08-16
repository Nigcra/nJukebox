#!/bin/bash
# start_jukebox.sh
# Starts the server and opens the jukebox in a kiosk browser
# Version: 2026.08.13

set -u

PORT=5500
URL="http://127.0.0.1:${PORT}/jukebox.html"
BINARY="./njukebox"
BROWSER=""

cd "$(dirname "$0")" || exit 1

echo "========================================"
echo "  nJukebox Player"
echo "========================================"
echo
echo "  Web interface : ${URL}"
echo "  Data API      : http://127.0.0.1:3001/api/"
echo "  Binary        : ${BINARY}"
echo

if [ ! -x "${BINARY}" ]; then
	echo "ERROR: ${BINARY} not found or not executable."
	echo "Build it first:  go build -o njukebox ./cmd/njukebox"
	exit 1
fi

echo "Looking for a browser..."
for candidate in google-chrome chromium-browser chromium microsoft-edge; do
	if command -v "${candidate}" >/dev/null 2>&1; then
		BROWSER="${candidate}"
		break
	fi
done

if [ -z "${BROWSER}" ]; then
	echo "ERROR: no Chrome or Chromium found."
	echo "Spotify playback needs the Widevine module, which Firefox on Linux"
	echo "does not ship. Local MP3 playback would work in any browser."
	exit 1
fi
echo "  found: ${BROWSER}"
echo

echo "Starting server..."
"${BINARY}" &
SERVER_PID=$!

# Stop the server when this script ends, however it ends.
trap 'kill "${SERVER_PID}" 2>/dev/null' EXIT INT TERM

echo "Waiting for the server to answer..."
for _ in $(seq 1 30); do
	if curl -sf -o /dev/null http://127.0.0.1:3001/api/health; then
		break
	fi
	sleep 1
done

echo "Opening ${BROWSER} in kiosk mode..."
"${BROWSER}" --kiosk --no-first-run --disable-infobars \
	--disable-restore-session-state --disable-session-crashed-bubble \
	--disable-features=TranslateUI "${URL}" >/dev/null 2>&1

echo
echo "Browser closed, stopping the server."
