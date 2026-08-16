# 🎵 nJukebox

**nJukebox** is a web-based jukebox application with local music library and Spotify integration. Built for personal use - may require customization for other scenarios.

> **Now written in Go.** nJukebox (short for *Nico's Jukebox*) started as a Node.js project and has been completely rewritten in Go - for **performance** (native code, lower memory footprint, fast startup), **stability** (a single statically linked binary with no runtime dependencies that can break - no Node.js, no `node_modules`, no native modules) and **security** (a minimal dependency tree and a memory-safe, statically typed language). The web frontend is unchanged; the entire server side is Go.

## 📸 Screenshots

### Main View
![Main View](https://njukebox.com/screenshots/main.png)
*Clean album grid view with cover art and navigation*

### Now Playing
![Now Playing](https://njukebox.com/screenshots/nowplaying.png)
*Full-screen visualization with multiple effect modes (Space, Fire, Particles, Circles)*

### Search Interface
![Search](https://njukebox.com/screenshots/search.png)
*Integrated search across local library and Spotify*

### Admin Panel
![Admin Panel](https://njukebox.com/screenshots/admin.png)
*Comprehensive settings, statistics, and Spotify learning features*

## ✨ Features

- **Local Music Library**: Automatic scanning and indexing of MP3 and FLAC files
- **Spotify Integration**: Stream Spotify tracks (Premium required)
- **Persistent Spotify Login**: Tokens live on the server and are renewed in the background, so the login survives a browser or machine restart
- **Touch Interface**: Basic touch-optimized controls
- **Multi-language**: German and English support
- **Admin Panel**: Simple administration interface
- **Search**: Search through artists, albums, and tracks
- **Auto-DJ Mode**: Automatic playback when playlist is empty

## 🚀 Quick Start

### Prerequisites

- Go 1.26 or newer - **only to build**. The resulting binary runs on its own.
- A Chromium based browser (Chrome or Edge) if you want Spotify playback. The Spotify Web Playback SDK needs the Widevine module, which Firefox on Linux and embedded webviews do not provide. Local playback works in any browser.

### Installation

```bash
git clone https://github.com/Nigcra/nJukebox.git
cd nJukeboxGO
go build -o njukebox ./cmd/njukebox
```

On Windows the binary is `njukebox.exe`. That single command is all you need; the `make` targets below are a convenience and require a POSIX shell, which Windows does not have by default.

### Setup Music Library

1. Create a `music/` folder in the project directory (the server creates it on first start)
2. Copy your MP3 and FLAC files into this folder
3. The application scans on startup and watches the folder while it runs

### Running the Application

One binary serves both ports:

```bash
./njukebox                 # web server on :5500 and data server on :3001
./njukebox --data-only     # only the data server
./njukebox --web-only      # only the web server
./njukebox --root <path>   # use another project directory
```

**Kiosk mode:**

```batch
start_jukebox.bat
stop_jukebox.cmd
```

```bash
./start_jukebox.sh
./stop_jukebox.sh
```

Start opens the interface in a kiosk browser, stop ends the server and that
browser window. Other browser windows are left alone.

**Development:**

```batch
dev.cmd
```

Same server, but a normal resizable window with DevTools already open and a
separate browser profile, so inspecting or clearing storage never touches the
kiosk session. The server log stays in the console; a key press stops it.

### The footer equalizer and Spotify

The equalizer analyses whatever audio it can reach through the Web Audio API.
For local tracks that is the audio element itself. **For Spotify it can only be
the microphone**, because the Web Playback SDK hands out no analysable stream:
the audio is DRM protected and bypasses the Web Audio graph entirely.

So the bars react to Spotify only if a recording device can hear the output.
Two situations rule that out, and no code can change either:

- **Headphones.** The microphone cannot hear what the headphones play.
- **A remote session.** Over RDP the audio is redirected to the client while the
  browser runs on the remote machine, which usually has no recording device at
  all. `getUserMedia` then fails with `NotFoundError: Requested device not
  found` - visible in the console when debugging is on.

The way out in both cases is a loopback recording device on the machine that
runs the browser - "Stereo Mix" if the sound card offers it, or a virtual audio
cable - selected as the microphone in the browser.

`equalizerDiagnostics()` in the browser console reports which sources are
connected, the device label, and the level currently measured.

### Library maintenance

The scanner indexes on startup and watches the folder while it runs. A track
whose file has disappeared is **not** removed right away: it has to be missing
on two consecutive scans. The counter lives in the database, so the two scans
may be two separate server starts.

Two more guards sit in front of the delete: a scan that finds no files at all
never removes anything, and a file on a volume that cannot be reached is not
counted as missing. An unplugged drive or a share that has not reconnected yet
therefore costs nothing.

### Access

- **Main Interface**: http://127.0.0.1:5500/
- **Admin Panel**: Click the 🔒 icon in the interface

Use `127.0.0.1`, not `localhost`. Spotify only accepts unencrypted HTTP redirect URIs for the loopback address, and the redirect URI is derived from the address you opened the page with.

## 🔧 Spotify Setup

1. Create a Spotify app at [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. Add `http://127.0.0.1:5500/spotify_login.html` as redirect URI
3. Open Admin Panel → Spotify Configuration
4. Enter your **Client ID**. No client secret is needed - authentication uses PKCE.
5. Click the Spotify status indicator to log in

The server stores the tokens and renews them in the background. The login survives closing the browser, restarting the machine and days of kiosk operation. Nothing Spotify related is kept in browser storage.

## 📁 Project Structure

```
nJukeboxGO/
├── cmd/njukebox/       # Entry point
├── internal/
│   ├── api/            # REST API
│   ├── appdb/          # Queue, session, settings, tokens
│   ├── musicdb/        # Library database
│   ├── scanner/        # Library scan and file watching
│   ├── spotify/        # PKCE, token refresh and rotation
│   ├── imaging/        # Cover scaling and artist mosaics
│   ├── web/            # Static file server
│   ├── config/         # config.json
│   └── jsonx/          # Order preserving JSON objects
├── web/                # Everything the browser loads - and nothing else
│   ├── jukebox.html  style.css  jukebox.js  spotify_login.html
│   └── js/  assets/  locales/
├── music/              # Local music library
├── data/               # Databases and generated covers
├── tools/              # Verification tooling
└── config.json         # Server configuration
```

## 🔨 Building

```bash
make build              # current platform
make dist               # Windows, Linux, macOS (Intel and ARM)
make check              # fmt, vet and tests
make verify             # full acceptance suite, needs PowerShell 7
```

The Makefile needs `make` and a POSIX shell. On Windows use `build.cmd`, which
covers the same ground without either:

```batch
build.cmd            REM binary for this machine
build.cmd check      REM gofmt, vet and the tests
build.cmd all        REM check, then build
build.cmd dist       REM Windows, Linux and macOS into dist\
build.cmd verify     REM the full acceptance suite, needs PowerShell 7
build.cmd clean      REM remove the binary and dist\
```

It refuses to overwrite a running server instead of failing with a bare access
error. A plain `go build -o njukebox.exe .\cmd\njukebox` works just as well.

`CGO_ENABLED=0` throughout, so cross-compilation needs no toolchain and the binary runs without a C runtime.

## 🧪 Verification

```bash
go test ./...              # the whole suite
pwsh tools/verify_web.ps1  # URL rewrites, path allowlist, traversal defence
```

`verify_web.ps1` builds a binary, serves a temporary directory and drives it over a socket, so it covers what the Go tests cannot: the real listener.

Every test builds what it needs in a temporary directory - MP3 and FLAC files, images, databases, HTTP responses. There is no `testdata/` in this repository and no binary fixture; a fresh clone runs the suite with nothing but a Go toolchain.

During the port everything was additionally compared against a frozen baseline captured from the running Node server - 93 responses byte for byte including ETags, plus a diff of the scanner output against the database Node produced, both at zero deviations. That comparison retired with the port: Node is gone, the baseline could only ever be regenerated from it, and the API has since grown features the original never had. The evidence that the port itself changed no behaviour is in the git history and in `CHANGELOG.md`.

## 🎯 Kiosk Deployment

The application includes scripts for kiosk-style deployment, though this was configured for specific hardware and may need adjustments:

- Touch interface support
- Auto-start scripts included
- Chrome kiosk mode support
- Session persistence, including the Spotify login

## 📝 TODO

- [ ] Remote control (control by Smartphone / admin mode to skip bad songs etc.)
- [ ] Caching
- [ ] Bugfixing and code cleanup
- [ ] Better cover handling
- [ ] Party games / fun questions and mentions

## 📋 License

This project is licensed under the GNU General Public License v3.0 - see [LICENSE](LICENSE) for details.

Earlier versions bundled FFmpeg through `ffmpeg-static` and inherited its GPL obligation. FFmpeg is gone: metadata, duration and cover extraction are handled in pure Go. The GPL now applies because it is this project's own choice, not because a dependency forces it.

Bundled fonts and Go modules carry their own permissive licenses. They are listed in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

## 🤝 Contributing

This is a personal project, but contributions are welcome. Please note that the application is tailored for specific use cases and may require significant customization for different scenarios.

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

---

**🎵 Enjoy! 🎶**
