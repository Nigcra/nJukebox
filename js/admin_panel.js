/**
 * Admin Panel Integration
 * Handles all admin panel functionality including PIN validation, status restoration,
 * overlay management, integrates with the Settings Database API, and manages GEMA reporting
 */

// Admin Panel State Management
let isAdminMode = false;

class AdminSettingsManager {
  constructor() {
    this.settingsLoaded = false; // Track initial settings loading
    this.setupEventListeners();
    this.loadSettingsFromAPI();
  }

  // Load admin settings from Settings API (with localStorage fallback)
  async loadAdminSettings() {
    console.log('[ADMIN] loadAdminSettings() started - redirecting to loadSettingsFromAPI()');
    // Redirect to the proper function that has all the functionality
    return this.loadSettingsFromAPI();
  }

  // Update Data Server Status in Admin Panel
  async updateMusicServerStatus() {
    const musicServerStatusEl = document.getElementById('musicServerStatus');
    const musicServerStatsEl = document.getElementById('musicServerStats');
    
    if (!musicServerStatusEl) return;
    
    try {
      if (!window.musicAPI) {
        throw new Error('musicAPI not available');
      }
      
      const health = await window.musicAPI.health();
      const stats = await window.musicAPI.getStats();
      
      musicServerStatusEl.style.color = '#1DB954';
      const connectedText = (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? 
        window.i18nSystem.t('ui.labels.dataServerConnected') : 
        '✅ Data Server verbunden';
      musicServerStatusEl.textContent = connectedText;
      
      if (musicServerStatsEl && stats.data) {
        const { total_tracks, total_artists, total_albums, total_duration } = stats.data;
        const hours = Math.floor(total_duration / 3600);
        const minutes = Math.floor((total_duration % 3600) / 60);
        
        const tracksText = (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.labels.tracks') : 'Tracks';
        const artistsText = (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.labels.artists') : 'Künstler';
        const albumsText = (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.labels.albums') : 'Alben';
        const playtimeText = (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.labels.totalPlaytime') : 'Gesamtspielzeit';
        
        musicServerStatsEl.innerHTML = `
          📊 ${total_tracks || 0} ${tracksText} • ${total_artists || 0} ${artistsText} • ${total_albums || 0} ${albumsText}<br>
          ⏱️ ${hours}h ${minutes}m ${playtimeText}
        `;
      }
      
      // Update cover cache statistics
      this.updateCoverCacheStats();
      
    } catch (error) {
      musicServerStatusEl.style.color = '#e74c3c';
      const notReachableText = (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? 
        window.i18nSystem.t('ui.labels.dataServerNotReachable') : 
        '❌ Data Server nicht erreichbar';
      musicServerStatusEl.textContent = notReachableText;
      
      if (musicServerStatsEl) {
        const startServerText = (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? 
          window.i18nSystem.t('ui.labels.startDataServer') : 
          'Starte den Data Server mit: npm start';
        musicServerStatsEl.textContent = startServerText;
      }
    }
  }

  // Update cover cache statistics display
  updateCoverCacheStats() {
    const coverCacheStatsEl = document.getElementById('coverCacheStats');
    if (!coverCacheStatsEl) return;
    
    // Since we now use browser cache, show different stats
    const browserCacheSupported = 'caches' in window;
    const domCacheStats = window.domCache ? {
      artists: window.domCache.artists?.size || 0,
      albums: window.domCache.albums?.size || 0,
      tracks: window.domCache.tracks?.size || 0
    } : { artists: 0, albums: 0, tracks: 0 };
    
    coverCacheStatsEl.innerHTML = `
      🖼️ Cover-Cache: Browser-Cache ${browserCacheSupported ? '✅' : '❌'} • DOM-Cache: ${domCacheStats.artists + domCacheStats.albums + domCacheStats.tracks} Views<br>
      📈 Artists: ${domCacheStats.artists} • Albums: ${domCacheStats.albums} • Tracks: ${domCacheStats.tracks}
    `;
  }

  // Event Management via Settings API
  async getSavedEvents() {
    try {
      if (window.settingsAPI) {
        return await window.settingsAPI.getSetting('events', 'savedEvents', []);
      }
      return [];
    } catch (error) {
      debugLog('admin', '[EVENTS] Error loading events from Settings API:', error);
      return [];
    }
  }

  async saveEventsToAPI(events) {
    try {
      if (window.settingsAPI) {
        const success = await window.settingsAPI.setSetting('events', 'savedEvents', events, 'json');
        if (success) {
          debugLog('admin', '[EVENTS] Events saved to Settings API');
        }
        return success;
      }
      return false;
    } catch (error) {
      debugLog('admin', '[EVENTS] Error saving events to Settings API:', error);
      return false;
    }
  }

  // HTML escape utility
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Save admin settings to localStorage
  saveAdminSettings() {
    const settings = this.getAdminSettingsFromStorage();
    settings.trackLockTimeMinutes = window.trackLockTimeMinutes || 60;
    // Get debug state from debug.js properly
    settings.debuggingEnabled = (typeof window.isDebuggingEnabled === 'function') 
      ? window.isDebuggingEnabled() 
      : false;
    // Settings removed - managed by Settings API instead of localStorage
    debugLog('admin', 'Settings managed by Settings API - no localStorage needed');
    return {};
  }

  // Initialize admin main tabs
  initializeAdminMainTabs() {
    const mainTabs = document.querySelectorAll('.admin-main-tab');
    const mainContents = document.querySelectorAll('.admin-main-tab-content');
    
    mainTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        // Remove active from all main tabs and contents
        mainTabs.forEach(t => t.classList.remove('active'));
        mainContents.forEach(c => c.classList.remove('active'));
        
        // Add active to clicked tab
        tab.classList.add('active');
        
        // Show corresponding content
        const targetContent = document.getElementById(tab.dataset.tab + '-content');
        if (targetContent) {
          targetContent.classList.add('active');
        }
        
        // Update auto-learning status if switching to auto-learning tab
        if (tab.dataset.tab === 'autolearn') {
          this.updateAutoLearnStatus();
        }
      });
    });
  }

  // Initialize admin auto-learn tabs
  initializeAdminAutoLearnTabs() {
    // Initialize tabs
    const tabs = document.querySelectorAll('.admin-tab');
    const contents = document.querySelectorAll('.admin-tab-content');
    
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        // Remove active from all tabs and contents
        tabs.forEach(t => t.classList.remove('active'));
        contents.forEach(c => c.classList.remove('active'));
        
        // Add active to clicked tab
        tab.classList.add('active');
        
        // Show corresponding content
        const targetContent = document.getElementById(tab.dataset.tab + '-content');
        if (targetContent) {
          targetContent.classList.add('active');
        }
      });
    });
    
    // Initialize button handlers
    this.initializeAdminAutoLearnButtons();
  }

  // Initialize admin auto-learn buttons
  initializeAdminAutoLearnButtons() {
    // Germany buttons - aktualisiert für die neuen Playlists-IDs
    const learnTop100DE = document.getElementById('learnTop100DE');
    if (learnTop100DE) {
      learnTop100DE.addEventListener('click', () => {
        if (typeof window.learnFromSpotifyPlaylist === 'function') {
          window.learnFromSpotifyPlaylist('37i9dQZF1DX9vq6oNXHhI6', 'Top 100 Deutschland', 'germany');
        }
      });
    }
    
    const learnViral50DE = document.getElementById('learnViral50DE');
    if (learnViral50DE) {
      learnViral50DE.addEventListener('click', () => {
        if (typeof window.learnFromSpotifyPlaylist === 'function') {
          window.learnFromSpotifyPlaylist('37i9dQZF1DX0XUsuxWHRQd', 'Viral 50 Deutschland', 'germany');
        }
      });
    }
    
    const learnDeutschpop = document.getElementById('learnDeutschpop');
    if (learnDeutschpop) {
      learnDeutschpop.addEventListener('click', () => {
        if (typeof window.learnFromGenre === 'function') {
          window.learnFromGenre('german pop', 'Deutschpop Hits', 'germany');
        }
      });
    }
    
    const learnSchlager = document.getElementById('learnSchlager');
    if (learnSchlager) {
      learnSchlager.addEventListener('click', () => {
        if (typeof window.learnFromGenre === 'function') {
          window.learnFromGenre('schlager', 'Oktoberfest', 'germany');
        }
      });
    }
    
    const learnPartyHits = document.getElementById('learnPartyHits');
    if (learnPartyHits) {
      learnPartyHits.addEventListener('click', () => {
        if (typeof window.learnFromGenre === 'function') {
          window.learnFromGenre('party', 'Party Hits', 'party');
        }
      });
    }
    
    // Add other buttons as needed
    debugLog('admin', 'Admin auto-learn buttons initialized');
  }

  // Update auto-learning status
  updateAdminAutoLearnStatus() {
    const autoLearnSection = document.getElementById('autoLearnSection');
    const autoLearnTab = document.querySelector('.admin-main-tab[data-tab="autolearn"]');
    const isConnected = window.spotifyAccessToken && window.spotifyAccessToken.length > 0;
    
    // Show/hide the auto-learning section based on Spotify connection
    if (autoLearnSection) {
      autoLearnSection.style.display = isConnected ? 'block' : 'none';
    }
    
    // Show/hide the auto-learning tab based on Spotify connection
    if (autoLearnTab) {
      autoLearnTab.style.display = isConnected ? 'block' : 'none';
      
      // If auto-learning tab is hidden and currently active, switch to settings tab
      if (!isConnected && autoLearnTab.classList.contains('active')) {
        const settingsTab = document.querySelector('.admin-main-tab[data-tab="settings"]');
        if (settingsTab) {
          settingsTab.click();
        }
      }
    }
  }

  // Initialize settings button handlers
  initializeSettingsButtonHandlers() {
    const savePlaybackSettingsButton = document.getElementById('savePlaybackSettings');
    const saveLanguageSettingsButton = document.getElementById('saveLanguageSettings');
    const trackLockTimeInput = document.getElementById('trackLockTimeInput');
    const languageSelect = document.getElementById('languageSelect');
    
    // Admin settings save handler
    if (savePlaybackSettingsButton) {
      savePlaybackSettingsButton.addEventListener('click', () => {
        const newTrackLockTime = parseInt(trackLockTimeInput?.value, 10);
        if (isNaN(newTrackLockTime) || newTrackLockTime < 0 || newTrackLockTime > 480) {
          if (typeof window.toast !== 'undefined') {
            window.toast.warning('Bitte geben Sie eine gültige Zeit zwischen 0 und 480 Minuten ein.');
          }
          return;
        }
        
        window.trackLockTimeMinutes = newTrackLockTime;
        this.saveAdminSettings();
        if (typeof window.toast !== 'undefined') {
          window.toast.success('Wiedergabe-Einstellungen gespeichert!');
        }
        debugLog('admin', 'Track-Sperre aktualisiert:', newTrackLockTime, 'Minuten');
      });
    }
    
    // Language settings handlers
    if (saveLanguageSettingsButton) {
      saveLanguageSettingsButton.addEventListener('click', async () => {
        const selectedLanguage = languageSelect?.value;
        if (!selectedLanguage) {
          if (typeof window.toast !== 'undefined') {
            window.toast.warning('Bitte wählen Sie eine Sprache aus.');
          }
          return;
        }
        
        try {
          if (window.i18n && window.i18n.changeLanguage) {
            await window.i18n.changeLanguage(selectedLanguage);
            if (typeof window.toast !== 'undefined') {
              window.toast.success(window.t ? window.t('ui.messages.languageChanged', 'Sprache geändert!') : 'Sprache geändert!');
            }
            debugLog('admin', 'Language changed to:', selectedLanguage);
            
            // Update admin panel content after language change
            this.updateMusicServerStatus();
            this.updateAdminPanelContent();
          }
        } catch (error) {
          debugLog('ADMIN', 'Failed to change language:', error);
          if (typeof window.toast !== 'undefined') {
            window.toast.error('Fehler beim Ändern der Sprache');
          }
        }
      });
    }
    
    // Auto-change language on select change
    if (languageSelect) {
      languageSelect.addEventListener('change', async () => {
        const selectedLanguage = languageSelect.value;
        try {
          if (window.i18n && window.i18n.changeLanguage) {
            await window.i18n.changeLanguage(selectedLanguage);
            debugLog('admin', 'Language automatically changed to:', selectedLanguage);
            
            // Update admin panel content after language change  
            this.updateMusicServerStatus();
            this.updateAdminPanelContent();
          }
        } catch (error) {
          debugLog('ADMIN', 'Failed to auto-change language:', error);
        }
      });
    }
    
    debugLog('admin', 'Settings button handlers initialized');
  }

  // Initialize additional admin handlers (debug, visualization, PIN, data server)
  initializeAdditionalAdminHandlers() {
    // Debug toggle handler is now in setupDebuggingHandler() - don't duplicate it here
    
    // Interval input auto-save
    const intervalInput = document.getElementById('visualizationSwitchInterval');
    if (intervalInput) {
      intervalInput.addEventListener('change', () => {
        const newInterval = parseInt(intervalInput.value, 10);
        if (isNaN(newInterval) || newInterval < 5 || newInterval > 300) {
          if (typeof window.toast !== 'undefined') {
            window.toast.warning('Intervall muss zwischen 5 und 300 Sekunden liegen.');
          }
          if (window.visualizationSettings) {
            intervalInput.value = window.visualizationSettings.switchInterval; // Reset to previous value
          }
          return;
        }
        
        if (window.visualizationSettings) {
          window.visualizationSettings.switchInterval = newInterval;
          
          // Restart visualization rotation with new interval
          if (window.nowPlayingAnimationFrame && window.stopVisualizationModeRotation && window.startVisualizationModeRotation) {
            window.stopVisualizationModeRotation();
            window.startVisualizationModeRotation();
          }
          
          debugLog('admin', 'Visualisierungs-Intervall automatisch gespeichert:', newInterval);
          
          // Dispatch event for UI updates
          if (typeof document !== 'undefined') {
            document.dispatchEvent(new CustomEvent('visualizationSettingsChanged', {
              detail: { settings: window.visualizationSettings, source: 'interval-change' }
            }));
          }
        }
      });
    }

    // Admin PIN settings save handler
    const saveAdminPinButton = document.getElementById('saveAdminPinSettings');
    if (saveAdminPinButton) {
      saveAdminPinButton.addEventListener('click', async () => {
        const adminPinInput = document.getElementById('adminPinSetting');
        const newPin = adminPinInput?.value?.trim();
        
        if (!/^\d{4}$/.test(newPin)) {
          if (typeof window.toast !== 'undefined') {
            window.toast.warning('Bitte geben Sie eine 4-stellige PIN ein (nur Zahlen).');
          }
          return;
        }
        
        // Update admin settings
        const settings = this.getAdminSettings();
        // Save to Settings API instead of localStorage
        if (window.settingsAPI) {
          await window.settingsAPI.setSetting('admin', 'adminPin', newPin, 'string');
        }
        
        // Clear the input for security
        if (adminPinInput) {
          adminPinInput.value = '';
        }
        
        if (typeof window.toast !== 'undefined') {
          window.toast.success('Admin-PIN erfolgreich geändert!');
        }
        debugLog('admin', 'Admin-PIN aktualisiert');
      });
    }

    debugLog('admin', 'Additional admin handlers initialized');
  }

  // Initialize data server button handlers
  initializeDataServerButtonHandlers() {
    const rescanMusicButton = document.getElementById('rescanMusicButton');
    const refreshLibraryButton = document.getElementById('refreshLibraryButton');
    const cleanupDatabaseButton = document.getElementById('cleanupDatabaseButton');
    const clearDatabaseButton = document.getElementById('clearDatabaseButton');

    // Data Server buttons
    if (rescanMusicButton) {
      rescanMusicButton.addEventListener('click', async () => {
        try {
          rescanMusicButton.disabled = true;
          rescanMusicButton.textContent = 'Scanning...';
          
          if (window.musicAPI && window.musicAPI.rescan) {
            await window.musicAPI.rescan();
            if (typeof window.toast !== 'undefined') {
              window.toast.success('Data Server Rescan gestartet!');
            }
            
            // Update status after a delay
            setTimeout(() => {
              if (this.updateMusicServerStatus) {
                this.updateMusicServerStatus();
              }
            }, 2000);
          }
          
        } catch (error) {
          debugLog('DATA-API', 'Rescan failed:', error);
          if (typeof window.toast !== 'undefined') {
            window.toast.error('Rescan fehlgeschlagen: ' + error.message);
          }
        } finally {
          rescanMusicButton.disabled = false;
          rescanMusicButton.textContent = 'Musik neu scannen';
        }
      });
    }

    if (refreshLibraryButton) {
      refreshLibraryButton.addEventListener('click', async () => {
        try {
          refreshLibraryButton.disabled = true;
          refreshLibraryButton.textContent = 'Scanne...';
          
          // Clear current library data
          if (window.library) {
            window.library.length = 0;
          }
          if (window.recentAdditions) {
            window.recentAdditions.length = 0;
          }
          
          // Trigger a full rescan on the data server
          const rescanResponse = await fetch(window.getAPIURL ? window.getAPIURL('/api/rescan') : '/api/rescan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
          });
          
          if (!rescanResponse.ok) {
            throw new Error(`HTTP ${rescanResponse.status}`);
          }
          
          // Wait a moment for the rescan to start
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          // Reload from data server
          if (window.loadLocalIndex) {
            await window.loadLocalIndex();
          }
          if (typeof window.toast !== 'undefined') {
            window.toast.success('Bibliothek vollständig aktualisiert!');
          }
          
          this.updateMusicServerStatus();
          
        } catch (error) {
          debugLog('DATA-API', 'Refresh failed:', error);
          if (typeof window.toast !== 'undefined') {
            window.toast.error('Aktualisierung fehlgeschlagen: ' + error.message);
          }
        } finally {
          refreshLibraryButton.disabled = false;
          refreshLibraryButton.textContent = 'Bibliothek aktualisieren';
        }
      });
    }

    if (cleanupDatabaseButton) {
      cleanupDatabaseButton.addEventListener('click', async () => {
        if (!confirm('Verwaiste Datenbankeinträge löschen? Dies kann nicht rückgängig gemacht werden.')) {
          return;
        }
        
        try {
          cleanupDatabaseButton.disabled = true;
          cleanupDatabaseButton.textContent = '🧹 Bereinige...';
          cleanupDatabaseButton.style.background = '#666';
          
          const response = await fetch(window.getAPIURL ? window.getAPIURL('/api/cleanup') : '/api/cleanup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
          });
          
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
          
          const result = await response.json();
          if (result.success) {
            if (typeof window.toast !== 'undefined') {
              window.toast.success(`Cleanup completed: ${result.removedCount} orphaned entries removed`);
            }
            // Update status after cleanup
            setTimeout(() => {
              if (this.updateMusicServerStatus) {
                this.updateMusicServerStatus();
              }
            }, 1000);
          } else {
            throw new Error(result.error || 'Cleanup fehlgeschlagen');
          }
          
        } catch (error) {
          debugLog('DATA-API', 'Cleanup failed:', error);
          if (typeof window.toast !== 'undefined') {
            window.toast.error('Bereinigung fehlgeschlagen: ' + error.message);
          }
        } finally {
          cleanupDatabaseButton.disabled = false;
          cleanupDatabaseButton.textContent = '🧹 Datenbank bereinigen';
          cleanupDatabaseButton.style.background = '#e74c3c';
        }
      });
    }

    if (clearDatabaseButton) {
      clearDatabaseButton.addEventListener('click', async () => {
        if (!confirm('WARNUNG: Alle Daten in der Datenbank werden unwiderruflich gelöscht!\n\nDies umfasst:\n- Alle Track-Metadaten\n- Alle Abspielstatistiken\n- Alle Album-Cover\n- Spotify-Track-Daten\n\nFortfahren?')) {
          return;
        }
        
        // Double confirmation for such a destructive action
        if (!confirm('Sind Sie WIRKLICH sicher? Diese Aktion kann NICHT rückgängig gemacht werden!')) {
          return;
        }
        
        try {
          clearDatabaseButton.disabled = true;
          clearDatabaseButton.textContent = '🗑️ Lösche...';
          clearDatabaseButton.style.background = '#666';
          
          const response = await fetch(window.getAPIURL ? window.getAPIURL('/api/clear-database') : '/api/clear-database', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
          });
          
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
          
          const result = await response.json();
          if (result.success) {
            if (typeof window.toast !== 'undefined') {
              window.toast.success('Datenbank vollständig geleert');
            }
            
            // Clear local data as well
            if (window.library) {
              window.library.length = 0;
            }
            if (window.recentAdditions) {
              window.recentAdditions.length = 0;
            }
            if (window.queue) {
              window.queue.length = 0;
            }
            
            // Update UI
            this.updateMusicServerStatus();
            if (window.renderLibraryView) {
              window.renderLibraryView();
            }
            
          } else {
            throw new Error(result.error || 'Database clear fehlgeschlagen');
          }
          
        } catch (error) {
          debugLog('DATA-API', 'Clear database failed:', error);
          if (typeof window.toast !== 'undefined') {
            window.toast.error('Datenbankbereinigung fehlgeschlagen: ' + error.message);
          }
        } finally {
          clearDatabaseButton.disabled = false;
          clearDatabaseButton.textContent = '🗑️ Datenbank leeren';
          clearDatabaseButton.style.background = '#dc3545';
        }
      });
    }

    debugLog('admin', 'Data server button handlers initialized');
  }

  // Admin settings managed by Settings API only
  getAdminSettingsFromStorage() {
    // No localStorage access - Settings API handles persistence
    debugLog('admin', 'Admin settings managed by Settings API');
    return {};
  }

  // Load language settings
  loadLanguageSettings() {
    const languageSelect = document.getElementById('languageSelect');
    if (languageSelect && window.i18nSystem) {
      const currentLanguage = window.i18nSystem.currentLanguage;
      if (currentLanguage) {
        languageSelect.value = currentLanguage;
      }
      debugLog('admin', 'Language settings loaded:', currentLanguage);
    }
  }

  // Update admin panel specific content after language change
  updateAdminPanelContent() {
    // Update event list if it exists - delegate to GEMA reporting manager
    const savedEventsList = document.getElementById('savedEventsList');
    if (savedEventsList && savedEventsList.children.length === 1) {
      const firstChild = savedEventsList.children[0];
      if (firstChild.textContent.includes('Keine gespeicherten') || firstChild.textContent.includes('No saved events')) {
        // Call the delegated method
        if (window.adminPanel && window.adminPanel.loadSavedEventsList) {
          window.adminPanel.loadSavedEventsList();
        }
      }
    }
  }

  // Update language dropdown to match current i18n language
  updateLanguageDropdown() {
    const languageSelect = document.getElementById('languageSelect');
    if (languageSelect && window.i18nSystem) {
      const currentLanguage = window.i18nSystem.currentLanguage;
      if (currentLanguage && languageSelect.value !== currentLanguage) {
        languageSelect.value = currentLanguage;
      }
    }
  }

  // Update Data Server Status in Admin Panel
  async updateMusicServerStatus() {
    const musicServerStatusEl = document.getElementById('musicServerStatus');
    const musicServerStatsEl = document.getElementById('musicServerStats');
    
    if (!musicServerStatusEl) return;
    
    try {
      if (!window.musicAPI) {
        throw new Error('musicAPI not available');
      }
      
      const health = await window.musicAPI.health();
      const stats = await window.musicAPI.getStats();
      
      musicServerStatusEl.style.color = '#1DB954';
      const connectedText = (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? 
        window.i18nSystem.t('ui.labels.dataServerConnected') : 
        '✅ Data Server verbunden';
      musicServerStatusEl.textContent = connectedText;
      
      if (musicServerStatsEl && stats.data) {
        const { total_tracks, total_artists, total_albums, total_duration } = stats.data;
        const hours = Math.floor(total_duration / 3600);
        const minutes = Math.floor((total_duration % 3600) / 60);
        
        const tracksText = (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.labels.tracks') : 'Tracks';
        const artistsText = (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.labels.artists') : 'Künstler';
        const albumsText = (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.labels.albums') : 'Alben';
        const playtimeText = (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.labels.totalPlaytime') : 'Gesamtspielzeit';
        
        musicServerStatsEl.innerHTML = `
          📊 ${total_tracks || 0} ${tracksText} • ${total_artists || 0} ${artistsText} • ${total_albums || 0} ${albumsText}<br>
          ⏱️ ${hours}h ${minutes}m ${playtimeText}
        `;
      }
      
      // Update cover cache statistics
      this.updateCoverCacheStats();
      
    } catch (error) {
      musicServerStatusEl.style.color = '#e74c3c';
      const notReachableText = (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? 
        window.i18nSystem.t('ui.labels.dataServerNotReachable') : 
        '❌ Data Server nicht erreichbar';
      musicServerStatusEl.textContent = notReachableText;
      
      if (musicServerStatsEl) {
        const startServerText = (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? 
          window.i18nSystem.t('ui.labels.startDataServer') : 
          'Starte den Data Server mit: npm start';
        musicServerStatsEl.textContent = startServerText;
      }
    }
  }

  // Update cover cache statistics display
  updateCoverCacheStats() {
    const coverCacheStatsEl = document.getElementById('coverCacheStats');
    if (!coverCacheStatsEl) return;
    
    // Since we now use browser cache, show different stats
    const browserCacheSupported = 'caches' in window;
    const domCacheStats = window.domCache ? {
      artists: window.domCache.artists?.size || 0,
      albums: window.domCache.albums?.size || 0,
      tracks: window.domCache.tracks?.size || 0
    } : { artists: 0, albums: 0, tracks: 0 };
    
    coverCacheStatsEl.innerHTML = `
      🖼️ Cover-Cache: Browser-Cache ${browserCacheSupported ? '✅' : '❌'} • DOM-Cache: ${domCacheStats.artists + domCacheStats.albums + domCacheStats.tracks} Views<br>
      📈 Artists: ${domCacheStats.artists} • Albums: ${domCacheStats.albums} • Tracks: ${domCacheStats.tracks}
    `;
  }



  // Load settings from API and update UI
  async loadSettingsFromAPI() {
    console.log('[ADMIN] loadSettingsFromAPI() started');
    try {
      // Check if Settings API is available first
      console.log('[ADMIN] Checking Settings API availability:', !!window.settingsAPI);
      if (!window.settingsAPI) {
        console.error('[ADMIN] ERROR: Settings API not available!');
        return;
      }
      
      console.log('[ADMIN] About to load settings from Settings API...');
      debugLog('admin', '⚙️  Loading settings from Settings API...');

      // Clear cache to force fresh load
      if (window.settingsAPI && window.settingsAPI.clearCache) {
        window.settingsAPI.clearCache();
        debugLog('admin', '🧹 Settings cache cleared for fresh load');
      }

      // Load all admin settings
      console.log('[ADMIN] Loading admin settings...');
      const adminSettings = await window.settingsAPI.getAdminSettings();
      console.log('[ADMIN] Admin settings loaded:', adminSettings);
      
      console.log('[ADMIN] Loading visualization settings...');
      const visualizationSettings = await window.settingsAPI.getVisualizationSettings();
      console.log('[ADMIN] Visualization settings loaded:', visualizationSettings);
      
      console.log('[ADMIN] Loading audio settings...');
      const audioSettings = await window.settingsAPI.getAudioSettings();
      const uiSettings = await window.settingsAPI.getUISettings();

      debugLog('admin', '🔍 Raw visualization settings from API:', visualizationSettings);

      // Ensure all visualization settings exist with default values
      const requiredVizSettings = {
        enableSpace: true,
        enableFire: true,
        enableParticles: false,
        enableCircles: true,
        enableLightning: true,
        switchInterval: 30
      };

      for (const [key, defaultValue] of Object.entries(requiredVizSettings)) {
        if (visualizationSettings[key] === undefined || visualizationSettings[key] === null) {
          debugLog('admin', `🔍 ${key} setting not found, creating with default value:`, defaultValue);
          const type = typeof defaultValue === 'boolean' ? 'boolean' : 'number';
          const success = await window.settingsAPI.setSetting('visualization', key, defaultValue, type);
          debugLog('admin', `🔍 Created ${key} setting, success:`, success);
        } else {
          debugLog('admin', `✅ ${key} setting already exists:`, visualizationSettings[key]);
        }
      }

      // Reload visualization settings to get any newly created settings
      const updatedVisualizationSettings = await window.settingsAPI.getVisualizationSettings();
      debugLog('admin', '🔍 Final visualization settings:', updatedVisualizationSettings);
      
      // Verify Lightning setting specifically
      if (updatedVisualizationSettings.enableLightning) {
        debugLog('admin', '✅ Lightning setting loaded successfully:', updatedVisualizationSettings.enableLightning);
      } else {
        debugLog('admin', '❌ Lightning setting still missing after creation attempt');
        // Try to create it again with more debugging
        const lightningSuccess = await window.settingsAPI.setSetting('visualization', 'enableLightning', true, 'boolean');
        debugLog('admin', '🔄 Retry Lightning creation result:', lightningSuccess);
      }

      // Ensure Lightning setting exists with default value
      if (updatedVisualizationSettings.enableLightning === undefined || updatedVisualizationSettings.enableLightning === null) {
        debugLog('admin', '🔍 Lightning setting not found, creating with default value');
        await window.settingsAPI.setSetting('visualization', 'enableLightning', true, 'boolean');
        // Reload visualization settings to get the newly created setting
        const reloadedSettings = await window.settingsAPI.getVisualizationSettings();
        Object.assign(updatedVisualizationSettings, reloadedSettings);
      }

      // Update debug system FIRST to set the correct state
      const debugEnabled = adminSettings.debuggingEnabled?.value ?? adminSettings.debuggingEnabled ?? false;
      console.log('[ADMIN] About to call updateDebugSystem with debugEnabled:', debugEnabled);
      this.updateDebugSystem(debugEnabled);
      console.log('[ADMIN] updateDebugSystem completed');

      // Update UI elements - now with correct debug state
      console.log('[ADMIN] About to call updateAdminUI with adminSettings:', adminSettings);
      this.updateAdminUI(adminSettings);
      this.updateVisualizationUI(updatedVisualizationSettings);
      this.updateGlobalVariables(adminSettings, updatedVisualizationSettings, audioSettings, uiSettings);

      // Emit settings loaded event
      document.dispatchEvent(new CustomEvent('settingsLoaded', {
        detail: { adminSettings, visualizationSettings: updatedVisualizationSettings, audioSettings, uiSettings }
      }));

      // Mark settings as loaded
      this.settingsLoaded = true;

      debugLog('admin', '⚙️  Settings loaded from API');
      console.log('[ADMIN] loadSettingsFromAPI() completed successfully');
    } catch (error) {
      console.error('[ADMIN] ERROR in loadSettingsFromAPI():', error);
      console.error('[ADMIN] Error stack:', error.stack);
      debugLog('ADMIN', '❌ Error loading settings from API:', error);
    }
  }

  // Update debug system with current setting (with preservation logic)
  updateDebugSystem(debuggingEnabled) {
    try {
      // Always set debug state to match admin settings - simple and predictable
      if (typeof window.setDebuggingState === 'function') {
        window.setDebuggingState(debuggingEnabled, 'settings-api');
        
        if (debuggingEnabled) {
          debugLog('admin', '⚙️  Debug system activated via Settings API');
        } else {
          debugLog('admin', '⚙️  Debug system deactivated via Settings API');
        }
      }
    } catch (error) {
      debugLog('ADMIN', 'Could not sync debug system:', error);
    }
  }

  updateAdminUI(adminSettings) {
    console.log('[ADMIN] updateAdminUI called with settings:', adminSettings);
    
    // Track Lock Time
    const trackLockTimeInput = document.getElementById('trackLockTime');
    if (trackLockTimeInput && adminSettings.trackLockTimeMinutes) {
      trackLockTimeInput.value = adminSettings.trackLockTimeMinutes.value;
    }

    // Debugging Toggle - show actual current debug state, not just database value
    const debugToggle = document.getElementById('debugToggle');
    console.log('[ADMIN] updateAdminUI - debugToggle element found:', !!debugToggle);
    if (debugToggle) {
      // Get current actual debug state from debug system
      let currentDebugState = false;
      if (typeof window.isDebuggingEnabled === 'function') {
        currentDebugState = window.isDebuggingEnabled();
        console.log('[ADMIN] updateAdminUI - Debug state from function:', currentDebugState);
      } else if (adminSettings.debuggingEnabled !== undefined && adminSettings.debuggingEnabled !== null) {
        // Fallback to database value if debug system not available
        currentDebugState = adminSettings.debuggingEnabled.value;
        console.log('[ADMIN] updateAdminUI - Debug state from DB fallback:', currentDebugState);
      }
      
      // Sync debug toggle with the actual debug system state first
      this.syncDebugToggle();
      
      // Then ensure UI reflects the correct state
      console.log('[ADMIN] updateAdminUI - Final debug toggle check:', debugToggle.checked);
      debugLog('admin', '🔧 Debug toggle finalized at state:', debugToggle.checked);
    }

    // Admin PIN (don't pre-fill for security)
    const adminPinInput = document.getElementById('adminPinSetting');
    if (adminPinInput) {
      adminPinInput.placeholder = '4-stellige PIN (aktuell gesetzt)';
    }
  }

  updateVisualizationUI(visualizationSettings) {
    // Visualization checkboxes - use current global values if available, fallback to database values
    const enableSpaceViz = document.getElementById('enableSpaceViz');
    const enableFireViz = document.getElementById('enableFireViz');
    const enableParticlesViz = document.getElementById('enableParticlesViz');
    const enableCirclesViz = document.getElementById('enableCirclesViz');
    const enableLightningViz = document.getElementById('enableLightningViz');
    const switchIntervalInput = document.getElementById('visualizationSwitchInterval');

    // Get current live values from global visualizationSettings with robust fallback
    const currentSettings = window.visualizationSettings || {};
    
    // Helper function to extract value from settings API response
    const getValue = (setting, defaultVal) => {
      if (setting === undefined || setting === null) return defaultVal;
      if (typeof setting === 'object' && setting.value !== undefined) return setting.value;
      return setting;
    };
    
    if (enableSpaceViz) {
      const currentValue = currentSettings.enableSpace !== undefined ? 
        currentSettings.enableSpace : 
        getValue(visualizationSettings.enableSpace, true);
      enableSpaceViz.checked = currentValue;
      debugLog('admin', '🔍 Space checkbox set to:', currentValue);
    }
    if (enableFireViz) {
      const currentValue = currentSettings.enableFire !== undefined ? 
        currentSettings.enableFire : 
        getValue(visualizationSettings.enableFire, true);
      enableFireViz.checked = currentValue;
      debugLog('admin', '🔍 Fire checkbox set to:', currentValue);
    }
    if (enableParticlesViz) {
      const currentValue = currentSettings.enableParticles !== undefined ? 
        currentSettings.enableParticles : 
        getValue(visualizationSettings.enableParticles, false);
      enableParticlesViz.checked = currentValue;
      debugLog('admin', '🔍 Particles checkbox set to:', currentValue);
    }
    if (enableCirclesViz) {
      const currentValue = currentSettings.enableCircles !== undefined ? 
        currentSettings.enableCircles : 
        getValue(visualizationSettings.enableCircles, true);
      enableCirclesViz.checked = currentValue;
      debugLog('admin', '🔍 Circles checkbox set to:', currentValue);
    }
    if (enableLightningViz) {
      const currentValue = currentSettings.enableLightning !== undefined ? 
        currentSettings.enableLightning : 
        getValue(visualizationSettings.enableLightning, true);
      enableLightningViz.checked = currentValue;
      debugLog('admin', '🔍 Lightning checkbox set to:', currentValue, 'from settings:', visualizationSettings.enableLightning, 'extracted value:', getValue(visualizationSettings.enableLightning, true));
    }
    if (switchIntervalInput) {
      const currentValue = currentSettings.switchInterval !== undefined ? 
        currentSettings.switchInterval : visualizationSettings.switchInterval?.value ?? 30;
      switchIntervalInput.value = currentValue;
    }
    
    debugLog('admin', '🎨 Visualization UI updated with current values:', {
      space: enableSpaceViz?.checked,
      fire: enableFireViz?.checked,
      particles: enableParticlesViz?.checked,
      circles: enableCirclesViz?.checked,
      lightning: enableLightningViz?.checked,
      interval: switchIntervalInput?.value
    });
  }

  updateGlobalVariables(adminSettings, visualizationSettings, audioSettings, uiSettings) {
    // Update global variables used by existing code
    if (typeof window.trackLockTimeMinutes !== 'undefined' && adminSettings.trackLockTimeMinutes) {
      window.trackLockTimeMinutes = adminSettings.trackLockTimeMinutes.value;
    }
    
    // Debug state is managed by debug.js via setDebuggingState() - don't set it directly here

    // SET the global visualization settings (from Settings API, not defaults!)
    if (visualizationSettings) {
      // Extract values properly from Settings API format
      const getValue = (setting, defaultVal) => {
        if (setting === undefined || setting === null) return defaultVal;
        if (typeof setting === 'object' && setting.value !== undefined) return setting.value;
        return setting;
      };
      
      window.visualizationSettings = {
        enableSpace: getValue(visualizationSettings.enableSpace, true),
        enableFire: getValue(visualizationSettings.enableFire, true),
        enableParticles: getValue(visualizationSettings.enableParticles, false),
        enableCircles: getValue(visualizationSettings.enableCircles, true),
        enableLightning: getValue(visualizationSettings.enableLightning, true),
        switchInterval: getValue(visualizationSettings.switchInterval, 30)
      };
      
      debugLog('admin', '🎨 Global visualization settings SET from Settings API:', window.visualizationSettings);
    }
  }

  setupEventListeners() {
    // Wait for DOM to be ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.attachEventListeners());
    } else {
      this.attachEventListeners();
    }
  }

  attachEventListeners() {
    // Replace existing event listeners with API-based ones
    this.setupTrackLockTimeHandler();
    this.setupAdminPinHandler();
    this.setupDebuggingHandler();
    this.setupVisualizationHandlers();
    this.setupSpotifyConfigHandler();
  }

  setupTrackLockTimeHandler() {
    const saveButton = document.getElementById('savePlaybackSettings');
    const trackLockTimeInput = document.getElementById('trackLockTime');

    if (saveButton && trackLockTimeInput) {
      // Remove existing listeners
      const newSaveButton = saveButton.cloneNode(true);
      saveButton.parentNode.replaceChild(newSaveButton, saveButton);

      newSaveButton.addEventListener('click', async () => {
        const newTrackLockTime = parseInt(trackLockTimeInput.value, 10);
        if (isNaN(newTrackLockTime) || newTrackLockTime < 0 || newTrackLockTime > 480) {
          if (typeof window.toast !== 'undefined') {
            window.toast.warning('Bitte geben Sie eine gültige Zeit zwischen 0 und 480 Minuten ein.');
          }
          return;
        }

        const success = await window.settingsAPI.setSetting('admin', 'trackLockTimeMinutes', newTrackLockTime, 'number');
        if (success) {
          window.trackLockTimeMinutes = newTrackLockTime;
          if (typeof window.toast !== 'undefined') {
            window.toast.success('Wiedergabe-Einstellungen gespeichert!');
          }
          debugLog('admin', '⚙️  Track-Sperre aktualisiert:', newTrackLockTime, 'Minuten');
        } else {
          if (typeof window.toast !== 'undefined') {
            window.toast.error('Fehler beim Speichern der Einstellungen');
          }
        }
      });
    }
  }

  setupAdminPinHandler() {
    const saveButton = document.getElementById('saveAdminPinSettings');
    const adminPinInput = document.getElementById('adminPinSetting');

    if (saveButton && adminPinInput) {
      // Remove existing listeners
      const newSaveButton = saveButton.cloneNode(true);
      saveButton.parentNode.replaceChild(newSaveButton, saveButton);

      newSaveButton.addEventListener('click', async () => {
        const newPin = adminPinInput.value.trim();

        if (!/^\d{4}$/.test(newPin)) {
          if (typeof window.toast !== 'undefined') {
            window.toast.warning('Bitte geben Sie eine 4-stellige PIN ein (nur Zahlen).');
          }
          return;
        }

        const success = await window.settingsAPI.setSetting('admin', 'adminPin', newPin, 'string');
        if (success) {
          adminPinInput.value = '';
          if (typeof window.toast !== 'undefined') {
            window.toast.success('Admin-PIN erfolgreich geändert!');
          }
          debugLog('admin', '⚙️  Admin-PIN aktualisiert');
        } else {
          if (typeof window.toast !== 'undefined') {
            window.toast.error('Fehler beim Speichern der PIN');
          }
        }
      });
    }
  }

  setupDebuggingHandler() {
    const debugToggle = document.getElementById('debugToggle');

    if (debugToggle) {
      // Remove existing listeners by cloning the element
      const newDebugToggle = debugToggle.cloneNode(true);
      debugToggle.parentNode.replaceChild(newDebugToggle, debugToggle);
      
      newDebugToggle.addEventListener('change', async () => {
        const enabled = newDebugToggle.checked;
        debugLog('admin', '🐛 Debug toggle clicked - New state will be:', enabled);
        console.log('[ADMIN] Debug toggle changed to:', enabled);
        
        const success = await window.settingsAPI.setSetting('admin', 'debuggingEnabled', enabled, 'boolean');
        if (success) {
          // Use the proper debug API function to set state
          if (typeof window.setDebuggingState === 'function') {
            window.setDebuggingState(enabled, 'admin-panel');
            console.log('[ADMIN] Debug state set via setDebuggingState to:', enabled);
          }
          debugLog('admin', '⚙️  Debugging-Modus:', enabled ? 'aktiviert' : 'deaktiviert');
        } else {
          // Revert checkbox on failure
          newDebugToggle.checked = !enabled;
          console.error('[ADMIN] Failed to save debug setting - reverting checkbox');
          if (typeof window.toast !== 'undefined') {
            window.toast.error('Fehler beim Ändern des Debugging-Modus');
          }
        }
      });
    }
  }

  setupVisualizationHandlers() {
    const visualizationInputs = [
      'enableSpaceViz',
      'enableFireViz',
      'enableParticlesViz',
      'enableCirclesViz',
      'enableLightningViz'
    ];

    const settingKeys = {
      'enableSpaceViz': 'enableSpace',
      'enableFireViz': 'enableFire',
      'enableParticlesViz': 'enableParticles',
      'enableCirclesViz': 'enableCircles',
      'enableLightningViz': 'enableLightning'
    };    // Handle checkboxes with auto-save
    visualizationInputs.forEach(inputId => {
      const input = document.getElementById(inputId);
      if (input) {
        input.addEventListener('change', async () => {
          const settingKey = settingKeys[inputId];
          const enabled = input.checked;
          
          debugLog('admin', `🔍 Checkbox ${inputId} changed to:`, enabled, 'for key:', settingKey);
          
          // Update global settings immediately
          if (window.visualizationSettings) {
            window.visualizationSettings[settingKey] = enabled;
            debugLog('admin', '🔍 Updated global settings:', window.visualizationSettings);
          }
          
          // Save to Settings API (primary storage)
          try {
            const apiSuccess = await window.settingsAPI.setSetting('visualization', settingKey, enabled, 'boolean');
            debugLog('admin', `🔍 Settings API save result for ${settingKey}:`, apiSuccess);
            
            if (apiSuccess) {
              // Update VisualizerModule immediately
              if (window.VisualizerModule && window.VisualizerModule.updateSettings) {
                window.VisualizerModule.updateSettings(window.visualizationSettings);
                debugLog('admin', '🎨 VisualizerModule updated immediately with:', window.visualizationSettings);
              }
              
              debugLog('admin', `⚙️  Visualization ${settingKey}:`, enabled ? 'aktiviert' : 'deaktiviert');
            } else {
              // Revert checkbox on failure
              input.checked = !enabled;
              window.visualizationSettings[settingKey] = !enabled; // Revert global setting too
              if (typeof window.toast !== 'undefined') {
                window.toast.error('Fehler beim Speichern der Visualisierungs-Einstellung');
              }
              debugLog('admin', `❌ Failed to save ${settingKey}, reverted to:`, !enabled);
            }
          } catch (error) {
            debugLog('admin', `❌ Error saving ${settingKey}:`, error);
            // Revert on error
            input.checked = !enabled;
            window.visualizationSettings[settingKey] = !enabled;
          }
        });
      }
    });

    // Handle switch interval
    const switchIntervalInput = document.getElementById('visualizationSwitchInterval');
    if (switchIntervalInput) {
      let debounceTimer;
      switchIntervalInput.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(async () => {
          const interval = parseInt(switchIntervalInput.value, 10);
          if (!isNaN(interval) && interval >= 5 && interval <= 300) {
            const success = await window.settingsAPI.setSetting('visualization', 'switchInterval', interval, 'number');
            if (success) {
              if (window.visualizationSettings) {
                window.visualizationSettings.switchInterval = interval;
              }
              debugLog('admin', '⚙️  Visualization switch interval:', interval, 'Sekunden');
            }
          }
        }, 1000); // 1 second debounce
      });
    }
  }

  // Method to get current PIN for validation
  async getCurrentAdminPin() {
    return await window.settingsAPI.getSetting('admin', 'adminPin', '1234');
  }

  // Method to validate PIN
  async validateAdminPin(inputPin) {
    const currentPin = await this.getCurrentAdminPin();
    return inputPin === currentPin;
  }

  // Method to sync debug toggle with current debug state
  syncDebugToggle() {
    const debugToggle = document.getElementById('debugToggle');
    if (debugToggle) {
      let currentDebugState = false;
      if (typeof window.isDebuggingEnabled === 'function') {
        currentDebugState = window.isDebuggingEnabled();
      }
      
      debugLog('admin', '🔍 Debug toggle sync - Toggle state:', debugToggle.checked, 'System state:', currentDebugState);
      
      // Only sync if there's actually a difference - don't fight with user clicks
      if (debugToggle.checked !== currentDebugState) {
        console.log('[ADMIN] Syncing debug toggle from', debugToggle.checked, 'to', currentDebugState);
        debugToggle.checked = currentDebugState;
        debugLog('admin', '🔧 Debug toggle synced to current state:', currentDebugState);
        
        // Verify the toggle was actually set
        setTimeout(() => {
          const verifyToggle = document.getElementById('debugToggle');
          if (verifyToggle) {
            debugLog('admin', '🔍 Debug toggle verification - Expected:', currentDebugState, 'Actual:', verifyToggle.checked);
            if (verifyToggle.checked !== currentDebugState) {
              debugLog('admin', '❌ Debug toggle was overridden after sync!');
            }
          }
        }, 100);
      } else {
        debugLog('admin', '✅ Debug toggle already in sync');
      }
    } else {
      debugLog('admin', '❌ Debug toggle element not found');
    }
  }

  // Method to sync visualization settings with current global state
  syncVisualizationToggles() {
    const currentSettings = window.visualizationSettings || {};
    
    const toggles = {
      enableSpaceViz: 'enableSpace',
      enableFireViz: 'enableFire', 
      enableParticlesViz: 'enableParticles',
      enableCirclesViz: 'enableCircles'
    };
    
    Object.entries(toggles).forEach(([elementId, settingKey]) => {
      const element = document.getElementById(elementId);
      if (element && currentSettings[settingKey] !== undefined) {
        if (element.checked !== currentSettings[settingKey]) {
          element.checked = currentSettings[settingKey];
          debugLog('admin', `🎨 ${settingKey} toggle synced to:`, currentSettings[settingKey]);
        }
      }
    });
    
    // Sync switch interval
    const switchIntervalInput = document.getElementById('visualizationSwitchInterval');
    if (switchIntervalInput && currentSettings.switchInterval !== undefined) {
      if (parseInt(switchIntervalInput.value) !== currentSettings.switchInterval) {
        switchIntervalInput.value = currentSettings.switchInterval;
        debugLog('admin', '🎨 Switch interval synced to:', currentSettings.switchInterval);
      }
    }
  }

  // Setup Spotify configuration modal handlers
  setupSpotifyConfigHandler() {
    const spotifyConfigBtn = document.getElementById('spotifyConfigBtn');
    const spotifyConfigModal = document.getElementById('spotifyConfigModal');
    const closeSpotifyConfigModal = document.getElementById('closeSpotifyConfigModal');
    const cancelSpotifyConfig = document.getElementById('cancelSpotifyConfig');
    const saveSpotifyConfig = document.getElementById('saveSpotifyConfig');
    const spotifyClientIdInput = document.getElementById('spotifyClientId');

    if (!spotifyConfigBtn || !spotifyConfigModal) return;

    // Open modal
    spotifyConfigBtn.addEventListener('click', async () => {
      // Load current Spotify Client ID from settings
      try {
        const currentClientId = await window.settingsAPI.getSetting('spotify', 'clientId', '');
        if (spotifyClientIdInput) {
          spotifyClientIdInput.value = currentClientId || '';
        }
      } catch (error) {
        debugLog('SPOTIFY', 'Could not load current Spotify Client ID:', error);
      }

      spotifyConfigModal.classList.remove('hidden');
      if (spotifyClientIdInput) {
        spotifyClientIdInput.focus();
      }
    });

    // Close modal handlers
    const closeModal = () => {
      spotifyConfigModal.classList.add('hidden');
    };

    if (closeSpotifyConfigModal) {
      closeSpotifyConfigModal.addEventListener('click', closeModal);
    }

    if (cancelSpotifyConfig) {
      cancelSpotifyConfig.addEventListener('click', closeModal);
    }

    // Close on overlay click
    spotifyConfigModal.addEventListener('click', (e) => {
      if (e.target === spotifyConfigModal) {
        closeModal();
      }
    });

    // Save configuration
    if (saveSpotifyConfig && spotifyClientIdInput) {
      saveSpotifyConfig.addEventListener('click', async () => {
        const newClientId = spotifyClientIdInput.value.trim();

        if (!newClientId) {
          if (typeof window.toast !== 'undefined') {
            window.toast.warning('Bitte geben Sie eine gültige Spotify Client ID ein.');
          }
          return;
        }

        // Validate Client ID format (basic check)
        if (!/^[a-zA-Z0-9]{32}$/.test(newClientId)) {
          if (typeof window.toast !== 'undefined') {
            window.toast.warning('Ungültiges Client ID Format. Die ID sollte 32 Zeichen lang sein.');
          }
          return;
        }

        try {
          // Save to settings database
          const success = await window.settingsAPI.setSetting(
            'spotify', 
            'clientId', 
            newClientId, 
            'string',
            'Spotify App Client ID für OAuth-Authentifizierung'
          );

          if (success) {
            // Update the jukebox.js configuration
            if (typeof window.loadSpotifyClientId === 'function') {
              await window.loadSpotifyClientId();
            }
            
            // Update the spotify.js configuration if available
            if (window.spotify && typeof window.spotify.updateClientId === 'function') {
              window.spotify.updateClientId(newClientId);
            }

            if (typeof window.toast !== 'undefined') {
              window.toast.success('Spotify Client ID erfolgreich gespeichert! Bitte melden Sie sich erneut bei Spotify an.');
            }

            debugLog('admin', '🎵 Spotify Client ID updated:', newClientId.substring(0, 8) + '...');
            closeModal();

            // Disconnect current Spotify session to force re-authentication
            if (window.spotify && typeof window.spotify.disconnect === 'function') {
              window.spotify.disconnect();
            }

          } else {
            if (typeof window.toast !== 'undefined') {
              window.toast.error('Fehler beim Speichern der Client ID. Bitte versuchen Sie es erneut.');
            }
          }

        } catch (error) {
          debugLog('SPOTIFY', 'Error saving Spotify Client ID:', error);
          if (typeof window.toast !== 'undefined') {
            window.toast.error('Fehler beim Speichern der Konfiguration: ' + error.message);
          }
        }
      });
    }

    // Handle Enter key in input field
    if (spotifyClientIdInput) {
      spotifyClientIdInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          saveSpotifyConfig.click();
        }
        if (e.key === 'Escape') {
          closeModal();
        }
      });
    }
  }
}

// Initialize the admin settings manager
document.addEventListener('DOMContentLoaded', () => {
  // Wait for settingsAPI to be available
  const initManager = () => {
    if (window.settingsAPI) {
      window.adminSettingsManager = new AdminSettingsManager();
      debugLog('admin', '⚙️  Admin Settings Manager initialized');
      
      // Set up visualization toggle sync when admin panel is opened
      document.addEventListener('click', (event) => {
        if (event.target && event.target.id === 'adminBtn') {
          // Admin panel opened - sync visualization toggles only
          setTimeout(() => {
            if (window.adminSettingsManager) {
              // Debug toggle is synced by loadAdminSettings, no need to sync twice
              window.adminSettingsManager.syncVisualizationToggles();
            }
          }, 100);
        }
      });
      
      // Listen for debug state changes
      document.addEventListener('debugStateChanged', () => {
        if (window.adminSettingsManager) {
          window.adminSettingsManager.syncDebugToggle();
        }
      });
      
      // Listen for visualization settings changes
      document.addEventListener('visualizationSettingsChanged', () => {
        if (window.adminSettingsManager) {
          window.adminSettingsManager.syncVisualizationToggles();
        }
      });
      
    } else {
      setTimeout(initManager, 100);
    }
  };
  initManager();
});

// Export for use in other scripts
window.AdminSettingsManager = AdminSettingsManager;

// ==============================================
// ADMIN PANEL UI FUNCTIONS (moved from jukebox.js)
// ==============================================

// DOM element references (will be set by jukebox.js)
let pinInput = null;
let pinPanel = null;
let adminOverlay = null;
let adminControls = null;
let pinKeypad = null;
// volumeSlider is now declared in audio.js

// Initialize DOM references (called from jukebox.js after DOM is ready)
function initializeAdminPanelDOM() {
  pinInput = document.getElementById('adminPin');
  pinPanel = document.getElementById('pinPanel');
  adminOverlay = document.getElementById('adminOverlay');
  adminControls = document.getElementById('adminControls');
  pinKeypad = document.getElementById('pinKeypad');
  // volumeSlider is now initialized in audio.js
  
  // Initialize PIN keypad functionality
  initializePinKeypad();
}

// PIN handling functions
async function handlePinSubmit() {
  const pin = pinInput.value;
  const pinErrorMessage = document.getElementById('pinErrorMessage');
  const adminOverlay = document.getElementById('adminOverlay');
  
  debugLog('admin', `[PIN] Attempting login with PIN: ${pin.replace(/./g, '*')}`);
  
  // Try to validate PIN through Settings API first, fallback to localStorage
  let correctPin = '1234';
  try {
    if (window.adminSettingsManager) {
      correctPin = await window.adminSettingsManager.getCurrentAdminPin();
    } else if (window.settingsAPI) {
      correctPin = await window.settingsAPI.getSetting('admin', 'adminPin', '1234');
    } else {
      // Fallback to localStorage
      const adminSettings = getAdminSettings();
      correctPin = adminSettings.adminPin || '1234';
    }
  } catch (error) {
    debugLog('ADMIN', 'Error getting PIN from Settings API, using fallback:', error);
    const adminSettings = getAdminSettings();
    correctPin = adminSettings.adminPin || '1234';
  }
  
  debugLog('admin', `[PIN] Expected PIN: ${correctPin.replace(/./g, '*')}`);
  
  if (pin === correctPin) {
    debugLog('admin', '[PIN] ✅ PIN correct - granting admin access');
    pinPanel.classList.add('hidden');
    adminControls.classList.remove('hidden');
    adminOverlay.classList.remove('pin-mode');
    pinInput.value = '';
    isAdminMode = true;
    document.body.classList.add('admin-mode');
    
    // Save admin status to database
    if (window.sessionAPI) {
      try {
        const success = await window.sessionAPI.setAdminUnlocked(true, 24 * 60 * 60 * 1000); // 24h
        if (!success) {
          // Fallback to localStorage
          localStorage.setItem('jukebox_admin_unlocked', 'true');
        }
      } catch (error) {
        if (typeof debugLog !== 'undefined') {
          debugLog('ADMIN', 'Database admin status save failed:', error);
        }
        localStorage.setItem('jukebox_admin_unlocked', 'true');
      }
    } else {
      // Fallback to localStorage
      localStorage.setItem('jukebox_admin_unlocked', 'true');
    }
    
    // Update auto-learning status when admin panel opens
    if (typeof updateSpotifyAutoLearnVisibility !== 'undefined') {
      updateSpotifyAutoLearnVisibility();
    }
    if (typeof updateAutoLearnStatus !== 'undefined') {
      updateAutoLearnStatus();
    }
    updateControlsState();
    
    // Debug toggle sync is handled by loadAdminSettings - no need for duplicate sync here
    
    // Update queue display to show/hide remove buttons
    if (typeof debouncedUpdateQueueDisplay !== 'undefined') {
      debouncedUpdateQueueDisplay();
    }
    
    // Load admin settings into UI (async)
    if (typeof loadAdminSettings !== 'undefined') {
      loadAdminSettings();
    }
    
    // Update Data Server status
    if (typeof updateMusicServerStatus !== 'undefined') {
      updateMusicServerStatus();
    }
    
    // Initialize GEMA Reporting
    this.initializeGEMAReporting();
    
    if (typeof debugLog !== 'undefined') {
      debugLog('SYSTEM', 'Admin-Modus aktiviert (persistent)');
    }
  } else {
    debugLog('admin', '[PIN] ❌ Incorrect PIN entered');
    // Clear PIN input
    pinInput.value = '';
    
    // Show error animation
    pinPanel.classList.add('error');
    pinErrorMessage.classList.add('show');
    
    // Remove error effects after animation
    setTimeout(() => {
      pinPanel.classList.remove('error');
      pinErrorMessage.classList.remove('show');
    }, 600);
    
    // Close admin overlay after 1.5 seconds to allow user to exit
    setTimeout(() => {
      hideAdminOverlay();
      if (typeof debugLog !== 'undefined') {
        debugLog('UI', 'Admin-Overlay geschlossen nach falscher PIN');
      }
    }, 1500);
  }
}

// Admin status restoration from database/localStorage
async function restoreAdminStatus() {
  let adminUnlocked = false;
  
  // Try to load from database first
  if (window.sessionAPI) {
    try {
      adminUnlocked = await window.sessionAPI.isAdminUnlocked();
      if (typeof debugLog !== 'undefined') {
        debugLog('ADMIN', 'Admin status loaded from database:', adminUnlocked);
      }
    } catch (error) {
      if (typeof debugLog !== 'undefined') {
        debugLog('ADMIN', 'Database admin status load failed:', error);
      }
    }
  }
  
  // Fallback to localStorage if database doesn't have status
  if (!adminUnlocked) {
    const localStatus = localStorage.getItem('jukebox_admin_unlocked');
    adminUnlocked = localStatus === 'true';
    if (adminUnlocked) {
      if (typeof debugLog !== 'undefined') {
        debugLog('ADMIN', 'Admin status loaded from localStorage fallback');
      }
    }
  }
  
  if (adminUnlocked) {
    isAdminMode = true;
    document.body.classList.add('admin-mode');
    if (typeof debugLog !== 'undefined') {
      debugLog('ADMIN', 'Admin mode restored automatically');
    }
    
    // Update controls state to reflect restored admin mode
    updateControlsState();
  } else {
    if (typeof debugLog !== 'undefined') {
      debugLog('ADMIN', 'No saved admin session found');
    }
    
    // Ensure controls reflect locked state
    updateControlsState();
  }
}

// PIN keypad handling
async function handlePinKeypad(key) {
  const currentPin = pinInput.value;
  
  if (key === 'clear') {
    pinInput.value = '';
    pinInput.placeholder = '';
  } else if (key === 'ok') {
    await handlePinSubmit();
  } else if (key >= '0' && key <= '9') {
    if (currentPin.length < 6) { // Max 6 Ziffern
      pinInput.value = currentPin + key;
    }
  }
}

// Initialize PIN keypad event listeners
function initializePinKeypad() {
  if (pinKeypad) {
    pinKeypad.addEventListener('click', async (event) => {
      const target = event.target;
      if (target.classList.contains('pin-key')) {
        const key = target.getAttribute('data-key');
        await handlePinKeypad(key);
        
        // Visual feedback
        target.style.transform = 'scale(0.9)';
        setTimeout(() => {
          target.style.transform = '';
        }, 100);
      }
    });
  }
}

// Update controls state based on admin mode
function updateControlsState() {
  debugLog('admin', '[DEBUG] updateControlsState aufgerufen, isAdminMode:', isAdminMode);
  
  // Update admin button icon - get fresh reference each time
  const currentAdminButton = document.getElementById('adminButton');
  if (currentAdminButton) {
    if (isAdminMode) {
      currentAdminButton.innerHTML = '🔓';
      currentAdminButton.title = 'Administrator (entsperrt)';
      debugLog('admin', '[DEBUG] Admin-Button auf entsperrt gesetzt');
    } else {
      currentAdminButton.innerHTML = '🔒';
      currentAdminButton.title = 'Administrator';
      debugLog('admin', '[DEBUG] Admin-Button auf gesperrt gesetzt');
    }
  } else {
    debugLog('ADMIN', 'Admin-Button nicht gefunden in updateControlsState');
  }
  
  if (volumeSlider) {
    if (isAdminMode) {
      volumeSlider.style.opacity = '1';
      volumeSlider.style.cursor = 'pointer';
      volumeSlider.disabled = false;
    } else {
      volumeSlider.style.opacity = '0.5';
      volumeSlider.style.cursor = 'not-allowed';
      volumeSlider.disabled = true;
    }
  }
  
  const playButton = document.getElementById('playButton');
  if (playButton) {
    if (isAdminMode) {
      playButton.style.opacity = '1';
      playButton.style.cursor = 'pointer';
      playButton.disabled = false;
    } else {
      playButton.style.opacity = '0.5';
      playButton.style.cursor = 'not-allowed';
      playButton.disabled = true;
    }
  }
}

// Hide admin overlay
function hideAdminOverlay() {
  const adminOverlay = document.getElementById('adminOverlay');
  const pinPanel = document.getElementById('pinPanel');
  const adminControls = document.getElementById('adminControls');
  const pinInput = document.getElementById('adminPin');
  const pinErrorMessage = document.getElementById('pinErrorMessage');
  
  // Hide overlay
  adminOverlay.classList.add('hidden');
  adminOverlay.classList.remove('pin-mode');
  
  // Reset PIN panel state
  pinPanel.classList.remove('hidden', 'error');
  adminControls.classList.add('hidden');
  pinInput.value = '';
  pinInput.placeholder = '';
  if (pinErrorMessage) {
    pinErrorMessage.classList.remove('show');
  }
  
  debugLog('admin', '[DEBUG] Admin-Overlay geschlossen');
}

// Helper function for admin settings (Settings API based)
async function getAdminSettings() {
  try {
    if (window.settingsAPI) {
      const adminPin = await window.settingsAPI.getSetting('admin', 'adminPin', '1234');
      const trackLockTimeMinutes = await window.settingsAPI.getSetting('admin', 'trackLockTimeMinutes', 60);
      const debuggingEnabled = await window.settingsAPI.getSetting('admin', 'debuggingEnabled', false);
      const language = await window.settingsAPI.getSetting('admin', 'language', 'de');
      
      return {
        adminPin,
        trackLockTimeMinutes,
        debuggingEnabled,
        language
      };
    } else {
      debugLog('ADMIN', 'Settings API not available - using defaults');
      return {
        adminPin: '1234',
        trackLockTimeMinutes: 60,
        debuggingEnabled: false,
        language: 'de'
      };
    }
  } catch (error) {
    debugLog('ADMIN', 'Error loading admin settings from Settings API:', error);
    return {
      adminPin: '1234',
      trackLockTimeMinutes: 60,
      debuggingEnabled: false,
      language: 'de'
    };
  }
}

// Create instance of AdminSettingsManager to handle settings loading
// Note: Instance is created in DOMContentLoaded handler above as window.adminSettingsManager

// Export functions for use in jukebox.js
window.adminPanel = {
  isAdminMode: () => isAdminMode,
  setAdminMode: (mode) => { isAdminMode = mode; },
  initializeDOM: initializeAdminPanelDOM,
  handlePinSubmit,
  restoreAdminStatus,
  handlePinKeypad,
  initializePinKeypad,
  updateControlsState,
  hideAdminOverlay,
  getAdminSettings,
  // Expose settings manager for access - use global instance
  get settingsManager() { return window.adminSettingsManager; },
  saveAdminSettings: AdminSettingsManager.prototype.saveAdminSettings,
  // Admin settings functions - will be bound to actual instance later
  loadAdminSettings: () => {
    if (window.adminSettingsManager) {
      return window.adminSettingsManager.loadAdminSettings();
    } else {
      console.warn('AdminSettingsManager not initialized yet');
      return Promise.resolve();
    }
  },
  updateAdminPanelContent: AdminSettingsManager.prototype.updateAdminPanelContent,
  updateLanguageDropdown: AdminSettingsManager.prototype.updateLanguageDropdown,
  updateMusicServerStatus: AdminSettingsManager.prototype.updateMusicServerStatus,
  updateCoverCacheStats: AdminSettingsManager.prototype.updateCoverCacheStats,
  loadSavedEventsList: AdminSettingsManager.prototype.loadSavedEventsList,
  initializeAdminMainTabs: AdminSettingsManager.prototype.initializeAdminMainTabs,
  initializeAdminAutoLearnTabs: AdminSettingsManager.prototype.initializeAdminAutoLearnTabs,
  initializeAdminAutoLearnButtons: AdminSettingsManager.prototype.initializeAdminAutoLearnButtons,
  updateAdminAutoLearnStatus: AdminSettingsManager.prototype.updateAdminAutoLearnStatus,
  initializeSettingsButtonHandlers: AdminSettingsManager.prototype.initializeSettingsButtonHandlers,
  initializeAdditionalAdminHandlers: AdminSettingsManager.prototype.initializeAdditionalAdminHandlers,
  initializeDataServerButtonHandlers: AdminSettingsManager.prototype.initializeDataServerButtonHandlers
};

// =============================================================================
// GEMA REPORTING SYSTEM
// =============================================================================

class GEMAReportingManager {
  constructor() {
    this.currentReportData = null;
  }

  // Event Management via Settings API
  async getSavedEvents() {
    try {
      if (window.settingsAPI) {
        return await window.settingsAPI.getSetting('events', 'savedEvents', []);
      }
      return [];
    } catch (error) {
      debugLog('admin', '[EVENTS] Error loading events from Settings API:', error);
      return [];
    }
  }

  async saveEventsToAPI(events) {
    try {
      if (window.settingsAPI) {
        const success = await window.settingsAPI.setSetting('events', 'savedEvents', events, 'json');
        if (success) {
          debugLog('admin', '[EVENTS] Events saved to Settings API');
        }
        return success;
      }
      return false;
    } catch (error) {
      debugLog('admin', '[EVENTS] Error saving events to Settings API:', error);
      return false;
    }
  }

  // Initialize GEMA reporting system
  initializeGEMAReporting() {
    debugLog('admin', '[REPORTING] Initializing GEMA Reporting System...');
    
    // Set default dates (today)
    const today = new Date().toISOString().split('T')[0];
    const startDateInput = document.getElementById('reportStartDate');
    const endDateInput = document.getElementById('reportEndDate');
    
    if (startDateInput) startDateInput.value = today;
    if (endDateInput) endDateInput.value = today;
    
    // Initialize button handlers
    this.initializeReportingButtons();
    
    // Load saved events on startup
    this.loadSavedEventsList();
    
    debugLog('admin', '[REPORTING] GEMA Reporting System initialized successfully');
  }

  // Alias for backward compatibility
  initializeReportingSystem() {
    return this.initializeGEMAReporting();
  }

  initializeReportingButtons() {
    // Generate Report Button
    const generateReportBtn = document.getElementById('generateReport');
    if (generateReportBtn) {
      generateReportBtn.addEventListener('click', () => this.generateGEMAReport());
    }
    
    // Save Current Event Button
    const saveEventBtn = document.getElementById('saveCurrentEvent');
    if (saveEventBtn) {
      saveEventBtn.addEventListener('click', () => this.saveCurrentEvent());
    }
    
    // Load Event List Button
    const loadEventListBtn = document.getElementById('loadEventList');
    if (loadEventListBtn) {
      loadEventListBtn.addEventListener('click', () => this.loadSavedEventsList());
    }
    
    // Download PDF Button
    const downloadPDFBtn = document.getElementById('downloadPDF');
    if (downloadPDFBtn) {
      downloadPDFBtn.addEventListener('click', () => this.downloadReportAsPDF());
    }
  }

  async generateGEMAReport() {
    debugLog('admin', '[REPORTING] Generating GEMA report...');
    
    const startDate = document.getElementById('reportStartDate')?.value;
    const endDate = document.getElementById('reportEndDate')?.value;
    const eventName = document.getElementById('eventName')?.value || 'Unbenannte Veranstaltung';
    const organizer = document.getElementById('eventOrganizer')?.value || 'Nicht angegeben';
    const location = document.getElementById('eventLocation')?.value || 'Nicht angegeben';
    const attendees = document.getElementById('eventAttendees')?.value || '0';
    
    if (!startDate || !endDate) {
      if (typeof window.toast !== 'undefined') {
        window.toast.error('Bitte wählen Sie einen gültigen Zeitraum aus.');
      }
      return;
    }
    
    if (new Date(startDate) > new Date(endDate)) {
      if (typeof window.toast !== 'undefined') {
        window.toast.error('Das Startdatum muss vor dem Enddatum liegen.');
      }
      return;
    }
    
    try {
      // Get play statistics from API
      const playData = await this.getPlayStatisticsForPeriod(startDate, endDate);
      
      if (!playData || playData.length === 0) {
        if (typeof window.toast !== 'undefined') {
          window.toast.warning('Keine Abspieldaten für den gewählten Zeitraum gefunden.');
        }
        return;
      }
      
      // Store report data for PDF generation
      this.currentReportData = {
        eventName,
        organizer,
        location,
        attendees,
        startDate,
        endDate,
        playData
      };
      
      // Store globally for compatibility
      window.currentReportData = this.currentReportData;
      
      // Directly trigger PDF download
      this.downloadReportAsPDF();
      
      if (typeof window.toast !== 'undefined') {
        window.toast.success(`Report für ${playData.length} Titel als PDF generiert!`);
      }
      debugLog('admin', '[REPORTING] Report generated and downloaded successfully');
      
    } catch (error) {
      debugLog('REPORTING', 'Error generating report:', error);
      if (typeof window.toast !== 'undefined') {
        window.toast.error('Fehler beim Generieren des Reports: ' + error.message);
      }
    }
  }

  async getPlayStatisticsForPeriod(startDate, endDate) {
    try {
      debugLog('admin', '[REPORTING] Fetching play statistics for period:', startDate, 'to', endDate);
      
      // Convert dates to timestamps
      const startTimestamp = new Date(startDate + 'T00:00:00').getTime();
      const endTimestamp = new Date(endDate + 'T23:59:59').getTime();
      
      // Get play statistics from data server
      const apiURL = window.getAPIURL ? window.getAPIURL(`/api/plays?start=${startTimestamp}&end=${endTimestamp}`) : 
                    `http://127.0.0.1:3001/api/plays?start=${startTimestamp}&end=${endTimestamp}`;
      const response = await fetch(apiURL);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      return data.plays || [];
      
    } catch (error) {
      debugLog('REPORTING', 'Error fetching play statistics:', error);
      
      // Fallback: use client-side played tracks if API fails
      debugLog('admin', '[REPORTING] Falling back to client-side play history...');
      
      const startTimestamp = new Date(startDate + 'T00:00:00').getTime();
      const endTimestamp = new Date(endDate + 'T23:59:59').getTime();
      
      const playedTracks = window.playedTracks || [];
      return playedTracks.filter(track => 
        track.timestamp >= startTimestamp && 
        track.timestamp <= endTimestamp
      ).map(track => ({
        timestamp: track.timestamp,
        artist: track.artist || 'Unbekannter Interpret',
        title: track.title || 'Unbekannter Titel',
        album: track.album || '',
        source: track.uri ? 'spotify' : 'local'
      }));
    }
  }

  generateReportHTML(data) {
    const { eventName, organizer, location, attendees, startDate, endDate, playData } = data;
    
    // Sort play data by timestamp
    const sortedPlays = playData.sort((a, b) => a.timestamp - b.timestamp);
    
    // Group by date
    const playsByDate = {};
    sortedPlays.forEach(play => {
      const date = new Date(play.timestamp).toLocaleDateString('de-DE');
      if (!playsByDate[date]) {
        playsByDate[date] = [];
      }
      playsByDate[date].push(play);
    });
    
    let reportHTML = `
      <div style="color: #000; line-height: 1.4; font-size: 0.9em;">
        <div style="text-align: center; border-bottom: 2px solid #1DB954; padding-bottom: 8px; margin-bottom: 12px;">
          <h2 style="margin: 0; color: #1DB954; font-size: 1.4em;">📋 Jukebox Report</h2>
          <h3 style="margin: 3px 0 0 0; color: #333; font-size: 1.1em;">${eventName}</h3>
        </div>
        
        <div style="margin-bottom: 12px; padding: 10px; border-radius: 6px;">
          <h4 style="margin: 0 0 8px 0; color: #1DB954; font-size: 1em;">ℹ️ Veranstaltungsdaten</h4>
          <table style="width: 100%; border-collapse: collapse; font-size: 0.9em;">
            <tr><td style="padding: 2px 0; color: #666; width: 30%;">Veranstalter:</td><td style="color: #000; font-weight: 500;">${organizer}</td></tr>
            <tr><td style="padding: 2px 0; color: #666;">Ort:</td><td style="color: #000; font-weight: 500;">${location}</td></tr>
            <tr><td style="padding: 2px 0; color: #666;">Teilnehmer:</td><td style="color: #000; font-weight: 500;">${attendees}</td></tr>
            <tr><td style="padding: 2px 0; color: #666;">Zeitraum:</td><td style="color: #000; font-weight: 500;">${this.formatDate(startDate)} - ${this.formatDate(endDate)}</td></tr>
            <tr><td style="padding: 2px 0; color: #666;">Titel gespielt:</td><td style="color: #000; font-weight: 600;">${sortedPlays.length}</td></tr>
          </table>
        </div>
    `;
    
    // Generate daily reports
    Object.keys(playsByDate).sort().forEach(date => {
      const dailyPlays = playsByDate[date];
      reportHTML += `
        <div style="margin-bottom: 15px; padding: 10px;">
          <h4 style="margin: 0 0 8px 0; color: #1DB954; font-size: 0.95em;">📅 ${date} (${dailyPlays.length} Titel)</h4>
          <table style="width: 100%; border-collapse: collapse; font-size: 0.8em;">
            <thead>
              <tr style="border-bottom: 1px solid #ddd;">
                <th style="text-align: left; padding: 4px 3px; color: #000; font-weight: 600; font-size: 0.85em;">Zeit</th>
                <th style="text-align: left; padding: 4px 3px; color: #000; font-weight: 600; font-size: 0.85em;">Interpret</th>
                <th style="text-align: left; padding: 4px 3px; color: #000; font-weight: 600; font-size: 0.85em;">Titel</th>
                <th style="text-align: left; padding: 4px 3px; color: #000; font-weight: 600; font-size: 0.85em;">Album</th>
              </tr>
            </thead>
            <tbody>
      `;
      
      dailyPlays.forEach((play, index) => {
        const time = new Date(play.timestamp).toLocaleTimeString('de-DE', { 
          hour: '2-digit', 
          minute: '2-digit' 
        });
        const rowStyle = index % 2 === 0 ? 'background: #f9f9f9;' : '';
        
        reportHTML += `
          <tr style="${rowStyle}">
            <td style="padding: 3px 3px; color: #000; font-family: monospace; font-size: 0.85em;">${time}</td>
            <td style="padding: 3px 3px; color: #000; font-weight: 500;">${this.escapeHtml(play.artist)}</td>
            <td style="padding: 3px 3px; color: #000; font-weight: 500;">${this.escapeHtml(play.title)}</td>
            <td style="padding: 3px 3px; color: #000;">${this.escapeHtml(play.album || '-')}</td>
          </tr>
        `;
      });
      
      reportHTML += `
            </tbody>
          </table>
        </div>
      `;
    });
    
    reportHTML += `
        <div style="margin-top: 12px; padding: 8px; text-align: center;">
          <p style="margin: 0; color: #1DB954; font-weight: 600; font-size: 0.85em;">
            Report generiert am ${new Date().toLocaleString('de-DE')}
          </p>
          <p style="margin: 2px 0 0 0; color: #666; font-size: 0.75em;">
            Jukebox Report
          </p>
        </div>
      </div>
    `;
    
    return reportHTML;
  }

  formatDate(dateString) {
    return new Date(dateString).toLocaleDateString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  }

  escapeHtml(text) {
    if (typeof text !== 'string') return '';
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
  }

  async saveCurrentEvent() {
    const eventData = {
      id: Date.now().toString(),
      name: document.getElementById('eventName')?.value || 'Unbenannte Veranstaltung',
      organizer: document.getElementById('eventOrganizer')?.value || '',
      location: document.getElementById('eventLocation')?.value || '',
      attendees: document.getElementById('eventAttendees')?.value || '0',
      created: new Date().toISOString()
    };
    
    if (!eventData.name.trim()) {
      if (typeof window.toast !== 'undefined') {
        window.toast.warning('Bitte geben Sie einen Veranstaltungsnamen ein.');
      }
      return;
    }
    
    // Get existing events from Settings API
    const savedEvents = await this.getSavedEvents();
    
    // Add new event
    savedEvents.push(eventData);
    
    // Save to Settings API
    const success = await this.saveEventsToAPI(savedEvents);
    
    if (success) {
      // Refresh the list
      await this.loadSavedEventsList();
      
      if (typeof window.toast !== 'undefined') {
        window.toast.success(`Veranstaltung "${eventData.name}" gespeichert!`);
      }
      debugLog('admin', '[REPORTING] Event saved to Settings API:', eventData);
    } else {
      if (typeof window.toast !== 'undefined') {
        window.toast.error('Fehler beim Speichern der Veranstaltung');
      }
    }
  }

  async loadSavedEventsList() {
    const savedEvents = await this.getSavedEvents();
    const listContainer = document.getElementById('savedEventsList');
    
    if (!listContainer) return;
    
    if (savedEvents.length === 0) {
      const noEventsText = (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? 
        window.i18nSystem.t('ui.messages.noSavedEvents') : 
        'Keine gespeicherten Veranstaltungen';
      listContainer.innerHTML = `<div style="color: #999; text-align: center; padding: 20px;">${noEventsText}</div>`;
      return;
    }
    
    let listHTML = '';
    savedEvents.reverse().forEach(event => { // Show newest first
      listHTML += `
        <div style="background: #2a2a2a; border: 1px solid #444; border-radius: 6px; padding: 12px; margin-bottom: 10px; cursor: pointer;" 
             onclick="window.adminPanel.gemaReporting.loadEventData('${event.id}')">
          <div style="font-weight: 600; color: #1DB954; margin-bottom: 5px;">${this.escapeHtml(event.name)}</div>
          <div style="font-size: 0.8em; color: #999;">
            📍 ${this.escapeHtml(event.location || 'Kein Ort')} • 
            👥 ${event.attendees} Teilnehmer • 
            📅 ${new Date(event.created).toLocaleDateString('de-DE')}
          </div>
          <div style="margin-top: 8px;">
            <button onclick="event.stopPropagation(); window.adminPanel.gemaReporting.loadEventData('${event.id}')" 
                    style="background: #1DB954; color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; margin-right: 5px; font-size: 0.8em;">📋 Laden</button>
            <button onclick="event.stopPropagation(); window.adminPanel.gemaReporting.deleteEvent('${event.id}')" 
                    style="background: #e74c3c; color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 0.8em;">🗑️ Löschen</button>
          </div>
        </div>
      `;
    });
    
    listContainer.innerHTML = listHTML;
  }

  async loadEventData(eventId) {
    const savedEvents = await this.getSavedEvents();
    const event = savedEvents.find(e => e.id === eventId);
    
    if (!event) {
      if (typeof window.toast !== 'undefined') {
        window.toast.error('Veranstaltung nicht gefunden.');
      }
      return;
    }
    
    // Load event data into form
    const eventName = document.getElementById('eventName');
    const eventOrganizer = document.getElementById('eventOrganizer');
    const eventLocation = document.getElementById('eventLocation');
    const eventAttendees = document.getElementById('eventAttendees');
    
    if (eventName) eventName.value = event.name;
    if (eventOrganizer) eventOrganizer.value = event.organizer || '';
    if (eventLocation) eventLocation.value = event.location || '';
    if (eventAttendees) eventAttendees.value = event.attendees || '0';
    
    if (typeof window.toast !== 'undefined') {
      window.toast.success(`Veranstaltung "${event.name}" geladen!`);
    }
  }

  async deleteEvent(eventId) {
    if (!confirm('Veranstaltung wirklich löschen?')) {
      return;
    }
    
    const savedEvents = await this.getSavedEvents();
    const filteredEvents = savedEvents.filter(e => e.id !== eventId);
    
    const success = await this.saveEventsToAPI(filteredEvents);
    
    if (success) {
      await this.loadSavedEventsList();
      
      if (typeof window.toast !== 'undefined') {
        window.toast.success('Veranstaltung gelöscht');
      }
      debugLog('admin', '[REPORTING] Event deleted from Settings API:', eventId);
    } else {
      if (typeof window.toast !== 'undefined') {
        window.toast.error('Fehler beim Löschen der Veranstaltung');
      }
    }
  }

  downloadReportAsPDF() {
    if (!this.currentReportData) {
      if (typeof window.toast !== 'undefined') {
        window.toast.error('Bitte generieren Sie zuerst einen Report.');
      }
      return;
    }
    
    // Generate fresh report HTML for PDF
    const reportContent = this.generateReportHTML(this.currentReportData);
    
    // Open in new window for printing
    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>GEMA Report - ${this.currentReportData.eventName}</title>
        <style>
          body { 
            font-family: Arial, sans-serif; 
            margin: 20px; 
            background: white; 
            color: black; 
          }
          .report-content { 
            background: white; 
            color: black; 
          }
          .report-content h2, .report-content h3, .report-content h4 { 
            color: #1DB954; 
          }
          table { 
            border-collapse: collapse; 
            width: 100%; 
          }
          th, td { 
            border: 1px solid #ddd; 
            padding: 8px; 
            text-align: left; 
          }
          th { 
            background-color: #f2f2f2; 
          }
        </style>
      </head>
      <body>
        <div class="report-content">
          ${reportContent}
        </div>
        <script>
          window.onload = function() {
            window.print();
          };
        </script>
      </body>
      </html>
    `);
    printWindow.document.close();
    
    if (typeof window.toast !== 'undefined') {
      window.toast.info('📄 Report in neuem Fenster geöffnet - verwenden Sie "Drucken" > "Als PDF speichern"');
    }
  }

  // Event management functions
  generateReportHTML(data) {
    const { eventName, organizer, location, attendees, startDate, endDate, playData } = data;
    
    // Sort play data by timestamp
    const sortedPlays = playData.sort((a, b) => a.timestamp - b.timestamp);
    
    // Group by date
    const playsByDate = {};
    sortedPlays.forEach(play => {
      const date = new Date(play.timestamp).toLocaleDateString();
      if (!playsByDate[date]) {
        playsByDate[date] = [];
      }
      playsByDate[date].push(play);
    });
    
    // Pre-translate all needed strings since i18n won't be available in the new window
    const translations = {
      reportTitle: (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? 
        window.i18nSystem.t('ui.admin.report.reportTitle', 'Jukebox Report') : 'Jukebox Report',
      eventData: (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? 
        window.i18nSystem.t('ui.admin.report.eventData', 'Event Information') : 'Veranstaltungsdaten',
      organizer: (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? 
        window.i18nSystem.t('ui.admin.report.organizer', 'Organizer') : 'Veranstalter',
      location: (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? 
        window.i18nSystem.t('ui.admin.report.location', 'Location') : 'Ort',
      attendees: (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? 
        window.i18nSystem.t('ui.admin.report.attendees', 'Attendees') : 'Teilnehmer',
      period: (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? 
        window.i18nSystem.t('ui.admin.report.period', 'Period') : 'Zeitraum',
      tracksPlayed: (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? 
        window.i18nSystem.t('ui.admin.report.tracksPlayed', 'Tracks played') : 'Titel gespielt',
      tracks: (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? 
        window.i18nSystem.t('ui.admin.report.tracks', 'tracks') : 'Titel',
      time: (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? 
        window.i18nSystem.t('ui.admin.report.time', 'Time') : 'Zeit',
      artist: (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? 
        window.i18nSystem.t('ui.admin.report.artist', 'Artist') : 'Interpret',
      trackTitle: (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? 
        window.i18nSystem.t('ui.admin.report.trackTitle', 'Title') : 'Titel',
      album: (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? 
        window.i18nSystem.t('ui.admin.report.album', 'Album') : 'Album',
      generatedAt: (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? 
        window.i18nSystem.t('ui.admin.report.generatedAt', 'Report generated at') : 'Report generiert am',
      signature: (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? 
        window.i18nSystem.t('ui.admin.report.signature', 'Jukebox Report') : 'Jukebox Report'
    };
    
    let reportHTML = `
      <div class="report-container">
        <div class="report-header">
          <h2 class="report-title">📋 ${translations.reportTitle}</h2>
          <h3 class="report-event-name">${eventName}</h3>
        </div>
        
        <div class="report-event-info">
          <h4 class="report-section-title">ℹ️ ${translations.eventData}</h4>
          <table class="report-info-table">
            <tr><td class="info-label">${translations.organizer}:</td><td class="info-value">${organizer}</td></tr>
            <tr><td class="info-label">${translations.location}:</td><td class="info-value">${location}</td></tr>
            <tr><td class="info-label">${translations.attendees}:</td><td class="info-value">${attendees}</td></tr>
            <tr><td class="info-label">${translations.period}:</td><td class="info-value">${this.formatDate(startDate)} - ${this.formatDate(endDate)}</td></tr>
            <tr><td class="info-label">${translations.tracksPlayed}:</td><td class="info-value-bold">${sortedPlays.length}</td></tr>
          </table>
        </div>
    `;
    
    // Generate daily reports
    Object.keys(playsByDate).sort().forEach(date => {
      const dailyPlays = playsByDate[date];
      reportHTML += `
        <div class="report-daily-section">
          <h4 class="report-daily-title">📅 ${date} (${dailyPlays.length} ${translations.tracks})</h4>
          <table class="report-tracks-table">
            <thead>
              <tr class="table-header">
                <th class="table-header-cell">${translations.time}</th>
                <th class="table-header-cell">${translations.artist}</th>
                <th class="table-header-cell">${translations.trackTitle}</th>
                <th class="table-header-cell">${translations.album}</th>
              </tr>
            </thead>
            <tbody>
      `;
      
      dailyPlays.forEach((play, index) => {
        const time = new Date(play.timestamp).toLocaleTimeString([], { 
          hour: '2-digit', 
          minute: '2-digit' 
        });
        const rowClass = index % 2 === 0 ? 'table-row-even' : 'table-row-odd';
        
        reportHTML += `
          <tr class="${rowClass}">
            <td class="table-cell table-cell-time">${time}</td>
            <td class="table-cell table-cell-artist">${this.escapeHtml(play.artist)}</td>
            <td class="table-cell table-cell-title">${this.escapeHtml(play.title)}</td>
            <td class="table-cell table-cell-album">${this.escapeHtml(play.album || '-')}</td>
          </tr>
        `;
      });
      
      reportHTML += `
            </tbody>
          </table>
        </div>
      `;
    });
    
    reportHTML += `
        <div class="report-footer">
          <p class="report-generated-time">
            ${translations.generatedAt} ${new Date().toLocaleString()}
          </p>
          <p class="report-signature">
            ${translations.signature}
          </p>
        </div>
      </div>
    `;
    
    return reportHTML;
  }

  formatDate(dateString) {
    return new Date(dateString).toLocaleDateString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  }

  saveCurrentEvent() {
    const eventData = {
      id: Date.now().toString(),
      name: document.getElementById('eventName').value || 'Unbenannte Veranstaltung',
      organizer: document.getElementById('eventOrganizer').value || '',
      location: document.getElementById('eventLocation').value || '',
      attendees: document.getElementById('eventAttendees').value || '0',
      created: new Date().toISOString()
    };
    
    if (!eventData.name.trim()) {
      if (typeof window.toast !== 'undefined') {
        window.toast.warning('Bitte geben Sie einen Veranstaltungsnamen ein.');
      }
      return;
    }
    
    // Get existing events
    const savedEvents = JSON.parse(localStorage.getItem('savedEvents') || '[]');
    
    // Add new event
    savedEvents.push(eventData);
    
    // Save to localStorage
    localStorage.setItem('savedEvents', JSON.stringify(savedEvents));
    
    // Refresh the list
    if (window.adminPanel && window.adminPanel.loadSavedEventsList) {
      window.adminPanel.loadSavedEventsList();
    }
    
    if (typeof window.toast !== 'undefined') {
      window.toast.success(`Veranstaltung "${eventData.name}" gespeichert!`);
    }
    debugLog('main', '[REPORTING] Event saved:', eventData);
  }

  loadEventData(eventId) {
    const savedEvents = JSON.parse(localStorage.getItem('savedEvents') || '[]');
    const event = savedEvents.find(e => e.id === eventId);
    
    if (!event) {
      if (typeof window.toast !== 'undefined') {
        window.toast.error('Veranstaltung nicht gefunden.');
      }
      return;
    }
    
    // Load event data into form
    document.getElementById('eventName').value = event.name;
    document.getElementById('eventOrganizer').value = event.organizer || '';
    document.getElementById('eventLocation').value = event.location || '';
    document.getElementById('eventAttendees').value = event.attendees || '0';
    
    if (typeof window.toast !== 'undefined') {
      window.toast.success(`Veranstaltung "${event.name}" geladen!`);
    }
  }

  deleteEvent(eventId) {
    if (!confirm('Veranstaltung wirklich löschen?')) {
      return;
    }
    
    const savedEvents = JSON.parse(localStorage.getItem('savedEvents') || '[]');
    const filteredEvents = savedEvents.filter(e => e.id !== eventId);
    
    localStorage.setItem('savedEvents', JSON.stringify(filteredEvents));
    if (window.adminPanel && window.adminPanel.loadSavedEventsList) {
      window.adminPanel.loadSavedEventsList();
    }
    
    if (typeof window.toast !== 'undefined') {
      window.toast.success('Veranstaltung gelöscht!');
    }
  }

  downloadReportAsPDF() {
    if (!window.currentReportData) {
      if (typeof window.toast !== 'undefined') {
        window.toast.error('Bitte generieren Sie zuerst einen Report.');
      }
      return;
    }
    
    // Generate fresh report HTML for PDF
    const reportContent = this.generateReportHTML(window.currentReportData);
    
    // Open in new window for printing
    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>GEMA Report - ${window.currentReportData.eventName}</title>
        <style>
          body { 
            font-family: Arial, sans-serif; 
            margin: 20px; 
            background: white; 
            color: black; 
          }
          .report-content { 
            background: white; 
            color: black; 
          }
          .report-content h2, .report-content h3, .report-content h4 { 
            color: #1DB954; 
          }
          table { 
            border-collapse: collapse; 
            width: 100%; 
          }
          th, td { 
            border: 1px solid #ddd; 
            padding: 8px; 
            text-align: left; 
          }
          th { 
            background-color: #f2f2f2; 
          }
        </style>
      </head>
      <body>
        <div class="report-content">
          ${reportContent}
        </div>
        <script>
          window.onload = function() {
            window.print();
          };
        </script>
      </body>
      </html>
    `);
    printWindow.document.close();
    
    if (typeof window.toast !== 'undefined') {
      window.toast.info((typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.messages.reportOpened') : '📄 Report opened in new window - use "Print" > "Save as PDF"');
    }
  }
}

// Initialize GEMA Reporting and add to window.adminPanel
if (typeof window !== 'undefined') {
  const gemaReporting = new GEMAReportingManager();
  
  // Add GEMA reporting to existing adminPanel object
  if (window.adminPanel) {
    window.adminPanel.gemaReporting = gemaReporting;
    window.adminPanel.generateReportHTML = (data) => gemaReporting.generateReportHTML(data);
    window.adminPanel.saveCurrentEvent = () => gemaReporting.saveCurrentEvent();
    window.adminPanel.downloadReportAsPDF = () => gemaReporting.downloadReportAsPDF();
    window.adminPanel.loadSavedEventsList = () => gemaReporting.loadSavedEventsList();
  }
  
  // For backward compatibility, expose some functions globally
  window.loadEventData = (eventId) => gemaReporting.loadEventData(eventId);
  window.deleteEvent = (eventId) => gemaReporting.deleteEvent(eventId);
}
