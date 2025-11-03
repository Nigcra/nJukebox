// Spotify integration module
let spotifyAccessToken = null;
let spotifyTokenExpiry = null;
let spotifyPlayer = null;
let spotifyDeviceId = null;
let spotifyState = null;
let spotifyProgressInterval = null;
let spotifyStatusUpdateInterval = null;

// Global callback for Spotify SDK ready event
window.onSpotifyWebPlaybackSDKReady = function() {
  debugLog('spotify', '[SPOTIFY] SDK ready, initializing...');
  if (typeof debugLog !== 'undefined') {
    debugLog('SPOTIFY', 'Spotify SDK ready, initializing player...');
  }
  
  if (!spotifyAccessToken) {
    if (typeof debugLog !== 'undefined') {
      debugLog('SPOTIFY', 'No Spotify access token available during SDK ready - player will be initialized later when token is loaded');
    }
    return;
  }
  
  if (spotifyPlayer) {
    if (typeof debugLog !== 'undefined') {
      debugLog('SPOTIFY', 'Spotify player already initialized');
    }
    return;
  }
  
  initializeSpotifyPlayerInternal();
};

// Internal function to actually initialize the player
function initializeSpotifyPlayerInternal() {
  if (!spotifyAccessToken) {
    if (typeof debugLog !== 'undefined') {
      debugLog('SPOTIFY', 'Cannot initialize player: No access token');
    }
    return;
  }
  
  if (spotifyPlayer) {
    if (typeof debugLog !== 'undefined') {
      debugLog('SPOTIFY', 'Player already initialized');
    }
    return;
  }
  
  if (!window.Spotify) {
    if (typeof debugLog !== 'undefined') {
      debugLog('SPOTIFY', 'Cannot initialize player: Spotify SDK not loaded');
    }
    return;
  }
  
  if (typeof debugLog !== 'undefined') {
    debugLog('SPOTIFY', 'Initializing Spotify Player with token:', !!spotifyAccessToken);
  }
  
  debugLog('spotify', '[SPOTIFY] Creating player...');
  spotifyPlayer = new window.Spotify.Player({ 
    name: 'Jukebox Browser Player', 
    getOAuthToken: cb => { 
      if (typeof debugLog !== 'undefined') {
        debugLog('SPOTIFY', 'getOAuthToken callback called');
      }
      cb(spotifyAccessToken); 
    }, 
    volume: 0.7 
  });
  
  spotifyPlayer.addListener('ready', async ({ device_id }) => {
    debugLog('spotify', '[SPOTIFY] Device ready:', device_id);
    spotifyDeviceId = device_id;
    window.spotifyDeviceId = device_id;
    
    const status = document.getElementById('spotifyStatus'); 
    if (status) { 
      status.textContent = 'Player ready'; 
    }
    if (typeof debugLog !== 'undefined') {
      debugLog('SPOTIFY', 'Spotify player ready, device_id =', device_id);
    }
    
    // Update UI status indicators
    updateSpotifyStatusUI();
    
    // Start periodic status updates to keep token expiry time current
    startSpotifyStatusUpdates();
  });
  
  spotifyPlayer.addListener('not_ready', ({ device_id }) => {
    debugLog('spotify', '[SPOTIFY] Device NOT ready, device_id:', device_id);
    if (typeof debugLog !== 'undefined') {
      debugLog('SPOTIFY', 'Player not_ready', device_id);
    }
  });
  
  spotifyPlayer.addListener('initialization_error', e => debugLog('SPOTIFY', 'initialization_error', e));
  spotifyPlayer.addListener('authentication_error', e => debugLog('SPOTIFY', 'authentication_error', e));
  spotifyPlayer.addListener('account_error', e => debugLog('SPOTIFY', 'account_error', e));
  
  // Add player state change listener to track play/pause status
  spotifyPlayer.addListener('player_state_changed', state => {
    if (state) {
      // Update global playing status based on Spotify player state
      const isPlaying = !state.paused;
      window.isSpotifyCurrentlyPlaying = isPlaying;
      debugLog('spotify', '[SPOTIFY] Player state changed - Playing:', isPlaying);
    }
  });
  
  spotifyPlayer.connect().then(success => {
    if (success) {
      debugLog('spotify', '[SPOTIFY] Successfully connected to Spotify!');
      if (typeof debugLog !== 'undefined') {
        debugLog('SPOTIFY', 'Player connected successfully');
      }
    } else {
      debugLog('SPOTIFY', 'Failed to connect to Spotify');
      if (typeof debugLog !== 'undefined') {
        debugLog('SPOTIFY', 'Player connection failed');
      }
    }
  });
}

function initSpotifyPlayer() {
  if (typeof debugLog !== 'undefined') {
    debugLog('SPOTIFY', 'initSpotifyPlayer called - delegating to initializeSpotifyPlayerInternal');
  }
  
  initializeSpotifyPlayerInternal();
}

// Basic token validation
function isSpotifyTokenValid() {
  if (!spotifyAccessToken || !spotifyTokenExpiry) return false;
  const now = Date.now();
  const bufferTime = 5 * 60 * 1000; // 5 minutes buffer
  return now < (spotifyTokenExpiry - bufferTime);
}

// Check if Spotify connection is working
async function checkSpotifyConnection() {
  if (!isSpotifyTokenValid()) {
    if (typeof debugLog !== 'undefined') {
      debugLog('SPOTIFY', 'Spotify token expired or invalid');
    }
    return false;
  }
  
  try {
    const response = await fetch('https://api.spotify.com/v1/me', {
      headers: {
        'Authorization': `Bearer ${spotifyAccessToken}`
      }
    });
    
    if (response.ok) {
      if (typeof debugLog !== 'undefined') {
        debugLog('SPOTIFY', 'Spotify connection valid');
      }
      return true;
    } else if (response.status === 401 || response.status === 403) {
      if (typeof debugLog !== 'undefined') {
        debugLog('SPOTIFY', 'Spotify token invalid/expired:', response.status);
      }
      clearSpotifyData();
      updateSpotifyStatusUI();
      return false;
    } else {
      if (typeof debugLog !== 'undefined') {
        debugLog('SPOTIFY', 'Spotify connection invalid:', response.status);
      }
      return false;
    }
  } catch (error) {
    if (typeof debugLog !== 'undefined') {
      debugLog('SPOTIFY', 'Spotify connection test failed:', error);
    }
    return false;
  }
}

// Auto-connect function
async function autoConnectSpotify() {
  if (typeof debugLog !== 'undefined') {
    debugLog('SPOTIFY', '=== autoConnectSpotify started ===');
  }
  
  let savedToken = null;
  let savedExpiry = null;
  
  // Try to load from database first
  if (window.sessionAPI) {
    try {
      debugLog('SPOTIFY', '🔍 Attempting to load tokens from database...');
      const tokens = await window.sessionAPI.getSpotifyTokens();
      
      if (typeof debugLog !== 'undefined') {
        debugLog('SPOTIFY', '📦 Database response:', tokens);
      }
      
      if (tokens) {
        // Database returns: access_token, refresh_token, expires_at
        // Convert expires_at (unix timestamp in seconds) to expires_in milliseconds
        if (tokens.access_token) {
          savedToken = tokens.access_token;
          
          // Calculate expiry time from expires_at timestamp
          if (tokens.expires_at) {
            savedExpiry = (tokens.expires_at * 1000).toString(); // Convert to milliseconds
          }
          
          // Also restore refresh token to sessionStorage for later use
          if (tokens.refresh_token) {
            sessionStorage.setItem('spotify_refresh_token', tokens.refresh_token);
            localStorage.setItem('spotify_refresh_token', tokens.refresh_token);
          }
          
          if (typeof debugLog !== 'undefined') {
            debugLog('SPOTIFY', '✅ Tokens loaded from database:', {
              hasAccessToken: !!savedToken,
              hasRefreshToken: !!tokens.refresh_token,
              expiresAt: tokens.expires_at ? new Date(tokens.expires_at * 1000).toLocaleString() : 'unknown'
            });
          }
        } else {
          if (typeof debugLog !== 'undefined') {
            debugLog('SPOTIFY', '⚠️ Database returned tokens object but no access_token field');
          }
        }
      } else {
        if (typeof debugLog !== 'undefined') {
          debugLog('SPOTIFY', '⚠️ No tokens in database');
        }
      }
    } catch (error) {
      if (typeof debugLog !== 'undefined') {
        debugLog('SPOTIFY', '❌ Database token load failed:', error);
      }
    }
  } else {
    if (typeof debugLog !== 'undefined') {
      debugLog('SPOTIFY', '⚠️ sessionAPI not available');
    }
  }
  
  // Fallback to localStorage
  if (!savedToken) {
    savedToken = sessionStorage.getItem('spotify_access_token') || localStorage.getItem('spotify_access_token');
    savedExpiry = sessionStorage.getItem('spotify_token_expiry') || localStorage.getItem('spotify_token_expiry');
    
    if (typeof debugLog !== 'undefined') {
      debugLog('SPOTIFY', 'Fallback: Tokens loaded from localStorage');
    }
  }
  
  if (!savedToken || !savedExpiry) {
    if (typeof debugLog !== 'undefined') {
      debugLog('SPOTIFY', '❌ No saved Spotify data found');
    }
    return false;
  }
  
  // Set global variables
  spotifyAccessToken = savedToken;
  spotifyTokenExpiry = parseInt(savedExpiry, 10);
  window.spotifyAccessToken = savedToken; // Also set on window for global access
  
  // Also store in sessionStorage/localStorage for other code that might need it
  sessionStorage.setItem('spotify_access_token', savedToken);
  localStorage.setItem('spotify_access_token', savedToken);
  sessionStorage.setItem('spotify_token_expiry', savedExpiry);
  localStorage.setItem('spotify_token_expiry', savedExpiry);
  
  if (typeof debugLog !== 'undefined') {
    debugLog('SPOTIFY', '✅ Token loaded and set:', {
      hasToken: !!spotifyAccessToken,
      expiryTime: new Date(spotifyTokenExpiry).toLocaleString(),
      isValid: spotifyTokenExpiry > Date.now()
    });
  }
  
  if (!isSpotifyTokenValid()) {
    if (typeof debugLog !== 'undefined') {
      debugLog('SPOTIFY', '⚠️ Token already expired, clearing data');
    }
    await clearSpotifyTokens();
    return false;
  }
  
  try {
    const isValid = await checkSpotifyConnection();
    if (isValid) {
      if (typeof debugLog !== 'undefined') {
        debugLog('SPOTIFY', 'Automatic Spotify connection successful');
      }
      updateSpotifyStatusUI();
      startSpotifyStatusUpdates();
      
      // Start automatic token refresh interval
      if (typeof window.startSpotifyTokenRefreshInterval === 'function') {
        window.startSpotifyTokenRefreshInterval();
      }
      
      // Try to initialize player directly if SDK is already ready
      if (window.Spotify && typeof window.Spotify.Player === 'function') {
        if (typeof debugLog !== 'undefined') {
          debugLog('SPOTIFY', 'SDK already ready, initializing player directly');
        }
        initSpotifyPlayer();
      } else {
        // Wait for SDK if not ready yet
        waitForSpotifySDK(initSpotifyPlayer);
      }
      return true;
    } else {
      if (typeof debugLog !== 'undefined') {
        debugLog('SPOTIFY', 'Saved Spotify connection invalid, clearing data');
      }
      await clearSpotifyTokens();
      updateSpotifyStatusUI();
      return false;
    }
  } catch (error) {
    if (typeof debugLog !== 'undefined') {
      debugLog('SPOTIFY', 'Connection test error:', error);
    }
    return false;
  }
}

// Handle token from URL hash
function handleSpotifyTokenFromHash() {
  const hash = window.location.hash;
  if (hash && hash.startsWith('#spotify_token=')) {
    let token;
    try {
      token = decodeURIComponent(hash.replace('#spotify_token=', ''));
    } catch (error) {
      if (typeof debugLog !== 'undefined') {
        debugLog('SPOTIFY', `URI decode error for token: ${error.message}`);
      }
      token = hash.replace('#spotify_token=', '');
    }
    
    if (token) {
      saveSpotifyTokenToStorage(token);
      history.replaceState(null, '', window.location.pathname + window.location.search);
      if (typeof debugLog !== 'undefined') {
        debugLog('SPOTIFY', 'Token from URL hash accepted:', token);
      }
    }
  }
}

// Wait for Spotify SDK to be ready
function waitForSpotifySDK(cb) {
  if (window.Spotify && typeof window.Spotify.Player === 'function') {
    if (typeof debugLog !== 'undefined') {
      debugLog('SPOTIFY', 'Spotify SDK is loaded.');
    }
    cb();
  } else {
    if (typeof debugLog !== 'undefined') {
      debugLog('SPOTIFY', 'Waiting for Spotify SDK...');
    }
    setTimeout(() => waitForSpotifySDK(cb), 100);
  }
}

// Save token to storage
async function saveSpotifyTokenToStorage(token, expiresIn = 3600, refreshToken = null) {
  const now = Date.now();
  const expiry = now + (expiresIn * 1000);
  
  if (window.sessionAPI) {
    const success = await window.sessionAPI.saveSpotifyTokens(token, refreshToken, expiry);
    if (success) {
      spotifyAccessToken = token;
      spotifyTokenExpiry = expiry;
      
      if (typeof debugLog !== 'undefined') {
        debugLog('SPOTIFY', 'Spotify token saved to database, expires at:', new Date(expiry));
      }
      return true;
    }
  }
  
  // Fallback to localStorage
  localStorage.setItem('spotify_access_token', token);
  localStorage.setItem('spotify_token_expiry', expiry.toString());
  if (refreshToken) {
    localStorage.setItem('spotify_refresh_token', refreshToken);
  }
  localStorage.setItem('spotify_last_connected', now.toString());
  
  spotifyAccessToken = token;
  spotifyTokenExpiry = expiry;
  
  if (typeof debugLog !== 'undefined') {
    debugLog('SPOTIFY', 'Spotify token saved to localStorage, expires at:', new Date(expiry));
  }
  return true;
}

// Clear token data
async function clearSpotifyTokens() {
  if (window.sessionAPI) {
    await window.sessionAPI.clearSpotifyTokens();
  }
  
  localStorage.removeItem('spotify_access_token');
  localStorage.removeItem('spotify_token_expiry');
  localStorage.removeItem('spotify_refresh_token');
  localStorage.removeItem('spotify_last_connected');
  sessionStorage.removeItem('spotify_access_token');
  sessionStorage.removeItem('spotify_token_expiry');
  sessionStorage.removeItem('spotify_refresh_token');
  
  spotifyAccessToken = null;
  spotifyTokenExpiry = null;
  
  // Stop automatic token refresh
  if (typeof window.stopSpotifyTokenRefreshInterval === 'function') {
    window.stopSpotifyTokenRefreshInterval();
  }
  
  if (typeof debugLog !== 'undefined') {
    debugLog('SPOTIFY', 'All Spotify tokens cleared');
  }
}

// Clear all Spotify data
function clearSpotifyData() {
  clearSpotifyTokens();
  spotifyPlayer = null;
  spotifyDeviceId = null;
  spotifyState = null;
}

// Update Spotify status UI
function updateSpotifyStatusUI() {
  const spotifyButton = document.getElementById('spotifyLoginBtn'); // Fixed: Use correct ID from HTML
  const spotifyStatus = document.getElementById('spotifyStatus');
  const spotifyStatusIcon = document.getElementById('spotifyStatusIcon');
  
  if (spotifyAccessToken && spotifyDeviceId) {
    if (spotifyButton) {
      spotifyButton.setAttribute('data-i18n', 'ui.buttons.spotifyConnected');
      spotifyButton.textContent = window.i18nSystem ? window.i18nSystem.t('ui.buttons.spotifyConnected') : '✅ Spotify Connected';
    }
    
    // Show token expiry time with reload icon in admin panel
    if (spotifyStatus) {
      if (spotifyTokenExpiry) {
        const now = Date.now();
        const timeLeft = Math.max(0, spotifyTokenExpiry - now);
        const minutesLeft = Math.floor(timeLeft / 60000);
        const hoursLeft = Math.floor(minutesLeft / 60);
        
        if (hoursLeft > 0) {
          spotifyStatus.innerHTML = `⏱ Token: ${hoursLeft}h ${minutesLeft % 60}min`;
        } else if (minutesLeft > 0) {
          spotifyStatus.innerHTML = `⏱ Token: ${minutesLeft}min`;
        } else if (timeLeft > 0) {
          const secondsLeft = Math.floor(timeLeft / 1000);
          spotifyStatus.innerHTML = `⏱ Token: ${secondsLeft}s`;
        } else {
          spotifyStatus.innerHTML = '⏱ Token expired';
        }
      } else {
        spotifyStatus.textContent = 'Connected';
      }
    }
    
    if (spotifyStatusIcon) {
      spotifyStatusIcon.className = 'connected';
      spotifyStatusIcon.title = 'Spotify verbunden und bereit';
    }
  } else if (spotifyAccessToken && !spotifyDeviceId) {
    if (spotifyButton) {
      spotifyButton.removeAttribute('data-i18n');
      spotifyButton.textContent = '🔄 Spotify Connecting...';
    }
    if (spotifyStatus) spotifyStatus.textContent = 'Token OK, Device pending';
    if (spotifyStatusIcon) {
      spotifyStatusIcon.className = 'disconnected';
      spotifyStatusIcon.title = 'Spotify verbindet...';
    }
  } else {
    if (spotifyButton) {
      spotifyButton.setAttribute('data-i18n', 'ui.buttons.connectSpotify');
      spotifyButton.textContent = window.i18nSystem ? window.i18nSystem.t('ui.buttons.connectSpotify') : '🔗 Connect Spotify';
    }
    if (spotifyStatus) spotifyStatus.textContent = 'Disconnected';
    if (spotifyStatusIcon) {
      spotifyStatusIcon.className = 'disconnected';
      spotifyStatusIcon.title = 'Spotify nicht verbunden';
    }
  }
}

// Start periodic UI status updates (for token expiry countdown) with auto-refresh
function startSpotifyStatusUpdates() {
  stopSpotifyStatusUpdates(); // Clear any existing interval
  
  spotifyStatusUpdateInterval = setInterval(async () => {
    updateSpotifyStatusUI();
    
    // Check if token needs refresh (5 minutes before expiry)
    if (spotifyAccessToken && spotifyTokenExpiry) {
      const now = Date.now();
      const timeUntilExpiry = spotifyTokenExpiry - now;
      const REFRESH_BUFFER = 5 * 60 * 1000; // 5 minutes in milliseconds
      
      if (timeUntilExpiry > 0 && timeUntilExpiry < REFRESH_BUFFER) {
        debugLog('spotify', '[SPOTIFY] Token expires soon, attempting automatic refresh...');
        
        try {
          const refreshSuccess = await refreshSpotifyTokenAutomatically();
          if (refreshSuccess) {
            debugLog('spotify', '[SPOTIFY] ✅ Token automatically refreshed');
          } else {
            debugLog('spotify', '[SPOTIFY] ⚠️ Automatic token refresh failed');
          }
        } catch (error) {
          debugLog('spotify', '[SPOTIFY] ❌ Error during automatic token refresh:', error);
        }
      }
    }
  }, 60000); // Check every minute
  
  debugLog('spotify', '[SPOTIFY] Started periodic status updates with auto-refresh');
}

function stopSpotifyStatusUpdates() {
  if (spotifyStatusUpdateInterval) {
    clearInterval(spotifyStatusUpdateInterval);
    spotifyStatusUpdateInterval = null;
    debugLog('spotify', '[SPOTIFY] Stopped periodic status updates');
  }
}

// Automatic token refresh function
async function refreshSpotifyTokenAutomatically() {
  debugLog('spotify', '[SPOTIFY] Attempting automatic token refresh...');
  
  // First try to get refresh token from database
  let refreshToken = null;
  
  if (window.sessionAPI) {
    try {
      const tokens = await window.sessionAPI.getSpotifyTokens();
      if (tokens && tokens.refreshToken) {
        refreshToken = tokens.refreshToken;
      }
    } catch (error) {
      debugLog('spotify', '[SPOTIFY] Failed to load refresh token from database:', error);
    }
  }
  
  // Fallback to localStorage
  if (!refreshToken) {
    refreshToken = sessionStorage.getItem('spotify_refresh_token') || localStorage.getItem('spotify_refresh_token');
  }
  
  if (!refreshToken) {
    debugLog('spotify', '[SPOTIFY] No refresh token available - cannot auto-refresh');
    return false;
  }
  
  // Load current Client ID from settings
  let clientId = null;
  if (window.settingsAPI) {
    try {
      clientId = await window.settingsAPI.getSetting('spotify', 'clientId', null);
    } catch (error) {
      debugLog('spotify', '[SPOTIFY] Failed to load Client ID for refresh:', error);
    }
  }
  
  if (!clientId) {
    debugLog('spotify', '[SPOTIFY] No Client ID configured - cannot refresh token');
    return false;
  }
  
  try {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId
    });

    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });

    const data = await response.json();
    
    if (response.ok && data.access_token) {
      // Save new token
      const newRefreshToken = data.refresh_token || refreshToken;
      const expiresIn = data.expires_in || 3600;
      
      const success = await saveSpotifyTokenToStorage(data.access_token, expiresIn, newRefreshToken);
      
      if (success) {
        // Update global variables
        spotifyAccessToken = data.access_token;
        spotifyTokenExpiry = Date.now() + (expiresIn * 1000);
        
        debugLog('spotify', '[SPOTIFY] Token refreshed successfully, new expiry:', new Date(spotifyTokenExpiry));
        return true;
      }
    } else {
      debugLog('spotify', '[SPOTIFY] Token refresh failed:', data.error_description || data.error);
      
      // If refresh token is invalid, clear all tokens
      if (data.error === 'invalid_grant') {
        debugLog('spotify', '[SPOTIFY] Refresh token invalid, clearing all data');
        clearSpotifyData();
        updateSpotifyStatusUI();
      }
      
      return false;
    }
  } catch (error) {
    debugLog('spotify', '[SPOTIFY] Token refresh request failed:', error);
    return false;
  }
  
  return false;
}

// Spotify-specific progress tracking
function startSpotifyProgressUpdates() {
  stopSpotifyProgressUpdates(); // Clear any existing interval
  
  if (!spotifyPlayer || !spotifyDeviceId) {
    return;
  }
  
  spotifyProgressInterval = setInterval(() => {
    if (spotifyPlayer) {
      spotifyPlayer.getCurrentState().then(state => {
        if (state && !state.paused && state.duration && typeof updateProgressDisplay !== 'undefined') {
          // Update progress display with current position and duration (convert from ms to seconds)
          updateProgressDisplay(state.position / 1000, state.duration / 1000);
        }
      }).catch(error => {
        debugLog('SPOTIFY', 'Error getting current state:', error);
      });
    }
  }, 1000); // Update every second
  
  debugLog('spotify', '[SPOTIFY] Started progress updates');
}

function stopSpotifyProgressUpdates() {
  if (spotifyProgressInterval) {
    clearInterval(spotifyProgressInterval);
    spotifyProgressInterval = null;
    debugLog('spotify', '[SPOTIFY] Stopped progress updates');
  }
}

// Spotify-specific volume control
function setSpotifyVolume(volume) {
  if (spotifyPlayer && spotifyDeviceId) {
    const volumePercent = Math.max(0, Math.min(100, Math.round(volume * 100)));
    spotifyPlayer.setVolume(volumePercent / 100).then(() => {
      if (typeof debugLog !== 'undefined') {
        debugLog('SPOTIFY', 'Volume set to:', volumePercent + '%');
      }
    }).catch(error => {
      debugLog('SPOTIFY', 'Error setting volume:', error);
    });
  }
}

// Enhanced volume control that works for both local and Spotify
function setUniversalVolume(volume) {
  // Set local audio volume
  if (typeof setVolume !== 'undefined') {
    setVolume(volume);
  }
  
  // Set Spotify volume
  setSpotifyVolume(volume);
}

// Make functions globally available
window.autoConnectSpotify = autoConnectSpotify;
window.handleSpotifyTokenFromHash = handleSpotifyTokenFromHash;
window.initSpotifyPlayer = initSpotifyPlayer;
window.initializeSpotifyPlayerInternal = initializeSpotifyPlayerInternal; // Add internal function
window.waitForSpotifySDK = waitForSpotifySDK;
window.clearSpotifyData = clearSpotifyData;
window.updateSpotifyStatusUI = updateSpotifyStatusUI;
window.saveSpotifyTokenToStorage = saveSpotifyTokenToStorage; // Add token saving function
window.setSpotifyVolume = setSpotifyVolume; // Add Spotify volume control
window.setUniversalVolume = setUniversalVolume; // Add universal volume control
window.startSpotifyProgressUpdates = startSpotifyProgressUpdates; // Add Spotify progress tracking
window.stopSpotifyProgressUpdates = stopSpotifyProgressUpdates;
window.startSpotifyStatusUpdates = startSpotifyStatusUpdates; // Add periodic status updates
window.stopSpotifyStatusUpdates = stopSpotifyStatusUpdates;

// Make Spotify state variables globally accessible (read-only access)
Object.defineProperty(window, 'spotifyAccessToken', {
  get: function() { return spotifyAccessToken; }
});
Object.defineProperty(window, 'spotifyDeviceId', {
  get: function() { return spotifyDeviceId; }
});
Object.defineProperty(window, 'spotifyPlayer', {
  get: function() { return spotifyPlayer; }
});
Object.defineProperty(window, 'spotifyTokenExpiry', {
  get: function() { return spotifyTokenExpiry; }
});