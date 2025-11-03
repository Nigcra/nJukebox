const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs-extra');
const MusicDatabase = require('./lib/music_database');
const MusicScanner = require('./lib/music_scanner');
const AppDatabase = require('./lib/app_database');

// Determine the correct root directory for both PKG and normal execution
let ROOT_PATH;
if (process.pkg) {
  // Running in PKG - use current working directory (where exe is executed from)
  ROOT_PATH = process.cwd();
  console.log('[SERVER] 🔧 PKG Mode - Working directory:', ROOT_PATH);
} else {
  // Running normally with Node.js - use script directory
  ROOT_PATH = __dirname;
  console.log('[SERVER] 🔧 Development Mode - Working directory:', ROOT_PATH);
}

// Load configuration
let config = {};
try {
  const configPath = path.join(ROOT_PATH, 'config.json');
  if (fs.existsSync(configPath)) {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    console.log('[SERVER] 📋 Configuration loaded from config.json');
  }
} catch (error) {
  console.warn('[SERVER] ⚠️ Failed to load config.json, using defaults:', error.message);
}

const app = express();
const PORT = process.env.PORT || config.server?.dataPort || 3001;
const HOST = config.server?.host || '127.0.0.1';

// Global debugging system
let isDebuggingEnabled = false;
const loggedMessages = new Set();
const logCooldown = new Map();

// Debug function with spam prevention and cooldown
function debugLog(category, ...args) {
  if (isDebuggingEnabled) {
    const message = `[${category.toUpperCase()}] ${args.join(' ')}`;
    const now = Date.now();
    
    if (!logCooldown.has(message) || (now - logCooldown.get(message)) > 5000) {
      console.log(`[${category.toUpperCase()}]`, ...args);
      logCooldown.set(message, now);
      
      // Cleanup old entries to prevent memory leak
      if (logCooldown.size > 100) {
        const cutoff = now - 60000;
        for (const [msg, timestamp] of logCooldown.entries()) {
          if (timestamp < cutoff) {
            logCooldown.delete(msg);
          }
        }
      }
    }
  }
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Initialize database and scanner
let musicDB = null;
let appDB = null;
let musicScanner = null;

// Cache for converted audio files
const conversionCache = new Map();

async function initializeServer() {
  try {
    debugLog('SERVER', '🎵 Jukebox Data Server starting...');
    
    // Ensure directories exist
    await fs.ensureDir(path.join(ROOT_PATH, 'music'));
    await fs.ensureDir(path.join(ROOT_PATH, 'data/converted'));
    
    // Initialize database
    musicDB = new MusicDatabase(path.join(ROOT_PATH, 'data/music.db'));
    await musicDB.init();
    await musicDB.createTables();
    
    // Initialize app database (queue, session, settings)
    appDB = new AppDatabase(path.join(ROOT_PATH, 'data/app.db'));
    await appDB.init();
    await appDB.createTables();
    
    // Restore settings cache
    await appDB.restoreCache();
    
    // Load debugging setting
    isDebuggingEnabled = await appDB.getSetting('admin', 'debuggingEnabled', true);
    debugLog('SERVER', `🔧 Debugging ${isDebuggingEnabled ? 'enabled' : 'disabled'}`);
    
    // Initialize scanner
    musicScanner = new MusicScanner(path.join(ROOT_PATH, 'music'), musicDB);
    await musicScanner.init();
    
    debugLog('SERVER', '✅ Data Server initialized successfully');
    
    // Start initial scan
    debugLog('SERVER', '🔍 Starting initial music scan...');
    await musicScanner.scanAll();
    debugLog('SERVER', '📊 Initial scan completed');
    
    // Start simple token cleanup (daily)
    setInterval(async () => {
      try {
        const deletedCount = await appDB.cleanupExpiredSpotifyTokens();
        if (deletedCount > 0) {
          debugLog('SERVER', `🧹 Cleaned up ${deletedCount} expired Spotify token(s)`);
        }
      } catch (error) {
        debugLog('SERVER', '❌ Token cleanup failed:', error.message);
      }
    }, 24 * 60 * 60 * 1000); // Every 24 hours
    
  } catch (error) {
    debugLog('SERVER', '❌ Failed to initialize server:', error.message);
    console.error('❌ Failed to initialize server:', error);
    process.exit(1);
  }
}

// API Routes

app.get('/api/tracks', async (req, res) => {
  try {
    const { artist, album, genre, year, search, limit = 50000, offset = 0 } = req.query;
    
    const tracks = await musicDB.getTracks({
      artist,
      album, 
      genre,
      year,
      search,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
    
    res.json({
      success: true,
      data: tracks,
      total: tracks.length
    });
  } catch (error) {
    debugLog('SERVER', '❌ Error fetching tracks:', error.message);
    console.error('Error fetching tracks:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/tracks/:id', async (req, res) => {
  try {
    const track = await musicDB.getTrackById(req.params.id);
    if (!track) {
      return res.status(404).json({ success: false, error: 'Track not found' });
    }
    res.json({ success: true, data: track });
  } catch (error) {
    debugLog('SERVER', '❌ Error fetching track:', error.message);
    console.error('Error fetching track:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/stream/:id', async (req, res) => {
  try {
    const track = await musicDB.getTrackById(req.params.id);
    if (!track) {
      return res.status(404).json({ success: false, error: 'Track not found' });
    }
    
    // Handle both relative and absolute paths correctly
    let filePath;
    if (path.isAbsolute(track.file_path)) {
      // If file_path is absolute, check if it exists as-is first
      if (await fs.pathExists(track.file_path)) {
        filePath = track.file_path;
      } else {
        // If absolute path doesn't exist, try to make it relative to ROOT_PATH
        const relativePath = path.relative(path.dirname(ROOT_PATH), track.file_path);
        filePath = path.join(ROOT_PATH, relativePath);
      }
    } else {
      // If file_path is relative, join with ROOT_PATH
      filePath = path.join(ROOT_PATH, track.file_path);
    }
    
    if (!await fs.pathExists(filePath)) {
      return res.status(404).json({ success: false, error: 'Audio file not found', attempted_path: filePath });
    }
    
    const fileExtension = path.extname(filePath).toLowerCase();
    if (fileExtension !== '.mp3') {
      return res.status(415).json({ success: false, error: 'Unsupported media type. Only MP3 files are supported.' });
    }
    
    debugLog('STREAM', `🎵 Serving MP3: ${track.title}`);
    
    const stat = await fs.stat(filePath);
    const range = req.headers.range;
    
    if (range) {
      // Handle range requests for audio seeking
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
      const chunksize = (end - start) + 1;
      
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'public, max-age=3600',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Range'
      });
      
      fs.createReadStream(filePath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Type': 'audio/mpeg',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Range',
        'Content-Length': stat.size,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=3600'
      });
      
      fs.createReadStream(filePath).pipe(res);
    }
    
  } catch (error) {
    debugLog('SERVER', '❌ Error streaming track:', error.message);
    console.error('Error streaming track:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get cover art
app.get('/api/cover/:id', async (req, res) => {
  try {
    // Cache headers for browser cache (1 hour)
    res.set({
      'Cache-Control': 'public, max-age=3600',
      'ETag': `"cover-${req.params.id}"`
    });
    
    const track = await musicDB.getTrackById(req.params.id);
    if (!track || !track.cover_path) {
      return res.sendFile(path.join(ROOT_PATH, 'assets/default_cover.png'));
    }
    
    const coverPath = path.join(ROOT_PATH, track.cover_path);
    if (!await fs.pathExists(coverPath)) {
      return res.sendFile(path.join(ROOT_PATH, 'assets/default_cover.png'));
    }
    
    res.sendFile(coverPath);
  } catch (error) {
    debugLog('COVER', '❌ Error fetching cover:', error.message);
    console.error('Error fetching cover:', error);
    res.sendFile(path.join(ROOT_PATH, 'assets/default_cover.png'));
  }
});

// Get album cover by artist and album name
app.get('/api/album-cover/:albumKey', async (req, res) => {
  try {
    // Cache headers for browser cache (1 hour)
    // Clean ETag value - only alphanumeric characters and hyphens
    const cleanAlbumKey = req.params.albumKey.replace(/[^a-zA-Z0-9-]/g, '-');
    res.set({
      'Cache-Control': 'public, max-age=3600',
      'ETag': `"album-${cleanAlbumKey}"`
    });
    
    debugLog('COVER', `Requesting album cover for: ${req.params.albumKey}`);
    
    let albumKey;
    try {
      albumKey = decodeURIComponent(req.params.albumKey);
    } catch (error) {
      debugLog('COVER', `URI decode error for "${req.params.albumKey}": ${error.message}`);
      // If decoding fails, use the original parameter
      albumKey = req.params.albumKey;
    }
    
    const [artist, album] = albumKey.split('||');
    
    debugLog('COVER', `Parsed artist: "${artist}", album: "${album}"`);
    
    if (!artist || !album) {
      debugLog('COVER', `Invalid artist/album, returning default cover`);
      return res.sendFile(path.join(ROOT_PATH, 'assets/default_cover.png'));
    }
    
    // Find any track from this album that has a cover
    const trackWithCover = await musicDB.getTrackWithCover(artist, album);
    debugLog('COVER', `Found track with cover:`, trackWithCover ? 'Yes' : 'No');
    
    if (!trackWithCover || !trackWithCover.cover_path) {
      debugLog('COVER', `No cover found, returning default cover`);
      return res.sendFile(path.join(ROOT_PATH, 'assets/default_cover.png'));
    }
    
    const coverPath = path.join(ROOT_PATH, trackWithCover.cover_path);
    if (!await fs.pathExists(coverPath)) {
      debugLog('COVER', `Cover file not found at ${coverPath}, returning default cover`);
      return res.sendFile(path.join(ROOT_PATH, 'assets/default_cover.png'));
    }
    
    debugLog('COVER', `Serving cover from: ${coverPath}`);
    res.sendFile(coverPath);
  } catch (error) {
    debugLog('COVER', '❌ Error fetching album cover:', error.message);
    console.error('Error fetching album cover:', error);
    res.sendFile(path.join(ROOT_PATH, 'assets/default_cover.png'));
  }
});

// Get artist cover - mosaic of all album covers
app.get('/api/artist-cover/:artistName', async (req, res) => {
  try {
    // Cache headers for browser cache (1 hour)
    // Clean ETag value - only alphanumeric characters and hyphens
    const cleanArtistName = req.params.artistName.replace(/[^a-zA-Z0-9-]/g, '-');
    res.set({
      'Cache-Control': 'public, max-age=3600',
      'ETag': `"artist-${cleanArtistName}"`
    });
    
    let artistName;
    try {
      artistName = decodeURIComponent(req.params.artistName);
    } catch (error) {
      debugLog('COVER', `URI decode error for artist "${req.params.artistName}": ${error.message}`);
      // If decoding fails, use the original parameter
      artistName = req.params.artistName;
    }
    
    debugLog('COVER', `Requesting artist cover for: ${artistName}`);
    
    // Get all album covers for this artist
    const albumCovers = await musicDB.getArtistAlbumCovers(artistName);
    debugLog('COVER', `Found ${albumCovers.length} album covers for ${artistName}`);
    
    if (albumCovers.length === 0) {
      debugLog('COVER', `No covers found, returning default cover`);
      return res.sendFile(path.join(ROOT_PATH, 'assets/default_cover.png'));
    }
    
    // Create cache directory for artist covers
    const artistCoverCacheDir = path.join(ROOT_PATH, 'data/artist-covers');
    await fs.ensureDir(artistCoverCacheDir);
    
    // Create a safe filename for the artist
    const safeArtistName = artistName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const artistCoverPath = path.join(artistCoverCacheDir, `${safeArtistName}_mosaic.jpg`);
    
    // Check if cached version exists and is recent
    try {
      const cacheStats = await fs.stat(artistCoverPath);
      const cacheAge = Date.now() - cacheStats.mtime.getTime();
      const maxCacheAge = 24 * 60 * 60 * 1000; // 24 hours
      
      if (cacheAge < maxCacheAge) {
        debugLog('COVER', `Serving cached artist cover: ${artistCoverPath}`);
        return res.sendFile(artistCoverPath);
      }
    } catch (err) {
      // Cache doesn't exist, will create new one
    }
    
    debugLog('COVER', `Generating new artist mosaic for: ${artistName}`);
    
    // Import sharp for image processing
    const sharp = require('sharp');
    
    // Determine grid size based on number of covers
    let gridSize;
    if (albumCovers.length === 1) {
      gridSize = { cols: 1, rows: 1 };
    } else if (albumCovers.length <= 4) {
      gridSize = { cols: 2, rows: 2 };
    } else if (albumCovers.length <= 9) {
      gridSize = { cols: 3, rows: 3 };
    } else if (albumCovers.length <= 16) {
      gridSize = { cols: 4, rows: 4 };
    } else {
      gridSize = { cols: 5, rows: 5 };
    }
    
    const maxCovers = gridSize.cols * gridSize.rows;
    const useCovers = albumCovers.slice(0, maxCovers);
    
    // Cover size in final mosaic
    const coverSize = 150;
    const mosaicWidth = gridSize.cols * coverSize;
    const mosaicHeight = gridSize.rows * coverSize;
    
    // Create mosaic background
    const mosaic = sharp({
      create: {
        width: mosaicWidth,
        height: mosaicHeight,
        channels: 3,
        background: { r: 40, g: 40, b: 40 }
      }
    }).jpeg({ quality: 85 });
    
    // Prepare cover images
    const coverImages = [];
    for (let i = 0; i < useCovers.length; i++) {
      const cover = useCovers[i];
      const coverPath = path.join(ROOT_PATH, cover.cover_path);
      
      try {
        // Check if cover file exists
        await fs.access(coverPath);
        
        // Resize cover to fit in grid
        const resizedCover = await sharp(coverPath)
          .resize(coverSize, coverSize, { fit: 'cover' })
          .jpeg({ quality: 80 })
          .toBuffer();
          
        // Calculate position in grid
        const row = Math.floor(i / gridSize.cols);
        const col = i % gridSize.cols;
        const left = col * coverSize;
        const top = row * coverSize;
        
        coverImages.push({
          input: resizedCover,
          left: left,
          top: top
        });
        
      } catch (err) {
        debugLog('COVER', `⚠️ Could not process cover: ${coverPath} - ${err.message}`);
      }
    }
    
    // Composite all covers into mosaic
    if (coverImages.length > 0) {
      const finalMosaic = await mosaic.composite(coverImages).toBuffer();
      
      // Save to cache
      await fs.writeFile(artistCoverPath, finalMosaic);
      debugLog('COVER', `Created and cached artist mosaic: ${artistCoverPath}`);
      
      // Send the generated mosaic
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=86400'); // 24 hours cache
      res.send(finalMosaic);
    } else {
      debugLog('COVER', `No valid covers found, returning default`);
      res.sendFile(path.join(ROOT_PATH, 'assets/default_cover.png'));
    }
    
  } catch (error) {
    debugLog('COVER', '❌ Error creating artist cover:', error.message);
    console.error('Error creating artist cover:', error);
    res.sendFile(path.join(ROOT_PATH, 'assets/default_cover.png'));
  }
});

// Get all artists
app.get('/api/artists', async (req, res) => {
  try {
    const artists = await musicDB.getArtists();
    res.json({ success: true, data: artists });
  } catch (error) {
    debugLog('SERVER', '❌ Error fetching artists:', error.message);
    console.error('Error fetching artists:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get all albums
app.get('/api/albums', async (req, res) => {
  try {
    const { artist } = req.query;
    const albums = await musicDB.getAlbums(artist);
    res.json({ success: true, data: albums });
  } catch (error) {
    debugLog('SERVER', '❌ Error fetching albums:', error.message);
    console.error('Error fetching albums:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get all genres
app.get('/api/genres', async (req, res) => {
  try {
    const genres = await musicDB.getGenres();
    res.json({ success: true, data: genres });
  } catch (error) {
    debugLog('SERVER', '❌ Error fetching genres:', error.message);
    console.error('Error fetching genres:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Manual rescan
app.post('/api/rescan', async (req, res) => {
  try {
    debugLog('SERVER', '🔄 Manual rescan requested');
    await musicScanner.scanAll();
    res.json({ success: true, message: 'Rescan completed' });
  } catch (error) {
    debugLog('SERVER', '❌ Error during rescan:', error.message);
    console.error('Error during rescan:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update track play count
app.post('/api/tracks/:id/play', async (req, res) => {
  try {
    const trackId = req.params.id;
    const track = await musicDB.getTrackById(trackId);
    
    if (!track) {
      return res.status(404).json({ success: false, error: 'Track not found' });
    }
    
    await musicDB.updateTrackPlayCount(trackId);
    debugLog('DATA-API', `📊 Updated play count for: ${track.title} by ${track.artist}`);
    
    res.json({ 
      success: true, 
      message: 'Play count updated',
      trackId: parseInt(trackId)
    });
  } catch (error) {
    debugLog('DATA-API', '❌ Error updating track play count:', error.message);
    console.error('Error updating track play count:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update Spotify track play count  
app.post('/api/spotify/:spotify_id/play', async (req, res) => {
  try {
    let spotifyId = req.params.spotify_id;
    const { trackData } = req.body; // Optional track data for auto-adding
    
    // Remove 'spotify_' prefix if present (fix for prefixed IDs)
    if (spotifyId.startsWith('spotify_')) {
      spotifyId = spotifyId.replace('spotify_', '');
      debugLog('SPOTIFY', `Removed spotify_ prefix, using ID: ${spotifyId}`);
    }
    
    let track = await musicDB.getSpotifyTrack(spotifyId);
    
    if (!track) {
      // If track data is provided, try to add the track automatically
      if (trackData && trackData.title && trackData.artist) {
        debugLog('SPOTIFY', `Auto-adding Spotify track: ${trackData.title} by ${trackData.artist}`);
        
        const spotifyTrack = {
          spotify_id: spotifyId,
          title: trackData.title,
          artist: trackData.artist,
          album: trackData.album || '',
          duration_ms: trackData.duration_ms || 0,
          preview_url: trackData.preview_url || null,
          external_url: trackData.external_url || null,
          image_url: trackData.image_url || null,
          popularity: trackData.popularity || 0,
          added_at: new Date().toISOString()
        };
        
        try {
          const trackId = await musicDB.addSpotifyTrack(spotifyTrack);
          track = await musicDB.getSpotifyTrack(spotifyId);
          debugLog('SPOTIFY', `📊 Auto-added Spotify track: ${trackData.title} by ${trackData.artist}`);
        } catch (addError) {
          debugLog('SPOTIFY', `⚠️ Could not auto-add Spotify track ${spotifyId}: ${addError.message}`);
        }
      }
      
      if (!track) {
        // Track still not found - return success but no action taken
        debugLog('SPOTIFY', `Track ${spotifyId} not found in database - skipping play count`);
        return res.json({ 
          success: true, 
          message: 'Spotify track not in database - play count not recorded',
          spotifyId: spotifyId,
          tracked: false
        });
      }
    }
    
    // Update play count for existing/added track
    await musicDB.updateSpotifyTrackPlayCount(spotifyId);
    debugLog('SPOTIFY', `📊 Updated Spotify play count for: ${track.title} by ${track.artist}`);
    
    res.json({ 
      success: true, 
      message: 'Spotify play count updated',
      spotifyId: spotifyId,
      tracked: true
    });
  } catch (error) {
    console.error('Error updating Spotify track play count:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get most played tracks
app.get('/api/most-played', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const tracks = await musicDB.getMostPlayedTracks(limit);
    
    res.json({ 
      success: true, 
      data: tracks,
      total: tracks.length
    });
  } catch (error) {
    console.error('Error fetching most played tracks:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get play statistics
app.get('/api/play-stats', async (req, res) => {
  try {
    const stats = await musicDB.getPlayStats();
    
    res.json({ 
      success: true, 
      data: stats
    });
  } catch (error) {
    console.error('Error fetching play statistics:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get play statistics for GEMA reporting (by date range)
app.get('/api/plays', async (req, res) => {
  try {
    const { start, end } = req.query;
    
    if (!start || !end) {
      return res.status(400).json({ 
        success: false, 
        error: 'Start and end timestamps are required' 
      });
    }
    
    const startTimestamp = parseInt(start);
    const endTimestamp = parseInt(end);
    
    if (isNaN(startTimestamp) || isNaN(endTimestamp)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid timestamp format' 
      });
    }
    
    debugLog('REPORTING', `Fetching plays from ${new Date(startTimestamp)} to ${new Date(endTimestamp)}`);
    
    const plays = await musicDB.getPlaysForPeriod(startTimestamp, endTimestamp);
    
    res.json({ 
      success: true, 
      plays: plays,
      count: plays.length,
      period: {
        start: new Date(startTimestamp).toISOString(),
        end: new Date(endTimestamp).toISOString()
      }
    });
  } catch (error) {
    console.error('Error fetching plays for period:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Record detailed play history for GEMA reporting
app.post('/api/play-history', async (req, res) => {
  try {
    const { trackData, source } = req.body;
    
    if (!trackData || !source) {
      return res.status(400).json({ 
        success: false, 
        error: 'Track data and source are required' 
      });
    }
    
    if (!['local', 'spotify'].includes(source)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Source must be either "local" or "spotify"' 
      });
    }
    
    debugLog('REPORTING', `Recording play history: ${trackData.artist} - ${trackData.title} (${source})`);
    
    const result = await musicDB.recordPlayHistory(trackData, source);
    
    res.json({ 
      success: true, 
      data: result,
      message: 'Play history recorded successfully'
    });
  } catch (error) {
    console.error('Error recording play history:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Server stats
app.get('/api/stats', async (req, res) => {
  try {
    const stats = await musicDB.getStats();
    res.json({ success: true, data: stats });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    success: true, 
    status: 'healthy',
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    debugging: isDebuggingEnabled
  });
});

// Debug configuration endpoint
app.post('/api/debug-config', (req, res) => {
  try {
    const { enabled } = req.body;
    if (typeof enabled === 'boolean') {
      isDebuggingEnabled = enabled;
      if (enabled) {
        console.log('[SERVER] 🐛 DATA SERVER DEBUGGING AKTIVIERT - Debug-Ausgaben werden angezeigt');
        debugLog('SERVER', 'Debugging wurde vom Frontend eingeschaltet');
      } else {
        console.log('[SERVER] 🔇 Normal server mode active, enable debugging in the Jukebox App for debug output.');
      }
      res.json({ success: true, debugging: isDebuggingEnabled });
    } else {
      res.status(400).json({ success: false, error: 'Invalid enabled parameter' });
    }
  } catch (error) {
    console.error('Error updating debug config:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/debug-config', (req, res) => {
  res.json({ success: true, debugging: isDebuggingEnabled });
});

// Spotify Integration Routes

// Add Spotify track to database
app.post('/api/spotify/add', async (req, res) => {
  try {
    const {
      spotify_id,
      name,
      artist,
      album,
      year,
      genre,
      duration_ms,
      image_url,
      preview_url,
      spotify_uri,
      popularity
    } = req.body;

    // Check if track already exists
    const existingTrack = await musicDB.getSpotifyTrack(spotify_id);
    if (existingTrack) {
      // Check if track was recently added (within last 60 minutes)
      const addedDate = new Date(existingTrack.added_date);
      const now = new Date();
      const timeDifference = now - addedDate;
      const oneHourMs = 60 * 60 * 1000; // 60 minutes in milliseconds
      
      if (timeDifference < oneHourMs) {
        const remainingMinutes = Math.ceil((oneHourMs - timeDifference) / (60 * 1000));
        return res.status(429).json({ 
          success: false, 
          message: `Track wurde kürzlich hinzugefügt. Bitte warte noch ${remainingMinutes} Minuten.`,
          remainingMinutes: remainingMinutes
        });
      }
      
      return res.json({ 
        success: true, 
        message: 'Track already in library',
        track: existingTrack 
      });
    }

    // Add track to database
    const trackId = await musicDB.addSpotifyTrack({
      spotify_id,
      title: name,
      artist,
      album,
      year: parseInt(year) || null,
      genre,
      duration: Math.floor(duration_ms / 1000),
      image_url,
      preview_url,
      spotify_uri,
      popularity: popularity || 0,
      added_date: new Date().toISOString()
    });

    const track = await musicDB.getTrackById(trackId);
    
    debugLog('SPOTIFY', `✅ Added Spotify track: ${artist} - ${name}`);
    
    res.json({ 
      success: true, 
      message: 'Track added to library',
      track 
    });
  } catch (error) {
    console.error('Error adding Spotify track:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get Spotify tracks from database
app.get('/api/spotify/tracks', async (req, res) => {
  try {
    const { limit = 50, offset = 0, search } = req.query;
    const tracks = await musicDB.getSpotifyTracks({ 
      limit: parseInt(limit), 
      offset: parseInt(offset),
      search 
    });
    
    res.json({ 
      success: true, 
      tracks,
      count: tracks.length 
    });
  } catch (error) {
    console.error('Error fetching Spotify tracks:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Remove Spotify track from database
app.delete('/api/spotify/:spotify_id', async (req, res) => {
  try {
    const { spotify_id } = req.params;
    await musicDB.removeSpotifyTrack(spotify_id);
    
    debugLog('SPOTIFY', `🗑️ Removed Spotify track: ${spotify_id}`);
    
    res.json({ 
      success: true, 
      message: 'Spotify track removed from library' 
    });
  } catch (error) {
    console.error('Error removing Spotify track:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Bulk add Spotify tracks (for auto-learning)
app.post('/api/spotify/bulk-add', async (req, res) => {
  try {
    const { tracks } = req.body;
    
    if (!Array.isArray(tracks)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Tracks must be an array' 
      });
    }

    let addedCount = 0;
    let skippedCount = 0;
    const results = [];

    for (const trackData of tracks) {
      try {
        // Check if track already exists
        const existingTrack = await musicDB.getSpotifyTrack(trackData.spotify_id);
        if (existingTrack) {
          skippedCount++;
          continue;
        }

        // Add track to database
        const trackId = await musicDB.addSpotifyTrack({
          spotify_id: trackData.spotify_id,
          title: trackData.name,
          artist: trackData.artist,
          album: trackData.album,
          year: parseInt(trackData.year) || null,
          genre: trackData.genre || 'Unknown',
          duration: Math.floor(trackData.duration_ms / 1000),
          image_url: trackData.image_url,
          preview_url: trackData.preview_url,
          spotify_uri: trackData.spotify_uri,
          popularity: trackData.popularity || 0,
          added_date: new Date().toISOString()
        });

        addedCount++;
        results.push({ trackId, spotify_id: trackData.spotify_id });
      } catch (error) {
        debugLog('SPOTIFY', `❌ Failed to add track ${trackData.spotify_id}: ${error.message}`);
      }
    }

    debugLog('SPOTIFY', `✅ Bulk added ${addedCount} Spotify tracks, skipped ${skippedCount} existing`);
    
    res.json({ 
      success: true, 
      message: `Added ${addedCount} tracks, skipped ${skippedCount} existing`,
      addedCount,
      skippedCount,
      results
    });
  } catch (error) {
    console.error('Error bulk adding Spotify tracks:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Clean up orphaned database entries
app.post('/api/cleanup', async (req, res) => {
  try {
    debugLog('SERVER', '🧹 Starting database cleanup...');
    
    // Get all tracks from database using getTracks method
    const tracks = await musicDB.getTracks({ limit: 10000 });
    let removedCount = 0;
    
    for (const track of tracks) {
      if (track.file_path && !await fs.pathExists(track.file_path)) {
        // File doesn't exist, remove from database using ID
        await musicDB.removeTrack(track.id);
        removedCount++;
        debugLog('SERVER', `🗑️ Removed orphaned track: ${track.title} (${track.file_path})`);
      }
    }
    
    // Clean up empty artists and albums
    await musicDB.cleanupOrphans();
    
    debugLog('SERVER', `✅ Cleanup completed: ${removedCount} orphaned tracks removed`);
    
    res.json({ 
      success: true, 
      message: `Cleanup completed: ${removedCount} orphaned tracks removed`,
      removedCount 
    });
  } catch (error) {
    console.error('❌ Cleanup failed:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Clear entire database (admin function)
app.post('/api/clear-database', async (req, res) => {
  try {
    debugLog('SERVER', '🗑️ Starting complete database clear...');
    
    await musicDB.clearDatabase();
    
    debugLog('SERVER', '✅ Database cleared successfully');
    
    res.json({ 
      success: true, 
      message: 'Database cleared successfully'
    });
  } catch (error) {
    console.error('❌ Database clear failed:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Get conversion status for a track
app.get('/api/conversion-status/:id', async (req, res) => {
  try {
    const track = await musicDB.getTrackById(req.params.id);
    if (!track) {
      return res.status(404).json({ success: false, error: 'Track not found' });
    }
    
    const fileExtension = path.extname(track.file_path).toLowerCase();
    const needsConversion = ['.flac', '.ogg', '.m4a', '.wma'].includes(fileExtension);
    
    if (!needsConversion) {
      return res.json({ 
        success: true, 
        needsConversion: false,
        format: fileExtension,
        status: 'native' 
      });
    }
    
    const cacheKey = `${track.id}_${track.file_mtime}`;
    const cachedPath = path.join(ROOT_PATH, 'data/converted', `${cacheKey}.mp3`);
    const isCached = await fs.pathExists(cachedPath);
    
    res.json({
      success: true,
      needsConversion: true,
      originalFormat: fileExtension,
      targetFormat: '.mp3',
      isCached: isCached,
      status: isCached ? 'cached' : 'will-convert'
    });
  } catch (error) {
    console.error('Error checking conversion status:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

// Custom Playlists API
let customPlaylists = [];

// Load custom playlists from file on startup
const customPlaylistsFile = path.join(ROOT_PATH, 'data', 'custom_playlists.json');
try {
  if (fs.existsSync(customPlaylistsFile)) {
    const data = fs.readFileSync(customPlaylistsFile, 'utf8');
    customPlaylists = JSON.parse(data);
    debugLog('SERVER', `📋 Loaded ${customPlaylists.length} custom playlists`);
  }
} catch (error) {
  debugLog('SERVER', `⚠️ Failed to load custom playlists: ${error.message}`);
  customPlaylists = [];
}

// Save custom playlists to file
function saveCustomPlaylists() {
  try {
    fs.ensureDirSync(path.dirname(customPlaylistsFile));
    fs.writeFileSync(customPlaylistsFile, JSON.stringify(customPlaylists, null, 2));
  } catch (error) {
    console.error('❌ Failed to save custom playlists:', error);
  }
}

// Get all custom playlists
app.get('/api/custom-playlists', async (req, res) => {
  try {
    const playlists = await musicDB.getCustomPlaylists();
    res.json({ playlists });
  } catch (error) {
    console.error('Error getting custom playlists:', error);
    res.status(500).json({ error: 'Failed to get custom playlists' });
  }
});

// Add new custom playlist
app.post('/api/custom-playlists', async (req, res) => {
  try {
    const { name, url } = req.body;
    
    if (!name || !url) {
      return res.status(400).json({ error: 'Name and URL are required' });
    }
    
    // Validate Spotify URL
    if (!url.includes('spotify.com/playlist/') && !url.includes('open.spotify.com/playlist/')) {
      return res.status(400).json({ error: 'Invalid Spotify playlist URL' });
    }
    
    // Check for duplicates
    const existingPlaylists = await musicDB.getCustomPlaylists();
    const exists = existingPlaylists.some(p => p.spotify_url === url || p.name === name);
    if (exists) {
      return res.status(400).json({ error: 'Playlist with this name or URL already exists' });
    }
    
    const playlistId = await musicDB.addCustomPlaylist(name.trim(), url.trim());
    
    debugLog('SPOTIFY', `📋 Added custom playlist: ${name}`);
    res.json({ success: true, id: playlistId });
  } catch (error) {
    console.error('❌ Error adding custom playlist:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete custom playlist by ID
app.delete('/api/custom-playlists/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid playlist ID' });
    }
    
    const deleted = await musicDB.deleteCustomPlaylist(id);
    
    if (deleted === 0) {
      return res.status(404).json({ error: 'Playlist not found' });
    }
    
    debugLog('SPOTIFY', `🗑️ Deleted custom playlist ID: ${id}`);
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Error deleting custom playlist:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Clear all custom playlists
app.delete('/api/custom-playlists', async (req, res) => {
  try {
    const deleted = await musicDB.clearCustomPlaylists();
    
    debugLog('SPOTIFY', `🗑️ Cleared all ${deleted} custom playlists`);
    res.json({ success: true, deleted });
  } catch (error) {
    console.error('❌ Error clearing custom playlists:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// === QUEUE API ===

// Save queue state
app.post('/api/queue/save', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'] || 'default';
    const queueState = req.body;

    if (!queueState || typeof queueState !== 'object') {
      return res.status(400).json({ error: 'Invalid queue state data' });
    }

    const stateId = await appDB.saveQueueState(sessionId, queueState);
    
    res.json({ 
      success: true, 
      stateId, 
      sessionId,
      queueLength: queueState.queue?.length || 0
    });
  } catch (error) {
    console.error('❌ Error saving queue state:', error);
    res.status(500).json({ error: 'Failed to save queue state' });
  }
});

// Load queue state
app.get('/api/queue/load', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'] || 'default';
    
    const queueState = await appDB.loadQueueState(sessionId);
    
    if (!queueState) {
      return res.json({ 
        success: false, 
        message: 'No queue state found',
        sessionId 
      });
    }
    
    console.log('[QUEUE] ✅ Queue state loaded for session:', sessionId, '- Queue length:', queueState.queue?.length || 0);
    
    res.json({ 
      success: true, 
      queueState,
      sessionId
    });
  } catch (error) {
    console.error('❌ Error loading queue state:', error);
    res.status(500).json({ error: 'Failed to load queue state' });
  }
});

// Get queue statistics
app.get('/api/queue/stats', async (req, res) => {
  try {
    const stats = await appDB.getQueueStats();
    const sessions = await appDB.getAllSessions();
    
    res.json({
      success: true,
      stats,
      sessions
    });
  } catch (error) {
    console.error('❌ Error getting queue stats:', error);
    res.status(500).json({ error: 'Failed to get queue statistics' });
  }
});

// Cleanup old queue states
app.post('/api/queue/cleanup', async (req, res) => {
  try {
    const { maxAge = 7 * 24 * 60 * 60 * 1000 } = req.body; // 7 days default
    
    const cleaned = await appDB.cleanupOldQueueStates(maxAge);
    
    console.log('[QUEUE] 🧹 Queue cleanup completed:', cleaned, 'states removed');
    
    res.json({
      success: true,
      cleaned,
      maxAge
    });
  } catch (error) {
    console.error('❌ Error cleaning queue states:', error);
    res.status(500).json({ error: 'Failed to cleanup queue states' });
  }
});

// Settings API Endpoints
app.get('/api/settings', async (req, res) => {
  try {
    const { category } = req.query;
    
    let settings;
    if (category) {
      settings = await appDB.getAllSettings(category);
    } else {
      settings = await appDB.getAllSettings();
    }
    
    res.json({
      success: true,
      settings
    });
  } catch (error) {
    console.error('❌ Error getting settings:', error);
    res.status(500).json({ error: 'Failed to get settings' });
  }
});

app.get('/api/settings/:category/:key', async (req, res) => {
  try {
    const { category, key } = req.params;
    const { defaultValue } = req.query;
    
    const value = await appDB.getSetting(category, key, defaultValue);
    
    res.json({
      success: true,
      category,
      key,
      value
    });
  } catch (error) {
    console.error('❌ Error getting setting:', error);
    res.status(500).json({ error: 'Failed to get setting' });
  }
});

app.post('/api/settings/:category/:key', async (req, res) => {
  try {
    const { category, key } = req.params;
    const { value, type = 'string', description } = req.body;
    
    await appDB.setSetting(category, key, value, type, description);
    
    // Update global debugging setting if changed
    if (category === 'admin' && key === 'debuggingEnabled') {
      isDebuggingEnabled = value;
      console.log(`[SERVER] 🔧 Debugging ${isDebuggingEnabled ? 'enabled' : 'disabled'} via API`);
    }
    
    res.json({
      success: true,
      category,
      key,
      value,
      type
    });
  } catch (error) {
    console.error('❌ Error setting setting:', error);
    res.status(500).json({ error: 'Failed to set setting' });
  }
});

app.post('/api/settings/batch', async (req, res) => {
  try {
    const { settings } = req.body;
    const results = [];
    
    for (const setting of settings) {
      const { category, key, value, type = 'string', description } = setting;
      await appDB.setSetting(category, key, value, type, description);
      
      // Update global debugging setting if changed
      if (category === 'admin' && key === 'debuggingEnabled') {
        isDebuggingEnabled = value;
        console.log(`[SERVER] 🔧 Debugging ${isDebuggingEnabled ? 'enabled' : 'disabled'} via batch API`);
      }
      
      results.push({ category, key, value, type });
    }
    
    res.json({
      success: true,
      updated: results.length,
      results
    });
  } catch (error) {
    console.error('❌ Error batch updating settings:', error);
    res.status(500).json({ error: 'Failed to batch update settings' });
  }
});

app.delete('/api/settings/:category/:key', async (req, res) => {
  try {
    const { category, key } = req.params;
    
    const deleted = await appDB.deleteSetting(category, key);
    
    res.json({
      success: true,
      category,
      key,
      deleted: deleted > 0
    });
  } catch (error) {
    console.error('❌ Error deleting setting:', error);
    res.status(500).json({ error: 'Failed to delete setting' });
  }
});

app.get('/api/settings/history/:category/:key', async (req, res) => {
  try {
    const { category, key } = req.params;
    const { limit = 50 } = req.query;
    
    const history = await appDB.getSettingHistory(category, key, parseInt(limit));
    
    res.json({
      success: true,
      category,
      key,
      history
    });
  } catch (error) {
    console.error('❌ Error getting setting history:', error);
    res.status(500).json({ error: 'Failed to get setting history' });
  }
});

// Session API Endpoints
app.get('/api/session/spotify', async (req, res) => {
  try {
    const tokens = await appDB.getSpotifyTokens();
    
    if (tokens) {
      res.json({
        success: true,
        hasTokens: true,
        tokenExpiry: tokens.tokenExpiry
      });
    } else {
      res.json({
        success: true,
        hasTokens: false
      });
    }
  } catch (error) {
    console.error('❌ Error getting Spotify tokens:', error);
    res.status(500).json({ error: 'Failed to get Spotify tokens' });
  }
});

app.post('/api/session/spotify', async (req, res) => {
  try {
    const { accessToken, refreshToken, tokenExpiry } = req.body;
    
    if (!accessToken) {
      return res.status(400).json({ error: 'Access token is required' });
    }
    
    // tokenExpiry comes as absolute timestamp in milliseconds
    // Convert to expires_in (seconds from now) for database
    const now = Math.floor(Date.now() / 1000); // Current time in seconds
    const expiryInSeconds = Math.floor(tokenExpiry / 1000); // Convert ms to seconds
    const expiresIn = Math.max(0, expiryInSeconds - now); // Calculate seconds from now
    
    console.log('💾 Saving Spotify tokens:', {
      hasAccessToken: !!accessToken,
      hasRefreshToken: !!refreshToken,
      tokenExpiryMs: tokenExpiry,
      expiresInSeconds: expiresIn,
      expiresAt: new Date(tokenExpiry).toLocaleString()
    });
    
    await appDB.saveSpotifyTokens({
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: expiresIn, // Seconds from now
      token_type: 'Bearer',
      scope: 'streaming user-read-email user-read-private user-library-read user-library-modify user-read-playback-state user-modify-playback-state'
    });
    
    res.json({
      success: true,
      message: 'Spotify tokens saved'
    });
  } catch (error) {
    console.error('❌ Error saving Spotify tokens:', error);
    res.status(500).json({ error: 'Failed to save Spotify tokens' });
  }
});

app.delete('/api/session/spotify', async (req, res) => {
  try {
    await appDB.clearSpotifyTokens();
    
    res.json({
      success: true,
      message: 'Spotify tokens cleared'
    });
  } catch (error) {
    console.error('❌ Error clearing Spotify tokens:', error);
    res.status(500).json({ error: 'Failed to clear Spotify tokens' });
  }
});

app.get('/api/session/tokens', async (req, res) => {
  try {
    const tokens = await appDB.getSpotifyTokens();
    
    res.json({
      success: true,
      tokens: tokens || null
    });
  } catch (error) {
    console.error('❌ Error getting tokens:', error);
    res.status(500).json({ error: 'Failed to get tokens' });
  }
});

app.get('/api/session/app/:sessionKey', async (req, res) => {
  try {
    const { sessionKey } = req.params;
    const sessionData = await appDB.getSessionData(sessionKey);
    
    res.json({
      success: true,
      sessionData
    });
  } catch (error) {
    console.error('❌ Error getting app session:', error);
    res.status(500).json({ error: 'Failed to get app session' });
  }
});

app.post('/api/session/app/:sessionKey', async (req, res) => {
  try {
    const { sessionKey } = req.params;
    const { sessionData, expiresIn } = req.body;
    
    await appDB.saveSessionData(sessionKey, sessionData);
    
    res.json({
      success: true,
      message: 'App session saved'
    });
  } catch (error) {
    console.error('❌ Error saving app session:', error);
    res.status(500).json({ error: 'Failed to save app session' });
  }
});

app.delete('/api/session/app/:sessionKey', async (req, res) => {
  try {
    const { sessionKey } = req.params;
    await appDB.deleteSessionData(sessionKey);
    
    res.json({
      success: true,
      message: 'App session deleted'
    });
  } catch (error) {
    console.error('❌ Error deleting app session:', error);
    res.status(500).json({ error: 'Failed to delete app session' });
  }
});

app.get('/api/session/ui/:stateKey', async (req, res) => {
  try {
    const { stateKey } = req.params;
    const stateData = await appDB.getSessionData(stateKey);
    
    res.json({
      success: true,
      stateData
    });
  } catch (error) {
    console.error('❌ Error getting UI state:', error);
    res.status(500).json({ error: 'Failed to get UI state' });
  }
});

app.post('/api/session/ui/:stateKey', async (req, res) => {
  try {
    const { stateKey } = req.params;
    const { stateData, persistent = false } = req.body;
    
    await appDB.saveSessionData(stateKey, stateData);
    
    res.json({
      success: true,
      message: 'UI state saved'
    });
  } catch (error) {
    console.error('❌ Error saving UI state:', error);
    res.status(500).json({ error: 'Failed to save UI state' });
  }
});

app.delete('/api/session/ui/:stateKey', async (req, res) => {
  try {
    const { stateKey } = req.params;
    await appDB.deleteUIState(stateKey);
    
    res.json({
      success: true,
      message: 'UI state deleted'
    });
  } catch (error) {
    console.error('❌ Error deleting UI state:', error);
    res.status(500).json({ error: 'Failed to delete UI state' });
  }
});

// Start server
initializeServer().then(() => {
  app.listen(PORT, HOST, () => {
    console.log(`🚀 Data Server running on http://${HOST}:${PORT}`);
    if (HOST === '0.0.0.0') {
      console.log('[SERVER] 🌍 Server accessible from all network interfaces');
    }
    console.log(`📁 Music directory: ${path.resolve('./music')}`);
    console.log(`🗄️  Database: ${path.resolve('./data/music.db')}`);
  });
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('[SERVER] 🛑 Shutting down Data Server...');
  
  // Clean up old cache files (older than 24 hours)
  try {
    const cacheDir = path.join(ROOT_PATH, 'data/converted');
    if (await fs.pathExists(cacheDir)) {
      const files = await fs.readdir(cacheDir);
      const now = Date.now();
      const maxAge = 24 * 60 * 60 * 1000; // 24 hours
      
      for (const file of files) {
        const filePath = path.join(cacheDir, file);
        const stats = await fs.stat(filePath);
        if (now - stats.mtime.getTime() > maxAge) {
          await fs.remove(filePath);
          debugLog('SERVER', `🗑️ Removed old cache file: ${file}`);
        }
      }
    }
  } catch (error) {
    console.warn('⚠️  Cache cleanup failed:', error.message);
  }
  
  if (musicScanner) {
    await musicScanner.destroy();
  }
  if (appDB) {
    await appDB.close();
  }
  if (musicDB) {
    await musicDB.close();
  }
  process.exit(0);
});

