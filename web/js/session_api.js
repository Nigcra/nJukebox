/**
 * Frontend Session API Client
 * Provides database-backed session management to replace localStorage
 */

class SessionAPI {
  constructor(dataServerUrl = 'http://127.0.0.1:3001') {
    this.baseUrl = dataServerUrl;
    this.cache = new Map(); // In-memory cache
    
    // Try to restore cache from sessionStorage (temporary fallback)
    this.restoreCache();
  }

  // Cache management
  updateCache(key, value) {
    this.cache.set(key, value);
    this.saveCache();
  }

  saveCache() {
    try {
      const cacheData = {};
      for (const [key, value] of this.cache.entries()) {
        cacheData[key] = value;
      }
      sessionStorage.setItem('session_cache', JSON.stringify(cacheData));
    } catch (error) {
      debugLog('SESSION-API', 'Session cache save failed:', error);
    }
  }

  restoreCache() {
    try {
      const cacheData = sessionStorage.getItem('session_cache');
      if (cacheData) {
        const parsed = JSON.parse(cacheData);
        for (const [key, value] of Object.entries(parsed)) {
          this.cache.set(key, value);
        }
      }
    } catch (error) {
      debugLog('SESSION-API', 'Session cache restore failed:', error);
      this.cache.clear();
    }
  }

  clearCache() {
    this.cache.clear();
    sessionStorage.removeItem('session_cache');
  }

  // Spotify tokens are not handled here any more. The data server owns them
  // since phase 6: js/spotify.js asks GET /api/spotify/token for a token that
  // is always valid, so there is nothing left to cache or to save.

  // App session management
  async getAppSession(sessionKey) {
    const cacheKey = `app_session_${sessionKey}`;
    
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    try {
      const response = await fetch(`${this.baseUrl}/api/session/app/${encodeURIComponent(sessionKey)}`);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const data = await response.json();
      
      if (data.success) {
        this.updateCache(cacheKey, data.sessionData);
        return data.sessionData;
      } else {
        debugLog('SESSION-API', 'App session get failed:', data.error);
        return null;
      }
    } catch (error) {
      debugLog('SESSION-API', 'Session API get app session error:', error);
      return null;
    }
  }

  async saveAppSession(sessionKey, sessionData, expiresIn = null) {
    try {
      const response = await fetch(`${this.baseUrl}/api/session/app/${encodeURIComponent(sessionKey)}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ sessionData, expiresIn })
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const data = await response.json();
      
      if (data.success) {
        this.updateCache(`app_session_${sessionKey}`, sessionData);
        return true;
      } else {
        debugLog('SESSION-API', 'App session save failed:', data.error);
        return false;
      }
    } catch (error) {
      debugLog('SESSION-API', 'Session API save app session error:', error);
      return false;
    }
  }

  async deleteAppSession(sessionKey) {
    try {
      const response = await fetch(`${this.baseUrl}/api/session/app/${encodeURIComponent(sessionKey)}`, {
        method: 'DELETE'
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const data = await response.json();
      
      if (data.success) {
        this.cache.delete(`app_session_${sessionKey}`);
        this.saveCache();
        return true;
      } else {
        debugLog('SESSION-API', 'App session delete failed:', data.error);
        return false;
      }
    } catch (error) {
      debugLog('SESSION-API', 'Session API delete app session error:', error);
      return false;
    }
  }

  // UI state management
  async getUIState(stateKey) {
    const cacheKey = `ui_state_${stateKey}`;
    
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    try {
      const response = await fetch(`${this.baseUrl}/api/session/ui/${encodeURIComponent(stateKey)}`);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const data = await response.json();
      
      if (data.success) {
        this.updateCache(cacheKey, data.stateData);
        return data.stateData;
      } else {
        debugLog('SESSION-API', 'UI state get failed:', data.error);
        return null;
      }
    } catch (error) {
      debugLog('SESSION-API', 'Session API get UI state error:', error);
      return null;
    }
  }

  async saveUIState(stateKey, stateData, persistent = false) {
    try {
      const response = await fetch(`${this.baseUrl}/api/session/ui/${encodeURIComponent(stateKey)}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ stateData, persistent })
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const data = await response.json();
      
      if (data.success) {
        this.updateCache(`ui_state_${stateKey}`, stateData);
        return true;
      } else {
        debugLog('SESSION-API', 'UI state save failed:', data.error);
        return false;
      }
    } catch (error) {
      debugLog('SESSION-API', 'Session API save UI state error:', error);
      return false;
    }
  }

  async deleteUIState(stateKey) {
    try {
      const response = await fetch(`${this.baseUrl}/api/session/ui/${encodeURIComponent(stateKey)}`, {
        method: 'DELETE'
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const data = await response.json();
      
      if (data.success) {
        this.cache.delete(`ui_state_${stateKey}`);
        this.saveCache();
        return true;
      } else {
        debugLog('SESSION-API', 'UI state delete failed:', data.error);
        return false;
      }
    } catch (error) {
      debugLog('SESSION-API', 'Session API delete UI state error:', error);
      return false;
    }
  }

  // Migration helpers
  async migrateFromLocalStorage() {
    debugLog('session', '🔄 Migrating localStorage to Session API...');
    let migratedCount = 0;

    try {
      // Spotify tokens are deliberately not touched here: js/spotify.js hands a
      // leftover refresh token to POST /api/spotify/auth/adopt and clears the
      // browser copy afterwards. Deleting it here would destroy that migration.

      // Migrate app state
      const appState = localStorage.getItem('jukebox_app_state');
      if (appState) {
        const success = await this.saveUIState('jukebox_app_state', JSON.parse(appState), true);
        if (success) {
          localStorage.removeItem('jukebox_app_state');
          migratedCount++;
        }
      }

      // Migrate admin unlock status
      const adminUnlocked = localStorage.getItem('jukebox_admin_unlocked');
      if (adminUnlocked) {
        const success = await this.saveAppSession('admin_unlocked', adminUnlocked === 'true', 24 * 60 * 60 * 1000); // 24h
        if (success) {
          localStorage.removeItem('jukebox_admin_unlocked');
          migratedCount++;
        }
      }

      if (migratedCount > 0) {
        debugLog('session', `✅ Migrated ${migratedCount} items from localStorage to Session API`);
      }

    } catch (error) {
      debugLog('SESSION-API', '❌ localStorage migration error:', error);
    }
  }

  // Convenience methods for common patterns
  async isAdminUnlocked() {
    const adminStatus = await this.getAppSession('admin_unlocked');
    return adminStatus === true;
  }

  async setAdminUnlocked(unlocked, expiresIn = 24 * 60 * 60 * 1000) {
    return await this.saveAppSession('admin_unlocked', unlocked, expiresIn);
  }
}

// Global instance
window.sessionAPI = new SessionAPI();

// Auto-migrate on initialization
document.addEventListener('DOMContentLoaded', async () => {
  // Small delay to ensure other APIs are ready
  setTimeout(async () => {
    await window.sessionAPI.migrateFromLocalStorage();
  }, 500);
});

debugLog('session', '📱 Session API client initialized');
