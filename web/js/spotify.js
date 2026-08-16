// spotify.js
// Spotify integration: player SDK plus the server side token layer
// Version: 2026.08.16

let spotifyAccessToken = null;
let spotifyTokenExpiry = null;
let spotifyPlayer = null;
let spotifyDeviceId = null;
let spotifyState = null;
let spotifyProgressInterval = null;
let spotifyStatusUpdateInterval = null;
// Last playing state seen by the progress poll, used to detect the end of a track.
let spotifyLastPosition = 0;
let spotifyLastDuration = 0;

// Keeps the module state and the global mirror in sync.
//
// These variables are declared with let, so they are module scope and not
// window properties. Other files read window.spotifyAccessToken though -
// playSpotifyTrack() and searchSpotifyDirect() in jukebox.js bail out without
// it, and the admin panel derives its connection indicator from it. The token
// is only mirrored onto window, never into localStorage or sessionStorage.
const setSpotifyAccessToken = (token, expiryMs = null) => {
	spotifyAccessToken = token;
	spotifyTokenExpiry = expiryMs;
	window.spotifyAccessToken = token;
	window.spotifyTokenExpiry = expiryMs;
};

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

  // The player has to be reachable from outside this module. stopPlayback() and
  // stopAllPlayback() in js/audio.js pause Spotify through window.spotifyPlayer,
  // and spotifyPlayer is declared with let, which never becomes a window
  // property. Without this line the stop button silently leaves Spotify playing.
  window.spotifyPlayer = spotifyPlayer;
  
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

// Server side token layer
//
// The data server owns the Spotify tokens: it exchanges the login code, keeps
// the refresh token and renews the access token on its own schedule. The
// frontend only ever asks for a token, which is why one code path is left here
// instead of the three competing refresh implementations from before. Nothing
// token related is written to localStorage or sessionStorage any more.
const SPOTIFY_DATA_SERVER = 'http://127.0.0.1:3001';

// Keys left over from the era in which the browser managed the tokens. They are
// read once for the migration and removed afterwards.
const LEGACY_SPOTIFY_KEYS = [
  'spotify_access_token',
  'spotify_refresh_token',
  'spotify_token_expiry',
  'spotify_last_connected'
];

// Local view of the token. It is a cache for the player SDK and the status
// display, never the source of truth.
function isSpotifyTokenValid() {
  return !!spotifyAccessToken && !!spotifyTokenExpiry && Date.now() < spotifyTokenExpiry;
}

// Asks the server for an access token. The answer is always usable: the server
// renews transparently below five minutes remaining lifetime, and it does so
// even when the token expired hours ago.
async function getSpotifyToken() {
  try {
    const response = await fetch(`${SPOTIFY_DATA_SERVER}/api/spotify/token`);

    if (response.status === 401) {
      // No usable login on the server. The local copy follows; nothing is
      // deleted from here, the server decides over the stored tokens.
      setSpotifyAccessToken(null);
      return null;
    }

    if (!response.ok) {
      debugLog('SPOTIFY', 'Token endpoint answered with status', response.status);
      return spotifyAccessToken;
    }

    const data = await response.json();
    if (!data.success || !data.access_token) {
      return null;
    }

    setSpotifyAccessToken(data.access_token, data.expires_at * 1000);
    return spotifyAccessToken;
  } catch (error) {
    // A short outage of the data server must not cost a working token.
    debugLog('SPOTIFY', 'Token request failed:', error);
    return spotifyAccessToken;
  }
}

// Removes the storage keys of the old browser side token handling.
function purgeLegacySpotifyStorage() {
  LEGACY_SPOTIFY_KEYS.forEach(key => {
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
  });
}

// R3: a refresh token may still be lying around in the browser from before the
// server took over. It is handed to the server once and then removed here.
async function adoptLegacySpotifyToken() {
  const legacyToken = localStorage.getItem('spotify_refresh_token')
    || sessionStorage.getItem('spotify_refresh_token');
  if (!legacyToken) return false;

  try {
    const response = await fetch(`${SPOTIFY_DATA_SERVER}/api/spotify/auth/adopt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: legacyToken })
    });
    const data = await response.json();

    // The server answered, so the browser copy has done its job: it was either
    // adopted or it is worthless.
    purgeLegacySpotifyStorage();

    if (response.ok && data.success) {
      debugLog('SPOTIFY', 'Refresh token from the browser adopted by the server');
      return true;
    }
    return false;
  } catch (error) {
    // Data server unreachable - keep the copy for the next attempt.
    debugLog('SPOTIFY', 'Adopting the stored refresh token failed:', error);
    return false;
  }
}

// Check if Spotify connection is working
async function checkSpotifyConnection() {
  const token = spotifyAccessToken || await getSpotifyToken();
  if (!token) {
    debugLog('SPOTIFY', 'No Spotify token available');
    return false;
  }

  try {
    const response = await fetch('https://api.spotify.com/v1/me', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (response.ok) {
      debugLog('SPOTIFY', 'Spotify connection valid');
      return true;
    }

    if (response.status === 401 || response.status === 403) {
      // An access token Spotify rejects is a reason to renew, not to log out.
      // The server hands out a fresh one, then the check runs once more.
      const renewedToken = await getSpotifyToken();
      if (renewedToken && renewedToken !== token) {
        const retry = await fetch('https://api.spotify.com/v1/me', {
          headers: { 'Authorization': `Bearer ${renewedToken}` }
        });
        return retry.ok;
      }
      debugLog('SPOTIFY', 'Spotify rejected the token:', response.status);
      return false;
    }

    debugLog('SPOTIFY', 'Spotify connection invalid:', response.status);
    return false;
  } catch (error) {
    debugLog('SPOTIFY', 'Spotify connection test failed:', error);
    return false;
  }
}

// Auto-connect function
async function autoConnectSpotify() {
  debugLog('SPOTIFY', '=== autoConnectSpotify started ===');

  let token = await getSpotifyToken();

  // One time migration of a token that is still stuck in the browser.
  if (!token && await adoptLegacySpotifyToken()) {
    token = await getSpotifyToken();
  }

  if (!token) {
    debugLog('SPOTIFY', 'No Spotify login on the server - manual login required');
    updateSpotifyStatusUI();
    return false;
  }

  const isValid = await checkSpotifyConnection();
  if (!isValid) {
    // The stored login stays where it is. Only an invalid_grant from Spotify
    // removes it, and that decision is made on the server.
    debugLog('SPOTIFY', 'Spotify connection could not be verified');
    updateSpotifyStatusUI();
    return false;
  }

  debugLog('SPOTIFY', 'Automatic Spotify connection successful');
  updateSpotifyStatusUI();
  startSpotifyStatusUpdates();

  if (window.Spotify && typeof window.Spotify.Player === 'function') {
    debugLog('SPOTIFY', 'SDK already ready, initializing player directly');
    initSpotifyPlayer();
  } else {
    waitForSpotifySDK(initSpotifyPlayer);
  }
  return true;
}

// Wait for Spotify SDK to be ready
function waitForSpotifySDK(cb) {
  if (window.Spotify && typeof window.Spotify.Player === 'function') {
    debugLog('SPOTIFY', 'Spotify SDK is loaded.');
    cb();
  } else {
    debugLog('SPOTIFY', 'Waiting for Spotify SDK...');
    setTimeout(() => waitForSpotifySDK(cb), 100);
  }
}

// Deliberate logout. This is the only place in the frontend that removes a
// stored login, and it does so through the server.
async function logoutSpotify() {
  try {
    await fetch(`${SPOTIFY_DATA_SERVER}/api/spotify/auth`, { method: 'DELETE' });
    debugLog('SPOTIFY', 'Spotify login removed on the server');
  } catch (error) {
    debugLog('SPOTIFY', 'Logout request failed:', error);
  }

  purgeLegacySpotifyStorage();
  setSpotifyAccessToken(null);
  stopSpotifyStatusUpdates();
  updateSpotifyStatusUI();
}

// Drops the local player state. The stored login stays: a failed request is no
// proof that the refresh token is gone.
function clearSpotifyData() {
  setSpotifyAccessToken(null);
  spotifyPlayer = null;
  spotifyDeviceId = null;
  spotifyState = null;
  window.spotifyPlayer = null;
  window.spotifyDeviceId = null;
}

// Removed with phase 6, kept out of the file on purpose:
//   handleSpotifyTokenFromHash  - no token travels through the URL any more
//   saveSpotifyTokenToStorage   - the server is the only writer
//   refreshSpotifyTokenAutomatically - replaced by getSpotifyToken()

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

// Start periodic UI status updates (for token expiry countdown)
function startSpotifyStatusUpdates() {
  stopSpotifyStatusUpdates(); // Clear any existing interval

  spotifyStatusUpdateInterval = setInterval(async () => {
    // The server renews on its own, asking once a minute only keeps the local
    // copy and the countdown current. There is no window that can be missed.
    if (spotifyAccessToken) {
      await getSpotifyToken();
    }
    updateSpotifyStatusUI();
  }, 60000);

  debugLog('spotify', '[SPOTIFY] Started periodic status updates');
}

function stopSpotifyStatusUpdates() {
  if (spotifyStatusUpdateInterval) {
    clearInterval(spotifyStatusUpdateInterval);
    spotifyStatusUpdateInterval = null;
    debugLog('spotify', '[SPOTIFY] Stopped periodic status updates');
  }
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
        if (!state) {
          return;
        }

        if (!state.paused && state.duration) {
          if (typeof updateProgressDisplay !== 'undefined') {
            // Update progress display with current position and duration (convert from ms to seconds)
            updateProgressDisplay(state.position / 1000, state.duration / 1000);
          }
          spotifyLastPosition = state.position;
          spotifyLastDuration = state.duration;
          return;
        }

        // End of track. Playback is started with a single uri and no context,
        // so the SDK stops here and nothing advances the queue on its own - the
        // local player has its ended event for that, Spotify has nothing.
        //
        // The signature is paused at position zero right after a position close
        // to the duration. A user pause keeps its position, so it does not match.
        if (state.paused && state.position === 0 && spotifyLastDuration > 0 &&
            spotifyLastPosition >= spotifyLastDuration - 3000) {
          debugLog('spotify', '[SPOTIFY] Track ended, advancing to next');
          stopSpotifyProgressUpdates();
          window.isSpotifyCurrentlyPlaying = false;
          if (typeof skipTrack !== 'undefined') {
            skipTrack();
          }
        }
      }).catch(error => {
        debugLog('SPOTIFY', 'Error getting current state:', error);
      });
    }
  }, 1000); // Update every second
  
  debugLog('spotify', '[SPOTIFY] Started progress updates');
}

function stopSpotifyProgressUpdates() {
  spotifyLastPosition = 0;
  spotifyLastDuration = 0;

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
window.getSpotifyToken = getSpotifyToken; // Single source of Spotify access tokens
window.logoutSpotify = logoutSpotify; // Deliberate logout through the server
window.initSpotifyPlayer = initSpotifyPlayer;
window.initializeSpotifyPlayerInternal = initializeSpotifyPlayerInternal; // Add internal function
window.waitForSpotifySDK = waitForSpotifySDK;
window.clearSpotifyData = clearSpotifyData;
window.updateSpotifyStatusUI = updateSpotifyStatusUI;
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