
// Modular components: debug.js, covers.js, admin_panel.js, audio.js, spotify.js, playlists.js

// Navigation state for hierarchical browsing
let navigationState = {
  level: 'root', // 'root', 'artists', 'albums', 'tracks', 'genre_category', 'artists_in_genre'
  currentArtist: null,
  currentAlbum: null,
  currentGenreCategory: null,
  currentGenreCategoryData: null,
  currentGenre: null,
  breadcrumb: [],
  currentFilter: 'all'
};

// Current browsing context
let browsedArtists = [];
let browsedAlbums = [];
let browsedTracks = [];

// Track history for 1-hour restriction
let playedTracks = [];
let currentAZFilter = 'all'; // Current A-Z filter

// Global Spotify playback status for footer visualizer
window.isSpotifyCurrentlyPlaying = false;

// Visualization settings - declared early to avoid initialization errors
let visualizationSettings = {
  enableSpace: true,
  enableFire: true,
  enableParticles: true,
  enableCircles: true,
  switchInterval: 30
};

// App state persistence (migrated to database)
async function saveAppState() {
  const state = {
    queue: queue, // Save queue for persistent playlist
    currentTrackIndex: currentTrackIndex, // Save index for queue position
    currentFilter: currentFilter,
    currentView: currentView,
    currentAZFilter: currentAZFilter,
    playedTracks: playedTracks,
    volume: audioPlayer ? audioPlayer.volume : 0.7,
    timestamp: Date.now()
  };
  
  try {
    const stateString = JSON.stringify(state);
    
    // Clear old state if too large
    if (stateString.length > 500000) { // 500KB limit
      console.warn('[STATE] State too large, clearing old data');
      const minimalState = {
        currentFilter: state.currentFilter,
        currentTrackIndex: state.currentTrackIndex,
        volume: state.volume,
        timestamp: state.timestamp
      };
      
      // Save to database via SessionAPI
      if (window.sessionAPI) {
        const success = await window.sessionAPI.saveUIState('jukebox_app_state', minimalState, true);
        if (success) {
          debugLog('STATE', 'Minimal state saved to database due to size limit');
          return;
        }
      }
      
      // Fallback to localStorage
      sessionStorage.setItem('jukebox_app_state', JSON.stringify(minimalState));
      localStorage.setItem('jukebox_app_state', JSON.stringify(minimalState));
      debugLog('STATE', 'Minimal state saved to localStorage fallback due to size limit');
      return;
    }
    
    // Save to database via SessionAPI
    if (window.sessionAPI) {
      const success = await window.sessionAPI.saveUIState('jukebox_app_state', state, true);
      if (success) {
        debugLog('STATE', 'App state saved to database:', state);
        return;
      } else {
        debugLog('STATE', 'Database save failed, falling back to localStorage');
      }
    }
    
    // Fallback to localStorage
    sessionStorage.setItem('jukebox_app_state', stateString);
    localStorage.setItem('jukebox_app_state', stateString);
    debugLog('STATE', 'App-State in localStorage fallback gespeichert:', state);
    
  } catch (error) {
    if (error.name === 'QuotaExceededError') {
      console.warn('[STATE] Storage quota exceeded, clearing and saving minimal state');
      try {
        const minimalState = {
          currentFilter: state.currentFilter,
          currentTrackIndex: state.currentTrackIndex,
          volume: state.volume,
          timestamp: state.timestamp
        };
        
        if (window.sessionAPI) {
          await window.sessionAPI.saveUIState('jukebox_app_state', minimalState, true);
        } else {
          localStorage.clear();
          sessionStorage.clear();
          sessionStorage.setItem('jukebox_app_state', JSON.stringify(minimalState));
          localStorage.setItem('jukebox_app_state', JSON.stringify(minimalState));
        }
      } catch (clearError) {
        console.error('[STATE] Failed to save even minimal state:', clearError);
      }
    } else {
      debugLog('STATE', (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('debug.system.appStateLoadError') : 'Error saving app state:', error);
    }
  }
}

async function loadAppState() {
  try {
    let state = null;
    let source = 'none';
    
    // Try to load from database first
    if (window.sessionAPI) {
      try {
        state = await window.sessionAPI.getUIState('jukebox_app_state');
        if (state) {
          source = 'database';
        }
      } catch (error) {
        debugLog('STATE', 'Database load failed:', error);
      }
    }
    
    // Fallback to localStorage if database doesn't have state
    if (!state) {
      let savedState = sessionStorage.getItem('jukebox_app_state') || localStorage.getItem('jukebox_app_state');
      if (savedState) {
        state = JSON.parse(savedState);
        source = sessionStorage.getItem('jukebox_app_state') ? 'sessionStorage' : 'localStorage';
      }
    }
    
    if (!state) {
      debugLog('STATE', 'Kein gespeicherter App-State gefunden');
      return false;
    }
    
    const age = Date.now() - state.timestamp;
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours
    
    debugLog('STATE', (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('debug.system.appStateLoaded') : 'App state loaded from:', source);
    
    if (age > maxAge) {
      debugLog('STATE', 'Gespeicherter App-State zu alt, ignoriere');
      await clearAppState();
      return false;
    }
    
    // Restore queue state for persistent playlist
    if (state.queue && Array.isArray(state.queue)) {
      queue.length = 0;
      queue.push(...state.queue);
      debugLog('QUEUE', 'Queue restored:', queue.length, 'tracks');
      
      // Update queue UI after loading
      debouncedUpdateQueueDisplay();
    }
    
    // Restore current track index if queue exists
    if (typeof state.currentTrackIndex === 'number' && state.queue && state.queue.length > 0) {
      currentTrackIndex = Math.min(state.currentTrackIndex, state.queue.length - 1);
      debugLog('QUEUE', 'currentTrackIndex wiederhergestellt:', currentTrackIndex);
    } else {
      currentTrackIndex = -1;
      debugLog('QUEUE', 'currentTrackIndex reset to -1 (empty playlist)');
    }
    
    if (state.currentFilter) {
      // Always start with 'new' filter regardless of saved state for consistent UX
      currentFilter = 'new';
      debugLog('UI', 'currentFilter overridden to "new" for consistent UX');
    }
    
    if (state.currentView) {
      currentView = state.currentView;
      debugLog('UI', 'currentView wiederhergestellt:', currentView);
    }
    
    if (state.currentAZFilter) {
      currentAZFilter = state.currentAZFilter;
      debugLog('UI', 'currentAZFilter wiederhergestellt:', currentAZFilter);
    } else {
      // Ensure default 'all' filter if no state saved
      currentAZFilter = 'all';
    }
    
    if (state.playedTracks && Array.isArray(state.playedTracks)) {
      playedTracks = state.playedTracks.filter(track => {
        const age = Date.now() - track.timestamp;
        return age < (60 * 60 * 1000); // Only keep tracks from last hour
      });
      debugLog('QUEUE', 'playedTracks wiederhergestellt:', playedTracks.length, 'Tracks');
    }
    
    if (typeof state.volume === 'number' && audioPlayer) {
      audioPlayer.volume = state.volume;
      const volumeSlider = document.getElementById('volumeSlider');
      if (volumeSlider) volumeSlider.value = state.volume;
      debugLog('AUDIO', 'Volume restored:', state.volume);
    }
    
    // Sync state between storages
    sessionStorage.setItem('jukebox_app_state', JSON.stringify(state));
    localStorage.setItem('jukebox_app_state', JSON.stringify(state));
    
    debugLog('STATE', (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('debug.system.appStateSynced') : 'App state successfully loaded and synced');
    return true;
  } catch (error) {
    debugLog('STATE', (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('debug.system.appStateError') : 'Error loading app state:', error);
    clearAppState();
    return false;
  }
}

async function clearAppState() {
  // Clear app state from database
  if (window.sessionAPI) {
    try {
      await window.sessionAPI.deleteUIState('jukebox_app_state');
      debugLog('STATE', 'App state deleted from database');
    } catch (error) {
      debugLog('STATE', 'Error deleting database app state:', error);
    }
  }
  
  // Clear app state from storages (fallback cleanup)
  sessionStorage.removeItem('jukebox_app_state');
  localStorage.removeItem('jukebox_app_state');
  debugLog('STATE', 'App state deleted from localStorage');
}

function restoreUIState() {
  // Always ensure 'new' filter is active for consistent startup
  currentFilter = 'new';
  
  // Restore navigation state
  const navButtons = document.querySelectorAll('#sideNav .nav-tile');
  navButtons.forEach(btn => {
    btn.classList.remove('active');
    if (btn.dataset.filter === currentFilter) {
      btn.classList.add('active');
    }
  });
  
  // Restore A-Z filter
  const azButtons = document.querySelectorAll('#azNavButtons .az-btn');
  azButtons.forEach(btn => {
    btn.classList.remove('active');
    if (btn.dataset.letter === currentAZFilter) {
      btn.classList.add('active');
    }
  });
  
  // Update A-Z navigation visibility based on current filter
  updateAZNavigationVisibility();
  
  debouncedUpdateQueueDisplay();
  // Library will be rendered after data is loaded in loadLocalIndex()
  
  debugLog('UI', 'UI-State wiederhergestellt (Library wird nach Datenladung gerendert)');
}

// Auto-save state on changes
function setupAutoSave() {
  // Save state every 30 seconds
  setInterval(saveAppState, 30000);
  
  // Save state on page unload
  // Save state periodically instead of on beforeunload (permissions policy issue)
  setInterval(saveAppState, 30000); // Save every 30 seconds
  
  // Try to save on beforeunload if allowed by permissions policy
  try {
    window.addEventListener('beforeunload', saveAppState);
  } catch (error) {
    console.warn('[STATE] beforeunload event not allowed by permissions policy');
  }
  
  debugLog('SYSTEM', 'Auto-Save aktiviert');
}

// Queue management functions moved to js/queue_api.js
// Use window.isTrackRecentlyPlayed(), window.isTrackInQueue(), etc.
// These are now exported from the queue_api module

async function initializeApp() {
  debugLog('SYSTEM', (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('debug.system.domContentLoaded') : '=== DOMContentLoaded started ===');
  
  // Load configuration first
  await loadConfig();
  
  // Load admin settings (async)
  if (window.adminPanel && window.adminPanel.loadAdminSettings) {
    await window.adminPanel.loadAdminSettings();
  } else {
    console.warn('⚠️ AdminPanel not available, skipping admin settings load');
  }
  
  // Restore admin status from database/localStorage
  if (window.adminPanel && window.adminPanel.restoreAdminStatus) {
    await window.adminPanel.restoreAdminStatus();
  }
  
  // Debug status loading handled by js/debug.js
  
  // Spotify token aus URL hash verarbeiten
  if (typeof window.handleSpotifyTokenFromHash === 'function') {
    window.handleSpotifyTokenFromHash();
  } else {
    console.warn('[SPOTIFY] handleSpotifyTokenFromHash function not available');
  }
  
  // Try automatic Spotify connection
  debugLog('SPOTIFY', 'Starting automatic Spotify connection...');
  try {
    const autoConnected = await autoConnectSpotify();
    debugLog('SPOTIFY', 'Auto-Connect Ergebnis:', autoConnected);
    
    // If auto-connection was successful, the spotify.js module will handle player initialization
    if (autoConnected) {
      debugLog('SPOTIFY', 'Auto-Connect successful - Player initialization runs via spotify.js');
      
      // Start automatic token refresh interval
      if (typeof startSpotifyTokenRefreshInterval === 'function') {
        startSpotifyTokenRefreshInterval();
      }
    } else {
      debugLog('SPOTIFY', 'Auto-Connect fehlgeschlagen - manueller Login erforderlich');
    }
  } catch (error) {
    debugLog('SPOTIFY', (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('debug.spotify.autoConnectError') : 'Auto-Connect error:', error);
  }
  
  // Spotify token handling is now managed by spotify.js module
  debugLog('SPOTIFY', 'Spotify module loaded and auto-connection attempted');
  updateSpotifyStatusUI();
  
  // App-Zustand laden
  debugLog('STATE', 'Lade App-Zustand...');
  try {
    const stateLoaded = loadAppState();
    debugLog('STATE', (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('debug.system.appStateRestored') : 'App state loaded:', stateLoaded);
    if (stateLoaded) {
      restoreUIState();
    }
  } catch (error) {
    debugLog('STATE', (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('debug.system.appStateRestoreError') : 'Error loading app state:', error);
  }
  
  // Initialize the main application
  debugLog('SYSTEM', (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('debug.system.mainInitializing') : 'Starting main initialization...');
  initialize();
  
  // Initialize dynamic Now Playing header styling
  debugLog('UI', (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('debug.ui.nowPlayingHeaderStyling') : 'Starting Now-Playing Header Styling...');
  initNowPlayingHeaderStyling();
  
  // Initialize now playing auto-collapse system
  debugLog('UI', (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('debug.ui.nowPlayingAutoCollapse') : 'Starting Now-Playing Auto-Collapse...');
  initNowPlayingAutoCollapse();
  
  // Initialize playlist functionality
  debugLog('UI', (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('debug.ui.playlistToggle') : 'Starting Playlist Toggle...');
  initPlaylistToggle();
  
  // Set initial layout mode - start in search mode if no music is playing
  const content = document.getElementById('content');
  const nowPlayingSection = document.getElementById('nowPlayingSection');
  if (content && nowPlayingSection) {
    // Check if queue has tracks
    if (queue.length === 0 || currentTrackIndex === -1) {
      // No music - start in search mode with hidden now playing
      content.classList.add('search-mode');
      content.classList.remove('now-playing-mode');
      nowPlayingSection.style.display = 'none';
      debugLog('UI', 'Initial layout: search mode (no music)');
    } else {
      // Music available - show now playing
      content.classList.add('now-playing-mode');
      nowPlayingSection.classList.add('expanded');
      nowPlayingSection.style.display = 'block';
      debugLog('UI', 'Initial layout: now-playing mode (music available)');
    }
  }
  
  // Initialize Search Module (NEW MODULE APPROACH)
  if (typeof window.SearchModule !== 'undefined') {
    window.SearchModule.init({
      currentFilter: currentFilter,
      spotifyAccessToken: window.spotifyAccessToken,
      dataServerAPI: window.musicAPI,
      searchSpotifyDirect: searchSpotifyDirect,
      renderLibrary: renderLibrary,
      saveAppState: saveAppState,
      addSpotifyTrackToQueue: addSpotifyTrackToQueue,
      playTrack: function(index) {
        // Find track in library and play
        if (index >= 0 && index < library.length) {
          playTrack(index);
        }
      }
    });
    debugLog('SEARCH', '✅ Search module initialized with dependencies');
  } else {
    // Fallback: Use old inline initializeGlobalSearch
    initializeGlobalSearch();
  }
  
  // Initialize Touch Keyboard
  initializeTouchKeyboard();
  
  // Initialize Spotify Auto-Learning
  initializeSpotifyAutoLearning();
  
  // Initialize Auto-DJ and Playlists System
  initializeAutoDjAndPlaylists();
  
  // Robust admin button event listener with event delegation
  debugLog('admin', '[DEBUG] Setting up ROBUST admin button event delegation');
  
  // Remove any existing event listeners by cloning the button
  const adminBtn = document.getElementById('adminButton');
  if (adminBtn) {
    debugLog('admin', '[DEBUG] Admin-Button gefunden - setup robust event handling');
    
    // Use event delegation on document level for maximum reliability
    document.addEventListener('click', function(event) {
      // Check if the clicked element is the admin button or contains it
      if (event.target && (event.target.id === 'adminButton' || event.target.closest('#adminButton'))) {
        event.preventDefault();
        event.stopPropagation();
        const currentAdminMode = window.adminPanel && window.adminPanel.isAdminMode ? window.adminPanel.isAdminMode() : false;
        debugLog('admin', '[DEBUG] Admin-Button geklickt via document delegation, isAdminMode:', currentAdminMode);
        
        // Get fresh references to elements
        const overlay = document.getElementById('adminOverlay');
        debugLog('admin', '[DEBUG] Admin-Panel sichtbar:', overlay && !overlay.classList.contains('hidden'));
        const pinPnl = document.getElementById('pinPanel');
        const adminCtrls = document.getElementById('adminControls');
        const volSlider = document.getElementById('volumeSlider');
        const audioEl = document.getElementById('audioPlayer');
        
        if (!overlay || !pinPnl || !adminCtrls) {
          console.error('[DEBUG] Critical admin elements not found!');
          return;
        }
        
        // Check if admin panel is already visible
        const isOverlayVisible = !overlay.classList.contains('hidden');
        
        if (currentAdminMode) {
          // If already in admin mode
          if (isOverlayVisible) {
            // If admin panel is already visible, close it (but stay unlocked)
            debugLog('admin', '[DEBUG] Admin panel already visible - closing it (stay unlocked)');
            if (window.adminPanel && window.adminPanel.hideAdminOverlay) {
              window.adminPanel.hideAdminOverlay();
            }
          } else {
            // If admin panel is closed, open it directly (unlocked)
            debugLog('admin', '[DEBUG] Opening admin panel (already unlocked)');
            overlay.classList.remove('hidden'); 
            overlay.classList.remove('pin-mode'); // No PIN required
            pinPnl.classList.add('hidden'); 
            adminCtrls.classList.remove('hidden');
            if (volSlider && audioEl) {
              volSlider.value = audioEl.volume.toString();
            }
            
            // Update admin panel status
            if (typeof updateSpotifyAutoLearnVisibility === 'function') {
              updateSpotifyAutoLearnVisibility();
            }
            if (typeof updateAutoLearnStatus === 'function') {
              updateAutoLearnStatus();
            }
          }
        } else {
          // If not in admin mode, show PIN input
          debugLog('admin', '[DEBUG] Show PIN input (locked)');
          overlay.classList.remove('hidden'); 
          overlay.classList.add('pin-mode'); // Make overlay compact for PIN
          pinPnl.classList.remove('hidden'); 
          adminCtrls.classList.add('hidden'); 
          if (volSlider && audioEl) {
            volSlider.value = audioEl.volume.toString();
          }
        }
      }
      
      // Robust lock button event delegation (Header 🔓 Button) - ONLY PANEL OPEN/CLOSE
      else if (event.target && (event.target.id === 'lockButton' || event.target.closest('#lockButton'))) {
        event.preventDefault();
        event.stopPropagation();
        
        debugLog('admin', '[DEBUG] Lock-Button (Header) geklickt via document delegation, isAdminMode:', isAdminMode);
        
        if (isAdminMode) {
          // If unlocked, lock button works like admin button (toggle panel)
          const overlay = document.getElementById('adminOverlay');
          const pinPnl = document.getElementById('pinPanel');
          const adminCtrls = document.getElementById('adminControls');
          const volSlider = document.getElementById('volumeSlider');
          const audioEl = document.getElementById('audioPlayer');
          
          if (!overlay || !pinPnl || !adminCtrls) {
            console.error('[DEBUG] Critical admin elements not found!');
            return;
          }
          
          const isOverlayVisible = !overlay.classList.contains('hidden');
          
          if (isOverlayVisible) {
            // Admin panel is open, close it (stay unlocked)
            debugLog('ui', '[DEBUG] Lock-Button: Close admin panel (stay unlocked)');
            if (window.adminPanel && window.adminPanel.hideAdminOverlay) {
              window.adminPanel.hideAdminOverlay();
            }
          } else {
            // Admin panel is closed, open it (unlocked)
            debugLog('ui', '[DEBUG] Lock-Button: Open admin panel (unlocked)');
            overlay.classList.remove('hidden'); 
            overlay.classList.remove('pin-mode');
            pinPnl.classList.add('hidden'); 
            adminCtrls.classList.remove('hidden');
            if (volSlider && audioEl) {
              volSlider.value = audioEl.volume.toString();
            }
            
            // Update admin panel status
            if (typeof updateSpotifyAutoLearnVisibility === 'function') {
              updateSpotifyAutoLearnVisibility();
            }
            if (typeof updateAutoLearnStatus === 'function') {
              updateAutoLearnStatus();
            }
          }
        } else {
          // If locked, do nothing (lock button is hidden anyway)
          debugLog('ui', '[DEBUG] Lock-Button geklickt, aber Admin ist gesperrt - ignoriere');
        }
      }
      
      // ROBUSTE Lock-Admin-Panel Event-Delegation (Admin-Panel 🔒 Sperren Button)
      else if (event.target && (event.target.id === 'lockAdminPanel' || event.target.closest('#lockAdminPanel'))) {
        event.preventDefault();
        event.stopPropagation();
        
        debugLog('ui', '[DEBUG] Lock-Admin-Panel Button geklickt via document delegation');
        
        isAdminMode = false;
        window.adminPanel.setAdminMode(false);
        document.body.classList.remove('admin-mode');
        
        // Clear admin status from database and localStorage
        if (window.sessionAPI) {
          window.sessionAPI.setAdminUnlocked(false).catch(error => {
            debugLog('ADMIN', 'Database admin status clear failed:', error);
          });
        }
        localStorage.removeItem('jukebox_admin_unlocked');
        
        if (window.adminPanel && window.adminPanel.updateControlsState) {
          window.adminPanel.updateControlsState();
        }
        
        // Update queue display to hide remove buttons
        debouncedUpdateQueueDisplay();
        
        // Hide admin overlay
        if (window.adminPanel && window.adminPanel.hideAdminOverlay) {
          window.adminPanel.hideAdminOverlay();
        }
        
        debugLog('ui', '[DEBUG] Admin-Modus deaktiviert (Admin-Panel Sperren-Button)');
      }
    }, true); // Use capture phase for maximum reliability
    
  } else {
    console.error('[DEBUG] Admin-Button nicht gefunden!');
  }

  // Initialize admin panel DOM
  if (window.adminPanel && window.adminPanel.initializeDOM) {
    window.adminPanel.initializeDOM();
  }
  
  debugLog('SYSTEM', '=== DOMContentLoaded abgeschlossen ===');
  
  // Audio Test Button
  const testAudioButton = document.getElementById('testAudioSystem');
  const audioTestResult = document.getElementById('audioTestResult');
  
  if (testAudioButton && audioTestResult) {
    testAudioButton.addEventListener('click', async () => {
      debugLog('audio', '[AUDIO-TEST] Starting audio system test...');
      audioTestResult.style.display = 'block';
      audioTestResult.innerHTML = '🔄 Testing audio system...';
      
      try {
        // Test 1: Audio element creation
        const testAudio = new Audio();
        audioTestResult.innerHTML += '<br>✅ Audio element created';
        
        // Test 2: Try to load a test MP3 from server
        testAudio.src = getAPIURL('/api/stream/1');
        audioTestResult.innerHTML += '<br>🔄 Loading test track...';
        
        // Test 3: Load promise
        await new Promise((resolve, reject) => {
          testAudio.addEventListener('loadeddata', () => {
            audioTestResult.innerHTML += '<br>✅ Audio data loaded';
            resolve();
          });
          
          testAudio.addEventListener('error', (e) => {
            audioTestResult.innerHTML += `<br>❌ Load error: ${testAudio.error?.message || 'Unknown error'}`;
            reject(e);
          });
          
          setTimeout(() => {
            reject(new Error('Timeout'));
          }, 10000);
        });
        
        // Test 4: Play attempt
        audioTestResult.innerHTML += '<br>🔄 Attempting playback...';
        await testAudio.play();
        audioTestResult.innerHTML += '<br>✅ Audio playback successful!';
        
        // Stop after 2 seconds
        setTimeout(() => {
          testAudio.pause();
          testAudio.currentTime = 0;
          audioTestResult.innerHTML += '<br>🛑 Test completed successfully';
        }, 2000);
        
      } catch (error) {
        console.error('[AUDIO-TEST] Failed:', error);
        audioTestResult.innerHTML += `<br>❌ Test failed: ${error.message}`;
        
        if (error.name === 'NotAllowedError') {
          audioTestResult.innerHTML += '<br>💡 Autoplay is blocked. Try clicking play manually.';
        }
      }
    });
  }
  
  // Initialize admin panel content translations after i18n system is ready
  setTimeout(() => {
    if (window.adminPanel && window.adminPanel.updateAdminPanelContent) {
      window.adminPanel.updateAdminPanelContent();
    }
  }, 100);

  // Listen for language changes to update admin panel content
  window.addEventListener('languageChanged', () => {
    // Small delay to ensure i18n system is ready
    setTimeout(() => {
      if (window.adminPanel && window.adminPanel.updateAdminPanelContent) {
        window.adminPanel.updateAdminPanelContent();
      }
      // Also update the language dropdown to reflect current language
      if (window.adminPanel && window.adminPanel.updateLanguageDropdown) {
        window.adminPanel.updateLanguageDropdown();
      }
    }, 50);
  });
  
  // Update language dropdown when i18n system loads
  setTimeout(() => {
    if (window.adminPanel && window.adminPanel.updateLanguageDropdown) {
      window.adminPanel.updateLanguageDropdown();
    }
  }, 200);
  
  // Listen for i18n initialization completion
  window.addEventListener('i18nInitialized', (event) => {
    if (window.adminPanel && window.adminPanel.updateLanguageDropdown) {
      window.adminPanel.updateLanguageDropdown();
    }
    // Force comprehensive UI update after initialization
    if (window.i18nSystem) {
      window.i18nSystem.updateUI();
      if (window.adminPanel && window.adminPanel.updateAdminPanelContent) {
        window.adminPanel.updateAdminPanelContent();
      }
    }
  });
  
  // Also try immediate update if i18n is already ready
  setTimeout(() => {
    if (window.i18nSystem && window.i18nSystem.currentLanguage) {
      if (window.adminPanel && window.adminPanel.updateLanguageDropdown) {
        window.adminPanel.updateLanguageDropdown();
      }
      window.i18nSystem.updateUI();
    }
  }, 100);

}

// Initialize app when DOM is ready, or immediately if already loaded
if (document.readyState === 'loading') {
  // DOM is still loading, wait for DOMContentLoaded
  document.addEventListener('DOMContentLoaded', initializeApp);
} else {
  // DOM is already loaded, initialize immediately
  debugLog('SYSTEM', '⚡ DOM already loaded - initializing immediately');
  initializeApp();
}

// Jukebox Web Renderer - complete browser logic
'use strict';

// Global debugging for audio element
window.debugAudio = function() {
  const audioEl = document.getElementById('audioPlayer');
  debugLog('=== AUDIO DEBUG ===');
  debugLog('audio', 'Audio element:', audioEl);
  debugLog('audio', 'Current src:', audioEl.src);
  debugLog('audio', 'Ready state:', audioEl.readyState);
  debugLog('audio', 'Network state:', audioEl.networkState);
  debugLog('audio', 'Paused:', audioEl.paused);
  debugLog('audio', 'Current time:', audioEl.currentTime);
  debugLog('[DEBUG] Duration:', audioEl.duration);
  debugLog('audio', 'Volume:', audioEl.volume);
  debugLog('audio', 'Muted:', audioEl.muted);
  if (audioEl.error) {
    debugLog('[DEBUG] Error code:', audioEl.error.code);
    debugLog('[DEBUG] Error message:', audioEl.error.message);
  }
  debugLog('audio', '===================');
  return audioEl;
};

// Element-Referenzen
const localListEl = document.getElementById('localList');
const spotifyResultsEl = document.getElementById('spotifyResults');
const queueListEl = document.getElementById('queueList');
const searchInput = document.getElementById('searchInput');
const nowPlayingTitleEl = document.getElementById('nowPlayingTitle');
const playButton = document.getElementById('playButton');
const pauseButton = document.getElementById('pauseButton');
const stopButton = document.getElementById('stopButton');
const skipControlButton = document.getElementById('skipControlButton');
const actionAddQueueBtn = document.getElementById('actionAddQueue');
const actionPlayNextBtn = document.getElementById('actionPlayNext');
const actionAddPlaylistBtn = document.getElementById('actionAddPlaylist');

// Dynamic Spotify Client ID loading
let SPOTIFY_CLIENT_ID = null; // Will be loaded from database

async function loadSpotifyClientId() {
  if (window.settingsAPI) {
    try {
      const clientId = await window.settingsAPI.getSetting('spotify', 'clientId', null);
      if (clientId) {
        SPOTIFY_CLIENT_ID = clientId;
        debugLog('spotify', '🎵 Loaded Spotify Client ID from settings:', clientId.substring(0, 8) + '...');
        return clientId;
      } else {
        console.warn('⚠️ No Spotify Client ID configured in database! Please configure in Admin settings.');
        SPOTIFY_CLIENT_ID = null;
        return null;
      }
    } catch (error) {
      console.error('❌ Failed to load Spotify Client ID from settings:', error);
      SPOTIFY_CLIENT_ID = null;
      return null;
    }
  }
  console.warn('⚠️ settingsAPI not available, cannot load Spotify Client ID');
  SPOTIFY_CLIENT_ID = null;
  return null;
}

// Configurable settings with defaults
let trackLockTimeMinutes = 60; // Default: 1 hour
const libraryListEl = document.getElementById('libraryList');
const libraryGridEl = document.getElementById('libraryGrid');
const sideNav = document.getElementById('sideNav');
const viewSwitchEl = document.getElementById('viewSwitch');
const progressBar = document.getElementById('progressBar');
const equalizerCanvas = document.getElementById('equalizerCanvas');

// Set canvas size correctly
if (equalizerCanvas) {
  // Responsive size based on CSS
  function resizeEqualizerCanvas() {
    const rect = equalizerCanvas.getBoundingClientRect();
    equalizerCanvas.width = rect.width;
    equalizerCanvas.height = rect.height;
  }
  resizeEqualizerCanvas();
  window.addEventListener('resize', resizeEqualizerCanvas);
}

let currentFilter = 'all';
let currentView = 'list';
const library = [];
const recentAdditions = [];
const queue = [];
let currentTrackIndex = -1;

// Application configuration
let appConfig = null;
let dataServerURL = 'http://127.0.0.1:3001'; // Default fallback

// Load configuration from config.json
async function loadConfig() {
  try {
    const response = await fetch('./config.json');
    if (response.ok) {
      appConfig = await response.json();
      if (appConfig.server) {
        dataServerURL = `http://${appConfig.server.host}:${appConfig.server.dataPort}`;
        debugLog('SYSTEM', `Configuration loaded: data server URL set to ${dataServerURL}`);
      }
    } else {
      debugLog('SYSTEM', 'Config.json not found, using default settings');
    }
  } catch (error) {
    debugLog('SYSTEM', 'Failed to load config.json, using defaults:', error.message);
  }
}

// Helper function to get API URL
function getAPIURL(endpoint = '') {
  return `${dataServerURL}${endpoint}`;
}

// Dynamic layout update function
function updateUILayout() {
  const content = document.getElementById('content');
  const nowPlayingSection = document.getElementById('nowPlayingSection');
  
  if (!content || !nowPlayingSection) return;
  
  // Check if we have a valid queue with a selected track (even if stopped)
  const hasValidTrack = queue.length > 0 && currentTrackIndex >= 0 && currentTrackIndex < queue.length;
  
  debugLog('UI', `updateUILayout: queue.length=${queue.length}, currentTrackIndex=${currentTrackIndex}, hasValidTrack=${hasValidTrack}`);
  
  if (hasValidTrack) {
    // Show now-playing mode if there's a valid track (regardless of play/pause state)
    debugLog('UI', `updateUILayout: hasValidTrack=true, currentIndex=${currentTrackIndex}, queueLength=${queue.length}`);
    debugLog('UI', `nowPlayingSection display: ${nowPlayingSection.style.display}, visibility: ${nowPlayingSection.style.visibility}`);
    
    // Check if now-playing section is intentionally collapsed (user is navigating)
    const isIntentionallyCollapsed = isNowPlayingCollapsed || nowPlayingSection.classList.contains('collapsed');
    
    if (!isIntentionallyCollapsed) {
      if (!content.classList.contains('now-playing-mode')) {
        trackPanelStateChange(); // Track panel state change
        content.classList.add('now-playing-mode');
        content.classList.remove('search-mode');
        
        // Always start collapsed and animate down
        nowPlayingSection.style.display = 'block';
        nowPlayingSection.style.visibility = 'visible';
        nowPlayingSection.classList.add('collapsed'); // Start collapsed
        nowPlayingSection.classList.remove('hidden', 'expanded');
        
        // Force reflow then animate down
        nowPlayingSection.offsetHeight; // Trigger reflow
        setTimeout(() => {
          nowPlayingSection.classList.remove('collapsed');
          nowPlayingSection.classList.add('expanded');
        }, 50); // Small delay to ensure collapsed state is applied first
        
        debugLog('UI', 'Layout switched to: now-playing mode (track available)');
      } else if (nowPlayingSection.style.display === 'none' || nowPlayingSection.style.display === '') {
        // Force show if hidden but should be visible
        nowPlayingSection.style.display = 'block';
        nowPlayingSection.style.visibility = 'visible';
        nowPlayingSection.classList.add('expanded');
        nowPlayingSection.classList.remove('hidden');
        debugLog('UI', 'Now-playing panel restored (was hidden)');
      } else {
        // Already in now-playing mode, but ensure panel is visible
        nowPlayingSection.style.display = 'block';
        nowPlayingSection.style.visibility = 'visible';
        nowPlayingSection.classList.add('expanded');
        nowPlayingSection.classList.remove('hidden', 'collapsed');
        debugLog('UI', 'Now-playing panel visibility enforced');
      }
    } else {
      // Respect the collapsed state - user is navigating
      debugLog('UI', 'Now-playing panel kept collapsed (user navigating)');
      if (content.classList.contains('now-playing-mode')) {
        trackPanelStateChange(); // Track panel state change
        
        // Animate panel collapse first, then switch modes
        nowPlayingSection.classList.remove('expanded');
        nowPlayingSection.classList.add('collapsed');
        
        // Wait for animation then switch modes
        setTimeout(() => {
          content.classList.add('search-mode');
          content.classList.remove('now-playing-mode');
          nowPlayingSection.style.display = 'none';
        }, 500); // Wait for CSS transition
      } else {
        content.classList.add('search-mode');
        content.classList.remove('now-playing-mode');
      }
    }
    
    // Force override any delayed hide operations that might be pending
    setTimeout(() => {
      if (hasValidTrack && nowPlayingSection.style.display === 'none') {
        nowPlayingSection.style.display = 'block';
        nowPlayingSection.style.visibility = 'visible';
        debugLog('UI', 'Force-override delayed hide operation detected');
      }
    }, 600); // Run after any 500ms delayed hide operations
  } else {
    // Only switch to search mode if queue is truly empty or no valid track
    if (!content.classList.contains('search-mode')) {
      if (content.classList.contains('now-playing-mode')) {
        trackPanelStateChange(); // Track panel state change
        
        // Animate panel collapse first
        nowPlayingSection.classList.remove('expanded');
        nowPlayingSection.classList.add('collapsed');
        
        // Wait for animation then hide
        setTimeout(() => {
          content.classList.add('search-mode');
          content.classList.remove('now-playing-mode');
          nowPlayingSection.style.display = 'none';
          nowPlayingSection.classList.remove('expanded', 'collapsed');
        }, 500);
      } else {
        content.classList.add('search-mode');
        content.classList.remove('now-playing-mode');
        nowPlayingSection.style.display = 'none';
        nowPlayingSection.classList.remove('expanded');
      }
    }
  }
}

// Expose queue and currentTrackIndex to global scope for modular access
window.queue = queue;
// Use a getter property to always return the current value of currentTrackIndex
Object.defineProperty(window, 'currentTrackIndex', {
  get: function() { return currentTrackIndex; },
  set: function(value) { currentTrackIndex = value; }
});

// Spotify state - get token from spotify.js module
if (typeof window.spotifyAccessToken === 'undefined' && sessionStorage.getItem('spotify_access_token')) {
  // Initialize token if not already set by spotify module
  debugLog('ui', '[DEBUG] Initializing Spotify token from sessionStorage');
}
// ... bereits oben deklariert ...

// ... bereits oben deklariert ...

async function loadLocalIndex() {
  try {
    debugLog('[DATA-API] Loading music library from server...');
    
    // Check if data server is available
    await musicAPI.health();
    debugLog('[DATA-API] Data server is healthy');
    
  // Clear cover cache too when refreshing library
  coverCache.clear();
  
  // Use cache-busting for the request
  const response = await musicAPI.getTracks({ limit: 1000 }, true);
  const tracks = response.data || [];
  debugLog('DATA-API', `Loaded ${tracks.length} tracks from server`);
    
    // Convert server tracks to library format
    const libraryTracks = tracks.map(track => ({
      type: 'server',
      id: track.id,
      title: track.title,
      artist: track.artist,
      album: track.album,
      year: track.year,
      genre: track.genre,
      duration: track.duration,
      streamUrl: musicAPI.getStreamURL(track.id),
      coverUrl: musicAPI.getCoverURL(track.id),
      path: track.file_path
    }));
    
    // Add to library and render
    addToLibrary(libraryTracks, 'server');
    renderLocalFiles(libraryTracks);
    
    debugLog('DATA-API', 'Library loaded successfully');
    
    // Now render the library view after data is loaded
    debugLog('DATA-API', (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('debug.ui.dataLoaded') : 'Data loaded - rendering library with currentFilter:', currentFilter);
    
    // Ensure correct layout mode when showing library content at startup
    if (currentFilter !== 'all') {
      // Collapse now playing section to show library content
      collapseNowPlayingSection();
    }
    
    try {
      renderLibrary();
    } catch (error) {
      debugLog('DATA-API', (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('debug.ui.dataRenderError') : 'Error rendering library:', error);
    }
    
  } catch (error) {
    console.warn('[DATA-API] Data server not available, trying fallback:', error.message);
    
    // Fallback: Try to load old music_index.json
    try {
      const res = await fetch('music_index.json', { cache: 'no-store' });
      if (!res.ok) throw new Error('no index');
      const files = await res.json();
      renderLocalFiles(files);
      addToLibrary(files, 'local');
      debugLog('library', '[FALLBACK] Loaded music from local index');
      
      // Render library after fallback data is loaded
      debugLog('DATA-API', (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('debug.ui.fallbackDataLoaded') : 'Fallback data loaded - rendering library with currentFilter:', currentFilter);
      
      // Ensure correct layout mode when showing library content at startup
      if (currentFilter !== 'all') {
        // Collapse now playing section to show library content
        collapseNowPlayingSection();
      }
      
      try {
        renderLibrary();
      } catch (error) {
        debugLog('DATA-API', (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('debug.ui.fallbackRenderError') : 'Error rendering library (fallback):', error);
      }
    } catch (fallbackError) {
      console.warn('[FALLBACK] No music source available');
      const noMusicText = (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.messages.noMusicAvailable') : 'No music available. Start the Data Server or load music through the Admin Panel.';
      toast.warning(noMusicText);
      
      // Even with no data, render library to show empty state
      debugLog('DATA-API', 'No data available - render empty library');
      try {
        renderLibrary();
      } catch (error) {
        debugLog('DATA-API', (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('debug.ui.emptyLibraryError') : 'Error rendering empty library:', error);
      }
    }
  }
}

function renderLocalFiles(files) {
  if (!localListEl) return;
  localListEl.innerHTML='';
  files.forEach((file) => {
    const li = document.createElement('li');
    
    // Create track info display
    const trackInfo = document.createElement('div');
    trackInfo.className = 'track-info';
    
    const title = document.createElement('div');
    title.className = 'track-title';
    title.textContent = file.title;
    
    const details = document.createElement('div');
    details.className = 'track-details';
    details.textContent = `${file.artist || 'Unknown Artist'} • ${file.album || 'Unknown Album'}`;
    
    trackInfo.appendChild(title);
    trackInfo.appendChild(details);
    
    // Add cover image if available
    if (file.coverUrl || file.image) {
      const cover = document.createElement('img');
      cover.className = 'track-cover-small';
      cover.src = file.coverUrl || file.image || 'assets/default_cover.png';
      cover.alt = 'Cover';
      cover.loading = 'lazy';
      li.appendChild(cover);
    }
    
    li.appendChild(trackInfo);
    
    // Add click handler
    li.addEventListener('click', () => {
      const track = {
        type: file.type || 'local',
        id: file.id,
        title: file.title,
        path: file.streamUrl || file.path,
        image: file.coverUrl || file.image || '',
        artist: file.artist || '',
        album: file.album || '',
        year: file.year || '',
        genre: file.genre || '',
        duration: file.duration
      };
      
      addToQueue(track);
    });
    
    localListEl.appendChild(li);
  });
}

function addToLibrary(items, source) {
  items.forEach((item) => {
    let libItem;
    if (source === 'local') {
      libItem = { 
        type: 'local', 
        title: item.title, 
        path: item.path, 
        image: item.image || '', 
        artist: item.artist || '', 
        album: item.album || '', 
        year: item.year || '', 
        genre: item.genre || '' 
      };
    } else if (source === 'server') {
      libItem = {
        type: 'server',
        id: item.id,
        title: item.title,
        path: item.streamUrl,
        image: item.coverUrl || '',
        artist: item.artist || '',
        album: item.album || '',
        year: item.year || '',
        genre: item.genre || '',
        duration: item.duration
      };
    } else if (source === 'spotify') {
      libItem = { 
        type: 'spotify', 
        title: `${item.name} – ${item.artists}`, 
        previewUrl: item.previewUrl, 
        image: item.image || '', 
        artist: item.artist || '', 
        album: item.album || '', 
        year: item.year || '', 
        genre: item.genre || '', 
        uri: item.uri 
      };
    }
    
    if (!library.some(t => t.title === libItem.title && t.type === libItem.type)) {
      library.push(libItem); 
      recentAdditions.push(libItem); 
      if (recentAdditions.length > 50) recentAdditions.shift();
    }
  });
  updateFilterOptions();
  renderLibrary();
}

function updateFilterOptions() {
  // A-Z buttons are now handled by separate azNav - no longer add to main navigation
  // Remove any existing letter buttons from main nav
  const existing = sideNav.querySelectorAll('.nav-tile[data-letter="true"]');
  existing.forEach(b=>b.remove());
}

function renderLibraryByGroup(field) {
  libraryGridEl.classList.add('hidden');
  libraryListEl.classList.remove('hidden');
  libraryListEl.innerHTML='';
  const groups={};
  library.forEach((item)=>{
    let key='';
    if (field==='decade') {
      const yearNum=parseInt(item.year,10); key = !isNaN(yearNum) ? `${Math.floor(yearNum/10)*10}s` : ((typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.messages.unknown') : 'Unbekannt');
    } else { key = item[field] || ((typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.messages.unknown') : 'Unbekannt'); }
    (groups[key] ||= []).push(item);
  });
  const keys = Object.keys(groups).sort((a,b)=>{ const na=parseInt(a,10), nb=parseInt(b,10); if(!isNaN(na)&&!isNaN(nb)) return na-nb; return a.localeCompare(b,'de',{sensitivity:'base'}); });
  keys.forEach((key)=>{
    const details=document.createElement('details'); details.style.marginBottom='0.5rem';
    const summary=document.createElement('summary'); summary.style.display='flex'; summary.style.alignItems='center'; summary.style.cursor='pointer'; summary.style.backgroundColor='#1e1e1e'; summary.style.padding='0.6rem'; summary.style.borderRadius='0.4rem'; summary.style.marginBottom='0.2rem';
    if (field==='album') { const firstWithImage = groups[key].find(it=>it.image); if (firstWithImage && firstWithImage.image){ const img=document.createElement('img'); img.src=firstWithImage.image; img.style.width='40px'; img.style.height='40px'; img.style.objectFit='cover'; img.style.marginRight='0.5rem'; summary.appendChild(img);} else { const spanIcon=document.createElement('span'); spanIcon.textContent='🎵'; spanIcon.style.marginRight='0.5rem'; spanIcon.style.color='#1DB954'; summary.appendChild(spanIcon);} }
    else { const spanIcon=document.createElement('span'); spanIcon.textContent='📁'; spanIcon.style.marginRight='0.5rem'; spanIcon.style.color='#1DB954'; summary.appendChild(spanIcon); }
    const spanText=document.createElement('span'); spanText.textContent=key; summary.appendChild(spanText); details.appendChild(summary);
    const ul=document.createElement('ul'); ul.style.listStyle='none'; ul.style.paddingLeft='1rem';
    groups[key].forEach((item)=>{ const li=document.createElement('li'); li.style.padding='0.6rem'; li.style.marginBottom='0.3rem'; li.style.backgroundColor='#2a2a2a'; li.style.borderRadius='0.4rem'; li.style.display='flex'; li.style.alignItems='center'; li.style.cursor='pointer';
      if (item.image) { const img=document.createElement('img'); img.src=item.image; img.style.width='30px'; img.style.height='30px'; img.style.objectFit='cover'; img.style.marginRight='0.5rem'; li.appendChild(img);} else { const ico=document.createElement('span'); ico.textContent='🎵'; ico.style.marginRight='0.5rem'; ico.style.color='#1DB954'; li.appendChild(ico);} 
      const title=document.createElement('span'); title.textContent=item.title; li.appendChild(title);
      li.addEventListener('click', ()=> addToQueue(item));
      ul.appendChild(li);
    });
    details.appendChild(ul); libraryListEl.appendChild(details);
  });
}





// Hierarchical navigation functions






function updateBreadcrumb() {
  // Create or update navigation buttons
  let breadcrumbContainer = document.getElementById('breadcrumb');
  if (!breadcrumbContainer) {
    breadcrumbContainer = document.createElement('div');
    breadcrumbContainer.id = 'breadcrumb';
    breadcrumbContainer.style.padding = '0.5rem 1rem';
    breadcrumbContainer.style.backgroundColor = '#0f0f0f';
    breadcrumbContainer.style.borderBottom = '1px solid #333';
    breadcrumbContainer.style.display = 'flex';
    breadcrumbContainer.style.gap = '0.5rem';
    breadcrumbContainer.style.alignItems = 'center';
    
    const libraryContainer = document.getElementById('libraryContainer');
    libraryContainer.insertBefore(breadcrumbContainer, libraryContainer.firstChild);
  }
  
  breadcrumbContainer.innerHTML = '';
  
  // Hide breadcrumb at root level or when just viewing lists without selections
  if (navigationState.level === 'root' || 
      (navigationState.level === 'artists' && !navigationState.currentArtist) ||
      (navigationState.level === 'albums' && !navigationState.currentArtist && !navigationState.currentAlbum)) {
    breadcrumbContainer.style.display = 'none';
    return;
  }
  
  breadcrumbContainer.style.display = 'flex';
  
  // Home button
  const homeBtn = document.createElement('button');
  homeBtn.innerHTML = '←';
  const backToOverviewText = (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.messages.backToOverview') : 'Back to overview';
  homeBtn.title = backToOverviewText;
  homeBtn.style.cssText = `
    background: #1a1a1a;
    border: 1px solid #333;
    color: #1DB954;
    padding: 0.3rem 0.5rem;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.9rem;
    transition: all 0.2s ease;
    font-weight: bold;
  `;
  homeBtn.addEventListener('mouseenter', () => {
    homeBtn.style.backgroundColor = '#333';
    homeBtn.style.borderColor = '#1DB954';
  });
  homeBtn.addEventListener('mouseleave', () => {
    homeBtn.style.backgroundColor = '#1a1a1a';
    homeBtn.style.borderColor = '#333';
  });
  homeBtn.addEventListener('click', () => {
    handleNavigationActivity('breadcrumb');
    navigationState.level = 'root';
    navigationState.currentArtist = null;
    navigationState.currentAlbum = null;
    navigationState.currentGenreCategory = null;
    navigationState.currentGenreCategoryData = null;
    navigationState.currentGenre = null;
    updateBreadcrumb();
    // Update A-Z navigation visibility
    updateAZNavigationVisibility();
    // Return to the current filter's main view
    switch (currentFilter) {
      case 'artist':
        renderArtistsList();
        break;
      case 'album':
        renderAlbumsList();
        break;
      case 'genre':
        renderGenresList();
        break;
      case 'decade':
        renderDecadesList();
        break;
      case 'new':
        renderRecentAlbums();
        break;
      default:
        renderLibrary();
        break;
    }
  });
  breadcrumbContainer.appendChild(homeBtn);
  
  // Genre category breadcrumb
  if (navigationState.level === 'genre_category' && navigationState.currentGenreCategory) {
    const categoryBtn = document.createElement('button');
    categoryBtn.textContent = navigationState.currentGenreCategory;
    categoryBtn.title = `Back to Genre Categories`;
    categoryBtn.style.cssText = `
      background: #1a1a1a;
      border: 1px solid #333;
      color: #fff;
      padding: 0.3rem 0.6rem;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.8rem;
      transition: all 0.2s ease;
    `;
    
    if (navigationState.currentGenreCategoryData) {
      categoryBtn.style.color = navigationState.currentGenreCategoryData.color;
      categoryBtn.addEventListener('mouseenter', () => {
        categoryBtn.style.backgroundColor = navigationState.currentGenreCategoryData.color + '20';
        categoryBtn.style.borderColor = navigationState.currentGenreCategoryData.color;
      });
      categoryBtn.addEventListener('mouseleave', () => {
        categoryBtn.style.backgroundColor = '#1a1a1a';
        categoryBtn.style.borderColor = '#333';
      });
    }
    
    categoryBtn.addEventListener('click', () => {
      navigationState.level = 'root';
      navigationState.currentGenreCategory = null;
      navigationState.currentGenreCategoryData = null;
      updateBreadcrumb();
      renderGenresList();
    });
    
    breadcrumbContainer.appendChild(categoryBtn);
  }
  
  // Genre artists breadcrumb (when viewing artists of a specific genre)
  if (navigationState.level === 'artists_in_genre' && navigationState.currentGenre) {
    const genreBtn = document.createElement('button');
    genreBtn.textContent = navigationState.currentGenre;
    genreBtn.title = `Back to ${navigationState.currentGenreCategory || 'Genre Categories'}`;
    genreBtn.style.cssText = `
      background: #1a1a1a;
      border: 1px solid #333;
      color: #1DB954;
      padding: 0.3rem 0.6rem;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.8rem;
      transition: all 0.2s ease;
    `;
    
    genreBtn.addEventListener('mouseenter', () => {
      genreBtn.style.backgroundColor = '#1DB954' + '20';
      genreBtn.style.borderColor = '#1DB954';
    });
    genreBtn.addEventListener('mouseleave', () => {
      genreBtn.style.backgroundColor = '#1a1a1a';
      genreBtn.style.borderColor = '#333';
    });
    
    genreBtn.addEventListener('click', () => {
      if (navigationState.currentGenreCategory) {
        // Go back to genre category if we came from there
        navigationState.level = 'genre_category';
        updateBreadcrumb();
        showGenreCategory(navigationState.currentGenreCategory, navigationState.currentGenreCategoryData);
      } else {
        // Go back to main genres list
        navigationState.level = 'root';
        navigationState.currentGenre = null;
        updateBreadcrumb();
        renderGenresList();
      }
    });
    
    breadcrumbContainer.appendChild(genreBtn);
  }
  
  if (navigationState.currentArtist) {
    // Artist button
    const artistBtn = document.createElement('button');
    artistBtn.textContent = navigationState.currentArtist;
    artistBtn.title = `Alben von ${navigationState.currentArtist}`;
    artistBtn.style.cssText = `
      background: #1a1a1a;
      border: 1px solid #333;
      color: #fff;
      padding: 0.3rem 0.6rem;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.8rem;
      transition: all 0.2s ease;
      max-width: 150px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    `;
    
    if (navigationState.level === 'tracks') {
      artistBtn.style.color = '#1DB954';
      artistBtn.addEventListener('mouseenter', () => {
        artistBtn.style.backgroundColor = '#333';
        artistBtn.style.borderColor = '#1DB954';
      });
      artistBtn.addEventListener('mouseleave', () => {
        artistBtn.style.backgroundColor = '#1a1a1a';
        artistBtn.style.borderColor = '#333';
      });
      artistBtn.addEventListener('click', () => {
        navigationState.level = 'albums';
        navigationState.currentAlbum = null;
        updateBreadcrumb();
        updateAZNavigationVisibility();
        renderAlbumsList(navigationState.currentArtist);
      });
    } else {
      artistBtn.style.cursor = 'default';
    }
    
    breadcrumbContainer.appendChild(artistBtn);
  }
  
  if (navigationState.currentAlbum) {
    // Album button (current location, not clickable)
    const albumBtn = document.createElement('button');
    albumBtn.textContent = navigationState.currentAlbum;
    albumBtn.style.cssText = `
      background: #333;
      border: 1px solid #1DB954;
      color: #1DB954;
      padding: 0.3rem 0.6rem;
      border-radius: 4px;
      cursor: default;
      font-size: 0.8rem;
      max-width: 150px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    `;
    breadcrumbContainer.appendChild(albumBtn);
  }
}








async function renderAllAlbumsList() {
  try {
    libraryGridEl.classList.add('hidden');
    libraryListEl.classList.remove('hidden');
    const loadingAlbumsText = (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.messages.loadingAlbums') : 'Lade Alben...';
    libraryListEl.innerHTML = `<div class="loading">${loadingAlbumsText}</div>`;
    
    const albumsResponse = await musicAPI.getAlbums();
    const albums = albumsResponse.data || albumsResponse;
    
    // Reset navigation state
    navigationState.level = 'root';
    navigationState.currentArtist = null;
    navigationState.currentAlbum = null;
    updateBreadcrumb();
    
    libraryListEl.innerHTML = '';
    
    // Group albums by artist
    const albumsByArtist = {};
    albums.forEach(album => {
      const artist = album.artist || ((typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.messages.unknownArtist') : 'Unknown Artist');
      if (!albumsByArtist[artist]) {
        albumsByArtist[artist] = [];
      }
      albumsByArtist[artist].push(album);
    });
    
    // Group artists by first letter
    const artistsByLetter = {};
    Object.keys(albumsByArtist).forEach(artist => {
      const firstChar = artist.charAt(0).toUpperCase();
      let letter;
      if (/[0-9]/.test(firstChar)) {
        letter = '0-9';
      } else if (/[A-Z]/.test(firstChar)) {
        letter = firstChar;
      } else {
        letter = '#'; // For special characters
      }
      
      if (!artistsByLetter[letter]) {
        artistsByLetter[letter] = [];
      }
      artistsByLetter[letter].push(artist);
    });

    // Apply A-Z filter if set
    let lettersToShow = Object.keys(artistsByLetter);
    if (currentAZFilter !== 'all') {
      if (currentAZFilter === '0-9') {
        lettersToShow = lettersToShow.filter(letter => letter === '0-9');
      } else {
        lettersToShow = lettersToShow.filter(letter => letter === currentAZFilter);
      }
    }
    
    // Sort letters and artists
    const sortedLetters = lettersToShow.sort((a, b) => {
      if (a === '0-9') return -1;
      if (b === '0-9') return 1;
      if (a === '#') return 1;
      if (b === '#') return -1;
      return a.localeCompare(b);
    });
    
    sortedLetters.forEach(letter => {
      // Letter header
      const letterHeader = document.createElement('div');
      letterHeader.style.cssText = `
        font-size: 1.1rem;
        font-weight: bold;
        color: #1DB954;
        margin: 1.5rem 0 0.8rem 0;
        padding: 0.4rem 0.8rem;
        background: rgba(29, 185, 84, 0.1);
        border-left: 4px solid #1DB954;
        border-radius: 0.3rem;
      `;
      letterHeader.textContent = letter;
      libraryListEl.appendChild(letterHeader);
      
      // Sort artists within this letter
      const sortedArtists = artistsByLetter[letter].sort();
      
      sortedArtists.forEach(artistName => {
        // Artist container
        const artistContainer = document.createElement('div');
        artistContainer.style.cssText = `
          margin-left: 1rem;
          margin-bottom: 1.5rem;
          border-left: 2px solid #333;
          padding-left: 1rem;
        `;
        
        // Artist header
        const artistHeader = document.createElement('div');
        artistHeader.style.cssText = `
          font-size: 1.2rem;
          font-weight: bold;
          color: #fff;
          margin-bottom: 0.8rem;
          cursor: pointer;
          padding: 0.5rem;
          border-radius: 0.3rem;
          transition: background-color 0.2s;
        `;
        artistHeader.textContent = artistName;
        
        artistHeader.addEventListener('mouseenter', () => {
          artistHeader.style.backgroundColor = '#2a2a2a';
        });
        artistHeader.addEventListener('mouseleave', () => {
          artistHeader.style.backgroundColor = 'transparent';
        });
        artistHeader.addEventListener('click', () => {
          navigationState.level = 'albums';
          navigationState.currentArtist = artistName;
          updateBreadcrumb();
          renderAlbumsList(artistName);
        });
        
        artistContainer.appendChild(artistHeader);
        
        // Albums list for this artist
        const albumsList = document.createElement('div');
        albumsList.style.cssText = `
          margin-left: 1rem;
          display: grid;
          gap: 0.5rem;
        `;
        
        albumsByArtist[artistName].forEach(album => {
          const albumItem = document.createElement('div');
          albumItem.style.cssText = `
            display: flex;
            align-items: center;
            padding: 0.5rem;
            background: #1e1e1e;
            border-radius: 0.3rem;
            cursor: pointer;
            transition: background-color 0.2s;
          `;
          
          albumItem.addEventListener('mouseenter', () => {
            albumItem.style.backgroundColor = '#2a2a2a';
          });
          albumItem.addEventListener('mouseleave', () => {
            albumItem.style.backgroundColor = '#1e1e1e';
          });
          albumItem.addEventListener('click', () => {
            navigationState.level = 'tracks';
            navigationState.currentArtist = artistName;
            navigationState.currentAlbum = album.name || album.album;
            updateBreadcrumb();
            renderTracksList(artistName, album.name || album.album);
          });
          
          // Small album cover
          const artistKey = (artistName || 'unknown').toLowerCase();
          const albumNameKey = (album.name || album.album || 'unknown').toLowerCase();
          const albumKey = artistKey + '||' + albumNameKey;
          const coverUrl = 'http://localhost:3001/api/album-cover/' + encodeURIComponent(albumKey);
          
          const coverImg = document.createElement('img');
          coverImg.src = coverUrl;
          coverImg.style.cssText = `
            width: 40px;
            height: 40px;
            border-radius: 0.3rem;
            margin-right: 1rem;
            object-fit: cover;
          `;
          
          coverImg.onerror = () => {
            coverImg.style.display = 'none';
            const iconSpan = document.createElement('span');
            iconSpan.textContent = '💿';
            iconSpan.style.cssText = `
              width: 40px;
              height: 40px;
              display: flex;
              align-items: center;
              justify-content: center;
              background: #333;
              border-radius: 0.3rem;
              margin-right: 1rem;
              font-size: 1.2rem;
              color: #666;
            `;
            albumItem.insertBefore(iconSpan, albumItem.firstChild);
          };
          
          albumItem.appendChild(coverImg);
          
          // Album info
          const albumInfo = document.createElement('div');
          albumInfo.style.flex = '1';
          
          const albumName = document.createElement('div');
          albumName.textContent = album.name || album.album;
          albumName.style.cssText = `
            color: #fff;
            font-weight: 500;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          `;
          
          const albumYear = document.createElement('div');
          if (album.year) {
            albumYear.textContent = album.year;
            albumYear.style.cssText = `
              color: #999;
              font-size: 0.9rem;
              margin-top: 0.2rem;
            `;
          }
          
          albumInfo.appendChild(albumName);
          if (album.year) albumInfo.appendChild(albumYear);
          albumItem.appendChild(albumInfo);
          
          albumsList.appendChild(albumItem);
        });
        
        artistContainer.appendChild(albumsList);
        libraryListEl.appendChild(artistContainer);
      });
    });
    
  } catch (error) {
    console.error('[DEBUG] Error loading all albums list:', error);
    const errorMusicLibraryText = (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.messages.errorLoadingArtists') : 'Fehler beim Laden der Musikbibliothek';
    libraryListEl.innerHTML = `<div class="error">${errorMusicLibraryText}</div>`;
  }
}



async function renderRecentAlbums() {
  if (!libraryGridEl || !libraryListEl) {
    console.error('[DEBUG] DOM-Elemente nicht gefunden!');
    return;
  }
  
  try {
    libraryGridEl.classList.remove('hidden');
    libraryListEl.classList.add('hidden');
    const loadingText = (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.labels.loadingLatestAlbums') : 'Lade neueste Alben...';
    libraryGridEl.innerHTML = `<div class="loading">${loadingText}</div>`;
    
    // Get FRESH data every time - force refresh
    const [albumsResponse, tracksResponse] = await Promise.all([
      musicAPI.getAlbums(null, true), // No artist filter, force refresh
      musicAPI.getTracks({}, true)     // No filters, force refresh
    ]);
    
    const albums = albumsResponse.data || albumsResponse;
    const tracks = tracksResponse.data || tracksResponse;
    
    // Create a map of album -> newest track date
    const albumNewestTrack = new Map();
    tracks.forEach(track => {
      const albumKey = `${track.artist}|||${track.album}`;
      const currentNewest = albumNewestTrack.get(albumKey);
      if (!currentNewest || track.file_mtime > currentNewest) {
        albumNewestTrack.set(albumKey, track.file_mtime);
      }
    });
    
    // Sort albums by newest track addition - Fallback falls keine file_mtime
    const sortedAlbums = albums.length > 0 ? albums
      .map(album => ({
        ...album,
        newestTrack: albumNewestTrack.get(`${album.artist}|||${album.name || album.album}`) || Date.now() // Fallback: aktuelle Zeit
      }))
      .sort((a, b) => b.newestTrack - a.newestTrack)
      .slice(0, 20) : []; // Show only the 20 most recent albums
    
    // Reset navigation state
    navigationState.level = 'root';
    navigationState.currentArtist = null;
    navigationState.currentAlbum = null;
    updateBreadcrumb();
    
    // Ensure A-Z navigation is hidden for Recent Albums view
    updateAZNavigationVisibility();
    
    libraryGridEl.innerHTML = '';
    
    // Add CSS animations only once
    if (!document.getElementById('recent-albums-animations')) {
      const style = document.createElement('style');
      style.id = 'recent-albums-animations';
      style.textContent = `
        @keyframes slideInFade {
          from {
            opacity: 0;
            transform: translateY(-20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        
        @keyframes countUp {
          from {
            transform: scale(0.8);
            opacity: 0;
          }
          to {
            transform: scale(1);
            opacity: 1;
          }
        }
        
        @keyframes pulse {
          0%, 100% {
            transform: scale(1);
          }
          50% {
            transform: scale(1.05);
          }
        }
        
        @keyframes rotate3D {
          0% {
            transform: perspective(1000px) rotateY(0deg) rotateX(0deg);
          }
          20% {
            transform: perspective(1000px) rotateY(35deg) rotateX(15deg) scale(1.1);
          }
          40% {
            transform: perspective(1000px) rotateY(0deg) rotateX(0deg) scale(1.15);
          }
          60% {
            transform: perspective(1000px) rotateY(-35deg) rotateX(-15deg) scale(1.1);
          }
          80% {
            transform: perspective(1000px) rotateY(0deg) rotateX(0deg) scale(1.05);
          }
          100% {
            transform: perspective(1000px) rotateY(0deg) rotateX(0deg);
          }
        }
        
        .album-card-animated {
          animation: slideInFade 0.8s ease-out forwards;
          opacity: 0;
        }
        
        .stats-animated {
          animation: countUp 1s ease-out forwards;
          opacity: 0;
        }
        
        .pulse-hover:hover {
          animation: pulse 0.6s ease-in-out;
        }
      `;
      document.head.appendChild(style);
    }
    
    // Reset container style to block for header and stats
    libraryGridEl.style.display = 'block';
    libraryGridEl.style.gridTemplateColumns = 'none';
    libraryGridEl.style.gap = '0';
    libraryGridEl.style.padding = '0';
    
    // Header Section (consistent with decades/genre style)
    const headerDiv = document.createElement('div');
    headerDiv.style.cssText = `
      text-align: center; 
      padding: 2rem 1rem; 
      background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%);
      border-radius: 12px;
      margin-bottom: 2rem;
      border: 1px solid #333;
      opacity: 0;
      transform: translateY(-20px);
      animation: slideInFade 0.6s ease-out forwards;
    `;
    headerDiv.innerHTML = `
      <h2 style="
        margin: 0 0 0.5rem 0; 
        color: #1DB954; 
        font-size: 2.5rem;
        text-shadow: 0 0 20px rgba(29, 185, 84, 0.3);
      ">${(typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.labels.newMusicTitle') : '🆕 Neue Musik entdecken'}</h2>
      <p style="
        margin: 0; 
        color: #999; 
        font-size: 1.1rem;
      ">${(typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.labels.newMusicDescription') : 'Freshly added tracks and current statistics'}</p>
    `;
    libraryGridEl.appendChild(headerDiv);

    // Albums Section (decades design)
    const albumsHeaderDiv = document.createElement('div');
    albumsHeaderDiv.style.cssText = `
      padding: 1.5rem;
      margin-bottom: 1rem;
      background: linear-gradient(135deg, rgba(138, 43, 226, 0.15) 0%, rgba(29, 185, 84, 0.08) 100%);
      border-radius: 16px;
      border: 2px solid rgba(138, 43, 226, 0.4);
      text-align: center;
      position: relative;
      overflow: hidden;
    `;
    albumsHeaderDiv.innerHTML = `
      <h3 style="
        margin: 0 0 0.5rem 0; 
        color: #8A2BE2; 
        font-size: 1.8rem;
        text-shadow: 0 0 15px rgba(138, 43, 226, 0.3);
      ">${(typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.labels.latestAlbums') : '📀 Neueste Alben'}</h3>
      <p style="
        margin: 0; 
        color: #999; 
        font-size: 1rem;
      ">${(typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.labels.latestAlbumsDescription') : 'Alben mit den neuesten Tracks'}</p>
    `;
    libraryGridEl.appendChild(albumsHeaderDiv);
    
    // Create separate container for albums with grid layout
    const albumsContainer = document.createElement('div');
    albumsContainer.style.display = 'grid';
    albumsContainer.style.gridTemplateColumns = 'repeat(auto-fit, minmax(200px, 1fr))';
    albumsContainer.style.gap = '1rem';
    albumsContainer.style.marginBottom = '2rem';
    
    // Add albums container to main container FIRST
    libraryGridEl.appendChild(albumsContainer);
    
    // Limit to 12 albums (2 rows of 6)
    const limitedAlbums = sortedAlbums.slice(0, 12);
    
    limitedAlbums.forEach((album, index) => {
      const albumCard = document.createElement('div');
      albumCard.style.width = '200px';
      albumCard.style.margin = '1rem';
      albumCard.style.backgroundColor = '#1e1e1e';
      albumCard.style.borderRadius = '0.5rem';
      albumCard.style.padding = '1rem';
      albumCard.style.cursor = 'pointer';
      albumCard.style.transition = 'all 0.3s ease';
      albumCard.style.boxShadow = '0 4px 6px rgba(0, 0, 0, 0.3)';
      albumCard.style.border = '2px solid transparent';
      
      albumCard.addEventListener('mouseenter', () => {
        albumCard.style.backgroundColor = '#2a2a2a';
        albumCard.style.transform = 'translateY(-5px)';
        albumCard.style.boxShadow = '0 8px 15px rgba(0, 0, 0, 0.4)';
        albumCard.style.borderColor = '#1DB954';
      });
      albumCard.addEventListener('mouseleave', () => {
        albumCard.style.backgroundColor = '#1e1e1e';
        albumCard.style.transform = 'translateY(0)';
        albumCard.style.boxShadow = '0 4px 6px rgba(0, 0, 0, 0.3)';
        albumCard.style.borderColor = 'transparent';
      });
      
      // Album cover
      const coverContainer = document.createElement('div');
      coverContainer.style.width = '100%';
      coverContainer.style.height = '180px';
      coverContainer.style.marginBottom = '0.8rem';
      coverContainer.style.borderRadius = '0.3rem';
      coverContainer.style.overflow = 'hidden';
      coverContainer.style.backgroundColor = '#333';
      coverContainer.style.display = 'flex';
      coverContainer.style.alignItems = 'center';
      coverContainer.style.justifyContent = 'center';
      coverContainer.style.position = 'relative';
      
      // Get actual cover from music server (same pattern as in other functions)
      const artistKey = (album.artist || 'unknown').toLowerCase();
      const albumKey = `${artistKey}||${(album.name || album.album || 'unknown').toLowerCase()}`;
      const coverUrl = `http://localhost:3001/api/album-cover/${encodeURIComponent(albumKey)}`;
      
      const img = document.createElement('img');
      img.style.width = '100%';
      img.style.height = '100%';
      img.style.objectFit = 'cover';
      img.src = coverUrl;
      
      img.onerror = () => {
        img.style.display = 'none';
        const iconSpan = document.createElement('span');
        iconSpan.textContent = '💿';
        iconSpan.style.fontSize = '2rem';
        iconSpan.style.color = '#666';
        coverContainer.appendChild(iconSpan);
      };
      
      coverContainer.appendChild(img);
      
      // "New" badge
      const newBadge = document.createElement('div');
      newBadge.textContent = 'NEU';
      newBadge.style.position = 'absolute';
      newBadge.style.top = '0.5rem';
      newBadge.style.right = '0.5rem';
      newBadge.style.backgroundColor = '#1DB954';
      newBadge.style.color = '#000';
      newBadge.style.padding = '0.2rem 0.5rem';
      newBadge.style.borderRadius = '0.3rem';
      newBadge.style.fontSize = '0.7rem';
      newBadge.style.fontWeight = 'bold';
      coverContainer.appendChild(newBadge);
      
      albumCard.appendChild(coverContainer);
      
      // Album name
      const nameSpan = document.createElement('div');
      nameSpan.textContent = album.name || album.album;
      nameSpan.style.fontWeight = 'bold';
      nameSpan.style.fontSize = '1rem';
      nameSpan.style.marginBottom = '0.4rem';
      nameSpan.style.color = '#fff';
      nameSpan.style.textAlign = 'center';
      nameSpan.style.overflow = 'hidden';
      nameSpan.style.textOverflow = 'ellipsis';
      nameSpan.style.whiteSpace = 'nowrap';
      nameSpan.style.lineHeight = '1.2';
      albumCard.appendChild(nameSpan);
      
      // Artist name
      const artistSpan = document.createElement('div');
      artistSpan.textContent = album.artist;
      artistSpan.style.fontSize = '0.9rem';
      artistSpan.style.color = '#b3b3b3';
      artistSpan.style.textAlign = 'center';
      artistSpan.style.marginBottom = '0.4rem';
      artistSpan.style.overflow = 'hidden';
      artistSpan.style.textOverflow = 'ellipsis';
      artistSpan.style.whiteSpace = 'nowrap';
      albumCard.appendChild(artistSpan);
      
      // Album info with date
      const infoSpan = document.createElement('div');
      let infoText = `${album.track_count} ${album.track_count === 1 ? 'Track' : 'Tracks'}`;
      if (album.year) {
        infoText += ` • ${album.year}`;
      }
      // Add last modified date
      if (album.newestTrack) {
        const date = new Date(album.newestTrack * 1000);
        const today = new Date();
        const diffTime = Math.abs(today - date);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        if (diffDays === 1) {
          infoText += ` • Today`;
        } else if (diffDays < 7) {
          infoText += ` • ${diffDays} days ago`;
        } else if (diffDays < 30) {
          const weeks = Math.floor(diffDays / 7);
          infoText += ` • ${weeks} ${weeks === 1 ? 'week' : 'weeks'} ago`;
        }
      }
      infoSpan.textContent = infoText;
      infoSpan.style.fontSize = '0.8rem';
      infoSpan.style.color = '#666';
      infoSpan.style.textAlign = 'center';
      albumCard.appendChild(infoSpan);
      
      albumCard.addEventListener('click', () => {
        renderTracksList(album.artist, album.name || album.album);
      });
      
      // Add staggered animation delay
      albumCard.className = 'album-card-animated';
      albumCard.style.animationDelay = `${index * 0.1}s`;
      
      albumsContainer.appendChild(albumCard);
    });
    
    if (limitedAlbums.length === 0) {
      const noResultsDiv = document.createElement('div');
      noResultsDiv.textContent = 'Keine neuen Alben gefunden';
      noResultsDiv.style.padding = '2rem';
      noResultsDiv.style.textAlign = 'center';
      noResultsDiv.style.color = '#999';
      noResultsDiv.style.gridColumn = '1 / -1';
      albumsContainer.appendChild(noResultsDiv);
    }

    // Newest Artists Section
    const artistsHeaderDiv = document.createElement('div');
    artistsHeaderDiv.style.cssText = `
      padding: 1.5rem;
      margin-bottom: 1rem;
      margin-top: 2rem;
      background: linear-gradient(135deg, rgba(255, 107, 107, 0.15) 0%, rgba(29, 185, 84, 0.08) 100%);
      border-radius: 16px;
      border: 2px solid rgba(255, 107, 107, 0.4);
      text-align: center;
      position: relative;
      overflow: hidden;
    `;
    artistsHeaderDiv.innerHTML = `
      <h3 style="
        margin: 0 0 0.5rem 0; 
        color: #FF6B6B; 
        font-size: 1.8rem;
        text-shadow: 0 0 15px rgba(255, 107, 107, 0.3);
      ">${(typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.labels.latestArtists') : '🎤 Neueste Interpreten'}</h3>
      <p style="
        margin: 0; 
        color: #999; 
        font-size: 1rem;
      ">${(typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.labels.latestArtistsDescription') : 'Interpreten mit den neuesten Tracks'}</p>
    `;
    libraryGridEl.appendChild(artistsHeaderDiv);

    // Get newest artists based on newest tracks
    const artistsWithNewestTracks = {};
    sortedAlbums.forEach(album => {
      const artistKey = album.artist;
      if (!artistsWithNewestTracks[artistKey] || 
          album.newestTrack > artistsWithNewestTracks[artistKey].newestTrack) {
        artistsWithNewestTracks[artistKey] = {
          name: album.artist,
          newestTrack: album.newestTrack,
          albumCount: 0,
          trackCount: 0
        };
      }
    });

    // Count albums and tracks for each artist
    sortedAlbums.forEach(album => {
      const artistKey = album.artist;
      if (artistsWithNewestTracks[artistKey]) {
        artistsWithNewestTracks[artistKey].albumCount++;
        artistsWithNewestTracks[artistKey].trackCount += album.track_count || 0;
      }
    });

    const sortedArtists = Object.values(artistsWithNewestTracks)
      .sort((a, b) => b.newestTrack - a.newestTrack)
      .slice(0, 12); // Limit to 12 artists (2 rows)

    // Create artists container
    const artistsContainer = document.createElement('div');
    artistsContainer.style.display = 'grid';
    artistsContainer.style.gridTemplateColumns = 'repeat(auto-fit, minmax(200px, 1fr))';
    artistsContainer.style.gap = '1rem';
    artistsContainer.style.marginBottom = '2rem';
    
    // Add artists container to main container FIRST
    libraryGridEl.appendChild(artistsContainer);

    sortedArtists.forEach((artist, index) => {
      const artistCard = document.createElement('div');
      artistCard.style.width = '200px';
      artistCard.style.margin = '1rem';
      artistCard.style.backgroundColor = '#1e1e1e';
      artistCard.style.borderRadius = '0.5rem';
      artistCard.style.padding = '1rem';
      artistCard.style.cursor = 'pointer';
      artistCard.style.transition = 'all 0.3s ease';
      artistCard.style.boxShadow = '0 4px 6px rgba(0, 0, 0, 0.3)';
      artistCard.style.border = '2px solid transparent';
      
      artistCard.addEventListener('mouseenter', () => {
        artistCard.style.backgroundColor = '#2a2a2a';
        artistCard.style.transform = 'translateY(-5px)';
        artistCard.style.boxShadow = '0 8px 15px rgba(0, 0, 0, 0.4)';
        artistCard.style.borderColor = '#FF6B6B';
      });
      artistCard.addEventListener('mouseleave', () => {
        artistCard.style.backgroundColor = '#1e1e1e';
        artistCard.style.transform = 'translateY(0)';
        artistCard.style.boxShadow = '0 4px 6px rgba(0, 0, 0, 0.3)';
        artistCard.style.borderColor = 'transparent';
      });
      
      // Artist cover
      const coverContainer = document.createElement('div');
      coverContainer.style.width = '100%';
      coverContainer.style.height = '180px';
      coverContainer.style.marginBottom = '0.8rem';
      coverContainer.style.borderRadius = '0.3rem';
      coverContainer.style.overflow = 'hidden';
      coverContainer.style.backgroundColor = '#333';
      coverContainer.style.display = 'flex';
      coverContainer.style.alignItems = 'center';
      coverContainer.style.justifyContent = 'center';
      coverContainer.style.position = 'relative';
      
      const coverUrl = `http://localhost:3001/api/artist-cover/${encodeURIComponent(artist.name.toLowerCase())}`;
      
      const img = document.createElement('img');
      img.style.width = '100%';
      img.style.height = '100%';
      img.style.objectFit = 'cover';
      img.src = coverUrl;
      
      img.onerror = () => {
        img.style.display = 'none';
        const iconSpan = document.createElement('span');
        iconSpan.textContent = '🎤';
        iconSpan.style.fontSize = '3rem';
        iconSpan.style.color = '#666';
        coverContainer.appendChild(iconSpan);
      };
      
      coverContainer.appendChild(img);
      
      // "New" badge
      const newBadge = document.createElement('div');
      newBadge.textContent = 'NEU';
      newBadge.style.position = 'absolute';
      newBadge.style.top = '0.5rem';
      newBadge.style.right = '0.5rem';
      newBadge.style.backgroundColor = '#FF6B6B';
      newBadge.style.color = '#fff';
      newBadge.style.padding = '0.2rem 0.5rem';
      newBadge.style.borderRadius = '0.3rem';
      newBadge.style.fontSize = '0.7rem';
      newBadge.style.fontWeight = 'bold';
      coverContainer.appendChild(newBadge);
      
      artistCard.appendChild(coverContainer);
      
      // Artist name
      const nameSpan = document.createElement('div');
      nameSpan.textContent = artist.name;
      nameSpan.style.fontWeight = 'bold';
      nameSpan.style.fontSize = '1rem';
      nameSpan.style.marginBottom = '0.4rem';
      nameSpan.style.color = '#fff';
      nameSpan.style.textAlign = 'center';
      nameSpan.style.overflow = 'hidden';
      nameSpan.style.textOverflow = 'ellipsis';
      nameSpan.style.whiteSpace = 'nowrap';
      nameSpan.style.lineHeight = '1.2';
      artistCard.appendChild(nameSpan);
      
      // Artist info
      const infoSpan = document.createElement('div');
      let infoText = `${artist.albumCount} ${artist.albumCount === 1 ? 'Album' : 'Alben'} • ${artist.trackCount} ${artist.trackCount === 1 ? 'Track' : 'Tracks'}`;
      
      // Add last modified date
      if (artist.newestTrack) {
        const date = new Date(artist.newestTrack * 1000);
        const today = new Date();
        const diffTime = Math.abs(today - date);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        if (diffDays === 1) {
          infoText += ` • Today`;
        } else if (diffDays < 7) {
          infoText += ` • ${diffDays} days ago`;
        } else if (diffDays < 30) {
          const weeks = Math.floor(diffDays / 7);
          infoText += ` • ${weeks} ${weeks === 1 ? 'week' : 'weeks'} ago`;
        }
      }
      
      infoSpan.textContent = infoText;
      infoSpan.style.fontSize = '0.8rem';
      infoSpan.style.color = '#666';
      infoSpan.style.textAlign = 'center';
      artistCard.appendChild(infoSpan);
      
      artistCard.addEventListener('click', () => {
        renderAlbumsList(artist.name);
      });
      
      // Add staggered animation delay
      artistCard.className = 'album-card-animated';
      artistCard.style.animationDelay = `${(index + 12) * 0.1}s`;
      
      artistsContainer.appendChild(artistCard);
    });

    if (sortedArtists.length === 0) {
      const noArtistsDiv = document.createElement('div');
      noArtistsDiv.textContent = 'Keine neuen Interpreten gefunden';
      noArtistsDiv.style.padding = '2rem';
      noArtistsDiv.style.textAlign = 'center';
      noArtistsDiv.style.color = '#999';
      noArtistsDiv.style.gridColumn = '1 / -1';
      artistsContainer.appendChild(noArtistsDiv);
    }
    
  } catch (error) {
    console.error('Error loading recent albums:', error);
    const errorNewAlbumsText = (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.messages.errorLoadingArtists') : 'Fehler beim Laden der neuen Alben';
    libraryGridEl.innerHTML = `<div class="error">${errorNewAlbumsText}</div>`;
  }
}

// renderLibrary and updateLibraryUI moved to js/library_renderer.js

function renderCoverView(filter) {
  libraryListEl.classList.add('hidden');
  libraryGridEl.classList.remove('hidden');
  libraryGridEl.innerHTML='';
  let items;
  if (filter==='new') {
    // For 'new' filter in cover view, show recent albums instead of tracks
    renderRecentAlbums();
    return;
  }
  else if (filter==='artist'||filter==='album'||filter==='genre'||filter==='decade') items=library;
  else if (filter==='all') items=library; else { const letter=filter.toUpperCase(); items = library.filter((i)=> i.title.charAt(0).toUpperCase()===letter); }
  items.forEach((item)=>{ const card=document.createElement('div'); card.className='card'; const img=document.createElement('img'); img.src=item.image || 'assets/default_cover.png'; card.appendChild(img); const titleEl=document.createElement('div'); titleEl.className='card-title'; titleEl.textContent=item.title; card.appendChild(titleEl); card.addEventListener('click', ()=> addToQueue(item)); libraryGridEl.appendChild(card); });
}

// Render most played tracks page  
async function renderMostPlayedTracks() {
  try {
    // Clear any existing content
    libraryGridEl.innerHTML = '';
    libraryGridEl.classList.remove('hidden');
    libraryListEl.classList.add('hidden');
    currentFilter = 'most-played';
    
    // Reset to default layout for Top Hits (no grid)
    libraryGridEl.style.display = 'block';
    libraryGridEl.style.gridTemplateColumns = '';
    libraryGridEl.style.gap = '';
    libraryGridEl.style.padding = '';
    libraryGridEl.style.justifyItems = '';
    
    // Reset navigation state
    navigationState.level = 'root';
    navigationState.currentArtist = null;
    navigationState.currentAlbum = null;
    updateBreadcrumb();
    
    // Hide A-Z navigation for Top Hits view
    updateAZNavigationVisibility();

    // Main header with Genre/Decade styling
    const headerDiv = document.createElement('div');
    headerDiv.style.padding = '1.5rem';
    headerDiv.style.marginBottom = '1.5rem';
    headerDiv.style.background = 'linear-gradient(135deg, rgba(138, 43, 226, 0.15) 0%, rgba(29, 185, 84, 0.08) 100%)';
    headerDiv.style.borderRadius = '16px';
    headerDiv.style.border = '2px solid rgba(138, 43, 226, 0.4)';
    headerDiv.style.textAlign = 'center';
    headerDiv.style.position = 'relative';
    headerDiv.style.overflow = 'hidden';
    
    headerDiv.innerHTML = 
      `<h2 style="margin: 0 0 0.5rem 0; color: #8A2BE2; font-size: 2.5rem; text-shadow: 0 0 20px rgba(138, 43, 226, 0.3);">${(typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.labels.topHitsTitle') : '🏆 Top Hits'}</h2>` +
      '<p style="margin: 0; color: #999; font-size: 1.1rem;">' + ((typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.labels.topHitsDescription') : 'Die meistgespielten Songs aus Ihrer Musiksammlung') + '</p>';
    
    libraryGridEl.appendChild(headerDiv);

    // Statistics Section - decades style
    const statisticsSection = document.createElement('div');
    statisticsSection.style.cssText = `
      padding: 1.5rem;
      margin-bottom: 1.5rem;
      background: linear-gradient(135deg, rgba(29, 185, 84, 0.15) 0%, rgba(138, 43, 226, 0.08) 100%);
      border-radius: 16px;
      border: 2px solid rgba(29, 185, 84, 0.4);
      position: relative;
      overflow: hidden;
    `;
    
    // Statistics title in decades style
    const statsTitle = document.createElement('h3');
    statsTitle.textContent = (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.labels.topHitsStatistics') : '📊 Statistiken';
    statsTitle.style.cssText = `
      margin: 0 0 1.5rem 0;
      color: #1DB954;
      font-size: 1.8rem;
      text-shadow: 0 0 15px rgba(29, 185, 84, 0.3);
      text-align: center;
    `;
    statisticsSection.appendChild(statsTitle);

    // Get fresh data for statistics
    const [albumsResponse, tracksResponse] = await Promise.all([
      musicAPI.getAlbums(null, true),
      musicAPI.getTracks({}, true)
    ]);
    
    const albums = albumsResponse.data || albumsResponse;
    const allTracks = tracksResponse.data || tracksResponse;
    
    // Statistics data
    const totalAlbums = albums.length;
    const totalTracks = allTracks.length;
    const totalArtists = new Set(albums.map(a => a.artist)).size;
    const genres = allTracks.reduce((acc, track) => {
      if (track.genre) {
        acc[track.genre] = (acc[track.genre] || 0) + 1;
      }
      return acc;
    }, {});
    const totalSongs = allTracks.length;
    
    const stats = [
      { label: (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.labels.tracks') : 'Songs', value: totalSongs, color: '#1DB954' },
      { label: (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.labels.albums') : 'Alben', value: totalAlbums, color: '#8A2BE2' },
      { label: (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.labels.artists') : 'Interpreten', value: totalArtists, color: '#FFD700' },
      { label: (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.labels.genre') : 'Genres', value: Object.keys(genres).length, color: '#FF6B35' }
    ];
    
    // Main statistics container - full width layout
    const statsContainer = document.createElement('div');
    statsContainer.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
      opacity: 0;
      transform: translateY(20px);
      animation: slideInFade 0.8s ease-out 0.2s forwards;
    `;
    
    // Quick stats grid - full width
    const quickStats = document.createElement('div');
    quickStats.style.cssText = `
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 1rem;
    `;
    
    stats.forEach((stat, index) => {
      const statCard = document.createElement('div');
      statCard.style.cssText = `
        background: rgba(0, 0, 0, 0.3);
        padding: 1rem;
        border-radius: 8px;
        text-align: center;
        border: 1px solid rgba(138, 43, 226, 0.2);
        position: relative;
        overflow: visible;
        cursor: default;
      `;
      
      const valueEl = document.createElement('div');
      valueEl.textContent = stat.value.toString();
      
      // Assign different animation classes based on the stat type
      const animationClasses = ['stat-number-songs', 'stat-number-albums', 'stat-number-artists', 'stat-number-genres'];
      valueEl.className = animationClasses[index];
      
      valueEl.style.cssText = `
        font-size: 2rem;
        font-weight: bold;
        color: ${stat.color};
        margin-bottom: 0.5rem;
        position: relative;
      `;
      statCard.appendChild(valueEl);
      
      const labelEl = document.createElement('div');
      labelEl.textContent = stat.label;
      labelEl.style.cssText = `
        font-size: 1rem;
        color: #ccc;
        font-weight: 500;
      `;
      statCard.appendChild(labelEl);
      
      quickStats.appendChild(statCard);
    });
    
    statsContainer.appendChild(quickStats);
    
    // Top genres section - full width
    const genresContainer = document.createElement('div');
    genresContainer.style.cssText = `
      text-align: center;
    `;
    
    const genresTitle = document.createElement('h4');
    genresTitle.textContent = '🎵 Top Genres';
    genresTitle.style.cssText = `
      margin: 0 0 1rem 0;
      color: #8A2BE2;
      font-size: 1.2rem;
      text-align: center;
    `;
    genresContainer.appendChild(genresTitle);
    
    const genresList = document.createElement('div');
    genresList.style.cssText = `
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      justify-content: center;
    `;
    
    const sortedGenres = Object.entries(genres).sort(([,a], [,b]) => b - a).slice(0, 12);
    sortedGenres.forEach(([genre, count]) => {
      const genreTag = document.createElement('span');
      genreTag.textContent = `${genre} (${count})`;
      genreTag.style.cssText = `
        background: linear-gradient(135deg, rgba(29, 185, 84, 0.2), rgba(138, 43, 226, 0.2));
        color: #fff;
        padding: 0.3rem 0.8rem;
        border-radius: 15px;
        font-size: 0.8rem;
        border: 1px solid rgba(138, 43, 226, 0.3);
        white-space: nowrap;
      `;
      genresList.appendChild(genreTag);
    });
    
    genresContainer.appendChild(genresList);
    statsContainer.appendChild(genresContainer);
    
    statisticsSection.appendChild(statsContainer);
    libraryGridEl.appendChild(statisticsSection);
    
    // Get most played tracks from database
    const response = await musicAPI.getMostPlayedTracks(50);
    const tracks = response.data || [];
    
    if (tracks.length === 0) {
      const noDataDiv = document.createElement('div');
      noDataDiv.style.textAlign = 'center';
      noDataDiv.style.padding = '3rem';
      noDataDiv.style.color = '#666';
      noDataDiv.style.fontSize = '1.2rem';
      noDataDiv.innerHTML = 
        '<div style="font-size: 3rem; margin-bottom: 1rem;">🎵</div>' +
        `<div style="margin-bottom: 0.5rem;">${(typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.messages.noPlaysRecorded') : 'No plays recorded yet!'}</div>` +
        `<div style="font-size: 1rem; color: #888;">${(typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.labels.topHitsEmpty') : 'Spiele ein paar Songs ab, um hier die Top Hits zu sehen.'}</div>`;
      libraryGridEl.appendChild(noDataDiv);
      return;
    }
    
    // Statistics section
    const statsDiv = document.createElement('div');
    statsDiv.style.display = 'grid';
    statsDiv.style.gridTemplateColumns = '1fr 1fr 1fr';
    statsDiv.style.gap = '1rem';
    statsDiv.style.marginBottom = '2rem';
    
    // Total plays
    const totalPlays = tracks.reduce((sum, track) => sum + track.play_count, 0);
    const totalPlaysCard = document.createElement('div');
    totalPlaysCard.style.background = 'linear-gradient(135deg, #1DB954 0%, #1ed760 100%)';
    totalPlaysCard.style.color = '#000';
    totalPlaysCard.style.padding = '1.5rem';
    totalPlaysCard.style.borderRadius = '12px';
    totalPlaysCard.style.textAlign = 'center';
    totalPlaysCard.style.fontWeight = 'bold';
    totalPlaysCard.innerHTML = 
      '<div style="font-size: 2rem; margin-bottom: 0.5rem;">' + totalPlays.toLocaleString() + '</div>' +
      '<div style="font-size: 1rem;">' + ((typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.labels.totalPlays') : 'Gesamte Wiedergaben') + '</div>';
    statsDiv.appendChild(totalPlaysCard);
    
    // Unique tracks
    const uniqueTracksCard = document.createElement('div');
    uniqueTracksCard.style.background = 'linear-gradient(135deg, #8A2BE2 0%, #9A4AED 100%)';
    uniqueTracksCard.style.color = '#fff';
    uniqueTracksCard.style.padding = '1.5rem';
    uniqueTracksCard.style.borderRadius = '12px';
    uniqueTracksCard.style.textAlign = 'center';
    uniqueTracksCard.style.fontWeight = 'bold';
    uniqueTracksCard.innerHTML = 
      '<div style="font-size: 2rem; margin-bottom: 0.5rem;">' + tracks.length + '</div>' +
      '<div style="font-size: 1rem;">' + ((typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.labels.uniqueSongs') : 'Verschiedene Songs') + '</div>';
    statsDiv.appendChild(uniqueTracksCard);
    
    // Top track
    const topTrack = tracks[0];
    const topTrackCard = document.createElement('div');
    topTrackCard.style.background = 'linear-gradient(135deg, #FFD700 0%, #FFA500 100%)';
    topTrackCard.style.color = '#000';
    topTrackCard.style.padding = '1.5rem';
    topTrackCard.style.borderRadius = '12px';
    topTrackCard.style.textAlign = 'center';
    topTrackCard.style.fontWeight = 'bold';
    topTrackCard.innerHTML = 
      '<div style="font-size: 1.2rem; margin-bottom: 0.5rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">' + 
      (topTrack.title || ((typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.labels.unknown') : 'Unbekannt')) + '</div>' +
      '<div style="font-size: 0.9rem; margin-bottom: 0.3rem;">' + (topTrack.artist || ((typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.labels.unknown') : 'Unbekannt')) + '</div>' +
      '<div style="font-size: 1.5rem;">' + topTrack.play_count + ' ' + ((typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.labels.plays') : 'Plays') + '</div>';
    statsDiv.appendChild(topTrackCard);
    
    libraryGridEl.appendChild(statsDiv);
    
    // Tracks list with statistics styling
    const tracksContainer = document.createElement('div');
    tracksContainer.style.cssText = `
      padding: 1.5rem;
      background: linear-gradient(135deg, rgba(29, 185, 84, 0.15) 0%, rgba(138, 43, 226, 0.08) 100%);
      border-radius: 16px;
      border: 2px solid rgba(29, 185, 84, 0.4);
      overflow: hidden;
      position: relative;
    `;
    
    // Add tracks title in statistics style
    const tracksTitle = document.createElement('h3');
    const topHitsRankingText = (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.labels.topHitsRanking') : '🎵 Top Hits Ranking';
    tracksTitle.textContent = topHitsRankingText;
    tracksTitle.style.cssText = `
      margin: 0 0 1.5rem 0;
      color: #1DB954;
      font-size: 1.8rem;
      font-weight: bold;
      text-shadow: 0 0 15px rgba(29, 185, 84, 0.3);
    `;
    tracksContainer.appendChild(tracksTitle);
    
    // Table content container
    const tableContent = document.createElement('div');
    tableContent.style.cssText = `
      background: rgba(0, 0, 0, 0.2);
      border-radius: 12px;
      overflow: hidden;
      border: 1px solid rgba(29, 185, 84, 0.2);
    `;

    // Table header
    const headerRow = document.createElement('div');
    headerRow.style.display = 'grid';
    headerRow.style.gridTemplateColumns = '60px 60px 1fr 200px 80px';
    headerRow.style.gap = '1rem';
    headerRow.style.padding = '1rem';
    headerRow.style.background = 'rgba(29, 185, 84, 0.3)';
    headerRow.style.fontWeight = 'bold';
    headerRow.style.color = '#1DB954';
    headerRow.style.fontSize = '0.9rem';
    headerRow.innerHTML = 
      '<div style="text-align: center;">#</div>' +
      '<div style="text-align: center;"></div>' +
      '<div>' + ((typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.labels.song') : 'Song') + '</div>' +
      `<div>${(typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.labels.artist') : 'Artist'}</div>` +
      '<div style="text-align: center;">' + ((typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.labels.plays') : 'Plays') + '</div>';
    tableContent.appendChild(headerRow);
    
    // Track rows
    tracks.forEach((track, index) => {
      const row = document.createElement('div');
      row.style.display = 'grid';
      row.style.gridTemplateColumns = '60px 60px 1fr 200px 80px';
      row.style.gap = '1rem';
      row.style.padding = '1rem';
      row.style.borderBottom = '1px solid rgba(29, 185, 84, 0.2)';
      row.style.transition = 'background-color 0.2s';
      row.style.alignItems = 'center';
      
      if (index === tracks.length - 1) {
        row.style.borderBottom = 'none';
      }
      
      row.addEventListener('mouseenter', () => {
        row.style.backgroundColor = 'rgba(29, 185, 84, 0.2)';
      });
      row.addEventListener('mouseleave', () => {
        row.style.backgroundColor = 'transparent';
      });
      
      // Rank
      const rankEl = document.createElement('div');
      rankEl.textContent = (index + 1).toString();
      rankEl.style.textAlign = 'center';
      rankEl.style.fontWeight = 'bold';
      rankEl.style.color = index < 3 ? '#FFD700' : '#1DB954';
      rankEl.style.fontSize = index < 3 ? '1.2rem' : '1rem';
      row.appendChild(rankEl);
      
      // Cover
      const coverEl = document.createElement('div');
      coverEl.style.textAlign = 'center';
      const coverImg = document.createElement('img');
      coverImg.style.width = '40px';
      coverImg.style.height = '40px';
      coverImg.style.borderRadius = '4px';
      coverImg.style.objectFit = 'cover';
      
      // Try to get album cover
      const artistKey = (track.artist || 'unknown').toLowerCase();
      const albumKey = artistKey + '||' + (track.album || 'unknown').toLowerCase();
      coverImg.src = 'http://localhost:3001/api/album-cover/' + encodeURIComponent(albumKey);
      coverImg.onerror = () => {
        coverImg.style.display = 'none';
        const iconSpan = document.createElement('span');
        iconSpan.textContent = '🎵';
        iconSpan.style.fontSize = '1.5rem';
        iconSpan.style.color = '#8A2BE2';
        coverEl.appendChild(iconSpan);
      };
      coverEl.appendChild(coverImg);
      row.appendChild(coverEl);
      
      // Title
      const titleEl = document.createElement('div');
      titleEl.textContent = track.title || 'Unbekannt';
      titleEl.style.fontWeight = 'bold';
      titleEl.style.color = '#fff';
      titleEl.style.overflow = 'hidden';
      titleEl.style.textOverflow = 'ellipsis';
      titleEl.style.whiteSpace = 'nowrap';
      row.appendChild(titleEl);
      
      // Artist
      const artistEl = document.createElement('div');
      artistEl.textContent = track.artist || 'Unbekannt';
      artistEl.style.color = '#999';
      artistEl.style.overflow = 'hidden';
      artistEl.style.textOverflow = 'ellipsis';
      artistEl.style.whiteSpace = 'nowrap';
      row.appendChild(artistEl);
      
      // Play count
      const countEl = document.createElement('div');
      countEl.textContent = track.play_count.toString();
      countEl.style.textAlign = 'center';
      countEl.style.fontWeight = 'bold';
      countEl.style.color = '#1DB954';
      countEl.style.fontSize = '1.1rem';
      row.appendChild(countEl);
      
      tableContent.appendChild(row);
    });
    
    tracksContainer.appendChild(tableContent);
    libraryGridEl.appendChild(tracksContainer);
    
  } catch (error) {
    console.error('Error rendering most played tracks:', error);
    const errorTopHitsText = (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.messages.errorLoadingArtists') : 'Fehler beim Laden der meistgespielten Songs';
    libraryGridEl.innerHTML = `<div style="text-align: center; padding: 2rem; color: #666;">${errorTopHitsText}</div>`;
  }
}

function initializeAZNavigation() {
  const azNavButtons = document.getElementById('azNavButtons');
  if (!azNavButtons) return;
  
  azNavButtons.innerHTML = '';
  
  // Add "All" button at the top
  const allBtn = document.createElement('button');
  allBtn.className = 'az-btn active';
  allBtn.textContent = 'Alle';
  allBtn.dataset.letter = 'all';
  allBtn.addEventListener('click', handleAZClick);
  azNavButtons.appendChild(allBtn);

  // Add "0-9" button
  const numBtn = document.createElement('button');
  numBtn.className = 'az-btn';
  numBtn.textContent = '0-9';
  numBtn.dataset.letter = '0-9';
  numBtn.addEventListener('click', handleAZClick);
  azNavButtons.appendChild(numBtn);
  
  // Create A-Z buttons
  for (let i = 65; i <= 90; i++) {
    const letter = String.fromCharCode(i);
    const btn = document.createElement('button');
    btn.className = 'az-btn';
    btn.textContent = letter;
    btn.dataset.letter = letter;
    btn.addEventListener('click', handleAZClick);
    azNavButtons.appendChild(btn);
  }
}

// Function to control A-Z navigation visibility
function updateAZNavigationVisibility() {
  const azNav = document.getElementById('azNav');
  if (!azNav) return;
  
  // Hide A-Z navigation for 'new' filter (Recent Albums view), genres, decades, and most-played
  if (currentFilter === 'new' || currentFilter === 'genre' || currentFilter === 'decade' || currentFilter === 'most-played') {
    azNav.style.display = 'none';
  } else {
    azNav.style.display = 'flex';
  }
}

function handleAZClick(evt) {
  const azNavButtons = document.getElementById('azNavButtons');
  azNavButtons.querySelectorAll('.az-btn').forEach(btn => btn.classList.remove('active'));
  
  const btn = evt.currentTarget;
  btn.classList.add('active');
  
  const letter = btn.dataset.letter;
  currentAZFilter = letter; // Store current A-Z filter
  
  // Collapse now playing when using A-Z navigation
  handleNavigationActivity('a-z');
  
  // Apply A-Z filter based on current navigation level
  if (navigationState.level === 'artists') {
    // Fast client-side filtering instead of re-rendering
    applyAZFilterToArtists(letter);
  } else if (navigationState.level === 'albums') {
    renderAlbumsList(navigationState.currentArtist);
  } else if (navigationState.level === 'tracks') {
    renderTracksList(navigationState.currentArtist, navigationState.currentAlbum);
  } else if (navigationState.level === 'artists_in_genre') {
    // Handle A-Z filter in genre artists view
    renderGenreArtists(navigationState.currentGenre);
  } else if (navigationState.level === 'artists_in_decade') {
    // Handle A-Z filter in decade artists view
    renderDecadeArtists(navigationState.currentDecade, navigationState.currentDecadeTracks);
  } else if (currentFilter === 'album') {
    // Handle filtering in All Albums view
    renderAllAlbumsList();
  } else if (currentFilter === 'decade') {
    // Handle filtering in Decades view
    renderDecadesList();
  } else if (currentFilter === 'genre') {
    // Handle filtering in Genres view
    renderGenresList();
  } else {
    renderLibrary(); // Default behavior
  }
}

// Fast client-side A-Z filtering for artists (no re-rendering)
function applyAZFilterToArtists(letter) {
  const artistContainers = document.querySelectorAll('.artist-letter-section');
  
  artistContainers.forEach(container => {
    const letterHeader = container.querySelector('.letter-header');
    if (!letterHeader) return;
    
    const containerLetter = letterHeader.textContent.trim();
    
    if (letter === 'all') {
      container.style.display = 'block';
    } else if (letter === '0-9') {
      container.style.display = containerLetter === '0-9' ? 'block' : 'none';
    } else {
      container.style.display = containerLetter === letter ? 'block' : 'none';
    }
  });
  
  // Update "no results" display
  const visibleContainers = Array.from(artistContainers).filter(c => c.style.display !== 'none');
  const existingNoResults = document.querySelector('.no-artists-results');
  
  if (visibleContainers.length === 0) {
    if (!existingNoResults) {
      const noResultsDiv = document.createElement('div');
      noResultsDiv.className = 'no-artists-results';
      noResultsDiv.textContent = `No artists found for "${letter}"`;
      noResultsDiv.style.cssText = `
        padding: 2rem;
        text-align: center;
        color: #999;
      `;
      libraryListEl.appendChild(noResultsDiv);
    }
  } else {
    if (existingNoResults) {
      existingNoResults.remove();
    }
  }
}

function filterAndRenderLibrary(searchQuery) {
  if (!searchQuery || searchQuery.trim() === '') {
    renderLibrary();
    return;
  }
  
  const query = searchQuery.toLowerCase();
  const filteredTracks = library.filter(track => 
    track.title.toLowerCase().includes(query) ||
    track.artist.toLowerCase().includes(query) ||
    track.album.toLowerCase().includes(query) ||
    (track.genre && track.genre.toLowerCase().includes(query))
  );
  
  libraryListEl.innerHTML = '';
  filteredTracks.forEach(track => {
    const li = createTrackListItem(track);
    if (li) {
      libraryListEl.appendChild(li);
    }
  });
  
  debugLog('search', `[SEARCH] Filtered to ${filteredTracks.length} tracks`);
}

function createTrackListItem(track, source = 'local') {
  const li = document.createElement('li');
  li.className = 'track-item';
  li.style.cssText = `
    padding: 0.6rem;
    margin-bottom: 0.5rem;
    background-color: #1e1e1e;
    border-radius: 0.5rem;
    cursor: pointer;
    display: flex;
    align-items: center;
    transition: background-color 0.2s;
  `;
  
  // Add hover effect
  li.addEventListener('mouseenter', () => {
    li.style.backgroundColor = '#2a2a2a';
  });
  li.addEventListener('mouseleave', () => {
    li.style.backgroundColor = '#1e1e1e';
  });
  
  // Track image - improved cover handling
  let coverUrl = 'assets/default_cover.png';
  if (source === 'local' && track.cover_path) {
    coverUrl = musicAPI.getCoverURL(track.id);
  } else if (track.image || track.image_url) {
    coverUrl = track.image || track.image_url;
  } else if (source === 'local') {
    // Try to get album cover from data server
    const albumKey = `${track.artist}||${track.album}`;
    coverUrl = `http://localhost:3001/api/album-cover/${encodeURIComponent(albumKey)}`;
  }
  
  const img = document.createElement('img');
  img.src = coverUrl;
  img.className = 'track-cover-small';
  img.style.cssText = `
    width: 50px;
    height: 50px;
    object-fit: cover;
    margin-right: 0.75rem;
    border-radius: 6px;
    flex-shrink: 0;
    background: #2a2a2a;
  `;
  img.onerror = () => {
    img.style.display = 'none';
    const spanIcon = document.createElement('span');
    spanIcon.textContent = '🎵';
    spanIcon.style.cssText = `
      width: 50px;
      height: 50px;
      margin-right: 0.75rem;
      color: #1DB954;
      font-size: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #2a2a2a;
      border-radius: 6px;
      flex-shrink: 0;
    `;
    li.insertBefore(spanIcon, li.firstChild);
  };
  li.appendChild(img);
  
  // Track info container
  const infoDiv = document.createElement('div');
  infoDiv.style.cssText = `
    flex: 1;
    display: flex;
    flex-direction: column;
  `;
  
  // Track title
  const titleSpan = document.createElement('span');
  titleSpan.textContent = track.title || track.name;
  titleSpan.style.cssText = `
    color: white;
    font-weight: 500;
    margin-bottom: 2px;
  `;
  infoDiv.appendChild(titleSpan);
  
  // Track artist
  const artistSpan = document.createElement('span');
  artistSpan.textContent = track.artist;
  artistSpan.style.cssText = `
    color: #b3b3b3;
    font-size: 0.9em;
  `;
  infoDiv.appendChild(artistSpan);
  
  li.appendChild(infoDiv);
  
  // Add source badge for Spotify tracks
  if (source === 'spotify' || track.spotify_id || track.spotify_uri) {
    const badge = document.createElement('span');
    badge.textContent = '🌐';
    badge.style.cssText = `
      color: #1DB954;
      padding: 2px 6px;
      border-radius: 10px;
      font-size: 0.7em;
      margin-left: 0.5rem;
    `;
    li.appendChild(badge);
  }
  
  // Add click handlers
  li.addEventListener('click', () => {
    if (source === 'spotify' || track.spotify_id || track.spotify_uri) {
      const uri = track.spotify_uri || track.uri;
      if (uri) {
        playSpotifyTrack(uri);
      }
    } else {
      if (track.id) {
        // For local tracks: Add to queue instead of playing directly
        queueTrack(track.id);
        toast.success(`"${track.title}" ${(typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.labels.trackAddedToPlaylist') : 'added to playlist'}`);
      }
    }
  });
  
  return li;
}

function renderAllTracks() {
  libraryListEl.innerHTML = '';
  let filtered = library;
  
  // Apply A-Z filter if set
  if (currentAZFilter && currentAZFilter !== 'all') {
    filtered = library.filter((item) => 
      item.title.charAt(0).toUpperCase() === currentAZFilter
    );
  }
  
  filtered.forEach((item) => renderTrackItem(item));
}

function renderTrackItem(item) {
  const li = document.createElement('li');
  const isRecent = isTrackRecentlyPlayed(item);
  const isInQueue = isTrackInQueue(item);
  
  if (item.image) { 
    const img = document.createElement('img'); 
    img.src = item.image; 
    img.style.width = '40px'; 
    img.style.height = '40px'; 
    img.style.objectFit = 'cover'; 
    img.style.marginRight = '0.5rem'; 
    li.appendChild(img);
  } else { 
    const spanIcon = document.createElement('span'); 
    spanIcon.textContent = '🎵'; 
    spanIcon.style.marginRight = '0.5rem'; 
    spanIcon.style.color = '#1DB954'; 
    li.appendChild(spanIcon);
  } 
  
  const spanTitle = document.createElement('span'); 
  spanTitle.textContent = item.title; 
  li.appendChild(spanTitle);
  
  li.style.padding = '0.6rem'; 
  li.style.marginBottom = '0.5rem'; 
  li.style.backgroundColor = '#1e1e1e'; 
  li.style.borderRadius = '0.4rem'; 
  li.style.display = 'flex'; 
  li.style.alignItems = 'center'; 
  li.style.cursor = 'pointer';
  const currentAdminMode = window.adminPanel && window.adminPanel.isAdminMode ? window.adminPanel.isAdminMode() : false;
  
  if ((isRecent || isInQueue) && !currentAdminMode) {
    li.classList.add('disabled');
    li.style.backgroundColor = '#151515';
    li.style.color = '#666';
    li.style.cursor = 'not-allowed';
    li.addEventListener('click', (e) => {
      e.preventDefault();
      if (isInQueue) {
        alert((typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.messages.trackAlreadyInQueue') : 'This track is already in the playlist.');
      } else if (isRecent) {
        const now = Date.now();
        const oneHour = 60 * 60 * 1000;
        const playEntry = playedTracks.find(played => 
          (played.uri === (item.uri || null)) || (played.path === (item.path || null))
        );
        if (playEntry) {
          const remainingTime = Math.ceil((oneHour - (now - playEntry.timestamp)) / (60 * 1000));
          alert(`This track was recently played. Please wait ${remainingTime} more minutes.`);
        }
      }
    });
  } else {
    li.addEventListener('click', () => addToQueue(item));
  }
  
  libraryListEl.appendChild(li);
}

function renderLibraryFiltered(letter) {
  const filter = currentFilter;
  if (currentView === 'cover') {
    return renderCoverViewFiltered(filter, letter);
  }
  
  libraryGridEl.classList.add('hidden');
  libraryListEl.classList.remove('hidden');
  
  if (filter === 'artist' || filter === 'album' || filter === 'genre') {
    return renderLibraryByGroupFiltered(filter, letter);
  }
}

function renderLibraryByGroupFiltered(field, letter) {
  libraryListEl.innerHTML = '';
  const groups = {};
  
  library.forEach((item) => {
    const value = item[field] || 'Unbekannt';
    if (letter === 'all' || value.charAt(0).toUpperCase() === letter) {
      if (!groups[value]) groups[value] = [];
      groups[value].push(item);
    }
  });
  
  Object.keys(groups).sort().forEach((groupName) => {
    const details = document.createElement('details');
    details.open = true;
    const summary = document.createElement('summary');
    summary.textContent = `${groupName} (${groups[groupName].length})`;
    summary.style.padding = '0.5rem';
    summary.style.backgroundColor = '#2a2a2a';
    summary.style.borderRadius = '0.3rem';
    summary.style.marginBottom = '0.5rem';
    summary.style.cursor = 'pointer';
    details.appendChild(summary);
    
    const ul = document.createElement('ul');
    ul.style.listStyle = 'none';
    ul.style.padding = '0';
    ul.style.margin = '0.5rem 0';
    
    groups[groupName].forEach((item) => {
      const li = document.createElement('li');
      const isRecent = isTrackRecentlyPlayed(item);
      const isInQueue = isTrackInQueue(item);
      
      if (item.image) {
        const img = document.createElement('img');
        img.src = item.image;
        img.style.width = '40px';
        img.style.height = '40px';
        img.style.objectFit = 'cover';
        img.style.marginRight = '0.5rem';
        li.appendChild(img);
      } else {
        const spanIcon = document.createElement('span');
        spanIcon.textContent = '🎵';
        spanIcon.style.marginRight = '0.5rem';
        spanIcon.style.color = '#1DB954';
        li.appendChild(spanIcon);
      }
      
      const spanTitle = document.createElement('span');
      spanTitle.textContent = item.title;
      li.appendChild(spanTitle);
      
      li.style.padding = '0.6rem';
      li.style.marginBottom = '0.5rem';
      li.style.backgroundColor = '#1e1e1e';
      li.style.borderRadius = '0.4rem';
      li.style.display = 'flex';
      li.style.alignItems = 'center';
      li.style.cursor = 'pointer';
      const currentAdminModeLocal = window.adminPanel && window.adminPanel.isAdminMode ? window.adminPanel.isAdminMode() : false;
      
      if ((isRecent || isInQueue) && !currentAdminModeLocal) {
        li.classList.add('disabled');
        li.style.backgroundColor = '#151515';
        li.style.color = '#666';
        li.style.cursor = 'not-allowed';
        li.addEventListener('click', (e) => {
          e.preventDefault();
          if (isInQueue) {
            alert((typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.messages.trackAlreadyInQueue') : 'This track is already in the playlist.');
          } else if (isRecent) {
            const now = Date.now();
            const oneHour = 60 * 60 * 1000;
            const playEntry = playedTracks.find(played => 
              (played.uri === (item.uri || null)) || (played.path === (item.path || null))
            );
            if (playEntry) {
              const remainingTime = Math.ceil((oneHour - (now - playEntry.timestamp)) / (60 * 1000));
              alert(`This track was recently played. Please wait ${remainingTime} more minutes.`);
            }
          }
        });
      } else {
        li.addEventListener('click', () => addToQueue(item));
      }
      
      ul.appendChild(li);
    });
    
    details.appendChild(ul);
    libraryListEl.appendChild(details);
  });
}

function renderCoverViewFiltered(filter, letter) {
  libraryListEl.classList.add('hidden');
  libraryGridEl.classList.remove('hidden');
  libraryGridEl.innerHTML = '';
  
  let filtered = library;
  if (letter !== 'all') {
    const field = filter === 'all' ? 'title' : filter;
    filtered = library.filter((item) => {
      const value = item[field] || item.title || '';
      return value.charAt(0).toUpperCase() === letter;
    });
  }
  
  filtered.forEach((item) => {
    const card = document.createElement('div');
    card.className = 'card';
    const img = document.createElement('img');
    img.src = item.image || 'assets/default_cover.png';
    card.appendChild(img);
    const titleEl = document.createElement('div');
    titleEl.className = 'card-title';
    titleEl.textContent = item.title;
    card.appendChild(titleEl);
    card.addEventListener('click', () => addToQueue(item));
    libraryGridEl.appendChild(card);
  });
}

function handleNavClick(evt) {
  sideNav.querySelectorAll('.nav-tile').forEach((btn)=>btn.classList.remove('active'));
  const btn=evt.currentTarget; 
  btn.classList.add('active'); 
  currentFilter=btn.dataset.filter; 
  
  // Collapse now playing when navigating
  handleNavigationActivity('menu');
  
  // Reset navigation state for new filter
  navigationState.level = 'root';
  navigationState.currentArtist = null;
  navigationState.currentAlbum = null;
  navigationState.currentFilter = currentFilter;
  
  // Update A-Z navigation visibility
  updateAZNavigationVisibility();
  
  // Handle hierarchical navigation with proper render functions
  switch (currentFilter) {
    case 'artist':
      renderArtistsList();
      break;
    case 'album':
      renderAllAlbumsList();
      break;
    case 'genre':
      renderGenresList();
      break;
    case 'decade':
      renderDecadesList();
      break;
    case 'new':
      renderRecentAlbums();
      break;
    case 'most-played':
      renderMostPlayedTracks();
      break;
    default:
      renderLibrary();
      break;
  }
  
  updateBreadcrumb();
  saveAppState(); // Save state after filter change
}
function handleViewClick(evt){ viewSwitchEl.querySelectorAll('.view-btn').forEach((b)=>b.classList.remove('active')); const btn=evt.currentTarget; btn.classList.add('active'); currentView=btn.dataset.view; renderLibrary(); }

// Playlist display configuration
const MAX_VISIBLE_TRACKS = 50; // Maximum tracks to show initially
let showAllTracks = false;

// UI Update Debouncing to prevent flickering
let updateNowPlayingTimeout = null;

// addToQueueForAutoDj function moved to js/playlists.js
let isAddingToQueue = false; // Flag to prevent navigation activity during addToQueue

// Queue manipulation functions moved to js/queue_api.js
// Use window.addToQueue(), window.removeFromQueue(), window.insertNext(), window.enforceQueueConsistency()

// clearPlaylist function moved to js/playlists.js
// playCurrentTrack moved to js/audio.js

function skipTrack(){ 
  debugLog('queue', `[SKIP] skipTrack called. Current index: ${currentTrackIndex}, Queue length: ${queue.length}`);
  
  // If we're already at the end of the queue (-1), don't do anything
  if (currentTrackIndex === -1) {
    debugLog('queue', '[SKIP] Already at end of queue - no action taken');
    return;
  }
  
  // Prevent UI flickering by temporarily disabling updates
  const wasUpdating = updateQueueTimeout !== null || updateNowPlayingTimeout !== null;
  if (wasUpdating) {
    debugLog('queue', '[SKIP] Clearing pending UI updates to prevent flickering');
    if (updateQueueTimeout) clearTimeout(updateQueueTimeout);
    if (updateNowPlayingTimeout) clearTimeout(updateNowPlayingTimeout);
  }
  
  // Record play statistics for the current track before skipping
  if (currentTrackIndex >= 0 && currentTrackIndex < queue.length) {
    const currentTrack = queue[currentTrackIndex];
    if (currentTrack) {
      // Determine if it's a Spotify or local track
      const isSpotifyTrack = currentTrack.uri && currentTrack.uri.startsWith('spotify:track:');
      recordTrackPlayStatistics(currentTrack, isSpotifyTrack ? 'spotify' : 'local');
    }
  }
  
  if (currentTrackIndex >= 0 && currentTrackIndex < queue.length) {
    // Don't remove the track from queue, just move to next
    debugLog('queue', `[SKIP] Moving to next track. Current: ${currentTrackIndex}, Queue length: ${queue.length}`);
    
    // Check if there are more tracks to play
    if (currentTrackIndex + 1 < queue.length) {
      // Move to next track
      currentTrackIndex++;
      debugLog('queue', `[SKIP] Playing next track at index: ${currentTrackIndex}`);
      saveAppState(); // Save state after index change
      playCurrentTrack(); 
    } else {
      // We're at the end of the queue
      debugLog('queue', `[SKIP] Reached end of queue - clearing queue completely`);
      currentTrackIndex = -1;
      queue.length = 0; // Clear the queue completely
      debugLog('queue', `[SKIP] Queue cleared, length now: ${queue.length}`);
      saveAppState(); // Save state when queue ends 
      
      // Use centralized stop function
      stopAllPlayback();
      
      // Clear footer when queue ends
      const footerInfoEl = document.getElementById('nowPlayingInfo');
      if (footerInfoEl) {
        footerInfoEl.innerHTML = `<div id="nowPlayingTitle"></div>
          <div id="footerProgressContainer">
            <span id="currentTime">0:00</span>
            <div id="footerProgressBar">
              <div id="footerProgressFill"></div>
            </div>
            <span id="totalTime">0:00</span>
          </div>`;
      }
      
      coverImageEl.src = 'assets/default_cover.png'; 
      nowPlayingCoverEl.src = 'assets/default_cover.png';
      
      // Clear the large now playing section elements
      const nowPlayingTitle = document.getElementById('nowPlayingTitle');
      const nowPlayingArtist = document.getElementById('nowPlayingArtist');
      const nowPlayingAlbum = document.getElementById('nowPlayingAlbum');
      
      if (nowPlayingTitle) nowPlayingTitle.textContent = '';
      if (nowPlayingArtist) nowPlayingArtist.textContent = '';
      if (nowPlayingAlbum) nowPlayingAlbum.textContent = '';
      
      // Hide the now playing section when queue is empty with smooth animation
      const nowPlayingSection = document.getElementById('nowPlayingSection');
      if (nowPlayingSection) {
        nowPlayingSection.classList.add('collapsed');
        nowPlayingSection.classList.remove('expanded');
        
        // After animation completes, set display none (only if queue is still empty)
        setTimeout(() => {
          // Double-check that we should still hide the panel
          if (queue.length === 0 || currentTrackIndex === -1) {
            nowPlayingSection.style.display = 'none';
          } else {
            debugLog('UI', 'Cancelled nowPlayingSection hide - queue has tracks');
          }
        }, 500); // Match the CSS transition duration
      }
      
      // Switch to search mode automatically
      const content = document.getElementById('content');
      if (content) {
        content.classList.add('search-mode');
        content.classList.remove('now-playing-mode');
      }
      
      // Stop 3D rotation animations
      stop3DRotations();
      
      debouncedUpdateQueueDisplay(); 
    }
  }
}

// Record track play statistics in database
async function recordTrackPlayStatistics(track, source = 'local') {
  try {
    // Record basic play statistics (existing functionality)
    if (source === 'spotify' && track.id) {
      // Prepare track data for potential auto-adding
      const trackData = {
        title: track.name || track.title || 'Unknown Title',
        artist: track.artists ? track.artists.map(a => a.name || a).join(', ') : (track.artist || 'Unknown Artist'),
        album: track.album?.name || track.album || '',
        duration_ms: track.duration_ms || track.duration || 0,
        external_url: track.external_urls?.spotify || null,
        image_url: track.album?.images?.[0]?.url || track.image || null,
        popularity: track.popularity || 0
      };
      
      await musicAPI.recordSpotifyPlay(track.id, trackData);
      debugLog('stats', `[STATS] Recorded Spotify play for: ${track.name || track.title}`);
    } else if (source === 'local' && track.id) {
      await musicAPI.recordTrackPlay(track.id);
      debugLog('stats', `[STATS] Recorded local play for: ${track.title}`);
    }
    
    // Add track to local playedTracks array for duplicate prevention
    const trackKey = source === 'spotify' ? track.uri || `spotify:track:${track.id}` : track.path || track.file_path || track.url;
    if (trackKey) {
      const playEntry = {
        uri: source === 'spotify' ? (track.uri || `spotify:track:${track.id}`) : undefined,
        path: source === 'local' ? (track.path || track.file_path || track.url) : undefined,
        title: track.title || track.name || 'Unknown',
        artist: track.artist || 'Unknown Artist',
        timestamp: Date.now()
      };
      
      playedTracks.push(playEntry);
      
      // Keep only tracks from last hour to prevent memory issues
      playedTracks = playedTracks.filter(played => {
        const age = Date.now() - played.timestamp;
        return age < (60 * 60 * 1000);
      });
      
      debugLog('STATS', `Track added to playedTracks: ${playEntry.title} (${playedTracks.length} total)`);
    }
    
    // Record detailed play history for GEMA reporting
    try {
      await recordDetailedPlayHistory(track, source);
    } catch (historyError) {
      console.warn('Failed to record detailed play history:', historyError);
      // Don't fail the main function if detailed history fails
    }
    
  } catch (error) {
    if (error.message.includes('404') && source === 'spotify') {
      console.warn(`[STATS] Spotify track not in local database: ${track.name || track.title} - skipping statistics`);
    } else {
      console.warn('Failed to record play statistics:', error);
    }
  }
}

// Record detailed play history for GEMA reporting
async function recordDetailedPlayHistory(track, source = 'local') {
  try {
    const historyData = {
      id: track.id,
      spotify_id: source === 'spotify' ? (track.id || track.spotify_id) : null,
      title: track.title || track.name || 'Unknown Title',
      artist: track.artist || 'Unknown Artist',
      album: track.album || ''
    };
    
    const response = await fetch(getAPIURL('/api/play-history'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        trackData: historyData,
        source: source
      })
    });
    
    if (response.ok) {
      const result = await response.json();
      debugLog('REPORTING', `Play history recorded: ${historyData.artist} - ${historyData.title} (${source})`);
    } else {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
  } catch (error) {
    console.warn('[REPORTING] Failed to record detailed play history:', error);
    // This is non-critical, so we just log the warning
  }
}

function initSpotifyPlayer() {
  // This function exists for legacy compatibility but delegates to spotify.js module
  // We need to call the spotify module's initSpotifyPlayer function directly
  debugLog('ui', '[DEBUG] jukebox.js initSpotifyPlayer called - delegating to spotify.js module');
  
  // Call the spotify.js module function directly without recursion
  if (typeof initializeSpotifyPlayerInternal !== 'undefined') {
    initializeSpotifyPlayerInternal();
  } else if (window.Spotify && window.spotifyAccessToken) {
    // Fallback: call the SDK ready callback directly
    if (typeof debugLog !== 'undefined') {
      debugLog('SPOTIFY', 'Fallback: calling SDK ready callback directly');
    }
    window.onSpotifyWebPlaybackSDKReady();
  } else {
    console.warn('[DEBUG] Spotify SDK or token not available for player initialization');
  }
}

// Handle external track changes (when track is skipped from another Spotify device)
function updateUIForExternalTrackChange(track, spotifyState) {
  debugLog('[DEBUG] Updating UI for external track change:', track.title);
  debugLog('[DEBUG] External change - currentTrackIndex:', currentTrackIndex, 'queue.length:', queue.length);
  
  if (!track) return;
  
  // Update footer display
  let footerText = '';
  let footerArtist = track.artist || '';
  let footerTitle = track.title;
  
  if (track.type === 'spotify' && track.title.includes(' – ')) {
    const parts = track.title.split(' – ');
    footerTitle = parts[0];
    if (parts.length > 1 && !footerArtist) {
      footerArtist = parts[1];
    }
  }
  
  if (footerArtist && footerArtist !== '') {
    footerText = `${footerArtist} - ${footerTitle}`;
  } else {
    footerText = footerTitle;
  }
  
  const footerInfoEl = document.getElementById('nowPlayingInfo');
  if (footerInfoEl) {
    footerInfoEl.innerHTML = `<div id="nowPlayingTitle" style="color: #e5e5e5; display: block; font-size: 1rem;">${footerText}</div>
        <div id="footerProgressContainer">
          <span id="currentTime">0:00</span>
          <div id="footerProgressBar">
            <div id="footerProgressFill"></div>
          </div>
          <span id="totalTime">0:00</span>
        </div>`;
  }
  
  // Update cover images with optimization
  const coverUrl = updateNowPlayingCover(track);
  
  // Update large now playing section
  let cleanTitle = track.title;
  let artist = track.artist || '';
  let album = track.album || '';
  
  if (track.type === 'spotify' && track.title.includes(' – ')) {
    const parts = track.title.split(' – ');
    cleanTitle = parts[0];
    if (parts.length > 1 && !artist) {
      artist = parts[1];
    }
  }
  
  const nowPlayingTitle = document.getElementById('nowPlayingTitle');
  const nowPlayingArtist = document.getElementById('nowPlayingArtist');
  const nowPlayingAlbum = document.getElementById('nowPlayingAlbum');
  
  if (nowPlayingTitle) nowPlayingTitle.textContent = cleanTitle;
  if (nowPlayingArtist) nowPlayingArtist.textContent = artist;
  if (nowPlayingAlbum) nowPlayingAlbum.textContent = album;
  
  // Update queue display to highlight current track
  debouncedUpdateQueueDisplay();
  
  // Update track duration if available from Spotify state
  if (spotifyState && spotifyState.duration > 0) {
    setTrackDuration(spotifyState.duration / 1000);
    updateProgressDisplay(spotifyState.position / 1000, spotifyState.duration / 1000);
  }
  
  // Extract colors for background if we have a new image
  if (coverUrl !== 'assets/default_cover.png') {
    extractColorsFromImage(coverUrl, (colors) => {
      updateNowPlayingBackground(colors);
    });
  }
  
  debugLog('[DEBUG] UI updated for external track change to:', cleanTitle);
}

function debugSpotifyState() {
  debugLog('[DEBUG] === Spotify-Zustand ===');
  debugLog('[DEBUG] spotifyAccessToken:', !!window.spotifyAccessToken);
  debugLog('[DEBUG] spotifyTokenExpiry:', window.spotifyTokenExpiry);
  debugLog('[DEBUG] spotifyPlayer:', !!window.spotifyPlayer);
  debugLog('[DEBUG] spotifyDeviceId:', window.spotifyDeviceId);
  debugLog('[DEBUG] sessionStorage token:', !!sessionStorage.getItem('spotify_access_token'));
  debugLog('[DEBUG] localStorage token (fallback):', !!localStorage.getItem('spotify_access_token'));
  if (window.sessionAPI) {
    debugLog('[DEBUG] sessionAPI available for database tokens');
  }
  debugLog('[DEBUG] ========================');
}

async function playSpotifyTrack(uri){
  debugSpotifyState(); // Debug current state
  
  // Get token and device info from spotify.js module globals
  const accessToken = window.spotifyAccessToken || sessionStorage.getItem('spotify_access_token') || localStorage.getItem('spotify_access_token');
  const deviceId = window.spotifyDeviceId;
  
  if (!accessToken || !deviceId) { 
    console.error('[DEBUG] Spotify playback not possible - Token:', !!accessToken, 'Device:', !!deviceId);
    
    // If we have a token but no device, try to initialize player via spotify.js
    if (accessToken && !deviceId) {
      debugLog('[DEBUG] Token available but no device - trying player initialization via spotify.js');
      
      // Call the internal spotify function directly to avoid recursion
      if (typeof window.initializeSpotifyPlayerInternal === 'function') {
        window.initializeSpotifyPlayerInternal();
      } else if (window.Spotify && window.spotifyAccessToken) {
        // Fallback: call the SDK ready callback directly
        window.onSpotifyWebPlaybackSDKReady();
      }
      
      // Wait a bit and try again
      setTimeout(() => {
        if (window.spotifyDeviceId) {
          debugLog('[DEBUG] Device now available, trying to play again');
          playSpotifyTrack(uri);
        }
      }, 3000);
    }
    
    // Silent return, status icon shows connection state
    debugLog('SPOTIFY', 'Spotify-Verbindung wird initialisiert...');
    return; 
  }
  
  debugLog('[DEBUG] Spiele Spotify-Track ab:', uri);
  try {
    const res = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`, {
      method:'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
      body: JSON.stringify({ uris: [uri] })
    });
    if (!res.ok) { 
      const t=await res.text(); 
      console.error('[DEBUG] Spotify-Play fehlgeschlagen:', res.status, t); 
      alert('Spotify-Playback-Fehler: '+res.status+'\n'+t); 
      window.isSpotifyCurrentlyPlaying = false; // Status setzen bei Fehler
    } else {
      debugLog('[DEBUG] Spotify-Track erfolgreich gestartet');
      window.isSpotifyCurrentlyPlaying = true; // Status setzen bei erfolgreichem Start
      
      // Start Spotify progress updates
      if (typeof startSpotifyProgressUpdates === 'function') {
        startSpotifyProgressUpdates();
      }
    }
  } catch(e){ 
    console.error('[DEBUG] Spotify-Play Exception:', e); 
    window.isSpotifyCurrentlyPlaying = false; // Status setzen bei Exception
  }
}

function startSpotifyLogin() {
  debugLog('[DEBUG] Spotify-Login wird als Popup gestartet');
  openSpotifyLoginPopup();
}

function openSpotifyLoginPopup() {
  // Open Spotify login in a new popup window (not iframe due to X-Frame-Options)
  const popup = window.open(
    'spotify_login.html',
    'spotify_login',
    'width=600,height=700,scrollbars=yes,resizable=yes,left=' + 
    Math.round((screen.width - 600) / 2) + ',top=' + 
    Math.round((screen.height - 700) / 2)
  );
  
  if (!popup) {
    alert('Popup wurde blockiert! Bitte erlauben Sie Popups für diese Seite und versuchen Sie es erneut.');
    return;
  }
  
  debugLog('SPOTIFY', 'Popup opened, waiting for login completion...');
  
  // Listen for successful login message from popup
  const messageListener = function(event) {
    debugLog('SPOTIFY', 'Received message from popup:', event.data);
    
    if (event.data && event.data.type === 'spotify_login_success') {
      debugLog('SPOTIFY', 'Login successful in popup, processing token...');
      
      // Store the tokens in the MAIN WINDOW's sessionStorage (not popup's)
      if (event.data.token) {
        sessionStorage.setItem('spotify_access_token', event.data.token);
        debugLog('SPOTIFY', 'Access token stored in main window sessionStorage');
      }
      
      if (event.data.refresh_token) {
        sessionStorage.setItem('spotify_refresh_token', event.data.refresh_token);
        debugLog('SPOTIFY', 'Refresh token stored in main window sessionStorage');
      }
      
      if (event.data.expires_in) {
        const expiryTime = Date.now() + (event.data.expires_in * 1000);
        sessionStorage.setItem('spotify_token_expiry', expiryTime.toString());
        debugLog('SPOTIFY', 'Token expiry stored in main window sessionStorage');
      }
      
      popup.close();
      window.removeEventListener('message', messageListener);
      
      // Don't reload the page, instead trigger the same logic as normal Spotify login
      debugLog('SPOTIFY', 'Attempting to reconnect with stored token...');
      
      // Re-attempt auto-connect with the new token
      setTimeout(() => {
        autoConnectSpotify().then(success => {
          if (success) {
            debugLog('SPOTIFY', 'Auto-connect successful after popup login');
            
            // Start automatic token refresh interval
            if (typeof startSpotifyTokenRefreshInterval === 'function') {
              startSpotifyTokenRefreshInterval();
            }
            
            // Update UI to show Spotify connection
            updateSpotifyUI();
          } else {
            debugLog('SPOTIFY', 'Auto-connect failed even with new token - trying direct initialization');
            // Fallback: directly call Spotify initialization
            initializeSpotifyConnection();
          }
        });
      }, 500);
    }
  };
  
  window.addEventListener('message', messageListener);
  
  // Check if popup was closed manually (without successful login)
  const popupChecker = setInterval(() => {
    if (popup.closed) {
      clearInterval(popupChecker);
      window.removeEventListener('message', messageListener);
      debugLog('SPOTIFY', 'Popup was closed manually');
    }
  }, 1000);
}

// Update UI after successful Spotify connection
function updateSpotifyUI() {
  // Disable and update Spotify login button instead of hiding it
  const loginBtn = document.getElementById('spotifyLoginBtn');
  if (loginBtn) {
    loginBtn.disabled = true;
    loginBtn.style.cursor = 'not-allowed';
    loginBtn.style.opacity = '0.6';
    loginBtn.innerHTML = '✅ Mit Spotify verbunden';
    loginBtn.style.backgroundColor = '#1db954';
  }
  
  // Show success message or update status
  const spotifyStatus = document.querySelector('.spotify-status');
  if (spotifyStatus) {
    spotifyStatus.textContent = '✅ Spotify verbunden';
    spotifyStatus.style.color = '#1db954';
  }
  
  // Update any other Spotify-related UI elements
  debugLog('SPOTIFY', 'UI updated to reflect Spotify connection');
}

// Direct Spotify connection initialization as fallback
function initializeSpotifyConnection() {
  const accessToken = sessionStorage.getItem('spotify_access_token');
  if (!accessToken) {
    debugLog('SPOTIFY', 'No access token found for direct initialization');
    return;
  }
  
  debugLog('SPOTIFY', 'Attempting direct Spotify connection initialization...');
  
  // Manually set the Spotify connection status
  window.isSpotifyConnected = true;
  
  // Update UI to show connection
  updateSpotifyUI();
  
  // Test the connection with a simple API call
  fetch('https://api.spotify.com/v1/me', {
    headers: {
      'Authorization': `Bearer ${accessToken}`
    }
  })
  .then(response => {
    if (response.ok) {
      debugLog('SPOTIFY', 'Direct connection test successful');
      return response.json();
    } else {
      throw new Error(`API test failed: ${response.status}`);
    }
  })
  .then(userData => {
    debugLog('SPOTIFY', 'Spotify user connected:', userData.display_name);
    // Further UI updates if needed
  })
  .catch(error => {
    debugLog('SPOTIFY', 'Direct connection test failed:', error);
  });
}

// Automatic Spotify token refresh
async function refreshSpotifyToken() {
  // Try to get refresh token from multiple sources
  let refreshToken = sessionStorage.getItem('spotify_refresh_token') || localStorage.getItem('spotify_refresh_token');
  
  // If not in storage, try to load from database
  if (!refreshToken && window.sessionAPI) {
    try {
      const tokens = await window.sessionAPI.getSpotifyTokens();
      if (tokens && tokens.refresh_token) {
        refreshToken = tokens.refresh_token;
        debugLog('SPOTIFY', 'Loaded refresh token from database');
      }
    } catch (error) {
      debugLog('SPOTIFY', 'Failed to load refresh token from database:', error);
    }
  }
  
  if (!refreshToken) {
    debugLog('SPOTIFY', 'No refresh token available - manual login required');
    return false;
  }

  try {
    debugLog('SPOTIFY', 'Refreshing access token...');
    
    // Load current Client ID from settings
    const currentClientId = await loadSpotifyClientId();
    
    if (!currentClientId) {
      debugLog('SPOTIFY', 'Cannot refresh token: No Client ID configured');
      return false;
    }
    
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: currentClientId
    });

    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });

    const data = await response.json();
    if (data.access_token) {
      // Store new access token via spotify.js module
      if (typeof window.saveSpotifyTokenToStorage === 'function') {
        await window.saveSpotifyTokenToStorage(data.access_token, data.expires_in || 3600, data.refresh_token || refreshToken);
      } else {
        // Fallback to direct storage if spotify.js not available
        sessionStorage.setItem('spotify_access_token', data.access_token);
        localStorage.setItem('spotify_access_token', data.access_token);
        
        // Store new expiry time
        const expiryTime = Date.now() + ((data.expires_in || 3600) * 1000);
        sessionStorage.setItem('spotify_token_expiry', expiryTime.toString());
        localStorage.setItem('spotify_token_expiry', expiryTime.toString());
        
        // Update refresh token if new one provided
        if (data.refresh_token) {
          sessionStorage.setItem('spotify_refresh_token', data.refresh_token);
          localStorage.setItem('spotify_refresh_token', data.refresh_token);
        }
      }
      
      // Update window.spotifyAccessToken
      window.spotifyAccessToken = data.access_token;

      debugLog('SPOTIFY', `✅ Token refreshed successfully, expires in ${data.expires_in || 3600} seconds`);
      updateSpotifyStatusUI(); // Update UI to show new expiry time
      return true;
    } else {
      debugLog('SPOTIFY', '❌ Token refresh failed:', data.error_description || data.error);
      return false;
    }
  } catch (error) {
    debugLog('SPOTIFY', '❌ Token refresh error:', error.message);
    return false;
  }
}

// Check if token needs refresh and refresh automatically
async function checkAndRefreshSpotifyToken() {
  const tokenExpiry = sessionStorage.getItem('spotify_token_expiry') || localStorage.getItem('spotify_token_expiry');
  if (!tokenExpiry) {
    debugLog('SPOTIFY', 'No token expiry found, skipping refresh check');
    return false;
  }

  const expiryTime = parseInt(tokenExpiry);
  const now = Date.now();
  const timeUntilExpiry = expiryTime - now;
  
  // Refresh token if it expires in less than 10 minutes (600000ms)
  if (timeUntilExpiry < 600000) {
    debugLog('SPOTIFY', `⏰ Token expires in ${Math.round(timeUntilExpiry/60000)} minutes, refreshing...`);
    return await refreshSpotifyToken();
  }
  
  debugLog('SPOTIFY', `✅ Token still valid for ${Math.round(timeUntilExpiry/60000)} minutes`);
  return true; // Token is still valid
}

// Start automatic token refresh interval (check every 5 minutes)
let spotifyTokenRefreshInterval = null;

function startSpotifyTokenRefreshInterval() {
  // Clear any existing interval
  if (spotifyTokenRefreshInterval) {
    clearInterval(spotifyTokenRefreshInterval);
  }
  
  // Check immediately on start
  checkAndRefreshSpotifyToken();
  
  // Then check every 5 minutes
  spotifyTokenRefreshInterval = setInterval(async () => {
    debugLog('SPOTIFY', '🔄 Periodic token refresh check...');
    await checkAndRefreshSpotifyToken();
  }, 5 * 60 * 1000); // 5 minutes
  
  debugLog('SPOTIFY', '✅ Automatic token refresh interval started (every 5 minutes)');
}

function stopSpotifyTokenRefreshInterval() {
  if (spotifyTokenRefreshInterval) {
    clearInterval(spotifyTokenRefreshInterval);
    spotifyTokenRefreshInterval = null;
    debugLog('SPOTIFY', '🛑 Automatic token refresh interval stopped');
  }
}

// Expose token refresh functions globally
window.refreshSpotifyToken = refreshSpotifyToken;
window.checkAndRefreshSpotifyToken = checkAndRefreshSpotifyToken;
window.startSpotifyTokenRefreshInterval = startSpotifyTokenRefreshInterval;
window.stopSpotifyTokenRefreshInterval = stopSpotifyTokenRefreshInterval;

// Expose UI layout function globally
window.updateUILayout = updateUILayout;

// ...restlicher Code bleibt unverändert...

async function searchMusicServer(query) {
  try {
    debugLog('api', '[DATA-API] Searching data server for:', query);
    
    const response = await musicAPI.getTracks({ 
      search: query,
      limit: 50 
    });
    
    const tracks = response.data || [];
    
    // Convert server tracks to library format
    const libraryTracks = tracks.map(track => ({
      type: 'server',
      id: track.id,
      title: track.title,
      artist: track.artist,
      album: track.album,
      year: track.year,
      genre: track.genre,
      duration: track.duration,
      streamUrl: musicAPI.getStreamURL(track.id),
      coverUrl: musicAPI.getCoverURL(track.id),
      path: track.file_path
    }));
    
    debugLog('api', `[DATA-API] Found ${libraryTracks.length} matching tracks`);
    return libraryTracks;
    
  } catch (error) {
    console.warn('[DATA-API] Search failed:', error.message);
    return [];
  }
}

async function searchSpotifyDirect(query) {
  // Get token via window property getter from spotify.js module
  const accessToken = window.spotifyAccessToken || sessionStorage.getItem('spotify_access_token') || localStorage.getItem('spotify_access_token');
  if (!accessToken) { 
    debugLog('SPOTIFY', 'Spotify search not possible - no token available');
    // Silent return, status icon shows connection state
    return []; 
  }
  
  debugLog('[DEBUG] Spotify search for:', query);
  try {
    const res = await fetch(`https://api.spotify.com/v1/search?type=track&limit=20&q=${encodeURIComponent(query)}`, { 
      headers: { 'Authorization': `Bearer ${accessToken}` } 
    });
    
    if (res.status === 401 || res.status === 403) {
      console.warn('[DEBUG] Spotify token invalid/expired, deleting token and requesting re-login');
      // Clear invalid token
      clearSpotifyData();
      toast.error('Spotify-Session abgelaufen. Bitte neu anmelden!');
      return [];
    }
    
    if (!res.ok) { 
      const t = await res.text(); 
      console.error('[DEBUG] Spotify-Suche fehlgeschlagen:', res.status, t); 
      toast.error(`Spotify-Suche fehlgeschlagen: ${res.status}`);
      return []; 
    }
    
    const data = await res.json();
    const tracks = (data.tracks && data.tracks.items) ? data.tracks.items.map(item => {
      let year=''; 
      if (item.album && item.album.release_date) year=item.album.release_date.slice(0,4);
      return { 
        id:item.id, 
        name:item.name, 
        artists:item.artists.map(a=>a.name).join(', '), 
        artist:item.artists.map(a=>a.name).join(', '), 
        album:item.album.name, 
        year, 
        genre:'', 
        image:(item.album.images && (item.album.images[1]||item.album.images[0]) && (item.album.images[1]||item.album.images[0]).url) || '', 
        previewUrl:item.preview_url, 
        uri:item.uri,
        duration_ms: item.duration_ms || 0
      };
    }) : [];
    debugLog('[DEBUG] Spotify-Suche Ergebnisse:', tracks.length, 'Tracks gefunden');
    return tracks;
  } catch(e){ 
    console.error('[DEBUG] Spotify-Suche Exception:', e); 
    toast.error('Spotify-Suche fehlgeschlagen');
    return []; 
  }
}

function renderSpotifyResults(tracks){ 
  if (!spotifyResultsEl) return; 
  spotifyResultsEl.innerHTML=''; 
  tracks.forEach((track)=>{ 
    const li=document.createElement('li'); 
    if(track.image){ 
      const img=document.createElement('img'); 
      img.src=track.image; 
      img.style.width='50px'; 
      img.style.height='50px'; 
      img.style.objectFit='cover'; 
      img.style.marginRight='0.5rem'; 
      li.appendChild(img);
    } 
    const info=document.createElement('div'); 
    info.style.display='flex'; 
    info.style.flexDirection='column'; 
    const titleSpan=document.createElement('span'); 
    titleSpan.textContent=track.name; 
    titleSpan.style.fontWeight='bold'; 
    const artistSpan=document.createElement('span'); 
    artistSpan.textContent=track.artists; 
    artistSpan.style.fontSize='0.8rem'; 
    artistSpan.style.color='#bbbbbb'; 
    info.appendChild(titleSpan); 
    info.appendChild(artistSpan); 
    li.appendChild(info); 
    li.addEventListener('click', ()=> addToQueue({ 
      type:'spotify', 
      title:`${track.name} – ${track.artists}`, 
      previewUrl:track.previewUrl, 
      image:track.image, 
      artist:track.artist||'', 
      album:track.album||'', 
      year:track.year||'', 
      genre:track.genre||'', 
      uri:track.uri,
      duration_ms: track.duration_ms || 0
    })); 
    spotifyResultsEl.appendChild(li); 
  }); 
}

function initialize(){
  debugLog('INIT', '=== Initialize gestartet ===');
  
  // Initialize APIs with correct server URL
  if (!window.musicAPI) {
    window.musicAPI = new DataServerAPI(dataServerURL);
    debugLog('SYSTEM', `Data API initialized with URL: ${dataServerURL}`);
  }
  
  // Safely initialize UI elements
  const adminOverlayEl = document.getElementById('adminOverlay');
  if (adminOverlayEl) {
    adminOverlayEl.classList.add('hidden');
  } else {
    debugLog('INIT', 'Warning: adminOverlay element not found');
  }
  
  if (audioPlayer && volumeSlider) {
    audioPlayer.volume = 0.7;
    volumeSlider.value = '0.7';
  }
  
  initializeAZNavigation(); // Initialize A-Z navigation
  // Spotify connection monitoring is handled by spotify.js module
  setupAutoSave(); // Setup automatic state saving
  
  // App state is already loaded in DOMContentLoaded handler
  
  loadLocalIndex();
  loadDefaultSuggestions();
  
  debugLog('INIT', '=== Initialize abgeschlossen ===');
  
  // Set up navigation click handlers
  if (sideNav) {
    sideNav.querySelectorAll('.nav-tile').forEach((btn)=> btn.addEventListener('click', handleNavClick));
  } else {
    debugLog('INIT', 'Warning: sideNav element not found');
  }
  
  // Only activate first nav if no state was restored (fresh start)
  const hasRestoredState = sessionStorage.getItem('jukebox_app_state') || localStorage.getItem('jukebox_app_state');
  if (!hasRestoredState) {
    debugLog('[DEBUG] Kein gespeicherter State - initialisiere mit Standardwerten');
    
    // Reset navigation state to ensure clean start
    navigationState.level = 'root';
    navigationState.currentArtist = null;
    navigationState.currentAlbum = null;
    navigationState.currentFilter = 'new';
    
    // Set default filter and activate first nav button
    const firstNav = sideNav.querySelector('.nav-tile'); 
    if (firstNav) {
      firstNav.classList.add('active');
      currentFilter = firstNav.dataset.filter || 'new';
      debugLog('[DEBUG] Erster Nav-Button aktiviert, currentFilter =', currentFilter);
    }
    
    // Don't render library here - will be rendered after data is loaded in loadLocalIndex()
    debugLog('[DEBUG] Library wird nach Datenladung gerendert...');
  } else {
    debugLog('[DEBUG] State wurde wiederhergestellt - Library wird nach Datenladung gerendert');
  }
  // If state was restored, renderLibrary() was already called in restoreUIState()
  
  // Initialize PIN keypad
  initializePinKeypad();
  
  skipButton.addEventListener('click', ()=>{ 
    if (queue.length>0) skipTrack(); 
    // Don't close admin panel automatically - persistent mode
  });
  
  clearPlaylistButton.addEventListener('click', ()=> {
    if (confirm('Sind Sie sicher, dass Sie die gesamte Playlist leeren möchten?')) {
      clearPlaylist();
    }
  });
  
  const closeAdminPanel = document.getElementById('closeAdminPanel');
  if (closeAdminPanel) {
    closeAdminPanel.addEventListener('click', ()=> {
      debugLog('ui', '[DEBUG] Close-Button geklickt');
      if (window.adminPanel && window.adminPanel.hideAdminOverlay) {
        window.adminPanel.hideAdminOverlay();
      }
      debugLog('ui', '[DEBUG] Admin-Panel geschlossen (Admin-Modus bleibt aktiv)');
      // Admin icon should still show unlocked state
      if (window.adminPanel && window.adminPanel.updateControlsState) {
        window.adminPanel.updateControlsState();
      }
    });
  }
  
  // NOTE: Lock buttons are now handled by robust event delegation in DOMContentLoaded
  
  // Close PIN panel button
  const closePinPanel = document.getElementById('closePinPanel');
  if (closePinPanel) {
    closePinPanel.addEventListener('click', ()=> {
      debugLog('ui', '[DEBUG] PIN-Close-Button geklickt');
      if (window.adminPanel && window.adminPanel.hideAdminOverlay) {
        window.adminPanel.hideAdminOverlay();
      }
      debugLog('ui', '[DEBUG] PIN-Panel geschlossen');
      // Ensure admin icon shows correct state
      updateControlsState();
    });
  }
  
  quitButton.addEventListener('click', ()=> window.close());

  // Initialize admin handlers (delegated to admin_panel.js)
  if (window.adminPanel && window.adminPanel.initializeSettingsButtonHandlers) {
    window.adminPanel.initializeSettingsButtonHandlers();
  }
  
  if (window.adminPanel && window.adminPanel.initializeAdditionalAdminHandlers) {
    window.adminPanel.initializeAdditionalAdminHandlers();  
  }
  
  if (window.adminPanel && window.adminPanel.initializeDataServerButtonHandlers) {
    window.adminPanel.initializeDataServerButtonHandlers();
  }
  
  // Simple search handler function
  function handleSearchInput(event) {
    const query = event.target.value.trim().toLowerCase();
    if (query.length >= 2) {
      // Trigger search functionality if it exists
      if (typeof performSearch === 'function') {
        performSearch(query);
      } else if (typeof searchLibrary === 'function') {
        searchLibrary(query);
      }
    } else if (query.length === 0) {
      // Clear search if it exists
      if (typeof clearSearch === 'function') {
        clearSearch();
      } else if (typeof renderLibraryView === 'function') {
        renderLibraryView();
      }
    }
  }
  
  // Initialize search functionality
  searchInput.addEventListener('input', handleSearchInput);
  
  if (refreshLibraryButton) {
    refreshLibraryButton.addEventListener('click', async () => {
      try {
        refreshLibraryButton.disabled = true;
        refreshLibraryButton.textContent = (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.buttons.scanning') : 'Scanning...';
        
        // Clear current library data
        library.length = 0;
        recentAdditions.length = 0;
        
        // Trigger a full rescan on the data server
        const rescanResponse = await fetch(getAPIURL('/api/rescan'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });
        
        if (!rescanResponse.ok) {
          throw new Error(`HTTP ${rescanResponse.status}`);
        }
        
        // Wait a moment for the rescan to start
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Reload from data server
        await loadLocalIndex();
        toast.success((typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.messages.libraryUpdated') : 'Library fully updated!');
        
        updateMusicServerStatus();
        
      } catch (error) {
        console.error('[DATA-API] Refresh failed:', error);
        toast.error('Aktualisierung fehlgeschlagen: ' + error.message);
      } finally {
        refreshLibraryButton.disabled = false;
        refreshLibraryButton.textContent = (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.buttons.updateLibrary') : 'Update Library';
      }
    });
  }
  
  if (cleanupDatabaseButton) {
    cleanupDatabaseButton.addEventListener('click', async () => {
      if (!confirm((typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.messages.cleanupDatabase') : 'Delete orphaned database entries? This cannot be undone.')) {
        return;
      }
      
      try {
        cleanupDatabaseButton.disabled = true;
        cleanupDatabaseButton.textContent = '🧹 Bereinige...';
        cleanupDatabaseButton.style.background = '#666';
        
        const response = await fetch(getAPIURL('/api/cleanup'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        
        const result = await response.json();
        if (result.success) {
          toast.success(`Cleanup completed: ${result.removedCount} orphaned entries removed`);
          // Update status after cleanup
          setTimeout(updateMusicServerStatus, 1000);
        } else {
          throw new Error(result.error || 'Cleanup fehlgeschlagen');
        }
        
      } catch (error) {
        console.error('[DATA-API] Cleanup failed:', error);
        toast.error('Bereinigung fehlgeschlagen: ' + error.message);
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
      if (!confirm((typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.messages.clearDatabaseFinal') : 'Are you REALLY sure? This action CANNOT be undone!')) {
        return;
      }
      
      try {
        clearDatabaseButton.disabled = true;
        clearDatabaseButton.textContent = '🗑️ Lösche...';
        clearDatabaseButton.style.background = '#666';
        
        const response = await fetch(getAPIURL('/api/clear-database'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        
        const result = await response.json();
        if (result.success) {
          toast.success('Datenbank vollständig geleert');
          
          // Clear local data as well
          library.length = 0;
          recentAdditions.length = 0;
          queue.length = 0;
          playedTracks.length = 0;
          currentTrackIndex = -1;
          
          // Clear cover cache too
          coverCache.clear();
          
          // Update displays
          debouncedUpdateQueueDisplay();
          renderLibrary();
          setTimeout(updateMusicServerStatus, 1000);
        } else {
          throw new Error(result.error || 'Database clear fehlgeschlagen');
        }
        
      } catch (error) {
        console.error('[DATA-API] Database clear failed:', error);
        toast.error('Datenbank leeren fehlgeschlagen: ' + error.message);
      } finally {
        clearDatabaseButton.disabled = false;
        clearDatabaseButton.textContent = '🗑️ Datenbank vollständig leeren';
        clearDatabaseButton.style.background = '#c0392b';
      }
    });
  }

  // Cover-Cache leeren Button
  const clearCoverCacheButton = document.getElementById('clearCoverCacheButton');
  if (clearCoverCacheButton) {
    clearCoverCacheButton.addEventListener('click', () => {
      if (!confirm('Cover-Cache leeren?\n\nAlle gecachten Cover-Bilder werden entfernt und müssen neu geladen werden.')) {
        return;
      }
      
      try {
        const stats = coverCache.getStats();
        coverCache.clear();
        toast.success(`Cover-Cache geleert (${stats.cacheSize} Einträge entfernt)`);
        updateCoverCacheStats();
        debugLog('COVER', 'Cover-Cache manuell geleert');
      } catch (error) {
        console.error('[COVER] Cache clear failed:', error);
        toast.error('Cover-Cache leeren fehlgeschlagen');
      }
    });
  }

  const spotifyLoginBtn = document.getElementById('spotifyLoginBtn');
  if (spotifyLoginBtn) {
    spotifyLoginBtn.addEventListener('click', () => {
      // Öffne Spotify Login als Popup statt Navigation
      openSpotifyLoginPopup();
    });
  }

  // Initialize GEMA Reporting System
  if (window.adminPanel && window.adminPanel.gemaReporting) {
    window.adminPanel.gemaReporting.initializeReportingSystem();
  }
  
  // Initialize Spotify Auto-Learning buttons
  initializeSpotifyAutoLearning();
  let searchTimeout; 
  searchInput.addEventListener('input', (evt) => { 
    clearTimeout(searchTimeout); 
    const q = evt.target.value.trim(); 
    
    // Handle now playing auto-collapse
    handleSearchActivity();
    
    if (q.length === 0) { 
      if (spotifyResultsEl) spotifyResultsEl.innerHTML=''; 
      // Reset to current view when search is cleared
      renderLibrary();
      return; 
    } 
    
    searchTimeout = setTimeout(async () => { 
      debugLog('main', '[SEARCH] Searching for:', q);
      
      // Search both Data Server and Spotify in parallel
      const searchPromises = [
        searchMusicServer(q),
        searchSpotifyDirect(q)
      ];
      
      try {
        const [serverTracks, spotifyTracks] = await Promise.all(searchPromises);
        
        // Use Search Module to render results
        if (typeof window.SearchModule !== 'undefined' && window.SearchModule.renderEnhancedSearchResults) {
          window.SearchModule.renderEnhancedSearchResults(serverTracks, spotifyTracks, q);
        }
        
        debugLog('main', `[SEARCH] Found ${serverTracks.length} local + ${spotifyTracks.length} Spotify tracks`);
        
      } catch (error) {
        console.error('[SEARCH] Search error:', error);
      }
    }, 200); // Noch schnellere Reaktion 
  });
  audioPlayer.addEventListener('ended', skipTrack);
  
  // Time update listener for progress bar
  audioPlayer.addEventListener('timeupdate', () => {
    if (audioPlayer.duration && !isNaN(audioPlayer.duration)) {
      const progress = (audioPlayer.currentTime / audioPlayer.duration) * 100;
      progressBar.value = progress;
      // debugLog('ui', '[DEBUG] Progress updated:', progress.toFixed(1) + '%'); // Uncomment for debugging
    } else {
      progressBar.value = 0;
    }
  });
  
  // Progress bar input listener for seeking
  progressBar.addEventListener('input', (evt) => {
    if (audioPlayer.duration && !isNaN(audioPlayer.duration)) {
      const newTime = (parseFloat(evt.target.value) / 100) * audioPlayer.duration;
      audioPlayer.currentTime = newTime;
    }
  });
  
  // Keine Spotify-Initialisierung mehr hier, das passiert jetzt nur noch am Anfang beim Token-Setzen
  actionAddQueueBtn?.addEventListener('click', () => {
    const track = queue[currentTrackIndex]; if (track) addToQueue({ ...track });
  });
  actionPlayNextBtn?.addEventListener('click', () => {
    const track = queue[currentTrackIndex]; if (track) insertNext({ ...track });
  });
  actionAddPlaylistBtn?.addEventListener('click', () => {
    const track = queue[currentTrackIndex]; if (track) addToQueue({ ...track });
  });
  
  // Initialize visualizers AFTER all other variables are initialized
  debugLog('main', '[EQUALIZER] 🎯 About to call Equalizer Module...');
  if (window.EqualizerModule && equalizerCanvas) {
    window.EqualizerModule.init(equalizerCanvas, audioPlayer, isAnyMusicPlaying).catch(err => {
      console.error('[EQUALIZER] ❌ Initialization failed:', err);
      debugLog('main', '[EQUALIZER] ❌ Init error:', err.message, err.stack);
    });
  } else {
    console.warn('[EQUALIZER] Module or Canvas not available');
  }
  
  // Initialize Now Playing Visualizer Module
  if (window.VisualizerModule) {
    window.VisualizerModule.init({
      isMusicPlayingCallback: isAnyMusicPlaying,
      settings: visualizationSettings
    });
    debugLog('UI', '[NOW-PLAYING-VISUALIZER] ✅ VisualizerModule initialized');
  } else {
    console.warn('[VISUALIZER] Module not available');
  }
}

function loadDefaultSuggestions() {
  const decades = [1980, 1990, 2000, 2010];
  decades.forEach(async (dec) => {
    try {
      const res = await fetch(`cache/tracks_${dec}.json`, { cache: 'no-store' });
      if (!res.ok) return;
      const tracks = await res.json();
      const mapped = tracks.filter(t=>t.preview_url).map(t => ({
        name: t.name,
        artists: t.artist,
        artist: t.artist,
        album: t.album,
        year: t.release_year ? String(t.release_year) : '',
        genre: '',
        image: t.image || '',
        previewUrl: t.preview_url,
        uri: t.uri,
        duration_ms: t.duration_ms || 0
      }));
      if (mapped.length>0) addToLibrary(mapped, 'spotify');
    } catch {}
  });
}

// Playback control functions moved to js/audio.js
// Use window.resumePlayback(), window.pausePlayback(), window.stopPlayback()
// These are now exported from the audio module

playButton?.addEventListener('click', resumePlayback);
pauseButton?.addEventListener('click', pausePlayback);
stopButton?.addEventListener('click', stopPlayback);
skipControlButton?.addEventListener('click', ()=> { if (queue.length>0) skipTrack(); });

// Volume slider event listener moved to audio.js
// Volume-Slider und Play-Button visuell deaktivieren wenn nicht Admin
// Load admin settings from Settings API (with localStorage fallback)
// loadAdminSettings function moved to admin_panel.js
// Use window.adminPanel.loadAdminSettings() instead

// Load language settings
function loadLanguageSettings() {
  if (languageSelect && window.i18n) {
    const currentLanguage = window.i18n.getCurrentLanguage();
    languageSelect.value = currentLanguage.code;
    debugLog('SYSTEM', 'Spracheinstellungen geladen:', currentLanguage.name);
  }
}

// Admin wrapper functions for backward compatibility
function getAdminSettings() {
  if (window.adminPanel && window.adminPanel.getAdminSettings) {
    return window.adminPanel.getAdminSettings();
  }
  // Fallback
  const settings = localStorage.getItem('adminSettings');
  return settings ? JSON.parse(settings) : { 
    adminPin: '1234', 
    trackLockTimeMinutes: 60, 
    debuggingEnabled: false,
    visualizations: { enableSpace: true, enableFire: true, enableParticles: true, enableCircles: true, switchInterval: 30 }
  };
}

// Wrapper function for backward compatibility  
function saveAdminSettings() {
  if (window.adminPanel && window.adminPanel.saveAdminSettings) {
    return window.adminPanel.saveAdminSettings();
  }
}

// Load visualization settings from admin settings
// Visualization settings functions moved to admin_panel.js
// Use window.adminPanel methods instead

// Save visualization settings - wrapper function for consistency
function saveVisualizationSettings() {
  saveAdminSettings(); // Delegate to the main admin settings save function
  debugLog('SYSTEM', 'Visualization settings saved via wrapper');
}

// Update admin panel specific content after language change
function updateAdminPanelContent() {
  // Use AdminPanel version if available
  if (window.adminPanel && window.adminPanel.updateAdminPanelContent) {
    return window.adminPanel.updateAdminPanelContent();
  }
  
  // Fallback implementation
  const savedEventsList = document.getElementById('savedEventsList');
  if (savedEventsList && savedEventsList.children.length === 1) {
    const firstChild = savedEventsList.children[0];
    if (firstChild.textContent.includes('Keine gespeicherten') || firstChild.textContent.includes('No saved events')) {
      if (window.adminPanel && window.adminPanel.loadSavedEventsList) {
        window.adminPanel.loadSavedEventsList();
      }
    }
  }
}

// Update language dropdown to match current i18n language
function updateLanguageDropdown() {
  if (languageSelect && window.i18nSystem) {
    const currentLanguage = window.i18nSystem.currentLanguage;
    if (currentLanguage && languageSelect.value !== currentLanguage) {
      languageSelect.value = currentLanguage;
    }
  }
}

function updateMusicServerStatus() {
  if (window.adminPanel && window.adminPanel.updateMusicServerStatus) {
    return window.adminPanel.updateMusicServerStatus();
  }
}

// Update cover cache statistics display
function updateCoverCacheStats() {
  if (window.adminPanel && window.adminPanel.updateCoverCacheStats) {
    return window.adminPanel.updateCoverCacheStats();
  }
}

// Footer Equalizer - Canvas reference (logic moved to js/equalizer.js)
// equalizerCanvas is declared at the top of the file

// Now Playing Enhanced Visualizer
let nowPlayingVisualizerCanvas = null;
let nowPlayingVisualizerCtx = null;
let nowPlayingAnimationFrame = null;

// Now Playing Auto-Collapse System
let searchInactivityTimer = null;
let isNowPlayingCollapsed = false;
let currentLayoutMode = 'now-playing'; // 'now-playing' or 'search'
const SEARCH_INACTIVITY_DELAY = 30000; // 30 seconds

// User Activity Monitoring System
let lastUserActivityTime = Date.now();
let activityMonitorTimer = null;
const ACTIVITY_CHECK_INTERVAL = 5000; // Check every 5 seconds
const ACTIVITY_RESET_THRESHOLD = 10000; // Reset timers if activity within last 10 seconds

function updateUserActivity() {
  lastUserActivityTime = Date.now();
  debugLog('main', '[ACTIVITY-MONITOR] User activity timestamp updated');
}

function startActivityMonitoring() {
  if (activityMonitorTimer) {
    clearInterval(activityMonitorTimer);
  }
  
  debugLog('main', '[ACTIVITY-MONITOR] Starting continuous activity monitoring');
  
  activityMonitorTimer = setInterval(() => {
    const timeSinceLastActivity = Date.now() - lastUserActivityTime;
    
    if (timeSinceLastActivity < ACTIVITY_RESET_THRESHOLD) {
      debugLog('main', `[ACTIVITY-MONITOR] Recent activity detected (${Math.round(timeSinceLastActivity/1000)}s ago) - resetting timers`);
      
      // Reset search inactivity timer
      if (searchInactivityTimer) {
        clearTimeout(searchInactivityTimer);
        searchInactivityTimer = null;
        debugLog('main', '[ACTIVITY-MONITOR] Reset search inactivity timer');
      }
      
      // Reset main inactivity timer
      if (typeof resetInactivityTimer === 'function') {
        resetInactivityTimer();
        debugLog('main', '[ACTIVITY-MONITOR] Reset main inactivity timer');
      }
    }
  }, ACTIVITY_CHECK_INTERVAL);
}

// ====================================
// FOOTER EQUALIZER CODE MOVED TO js/equalizer.js
// See window.EqualizerModule for API
// ====================================

// Enhanced Now Playing with Color Extraction
function extractColorsFromImage(imageUrl, callback) {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = function() {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 50;
    canvas.height = 50;
    
    ctx.drawImage(img, 0, 0, 50, 50);
    
    try {
      const imageData = ctx.getImageData(0, 0, 50, 50);
      const data = imageData.data;
      
      let r = 0, g = 0, b = 0;
      let totalPixels = 0;
      
      // Average color calculation
      for (let i = 0; i < data.length; i += 4) {
        r += data[i];
        g += data[i + 1];
        b += data[i + 2];
        totalPixels++;
      }
      
      r = Math.floor(r / totalPixels);
      g = Math.floor(g / totalPixels);
      b = Math.floor(b / totalPixels);
      
      // Create complementary colors
      const accent1 = `${r}, ${g}, ${b}`;
      const accent2 = `${Math.max(0, r - 40)}, ${Math.max(0, g - 40)}, ${Math.max(0, b - 40)}`;
      
      callback({ accent1, accent2, r, g, b });
    } catch (e) {
      console.warn('Color extraction failed:', e);
      callback({ accent1: '29, 185, 84', accent2: '20, 140, 64', r: 29, g: 185, b: 84 });
    }
  };
  
  img.onerror = () => {
    callback({ accent1: '29, 185, 84', accent2: '20, 140, 64', r: 29, g: 185, b: 84 });
  };
  
  img.src = imageUrl;
}

function updateNowPlayingBackground(colors) {
  const nowPlayingSection = document.getElementById('nowPlayingSection');
  const nowPlayingHeader = document.getElementById('nowPlayingHeader');
  
  if (nowPlayingSection && colors) {
    // Update CSS custom properties for dynamic background
    nowPlayingSection.style.setProperty('--bg-color-1', `rgba(${colors.accent1}, 0.15)`);
    nowPlayingSection.style.setProperty('--bg-color-2', `rgba(${colors.accent2}, 0.1)`);
    nowPlayingSection.style.setProperty('--accent-color', colors.accent1);
  }
  
  if (nowPlayingHeader && colors) {
    // Update CSS custom properties for dynamic "Now playing" header styling
    nowPlayingHeader.style.setProperty('--now-playing-color', `rgb(${colors.accent1})`);
    nowPlayingHeader.style.setProperty('--now-playing-rgb', colors.accent1);
    
    // Create a slightly brighter version for better visibility
    const brightR = Math.min(255, colors.r + 30);
    const brightG = Math.min(255, colors.g + 30);
    const brightB = Math.min(255, colors.b + 30);
    const brightColor = `${brightR}, ${brightG}, ${brightB}`;
    
    nowPlayingHeader.style.setProperty('--now-playing-color', `rgb(${brightColor})`);
    nowPlayingHeader.style.setProperty('--now-playing-rgb', brightColor);
  }
}

function initNowPlayingHeaderStyling() {
  const nowPlayingHeader = document.getElementById('nowPlayingHeader');
  if (!nowPlayingHeader) return;
  
  // Set default styling with Jukebox green
  nowPlayingHeader.style.setProperty('--now-playing-color', 'rgb(29, 185, 84)');
  nowPlayingHeader.style.setProperty('--now-playing-rgb', '29, 185, 84');
  
  // Start random flickering like an old bulb
  startNowPlayingFlicker();
  
  debugLog('UI', 'Now Playing Header Styling initialisiert');
}

function initNowPlayingHeaderStyling() {
  const nowPlayingHeader = document.getElementById('nowPlayingHeader');
  if (!nowPlayingHeader) return;
  
  // Set default styling with Jukebox green
  nowPlayingHeader.style.setProperty('--now-playing-color', 'rgb(29, 185, 84)');
  nowPlayingHeader.style.setProperty('--now-playing-rgb', '29, 185, 84');
  
  debugLog('UI', 'Now Playing Header Styling initialisiert');
}

// ====================================
// NOW-PLAYING VISUALIZER CODE MOVED TO js/visualizer.js
// See window.VisualizerModule for complete implementation:
// - All visualization modes (Space, Fire, Particles, Circles)
// - Animation and rendering loops
// - Mode rotation and transitions
// - Cover-color based theming
// - Helper functions and particle systems
// ====================================

// Now Playing Auto-Collapse System
function collapseNowPlayingSection() {
  const nowPlayingSection = document.getElementById('nowPlayingSection');
  const content = document.getElementById('content');
  
  if (nowPlayingSection && content && !isNowPlayingCollapsed) {
    nowPlayingSection.classList.add('collapsed');
    nowPlayingSection.classList.remove('expanded');
    content.classList.add('search-mode');
    content.classList.remove('now-playing-mode');
    
    isNowPlayingCollapsed = true;
    currentLayoutMode = 'search';
    debugLog('main', '[NOW-PLAYING] Section collapsed for search, library visible');
  }
}

function expandNowPlayingSection() {
  const nowPlayingSection = document.getElementById('nowPlayingSection');
  const content = document.getElementById('content');
  
  if (nowPlayingSection && content) {
    // WICHTIG: Erst collapsed state zurücksetzen
    isNowPlayingCollapsed = false;
    currentLayoutMode = 'now-playing';
    
    // Force visibility and proper display
    nowPlayingSection.style.display = 'block';
    nowPlayingSection.style.visibility = 'visible';
    
    // Force collapsed state first, then animate to expanded
    nowPlayingSection.classList.add('collapsed');
    nowPlayingSection.classList.remove('expanded', 'hidden');
    content.classList.remove('now-playing-mode');
    content.classList.add('search-mode');
    
    // Force reflow
    nowPlayingSection.offsetHeight;
    
    // Small delay, then animate to expanded state
    setTimeout(() => {
      nowPlayingSection.classList.remove('collapsed');
      nowPlayingSection.classList.add('expanded');
      content.classList.remove('search-mode');
      content.classList.add('now-playing-mode');
    }, 50);
    
    // Clear any active timers
    if (searchInactivityTimer) {
      clearTimeout(searchInactivityTimer);
      searchInactivityTimer = null;
    }
    
    isNowPlayingCollapsed = false;
    currentLayoutMode = 'now-playing';
    debugLog('main', '[NOW-PLAYING] Section expanded, library hidden');
  }
}

function resetSearchInactivityTimer() {
  if (searchInactivityTimer) {
    clearTimeout(searchInactivityTimer);
    searchInactivityTimer = null;
  }
  
  debugLog('main', '[NOW-PLAYING] Starting 30s inactivity timer');
  
  searchInactivityTimer = setTimeout(() => {
    debugLog('main', '[NOW-PLAYING] 30s timeout reached - checking search state');
    const searchInput = document.getElementById('searchInput');
    const searchValue = searchInput ? searchInput.value.trim() : '';
    const isPlaying = isAnyMusicPlaying();
    
    debugLog('main', `[NOW-PLAYING] Timer debug - Search: "${searchValue}", Playing: ${isPlaying}, Collapsed: ${isNowPlayingCollapsed}`);
    
    if (!searchInput || !searchValue) {
      if (isPlaying) {
        debugLog('main', '[NOW-PLAYING] Search empty and music playing - expanding section');
        expandNowPlayingSection();
      } else {
        debugLog('main', '[NOW-PLAYING] Search empty but no music playing - staying collapsed');
      }
    } else {
      // Search has content - start main inactivity timer for automatic return
      debugLog('main', '[NOW-PLAYING] Search still has content - starting main inactivity timer');
      resetInactivityTimer();
    }
    searchInactivityTimer = null;
  }, SEARCH_INACTIVITY_DELAY);
}

// Hilfsfunktion: Prüft ob aktuell Musik gespielt wird (lokal oder Spotify)
function isAnyMusicPlaying() {
  // Prüfe lokalen Player - ist er aktiv und spielt etwas?
  // WICHTIG: currentTime > 0 NICHT prüfen, da beim Start currentTime noch 0 sein kann!
  if (audioPlayer && !audioPlayer.paused && audioPlayer.readyState >= 2) {
    return true;
  }
  
  // Prüfe Queue Status - haben wir einen aktiven Track?
  if (queue && queue.length > 0 && currentTrackIndex >= 0 && currentTrackIndex < queue.length) {
    const currentTrack = queue[currentTrackIndex];
    if (currentTrack) {
      // Spotify-Tracks: Nur als spielend betrachten wenn Spotify Player auch tatsächlich läuft
      if (currentTrack.type === 'spotify') {
        // Prüfe globale Spotify Player Status oder Paused-Status
        if (window.spotifyPlayer && typeof window.spotifyPlayerIsPaused !== 'undefined') {
          return !window.spotifyPlayerIsPaused; // Nur wenn nicht pausiert
        }
        // Fallback: Verwende einen globalen Status den wir beim Play/Pause setzen
        return window.isSpotifyCurrentlyPlaying === true;
      }
      // Lokale Tracks (auch ohne type oder type === undefined)
      if (!currentTrack.type || currentTrack.type === undefined) {
        // Für lokale Tracks zusätzlich prüfen ob audioPlayer läuft
        // readyState >= 2 bedeutet HAVE_CURRENT_DATA oder höher (Track ist geladen)
        return audioPlayer && !audioPlayer.paused && audioPlayer.readyState >= 2;
      }
    }
  }
  
  return false;
}

function handleSearchActivity() {
  const searchInput = document.getElementById('searchInput');
  const searchValue = searchInput ? searchInput.value.trim() : '';
  
  debugLog('main', `[NOW-PLAYING] Search activity: "${searchValue}"`);
  
  if (searchValue) {
    // User is typing - collapse and start timer
    debugLog('main', '[NOW-PLAYING] Search has content - collapsing');
    collapseNowPlayingSection();
    resetSearchInactivityTimer();
  } else {
    // Search is empty - check if we should expand
    const isPlaying = isAnyMusicPlaying();
    
    if (isPlaying) {
      debugLog('main', '[NOW-PLAYING] Search cleared and music playing - expanding immediately');
      if (searchInactivityTimer) {
        clearTimeout(searchInactivityTimer);
        searchInactivityTimer = null;
      }
      expandNowPlayingSection();
    } else {
      debugLog('main', '[NOW-PLAYING] Search cleared but no music playing - staying collapsed');
      if (searchInactivityTimer) {
        clearTimeout(searchInactivityTimer);
        searchInactivityTimer = null;
      }
    }
  }
}

function handleNavigationActivity(source = 'navigation') {
  debugLog('main', `[NOW-PLAYING] Navigation activity from: ${source}`);
  
  // Don't collapse if we're just adding tracks to queue - let user stay in current view
  if (source === 'user-interaction' && isAddingToQueue) {
    debugLog('main', `[NOW-PLAYING] Ignoring navigation activity during queue addition`);
    return;
  }
  
  // Collapse now playing when user navigates
  collapseNowPlayingSection();
  
  // Start timer to expand again after inactivity
  // Verwende eine globale Variable oder trigger ein Event
  if (typeof startGlobalActivityTimer === 'function') {
    startGlobalActivityTimer();
  } else {
    // Fallback auf altes System
    resetSearchInactivityTimer();
  }
}

function initNowPlayingAutoCollapse() {
  const searchInput = document.getElementById('searchInput');
  if (!searchInput) return;
  
  // Start continuous activity monitoring system
  startActivityMonitoring();
  debugLog('main', '[INIT] Activity monitoring system started');
  
  // Simple approach: just listen for any user activity
  let activityTimer = null;

// Globale Timer-Variablen
let homePageFallbackTimer = null;
let searchInactivityTimer = null;

// Make activityTimer globally accessible for wheel protection
window.currentActivityTimer = null;

// Zentrale Funktion zum Zurücksetzen des Inaktivitäts-Timers
function resetInactivityTimer() {
  debugLog('main', '[ACTIVITY] User activity detected - resetting inactivity timer');
  
  // Clear existing timers
  if (homePageFallbackTimer) {
    clearTimeout(homePageFallbackTimer);
    homePageFallbackTimer = null;
  }
  
  if (searchInactivityTimer) {
    clearTimeout(searchInactivityTimer);
    searchInactivityTimer = null;
  }
  
  // Start new 60-second timer
  const isPlaying = isAnyMusicPlaying();
  const searchValue = document.getElementById('searchInput')?.value.trim() || '';
  
  debugLog('main', `[ACTIVITY] Starting 60s inactivity timer - Playing: ${isPlaying}, Search: "${searchValue}"`);
  
  homePageFallbackTimer = setTimeout(() => {
    const currentSearchValue = document.getElementById('searchInput')?.value.trim() || '';
    const currentlyPlaying = isAnyMusicPlaying();
    
    debugLog('main', `[INACTIVITY] 60s timeout reached - Search: "${currentSearchValue}", Playing: ${currentlyPlaying}, Filter: ${currentFilter}, NowPlayingCollapsed: ${isNowPlayingCollapsed}`);
    
    if (currentlyPlaying && isNowPlayingCollapsed) {
      // Music is playing but now playing is collapsed - expand it
      debugLog('main', '[INACTIVITY] Music playing - expanding now playing section');
      
      // Clear search field
      const searchInput = document.getElementById('searchInput');
      if (searchInput) {
        searchInput.value = '';
      }
      
      // Expand now playing section
      expandNowPlayingSection();
      renderLibrary();
      
    } else if (!currentSearchValue && !currentlyPlaying && isNowPlayingCollapsed) {
      // Check if we're already on NEU page
      if (currentFilter === 'new' && navigationState.level === 'root') {
        debugLog('main', '[INACTIVITY] Already on NEU page - no action needed');
        homePageFallbackTimer = null;
        return;
      }
      
      // No music playing and no search - return to NEU page
      debugLog('main', '[INACTIVITY] No activity for 60s - returning to NEU page');
      
      // Navigate back to "NEW" page
      currentFilter = 'new';
      navigationState.level = 'root';
      navigationState.currentArtist = null;
      navigationState.currentAlbum = null;
      
      // Update UI
      const navButtons = document.querySelectorAll('#sideNav .nav-tile');
      navButtons.forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.filter === 'new') {
          btn.classList.add('active');
        }
      });
      
      // Update A-Z navigation visibility for the new filter
      updateAZNavigationVisibility();
      
      // Render the NEU page
      renderLibrary();
      updateBreadcrumb();
      
      debugLog('main', '[INACTIVITY] Fallback to NEU complete');
      
    } else if (currentSearchValue && !currentlyPlaying && isNowPlayingCollapsed) {
      // User has search content but no music playing - clear search and return to NEU
      debugLog('main', '[INACTIVITY] Search active but no music - clearing search and returning to NEU');
      
      // Clear search field
      const searchInput = document.getElementById('searchInput');
      if (searchInput) {
        searchInput.value = '';
      }
      
      // Check if we're already on NEU page
      if (currentFilter === 'new' && navigationState.level === 'root') {
        debugLog('main', '[INACTIVITY] Already on NEU page - just cleared search');
        renderLibrary(); // Re-render to show NEU content without search
        homePageFallbackTimer = null;
        return;
      }
      
      // Navigate back to "NEW" page
      currentFilter = 'new';
      navigationState.level = 'root';
      navigationState.currentArtist = null;
      navigationState.currentAlbum = null;
      
      // Update UI
      const navButtons = document.querySelectorAll('#sideNav .nav-tile');
      navButtons.forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.filter === 'new') {
          btn.classList.add('active');
        }
      });
      
      // Update A-Z navigation visibility for the new filter
      updateAZNavigationVisibility();
      
      // Render the NEU page
      renderLibrary();
      updateBreadcrumb();
      
      debugLog('main', '[INACTIVITY] Search cleared and fallback to NEU complete');
    } else if (currentlyPlaying && !isNowPlayingCollapsed) {
      // Music is playing and now playing is already expanded - no action needed
      debugLog('main', '[INACTIVITY] Music playing and now playing already expanded - no action needed');
    } else {
      debugLog('main', '[INACTIVITY] No fallback action needed - current state is appropriate');
    }
    
    homePageFallbackTimer = null;
  }, 60000); // 60 seconds
}
  
  function startActivityTimer() {
    if (activityTimer) {
      clearTimeout(activityTimer);
    }
    if (window.currentActivityTimer) {
      clearTimeout(window.currentActivityTimer);
    }
    
    activityTimer = setTimeout(() => {
      const searchValue = searchInput.value.trim();
      const isPlaying = isAnyMusicPlaying();
      debugLog('main', `[NOW-PLAYING] Activity timer fired, search: "${searchValue}", playing: ${isPlaying}`);
      
      if (!searchValue && isNowPlayingCollapsed && isPlaying) {
        debugLog('main', '[NOW-PLAYING] No search content and music playing - expanding');
        expandNowPlayingSection();
      } else if (!searchValue && isNowPlayingCollapsed && !isPlaying) {
        debugLog('main', '[NOW-PLAYING] No search content and no music playing - starting inactivity timer');
        resetInactivityTimer();
      }
      activityTimer = null;
      window.currentActivityTimer = null;
    }, SEARCH_INACTIVITY_DELAY);
    
    // Also store globally for wheel protection
    window.currentActivityTimer = activityTimer;
  }
  
  // Globale Referenz für handleNavigationActivity
  window.resetInactivityTimer = resetInactivityTimer;
  
  // Start initial inactivity timer
  debugLog('main', '[INIT] Starting initial inactivity timer from initNowPlayingAutoCollapse');
  resetInactivityTimer();
  
  // Listen for any user activity that might indicate they're done searching
  document.addEventListener('click', (e) => {
    // Skip if click is on toast notification
    if (e.target.closest('.toast') || e.target.closest('.Toastify__toast')) {
      return;
    }
    
    // Update activity timestamp for monitoring system
    updateUserActivity();
    
    // Reset timer for clicks in menu, library navigation, search area, AND music items
    const isMenuClick = e.target.closest('#sideNav') || e.target.closest('.nav-tile');
    const isLibraryNavClick = e.target.closest('#azNav') || e.target.closest('.az-btn') || e.target.closest('.breadcrumb');
    const isSearchClick = e.target.closest('#searchInput') || e.target.closest('.search-container') || e.target.closest('#virtualKeyboard');
    const isMusicItemClick = e.target.closest('.card') || e.target.closest('li') || e.target.closest('#libraryList') || e.target.closest('#libraryGrid');
    
    if (isMenuClick || isLibraryNavClick || isSearchClick || isMusicItemClick) {
      handleNavigationActivity('user-interaction');
    }
    
    if (isNowPlayingCollapsed && !searchInput.value.trim()) {
      debugLog('main', '[NOW-PLAYING] Click detected with empty search - starting timer');
      startActivityTimer();
      // Do NOT start fallback timer on every click - only after 15s of inactivity
    }
  });
  
  document.addEventListener('keydown', (e) => {
    // Update activity timestamp for monitoring system
    updateUserActivity();
    
    // Only reset timer for keyboard input in search or navigation areas
    const isSearchKeyboard = e.target.closest('#searchInput') || e.target.closest('#virtualKeyboard');
    const isEscapeKey = e.key === 'Escape';
    
    if (isSearchKeyboard || isEscapeKey) {
      handleNavigationActivity('keyboard-navigation');
    }
    
    // If escape key or user presses something outside search
    if (e.key === 'Escape' || (e.target !== searchInput && !searchInput.value.trim())) {
      if (isNowPlayingCollapsed) {
        debugLog('main', '[NOW-PLAYING] Keyboard activity detected - starting timer');
        startActivityTimer();
        // Do NOT start fallback timer on every keypress - only after inactivity
      }
    }
  });
  
  // Listen for touch events on mobile devices (only in navigation areas)
  document.addEventListener('touchstart', (e) => {
    const isMenuTouch = e.target.closest('#sideNav') || e.target.closest('.nav-tile');
    const isLibraryNavTouch = e.target.closest('#azNav') || e.target.closest('.az-btn') || e.target.closest('.breadcrumb');
    const isSearchTouch = e.target.closest('#searchInput') || e.target.closest('.search-container') || e.target.closest('#virtualKeyboard');
    const isMusicItemTouch = e.target.closest('.card') || e.target.closest('li') || e.target.closest('#libraryList') || e.target.closest('#libraryGrid');
    
    if (isMenuTouch || isLibraryNavTouch || isSearchTouch || isMusicItemTouch) {
      handleNavigationActivity('touch-interaction');
    }
  });
  
  // Listen for scroll events in library areas (throttled to avoid excessive calls)
  // Only detect manual user scrolling, not programmatic scrolls
  let scrollThrottle = null;
  let isUserScrolling = false;
  let scrollTimeout = null;
  
  // Track when user starts scrolling
  document.addEventListener('wheel', (e) => {
    isUserScrolling = true;
    
    // IMMEDIATE PROTECTION: Stop all timers on wheel events in library areas
    const isLibraryWheel = e.target.closest('#libraryList') || e.target.closest('#libraryGrid') || 
                          e.target === document.documentElement || e.target === document.body;
    
    if (isLibraryWheel) {
      debugLog('main', '[WHEEL-PROTECTION] Wheel event in library - stopping ALL TIMERS immediately');
      
      // Stop ALL possible timers - including the activityTimer that was causing the issue!
      if (searchInactivityTimer) {
        clearTimeout(searchInactivityTimer);
        searchInactivityTimer = null;
        debugLog('main', '[WHEEL-PROTECTION] Stopped searchInactivityTimer');
      }
      if (typeof homePageFallbackTimer !== 'undefined' && homePageFallbackTimer) {
        clearTimeout(homePageFallbackTimer);
        homePageFallbackTimer = null;
        debugLog('main', '[WHEEL-PROTECTION] Stopped homePageFallbackTimer');
      }
      
      // CRITICAL: Stop the activityTimer that was causing the unwanted navigation!
      if (window.currentActivityTimer) {
        clearTimeout(window.currentActivityTimer);
        window.currentActivityTimer = null;
        debugLog('main', '[WHEEL-PROTECTION] Stopped currentActivityTimer');
      }
      
      updateUserActivity(); // Update activity timestamp
    }
    
    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => {
      isUserScrolling = false;
    }, 150);
  }, { passive: true });
  
  // Also track touch scrolling for mobile devices
  document.addEventListener('touchstart', (e) => {
    isUserScrolling = true;
    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => {
      isUserScrolling = false;
    }, 150);
  }, { passive: true });
  
  document.addEventListener('scroll', (e) => {
    if (scrollThrottle) return;
    
    const isLibraryScroll = e.target.closest('#libraryList') || e.target.closest('#libraryGrid') || 
                           e.target === document.documentElement || e.target === document.body;
    
    // Only trigger activity if this is a real user scroll, not programmatic
    if (isLibraryScroll && isUserScrolling) {
      debugLog('main', '[USER-ACTIVITY] Real user scroll detected - STOPPING ALL TIMERS IMMEDIATELY');
      updateUserActivity(); // Mark user activity for monitoring system
      
      // NUCLEAR OPTION: Stop ALL possible timers that could cause navigation
      if (searchInactivityTimer) {
        clearTimeout(searchInactivityTimer);
        searchInactivityTimer = null;
        debugLog('main', '[SCROLL-PROTECTION] Stopped searchInactivityTimer');
      }
      
      if (typeof homePageFallbackTimer !== 'undefined' && homePageFallbackTimer) {
        clearTimeout(homePageFallbackTimer);
        homePageFallbackTimer = null;
        debugLog('main', '[SCROLL-PROTECTION] Stopped homePageFallbackTimer');
      }
      
      if (typeof window.homePageFallbackTimer !== 'undefined' && window.homePageFallbackTimer) {
        clearTimeout(window.homePageFallbackTimer);
        window.homePageFallbackTimer = null;
        debugLog('main', '[SCROLL-PROTECTION] Stopped window.homePageFallbackTimer');
      }
      
      // Also stop any activity timer that might exist - INCLUDING THE GLOBAL ONE!
      if (typeof activityTimer !== 'undefined' && activityTimer) {
        clearTimeout(activityTimer);
        activityTimer = null;
        debugLog('main', '[SCROLL-PROTECTION] Stopped local activityTimer');
      }
      
      // CRITICAL: Stop the global activity timer that was causing the issue!
      if (window.currentActivityTimer) {
        clearTimeout(window.currentActivityTimer);
        window.currentActivityTimer = null;
        debugLog('main', '[SCROLL-PROTECTION] Stopped global currentActivityTimer');
      }
      
      scrollThrottle = setTimeout(() => {
        handleNavigationActivity('library-scroll');
        scrollThrottle = null;
      }, 500); // Throttle to once per 500ms
    } else if (isLibraryScroll && !isUserScrolling) {
      debugLog('main', '[USER-ACTIVITY] Programmatic scroll detected, ignoring');
    }
  }, true);
  
  // When search loses focus and is empty, start timer
  searchInput.addEventListener('blur', () => {
    if (!searchInput.value.trim() && isNowPlayingCollapsed) {
      debugLog('main', '[NOW-PLAYING] Search blurred with empty content - starting timer');
      startActivityTimer();
      // Do NOT start fallback timer immediately - let the 15s timer handle it
    }
  });
  
  // Cancel fallback timer on any search input or navigation activity
  searchInput.addEventListener('input', () => {
    if (homePageFallbackTimer) {
      debugLog('main', '[NOW-PLAYING] Search input detected - canceling fallback timer');
      clearTimeout(homePageFallbackTimer);
      homePageFallbackTimer = null;
    }
  });
  
  // Cancel fallback timer when music starts playing
  if (audioPlayer) {
    audioPlayer.addEventListener('play', () => {
      if (homePageFallbackTimer) {
        debugLog('main', '[NOW-PLAYING] Music started - canceling fallback timer');
        clearTimeout(homePageFallbackTimer);
        homePageFallbackTimer = null;
      }
      
      // Expand now playing section when music starts
      if (isNowPlayingCollapsed) {
        debugLog('main', '[NOW-PLAYING] Music started - expanding section');
        expandNowPlayingSection();
      }
    });
    
    // Collapse section when music stops/pauses and no search activity
    audioPlayer.addEventListener('pause', () => {
      const searchInput = document.getElementById('searchInput');
      const searchValue = searchInput ? searchInput.value.trim() : '';
      
      if (!searchValue && !isNowPlayingCollapsed) {
        debugLog('main', '[NOW-PLAYING] Music paused and no search - starting inactivity timer');
        resetInactivityTimer();
      }
    });
    
    audioPlayer.addEventListener('ended', () => {
      const searchInput = document.getElementById('searchInput');
      const searchValue = searchInput ? searchInput.value.trim() : '';
      
      if (!searchValue && !isNowPlayingCollapsed) {
        debugLog('main', '[NOW-PLAYING] Music ended and no search - starting inactivity timer');
        resetInactivityTimer();
      }
    });
  } else {
    console.warn('[NOW-PLAYING] audioPlayer not found - fallback timer cancellation disabled');
  }
  
  debugLog('main', '[NOW-PLAYING] Auto-collapse system initialized with simplified logic');
}

// Toast Notification System
class ToastManager {
  constructor() {
    this.container = null;
    this.init();
  }

  init() {
    // Create toast container if it doesn't exist
    this.container = document.querySelector('.toast-container');
    if (!this.container) {
      this.container = document.createElement('div');
      this.container.className = 'toast-container';
      document.body.appendChild(this.container);
    }
  }

  show(message, type = 'info', duration = 4000) {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    
    this.container.appendChild(toast);
    
    // Auto-remove after duration
    setTimeout(() => {
      this.hide(toast);
    }, duration);
    
    return toast;
  }

  hide(toast) {
    toast.classList.add('hide');
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 300);
  }

  success(message, duration = 4000) {
    return this.show(message, 'success', duration);
  }

  error(message, duration = 5000) {
    return this.show(message, 'error', duration);
  }

  warning(message, duration = 4500) {
    return this.show(message, 'warning', duration);
  }

  info(message, duration = 4000) {
    return this.show(message, 'info', duration);
  }
}

// Global toast manager instance
const toast = new ToastManager();

// Replace all alert() calls with toast notifications
window.alert = function(message) {
  toast.error(message);
};

// 3D Cover Rotation System
let rotation3DTimer = null;
let isPlaying3DAnimation = false;

function startOccasional3DRotations() {
  // Clear any existing timer
  stop3DRotations();
  
  // Schedule random 3D rotations every 15-45 seconds
  function scheduleNext3DRotation() {
    const minDelay = 15000; // 15 seconds
    const maxDelay = 45000; // 45 seconds
    const randomDelay = Math.random() * (maxDelay - minDelay) + minDelay;
    
    rotation3DTimer = setTimeout(() => {
      if (currentTrackIndex !== -1 && queue[currentTrackIndex] && !isPlaying3DAnimation) {
        trigger3DRotation();
      }
      scheduleNext3DRotation(); // Schedule the next one
    }, randomDelay);
    
    debugLog('main', `[3D-ROTATION] Next rotation scheduled in ${Math.round(randomDelay/1000)}s`);
  }
  
  scheduleNext3DRotation();
}

function trigger3DRotation() {
  if (!nowPlayingCoverEl || isPlaying3DAnimation) return;
  
  isPlaying3DAnimation = true;
  
  // Randomly choose between flip and spin animation
  const animations = ['flip-animation', 'spin-animation'];
  const randomAnimation = animations[Math.floor(Math.random() * animations.length)];
  
  debugLog('main', `[3D-ROTATION] Triggering ${randomAnimation}`);
  
  // Add the animation class
  nowPlayingCoverEl.classList.add(randomAnimation);
  
  // Remove the class after animation completes
  setTimeout(() => {
    nowPlayingCoverEl.classList.remove(randomAnimation);
    isPlaying3DAnimation = false;
    debugLog('main', `[3D-ROTATION] ${randomAnimation} completed`);
  }, randomAnimation === 'flip-animation' ? 2000 : 1500);
}

function stop3DRotations() {
  if (rotation3DTimer) {
    clearTimeout(rotation3DTimer);
    rotation3DTimer = null;
    debugLog('main', '[3D-ROTATION] Stopped rotation timer');
  }
  
  // Remove any active animation classes
  if (nowPlayingCoverEl) {
    nowPlayingCoverEl.classList.remove('flip-animation', 'spin-animation');
  }
  
  isPlaying3DAnimation = false;
}

// Footer Progress Indicator System - moved to js/audio.js
// currentTrackDuration and progressUpdateInterval are now global via audio.js

// formatTime moved to js/audio.js

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// updateFooterProgress and updateProgressDisplay moved to js/audio.js

// startFooterProgressUpdates moved to js/audio.js

// stopFooterProgressUpdates moved to js/audio.js

// setTrackDuration moved to js/audio.js

// Global Search Integration
function openGlobalSearch() {
  const currentQuery = document.getElementById('searchInput').value;
  
  // Show integrated search interface
  showIntegratedSearch(currentQuery);
}

function showIntegratedSearch(initialQuery = '') {
  // Switch to search view - use the current global filter
  const currentFilterValue = currentFilter || 'all';
  
  // Update UI to show search mode
  document.getElementById('searchInput').value = initialQuery;
  
  // Trigger enhanced search that includes both local and Spotify
  performEnhancedSearch(initialQuery);
  
  // Update navigation to show search is active
  const navTiles = document.querySelectorAll('.nav-tile');
  navTiles.forEach(tile => tile.classList.remove('active'));
  const globalSearchButton = document.getElementById('globalSearchNavButton');
  if (globalSearchButton) {
    globalSearchButton.classList.add('active');
  }
  
  // Update filter display
  currentFilter = 'search';
  saveAppState();
}

// Enhanced search functionality
// Search module wrapper functions - delegate to js/search.js module

async function performEnhancedSearch(query) {
  // Use Search Module if available
  if (typeof window.SearchModule !== 'undefined' && window.SearchModule.performEnhancedSearch) {
    await window.SearchModule.performEnhancedSearch(query);
    return;
  }
  
  // Fallback: render library if no query
  if (!query.trim()) {
    renderLibrary();
    return;
  }
  
  console.warn('Search module not available - search functionality disabled');
}

function renderEnhancedSearch(query = '') {
  // Use Search Module if available
  if (typeof window.SearchModule !== 'undefined' && window.SearchModule.renderEnhancedSearch) {
    window.SearchModule.renderEnhancedSearch(query);
    return;
  }
  
  console.warn('Search module not available - search functionality disabled');
}

// Helper functions still needed by other parts of the code
async function addSpotifyTrackToLibrary(track) {
  try {
    const response = await fetch(getAPIURL('/api/spotify/add'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        spotify_id: track.id,
        name: track.name,
        artist: track.artist,
        album: track.album,
        year: track.year || '',
        genre: track.genre || 'Unknown',
        duration_ms: track.duration_ms || 0,
        image_url: track.image || '',
        preview_url: track.previewUrl || '',
        spotify_uri: track.uri || '',
        popularity: track.popularity || 0
      })
    });
    
    const result = await response.json();
    
    if (response.ok) {
      toast.success((typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.labels.trackAddedToLibrary') : 'Track zur Bibliothek hinzugefügt!');
      
      // Clear search input after successful track addition
      const searchInput = document.getElementById('searchInput');
      if (searchInput) {
        searchInput.value = '';
        // Trigger search to reset to library view
        performEnhancedSearch('');
      }
      
      // Refresh the library
      await loadMusicLibrary();
    } else if (response.status === 429) {
      // Track was recently added (60-minute protection)
      toast.warning(result.message || ((typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.labels.trackAddedRecently') : 'Track wurde kürzlich hinzugefügt. Bitte warte noch.'));
    } else {
      toast.error(result.message || 'Fehler beim Hinzufügen zur Bibliothek');
    }
  } catch (error) {
    console.error('Error adding Spotify track:', error);
    toast.error('Fehler beim Hinzufügen zur Bibliothek');
  }
}

function addSpotifyTrackToQueue(track) {
  debugLog('main', `[SPOTIFY] Adding Spotify track to queue:`, track);
  
  // Verwende die bestehende queue Variable
  const tempTrack = {
    id: `spotify_${track.id}`,
    title: track.name,
    artist: track.artist,
    album: track.album,
    image: track.image,
    spotify_uri: track.uri,
    type: 'spotify',
    uri: track.uri,
    duration_ms: track.duration_ms,
    isSpotify: true,
    // Explicitly exclude path for Spotify tracks
    path: undefined
  };
  
  debugLog('main', `[SPOTIFY] Created tempTrack with type=${tempTrack.type}, isSpotify=${tempTrack.isSpotify}`);
  
  // Use the existing addToQueue function for consistency
  addToQueue(tempTrack);
  
  // Clear search input after successful track addition to queue
  const searchInput = document.getElementById('searchInput');
  if (searchInput && searchInput.value.trim()) {
    searchInput.value = '';
    // Trigger search to reset to library view
    performEnhancedSearch('');
  }
}

// Function to add a track to queue by ID
async function queueTrack(trackId) {
  try {
    const response = await musicAPI.getTrack(trackId);
    if (response && response.success && response.data) {
      addToQueue(response.data);
    } else {
      console.error('Track not found:', trackId);
      toast.error('Track nicht gefunden');
    }
  } catch (error) {
    console.error('Error loading track:', error);
    toast.error('Fehler beim Laden des Tracks');
  }
}

// Function to play a track by ID
async function playTrack(trackId) {
  try {
    const response = await musicAPI.getTrack(trackId);
    if (response && response.success && response.data) {
      // Add to queue first, then play it
      addToQueue(response.data);
      // If this is the only track in queue, it should auto-play
      if (queue.length === 1) {
        currentTrackIndex = 0;
        // Reset manual stop flag when user starts new playback
        if (userManuallyStoppedMusic) {
          userManuallyStoppedMusic = false;
          debugLog('ui', '[DEBUG] New track started - Auto-DJ reactivated');
        }
        playCurrentTrack();
      }
    } else {
      console.error('Track not found:', trackId);
      toast.error('Track nicht gefunden');
    }
  } catch (error) {
    console.error('Error loading track:', error);
    toast.error('Fehler beim Laden des Tracks');
  }
}

// Listen for messages from search page
window.addEventListener('message', (event) => {
  if (event.origin !== window.location.origin) return;
  
  const { action, trackId, uri } = event.data;
  
  if (action === 'playTrack' && trackId) {
    // Play local track
    playTrack(trackId);
  } else if (action === 'queueTrack' && trackId) {
    // Add local track to queue
    queueTrack(trackId);
  } else if (action === 'playSpotifyTrack' && uri) {
    // Play Spotify track
    playSpotifyTrack(uri);
  }
});

// Spotify Auto-Learning Functions
function initializeSpotifyAutoLearning() {
  // Initialize old buttons for backward compatibility
  const buttons = {
    learnTopTracks: document.getElementById('learnTopTracks'),
    learnPopularPlaylists: document.getElementById('learnPopularPlaylists'),
    learnGenreHits: document.getElementById('learnGenreHits'),
    learnUserPlaylists: document.getElementById('learnUserPlaylists')
  };
  
  Object.keys(buttons).forEach(key => {
    const button = buttons[key];
    if (button) {
      button.addEventListener('click', () => {
        switch(key) {
          case 'learnTopTracks':
            learnTopTracksFromSpotify();
            break;
          case 'learnPopularPlaylists':
            learnPopularPlaylistsFromSpotify();
            break;
          case 'learnGenreHits':
            learnGenreHitsFromSpotify();
            break;
          case 'learnUserPlaylists':
            learnUserPlaylistsFromSpotify();
            break;
        }
      });
    }
  });
  
  // Initialize new admin auto-learning tabs
  initializeAdminMainTabs();
  initializeAdminAutoLearnTabs();
  
  // Update auto-learning section visibility based on Spotify connection
  updateSpotifyAutoLearnVisibility();
}

function updateSpotifyAutoLearnVisibility() {
  const autoLearnSection = document.getElementById('spotifyAutoLearnSection');
  const autoLearnTab = document.querySelector('.admin-main-tab[data-tab="autolearn"]');
  const isConnected = spotifyAccessToken && isSpotifyTokenValid();
  
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

// Admin Auto-Learning Tab Functions
function initializeAdminMainTabs() {
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
        updateAutoLearnStatus();
      }
    });
  });
}

function initializeAdminAutoLearnTabs() {
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
  initializeAdminAutoLearnButtons();
}

function initializeAdminAutoLearnButtons() {
  // Germany buttons - aktualisiert für die neuen Playlists-IDs
  document.getElementById('learnTop100DE')?.addEventListener('click', () => learnFromSpotifyPlaylist('37i9dQZF1DX9vq6oNXHhI6', 'Top 100 Deutschland', 'germany'));
  document.getElementById('learnViral50DE')?.addEventListener('click', () => learnFromSpotifyPlaylist('37i9dQZF1DX0XUsuxWHRQd', 'Viral 50 Deutschland', 'germany'));
  document.getElementById('learnDeutschpop')?.addEventListener('click', () => learnFromGenre('german pop', 'Deutschpop Hits', 'germany'));
  document.getElementById('learnSchlager')?.addEventListener('click', () => learnFromGenre('schlager', 'Oktoberfest', 'germany'));
  
  // Party buttons
  document.getElementById('learnPartyHits')?.addEventListener('click', () => learnFromGenre('party', 'Party Hits', 'party'));
  document.getElementById('learnDanceHits')?.addEventListener('click', () => learnFromGenre('dance', 'Dance Hits', 'party'));
  
  // Batch buttons
  document.getElementById('learnAllGermany')?.addEventListener('click', learnAllGermanyPlaylists);
  document.getElementById('learnAllParty')?.addEventListener('click', learnAllPartyPlaylists);
  
  // Custom playlist buttons
  document.getElementById('addCustomPlaylist')?.addEventListener('click', addCustomPlaylist);
  document.getElementById('loadAllCustom')?.addEventListener('click', loadAllCustomPlaylists);
  document.getElementById('clearCustom')?.addEventListener('click', clearCustomPlaylists);
  
  // Personal buttons
  document.getElementById('learnMyPlaylists')?.addEventListener('click', learnUserPlaylists);
  document.getElementById('learnMyTopTracks')?.addEventListener('click', learnUserTopTracks);
  document.getElementById('learnMyLibrary')?.addEventListener('click', learnUserLibrary);
}

function updateAdminAutoLearnStatus() {
  const statusElement = document.getElementById('autoLearnStatus');
  if (statusElement) {
    const isConnected = spotifyAccessToken && isSpotifyTokenValid();
    statusElement.textContent = isConnected ? 'Spotify verbunden ✓' : 'Spotify nicht verbunden ✗';
    statusElement.style.color = isConnected ? '#1DB954' : '#e74c3c';
  }
}

async function learnTopTracksFromSpotify() {
  const button = document.getElementById('learnTopTracks');
  if (!button || !spotifyAccessToken) return;
  
  const originalText = button.innerHTML;
  button.innerHTML = '⏳ Lade...';
  button.disabled = true;
  
  try {
    // Get Top 50 Global playlist (more reliable than country-specific)
    const response = await fetch('https://api.spotify.com/v1/playlists/37i9dQZEVXbMDoHDwVN2tF/tracks?limit=50', {
      headers: { 'Authorization': `Bearer ${spotifyAccessToken}` }
    });
    
    if (!response.ok) {
      throw new Error(`Spotify API error: ${response.status}`);
    }
    
    const data = await response.json();
    const tracks = data.items?.map(item => item.track).filter(track => track) || [];
    
    await bulkAddSpotifyTracks(tracks, 'Top 50 Global');
    toast.success(`${tracks.length} ${(typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.labels.tracksAddedFromTopTracks') : 'Top-Tracks zur Bibliothek hinzugefügt!'}`);
    
    // Refresh library
    await loadLocalIndex();
  } catch (error) {
    console.error('Error learning top tracks:', error);
    toast.error('Fehler beim Laden der Top-Tracks');
  } finally {
    button.innerHTML = originalText;
    button.disabled = false;
  }
}

async function learnPopularPlaylistsFromSpotify() {
  const button = document.getElementById('learnPopularPlaylists');
  if (!button || !spotifyAccessToken) return;
  
  const originalText = button.innerHTML;
  button.innerHTML = '⏳ Lade...';
  button.disabled = true;
  
  try {
    // Get featured playlists
    // Use search for popular music instead of browse endpoint
    const response = await fetch('https://api.spotify.com/v1/search?q=genre:pop&type=playlist&limit=5', {
      headers: { 'Authorization': `Bearer ${spotifyAccessToken}` }
    });
    
    if (!response.ok) {
      throw new Error(`Spotify API error: ${response.status}`);
    }
    
    const data = await response.json();
    const playlists = data.playlists?.items || [];
    
    let totalTracks = 0;
    for (const playlist of playlists.slice(0, 3)) { // Limit to 3 playlists
      try {
        const tracksResponse = await fetch(`https://api.spotify.com/v1/playlists/${playlist.id}/tracks?limit=20`, {
          headers: { 'Authorization': `Bearer ${spotifyAccessToken}` }
        });
        
        if (tracksResponse.ok) {
          const tracksData = await tracksResponse.json();
          const tracks = tracksData.items?.map(item => item.track).filter(track => track) || [];
          await bulkAddSpotifyTracks(tracks, playlist.name);
          totalTracks += tracks.length;
        }
      } catch (playlistError) {
        console.warn(`Failed to load playlist ${playlist.name}:`, playlistError);
      }
    }
    
    toast.success(`${totalTracks} ${(typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.labels.tracksAddedFromPopularPlaylists') : 'Tracks aus beliebten Playlists hinzugefügt!'}`);
    await loadLocalIndex();
  } catch (error) {
    console.error('Error learning popular playlists:', error);
    toast.error('Fehler beim Laden der Playlists');
  } finally {
    button.innerHTML = originalText;
    button.disabled = false;
  }
}

async function learnGenreHitsFromSpotify() {
  const button = document.getElementById('learnGenreHits');
  if (!button || !spotifyAccessToken) return;
  
  const originalText = button.innerHTML;
  button.innerHTML = '⏳ Lade...';
  button.disabled = true;
  
  try {
    const genres = ['pop', 'rock', 'hip-hop', 'electronic', 'indie'];
    let totalTracks = 0;
    
    for (const genre of genres) {
      try {
        const response = await fetch(`https://api.spotify.com/v1/search?type=track&limit=10&q=genre:${genre}`, {
          headers: { 'Authorization': `Bearer ${spotifyAccessToken}` }
        });
        
        if (response.ok) {
          const data = await response.json();
          const tracks = data.tracks?.items || [];
          await bulkAddSpotifyTracks(tracks, `${genre} hits`);
          totalTracks += tracks.length;
        }
      } catch (genreError) {
        console.warn(`Failed to load ${genre} tracks:`, genreError);
      }
    }
    
    toast.success(`${totalTracks} ${(typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.labels.genreHitsAdded') : 'Genre-Hits hinzugefügt!'}`);
    await loadLocalIndex();
  } catch (error) {
    console.error('Error learning genre hits:', error);
    toast.error('Fehler beim Laden der Genre-Hits');
  } finally {
    button.innerHTML = originalText;
    button.disabled = false;
  }
}

async function learnUserPlaylistsFromSpotify() {
  const button = document.getElementById('learnUserPlaylists');
  if (!button || !spotifyAccessToken) return;
  
  const originalText = button.innerHTML;
  button.innerHTML = '⏳ Lade...';
  button.disabled = true;
  
  try {
    // Get user's playlists
    const response = await fetch('https://api.spotify.com/v1/me/playlists?limit=10', {
      headers: { 'Authorization': `Bearer ${spotifyAccessToken}` }
    });
    
    if (!response.ok) {
      throw new Error(`Spotify API error: ${response.status}`);
    }
    
    const data = await response.json();
    const playlists = data.items || [];
    
    let totalTracks = 0;
    for (const playlist of playlists.slice(0, 5)) { // Limit to 5 playlists
      try {
        const tracksResponse = await fetch(`https://api.spotify.com/v1/playlists/${playlist.id}/tracks?limit=50`, {
          headers: { 'Authorization': `Bearer ${spotifyAccessToken}` }
        });
        
        if (tracksResponse.ok) {
          const tracksData = await tracksResponse.json();
          const tracks = tracksData.items?.map(item => item.track).filter(track => track) || [];
          await bulkAddSpotifyTracks(tracks, playlist.name);
          totalTracks += tracks.length;
        }
      } catch (playlistError) {
        console.warn(`Failed to load playlist ${playlist.name}:`, playlistError);
      }
    }
    
    toast.success(`${totalTracks} Tracks aus Ihren Playlists hinzugefügt!`);
    await loadLocalIndex();
  } catch (error) {
    console.error('Error learning user playlists:', error);
    toast.error('Fehler beim Laden Ihrer Playlists');
  } finally {
    button.innerHTML = originalText;
    button.disabled = false;
  }
}

async function bulkAddSpotifyTracks(tracks, source = '') {
  if (!tracks || tracks.length === 0) return;
  
  const tracksData = tracks.map(track => ({
    spotify_id: track.id,
    name: track.name,
    artist: track.artists?.map(a => a.name).join(', ') || 'Unknown Artist',
    album: track.album?.name || 'Unknown Album',
    year: track.album?.release_date?.slice(0, 4) || '',
    genre: source || 'Unknown',
    duration_ms: track.duration_ms || 0,
    image_url: track.album?.images?.[1]?.url || track.album?.images?.[0]?.url || '',
    preview_url: track.preview_url || '',
    spotify_uri: track.uri || '',
    popularity: track.popularity || 0
  }));
  
  try {
    const response = await fetch(getAPIURL('/api/spotify/bulk-add'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tracks: tracksData })
    });
    
    if (!response.ok) {
      throw new Error(`Server error: ${response.status}`);
    }
    
    const result = await response.json();
    debugLog('main', `Added ${result.addedCount} tracks, skipped ${result.skippedCount} existing`);
  } catch (error) {
    console.error('Error bulk adding tracks:', error);
    throw error;
  }
}

// Auto-Learning Modal Functions
let customPlaylists = [];

function updateAutoLearnStatus() {
  updateAdminAutoLearnStatus();
}

// Playlist loading functions
async function learnFromSpotifyPlaylist(playlistId, name, category = 'general', button = null) {
  // Wenn kein Button übergeben wurde, versuche event.target zu verwenden
  if (!button && typeof event !== 'undefined' && event.target) {
    button = event.target;
  }
  
  if (!spotifyAccessToken) {
    toast.error('Spotify-Authentifizierung erforderlich');
    return;
  }
  
  let originalText = '';
  if (button) {
    originalText = button.innerHTML;
    button.innerHTML = '⏳ Lade...';
    button.disabled = true;
  }
  
  try {
    const response = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=50`, {
      headers: { 'Authorization': `Bearer ${spotifyAccessToken}` }
    });
    
    if (!response.ok) {
      throw new Error(`Spotify API error: ${response.status}`);
    }
    
    const data = await response.json();
    const tracks = data.items?.map(item => item.track).filter(track => track) || [];
    
    // Convert Spotify tracks to the format expected by the system
    const playlistTracks = tracks.map(track => ({
      title: track.name,
      artist: track.artists?.[0]?.name || 'Unknown Artist',
      album: track.album?.name || 'Unknown Album',
      spotifyUri: track.uri,
      spotifyId: track.id,
      source: 'spotify',
      type: 'spotify',
      uri: track.uri,
      image: track.album?.images?.[1]?.url || track.album?.images?.[0]?.url || '',
      spotifyAlbumImage: track.album?.images?.[1]?.url || track.album?.images?.[0]?.url || ''
    }));
    
    // Add to auto-learned playlists for playlist management
    const playlist = {
      id: `spotify_${playlistId}`,
      name: name,
      category: category,
      source: 'spotify',
      tracks: playlistTracks,
      trackCount: playlistTracks.length,
      createdAt: new Date().toISOString()
    };
    
    // Remove existing playlist with same ID and add new one
    autoLearnedPlaylists = autoLearnedPlaylists.filter(p => p.id !== playlist.id);
    autoLearnedPlaylists.push(playlist);
    
    // Also add to library using the existing function
    await bulkAddSpotifyTracks(tracks, name);
    toast.success(`${tracks.length} Tracks aus "${name}" hinzugefügt!`);
    
    await loadLocalIndex();
    updatePlaylistsGrid();
  } catch (error) {
    console.error(`Error learning from ${name}:`, error);
    toast.error(`Fehler beim Laden von "${name}"`);
  } finally {
    if (button) {
      button.innerHTML = originalText;
      button.disabled = false;
    }
  }
}

async function learnFromGenre(genre, name, category = 'general', button = null) {
  // Wenn kein Button übergeben wurde, versuche event.target zu verwenden
  if (!button && typeof event !== 'undefined' && event.target) {
    button = event.target;
  }
  
  if (!spotifyAccessToken) {
    toast.error('Spotify-Authentifizierung erforderlich');
    return;
  }
  
  let originalText = '';
  if (button) {
    originalText = button.innerHTML;
    button.innerHTML = '⏳ Lade...';
    button.disabled = true;
  }
  
  try {
    const response = await fetch(`https://api.spotify.com/v1/search?type=track&limit=50&q=genre:${encodeURIComponent(genre)}`, {
      headers: { 'Authorization': `Bearer ${spotifyAccessToken}` }
    });
    
    if (!response.ok) {
      throw new Error(`Spotify API error: ${response.status}`);
    }
    
    const data = await response.json();
    const tracks = data.tracks?.items || [];
    
    await bulkAddSpotifyTracks(tracks, name);
    
    // Speichere Playlist auch im Auto-DJ System
    if (tracks.length > 0) {
      const playlist = {
        id: `genre_${genre.replace(/\s+/g, '_')}`,
        name: name,
        category: category,
        tracks: tracks.map(track => ({
          id: track.id,
          name: track.name,
          title: track.name,
          artist: track.artists?.[0]?.name || 'Unknown',
          album: track.album?.name || 'Unknown Album',
          uri: track.uri,
          spotifyUri: track.uri,
          spotifyId: track.id,
          source: 'spotify',
          type: 'spotify',
          image: track.album?.images?.[1]?.url || track.album?.images?.[0]?.url || '',
          spotifyAlbumImage: track.album?.images?.[1]?.url || track.album?.images?.[0]?.url || ''
        })),
        createdAt: new Date().toISOString()
      };
      
      autoLearnedPlaylists.push(playlist);
      updatePlaylistsGrid();
    }
    
    toast.success(`${tracks.length} ${name} Tracks hinzugefügt!`);
    
    await loadLocalIndex();
  } catch (error) {
    console.error(`Error learning ${name}:`, error);
    toast.error(`Fehler beim Laden von ${name}`);
  } finally {
    if (button) {
      button.innerHTML = originalText;
      button.disabled = false;
    }
  }
}

async function learnAllGermanyPlaylists() {
  const button = typeof event !== 'undefined' && event.target ? event.target : null;
  if (!spotifyAccessToken) {
    toast.error('Spotify-Authentifizierung erforderlich');
    return;
  }
  
  let originalText = '';
  if (button) {
    originalText = button.innerHTML;
    button.innerHTML = '⏳ Lade alle...';
    button.disabled = true;
  }
  
  try {
    // Germany Playlists - aktualisierte IDs
    await learnFromSpotifyPlaylist('37i9dQZF1DX9vq6oNXHhI6', 'Top 100 Deutschland', 'germany');
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    await learnFromSpotifyPlaylist('37i9dQZF1DX0XUsuxWHRQd', 'Viral 50 Deutschland', 'germany');
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    await learnFromGenre('german pop', 'Deutschpop Hits', 'germany');
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    await learnFromGenre('schlager', 'Oktoberfest', 'germany');

    toast.success('Alle Germany-Playlists erfolgreich geladen!');
    await loadLocalIndex();
  } catch (error) {
    console.error('Error learning all Germany playlists:', error);
    toast.error('Fehler beim Laden aller deutschen Playlists');
  } finally {
    if (button) {
      button.innerHTML = originalText;
      button.disabled = false;
    }
  }
}

async function learnAllPartyPlaylists() {
  const button = typeof event !== 'undefined' && event.target ? event.target : null;
  if (!spotifyAccessToken) {
    toast.error('Spotify-Authentifizierung erforderlich');
    return;
  }
  
  let originalText = '';
  if (button) {
    originalText = button.innerHTML;
    button.innerHTML = '⏳ Lade alle...';
    button.disabled = true;
  }
  
  try {
    await learnFromGenre('party', 'Party Hits', 'party');
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    await learnFromGenre('dance', 'Dance Hits', 'party');

    toast.success('Alle Party-Playlists erfolgreich geladen!');
    await loadLocalIndex();
  } catch (error) {
    console.error('Error learning all party playlists:', error);
    toast.error('Fehler beim Laden aller Party-Playlists');
  } finally {
    if (button) {
      button.innerHTML = originalText;
      button.disabled = false;
    }
  }
}

// Custom playlist functions - DISABLED to prevent 404 errors
async function loadCustomPlaylists() {
  try {
    const response = await fetch(getAPIURL('/api/custom-playlists'));
    if (!response.ok) {
      throw new Error('Failed to load custom playlists');
    }
    
    const data = await response.json();
    customPlaylists = data.playlists || [];
    renderCustomPlaylists();
  } catch (error) {
    console.error('[CUSTOM PLAYLISTS] Error loading playlists:', error);
    customPlaylists = [];
    renderCustomPlaylists();
  }
}

function renderCustomPlaylists() {
  const container = document.getElementById('savedPlaylistsList');
  if (!container) return;
  
  if (customPlaylists.length === 0) {
    const noPlaylistsText = (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? 
      window.i18nSystem.t('ui.messages.noCustomPlaylists') : 
      'Keine gespeicherten Playlists';
    container.innerHTML = `<div style="color: #999; text-align: center; padding: 10px; font-size: 0.85rem;">${noPlaylistsText}</div>`;
    return;
  }
  
  container.innerHTML = customPlaylists.map((playlist) => `
    <div class="custom-playlist-item">
      <div class="custom-playlist-info">
        <div class="custom-playlist-name">${playlist.name}</div>
        <div class="custom-playlist-url">${playlist.spotify_url || playlist.url}</div>
      </div>
      <div class="custom-playlist-actions">
        <button class="custom-playlist-btn load" onclick="loadCustomPlaylist(${playlist.id})">Laden</button>
        <button class="custom-playlist-btn delete" onclick="deleteCustomPlaylist(${playlist.id})">Löschen</button>
      </div>
    </div>
  `).join('');
}

async function addCustomPlaylist() {
  const nameInput = document.getElementById('customPlaylistName');
  const urlInput = document.getElementById('customPlaylistUrl');
  
  if (!nameInput || !urlInput) return;
  
  const name = nameInput.value.trim();
  const url = urlInput.value.trim();
  
  if (!name || !url) {
    toast.error('Name und URL sind erforderlich');
    return;
  }
  
  if (customPlaylists.length >= 5) {
    toast.error('Maximal 5 Custom Playlists erlaubt');
    return;
  }
  
  // Validate Spotify URL
  if (!url.includes('spotify.com/playlist/') && !url.includes('open.spotify.com/playlist/')) {
    toast.error('Ungültige Spotify Playlist URL');
    return;
  }
  
  try {
    const response = await fetch(getAPIURL('/api/custom-playlists'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, url })
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Server error');
    }
    
    await loadCustomPlaylists(); // Reload from database
    
    nameInput.value = '';
    urlInput.value = '';
    
    toast.success('Playlist gespeichert!');
  } catch (error) {
    console.error('Error saving custom playlist:', error);
    toast.error(error.message || 'Fehler beim Speichern der Playlist');
  }
}

async function loadCustomPlaylist(index) {
  const playlist = customPlaylists[index];
  if (!playlist || !spotifyAccessToken) return;
  
  try {
    // Extract playlist ID from URL
    const playlistId = playlist.url.match(/playlist\/([a-zA-Z0-9]+)/)?.[1];
    if (!playlistId) {
      toast.error('Ungültige Playlist URL');
      return;
    }
    
    const response = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=50`, {
      headers: { 'Authorization': `Bearer ${spotifyAccessToken}` }
    });
    
    if (!response.ok) {
      throw new Error(`Spotify API error: ${response.status}`);
    }
    
    const data = await response.json();
    const tracks = data.items?.map(item => item.track).filter(track => track) || [];
    
    await bulkAddSpotifyTracks(tracks, playlist.name);
    toast.success(`${tracks.length} Tracks aus "${playlist.name}" hinzugefügt!`);
    
    await loadLocalIndex();
  } catch (error) {
    console.error('Error loading custom playlist:', error);
    toast.error('Fehler beim Laden der Playlist');
  }
}

async function deleteCustomPlaylist(id) {
  const playlist = customPlaylists.find(p => p.id === id);
  if (!playlist) return;
  
  if (!confirm(`Playlist "${playlist.name}" löschen?`)) return;
  
  try {
    const response = await fetch(getAPIURL(`/api/custom-playlists/${id}`), {
      method: 'DELETE'
    });
    
    if (!response.ok) {
      throw new Error('Server error');
    }
    
    await loadCustomPlaylists(); // Reload from database
    renderCustomPlaylists();
    
    toast.success((typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.labels.playlistDeleted') : 'Playlist gelöscht!');
  } catch (error) {
    console.error('Error deleting custom playlist:', error);
    toast.error('Fehler beim Löschen der Playlist');
  }
}

async function loadAllCustomPlaylists() {
  const button = event.target;
  if (!button || !spotifyAccessToken || customPlaylists.length === 0) return;
  
  const originalText = button.innerHTML;
  button.innerHTML = '⏳ Lade alle...';
  button.disabled = true;
  
  try {
    let totalTracks = 0;
    
    for (const playlist of customPlaylists) {
      try {
        // Check if playlist has a valid URL
        const playlistUrl = playlist.spotify_url || playlist.url;
        if (!playlistUrl || typeof playlistUrl !== 'string') {
          console.warn(`Skipping playlist "${playlist.name}" - no valid URL found`);
          continue;
        }
        
        const playlistId = playlistUrl.match(/playlist\/([a-zA-Z0-9]+)/)?.[1];
        if (!playlistId) {
          console.warn(`Skipping playlist "${playlist.name}" - invalid Spotify URL format:`, playlistUrl);
          continue;
        }
        
        const response = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=50`, {
          headers: { 'Authorization': `Bearer ${spotifyAccessToken}` }
        });
        
        if (response.ok) {
          const data = await response.json();
          const tracks = data.items?.map(item => item.track).filter(track => track) || [];
          await bulkAddSpotifyTracks(tracks, playlist.name);
          totalTracks += tracks.length;
        }
      } catch (error) {
        console.warn(`Failed to load custom playlist ${playlist.name}:`, error);
      }
    }
    
    toast.success(`${totalTracks} Tracks aus Custom Playlists hinzugefügt!`);
    await loadLocalIndex();
  } catch (error) {
    console.error('Error loading all custom playlists:', error);
    toast.error('Fehler beim Laden der Custom Playlists');
  } finally {
    button.innerHTML = originalText;
    button.disabled = false;
  }
}

async function clearCustomPlaylists() {
  if (!confirm('Alle Custom Playlists löschen?')) return;
  
  try {
    const response = await fetch(getAPIURL('/api/custom-playlists'), {
      method: 'DELETE'
    });
    
    if (!response.ok) {
      throw new Error('Server error');
    }
    
    await loadCustomPlaylists(); // Reload from database
    
    toast.success('Alle Custom Playlists gelöscht!');
  } catch (error) {
    console.error('Error clearing custom playlists:', error);
    toast.error('Fehler beim Löschen der Playlists');
  }
}

// Personal playlist functions
async function learnUserPlaylists() {
  const button = event.target;
  if (!button || !spotifyAccessToken) return;
  
  const originalText = button.innerHTML;
  button.innerHTML = '⏳ Lade...';
  button.disabled = true;
  
  try {
    const response = await fetch('https://api.spotify.com/v1/me/playlists?limit=20', {
      headers: { 'Authorization': `Bearer ${spotifyAccessToken}` }
    });
    
    if (!response.ok) {
      throw new Error(`Spotify API error: ${response.status}`);
    }
    
    const data = await response.json();
    const playlists = data.items || [];
    
    let totalTracks = 0;
    for (const playlist of playlists.slice(0, 10)) {
      try {
        const tracksResponse = await fetch(`https://api.spotify.com/v1/playlists/${playlist.id}/tracks?limit=50`, {
          headers: { 'Authorization': `Bearer ${spotifyAccessToken}` }
        });
        
        if (tracksResponse.ok) {
          const tracksData = await tracksResponse.json();
          const tracks = tracksData.items?.map(item => item.track).filter(track => track) || [];
          await bulkAddSpotifyTracks(tracks, `Meine Playlist: ${playlist.name}`);
          totalTracks += tracks.length;
        }
      } catch (playlistError) {
        console.warn(`Failed to load playlist ${playlist.name}:`, playlistError);
      }
    }
    
    toast.success(`${totalTracks} Tracks aus Ihren Playlists hinzugefügt!`);
    await loadLocalIndex();
  } catch (error) {
    console.error('Error learning user playlists:', error);
    toast.error('Fehler beim Laden Ihrer Playlists');
  } finally {
    button.innerHTML = originalText;
    button.disabled = false;
  }
}

async function learnUserTopTracks() {
  const button = event.target;
  if (!button || !spotifyAccessToken) return;
  
  const originalText = button.innerHTML;
  button.innerHTML = '⏳ Lade...';
  button.disabled = true;
  
  try {
    const response = await fetch('https://api.spotify.com/v1/me/top/tracks?limit=50&time_range=medium_term', {
      headers: { 'Authorization': `Bearer ${spotifyAccessToken}` }
    });
    
    if (!response.ok) {
      throw new Error(`Spotify API error: ${response.status}`);
    }
    
    const data = await response.json();
    const tracks = data.items || [];
    
    await bulkAddSpotifyTracks(tracks, 'Meine Top Tracks');
    toast.success(`${tracks.length} Ihrer Top Tracks hinzugefügt!`);
    
    await loadLocalIndex();
  } catch (error) {
    console.error('Error learning user top tracks:', error);
    toast.error('Fehler beim Laden Ihrer Top Tracks');
  } finally {
    button.innerHTML = originalText;
    button.disabled = false;
  }
}

async function learnUserLibrary() {
  const button = event.target;
  if (!button || !spotifyAccessToken) return;
  
  const originalText = button.innerHTML;
  button.innerHTML = '⏳ Lade...';
  button.disabled = true;
  
  try {
    const response = await fetch('https://api.spotify.com/v1/me/tracks?limit=50', {
      headers: { 'Authorization': `Bearer ${spotifyAccessToken}` }
    });
    
    if (!response.ok) {
      throw new Error(`Spotify API error: ${response.status}`);
    }
    
    const data = await response.json();
    const tracks = data.items?.map(item => item.track).filter(track => track) || [];
    
    await bulkAddSpotifyTracks(tracks, 'Meine Bibliothek');
    toast.success(`${tracks.length} Tracks aus Ihrer Bibliothek hinzugefügt!`);
    
    await loadLocalIndex();
  } catch (error) {
    console.error('Error learning user library:', error);
    toast.error('Fehler beim Laden Ihrer Bibliothek');
  } finally {
    button.innerHTML = originalText;
    button.disabled = false;
  }
}

// Touch Keyboard Functionality
function initializeTouchKeyboard() {
  const toggleButton = document.getElementById('touchKeyboardToggle');
  const closeButton = document.getElementById('closeTouchKeyboard');
  const keyboard = document.getElementById('touchKeyboard');
  const searchInput = document.getElementById('searchInput');
  
  if (!toggleButton || !closeButton || !keyboard || !searchInput) {
    debugLog('KEYBOARD', 'Touch keyboard elements not found');
    return;
  }
  
  let keyboardJustUsed = false;
  
  // Toggle keyboard visibility
  toggleButton.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleKeyboard();
  });
  
  // Close keyboard
  closeButton.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    hideKeyboard();
  });
  
  // Show keyboard when clicking on search input on touch devices
  searchInput.addEventListener('click', (e) => {
    if (isTouchDevice() && keyboard.classList.contains('hidden')) {
      e.preventDefault();
      showKeyboard();
    }
  });
  
  // Show keyboard when focusing on search input (for both touch and desktop)
  searchInput.addEventListener('focus', (e) => {
    if (keyboard.classList.contains('hidden')) {
      showKeyboard();
    }
  });
  
  // Key press handlers
  keyboard.addEventListener('click', (e) => {
    if (e.target.classList.contains('touch-key')) {
      const key = e.target.dataset.key;
      const action = e.target.dataset.action;
      
      if (key) {
        addToSearchInput(key);
      } else if (action) {
        handleKeyboardAction(action);
      }
      
      // Visual feedback
      e.target.style.transform = 'scale(0.9)';
      setTimeout(() => {
        e.target.style.transform = '';
      }, 100);
    }
  });
  
  // Close keyboard when clicking outside (but not on mobile)
  document.addEventListener('click', (e) => {
    if (!keyboard.contains(e.target) && 
        !toggleButton.contains(e.target) && 
        !searchInput.contains(e.target)) {
      if (!keyboard.classList.contains('hidden') && !isTouchDevice()) {
        hideKeyboard();
      }
    }
  });
  
  function toggleKeyboard() {
    if (keyboard.classList.contains('hidden')) {
      showKeyboard();
    } else {
      hideKeyboard();
    }
  }
  
  function showKeyboard() {
    keyboard.classList.remove('hidden');
    toggleButton.classList.add('active');
    
    // Focus search input
    searchInput.focus();
    keyboardJustUsed = true;
    
    // No padding changes - keyboard is pure overlay like PIN panel
    
    debugLog('KEYBOARD', 'Touch keyboard shown');
  }
  
  function hideKeyboard() {
    keyboard.classList.add('hidden');
    toggleButton.classList.remove('active');
    
    // No padding changes - keyboard is pure overlay like PIN panel
    
    debugLog('KEYBOARD', 'Touch keyboard hidden');
  }
  
  function addToSearchInput(char) {
    const currentValue = searchInput.value;
    const cursorPos = searchInput.selectionStart || currentValue.length;
    
    // Insert character at cursor position
    const newValue = currentValue.slice(0, cursorPos) + char + currentValue.slice(cursorPos);
    searchInput.value = newValue;
    
    // Move cursor to after inserted character
    searchInput.setSelectionRange(cursorPos + 1, cursorPos + 1);
    
    // Keep input focused
    searchInput.focus();
    keyboardJustUsed = true;
    
    // Trigger search if there's a search handler
    if (searchInput.dispatchEvent) {
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }
  
  function handleKeyboardAction(action) {
    const cursorPos = searchInput.selectionStart || searchInput.value.length;
    
    switch (action) {
      case 'backspace':
        if (cursorPos > 0) {
          const currentValue = searchInput.value;
          searchInput.value = currentValue.slice(0, cursorPos - 1) + currentValue.slice(cursorPos);
          searchInput.setSelectionRange(cursorPos - 1, cursorPos - 1);
        }
        break;
        
      case 'clear':
        searchInput.value = '';
        break;
    }
    
    // Keep input focused
    searchInput.focus();
    keyboardJustUsed = true;
    
    // Trigger search update
    if (searchInput.dispatchEvent) {
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }
  
  function isTouchDevice() {
    return (('ontouchstart' in window) ||
            (navigator.maxTouchPoints > 0) ||
            (navigator.msMaxTouchPoints > 0) ||
            window.innerWidth <= 768);
  }
}

// Spezifische Event-Listener für echte Benutzeraktivität
document.addEventListener('DOMContentLoaded', async () => {
  // Nur bei echten Benutzerinteraktionen Timer zurücksetzen
  const importantElements = [
    '#sideNav',      // Navigation
    '#searchInput',  // Suche
    '#queue',        // Playlist
    '#controls',     // Player Controls
    '#adminButton',  // Admin Button
    '#libraryGrid',  // Library Grid
    '#libraryList',  // Library List
    '#pinKeypad'     // PIN Keypad
  ];
  
  importantElements.forEach(selector => {
    const element = document.querySelector(selector);
    if (element) {
      // Nur click und input events für echte Aktivität
      element.addEventListener('click', () => {
        if (typeof resetInactivityTimer === 'function') {
          resetInactivityTimer();
        }
      }, true);
      if (selector === '#searchInput') {
        element.addEventListener('input', () => {
          if (typeof resetInactivityTimer === 'function') {
            resetInactivityTimer();
          }
        });
        element.addEventListener('keydown', () => {
          if (typeof resetInactivityTimer === 'function') {
            resetInactivityTimer();
          }
        });
      }
    }
  });
  
  // Initialize controls state after everything is set up
  // Don't auto-restore admin status - user should always authenticate first
  
  updateControlsState();
  
  // Initialize theming system
  if (typeof window.ThemingSystem !== 'undefined') {
    window.themingSystem = new window.ThemingSystem();
    await window.themingSystem.initialize();
  }
  
  debugLog('main', '[INIT] DOMContentLoaded initialization complete');
});

// Auto-Learning Playlist Management - ZUSÄTZLICH ZUR BESTEHENDEN LOGIK
let autoLearnedPlaylists = [];
let isAutoDjActive = false;
let autoDjInterval = null;
let autoDjPlaybackInterval = null;
let autoDjCooldown = false;
let lastPlaybackStopTime = null;
let userManuallyStoppedMusic = false;

// Auto-DJ Settings
const AUTO_DJ_CONFIG = {
  enabled: false,
  checkInterval: 10000,  // 10 seconds
  cooldownTime: 60000,   // 1 minute between selections
  minQueueLength: 2,     // Start filling when queue has 2 or fewer tracks
  maxTracksToAdd: 15     // Add up to 15 tracks at once for better coverage
};

// Auto-DJ and playlist initialization functions moved to js/playlists.js

// Play a specific playlist
// Complete Auto-DJ initialization function
function completeAutoDjInitialization() {
  // Load Auto-DJ settings from storage
  loadAutoDjSettings();
  
  debugLog('main', '[AUTO-DJ] Initialization complete');
}

// Show playlists section
function showPlaylistsSection() {
  debugLog('main', '[PLAYLISTS] Showing playlists section');
  
  // Hide library container but preserve now-playing if music is active
  const nowPlayingSection = document.getElementById('nowPlayingSection');
  const libraryContainer = document.getElementById('libraryContainer');
  
  // Only hide now-playing if no music is actually playing
  const hasActiveMusic = queue.length > 0 && currentTrackIndex >= 0 && queue[currentTrackIndex];
  if (nowPlayingSection && !hasActiveMusic) {
    nowPlayingSection.style.display = 'none';
  }
  if (libraryContainer) libraryContainer.style.display = 'none';
  
  // Show playlists section
  const playlistsSection = document.getElementById('playlists-section');
  if (playlistsSection) {
    playlistsSection.style.display = 'block';
    loadPlaylistsSection();
  }
  
  // Update navigation state properly
  updateNavActiveState('playlists');
  
  // Reset navigation hierarchy
  navigationState.level = 'playlists';
  navigationState.currentArtist = null;
  navigationState.currentAlbum = null;
  navigationState.currentFilter = 'playlists';
  
  // Update breadcrumb
  updateBreadcrumb();
}

// Load and display playlists
// Playlist grid and filtering functions moved to js/playlists.js

// Auto-DJ Helper für Custom Playlists
async function loadSpotifyPlaylistTracks(playlistId) {
  if (!spotifyAccessToken) {
    throw new Error('Spotify-Authentifizierung erforderlich');
  }
  
  try {
    const response = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=50`, {
      headers: { 'Authorization': `Bearer ${spotifyAccessToken}` }
    });
    
    if (!response.ok) {
      throw new Error(`Spotify API error: ${response.status}`);
    }
    
    const data = await response.json();
    const tracks = data.items?.map(item => item.track).filter(track => track) || [];
    
    // Convert Spotify tracks to the format expected by the system
    return tracks.map(track => ({
      title: track.name,
      artist: track.artists?.[0]?.name || 'Unknown Artist',
      album: track.album?.name || 'Unknown Album',
      spotifyUri: track.uri,
      spotifyId: track.id,
      source: 'spotify',
      type: 'spotify',
      uri: track.uri,
      image: track.album?.images?.[1]?.url || track.album?.images?.[0]?.url || '',
      spotifyAlbumImage: track.album?.images?.[1]?.url || track.album?.images?.[0]?.url || ''
    }));
  } catch (error) {
    console.error('[SPOTIFY] Error loading playlist tracks:', error);
    throw error;
  }
}

// Auto-DJ Helper für Custom Playlists
async function loadCustomPlaylistForAutoDj(playlist, forceReload = false) {
  try {
    const playlistName = playlist.name;
    const playlistUrl = playlist.spotify_url || playlist.url;
    
    if (!playlistUrl || typeof playlistUrl !== 'string') {
      console.error('[AUTO-DJ] No valid URL found for playlist:', playlistName);
      showNotification(`❌ Ungültige URL für Playlist "${playlistName}"`);
      return 0;
    }
    
    showNotification(`🤖 Auto-DJ: Lade Songs aus "${playlistName}"...`);
    
    // Prüfen ob es eine Spotify-Playlist ist
    if (playlistUrl.includes('spotify.com/playlist/')) {
      debugLog('main', '[AUTO-DJ] Detected Spotify playlist, using Spotify Web API...');
      
      // Spotify ID extrahieren
      const playlistIdMatch = playlistUrl.match(/playlist\/([a-zA-Z0-9]+)/);
      if (!playlistIdMatch) {
        console.error('[AUTO-DJ] Invalid Spotify URL:', playlistUrl);
        showNotification(`❌ Ungültige Spotify URL: ${playlistUrl}`);
        return 0;
      }
      
      const playlistId = playlistIdMatch[1];
      
      try {
        // Verwende die Spotify Web API direkt
        const tracks = await loadSpotifyPlaylistTracks(playlistId);
        if (tracks && tracks.length > 0) {
          let addedCount = 0;
          for (const track of tracks.slice(0, AUTO_DJ_CONFIG.maxTracksToAdd)) {
            if (await addToQueueForAutoDj(track)) {
              addedCount++;
            }
          }
          debugLog('main', `[AUTO-DJ] Added ${addedCount} tracks from Spotify playlist "${playlistName}"`);
          showNotification(`🎵 Auto-DJ: ${addedCount} Songs aus "${playlistName}" hinzugefügt`);
          return addedCount;
        } else {
          debugLog('main', '[AUTO-DJ] No tracks found in Spotify playlist');
          showNotification(`⚠️ Keine Songs in "${playlistName}" gefunden`);
          return 0;
        }
      } catch (error) {
        console.error('[AUTO-DJ] Error loading Spotify playlist:', error);
        showNotification(`❌ Fehler beim Laden der Spotify-Playlist: ${error.message}`);
        return 0;
      }
    }
    
    // Für lokale/andere Playlists (Fallback für nicht-Spotify URLs)
    try {
      const response = await fetch(playlistUrl);
      
      if (!response.ok) {
        console.error('[AUTO-DJ] Failed to load playlist:', response.status);
        showNotification(`❌ Fehler beim Laden der Playlist: ${response.statusText}`);
        return 0;
      }
      
      const data = await response.json();
      const tracks = data.tracks || [];
      
      if (tracks.length === 0) {
        debugLog('main', '[AUTO-DJ] No tracks found in playlist');
        showNotification(`⚠️ Keine Songs in "${playlistName}" gefunden`);
        return 0;
      }
      
      // Mehr Songs für bessere Abdeckung - doppelte Menge
      const tracksToAdd = Math.min(AUTO_DJ_CONFIG.maxTracksToAdd * 2, tracks.length);
      const shuffledTracks = [...tracks].sort(() => Math.random() - 0.5);
      
      let addedCount = 0;
      for (let i = 0; i < tracksToAdd; i++) {
        const track = shuffledTracks[i];
        
        // Verwende Auto-DJ spezifische addToQueue Funktion
        const success = addToQueueForAutoDj(track);
        if (success) {
          addedCount++;
          debugLog('main', '[AUTO-DJ] Added custom track:', track.title, 'by', track.artist);
        }
      }
      
      debouncedUpdateQueueDisplay();
      showNotification(`🤖 Auto-DJ: ${addedCount} Songs aus Custom Playlist "${playlistName}" hinzugefügt`);
      
      return addedCount;
      
    } catch (localError) {
      console.error('[AUTO-DJ] Error loading local playlist:', localError);
      showNotification(`❌ Fehler beim Laden der lokalen Playlist: ${localError.message}`);
      return 0;
    }
    
  } catch (error) {
    console.error('[AUTO-DJ] Error loading custom playlist:', error);
    showNotification(`❌ Fehler beim Laden der Custom Playlist: ${error.message}`);
    return 0;
  }
}

// Auto-DJ Helper für Auto-learned Playlists
async function loadAutoLearnedPlaylistForAutoDj(playlist) {
  try {
    // Immer die komplette Playlist hinzufügen für bessere Abdeckung
    const tracksToAdd = Math.min(AUTO_DJ_CONFIG.maxTracksToAdd * 2, playlist.tracks.length);
    const shuffledTracks = [...playlist.tracks].sort(() => Math.random() - 0.5);
    
    let addedCount = 0;
    for (let i = 0; i < tracksToAdd; i++) {
      const track = shuffledTracks[i];
      
      // Verwende Auto-DJ spezifische addToQueue Funktion
      const success = addToQueueForAutoDj(track);
      if (success) {
        addedCount++;
        debugLog('main', '[AUTO-DJ] Added track:', track.title, 'by', track.artist);
      }
    }
    
    debouncedUpdateQueueDisplay();
    showNotification(`🤖 Auto-DJ: ${addedCount} Songs aus "${playlist.name}" hinzugefügt`);
    
    return addedCount;
    
  } catch (error) {
    console.error('[AUTO-DJ] Error loading auto-learned playlist:', error);
    return 0;
  }
}

// Auto-DJ Functions
function toggleAutoDj(enabled) {
  debugLog('main', '[AUTO-DJ] Toggle:', enabled);
  
  AUTO_DJ_CONFIG.enabled = enabled;
  isAutoDjActive = enabled;
  
  // Update all status indicators
  updateAutoDjStatusDisplay(enabled);
  
  if (enabled) {
    startAutoDj();
  } else {
    stopAutoDj();
  }
  
  // Save settings
  saveAutoDjSettings();
}

// Update Auto-DJ status display in multiple locations
function updateAutoDjStatusDisplay(isActive) {
  const indicators = document.querySelectorAll('#autoDjStatusIndicator');
  indicators.forEach(indicator => {
    if (indicator) {
      indicator.textContent = isActive ? 'AKTIV' : 'INAKTIV';
      indicator.style.color = isActive ? '#1DB954' : '#666';
    }
  });
}

function startAutoDj() {
  debugLog('main', '[AUTO-DJ] Starting Auto-DJ...');
  
  if (autoDjInterval) {
    clearInterval(autoDjInterval);
  }
  
  if (autoDjPlaybackInterval) {
    clearInterval(autoDjPlaybackInterval);
  }
  
  // Haupt-Intervall für Queue-Überwachung
  autoDjInterval = setInterval(checkAndFillQueue, AUTO_DJ_CONFIG.checkInterval);
  
  // Zusätzliches Intervall für Playback-Überwachung (häufiger)
  autoDjPlaybackInterval = setInterval(() => {
    if (!isAutoDjActive) return;
    
    // Prüfe ob Musik spielt oder Queue leer ist
    const audio = audioPlayer || document.getElementById('audioPlayer');
    const isPlaying = audio && !audio.paused;
    const hasUpcomingTracks = queue.length > (currentTrackIndex + 1);
    
    if (!isPlaying && !hasUpcomingTracks && queue.length === 0) {
      debugLog('main', '[AUTO-DJ] No music playing and empty queue - triggering immediate fill');
      checkAndFillQueue();
    } else if (!isPlaying && currentTrackIndex === -1 && queue.length > 0) {
      debugLog('main', '[AUTO-DJ] Queue has tracks but no playback - starting playback');
      debugLog('main', '[AUTO-DJ] Queue length:', queue.length, 'First track:', queue[0]);
      
      // SEHR robuste Validierung für alle Track-Typen
      if (queue.length > 0 && queue[0]) {
        const firstTrack = queue[0];
        const hasValidId = firstTrack.id || firstTrack.spotify_id || firstTrack.spotifyId || firstTrack.path || firstTrack.streamUrl || firstTrack.uri || firstTrack.spotifyUri;
        
        if (hasValidId) {
          debugLog('main', '[AUTO-DJ] Starting playbook with valid track:', firstTrack);
          setTimeout(() => {
            if (queue.length > 0) { // Doppelt prüfen vor playback
              currentTrackIndex = 0;
              playCurrentTrack();
            } else {
              debugLog('main', '[AUTO-DJ] Queue became empty before playback start');
            }
          }, 500);
        } else {
          debugLog('main', '[AUTO-DJ] First track has no valid ID, removing and trying next');
          queue.shift(); // Entferne ungültigen Track
          debouncedUpdateQueueDisplay();
          if (queue.length > 0) {
            setTimeout(() => checkAndFillQueue(), 500); // Versuche mit nächstem Track
          } else {
            debugLog('main', '[AUTO-DJ] Queue is now empty, filling again');
            setTimeout(() => checkAndFillQueue(), 1000);
          }
        }
      } else {
        debugLog('main', '[AUTO-DJ] Queue length inconsistent, resetting');
        queue.length = 0;
        currentTrackIndex = -1;
        debouncedUpdateQueueDisplay();
        setTimeout(() => checkAndFillQueue(), 1000);
      }
    } else if (!isPlaying && hasUpcomingTracks && currentTrackIndex >= 0 && !userManuallyStoppedMusic) {
      // Only auto-continue if user didn't manually stop the music
      // Gebe Spotify und anderen Playern Zeit zum Starten (15 Sekunden Puffer)
      const currentTime = Date.now();
      if (!lastPlaybackStopTime) {
        lastPlaybackStopTime = currentTime;
        debugLog('main', '[AUTO-DJ] Music appears stopped, starting 15-second grace period');
      } else if (currentTime - lastPlaybackStopTime > 15000) {
        debugLog('main', '[AUTO-DJ] Music stopped for 15+ seconds with queue tracks - continuing playback');
        skipTrack();
        lastPlaybackStopTime = null; // Reset für nächsten Track
      } else {
        debugLog('main', '[AUTO-DJ] Music stopped but still in grace period:', Math.round((15000 - (currentTime - lastPlaybackStopTime)) / 1000), 'seconds remaining');
      }
    } else if (!isPlaying && hasUpcomingTracks && userManuallyStoppedMusic) {
      // User manually stopped - don't auto-continue, but show status
      if (!lastPlaybackStopTime) {
        lastPlaybackStopTime = Date.now();
        debugLog('main', '[AUTO-DJ] Music manually stopped by user - Auto-DJ paused');
      }
    } else if (isPlaying && lastPlaybackStopTime) {
      // Reset stop time when music plays again
      debugLog('main', '[AUTO-DJ] Music resumed, resetting grace period');
      lastPlaybackStopTime = null;
      // If music starts playing again, assume user interaction - reset manual stop flag
      if (userManuallyStoppedMusic) {
        userManuallyStoppedMusic = false;
        debugLog('main', '[AUTO-DJ] Music playing again - Auto-DJ resumed');
      }
    }
  }, 5000); // Alle 5 Sekunden prüfen
  
  // Initial check
  setTimeout(() => checkAndFillQueue(), 2000);
}

function stopAutoDj() {
  debugLog('main', '[AUTO-DJ] Stopping Auto-DJ...');
  
  if (autoDjInterval) {
    clearInterval(autoDjInterval);
    autoDjInterval = null;
  }
  
  if (autoDjPlaybackInterval) {
    clearInterval(autoDjPlaybackInterval);
    autoDjPlaybackInterval = null;
  }
}

async function checkAndFillQueue() {
  if (!isAutoDjActive) return;
  
  const queueLength = queue.length - (currentTrackIndex + 1);
  debugLog('main', '[AUTO-DJ] Checking queue... Current length:', queueLength);
  
  // Robustere Bedingungen: Queue niedrig ODER Auto-DJ wurde gerade aktiviert
  const shouldAddTracks = queueLength <= AUTO_DJ_CONFIG.minQueueLength || 
                         (!autoDjCooldown && queueLength === 0);
  
  if (shouldAddTracks) {
    debugLog('main', '[AUTO-DJ] Queue needs filling, adding tracks...');
    await addAutoDjTracks();
    
    // Falls keine Musik spielt und Queue Tracks hat, starte Playback
    if (currentTrackIndex === -1 && queue.length > 0) {
      debugLog('main', '[AUTO-DJ] Starting playback from Auto-DJ...');
      debugLog('main', '[AUTO-DJ] Queue length:', queue.length, 'First track:', queue[0]);
      
      // SEHR robuste Validierung für alle Track-Typen
      if (queue.length > 0 && queue[0]) {
        const firstTrack = queue[0];
        const hasValidId = firstTrack.id || firstTrack.spotify_id || firstTrack.spotifyId || firstTrack.path || firstTrack.streamUrl || firstTrack.uri || firstTrack.spotifyUri;
        
        if (hasValidId) {
          debugLog('main', '[AUTO-DJ] Starting playback with valid track:', firstTrack);
          setTimeout(() => {
            if (queue.length > 0) { // Doppelt prüfen vor playback
              currentTrackIndex = 0;
              playCurrentTrack();
            } else {
              debugLog('main', '[AUTO-DJ] Queue became empty before playback start');
            }
          }, 500);
        } else {
          debugLog('main', '[AUTO-DJ] First track has no valid ID, removing it');
          queue.shift(); // Entferne ungültigen Track
          debouncedUpdateQueueDisplay();
        }
      } else {
        debugLog('main', '[AUTO-DJ] Queue length inconsistent after filling, resetting');
        queue.length = 0;
        currentTrackIndex = -1;
        debouncedUpdateQueueDisplay();
      }
    }
  }
}

async function addAutoDjTracks() {
  // Priorität: Custom Playlists > Auto-learned Playlists
  let availablePlaylists = [];
  
  // Zuerst Custom Playlists prüfen
  if (customPlaylists && customPlaylists.length > 0) {
    // Custom Playlists haben Vorrang
    availablePlaylists = customPlaylists.map(cp => ({
      name: cp.name,
      url: cp.spotify_url || cp.url,
      isCustom: true
    }));
    debugLog('main', '[AUTO-DJ] Using custom playlists:', availablePlaylists.length);
  } else if (autoLearnedPlaylists.length > 0) {
    // Fallback auf Auto-learned Playlists
    availablePlaylists = autoLearnedPlaylists;
    debugLog('main', '[AUTO-DJ] Using auto-learned playlists:', availablePlaylists.length);
  }
  
  if (availablePlaylists.length === 0) {
    debugLog('main', '[AUTO-DJ] No playlists available for Auto-DJ');
    showNotification('⚠️ Auto-DJ: Keine Playlists verfügbar');
    return;
  }
  
  try {
    autoDjCooldown = true;
    
    // Select random playlist
    const randomPlaylist = availablePlaylists[Math.floor(Math.random() * availablePlaylists.length)];
    debugLog('main', '[AUTO-DJ] Selected playlist:', randomPlaylist.name, randomPlaylist.isCustom ? '(Custom)' : '(Auto-learned)');
    
    let tracksAdded = 0;
    
    if (randomPlaylist.isCustom) {
      // Für Custom Playlists: Lade Songs direkt von Spotify
      tracksAdded = await loadCustomPlaylistForAutoDj(randomPlaylist);
    } else if (randomPlaylist.tracks && randomPlaylist.tracks.length > 0) {
      // Für Auto-learned Playlists: Verwende gespeicherte Tracks
      tracksAdded = await loadAutoLearnedPlaylistForAutoDj(randomPlaylist);
    }
    
    debugLog('main', '[AUTO-DJ] Total tracks added to queue:', tracksAdded);
    
    // Wenn keine Tracks hinzugefügt wurden, versuche alternative Methode
    if (tracksAdded === 0) {
      debugLog('main', '[AUTO-DJ] No tracks were added, trying fallback method...');
      showNotification('⚠️ Auto-DJ: Keine neuen Tracks hinzugefügt - alle bereits in Queue');
      
      // Fallback: Bei leerer Queue verwende aggressive Strategie
      if (queue.length === 0) {
        debugLog('main', '[AUTO-DJ] Queue is empty, using aggressive loading strategy');
        if (randomPlaylist.isCustom) {
          tracksAdded = await loadCustomPlaylistForAutoDj(randomPlaylist, true); // force reload
        } else if (randomPlaylist.tracks && randomPlaylist.tracks.length > 0) {
          // Für Auto-learned: Lade einfach die ersten Tracks ohne Duplikat-Prüfung
          const tracksToAdd = Math.min(5, randomPlaylist.tracks.length);
          for (let i = 0; i < tracksToAdd; i++) {
            const track = randomPlaylist.tracks[i];
            const success = addToQueueForAutoDj(track);
            if (success) {
              tracksAdded++;
              debugLog('main', '[AUTO-DJ] Force-added track:', track.title, 'by', track.artist);
            }
          }
          debouncedUpdateQueueDisplay();
          showNotification(`🤖 Auto-DJ: ${tracksAdded} Songs forciert hinzugefügt`);
        }
      }
    }
    
    // Kürzere Cooldown-Zeit für responsiveres Verhalten
    setTimeout(() => {
      autoDjCooldown = false;
      debugLog('main', '[AUTO-DJ] Cooldown reset - ready for next fill');
    }, AUTO_DJ_CONFIG.cooldownTime / 2);
    
  } catch (error) {
    console.error('[AUTO-DJ] Error adding tracks:', error);
    autoDjCooldown = false;
    showNotification(`❌ Auto-DJ Fehler: ${error.message}`);
  }
}

// Load/Save Auto-DJ settings
function loadAutoDjSettings() {
  try {
    const saved = localStorage.getItem('autoDjSettings');
    if (saved) {
      const settings = JSON.parse(saved);
      Object.assign(AUTO_DJ_CONFIG, settings);
      
      const toggle = document.getElementById('autoDjToggle');
      if (toggle) {
        toggle.checked = AUTO_DJ_CONFIG.enabled;
        toggleAutoDj(AUTO_DJ_CONFIG.enabled);
      }
    }
  } catch (error) {
    console.error('[AUTO-DJ] Error loading settings:', error);
  }
}

function saveAutoDjSettings() {
  try {
    localStorage.setItem('autoDjSettings', JSON.stringify(AUTO_DJ_CONFIG));
  } catch (error) {
    console.error('[AUTO-DJ] Error saving settings:', error);
  }
}

// Playlist management functions - ARBEITEN MIT DER BESTEHENDEN SPOTIFY-LOGIK
// Playlist management functions moved to js/playlists.js

function findPlaylistById(playlistId) {
  return autoLearnedPlaylists.find(p => (p.id || p.name) === playlistId);
}

// Update navigation active state
function updateNavActiveState(activeFilter) {
  document.querySelectorAll('.nav-tile').forEach(btn => {
    btn.classList.remove('active');
    if (btn.dataset.filter === activeFilter) {
      btn.classList.add('active');
    }
  });
}

// Show notification
function showNotification(message) {
  debugLog('main', '[NOTIFICATION]', message);
  
  // Create a simple toast notification
  const notification = document.createElement('div');
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: rgba(30, 30, 30, 0.95);
    color: white;
    padding: 12px 20px;
    border-radius: 8px;
    border: 1px solid #1DB954;
    z-index: 10000;
    font-size: 14px;
    max-width: 300px;
    word-wrap: break-word;
  `;
  notification.textContent = message;
  
  document.body.appendChild(notification);
  
  // Remove after 4 seconds
  setTimeout(() => {
    if (notification.parentNode) {
      notification.parentNode.removeChild(notification);
    }
  }, 4000);
}

// GEMA Reporting System - delegated to admin_panel.js
function initializeReportingSystem() {
  if (window.adminPanel && window.adminPanel.gemaReporting) {
    window.adminPanel.gemaReporting.initializeReportingSystem();
  }
}

// Event/Reporting wrapper functions for backward compatibility - delegated to admin_panel.js
function generateReportHTML(data) {
  if (window.adminPanel && window.adminPanel.generateReportHTML) {
    return window.adminPanel.generateReportHTML(data);
  }
  console.warn('⚠️ Admin panel not available for generateReportHTML');
  return '';
}

function saveCurrentEvent() {
  if (window.adminPanel && window.adminPanel.saveCurrentEvent) {
    return window.adminPanel.saveCurrentEvent();
  }
  console.warn('⚠️ Admin panel not available for saveCurrentEvent');
}

window.loadEventData = function(eventId) {
  if (window.adminPanel && window.adminPanel.gemaReporting) {
    return window.adminPanel.gemaReporting.loadEventData(eventId);
  }
  console.warn('⚠️ Admin panel not available for loadEventData');
};

window.deleteEvent = function(eventId) {
  if (window.adminPanel && window.adminPanel.gemaReporting) {
    return window.adminPanel.gemaReporting.deleteEvent(eventId);
  }
  console.warn('⚠️ Admin panel not available for deleteEvent');
};

function downloadReportAsPDF() {
  if (window.adminPanel && window.adminPanel.downloadReportAsPDF) {
    return window.adminPanel.downloadReportAsPDF();
  }
  console.warn('⚠️ Admin panel not available for downloadReportAsPDF');
}

// Make loadSpotifyClientId globally available
window.loadSpotifyClientId = loadSpotifyClientId;
