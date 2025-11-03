const Database = require('sqlite3').Database;
const path = require('path');
const fs = require('fs-extra');

/**
 * Unified App Database for Queue, Session, and Settings management
 * Consolidates queue_database.js, session_database.js, and settings_database.js
 */
class AppDatabase {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.db = null;
    this.settingsCache = new Map(); // In-memory cache for settings
  }

  async init() {
    return new Promise((resolve, reject) => {
      // Ensure directory exists
      fs.ensureDirSync(path.dirname(this.dbPath));
      
      this.db = new Database(this.dbPath, (err) => {
        if (err) {
          console.error('❌ App database connection failed:', err.message);
          reject(err);
        } else {
          console.log('[APP-DB] 📱 App database connected:', this.dbPath);
          resolve();
        }
      });
    });
  }

  async createTables() {
    return new Promise((resolve, reject) => {
      const sql = `
        -- Queue State Management
        CREATE TABLE IF NOT EXISTS queue_state (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL,
          queue_data TEXT NOT NULL,
          current_track_index INTEGER DEFAULT 0,
          current_filter TEXT DEFAULT 'new',
          current_view TEXT DEFAULT 'list',
          current_az_filter TEXT DEFAULT 'all',
          played_tracks TEXT DEFAULT '[]',
          volume REAL DEFAULT 0.7,
          timestamp INTEGER NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS queue_items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL,
          track_id INTEGER,
          track_data TEXT NOT NULL,
          position INTEGER NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_queue_session ON queue_state(session_id);
        CREATE INDEX IF NOT EXISTS idx_queue_items_session ON queue_items(session_id);

        -- Session Management (Spotify tokens, etc.)
        CREATE TABLE IF NOT EXISTS spotify_tokens (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          access_token TEXT NOT NULL,
          token_type TEXT DEFAULT 'Bearer',
          expires_in INTEGER NOT NULL,
          refresh_token TEXT,
          scope TEXT,
          expires_at INTEGER NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS session_data (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT UNIQUE NOT NULL,
          data TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_session_id ON session_data(session_id);

        -- Settings Management
        CREATE TABLE IF NOT EXISTS settings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          category TEXT NOT NULL,
          key TEXT NOT NULL,
          value TEXT NOT NULL,
          type TEXT DEFAULT 'string',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_settings_category_key ON settings(category, key);
        CREATE INDEX IF NOT EXISTS idx_settings_category ON settings(category);
      `;

      this.db.exec(sql, (err) => {
        if (err) {
          console.error('❌ Failed to create app database tables:', err);
          reject(err);
        } else {
          console.log('[APP-DB] ✅ App database tables created successfully');
          resolve();
        }
      });
    });
  }

  // ==========================================
  // QUEUE MANAGEMENT METHODS
  // ==========================================

  async saveQueueState(sessionId, queueData) {
    return new Promise((resolve, reject) => {
      const {
        queue,
        currentTrackIndex,
        currentFilter,
        currentView,
        currentAZFilter,
        playedTracks,
        volume
      } = queueData;

      const sql = `
        INSERT OR REPLACE INTO queue_state (
          session_id, queue_data, current_track_index, current_filter, 
          current_view, current_az_filter, played_tracks, volume, 
          timestamp, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `;

      const params = [
        sessionId,
        JSON.stringify(queue || []),
        currentTrackIndex || 0,
        currentFilter || 'new',
        currentView || 'list',
        currentAZFilter || 'all',
        JSON.stringify(playedTracks || []),
        volume || 0.7,
        Date.now()
      ];

      this.db.run(sql, params, function(err) {
        if (err) {
          console.error('❌ Failed to save queue state:', err);
          reject(err);
        } else {
          resolve(this.lastID);
        }
      });
    });
  }

  async loadQueueState(sessionId) {
    return new Promise((resolve, reject) => {
      const sql = `
        SELECT queue_data, current_track_index, current_filter, current_view, 
               current_az_filter, played_tracks, volume, timestamp
        FROM queue_state 
        WHERE session_id = ? 
        ORDER BY updated_at DESC 
        LIMIT 1
      `;

      this.db.get(sql, [sessionId], (err, row) => {
        if (err) {
          console.error('❌ Failed to load queue state:', err);
          reject(err);
        } else if (row) {
          try {
            const queueState = {
              queue: JSON.parse(row.queue_data),
              currentTrackIndex: row.current_track_index,
              currentFilter: row.current_filter,
              currentView: row.current_view,
              currentAZFilter: row.current_az_filter,
              playedTracks: JSON.parse(row.played_tracks),
              volume: row.volume,
              timestamp: row.timestamp
            };
            console.log('✅ Queue state loaded for session:', sessionId, '- Queue length:', queueState.queue?.length || 0);
            resolve(queueState);
          } catch (parseErr) {
            console.error('❌ Failed to parse queue state data:', parseErr);
            reject(parseErr);
          }
        } else {
          // No saved state found
          resolve(null);
        }
      });
    });
  }

  async getQueueStats() {
    return new Promise((resolve, reject) => {
      const sql = `
        SELECT 
          COUNT(DISTINCT session_id) as active_sessions,
          COUNT(*) as total_states,
          AVG(json_array_length(queue_data)) as avg_queue_length,
          MIN(timestamp) as oldest_state,
          MAX(timestamp) as newest_state
        FROM queue_state
        WHERE timestamp > ?
      `;

      const dayAgo = Date.now() - (24 * 60 * 60 * 1000);

      this.db.get(sql, [dayAgo], (err, row) => {
        if (err) {
          console.error('❌ Failed to get queue stats:', err);
          reject(err);
        } else {
          resolve({
            activeSessions: row.active_sessions || 0,
            totalStates: row.total_states || 0,
            avgQueueLength: row.avg_queue_length || 0,
            oldestState: row.oldest_state,
            newestState: row.newest_state
          });
        }
      });
    });
  }

  async getAllSessions() {
    return new Promise((resolve, reject) => {
      const sql = `
        SELECT DISTINCT session_id, 
               MAX(timestamp) as last_activity,
               COUNT(*) as state_count
        FROM queue_state
        GROUP BY session_id
        ORDER BY last_activity DESC
      `;

      this.db.all(sql, [], (err, rows) => {
        if (err) {
          console.error('❌ Failed to get all sessions:', err);
          reject(err);
        } else {
          resolve(rows || []);
        }
      });
    });
  }

  async cleanupOldQueueStates(maxAgeHours = 24) {
    return new Promise((resolve, reject) => {
      const cutoffTime = Date.now() - (maxAgeHours * 60 * 60 * 1000);
      const sql = `DELETE FROM queue_state WHERE timestamp < ?`;

      this.db.run(sql, [cutoffTime], function(err) {
        if (err) {
          console.error('❌ Failed to cleanup old queue states:', err);
          reject(err);
        } else {
          console.log('🧹 Queue cleanup completed:', this.changes, 'states removed');
          resolve(this.changes);
        }
      });
    });
  }

  // ==========================================
  // SESSION MANAGEMENT METHODS
  // ==========================================

  async saveSpotifyTokens(tokenData) {
    return new Promise((resolve, reject) => {
      const { access_token, token_type, expires_in, refresh_token, scope } = tokenData;
      const expires_at = Math.floor(Date.now() / 1000) + expires_in;

      // Clear existing tokens first
      this.db.run('DELETE FROM spotify_tokens', (err) => {
        if (err) {
          console.error('❌ Failed to clear old Spotify tokens:', err);
          reject(err);
          return;
        }

        const sql = `
          INSERT INTO spotify_tokens (
            access_token, token_type, expires_in, refresh_token, 
            scope, expires_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `;

        this.db.run(sql, [access_token, token_type, expires_in, refresh_token, scope, expires_at], function(err) {
          if (err) {
            console.error('❌ Failed to save Spotify tokens:', err);
            reject(err);
          } else {
            console.log('🎵 Spotify tokens saved to database');
            resolve(this.lastID);
          }
        });
      });
    });
  }

  async getSpotifyTokens() {
    return new Promise((resolve, reject) => {
      const sql = `
        SELECT access_token, token_type, expires_in, refresh_token, scope, expires_at
        FROM spotify_tokens 
        ORDER BY created_at DESC 
        LIMIT 1
      `;

      this.db.get(sql, [], (err, row) => {
        if (err) {
          console.error('❌ Failed to get Spotify tokens:', err);
          reject(err);
        } else {
          resolve(row || null);
        }
      });
    });
  }

  async clearSpotifyTokens() {
    return new Promise((resolve, reject) => {
      this.db.run('DELETE FROM spotify_tokens', function(err) {
        if (err) {
          console.error('❌ Failed to clear Spotify tokens:', err);
          reject(err);
        } else {
          console.log('🗑️  Spotify tokens cleared from database');
          resolve(this.changes);
        }
      });
    });
  }

  // Clean up expired Spotify tokens (simple version)
  async cleanupExpiredSpotifyTokens() {
    return new Promise((resolve, reject) => {
      const currentTime = Math.floor(Date.now() / 1000);
      const sql = 'DELETE FROM spotify_tokens WHERE expires_at < ?';
      
      this.db.run(sql, [currentTime], function(err) {
        if (err) {
          console.error('❌ Failed to cleanup expired Spotify tokens:', err);
          reject(err);
        } else {
          if (this.changes > 0) {
            console.log('🧹 Cleaned up', this.changes, 'expired Spotify token(s)');
          }
          resolve(this.changes);
        }
      });
    });
  }

  async saveSessionData(sessionId, data) {
    return new Promise((resolve, reject) => {
      const sql = `
        INSERT OR REPLACE INTO session_data (session_id, data, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
      `;

      this.db.run(sql, [sessionId, JSON.stringify(data)], function(err) {
        if (err) {
          console.error('❌ Failed to save session data:', err);
          reject(err);
        } else {
          resolve(this.lastID);
        }
      });
    });
  }

  async getSessionData(sessionId) {
    return new Promise((resolve, reject) => {
      const sql = `SELECT data FROM session_data WHERE session_id = ?`;

      this.db.get(sql, [sessionId], (err, row) => {
        if (err) {
          console.error('❌ Failed to get session data:', err);
          reject(err);
        } else if (row) {
          try {
            resolve(JSON.parse(row.data));
          } catch (parseErr) {
            console.error('❌ Failed to parse session data:', parseErr);
            reject(parseErr);
          }
        } else {
          resolve(null);
        }
      });
    });
  }

  async deleteSessionData(sessionId) {
    return new Promise((resolve, reject) => {
      const sql = `DELETE FROM session_data WHERE session_id = ?`;

      this.db.run(sql, [sessionId], function(err) {
        if (err) {
          console.error('❌ Failed to delete session data:', err);
          reject(err);
        } else {
          resolve(this.changes);
        }
      });
    });
  }

  // ==========================================
  // SETTINGS MANAGEMENT METHODS
  // ==========================================

  async restoreCache() {
    return new Promise((resolve, reject) => {
      const sql = `SELECT category, key, value, type FROM settings`;
      
      this.db.all(sql, [], (err, rows) => {
        if (err) {
          console.error('❌ Failed to restore settings cache:', err);
          reject(err);
        } else {
          this.settingsCache.clear();
          rows.forEach(row => {
            const cacheKey = `${row.category}.${row.key}`;
            let parsedValue = row.value;
            
            try {
              if (row.type === 'number') {
                parsedValue = parseFloat(row.value);
              } else if (row.type === 'boolean') {
                parsedValue = row.value === 'true';
              } else if (row.type === 'object' || row.type === 'array') {
                parsedValue = JSON.parse(row.value);
              }
            } catch (parseErr) {
              console.warn('⚠️  Failed to parse setting value:', cacheKey, parseErr);
            }
            
            this.settingsCache.set(cacheKey, parsedValue);
          });
          
          console.log('[APP-DB] ⚙️  Settings cache restored');
          resolve();
        }
      });
    });
  }

  clearCache() {
    this.settingsCache.clear();
    console.log('🧹 Settings cache cleared');
  }

  async setSetting(category, key, value) {
    return new Promise((resolve, reject) => {
      let type = 'string';
      let stringValue = value;
      
      if (typeof value === 'number') {
        type = 'number';
        stringValue = value.toString();
      } else if (typeof value === 'boolean') {
        type = 'boolean';
        stringValue = value.toString();
      } else if (typeof value === 'object') {
        type = Array.isArray(value) ? 'array' : 'object';
        stringValue = JSON.stringify(value);
      }

      const sql = `
        INSERT OR REPLACE INTO settings (category, key, value, type, updated_at)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      `;

      this.db.run(sql, [category, key, stringValue, type], (err) => {
        if (err) {
          console.error('❌ Failed to save setting:', err);
          reject(err);
        } else {
          // Update cache
          const cacheKey = `${category}.${key}`;
          this.settingsCache.set(cacheKey, value);
          
          console.log(`⚙️  Setting updated: ${category}.${key} = ${value}`);
          resolve();
        }
      });
    });
  }

  getSetting(category, key, defaultValue = null) {
    const cacheKey = `${category}.${key}`;
    return this.settingsCache.has(cacheKey) ? this.settingsCache.get(cacheKey) : defaultValue;
  }

  async getSettingFromDb(category, key, defaultValue = null) {
    return new Promise((resolve, reject) => {
      const sql = `SELECT value, type FROM settings WHERE category = ? AND key = ?`;
      
      this.db.get(sql, [category, key], (err, row) => {
        if (err) {
          console.error('❌ Failed to get setting from database:', err);
          reject(err);
        } else if (row) {
          let parsedValue = row.value;
          
          try {
            if (row.type === 'number') {
              parsedValue = parseFloat(row.value);
            } else if (row.type === 'boolean') {
              parsedValue = row.value === 'true';
            } else if (row.type === 'object' || row.type === 'array') {
              parsedValue = JSON.parse(row.value);
            }
          } catch (parseErr) {
            console.warn('⚠️  Failed to parse setting value:', parseErr);
          }
          
          // Update cache
          const cacheKey = `${category}.${key}`;
          this.settingsCache.set(cacheKey, parsedValue);
          
          resolve(parsedValue);
        } else {
          resolve(defaultValue);
        }
      });
    });
  }

  async getAllSettings(category = null) {
    return new Promise((resolve, reject) => {
      const sql = category 
        ? `SELECT category, key, value, type FROM settings WHERE category = ?`
        : `SELECT category, key, value, type FROM settings`;
      
      const params = category ? [category] : [];
      
      this.db.all(sql, params, (err, rows) => {
        if (err) {
          console.error('❌ Failed to get settings:', err);
          reject(err);
        } else {
          const settings = {};
          
          rows.forEach(row => {
            if (!settings[row.category]) {
              settings[row.category] = {};
            }
            
            let parsedValue = row.value;
            
            try {
              if (row.type === 'number') {
                parsedValue = parseFloat(row.value);
              } else if (row.type === 'boolean') {
                parsedValue = row.value === 'true';
              } else if (row.type === 'object' || row.type === 'array') {
                parsedValue = JSON.parse(row.value);
              }
            } catch (parseErr) {
              console.warn('⚠️  Failed to parse setting value:', parseErr);
            }
            
            settings[row.category][row.key] = parsedValue;
          });
          
          resolve(settings);
        }
      });
    });
  }

  async updateMultipleSettings(settingsData) {
    return new Promise((resolve, reject) => {
      const updates = [];
      
      for (const category in settingsData) {
        for (const key in settingsData[category]) {
          const value = settingsData[category][key];
          updates.push({ category, key, value });
        }
      }

      if (updates.length === 0) {
        resolve({ updated: 0 });
        return;
      }

      this.db.serialize(() => {
        this.db.run('BEGIN TRANSACTION');
        
        let completed = 0;
        let hasError = false;
        
        const sql = `
          INSERT OR REPLACE INTO settings (category, key, value, type, updated_at)
          VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        `;

        updates.forEach(({ category, key, value }) => {
          if (hasError) return;
          
          let type = 'string';
          let stringValue = value;
          
          if (typeof value === 'number') {
            type = 'number';
            stringValue = value.toString();
          } else if (typeof value === 'boolean') {
            type = 'boolean';
            stringValue = value.toString();
          } else if (typeof value === 'object') {
            type = Array.isArray(value) ? 'array' : 'object';
            stringValue = JSON.stringify(value);
          }

          this.db.run(sql, [category, key, stringValue, type], (err) => {
            if (err) {
              hasError = true;
              this.db.run('ROLLBACK');
              console.error('❌ Failed to update setting in batch:', err);
              reject(err);
              return;
            }

            // Update cache
            const cacheKey = `${category}.${key}`;
            this.settingsCache.set(cacheKey, value);
            
            completed++;
            
            if (completed === updates.length) {
              this.db.run('COMMIT', (commitErr) => {
                if (commitErr) {
                  console.error('❌ Failed to commit settings batch update:', commitErr);
                  reject(commitErr);
                } else {
                  console.log(`⚙️  Batch updated ${completed} settings`);
                  resolve({ updated: completed });
                }
              });
            }
          });
        });
      });
    });
  }

  async deleteSetting(category, key) {
    return new Promise((resolve, reject) => {
      const sql = `DELETE FROM settings WHERE category = ? AND key = ?`;
      
      this.db.run(sql, [category, key], function(err) {
        if (err) {
          console.error('❌ Failed to delete setting:', err);
          reject(err);
        } else {
          // Remove from cache
          const cacheKey = `${category}.${key}`;
          this.settingsCache.delete(cacheKey);
          
          console.log(`🗑️  Setting deleted: ${category}.${key}`);
          resolve(this.changes);
        }
      });
    });
  }

  // ==========================================
  // UTILITY METHODS
  // ==========================================

  async close() {
    return new Promise((resolve) => {
      if (this.db) {
        this.db.close((err) => {
          if (err) {
            console.error('❌ Error closing app database:', err);
          } else {
            console.log('📱 App database connection closed');
          }
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}

module.exports = AppDatabase;