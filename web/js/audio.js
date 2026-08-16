// audio.js
// Local and Spotify playback, volume control and progress tracking
// Version: 2026.08.16

// Audio player variables
//
// Local playback runs on two decks. A single <audio> element holds exactly one
// source, so a title can never fade into the next one on it - the moment src is
// reassigned the old one is gone. audioPlayer always points at the deck that is
// the current one; during a fade the other deck still holds the outgoing title.
let audioPlayer = null;
let audioDeckA = null;
let audioDeckB = null;
let volumeSlider = null;
let currentTrackDuration = 0;
let progressUpdateInterval = null;

function audioDecks() {
  return [audioDeckA, audioDeckB].filter(Boolean);
}

// The deck that is free to take the incoming title.
function idleAudioDeck() {
  return audioPlayer === audioDeckA ? audioDeckB : audioDeckA;
}

// Attaches the listeners to one deck. Everything that acts on the queue is
// guarded by "is this the current deck": during a crossfade both decks are
// alive, and only one of them may drive the UI and the queue.
function wireAudioDeck(deck) {
  if (!deck || deck.dataset.initialized === 'true') {
    return false;
  }
  deck.dataset.initialized = 'true';

  deck.addEventListener('loadedmetadata', () => {
    if (deck !== audioPlayer) return;
    if (deck.duration && isFinite(deck.duration)) {
      setTrackDuration(deck.duration);
      if (typeof debugLog !== 'undefined') {
        debugLog('AUDIO', 'Track duration loaded:', formatTime(deck.duration));
      }
    }
  });

  deck.addEventListener('timeupdate', () => {
    if (deck !== audioPlayer || deck.paused || !deck.duration) return;
    updateProgressDisplay(deck.currentTime, deck.duration);

    // The fade has to begin before the file runs out, so the end of the title
    // is watched here rather than left to "ended" - by the time that fires
    // there is nothing left to fade out.
    if (window.CrossfadeEngine) {
      window.CrossfadeEngine.considerLocalTransition(deck);
    }
  });

  deck.addEventListener('ended', () => {
    // A crossfade pauses the outgoing deck before it runs out, but a fade that
    // started late can still let it end. Only the current deck may advance the
    // queue; the other one would skip a title.
    if (deck !== audioPlayer) {
      debugLog('audio', '[AUDIO] Outgoing deck ended after the fade, ignoring');
      return;
    }
    if (typeof debugLog !== 'undefined') {
      debugLog('AUDIO', 'Track ended, advancing to next');
    }
    if (typeof skipTrack !== 'undefined') {
      skipTrack();
    }
  });

  deck.addEventListener('error', (e) => {
    // Only log meaningful errors, ignore expected ones like when src is cleared
    if (deck.error && deck.error.code !== 4) { // 4 = MEDIA_ELEMENT_ERROR: Media loading aborted
      debugLog('AUDIO', 'Audio playback error:', {
        code: deck.error?.code,
        message: deck.error?.message,
        networkState: deck.networkState,
        readyState: deck.readyState,
        src: deck.src
      });

      if (typeof toast !== 'undefined' && deck.src) { // Only show toast if we actually have a source
        toast.error(`Audio error: ${deck.error?.message || 'Unknown error'}`);
      }
    }
  });

  return true;
}

// Initialize audio player
function initializeAudioPlayer() {
  // Try to get the audio player elements
  audioDeckA = document.getElementById('audioPlayer');
  audioDeckB = document.getElementById('audioPlayerB');
  volumeSlider = document.getElementById('volumeSlider');

  if (!audioDeckA || !audioDeckB) {
    debugLog('AUDIO', 'Audio player elements not found, retrying in 100ms...');
    setTimeout(initializeAudioPlayer, 100);
    return false;
  }

  if (!audioPlayer) {
    audioPlayer = audioDeckA;
  }

  wireAudioDeck(audioDeckA);
  wireAudioDeck(audioDeckB);

  // From here on the fade engine owns the volume of both decks. What is set on
  // an element is always master volume times fade gain - writing element.volume
  // directly would fight a running fade and win for one tick.
  if (window.CrossfadeEngine) {
    audioDecks().forEach(deck => window.CrossfadeEngine.registerDeck(deck));
    if (volumeSlider) {
      const sliderVolume = parseFloat(volumeSlider.value);
      if (isFinite(sliderVolume)) {
        window.CrossfadeEngine.setMasterVolume(sliderVolume);
      }
    }
  }

  // Initialize volume slider event listener
  if (volumeSlider && volumeSlider.dataset.initialized !== 'true') {
    volumeSlider.dataset.initialized = 'true';
    volumeSlider.addEventListener('input', (e) => {
      // Check if admin mode is enabled (from global scope)
      if (typeof isAdminMode !== 'undefined' && !isAdminMode) {
        e.preventDefault();
        volumeSlider.value = getVolume();
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
        setVolume(volume);
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

  // No fade survives a teardown, and every output goes back to full gain -
  // otherwise a title started right after an interrupted fade stays silent.
  if (window.CrossfadeEngine) {
    window.CrossfadeEngine.abort();
  }

  // Stop both local decks. During a crossfade both of them carry a title, and
  // stopping only the current one would leave the outgoing one playing.
  audioDecks().forEach(deck => {
    if (!deck.paused) {
      deck.pause();
    }
    deck.currentTime = 0;
    // Only clear src if it's actually set to avoid unnecessary error events
    if (deck.src && !deck.src.endsWith('about:blank')) {
      deck.src = '';
    }
  });
  if (audioDeckA) {
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

  // Hier wird der Auto-DJ bewusst NICHT abgeschaltet. Diese Funktion raeumt vor
  // jedem Titelwechsel auf - playCurrentTrack() ruft sie als Erstes -, und ein
  // Titelwechsel ist genau das, was der Auto-DJ tut. Er haette sich damit beim
  // ersten Titel selbst beendet.
  //
  // Der vom Benutzer ausgeloeste Stopp ist stopPlayback(), und der schaltet ihn
  // ab. Dass der Unterschied lange folgenlos blieb, lag an einem zweiten Fehler:
  // window.isAutoDjActive war immer undefined, die Bedingung hier also nie wahr.


  // Update UI layout if queue is empty or no track is playing
  if (typeof window.updateUILayout !== 'undefined') {
    window.updateUILayout();
  }
}

// Play current track from queue
// Prevent race conditions
let isCurrentlyPlayingTrack = false; 
window.isCurrentlyPlayingTrack = false; // Global access for other modules

function playCurrentTrack(options) {
  // options.crossfade: the previous title is being faded out right now and has
  // to keep playing. Set by js/crossfade.js through skipTrack().
  const crossfade = !!(options && options.crossfade);

  debugLog('audio', `[PLAY] playCurrentTrack called. currentTrackIndex: ${window.currentTrackIndex}, queue length: ${window.queue ? window.queue.length : 0}, crossfade: ${crossfade}`);

  // Prevent race condition - if already in process of playing, return
  if (window.isCurrentlyPlayingTrack) {
    debugLog('audio', '[PLAY] Already in process of playing track, ignoring duplicate call');
    return;
  }

  // Additional protection: Check if we're currently loading/starting playback.
  // Not during a crossfade: there the current deck is the outgoing title and is
  // expected to be busy - the incoming one gets the other deck anyway.
  if (!crossfade && audioPlayer && (audioPlayer.readyState === 1 || audioPlayer.readyState === 2)) {
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
  
  // Stop all playback first to prevent conflicts. Not during a crossfade: the
  // outgoing title is still sounding and the fade engine releases its deck once
  // the fade is through. Tearing it down here would turn the transition back
  // into the hard cut it is meant to replace.
  if (crossfade) {
    debugLog('audio', '[PLAY] Crossfade running, the previous source stays alive');
  } else {
    stopAllPlayback();
  }

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
    // Silent before the play request goes out, otherwise the incoming title
    // bursts in at full volume for the moment before the fade takes hold.
    if (crossfade && window.CrossfadeEngine) {
      window.CrossfadeEngine.setGain('spotify', 0);
    }
    playSpotifyTrackFromObject(track);
  } else if (isLocalTrack) {
    playLocalTrack(track, { crossfade });
  } else {
    debugLog('AUDIO', 'Unknown track type:', track);
  }
  
  // Record track play for statistics
  recordTrackPlay(track);
  
  // Start progress updates
  startFooterProgressUpdates();

  // Und die gelegentliche 3D-Drehung des Covers. Sie hing bisher allein an
  // resumePlayback(), also am Fortsetzen eines schon geladenen Titels - jeder
  // normale Start laeuft aber hier durch, und damit lief der Timer nie an.
  if (typeof window.startOccasional3DRotations === 'function') {
    window.startOccasional3DRotations();
  }


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
function playLocalTrack(track, options) {
  const crossfade = !!(options && options.crossfade);
  debugLog('audio', '[LOCAL] Playing local track:', track.title);

  // During a crossfade the outgoing title still holds the current deck, so the
  // incoming one takes the other. Without a crossfade the current deck is free
  // and is simply reused.
  const deck = crossfade ? idleAudioDeck() : audioPlayer;

  if (!deck) {
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
  deck.src = streamUrl;
  if (window.CrossfadeEngine) {
    // Silent when it is faded in, at the current volume otherwise.
    window.CrossfadeEngine.setGain(deck, crossfade ? 0 : 1);
  } else {
    deck.volume = 0.7; // Default volume
  }

  // Has to happen before play(): the listeners on both decks check against this
  // to decide which one drives the progress display and the queue.
  audioPlayer = deck;

  // Play with error handling
  deck.play().then(() => {
    debugLog('audio', '[LOCAL] Track started successfully');
    if (typeof debugLog !== 'undefined') {
      debugLog('AUDIO', 'Local track playing:', track.title);
    }
  }).catch(error => {
    // AbortError is not a failure. play() returns a promise that the browser
    // rejects as soon as the request is superseded - by pause(), or by the next
    // assignment to src. Skipping a track does both, so the message appeared
    // exactly when playback had in fact just started for the following track.
    // Everything else still surfaces.
    const superseded = error && error.name === 'AbortError';
    if (superseded) {
      debugLog('audio', '[LOCAL] play() superseded before it started, ignoring');
    } else {
      debugLog('AUDIO', 'Playback failed:', error);
      if (typeof toast !== 'undefined') {
        toast.error(`Playback failed: ${error.message}`);
      }
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
//
// The slider sets the master volume, never an element volume. What lands on a
// deck is master times fade gain, so a fade running at that moment keeps its
// shape and simply plays out at the new level.
function setVolume(volume) {
  if (window.CrossfadeEngine) {
    window.CrossfadeEngine.setMasterVolume(volume);
  } else if (audioPlayer) {
    audioPlayer.volume = Math.max(0, Math.min(1, volume));
  }
  if (typeof debugLog !== 'undefined') {
    debugLog('AUDIO', 'Volume set to:', getVolume());
  }
}

function getVolume() {
  if (window.CrossfadeEngine) {
    return window.CrossfadeEngine.getMasterVolume();
  }
  return audioPlayer ? audioPlayer.volume : 0.7;
}

// Audio playback control
function pauseCurrentTrack() {
  if (window.CrossfadeEngine) {
    window.CrossfadeEngine.abort();
  }

  audioDecks().forEach(deck => {
    if (!deck.paused) {
      deck.pause();
      debugLog('audio', '[AUDIO] Local track paused');
    }
  });

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

// Returns the artist a Spotify title should be filed under: the first one.
//
// Spotify lists every feature in artists[], and joining them made the library
// treat "Anuradha Paudwal, Kumar Sanu" and "Anuradha Paudwal, Udit Narayan" as
// two different artists, each with one track. Splitting an already joined string
// at the comma is not an option - it would tear "Earth, Wind & Fire" apart - so
// a string is taken as it stands and only the structured form is reduced.
function primarySpotifyArtist(track) {
  if (Array.isArray(track.artists) && track.artists.length > 0) {
    const first = track.artists[0];
    return (typeof first === 'string' ? first : first?.name) || 'Unknown Artist';
  }
  if (typeof track.artists === 'string' && track.artists) {
    return track.artists;
  }
  return track.artist || 'Unknown Artist';
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
      artist: primarySpotifyArtist(track),
      album: track.album?.name || track.album || '',
      duration_ms: track.duration_ms || track.duration || 0,
      external_url: track.external_urls?.spotify || null,
      image_url: track.album?.images?.[0]?.url || track.image || null,
      popularity: track.popularity || 0,
      // Spotify keeps genres on the artist, so the server needs this id to
      // look one up. It falls back to the artist name when it is missing.
      artist_id: track.artists?.[0]?.id || track.artist_id || null
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
  
  // A fade must not keep writing volumes into a player that is about to stop.
  if (window.CrossfadeEngine) {
    window.CrossfadeEngine.abort();
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
  }

  // Always both decks, and regardless of the type of the current track: a pause
  // pressed during a crossfade from local to Spotify leaves a local deck
  // running that the branch above never looks at.
  audioDecks().forEach(deck => {
    if (!deck.paused) {
      deck.pause();
      debugLog('audio', '[PAUSE] Local track paused');
    }
  });

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
  
  // Kill any running fade first, so nothing keeps turning a volume back up
  // behind the stop.
  if (window.CrossfadeEngine) {
    window.CrossfadeEngine.abort();
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
  }

  // Always both decks, whatever the current track is: a stop pressed during a
  // crossfade from local to Spotify has a local deck to silence as well.
  audioDecks().forEach(deck => {
    deck.pause();
    deck.currentTime = 0;
  });
  debugLog('audio', '[STOP] Local track stopped');

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
  // js/crossfade.js needs to know which deck holds the outgoing title before
  // the queue advances, and which one holds the incoming one afterwards.
  window.getActiveAudioDeck = () => audioPlayer;
  window.getAudioDecks = () => audioDecks();
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
  window.primarySpotifyArtist = primarySpotifyArtist;
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
