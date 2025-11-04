# 🎵 nJukebox

A web-based jukebox application with local music library and Spotify integration. Built for personal use - may require customization for other scenarios.

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

- **Local Music Library**: Automatic scanning and indexing of MP3 files
- **Spotify Integration**: Stream Spotify tracks (Premium required)
- **Touch Interface**: Basic touch-optimized controls
- **Multi-language**: German and English support
- **Admin Panel**: Simple administration interface
- **Search**: Search through artists, albums, and tracks
- **Auto-DJ Mode**: Automatic playback when playlist is empty

## 🚀 Quick Start

### Prerequisites
- Node.js (v18+)
- npm

### Installation
```bash
git clone https://github.com/Nigcra/nJukebox.git
cd jukebox
npm install
```

### Setup Music Library
1. Create a `music/` folder in the project directory
2. Copy your MP3 files into this folder
3. The application will automatically scan for new files

### Running the Application

**Development Mode:**
```bash
# Start data server
npm start

# In another terminal: Start web server
node jukebox_server.js
```

**Production Mode (Windows):**
```batch
start_data_server.bat
start_jukebox.bat
```

**Production Mode (Linux/macOS):**
```bash
./start_data_server.sh
./start_jukebox.sh
```

### Access
- **Main Interface**: http://localhost:5500/jukebox.html
- **Admin Panel**: Click the 🔒 icon in the interface

## 🔧 Spotify Setup

1. Create a Spotify app at [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. Add `http://localhost:5500/spotify_login.html` as redirect URI
3. Open Admin Panel → Spotify Configuration
4. Enter your Client ID and Client Secret
5. Click the Spotify status indicator to log in

## 📁 Project Structure

```
jukebox/
├── assets/             # Static assets
├── js/                 # Frontend modules
├── lib/                # Backend modules
├── music/              # Local music library
├── jukebox.html        # Main interface
├── data_server.js      # Backend API server
├── jukebox_server.js   # Frontend web server
└── config.json         # Server configuration
```

## 🔨 Building

```bash
# Build executables
npm run build-data      # → jukebox_data_server.exe
npm run build-player    # → jukebox.exe
npm run build-all       # Build both

# Development
npm run dev            # Auto-reload mode
npm run scan           # Scan music library only
```

## 🎯 Kiosk Deployment

The application includes scripts for kiosk-style deployment, though this was configured for specific hardware and may need adjustments:
- Touch interface support
- Auto-start scripts included
- Chrome kiosk mode support
- Basic session persistence

## 📝 TODO

- [ ] Remote control (control by Smartphone / admin mode to skip bad songs etc.)
- [ ] Caching
- [ ] Bugfixing and code cleanup
- [ ] Better cover handling


## 📋 License

This project is licensed under the GNU General Public License v3.0 - see [LICENSE](LICENSE) for details.

**Note:** This project uses FFmpeg (via `ffmpeg-static`), which is licensed under GPL. Therefore, this project must also be distributed under a GPL-compatible license.


## 🤝 Contributing

This is a personal project, but contributions are welcome. Please note that the application is tailored for specific use cases and may require significant customization for different scenarios.

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

---

**🎵 Enjoy! 🎶**
