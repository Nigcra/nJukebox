// Audio module for Jukebox
// Handles audio playback, volume control, and pro  debugLog('audio', '[STOP] Stopping all playback...');ress tracking

// Audio player variables
let audioPlayer = null;
let volumeSlider = null;
let currentTrackDuration = 0;
let progressUpdateInterval = null;

// Initialize audio player
function initializeAudioPlayer() {
  // Try to get the audio player element
  audioPlayer = document.getElementById('audioPlayer');
  volumeSlider = document.getElementById('volumeSlider');
  
  if (!audioPlayer) {
    debugLog('AUDIO', 'Audio player element not found, retrying in 100ms...');
    setTimeout(initializeAudioPlayer, 100);
    return false;
  }
  
  // Check if already initialized to avoid duplicate listeners
  if (audioPlayer.dataset.initialized === 'true') {
    if (typeof debugLog !== 'undefined') {
      debugLog('AUDIO', 'Audio player already initialized');
    }
    return true;
  }
  
  // Mark as initialized
  audioPlayer.dataset.initialized = 'true';
  
  // Add event listeners for audio player
  audioPlayer.addEventListener('loadedmetadata', () => {
    if (audioPlayer.duration && isFinite(audioPlayer.duration)) {
      setTrackDuration(audioPlayer.duration);
      if (typeof debugLog !== 'undefined') {
        debugLog('AUDIO', 'Track duration loaded:', formatTime(audioPlayer.duration));
      }
    }
  });
  
  audioPlayer.addEventListener('timeupdate', () => {
    if (!audioPlayer.paused && audioPlayer.duration) {
      updateProgressDisplay(audioPlayer.currentTime, audioPlayer.duration);
    }
  });
  
  audioPlayer.addEventListener('ended', () => {
    if (typeof debugLog !== 'undefined') {
      debugLog('AUDIO', 'Track ended, advancing to next');
    }
    if (typeof skipTrack !== 'undefined') {
      skipTrack();
    }
  });
  
  audioPlayer.addEventListener('error', (e) => {
    // Only log meaningful errors, ignore expected ones like when src is cleared
    if (audioPlayer.error && audioPlayer.error.code !== 4) { // 4 = MEDIA_ELEMENT_ERROR: Media loading aborted
      debugLog('AUDIO', 'Audio playback error:', {
        code: audioPlayer.error?.code,
        message: audioPlayer.error?.message,
        networkState: audioPlayer.networkState,
        readyState: audioPlayer.readyState,
        src: audioPlayer.src
      });
      
      if (typeof toast !== 'undefined' && audioPlayer.src) { // Only show toast if we actually have a source
        toast.error(`Audio error: ${audioPlayer.error?.message || 'Unknown error'}`);
      }
    }
  });
  
  // Initialize volume slider event listener
  if (volumeSlider) {
    volumeSlider.addEventListener('input', (e) => {
      // Check if admin mode is enabled (from global scope)
      if (typeof isAdminMode !== 'undefined' && !isAdminMode) {
        e.preventDefault();
        volumeSlider.value = audioPlayer.volume;
        if (typeof toast !== 'undefined') {
          toast.error('Nur der Administrator kann die Lautstärke ändern.');
        }
        return;
      }
      
      const volume = parseFloat(e.target.value);
      
      if (typeof debugLog !== 'undefined') {
        debugLog('AUDIO', 'Volume slider changed to:', volume);
      }
      
      // Use universal volume control for both local and Spotify
      if (typeof setUniversalVolume !== 'undefined') {
        setUniversalVolume(volume);
      } else {
        // Fallback to local audio only
        if (audioPlayer) {
          audioPlayer.volume = volume;
        }
      }
    });
  }
  
  if (typeof debugLog !== 'undefined') {
    debugLog('AUDIO', 'Audio player initialized');
  }
  return true;
}

// Central function to stop all playback
function stopAllPlayback() {
  debugLog('audio', '[STOP] Stopping all playback...');
  
  // Stop local audio player
  if (audioPlayer) {
    if (!audioPlayer.paused) {
      audioPlayer.pause();
    }
    audioPlayer.currentTime = 0;
    // Only clear src if it's actually set to avoid unnecessary error events
    if (audioPlayer.src && !audioPlayer.src.endsWith('about:blank')) {
      audioPlayer.src = '';
    }
    debugLog('audio', '[STOP] Local audio player stopped');
  }
  
  // Stop Spotify player
  if (window.spotifyPlayer) {
    window.spotifyPlayer.pause().then(() => {
      debugLog('audio', '[STOP] Spotify player stopped');
      // Reset Spotify playing status
      window.isSpotifyCurrentlyPlaying = false;
    }).catch(error => {
      debugLog('audio', '[STOP] Spotify pause error (may be normal):', error);
      // Reset Spotify playing status even on error
      window.isSpotifyCurrentlyPlaying = false;
    });
  }
  
  // Stop progress updates
  stopFooterProgressUpdates();
  
  // Stop Auto-DJ if it's running
  if (window.isAutoDjActive && typeof toggleAutoDj !== 'undefined') {
    debugLog('audio', '[STOP] Stopping Auto-DJ');
    toggleAutoDj(false);
  }
  
  // Update UI layout if queue is empty or no track is playing
  if (typeof window.updateUILayout !== 'undefined') {
    window.updateUILayout();
  }
}

// Play current track from queue
// Prevent race conditions
let isCurrentlyPlayingTrack = false; 
window.isCurrentlyPlayingTrack = false; // Global access for other modules

function playCurrentTrack() {
  debugLog('audio', `[PLAY] playCurrentTrack called. currentTrackIndex: ${window.currentTrackIndex}, queue length: ${window.queue ? window.queue.length : 0}`);
  
  // Prevent race condition - if already in process of playing, return
  if (window.isCurrentlyPlayingTrack) {
    debugLog('audio', '[PLAY] Already in process of playing track, ignoring duplicate call');
    return;
  }
  
  // Additional protection: Check if we're currently loading/starting playback
  if (audioPlayer && (audioPlayer.readyState === 1 || audioPlayer.readyState === 2)) {
    debugLog('audio', '[PLAY] Audio element still loading, ignoring duplicate call');
    return;
  }
  
  window.isCurrentlyPlayingTrack = true;
  
  // Prevent UI flickering during track changes
  if (window.updateQueueTimeout) {
    clearTimeout(window.updateQueueTimeout);
    window.updateQueueTimeout = null;
  }
  if (window.updateNowPlayingTimeout) {
    clearTimeout(window.updateNowPlayingTimeout);
    window.updateNowPlayingTimeout = null;
  }
  
  // Check if queue management is available and enforce consistency
  if (typeof enforceQueueConsistency !== 'undefined' && enforceQueueConsistency()) {
    debugLog('audio', '[PLAY] Queue is empty - playback stopped');
    isCurrentlyPlayingTrack = false; // Reset flag only when truly stopping
    window.isCurrentlyPlayingTrack = false;
    return;
  }
  
  // Stop all playback first to prevent conflicts
  stopAllPlayback();
  
  const track = window.queue && window.queue[window.currentTrackIndex];
  if (!track) { 
    debugLog('audio', `[PLAY] No track found at index ${window.currentTrackIndex}`);
    // Set default cover
    const coverImageEl = document.getElementById('coverImage');
    if (coverImageEl) coverImageEl.src = 'assets/default_cover.png';
    isCurrentlyPlayingTrack = false; // Reset flag
    window.isCurrentlyPlayingTrack = false;
    return; 
  }
  
  // Validate track has minimum required properties
  if (!track.title && !track.name) {
    debugLog('AUDIO', 'Track has no title/name:', track);
    isCurrentlyPlayingTrack = false; // Reset flag
    window.isCurrentlyPlayingTrack = false;
    return;
  }
  
  debugLog('audio', '[PLAY] Playing track:', track);
  debugLog('audio', '[PLAY] Track type:', track.type);
  debugLog('audio', '[PLAY] Track path:', track.path);
  
  // Add to played tracks history  
  if (window.playedTracks) {
    window.playedTracks.push({
      uri: track.uri || null,
      path: track.path || null,
      id: track.id || null,
      streamUrl: track.streamUrl || null,
      artist: track.artist || null,
      title: track.title || null,
      album: track.album || null,
      timestamp: Date.now()
    });
    
    // Keep only last hour of played tracks
    const oneHour = 60 * 60 * 1000;
    const now = Date.now();
    window.playedTracks = window.playedTracks.filter(playedTrack => 
      (now - playedTrack.timestamp) < oneHour
    );
  }
  
  // Determine track type
  const isSpotifyTrack = track.type === 'spotify' || track.uri || track.spotify_uri || track.isSpotify;
  const isLocalTrack = track.type === 'server' || track.streamUrl || track.path || track.file_path;
  
  debugLog('audio', `[PLAY] Track type: ${track.type}`);
  debugLog('audio', `[PLAY] Track path: ${track.path || track.file_path}`);
  debugLog('audio', `[PLAY] Determined: isSpotifyTrack=${isSpotifyTrack}, isLocalTrack=${isLocalTrack}`);
  
  // Update Now Playing UI
  updateNowPlayingDisplay(track);
  
  // Play the track based on type
  if (isSpotifyTrack) {
    playSpotifyTrackFromObject(track);
  } else if (isLocalTrack) {
    playLocalTrack(track);
  } else {
    debugLog('AUDIO', 'Unknown track type:', track);
  }
  
  // Record track play for statistics
  recordTrackPlay(track);
  
  // Start progress updates
  startFooterProgressUpdates();
  
  // Update UI layout (switch to now-playing mode if needed)
  if (typeof window.updateUILayout !== 'undefined') {
    window.updateUILayout();
  }
  
  // Update queue display
  if (typeof debouncedUpdateQueueDisplay !== 'undefined') {
    debouncedUpdateQueueDisplay();
  }
  
  // Reset race condition flag at the end
  isCurrentlyPlayingTrack = false;
  window.isCurrentlyPlayingTrack = false;
}

// Play local (server) track
function playLocalTrack(track) {
  debugLog('audio', '[LOCAL] Playing local track:', track.title);
  
  if (!audioPlayer) {
    debugLog('AUDIO', 'Audio player not initialized');
    return;
  }
  
  const streamUrl = track.streamUrl || (window.musicAPI ? window.musicAPI.getStreamURL(track.id) : null);
  
  if (!streamUrl) {
    debugLog('AUDIO', 'No stream URL available for track:', track);
    if (typeof toast !== 'undefined') {
      toast.error('Cannot play track - no stream URL');
    }
    return;
  }
  
  debugLog('audio', '[LOCAL] Stream URL:', streamUrl);
  
  // Set up audio player
  audioPlayer.src = streamUrl;
  audioPlayer.volume = 0.7; // Default volume
  
  // Play with error handling
  audioPlayer.play().then(() => {
    debugLog('audio', '[LOCAL] Track started successfully');
    if (typeof debugLog !== 'undefined') {
      debugLog('AUDIO', 'Local track playing:', track.title);
    }
  }).catch(error => {
    debugLog('AUDIO', 'Playback failed:', error);
    if (typeof toast !== 'undefined') {
      toast.error(`Playback failed: ${error.message}`);
    }
    // Reset race condition flag on error
    isCurrentlyPlayingTrack = false;
    window.isCurrentlyPlayingTrack = false;
  });
}

// Play Spotify track
function playSpotifyTrackFromObject(track) {
  debugLog('audio', '[SPOTIFY] Playing Spotify track:', track.title);
  
  const uri = track.uri || track.spotify_uri;
  if (!uri) {
    debugLog('AUDIO', 'No Spotify URI available:', track);
    if (typeof toast !== 'undefined') {
      toast.error('Cannot play Spotify track - no URI');
    }
    return;
  }
  
  // Use global Spotify function from main file (which takes URI string)
  if (typeof window.playSpotifyTrack !== 'undefined') {
    window.playSpotifyTrack(uri);
  } else {
    debugLog('AUDIO', 'Spotify playback function not available');
    if (typeof toast !== 'undefined') {
      toast.error('Spotify player not available');
    }
  }
}

// Update now playing display
function updateNowPlayingDisplay(track) {
  if (!track) return;
  
  // Update footer display
  let footerText = '';
  let footerArtist = track.artist || '';
  let footerTitle = track.title || track.name || 'Unknown Track';
  
  // Handle Spotify track title format
  if (track.type === 'spotify' && footerTitle.includes(' – ')) {
    const parts = footerTitle.split(' – ');
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
  
  // Update cover image
  if (typeof updateNowPlayingCover !== 'undefined') {
    updateNowPlayingCover(track);
  }
  
  // Update large now playing section
  let cleanTitle = footerTitle;
  let artist = footerArtist;
  let album = track.album || '';
  
  const nowPlayingTitle = document.getElementById('nowPlayingTitle');
  const nowPlayingArtist = document.getElementById('nowPlayingArtist');
  const nowPlayingAlbum = document.getElementById('nowPlayingAlbum');
  
  if (nowPlayingTitle) nowPlayingTitle.textContent = cleanTitle;
  if (nowPlayingArtist) nowPlayingArtist.textContent = artist;
  if (nowPlayingAlbum) nowPlayingAlbum.textContent = album;
  
  if (typeof debugLog !== 'undefined') {
    debugLog('AUDIO', 'Now playing display updated:', cleanTitle);
  }
}

// Progress tracking functions
function updateProgressDisplay(currentTime, duration) {
  const progressFill = document.getElementById('footerProgressFill');
  const currentTimeEl = document.getElementById('currentTime');
  const totalTimeEl = document.getElementById('totalTime');
  
  if (!progressFill || !currentTimeEl || !totalTimeEl) {
    debugLog('audio', '[AUDIO] Missing elements in updateProgressDisplay');
    return;
  }
  
  // Validate input values
  if (!isFinite(currentTime) || currentTime < 0) currentTime = 0;
  if (!isFinite(duration) || duration <= 0) duration = 0;
  
  // Update progress bar
  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;
  progressFill.style.width = Math.min(100, Math.max(0, progressPercent)) + '%';
  
  // Update time display
  currentTimeEl.textContent = formatTime(currentTime);
  totalTimeEl.textContent = formatTime(duration);
}

function setTrackDuration(duration) {
  currentTrackDuration = duration;
  debugLog('audio', '[AUDIO] Track duration set to:', formatTime(duration));
}

function startFooterProgressUpdates() {
  stopFooterProgressUpdates(); // Clear any existing interval
  
  progressUpdateInterval = setInterval(updateFooterProgress, 1000); // Update every second
  updateFooterProgress(); // Update immediately
  debugLog('audio', '[AUDIO] Started progress updates');
}

function stopFooterProgressUpdates() {
  if (progressUpdateInterval) {
    clearInterval(progressUpdateInterval);
    progressUpdateInterval = null;
    debugLog('audio', '[AUDIO] Stopped progress updates');
  }
  
  // Clear progress display
  const progressFill = document.getElementById('footerProgressFill');
  const currentTimeEl = document.getElementById('currentTime');
  const totalTimeEl = document.getElementById('totalTime');
  
  if (progressFill) progressFill.style.width = '0%';
  if (currentTimeEl) currentTimeEl.textContent = '0:00';
  if (totalTimeEl) totalTimeEl.textContent = '0:00';
}

function updateFooterProgress() {
  if (!audioPlayer) return;
  
  // Handle different playback sources
  if (window.currentTrackIndex !== -1 && window.queue && window.queue[window.currentTrackIndex]) {
    const currentTrack = window.queue[window.currentTrackIndex];
    
    if (currentTrack.type === 'spotify') {
      // Spotify progress is handled by Spotify module
      return;
    }
  }
  
  // Local audio progress
  if (audioPlayer && !audioPlayer.paused && audioPlayer.duration) {
    updateProgressDisplay(audioPlayer.currentTime, audioPlayer.duration);
  }
}

// Volume control functions
function setVolume(volume) {
  if (audioPlayer) {
    audioPlayer.volume = Math.max(0, Math.min(1, volume));
    if (typeof debugLog !== 'undefined') {
      debugLog('AUDIO', 'Volume set to:', audioPlayer.volume);
    }
  }
}

function getVolume() {
  return audioPlayer ? audioPlayer.volume : 0.7;
}

// Audio playback control
function pauseCurrentTrack() {
  if (audioPlayer && !audioPlayer.paused) {
    audioPlayer.pause();
    debugLog('audio', '[AUDIO] Local track paused');
  }
  
  if (window.spotifyPlayer) {
    window.spotifyPlayer.pause().then(() => {
      debugLog('audio', '[AUDIO] Spotify track paused');
    }).catch(error => {
      debugLog('audio', '[AUDIO] Spotify pause error:', error);
    });
  }
  
  stopFooterProgressUpdates();
}

function resumeCurrentTrack() {
  if (audioPlayer && audioPlayer.paused && audioPlayer.src) {
    audioPlayer.play().then(() => {
      debugLog('audio', '[AUDIO] Local track resumed');
      startFooterProgressUpdates();
      // Update UI layout when resuming
      if (typeof window.updateUILayout !== 'undefined') {
        window.updateUILayout();
      }
    }).catch(error => {
      debugLog('AUDIO', 'Resume failed:', error);
    });
  }
  
  if (window.spotifyPlayer) {
    window.spotifyPlayer.resume().then(() => {
      debugLog('audio', '[AUDIO] Spotify track resumed');
      startFooterProgressUpdates();
      // Update UI layout when resuming
      if (typeof window.updateUILayout !== 'undefined') {
        window.updateUILayout();
      }
    }).catch(error => {
      debugLog('audio', '[AUDIO] Spotify resume error:', error);
    });
  }
}

// Record track play for statistics
function recordTrackPlay(track) {
  if (!track) return;
  
  if (track.type === 'spotify' && track.uri && window.musicAPI) {
    // Extract Spotify track ID from URI (spotify:track:ID -> ID)
    const spotifyId = track.uri.replace('spotify:track:', '');
    
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
    
    window.musicAPI.recordSpotifyPlay(spotifyId, trackData).catch(error => {
      debugLog('AUDIO', 'Failed to record Spotify play:', error);
    });
  } else if (track.id && window.musicAPI) {
    window.musicAPI.recordTrackPlay(track.id).catch(error => {
      debugLog('AUDIO', 'Failed to record track play:', error);
    });
  }
}

// Format time helper function
function formatTime(seconds) {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Play track by ID (external API)
async function playTrack(trackId) {
  try {
    if (!window.musicAPI) {
      debugLog('AUDIO', 'Music API not available');
      return;
    }
    
    const response = await window.musicAPI.getTrack(trackId);
    if (response && response.success && response.data) {
      // Add to queue first, then play it
      if (typeof addToQueue !== 'undefined') {
        addToQueue(response.data);
        // If this is the only track in queue, it should auto-play
        if (window.queue && window.queue.length === 1) {
          window.currentTrackIndex = 0;
          playCurrentTrack();
        }
      } else {
        debugLog('AUDIO', 'Queue management not available');
      }
    } else {
      debugLog('AUDIO', 'Track not found:', trackId);
      if (typeof toast !== 'undefined') {
        toast.error('Track not found');
      }
    }
  } catch (error) {
    debugLog('AUDIO', 'Error loading track:', error);
    if (typeof toast !== 'undefined') {
      toast.error('Error loading track');
    }
  }
}

// High-level playback control functions (UI button handlers)
async function resumePlayback() {
  // Check if admin mode is enabled (from global scope)
  if (typeof window.isAdminMode !== 'undefined' && !window.isAdminMode) {
    if (typeof toast !== 'undefined') {
      const adminOnlyText = (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) 
        ? window.i18nSystem.t('ui.messages.adminOnly') 
        : 'Nur der Administrator kann die Wiedergabe steuern.';
      toast.error(adminOnlyText);
    }
    return;
  }
  
  if (!window.queue || window.queue.length === 0) {
    debugLog('audio', '[RESUME] No tracks in queue');
    return;
  }
  
  // Reset manual stop flag when user manually resumes playback
  if (typeof window.userManuallyStoppedMusic !== 'undefined' && window.userManuallyStoppedMusic) {
    window.userManuallyStoppedMusic = false;
    debugLog('audio', '[RESUME] User manually resumed - Auto-DJ reactivated');
  }
  
  if (window.currentTrackIndex === -1) {
    // Find next unplayed track instead of just resetting to 0
    let nextUnplayedIndex = 0;
    while (nextUnplayedIndex < window.queue.length && 
           typeof isTrackRecentlyPlayed !== 'undefined' && 
           isTrackRecentlyPlayed(window.queue[nextUnplayedIndex])) {
      nextUnplayedIndex++;
    }
    
    if (nextUnplayedIndex >= window.queue.length) {
      debugLog('audio', '[RESUME] All tracks have been played - no action taken');
      return;
    }
    
    window.currentTrackIndex = nextUnplayedIndex;
    debugLog('audio', `[RESUME] Resuming at track ${nextUnplayedIndex} (skipped ${nextUnplayedIndex} already played tracks)`);
    playCurrentTrack();
  } else {
    // Resume current track
    const currentTrack = window.queue[window.currentTrackIndex];
    if (currentTrack && currentTrack.type === 'spotify' && window.spotifyPlayer) {
      try {
        await window.spotifyPlayer.resume();
        debugLog('audio', '[RESUME] Spotify track resumed');
        // Set Spotify playing status to true when resumed
        window.isSpotifyCurrentlyPlaying = true;
      } catch (error) {
        debugLog('audio', '[RESUME] Spotify resume error, restarting track:', error);
        // Fallback: Track neu starten
        playCurrentTrack();
      }
    } else if (audioPlayer && audioPlayer.src) {
      audioPlayer.play().then(() => {
        debugLog('audio', '[RESUME] Local track resumed');
      }).catch(error => {
        debugLog('audio', '[RESUME] Local resume error:', error);
      });
    }
    
    // Resume 3D rotation animations if they were running
    if (typeof window.startOccasional3DRotations === 'function') {
      window.startOccasional3DRotations();
    }
    
    // Resume footer progress updates
    startFooterProgressUpdates();
    
    // Update UI layout
    if (typeof window.updateUILayout !== 'undefined') {
      window.updateUILayout();
    }
  }
}

async function pausePlayback() {
  // Check if admin mode is enabled (from global scope)
  if (typeof window.isAdminMode !== 'undefined' && !window.isAdminMode) {
    if (typeof toast !== 'undefined') {
      const adminOnlyText = (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) 
        ? window.i18nSystem.t('ui.messages.adminOnly') 
        : 'Nur der Administrator kann die Wiedergabe steuern.';
      toast.error(adminOnlyText);
    }
    return;
  }
  
  if (!window.queue || window.currentTrackIndex === -1) {
    debugLog('audio', '[PAUSE] No track currently playing');
    return;
  }
  
  const currentTrack = window.queue[window.currentTrackIndex];
  if (currentTrack && currentTrack.type === 'spotify' && window.spotifyPlayer) {
    try {
      await window.spotifyPlayer.pause();
      debugLog('audio', '[PAUSE] Spotify track paused');
      // Set Spotify playing status to false when paused
      window.isSpotifyCurrentlyPlaying = false;
    } catch (error) {
      debugLog('audio', '[PAUSE] Spotify pause error:', error);
      // Set status to false even on error
      window.isSpotifyCurrentlyPlaying = false;
    }
  } else if (audioPlayer && !audioPlayer.paused) {
    audioPlayer.pause();
    debugLog('audio', '[PAUSE] Local track paused');
  }
  
  // Pause 3D rotations during pause
  if (typeof window.stop3DRotations === 'function') {
    window.stop3DRotations();
  }
  
  // Pause footer progress updates (but keep the display)
  stopFooterProgressUpdates();
}

async function stopPlayback() {
  // Check if admin mode is enabled (from global scope)
  if (typeof window.isAdminMode !== 'undefined' && !window.isAdminMode) {
    if (typeof toast !== 'undefined') {
      const adminOnlyText = (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) 
        ? window.i18nSystem.t('ui.messages.adminOnly') 
        : 'Nur der Administrator kann die Wiedergabe steuern.';
      toast.error(adminOnlyText);
    }
    return;
  }
  
  // Mark as manually stopped to prevent Auto-DJ from immediately continuing
  if (typeof window.userManuallyStoppedMusic !== 'undefined') {
    window.userManuallyStoppedMusic = true;
    debugLog('audio', '[STOP] User manually stopped music - Auto-DJ will pause');
  }
  
  const currentTrack = window.queue && window.queue[window.currentTrackIndex];
  if (currentTrack && currentTrack.type === 'spotify' && window.spotifyPlayer) {
    try {
      await window.spotifyPlayer.pause();
      debugLog('audio', '[STOP] Spotify track stopped');
      window.isSpotifyCurrentlyPlaying = false;
    } catch (error) {
      debugLog('audio', '[STOP] Spotify stop error:', error);
      window.isSpotifyCurrentlyPlaying = false;
    }
  } else if (audioPlayer) {
    audioPlayer.pause();
    audioPlayer.currentTime = 0;
    debugLog('audio', '[STOP] Local track stopped');
  }
  
  // Don't reset currentTrackIndex to -1 when stopping - keep the track position
  // This allows the now-playing panel to remain visible with the stopped track
  
  // Stop footer progress updates
  stopFooterProgressUpdates();
  
  // Stop Spotify progress updates
  if (typeof window.stopSpotifyProgressUpdates === 'function') {
    window.stopSpotifyProgressUpdates();
  }
  
  // Update footer progress to show stopped state, but keep track info
  const footerInfoEl = document.getElementById('nowPlayingInfo');
  if (footerInfoEl) {
    const currentTime = footerInfoEl.querySelector('#currentTime');
    const progressFill = footerInfoEl.querySelector('#footerProgressFill');
    if (currentTime) currentTime.textContent = '0:00';
    if (progressFill) progressFill.style.width = '0%';
  }
  
  // Reset cover images to default
  const coverImageEl = document.getElementById('coverImage');
  const nowPlayingCoverEl = document.getElementById('nowPlayingCover');
  if (coverImageEl) coverImageEl.src = 'assets/default_cover.png';
  if (nowPlayingCoverEl) nowPlayingCoverEl.src = 'assets/default_cover.png';
  
  // Clear the large now playing section elements
  const nowPlayingTitle = document.getElementById('nowPlayingTitle');
  const nowPlayingArtist = document.getElementById('nowPlayingArtist');
  const nowPlayingAlbum = document.getElementById('nowPlayingAlbum');
  
  if (nowPlayingTitle) nowPlayingTitle.textContent = '';
  if (nowPlayingArtist) nowPlayingArtist.textContent = '';
  if (nowPlayingAlbum) nowPlayingAlbum.textContent = '';
  
  // Hide the now playing section when nothing is playing with smooth animation
  const nowPlayingSection = document.getElementById('nowPlayingSection');
  if (nowPlayingSection) {
    nowPlayingSection.classList.add('collapsed');
    nowPlayingSection.classList.remove('expanded');
    
    // After animation completes, set display none
    setTimeout(() => {
      nowPlayingSection.style.display = 'none';
    }, 500); // Match the CSS transition duration
  }
  
  // Switch to search mode automatically
  const content = document.getElementById('content');
  if (content) {
    content.classList.add('search-mode');
    content.classList.remove('now-playing-mode');
  }
  
  // Stop 3D rotation animations
  if (typeof window.stop3DRotations === 'function') {
    window.stop3DRotations();
  }
  
  // Stop Auto-DJ if it's running
  if (typeof window.isAutoDjActive !== 'undefined' && window.isAutoDjActive) {
    debugLog('audio', '[STOP] Stopping Auto-DJ due to manual stop');
    if (typeof window.toggleAutoDj === 'function') {
      window.toggleAutoDj(false);
    }
  }
  
  // Update queue display
  if (typeof window.debouncedUpdateQueueDisplay === 'function') {
    window.debouncedUpdateQueueDisplay();
  }
}

// Export to global scope for compatibility
if (typeof window !== 'undefined') {
  // Variables
  Object.defineProperty(window, 'audioPlayer', {
    get: () => audioPlayer,
    set: (value) => { audioPlayer = value; }
  });
  Object.defineProperty(window, 'currentTrackDuration', {
    get: () => currentTrackDuration,
    set: (value) => { currentTrackDuration = value; }
  });
  Object.defineProperty(window, 'progressUpdateInterval', {
    get: () => progressUpdateInterval,
    set: (value) => { progressUpdateInterval = value; }
  });
  
  // Functions
  window.initializeAudioPlayer = initializeAudioPlayer;
  window.stopAllPlayback = stopAllPlayback;
  window.playCurrentTrack = playCurrentTrack;
  window.playLocalTrack = playLocalTrack;
  // Don't export playSpotifyTrack to avoid overwriting main file's function
  window.updateNowPlayingDisplay = updateNowPlayingDisplay;
  window.updateProgressDisplay = updateProgressDisplay;
  window.setTrackDuration = setTrackDuration;
  window.startFooterProgressUpdates = startFooterProgressUpdates;
  window.stopFooterProgressUpdates = stopFooterProgressUpdates;
  window.updateFooterProgress = updateFooterProgress;
  window.setVolume = setVolume;
  window.getVolume = getVolume;
  window.pauseCurrentTrack = pauseCurrentTrack;
  window.resumeCurrentTrack = resumeCurrentTrack;
  window.recordTrackPlay = recordTrackPlay;
  window.formatTime = formatTime;
  window.playTrack = playTrack;
  
  // High-level playback controls (UI button handlers)
  window.resumePlayback = resumePlayback;
  window.pausePlayback = pausePlayback;
  window.stopPlayback = stopPlayback;
  
  // Export DOM elements
  window.volumeSlider = volumeSlider;
  
  // Auto-initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeAudioPlayer);
  } else {
    initializeAudioPlayer();
  }
}
