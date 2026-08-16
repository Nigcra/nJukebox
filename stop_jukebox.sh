#!/bin/bash
# stop_jukebox.sh
# Stops the nJukebox server and the kiosk browser it opened
# Version: 2026.08.13

set -u

echo "========================================"
echo "  Stopping nJukebox"
echo "========================================"
echo

stopped=0

# The server first, so the browser does not sit on a dead socket. Match the
# binary by name, not with a broad pattern - pkill -f on something generic can
# match the calling shell itself.
if pkill -x njukebox 2>/dev/null; then
	echo "  server        stopped"
	stopped=1
else
	echo "  server        was not running"
fi

# Only the kiosk instance. Other browser windows are left alone on purpose.
if pkill -f -- "--kiosk.*127.0.0.1:5500" 2>/dev/null; then
	echo "  kiosk browser stopped"
	stopped=1
else
	echo "  kiosk browser none found"
fi

# Whatever still holds a port has to go too. A binary started under a different
# name or an orphan from a crashed run survives the two steps above and keeps
# the port, and the next start fails with "address already in use".
for port in 5500 3001; do
	if command -v lsof >/dev/null 2>&1; then
		for pid in $(lsof -ti:"${port}" -sTCP:LISTEN 2>/dev/null); do
			name=$(ps -p "${pid}" -o comm= 2>/dev/null || echo unknown)
			echo "  port ${port}     PID ${pid} (${name}) stopped"
			kill -9 "${pid}" 2>/dev/null
			stopped=1
		done
	fi
done

echo
if [ "${stopped}" -eq 1 ]; then
	echo "Done."
else
	echo "Nothing was running."
fi

# Terminating a process is not instant. Check instead of assuming.
sleep 1

busy=0
for port in 5500 3001; do
	if command -v lsof >/dev/null 2>&1; then
		if lsof -ti:"${port}" -sTCP:LISTEN >/dev/null 2>&1; then
			echo
			echo "ERROR: port ${port} is still in use:"
			lsof -i:"${port}" -sTCP:LISTEN
			busy=1
		fi
	fi
done

if [ "${busy}" -eq 1 ]; then
	exit 1
fi

echo
echo 'Ports 5500 and 3001 are free.'
