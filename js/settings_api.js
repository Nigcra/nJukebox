/**
 * Frontend Settings API Client
 * Provides robust settings management with caching and fallback support
 */

class SettingsAPI {
  constructor(dataServerUrl = 'http://127.0.0.1:3001') {
    this.baseUrl = dataServerUrl;
    this.cache = new Map(); // In-memory cache
    this.subscribers = new Map(); // Event subscribers
    
    // Try to restore cache from localStorage
    this.restoreCache();
  }

  // Event system for settings changes
  subscribe(category, key, callback) {
    const eventKey = `${category}.${key}`;
    if (!this.subscribers.has(eventKey)) {
      this.subscribers.set(eventKey, new Set());
    }
    this.subscribers.get(eventKey).add(callback);
    
    return () => {
      const callbacks = this.subscribers.get(eventKey);
      if (callbacks) {
        callbacks.delete(callback);
      }
    };
  }

  emit(category, key, value) {
    const eventKey = `${category}.${key}`;
    const callbacks = this.subscribers.get(eventKey);
    if (callbacks) {
      callbacks.forEach(callback => {
        try {
          callback(value, category, key);
        } catch (error) {
          debugLog('SETTINGS-API', 'Settings callback error:', error);
        }
      });
    }
  }

  // Cache management
  getCacheKey(category, key = null) {
    return key ? `${category}.${key}` : category;
  }

  updateCache(category, key, value) {
    const cacheKey = this.getCacheKey(category, key);
    this.cache.set(cacheKey, value);
    this.saveCache();
  }

  saveCache() {
    try {
      const cacheData = {};
      for (const [key, value] of this.cache.entries()) {
        cacheData[key] = value;
      }
      localStorage.setItem('settings_cache', JSON.stringify(cacheData));
    } catch (error) {
      debugLog('SETTINGS-API', 'Settings cache save failed:', error);
    }
  }

  restoreCache() {
    try {
      const cacheData = localStorage.getItem('settings_cache');
      if (cacheData) {
        const parsed = JSON.parse(cacheData);
        for (const [key, value] of Object.entries(parsed)) {
          this.cache.set(key, value);
        }
        debugLog('settings', '⚙️  Settings cache restored');
      }
    } catch (error) {
      debugLog('SETTINGS-API', 'Settings cache restore failed:', error);
      this.cache.clear();
    }
  }

  clearCache() {
    this.cache.clear();
    localStorage.removeItem('settings_cache');
    debugLog('settings', '🧹 Settings cache cleared');
  }

  // API methods
  async getSetting(category, key, defaultValue = null) {
    const cacheKey = this.getCacheKey(category, key);
    
    // Return cached value if available
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    try {
      const response = await fetch(`${this.baseUrl}/api/settings/${category}/${key}?defaultValue=${encodeURIComponent(defaultValue || '')}`);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const data = await response.json();
      
      if (data.success) {
        this.updateCache(category, key, data.value);
        return data.value;
      } else {
        debugLog('SETTINGS-API', 'Settings get failed:', data.error);
        return defaultValue;
      }
    } catch (error) {
      debugLog('SETTINGS-API', 'Settings API get error:', error);
      return defaultValue;
    }
  }

  async setSetting(category, key, value, type = 'string', description = null) {
    try {
      const response = await fetch(`${this.baseUrl}/api/settings/${category}/${key}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ value, type, description })
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const data = await response.json();
      
      if (data.success) {
        this.updateCache(category, key, value);
        this.emit(category, key, value);
        debugLog('settings', `⚙️  Setting updated: ${category}.${key} = ${value}`);
        return true;
      } else {
        debugLog('SETTINGS-API', 'Settings set failed:', data.error);
        return false;
      }
    } catch (error) {
      debugLog('SETTINGS-API', 'Settings API set error:', error);
      return false;
    }
  }

  async getCategory(category) {
    const cacheKey = this.getCacheKey(category);
    
    // Return cached category if available
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    try {
      const response = await fetch(`${this.baseUrl}/api/settings?category=${encodeURIComponent(category)}`);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const data = await response.json();
      
      if (data.success) {
        this.updateCache(category, null, data.settings);
        
        // Also cache individual settings
        for (const [key, settingData] of Object.entries(data.settings)) {
          this.updateCache(category, key, settingData.value);
        }
        
        return data.settings;
      } else {
        debugLog('SETTINGS-API', 'Settings category get failed:', data.error);
        return {};
      }
    } catch (error) {
      debugLog('SETTINGS-API', 'Settings API category error:', error);
      return {};
    }
  }

  async getAllSettings() {
    try {
      const response = await fetch(`${this.baseUrl}/api/settings`);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const data = await response.json();
      
      if (data.success) {
        // Cache all settings
        for (const [category, settings] of Object.entries(data.settings)) {
          this.updateCache(category, null, settings);
          
          for (const [key, settingData] of Object.entries(settings)) {
            this.updateCache(category, key, settingData.value);
          }
        }
        
        return data.settings;
      } else {
        debugLog('SETTINGS-API', 'Settings getAll failed:', data.error);
        return {};
      }
    } catch (error) {
      debugLog('SETTINGS-API', 'Settings API getAll error:', error);
      return {};
    }
  }

  async batchUpdate(settings) {
    try {
      const response = await fetch(`${this.baseUrl}/api/settings/batch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ settings })
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const data = await response.json();
      
      if (data.success) {
        // Update cache and emit events for all changed settings
        for (const result of data.results) {
          this.updateCache(result.category, result.key, result.value);
          this.emit(result.category, result.key, result.value);
        }
        
        debugLog('settings', `⚙️  Batch updated ${data.updated} settings`);
        return true;
      } else {
        debugLog('SETTINGS-API', 'Settings batch update failed:', data.error);
        return false;
      }
    } catch (error) {
      debugLog('SETTINGS-API', 'Settings API batch error:', error);
      return false;
    }
  }

  async deleteSetting(category, key) {
    try {
      const response = await fetch(`${this.baseUrl}/api/settings/${category}/${key}`, {
        method: 'DELETE'
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const data = await response.json();
      
      if (data.success) {
        // Remove from cache
        const cacheKey = this.getCacheKey(category, key);
        this.cache.delete(cacheKey);
        this.saveCache();
        
        debugLog('settings', `🗑️  Setting deleted: ${category}.${key}`);
        return true;
      } else {
        debugLog('SETTINGS-API', 'Settings delete failed:', data.error);
        return false;
      }
    } catch (error) {
      debugLog('SETTINGS-API', 'Settings API delete error:', error);
      return false;
    }
  }

  async getHistory(category, key, limit = 50) {
    try {
      const response = await fetch(`${this.baseUrl}/api/settings/history/${category}/${key}?limit=${limit}`);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const data = await response.json();
      
      if (data.success) {
        return data.history;
      } else {
        debugLog('SETTINGS-API', 'Settings history failed:', data.error);
        return [];
      }
    } catch (error) {
      debugLog('SETTINGS-API', 'Settings API history error:', error);
      return [];
    }
  }

  // Convenience methods for common settings
  // Helper method to extract values from settings objects
  extractValues(settingsData) {
    const values = {};
    debugLog('settings', '🔍 Extracting values from settings data:', settingsData);
    
    for (const [key, settingData] of Object.entries(settingsData)) {
      if (settingData && typeof settingData === 'object') {
        // Check if this is a nested settings object with .value properties
        if (settingData.value !== undefined) {
          values[key] = settingData.value;
          debugLog('settings', `🔍 Extracted ${key}: ${settingData.value} (from object.value)`);
        }
        // Check if this is a category object containing more settings
        else if (typeof settingData === 'object' && !Array.isArray(settingData)) {
          // This might be a nested category - extract its contents
          for (const [nestedKey, nestedData] of Object.entries(settingData)) {
            if (nestedData && typeof nestedData === 'object' && nestedData.value !== undefined) {
              values[nestedKey] = nestedData.value;
              debugLog('settings', `🔍 Extracted nested ${nestedKey}: ${nestedData.value} (from nested object.value)`);
            } else {
              values[nestedKey] = nestedData;
              debugLog('settings', `🔍 Extracted nested ${nestedKey}: ${nestedData} (direct nested value)`);
            }
          }
        } else {
          values[key] = settingData;
          debugLog('settings', `🔍 Extracted ${key}: ${settingData} (direct object)`);
        }
      } else {
        values[key] = settingData;
        debugLog('settings', `🔍 Extracted ${key}: ${settingData} (direct value)`);
      }
    }
    
    debugLog('settings', '🔍 Final extracted values:', values);
    return values;
  }

  async getVisualizationSettings() {
    const settingsData = await this.getCategory('visualization');
    debugLog('settings', '🔍 Raw category data for visualization:', settingsData);
    const extracted = this.extractValues(settingsData);
    debugLog('settings', '🔍 Extracted visualization settings:', extracted);
    return extracted;
  }

  async getAdminSettings() {
    const settingsData = await this.getCategory('admin');
    return this.extractValues(settingsData);
  }

  async getLanguageSettings() {
    const settingsData = await this.getCategory('language');
    return this.extractValues(settingsData);
  }

  async getAudioSettings() {
    const settingsData = await this.getCategory('audio');
    return this.extractValues(settingsData);
  }

  async getUISettings() {
    const settingsData = await this.getCategory('ui');
    return this.extractValues(settingsData);
  }

  // Auto-save functionality for form inputs
  setupAutoSave(category, formElement, debounceMs = 1000) {
    const debounceTimers = new Map();
    
    const handleChange = async (event) => {
      const input = event.target;
      const key = input.name || input.id;
      
      if (!key) return;
      
      let value = input.value;
      let type = 'string';
      
      // Determine type and convert value
      if (input.type === 'checkbox') {
        value = input.checked;
        type = 'boolean';
      } else if (input.type === 'number' || input.type === 'range') {
        value = parseFloat(value);
        type = 'number';
      }
      
      // Debounce the save operation
      const timerId = debounceTimers.get(key);
      if (timerId) {
        clearTimeout(timerId);
      }
      
      debounceTimers.set(key, setTimeout(async () => {
        const success = await this.setSetting(category, key, value, type);
        
        if (success) {
          input.classList.add('settings-saved');
          setTimeout(() => {
            input.classList.remove('settings-saved');
          }, 1000);
        } else {
          input.classList.add('settings-error');
          setTimeout(() => {
            input.classList.remove('settings-error');
          }, 2000);
        }
        
        debounceTimers.delete(key);
      }, debounceMs));
    };
    
    formElement.addEventListener('change', handleChange);
    formElement.addEventListener('input', handleChange);
    
    return () => {
      formElement.removeEventListener('change', handleChange);
      formElement.removeEventListener('input', handleChange);
      
      // Clear all pending timers
      for (const timerId of debounceTimers.values()) {
        clearTimeout(timerId);
      }
      debounceTimers.clear();
    };
  }
}

// Global instance
window.settingsAPI = new SettingsAPI();

debugLog('settings', '⚙️  Settings API client initialized');
