const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs-extra');

let isDebuggingEnabled = false;

function debugLog(category, ...args) {
  if (isDebuggingEnabled) {
    console.log(`[${category.toUpperCase()}]`, ...args);
  }
}

class MusicDatabase {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.db = null;
  }

  async init() {
    // Ensure data directory exists
    await fs.ensureDir(path.dirname(this.dbPath));
    
    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(this.dbPath, (err) => {
        if (err) {
          reject(err);
        } else {
          debugLog('DB', 'Connected to SQLite database');
          // Enable WAL mode for better concurrency
          this.db.run('PRAGMA journal_mode = WAL', (walErr) => {
            if (walErr) {
              console.warn('[DB] Could not enable WAL mode:', walErr);
            } else {
              debugLog('DB', 'WAL mode enabled');
            }
            this.createTables().then(resolve).catch(reject);
          });
        }
      });
    });
  }

  // Transaction methods for batch operations
  async beginTransaction() {
    return new Promise((resolve, reject) => {
      this.db.run('BEGIN TRANSACTION', (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async commitTransaction() {
    return new Promise((resolve, reject) => {
      this.db.run('COMMIT', (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async rollbackTransaction() {
    return new Promise((resolve, reject) => {
      this.db.run('ROLLBACK', (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async createTables() {
    const schema = `
      CREATE TABLE IF NOT EXISTS tracks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_path TEXT UNIQUE NOT NULL,
        file_size INTEGER,
        file_mtime INTEGER,
        title TEXT,
        artist TEXT,
        album TEXT,
        album_artist TEXT,
        genre TEXT,
        year INTEGER,
        track_number INTEGER,
        disc_number INTEGER,
        duration REAL,
        bitrate INTEGER,
        format TEXT,
        cover_path TEXT,
        has_cover BOOLEAN DEFAULT FALSE,
        play_count INTEGER DEFAULT 0,
        last_played DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(artist);
      CREATE INDEX IF NOT EXISTS idx_tracks_album ON tracks(album);
      CREATE INDEX IF NOT EXISTS idx_tracks_genre ON tracks(genre);
      CREATE INDEX IF NOT EXISTS idx_tracks_year ON tracks(year);
      CREATE INDEX IF NOT EXISTS idx_tracks_file_path ON tracks(file_path);
      CREATE INDEX IF NOT EXISTS idx_tracks_mtime ON tracks(file_mtime);

      CREATE TABLE IF NOT EXISTS covers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        album_key TEXT UNIQUE NOT NULL,
        cover_path TEXT NOT NULL,
        width INTEGER,
        height INTEGER,
        format TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_covers_album_key ON covers(album_key);

      CREATE TABLE IF NOT EXISTS spotify_tracks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        spotify_id TEXT UNIQUE NOT NULL,
        title TEXT,
        artist TEXT,
        album TEXT,
        genre TEXT,
        year INTEGER,
        duration INTEGER,
        image_url TEXT,
        preview_url TEXT,
        spotify_uri TEXT,
        popularity INTEGER DEFAULT 0,
        added_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_played DATETIME,
        play_count INTEGER DEFAULT 0,
        is_available BOOLEAN DEFAULT TRUE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_spotify_tracks_spotify_id ON spotify_tracks(spotify_id);
      CREATE INDEX IF NOT EXISTS idx_spotify_tracks_artist ON spotify_tracks(artist);
      CREATE INDEX IF NOT EXISTS idx_spotify_tracks_album ON spotify_tracks(album);
      CREATE INDEX IF NOT EXISTS idx_spotify_tracks_genre ON spotify_tracks(genre);
      CREATE INDEX IF NOT EXISTS idx_spotify_tracks_year ON spotify_tracks(year);
      CREATE INDEX IF NOT EXISTS idx_spotify_tracks_popularity ON spotify_tracks(popularity);

      CREATE TABLE IF NOT EXISTS custom_playlists (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        spotify_url TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_custom_playlists_name ON custom_playlists(name);

      CREATE TABLE IF NOT EXISTS play_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        track_id INTEGER,
        spotify_id TEXT,
        title TEXT NOT NULL,
        artist TEXT NOT NULL,
        album TEXT,
        source TEXT NOT NULL CHECK(source IN ('local', 'spotify')),
        played_at INTEGER NOT NULL,
        session_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_play_history_played_at ON play_history(played_at);
      CREATE INDEX IF NOT EXISTS idx_play_history_source ON play_history(source);
      CREATE INDEX IF NOT EXISTS idx_play_history_artist ON play_history(artist);
      CREATE INDEX IF NOT EXISTS idx_play_history_track_id ON play_history(track_id);
      CREATE INDEX IF NOT EXISTS idx_play_history_spotify_id ON play_history(spotify_id);
    `;

    return new Promise((resolve, reject) => {
      this.db.exec(schema, (err) => {
        if (err) {
          reject(err);
        } else {
          debugLog('DB', 'Database tables created/verified');
          // Run migrations after table creation
          this.runMigrations()
            .then(() => resolve())
            .catch(reject);
        }
      });
    });
  }

  async runMigrations() {
    // Check if play_count column exists, if not add it
    const columnCheckSQL = "PRAGMA table_info(tracks)";
    
    return new Promise((resolve, reject) => {
      this.db.all(columnCheckSQL, [], (err, columns) => {
        if (err) {
          console.error('[DB] Error checking table columns:', err);
          reject(err);
          return;
        }
        
        const hasPlayCount = columns.some(col => col.name === 'play_count');
        const hasLastPlayed = columns.some(col => col.name === 'last_played');
        
        let migrations = [];
        
        if (!hasPlayCount) {
          migrations.push("ALTER TABLE tracks ADD COLUMN play_count INTEGER DEFAULT 0");
          console.log('[DB] Adding play_count column to tracks table');
        }
        
        if (!hasLastPlayed) {
          migrations.push("ALTER TABLE tracks ADD COLUMN last_played DATETIME");
          console.log('[DB] Adding last_played column to tracks table');
        }
        
        if (migrations.length === 0) {
          resolve();
          return;
        }
        
        // Show migration details only when needed
        console.log('[DB] Current columns in tracks table:', columns.map(c => c.name));
        console.log('[DB] Running database migrations...');
        
        // Run migrations sequentially
        const runNextMigration = (index) => {
          if (index >= migrations.length) {
            console.log('[DB] All migrations completed successfully');
            resolve();
            return;
          }
          
          console.log(`[DB] Running migration ${index + 1}/${migrations.length}: ${migrations[index]}`);
          this.db.run(migrations[index], (err) => {
            if (err) {
              console.error(`[DB] Migration ${index + 1} failed:`, err);
              reject(err);
            } else {
              console.log(`[DB] Migration ${index + 1}/${migrations.length} completed`);
              runNextMigration(index + 1);
            }
          });
        };
        
        runNextMigration(0);
      });
    });
  }

  async insertTrack(trackData) {
    const sql = `
      INSERT OR REPLACE INTO tracks (
        file_path, file_size, file_mtime, title, artist, album, album_artist,
        genre, year, track_number, disc_number, duration, bitrate, format,
        cover_path, has_cover, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `;

    return new Promise((resolve, reject) => {
      this.db.run(sql, [
        trackData.file_path,
        trackData.file_size,
        trackData.file_mtime,
        trackData.title,
        trackData.artist,
        trackData.album,
        trackData.album_artist,
        trackData.genre,
        trackData.year,
        trackData.track_number,
        trackData.disc_number,
        trackData.duration,
        trackData.bitrate,
        trackData.format,
        trackData.cover_path,
        trackData.has_cover ? 1 : 0
      ], function(err) {
        if (err) {
          reject(err);
        } else {
          resolve(this.lastID);
        }
      });
    });
  }

  async getTrackByPath(filePath) {
    const sql = 'SELECT * FROM tracks WHERE file_path = ?';
    return new Promise((resolve, reject) => {
      this.db.get(sql, [filePath], (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  }

  async getTrackById(id) {
    const sql = 'SELECT * FROM tracks WHERE id = ?';
    return new Promise((resolve, reject) => {
      this.db.get(sql, [id], (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  }

  async getTrackWithCover(artist, album) {
    const sql = `
      SELECT * FROM tracks 
      WHERE LOWER(artist) = LOWER(?) 
      AND LOWER(album) = LOWER(?) 
      AND has_cover = 1 
      AND cover_path IS NOT NULL
      LIMIT 1
    `;
    return new Promise((resolve, reject) => {
      this.db.get(sql, [artist, album], (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  }

  async getArtistAlbumCovers(artist) {
    const sql = `
      SELECT DISTINCT album, cover_path, has_cover 
      FROM tracks 
      WHERE LOWER(artist) = LOWER(?) 
      AND has_cover = 1 
      AND cover_path IS NOT NULL
      ORDER BY album
    `;
    return new Promise((resolve, reject) => {
      this.db.all(sql, [artist], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  async getTracks(filters = {}) {
    let sql = 'SELECT * FROM tracks WHERE 1=1';
    const params = [];

    if (filters.artist) {
      sql += ' AND LOWER(artist) LIKE LOWER(?)';
      params.push(`%${filters.artist}%`);
    }

    if (filters.album) {
      sql += ' AND LOWER(album) LIKE LOWER(?)';
      params.push(`%${filters.album}%`);
    }

    if (filters.genre) {
      sql += ' AND LOWER(genre) LIKE LOWER(?)';
      params.push(`%${filters.genre}%`);
    }

    if (filters.year) {
      sql += ' AND year = ?';
      params.push(filters.year);
    }

    if (filters.search) {
      sql += ' AND (LOWER(title) LIKE LOWER(?) OR LOWER(artist) LIKE LOWER(?) OR LOWER(album) LIKE LOWER(?))';
      const searchTerm = `%${filters.search}%`;
      params.push(searchTerm, searchTerm, searchTerm);
    }

    sql += ' ORDER BY LOWER(artist), LOWER(album), track_number, LOWER(title)';

    if (filters.limit) {
      sql += ' LIMIT ?';
      params.push(filters.limit);
      
      if (filters.offset) {
        sql += ' OFFSET ?';
        params.push(filters.offset);
      }
    }

    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows || []);
        }
      });
    });
  }

  async getArtists() {
    const sql = `
      SELECT 
        artist,
        COUNT(*) as track_count 
      FROM tracks 
      WHERE artist IS NOT NULL AND artist != '' 
      GROUP BY LOWER(artist)
      ORDER BY LOWER(artist)
    `;
    
    return new Promise((resolve, reject) => {
      this.db.all(sql, [], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          // Post-process to use the most common capitalization for each artist
          const artistMap = new Map();
          
          // Get all tracks to find the most common capitalization
          const detailSql = `
            SELECT artist, COUNT(*) as count
            FROM tracks 
            WHERE artist IS NOT NULL AND artist != ''
            GROUP BY artist
            ORDER BY COUNT(*) DESC
          `;
          
          this.db.all(detailSql, [], (detailErr, detailRows) => {
            if (detailErr) {
              reject(detailErr);
              return;
            }
            
            // Group by lowercase and pick the most frequent capitalization
            for (const row of detailRows) {
              const lowerArtist = row.artist.toLowerCase();
              if (!artistMap.has(lowerArtist) || artistMap.get(lowerArtist).count < row.count) {
                artistMap.set(lowerArtist, {
                  artist: row.artist, // Use the most frequent capitalization
                  count: row.count
                });
              }
            }
            
            // Now aggregate track counts by lowercase artist
            const aggregatedSql = `
              SELECT 
                LOWER(artist) as lower_artist,
                COUNT(*) as track_count 
              FROM tracks 
              WHERE artist IS NOT NULL AND artist != '' 
              GROUP BY LOWER(artist)
              ORDER BY LOWER(artist)
            `;
            
            this.db.all(aggregatedSql, [], (aggErr, aggRows) => {
              if (aggErr) {
                reject(aggErr);
                return;
              }
              
              const result = aggRows.map(row => ({
                artist: artistMap.get(row.lower_artist)?.artist || row.lower_artist,
                track_count: row.track_count
              }));
              
              resolve(result);
            });
          });
        }
      });
    });
  }

  async getAlbums(artist = null) {
    let sql = `
      SELECT album, artist, COUNT(*) as track_count, MIN(year) as year
      FROM tracks 
      WHERE album IS NOT NULL AND album != ''
    `;
    const params = [];

    if (artist) {
      sql += ' AND LOWER(artist) = LOWER(?)';
      params.push(artist);
    }

    sql += ' GROUP BY LOWER(album), LOWER(artist) ORDER BY LOWER(artist), year, LOWER(album)';

    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows || []);
        }
      });
    });
  }

  async getGenres() {
    const sql = `
      SELECT genre, COUNT(*) as track_count 
      FROM tracks 
      WHERE genre IS NOT NULL AND genre != '' 
      GROUP BY genre 
      ORDER BY genre
    `;
    
    return new Promise((resolve, reject) => {
      this.db.all(sql, [], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows || []);
        }
      });
    });
  }

  // Get most played tracks (both local and Spotify)
  async getMostPlayedTracks(limit = 10) {
    const localTracksSQL = `
      SELECT 
        id, title, artist, album, play_count, last_played,
        'local' as source, file_path
      FROM tracks 
      WHERE play_count > 0
      ORDER BY play_count DESC, last_played DESC
      LIMIT ?
    `;
    
    const spotifyTracksSQL = `
      SELECT 
        id, title, artist, album, play_count, last_played,
        'spotify' as source, spotify_id, spotify_uri, image_url
      FROM spotify_tracks 
      WHERE play_count > 0
      ORDER BY play_count DESC, last_played DESC
      LIMIT ?
    `;
    
    return new Promise((resolve, reject) => {
      const localPromise = new Promise((resolveLocal, rejectLocal) => {
        this.db.all(localTracksSQL, [limit], (err, rows) => {
          if (err) rejectLocal(err);
          else resolveLocal(rows || []);
        });
      });
      
      const spotifyPromise = new Promise((resolveSpotify, rejectSpotify) => {
        this.db.all(spotifyTracksSQL, [limit], (err, rows) => {
          if (err) rejectSpotify(err);
          else resolveSpotify(rows || []);
        });
      });
      
      Promise.all([localPromise, spotifyPromise])
        .then(([localTracks, spotifyTracks]) => {
          // Combine and sort by play count
          const allTracks = [...localTracks, ...spotifyTracks]
            .sort((a, b) => {
              if (b.play_count !== a.play_count) {
                return b.play_count - a.play_count;
              }
              return new Date(b.last_played) - new Date(a.last_played);
            })
            .slice(0, limit);
          
          resolve(allTracks);
        })
        .catch(reject);
    });
  }

  // Get play statistics
  async getPlayStats() {
    const sql = `
      SELECT 
        COUNT(*) as total_tracks,
        SUM(play_count) as total_plays,
        AVG(play_count) as avg_plays_per_track,
        MAX(play_count) as max_plays
      FROM (
        SELECT play_count FROM tracks
        UNION ALL
        SELECT play_count FROM spotify_tracks
      )
    `;
    
    return new Promise((resolve, reject) => {
      this.db.get(sql, [], (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  }

  // Record detailed play history for GEMA reporting
  async recordPlayHistory(trackData, source = 'local') {
    const sql = `
      INSERT INTO play_history (
        track_id, spotify_id, title, artist, album, source, played_at, session_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;
    
    const sessionId = this.getSessionId();
    const playedAt = Date.now();
    
    const params = [
      source === 'local' ? trackData.id : null,
      source === 'spotify' ? trackData.spotify_id || trackData.id : null,
      trackData.title || 'Unknown Title',
      trackData.artist || 'Unknown Artist',
      trackData.album || '',
      source,
      playedAt,
      sessionId
    ];
    
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function(err) {
        if (err) {
          debugLog('DB', 'Error recording play history:', err);
          reject(err);
        } else {
          debugLog('DB', `Play history recorded: ${trackData.artist} - ${trackData.title}`);
          resolve({ id: this.lastID, played_at: playedAt });
        }
      });
    });
  }

  // Get play history for a specific time period (for GEMA reporting)
  async getPlaysForPeriod(startTimestamp, endTimestamp) {
    const sql = `
      SELECT 
        id,
        track_id,
        spotify_id,
        title,
        artist,
        album,
        source,
        played_at as timestamp,
        session_id,
        datetime(played_at/1000, 'unixepoch', 'localtime') as played_date
      FROM play_history 
      WHERE played_at >= ? AND played_at <= ?
      ORDER BY played_at ASC
    `;
    
    return new Promise((resolve, reject) => {
      this.db.all(sql, [startTimestamp, endTimestamp], (err, rows) => {
        if (err) {
          debugLog('DB', 'Error fetching plays for period:', err);
          reject(err);
        } else {
          debugLog('DB', `Found ${rows.length} plays for period ${new Date(startTimestamp)} to ${new Date(endTimestamp)}`);
          resolve(rows || []);
        }
      });
    });
  }

  // Get session ID for grouping plays
  getSessionId() {
    if (!this.currentSessionId) {
      this.currentSessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    return this.currentSessionId;
  }

  // Reset session (call this when app restarts)
  resetSession() {
    this.currentSessionId = null;
  }

  async getStats() {
    const sql = `
      SELECT 
        COUNT(*) as total_tracks,
        COUNT(DISTINCT artist) as total_artists,
        COUNT(DISTINCT album) as total_albums,
        COUNT(DISTINCT genre) as total_genres,
        SUM(duration) as total_duration,
        AVG(year) as average_year,
        MIN(year) as oldest_year,
        MAX(year) as newest_year
      FROM tracks
    `;
    
    return new Promise((resolve, reject) => {
      this.db.get(sql, [], (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  }

  async removeTrackByPath(filePath) {
    const sql = 'DELETE FROM tracks WHERE file_path = ?';
    return new Promise((resolve, reject) => {
      this.db.run(sql, [filePath], function(err) {
        if (err) {
          reject(err);
        } else {
          resolve(this.changes);
        }
      });
    });
  }

  async insertCover(albumKey, coverPath, metadata = {}) {
    const sql = `
      INSERT OR REPLACE INTO covers (album_key, cover_path, width, height, format)
      VALUES (?, ?, ?, ?, ?)
    `;

    return new Promise((resolve, reject) => {
      this.db.run(sql, [
        albumKey,
        coverPath,
        metadata.width,
        metadata.height,
        metadata.format
      ], function(err) {
        if (err) {
          reject(err);
        } else {
          resolve(this.lastID);
        }
      });
    });
  }

  async getCover(albumKey) {
    const sql = 'SELECT * FROM covers WHERE album_key = ?';
    return new Promise((resolve, reject) => {
      this.db.get(sql, [albumKey], (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  }

  async removeTrack(trackId) {
    const sql = 'DELETE FROM tracks WHERE id = ?';
    return new Promise((resolve, reject) => {
      this.db.run(sql, [trackId], function(err) {
        if (err) {
          reject(err);
        } else {
          resolve(this.changes);
        }
      });
    });
  }

  async cleanupOrphans() {
    // Remove albums that have no tracks
    const cleanupAlbumsSql = `
      DELETE FROM covers WHERE album_key NOT IN (
        SELECT DISTINCT LOWER(artist) || '||' || LOWER(album) 
        FROM tracks 
        WHERE artist IS NOT NULL AND album IS NOT NULL
      )
    `;
    
    return new Promise((resolve, reject) => {
      this.db.run(cleanupAlbumsSql, function(err) {
        if (err) {
          reject(err);
        } else {
          console.log(`🧹 Removed ${this.changes} orphaned album covers`);
          resolve(this.changes);
        }
      });
    });
  }

  // Spotify-specific methods

  async addSpotifyTrack(trackData) {
    const sql = `
      INSERT OR REPLACE INTO spotify_tracks (
        spotify_id, title, artist, album, genre, year, duration,
        image_url, preview_url, spotify_uri, popularity, added_date, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `;

    return new Promise((resolve, reject) => {
      this.db.run(sql, [
        trackData.spotify_id,
        trackData.title,
        trackData.artist,
        trackData.album,
        trackData.genre,
        trackData.year,
        trackData.duration,
        trackData.image_url,
        trackData.preview_url,
        trackData.spotify_uri,
        trackData.popularity,
        trackData.added_date
      ], function(err) {
        if (err) {
          reject(err);
        } else {
          resolve(this.lastID);
        }
      });
    });
  }

  async getSpotifyTrack(spotifyId) {
    const sql = 'SELECT * FROM spotify_tracks WHERE spotify_id = ?';
    return new Promise((resolve, reject) => {
      this.db.get(sql, [spotifyId], (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  }

  async getSpotifyTracks(options = {}) {
    const { limit = 50, offset = 0, search, artist, album, genre, year } = options;
    
    let sql = 'SELECT * FROM spotify_tracks WHERE 1=1';
    const params = [];

    if (search) {
      sql += ' AND (title LIKE ? OR artist LIKE ? OR album LIKE ?)';
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm);
    }

    if (artist) {
      sql += ' AND artist LIKE ?';
      params.push(`%${artist}%`);
    }

    if (album) {
      sql += ' AND album LIKE ?';
      params.push(`%${album}%`);
    }

    if (genre) {
      sql += ' AND genre LIKE ?';
      params.push(`%${genre}%`);
    }

    if (year) {
      sql += ' AND year = ?';
      params.push(year);
    }

    sql += ' ORDER BY popularity DESC, added_date DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows || []);
        }
      });
    });
  }

  async removeSpotifyTrack(spotifyId) {
    const sql = 'DELETE FROM spotify_tracks WHERE spotify_id = ?';
    return new Promise((resolve, reject) => {
      this.db.run(sql, [spotifyId], function(err) {
        if (err) {
          reject(err);
        } else {
          resolve(this.changes);
        }
      });
    });
  }

  // Update track play count for local tracks
  async updateTrackPlayCount(trackId) {
    const sql = `
      UPDATE tracks 
      SET play_count = play_count + 1, 
          last_played = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `;
    
    return new Promise((resolve, reject) => {
      this.db.run(sql, [trackId], function(err) {
        if (err) {
          reject(err);
        } else {
          resolve(this.changes);
        }
      });
    });
  }

  async updateSpotifyTrackPlayCount(spotifyId) {
    const sql = `
      UPDATE spotify_tracks 
      SET play_count = play_count + 1, 
          last_played = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE spotify_id = ?
    `;
    
    return new Promise((resolve, reject) => {
      this.db.run(sql, [spotifyId], function(err) {
        if (err) {
          reject(err);
        } else {
          resolve(this.changes);
        }
      });
    });
  }

  async getSpotifyStats() {
    const sql = `
      SELECT 
        COUNT(*) as total_tracks,
        COUNT(DISTINCT artist) as unique_artists,
        COUNT(DISTINCT album) as unique_albums,
        AVG(popularity) as avg_popularity,
        SUM(play_count) as total_plays
      FROM spotify_tracks
    `;
    
    return new Promise((resolve, reject) => {
      this.db.get(sql, [], (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  }

  async searchAllTracks(searchTerm, limit = 50) {
    // Search both local and Spotify tracks
    const localSql = `
      SELECT 
        id, title, artist, album, genre, year, duration,
        'local' as source, file_path, cover_path
      FROM tracks 
      WHERE title LIKE ? OR artist LIKE ? OR album LIKE ?
      ORDER BY title
      LIMIT ?
    `;
    
    const spotifySql = `
      SELECT 
        id, title, artist, album, genre, year, duration,
        'spotify' as source, spotify_id, spotify_uri, image_url
      FROM spotify_tracks 
      WHERE title LIKE ? OR artist LIKE ? OR album LIKE ?
      ORDER BY popularity DESC
      LIMIT ?
    `;
    
    const searchPattern = `%${searchTerm}%`;
    
    return new Promise((resolve, reject) => {
      const localPromise = new Promise((resolveLocal, rejectLocal) => {
        this.db.all(localSql, [searchPattern, searchPattern, searchPattern, limit], (err, rows) => {
          if (err) rejectLocal(err);
          else resolveLocal(rows || []);
        });
      });
      
      const spotifyPromise = new Promise((resolveSpotify, rejectSpotify) => {
        this.db.all(spotifySql, [searchPattern, searchPattern, searchPattern, limit], (err, rows) => {
          if (err) rejectSpotify(err);
          else resolveSpotify(rows || []);
        });
      });
      
      Promise.all([localPromise, spotifyPromise])
        .then(([localTracks, spotifyTracks]) => {
          resolve({
            local: localTracks,
            spotify: spotifyTracks,
            total: localTracks.length + spotifyTracks.length
          });
        })
        .catch(reject);
    });
  }

  // Generic query method for raw SQL
  async query(sql, params = []) {
    return new Promise((resolve, reject) => {
      if (sql.trim().toUpperCase().startsWith('SELECT')) {
        this.db.all(sql, params, (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      } else {
        this.db.run(sql, params, function(err) {
          if (err) reject(err);
          else resolve({ changes: this.changes, lastID: this.lastID });
        });
      }
    });
  }

  // Clear all data from the database (admin function)
  async clearDatabase() {
    console.log('[DB] Clearing entire database...');
    
    const clearSql = `
      DELETE FROM tracks;
      DELETE FROM spotify_tracks;
      DELETE FROM covers;
      DELETE FROM custom_playlists;
      UPDATE sqlite_sequence SET seq = 0 WHERE name IN ('tracks', 'spotify_tracks', 'covers', 'custom_playlists');
    `;
    
    return new Promise((resolve, reject) => {
      this.db.exec(clearSql, (err) => {
        if (err) {
          console.error('[DB] Error clearing database:', err);
          reject(err);
        } else {
          console.log('[DB] Database cleared successfully');
          resolve();
        }
      });
    });
  }

  // Custom Playlists Methods
  async addCustomPlaylist(name, spotifyUrl) {
    const sql = `
      INSERT INTO custom_playlists (name, spotify_url)
      VALUES (?, ?)
    `;
    
    return new Promise((resolve, reject) => {
      this.db.run(sql, [name, spotifyUrl], function(err) {
        if (err) {
          debugLog('DB', 'Error adding custom playlist:', err);
          reject(err);
        } else {
          debugLog('DB', 'Added custom playlist:', name);
          resolve(this.lastID);
        }
      });
    });
  }

  async getCustomPlaylists() {
    const sql = `
      SELECT * FROM custom_playlists
      ORDER BY created_at DESC
    `;
    
    return new Promise((resolve, reject) => {
      this.db.all(sql, [], (err, rows) => {
        if (err) {
          debugLog('DB', 'Error getting custom playlists:', err);
          reject(err);
        } else {
          debugLog('DB', 'Retrieved custom playlists:', rows.length);
          resolve(rows);
        }
      });
    });
  }

  async deleteCustomPlaylist(id) {
    const sql = `DELETE FROM custom_playlists WHERE id = ?`;
    
    return new Promise((resolve, reject) => {
      this.db.run(sql, [id], function(err) {
        if (err) {
          debugLog('DB', 'Error deleting custom playlist:', err);
          reject(err);
        } else {
          debugLog('DB', 'Deleted custom playlist:', id);
          resolve(this.changes);
        }
      });
    });
  }

  async clearCustomPlaylists() {
    const sql = `DELETE FROM custom_playlists`;
    
    return new Promise((resolve, reject) => {
      this.db.run(sql, [], function(err) {
        if (err) {
          debugLog('DB', 'Error clearing custom playlists:', err);
          reject(err);
        } else {
          debugLog('DB', 'Cleared all custom playlists');
          resolve(this.changes);
        }
      });
    });
  }

  async close() {
    if (this.db) {
      return new Promise((resolve) => {
        this.db.close((err) => {
          if (err) {
            console.error('Error closing database:', err);
          } else {
            console.log('📊 Database connection closed');
          }
          resolve();
        });
      });
    }
  }
}

module.exports = MusicDatabase;
