// Queue Database API Client
class QueueAPI {
  constructor(baseUrl = 'http://127.0.0.1:3001') {
    this.baseUrl = baseUrl;
    this.sessionId = this.generateSessionId();
    this.autoSaveInterval = null;
    this.debugEnabled = false;
  }

  generateSessionId() {
    // Generate a unique session ID based on browser fingerprint and timestamp
    const fingerprint = [
      navigator.userAgent,
      navigator.language,
      screen.width + 'x' + screen.height,
      new Date().getTimezoneOffset(),
      Math.random().toString(36)
    ].join('|');
    
    return btoa(fingerprint).replace(/[^a-zA-Z0-9]/g, '').substr(0, 16);
  }

  log(message, ...args) {
    if (this.debugEnabled) {
      debugLog('queue', `[QUEUE-API] ${message}`, ...args);
    }
  }

  async request(endpoint, options = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      'X-Session-ID': this.sessionId,
      ...options.headers
    };

    try {
      const response = await fetch(url, {
        ...options,
        headers
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      debugLog('QUEUE-API', `Request failed:`, error);
      throw error;
    }
  }

  async saveQueue(queueState) {
    try {
      this.log('Saving queue state:', queueState);
      
      const response = await this.request('/api/queue/save', {
        method: 'POST',
        body: JSON.stringify(queueState)
      });

      if (response.success) {
        this.log('Queue saved successfully:', response);
        return response;
      } else {
        throw new Error(response.error || 'Failed to save queue');
      }
    } catch (error) {
      debugLog('QUEUE-API', 'Save failed:', error);
      // Fallback to localStorage if server fails
      try {
        localStorage.setItem('jukebox_queue_fallback', JSON.stringify(queueState));
        this.log('Fallback: Saved to localStorage');
        return { success: true, fallback: true };
      } catch (fallbackError) {
        debugLog('QUEUE-API', 'Fallback save failed:', fallbackError);
        throw error;
      }
    }
  }

  async loadQueue() {
    try {
      this.log('Loading queue state for session:', this.sessionId);
      
      const response = await this.request('/api/queue/load');

      if (response.success && response.queueState) {
        this.log('Queue loaded successfully:', response.queueState);
        return response.queueState;
      } else {
        this.log('No queue found on server, checking fallback');
        // Try localStorage fallback
        const fallback = localStorage.getItem('jukebox_queue_fallback');
        if (fallback) {
          const queueState = JSON.parse(fallback);
          this.log('Loaded from localStorage fallback:', queueState);
          return queueState;
        }
        return null;
      }
    } catch (error) {
      debugLog('QUEUE-API', 'Load failed:', error);
      // Try localStorage fallback
      try {
        const fallback = localStorage.getItem('jukebox_queue_fallback');
        if (fallback) {
          const queueState = JSON.parse(fallback);
          this.log('Fallback: Loaded from localStorage');
          return queueState;
        }
      } catch (fallbackError) {
        debugLog('QUEUE-API', 'Fallback load failed:', fallbackError);
      }
      return null;
    }
  }

  async getStats() {
    try {
      const response = await this.request('/api/queue/stats');
      return response.success ? response : null;
    } catch (error) {
      debugLog('QUEUE-API', 'Stats failed:', error);
      return null;
    }
  }

  async cleanup(maxAge = 7 * 24 * 60 * 60 * 1000) {
    try {
      const response = await this.request('/api/queue/cleanup', {
        method: 'POST',
        body: JSON.stringify({ maxAge })
      });
      return response.success ? response : null;
    } catch (error) {
      debugLog('QUEUE-API', 'Cleanup failed:', error);
      return null;
    }
  }

  startAutoSave(interval = 30000) {
    this.stopAutoSave();
    
    this.autoSaveInterval = setInterval(async () => {
      if (typeof saveAppState === 'function') {
        try {
          // Get current app state
          const queueState = {
            queue: window.queue || [],
            currentTrackIndex: window.currentTrackIndex || 0,
            currentFilter: window.currentFilter || 'new',
            currentView: window.currentView || 'list',
            currentAZFilter: window.currentAZFilter || 'all',
            playedTracks: window.playedTracks || [],
            volume: window.audioPlayer?.volume || 0.7
          };

          await this.saveQueue(queueState);
          this.log('Auto-save completed');
        } catch (error) {
          debugLog('QUEUE-API', 'Auto-save failed:', error);
        }
      }
    }, interval);

    this.log('Auto-save started, interval:', interval);
  }

  stopAutoSave() {
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
      this.autoSaveInterval = null;
      this.log('Auto-save stopped');
    }
  }

  async migrateLegacyState() {
    try {
      // Check for old localStorage/sessionStorage data
      const legacyState = localStorage.getItem('jukebox_app_state') || 
                         sessionStorage.getItem('jukebox_app_state');
      
      if (legacyState) {
        const state = JSON.parse(legacyState);
        this.log('Found legacy state, migrating:', state);
        
        // Save to new queue API
        await this.saveQueue(state);
        
        // Clean up old storage (optional - keep as backup for now)
        this.log('Migration completed, legacy data preserved as backup');
        return true;
      }
      
      return false;
    } catch (error) {
      debugLog('QUEUE-API', 'Migration failed:', error);
      return false;
    }
  }

  enableDebug() {
    this.debugEnabled = true;
    this.log('Debug mode enabled');
  }

  disableDebug() {
    this.debugEnabled = false;
  }
}

// ===== QUEUE MANAGEMENT FUNCTIONS =====
// High-level queue manipulation functions

// Check if track was recently played (within configured time window)
function isTrackRecentlyPlayed(track) {
  const trackKey = track.type === 'spotify' ? track.uri : track.path;
  const now = Date.now();
  const oneHour = 60 * 60 * 1000;
  
  if (!window.playedTracks) {
    window.playedTracks = [];
  }
  
  return window.playedTracks.some(played => 
    (played.uri === trackKey || played.path === trackKey) && 
    (now - played.timestamp) < oneHour
  );
}

// Check if track is already in queue
function isTrackInQueue(track) {
  if (!window.queue) {
    window.queue = [];
  }
  
  // Use the same track key logic as addToQueue for consistency
  let trackKey;
  if (track.type === 'spotify') {
    trackKey = track.uri;
  } else {
    // For local tracks, use multiple fallbacks to create a unique key
    trackKey = track.path || track.file_path || track.id || track.streamUrl || `${track.artist}_${track.title}_${track.album}`;
  }
  
  const result = window.queue.some(queueTrack => {
    // Generate the same type of key for queue tracks
    let queueKey;
    if (queueTrack.type === 'spotify') {
      queueKey = queueTrack.uri;
    } else {
      queueKey = queueTrack.path || queueTrack.file_path || queueTrack.id || queueTrack.streamUrl || `${queueTrack.artist}_${queueTrack.title}_${queueTrack.album}`;
    }
    
    return queueKey === trackKey;
  });
  
  debugLog('QUEUE', `Checking if track is in queue:`, {
    trackKey,
    trackTitle: track.title,
    trackType: track.type,
    queueLength: window.queue.length,
    result
  });
  
  if (result) {
    debugLog('QUEUE', `Track found in queue at indices:`, 
      window.queue.map((queueTrack, i) => {
        let queueKey;
        if (queueTrack.type === 'spotify') {
          queueKey = queueTrack.uri;
        } else {
          queueKey = queueTrack.path || queueTrack.file_path || queueTrack.id || queueTrack.streamUrl || `${queueTrack.artist}_${queueTrack.title}_${queueTrack.album}`;
        }
        return queueKey === trackKey ? i : null;
      }).filter(i => i !== null)
    );
  }
  
  return result;
}

// Add track to queue with validation and lock time checking
function addToQueue(track) { 
  debugLog('QUEUE', `Adding track to queue:`, track);
  
  if (typeof window.isAddingToQueue !== 'undefined') {
    window.isAddingToQueue = true; // Set flag to prevent navigation activity
  }
  
  // Normalize track type - this was missing and caused playlist issues!
  if (!track.type) {
    if (track.uri || track.spotify_uri) {
      track.type = 'spotify';
    } else if (track.file_path || track.id || track.streamUrl) {
      track.type = 'server';  // Local tracks from musicAPI
    }
  }
  
  // Generate a more robust track key
  let trackKey;
  if (track.type === 'spotify') {
    trackKey = track.uri;
  } else {
    // For local tracks, use multiple fallbacks to create a unique key
    trackKey = track.path || track.file_path || track.id || track.streamUrl || `${track.artist}_${track.title}_${track.album}`;
  }
  
  const now = Date.now();
  const lockTimeMs = (window.trackLockTimeMinutes || 60) * 60 * 1000; // Convert minutes to milliseconds
  
  // Skip lock check if lock time is 0 (disabled)
  if (lockTimeMs > 0) {
    // Find if this track was played recently
    const recentPlay = window.playedTracks && window.playedTracks.find(played => {
      // Generate the same type of key for played tracks
      let playedKey;
      if (track.type === 'spotify') {
        playedKey = played.uri;
      } else {
        playedKey = played.path || played.file_path || played.id || played.streamUrl || `${played.artist}_${played.title}_${played.album}`;
      }
      
      return playedKey === trackKey && (now - played.timestamp) < lockTimeMs;
    });
    
    const currentAdminModeCheck = window.adminPanel && window.adminPanel.isAdminMode ? window.adminPanel.isAdminMode() : false;
    if (recentPlay && !currentAdminModeCheck) {
      const remainingTime = Math.ceil((lockTimeMs - (now - recentPlay.timestamp)) / (60 * 1000));
      if (typeof toast !== 'undefined') {
        toast.info((typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.messages.trackRecentlyPlayed', {minutes: remainingTime}) : `This track was recently played. Please wait ${remainingTime} more minutes.`);
      }
      debugLog('queue', `[QUEUE] Track blocked due to recent play. Remaining time: ${remainingTime} minutes`);
      if (typeof window.isAddingToQueue !== 'undefined') {
        window.isAddingToQueue = false; // Clear flag before return
      }
      return;
    }
  }
  
  // Check if track is already in queue
  const isAlreadyInQueue = window.queue && window.queue.some(queueTrack => {
    // Generate the same type of key for queue tracks
    let queueKey;
    if (queueTrack.type === 'spotify') {
      queueKey = queueTrack.uri;
    } else {
      queueKey = queueTrack.path || queueTrack.file_path || queueTrack.id || queueTrack.streamUrl || `${queueTrack.artist}_${queueTrack.title}_${queueTrack.album}`;
    }
    
    return queueKey === trackKey;
  });
  
  const currentAdminModeQueue = window.adminPanel && window.adminPanel.isAdminMode ? window.adminPanel.isAdminMode() : false;
  if (isAlreadyInQueue && !currentAdminModeQueue) {
    if (typeof toast !== 'undefined') {
      toast.warning((typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.messages.trackAlreadyInQueue') : 'This track is already in the playlist.');
    }
    debugLog('queue', `[QUEUE] Track already in queue`);
    if (typeof window.isAddingToQueue !== 'undefined') {
      window.isAddingToQueue = false; // Clear flag before return
    }
    return;
  }
  
  if (!window.queue) {
    window.queue = [];
  }
  
  window.queue.push(track); 
  
  if (typeof window.debouncedUpdateQueueDisplay === 'function') {
    window.debouncedUpdateQueueDisplay(); 
  }
  
  if (typeof window.saveAppState === 'function') {
    window.saveAppState(); // Save state after queue change
  }
  
  debugLog('queue', `[QUEUE] Track added to queue. Current queue length: ${window.queue.length}`);
  debugLog('queue', `[QUEUE] Current track index: ${window.currentTrackIndex}`);
  
  // Show success message
  if (typeof toast !== 'undefined') {
    toast.success(`"${track.title}" ${(typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.labels.trackAddedToPlaylist') : 'added to playlist'}!`);
  }
  
  if (window.currentTrackIndex === -1) { 
    debugLog('queue', `[QUEUE] Queue was empty, starting playback...`);
    window.currentTrackIndex = 0; 
    // Check if playback is already being initiated to avoid race condition
    if (!window.isCurrentlyPlayingTrack && typeof window.playCurrentTrack === 'function') {
      window.playCurrentTrack(); 
    } else {
      debugLog('queue', `[QUEUE] Playback already starting, skipping duplicate call`);
    }
  } else {
    debugLog('queue', `[QUEUE] Queue has tracks, added to end`);
  }
  
  if (typeof window.isAddingToQueue !== 'undefined') {
    window.isAddingToQueue = false; // Clear flag
  }
}

// Remove track from queue
function removeFromQueue(track) {
  debugLog('queue', `[QUEUE] Removing track from queue:`, track);
  
  if (!window.queue) {
    window.queue = [];
    return;
  }
  
  // Find the track in the queue
  const trackKey = track.type === 'spotify' ? track.uri : (track.path || track.file_path || track.id || `${track.artist}_${track.title}`);
  const trackIndex = window.queue.findIndex(queueTrack => {
    const queueKey = queueTrack.type === 'spotify' ? queueTrack.uri : (queueTrack.path || queueTrack.file_path || queueTrack.id || `${queueTrack.artist}_${queueTrack.title}`);
    return queueKey === trackKey;
  });
  
  if (trackIndex === -1) {
    debugLog('queue', `[QUEUE] Track not found in queue`);
    return;
  }
  
  // Can't remove the currently playing track
  if (trackIndex === window.currentTrackIndex) {
    if (typeof toast !== 'undefined') {
      toast.warning((typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.messages.cannotRemoveCurrentTrack') : 'The currently playing track cannot be removed.');
    }
    return;
  }
  
  // Remove the track from queue
  window.queue.splice(trackIndex, 1);
  
  // Adjust currentTrackIndex if necessary
  if (trackIndex < window.currentTrackIndex) {
    window.currentTrackIndex--;
    debugLog('queue', `[QUEUE] Adjusted currentTrackIndex to ${window.currentTrackIndex}`);
  }
  
  if (typeof window.debouncedUpdateQueueDisplay === 'function') {
    window.debouncedUpdateQueueDisplay();
  }
  
  if (typeof window.saveAppState === 'function') {
    window.saveAppState(); // Save state after queue change
  }
  
  debugLog('queue', `[QUEUE] Track removed from queue. Current queue length: ${window.queue.length}`);
  
  // Show success message
  if (typeof toast !== 'undefined') {
    toast.success((typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.messages.trackRemovedFromPlaylist', {title: track.title}) : `"${track.title}" removed from playlist!`);
  }
}

// Insert track as next in queue
function insertNext(track) {
  // Check if track was played within the configured lock time (same as addToQueue)
  const trackKey = track.type === 'spotify' ? track.uri : track.path;
  const now = Date.now();
  const lockTimeMs = (window.trackLockTimeMinutes || 60) * 60 * 1000; // Convert minutes to milliseconds
  
  // Skip lock check if lock time is 0 (disabled)
  if (lockTimeMs > 0) {
    // Find if this track was played recently
    const recentPlay = window.playedTracks && window.playedTracks.find(played => 
      (played.uri === trackKey || played.path === trackKey) && 
      (now - played.timestamp) < lockTimeMs
    );
    
    const currentAdminMode = window.adminPanel && window.adminPanel.isAdminMode ? window.adminPanel.isAdminMode() : false;
    if (recentPlay && !currentAdminMode) {
      const remainingTime = Math.ceil((lockTimeMs - (now - recentPlay.timestamp)) / (60 * 1000));
      if (typeof toast !== 'undefined') {
        toast.warning(`Dieser Titel wurde kürzlich gespielt. Bitte warte noch ${remainingTime} Minuten.`);
      }
      return;
    }
  }

  // Check if track is already in queue
  const isAlreadyInQueue = window.queue && window.queue.some(queueTrack => {
    const queueKey = queueTrack.type === 'spotify' ? queueTrack.uri : queueTrack.path;
    return queueKey === trackKey;
  });
  
  const currentAdminMode = window.adminPanel && window.adminPanel.isAdminMode ? window.adminPanel.isAdminMode() : false;
  if (isAlreadyInQueue && !currentAdminMode) {
    if (typeof toast !== 'undefined') {
      toast.warning(`Dieser Titel ist bereits in der Playlist.`);
    }
    return;
  }

  if (!window.queue) {
    window.queue = [];
  }

  if (window.currentTrackIndex === -1) {
    window.queue.push(track);
    window.currentTrackIndex = 0;
    if (typeof window.playCurrentTrack === 'function') {
      window.playCurrentTrack();
    }
  } else {
    window.queue.splice(window.currentTrackIndex + 1, 0, track);
    if (typeof window.debouncedUpdateQueueDisplay === 'function') {
      window.debouncedUpdateQueueDisplay();
    }
  }
  
  // Clear search field when track is added
  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    searchInput.value = '';
    // Trigger search activity with empty string to reset UI
    if (typeof window.handleSearchActivity === 'function') {
      window.handleSearchActivity();
    }
  }
  
  // Expand now playing section when track is added
  if (typeof window.expandNowPlayingSection === 'function') {
    window.expandNowPlayingSection();
  }
}

// Enforce queue consistency - if queue is empty, stop everything
function enforceQueueConsistency() {
  if (!window.queue) {
    window.queue = [];
  }
  
  if (window.queue.length === 0) {
    debugLog('queue', `[QUEUE] Queue is empty - stopping all playback`);
    window.currentTrackIndex = -1;
    
    if (typeof window.stopAllPlayback === 'function') {
      window.stopAllPlayback();
    }
    
    // Clear UI
    const footerInfoEl = document.getElementById('nowPlayingInfo');
    if (footerInfoEl) {
      const titleEl = footerInfoEl.querySelector('#nowPlayingTitle');
      if (titleEl) titleEl.textContent = '';
    }
    
    const coverImageEl = document.getElementById('coverImage');
    const nowPlayingCoverEl = document.getElementById('nowPlayingCover');
    if (coverImageEl) coverImageEl.src = 'assets/default_cover.png';
    if (nowPlayingCoverEl) nowPlayingCoverEl.src = 'assets/default_cover.png';
    
    return true; // Stopped
  }
  
  // If currentTrackIndex is invalid, reset it
  if (window.currentTrackIndex >= window.queue.length) {
    debugLog('queue', `[QUEUE] Invalid track index ${window.currentTrackIndex} for queue length ${window.queue.length} - resetting`);
    window.currentTrackIndex = window.queue.length - 1;
  }
  
  if (window.currentTrackIndex < -1) {
    debugLog('queue', `[QUEUE] Invalid negative track index ${window.currentTrackIndex} - resetting to 0`);
    window.currentTrackIndex = 0;
  }
  
  return false; // Not stopped
}

// Initialize global queue API instance
if (typeof window !== 'undefined') {
  window.queueAPI = new QueueAPI();
  
  // Export queue management functions globally
  window.isTrackRecentlyPlayed = isTrackRecentlyPlayed;
  window.isTrackInQueue = isTrackInQueue;
  window.addToQueue = addToQueue;
  window.removeFromQueue = removeFromQueue;
  window.insertNext = insertNext;
  window.enforceQueueConsistency = enforceQueueConsistency;
  
  // Auto-migrate legacy data on load
  document.addEventListener('DOMContentLoaded', async () => {
    try {
      await window.queueAPI.migrateLegacyState();
    } catch (error) {
      debugLog('QUEUE-API', 'Migration on load failed:', error);
    }
  });
}

// Export for Node.js environments
if (typeof module !== 'undefined' && module.exports) {
  module.exports = QueueAPI;
}
