// ===== PLAYLIST MODULE =====
// Extracted from web_renderer.js - handles playlist management and queue operations

// ===== QUEUE DISPLAY FUNCTIONS =====
let updateQueueTimeout = null;

function debouncedUpdateQueueDisplay() {
  if (updateQueueTimeout) {
    clearTimeout(updateQueueTimeout);
  }
  updateQueueTimeout = setTimeout(() => {
    updateQueueDisplay();
    updateQueueTimeout = null;
  }, 50); // 50ms debounce
}

function updateQueueDisplay() {
  // Stop any existing mini visualizer
  stopPlaylistMiniVisualizer();
  
  queueListEl.innerHTML = '';
  queueListEl.className = 'playlist-items';
  
  const showMoreBtn = document.getElementById('showMoreTracks');
  
  // Ensure currentTrackIndex is valid
  if (currentTrackIndex >= queue.length) {
    debugLog('[DEBUG] currentTrackIndex beyond queue length:', currentTrackIndex, 'Queue length:', queue.length);
    currentTrackIndex = -1; // Reset to no track playing
  }
  
  // Handle case when no track is playing but queue has tracks
  if (currentTrackIndex < 0 && queue.length > 0) {
    debugLog('[DEBUG] No track playing but queue has tracks - showing full queue');
    const tracksToShow = showAllTracks ? queue.length : Math.min(queue.length, MAX_VISIBLE_TRACKS);
    
    for (let i = 0; i < tracksToShow; i++) {
      const track = queue[i];
      const trackEl = createPlaylistItem(track, false); // false = not currently playing
      if (trackEl) {
        queueListEl.appendChild(trackEl);
      } else {
        debugLog('PLAYLISTS', 'createPlaylistItem returned null for track:', track);
      }
    }
    
    // Show "Show More" button if needed
    if (showMoreBtn) {
      showMoreBtn.style.display = queue.length > MAX_VISIBLE_TRACKS && !showAllTracks ? 'block' : 'none';
    }
    return;
  }
  
  // Original logic for when a track is playing
  if (currentTrackIndex < 0 || currentTrackIndex >= queue.length) {
    debugLog('[DEBUG] Invalid currentTrackIndex and empty queue:', currentTrackIndex, 'Queue length:', queue.length);
    if (showMoreBtn) showMoreBtn.style.display = 'none';
    return;
  }
  
  // Filter out played tracks (tracks before current track) - only show from current onwards
  const upcomingTracks = queue.slice(currentTrackIndex);
  const tracksToShow = showAllTracks ? upcomingTracks.length : Math.min(upcomingTracks.length, MAX_VISIBLE_TRACKS);
  
  debugLog('[DEBUG] Playlist display - currentTrackIndex:', currentTrackIndex, 'upcomingTracks:', upcomingTracks.length, 'showing:', tracksToShow);
  
  // Create playlist items for upcoming tracks only
  for (let idx = 0; idx < tracksToShow; idx++) {
    const item = upcomingTracks[idx];
    if (item) { // Safety check
      const trackElement = createPlaylistItem(item, idx === 0); // First item is current track
      if (trackElement) {
        queueListEl.appendChild(trackElement);
      }
    }
  }
  
  // Show/hide "more" button
  if (upcomingTracks.length > MAX_VISIBLE_TRACKS) {
    showMoreBtn.style.display = 'flex';
    showMoreBtn.querySelector('.more-text').textContent = showAllTracks ? 
      'Weniger anzeigen' : `${upcomingTracks.length - MAX_VISIBLE_TRACKS} weitere Tracks anzeigen`;
    showMoreBtn.classList.toggle('expanded', showAllTracks);
  } else {
    showMoreBtn.style.display = 'none';
  }
  
  // Aktualisiere auch die Library-Anzeige, damit Queue-Status korrekt angezeigt wird
  // Aber nur wenn wir nicht in der Playlists-Sektion sind
  const playlistsSection = document.getElementById('playlists-section');
  if (!playlistsSection || playlistsSection.style.display !== 'block') {
    renderLibrary();
  }
}

function createPlaylistItem(item, isCurrent) {
  const li = document.createElement('li');
  li.className = 'playlist-item';
  
  // Create cover image
  const img = document.createElement('img');
  
  // Smart cover logic for different track types
  let coverUrl = 'assets/default_cover.png';
  if (item.type === 'spotify' || item.source === 'spotify') {
    // For Spotify tracks, prioritize spotifyAlbumImage or image_url
    if (item.spotifyAlbumImage) {
      coverUrl = item.spotifyAlbumImage;
    } else if (item.image_url || item.image) {
      coverUrl = item.image_url || item.image;
    }
  } else {
    // For local tracks - check all possible cover properties
    if (item.image) {
      // From our new queue items
      coverUrl = item.image;
    } else if (item.albumArt) {
      coverUrl = item.albumArt;
    } else if (item.albumImagePath) {
      coverUrl = item.albumImagePath;
    } else if (item.coverPath) {
      coverUrl = item.coverPath;
    } else if (item.cover_path && item.id) {
      // Direct server cover path
      coverUrl = musicAPI.getCoverURL(item.id);
    }
  }
  
  img.src = coverUrl;
  img.className = 'playlist-cover';
  img.alt = 'Album Cover';
  img.onerror = () => img.src = 'assets/default_cover.png';
  
  li.appendChild(img);
  
  // Text container
  const textDiv = document.createElement('div');
  textDiv.className = 'playlist-text';
  
  // Title
  const titleDiv = document.createElement('div');
  titleDiv.className = 'track-title';
  titleDiv.textContent = item.title || item.name || 'Unknown Title';
  textDiv.appendChild(titleDiv);
  
  // Artist info
  const artistDiv = document.createElement('div');
  artistDiv.className = 'track-artist';
  artistDiv.textContent = item.artist || 'Unknown Artist';
  textDiv.appendChild(artistDiv);
  
  li.appendChild(textDiv);
  
  // Add current track indicator
  if (isCurrent) {
    li.classList.add('current-track');
    
    // Add mini visualizer
    const miniVisualizer = document.createElement('div');
    miniVisualizer.className = 'mini-visualizer';
    miniVisualizer.innerHTML = '<div class="bar"></div><div class="bar"></div><div class="bar"></div>';
    li.appendChild(miniVisualizer);
    
    // Start the visualizer
    startPlaylistMiniVisualizer(miniVisualizer);
  }
  
  // Add remove button (only in admin mode)
  if (isAdminMode && window.removeFromQueue) {
    const removeBtn = document.createElement('button');
    removeBtn.className = 'playlist-remove-btn';
    removeBtn.innerHTML = '✕';
    removeBtn.title = 'Track entfernen';
    removeBtn.onclick = (e) => {
      e.stopPropagation();
      // Pass the actual track object, not the index!
      removeFromQueue(item);
    };
    li.appendChild(removeBtn);
  }

  return li; // Return the element instead of appending it here
}

// ===== PLAYLIST TOGGLE FUNCTIONS =====
function initPlaylistToggle() {
  const showMoreBtn = document.getElementById('showMoreTracks');
  if (showMoreBtn) {
    showMoreBtn.addEventListener('click', () => {
      showAllTracks = !showAllTracks;
      debouncedUpdateQueueDisplay();
    });
  }
}

// ===== MINI VISUALIZER FUNCTIONS =====
let playlistMiniVisualizerInterval = null;

function startPlaylistMiniVisualizer(container) {
  if (playlistMiniVisualizerInterval) {
    clearInterval(playlistMiniVisualizerInterval);
  }
  
  const bars = container.querySelectorAll('.bar');
  
  playlistMiniVisualizerInterval = setInterval(() => {
    bars.forEach((bar, index) => {
      // Create subtle, random heights for bars
      const baseHeight = 3; // Minimum height in px (increased from 2)
      const maxHeight = 8; // Maximum height in px (increased from 5)
      const randomHeight = baseHeight + Math.random() * (maxHeight - baseHeight);
      
      // Add some wave-like motion
      const wave = Math.sin((Date.now() / 200) + (index * 0.5)) * 0.5 + 0.5;
      const finalHeight = randomHeight + (wave * 1.5); // Increased from 1
      
      bar.style.height = `${finalHeight}px`;
    });
  }, 150); // Update every 150ms for smooth but not too fast animation
}

function stopPlaylistMiniVisualizer() {
  if (playlistMiniVisualizerInterval) {
    clearInterval(playlistMiniVisualizerInterval);
    playlistMiniVisualizerInterval = null;
  }
}

// ===== QUEUE MANAGEMENT FUNCTIONS =====
// Note: isAddingToQueue variable is declared in web_renderer.js

// Special Auto-DJ version of addToQueue that bypasses restrictions
function addToQueueForAutoDj(track) {
  debugLog('AUTO-DJ', `Adding track to queue (unrestricted):`, track);
  
  // Only check for exact duplicates in current queue (no time restrictions)
  let trackKey;
  if (track.type === 'spotify') {
    trackKey = track.uri;
  } else {
    trackKey = track.path || track.id || track.streamUrl || `${track.artist}_${track.title}_${track.album}`;
  }
  
  // Simple duplicate check only for current queue
  const isAlreadyInQueue = queue.some(queueTrack => {
    let queueKey;
    if (queueTrack.type === 'spotify') {
      queueKey = queueTrack.uri;
    } else {
      queueKey = queueTrack.path || queueTrack.id || queueTrack.streamUrl || `${queueTrack.artist}_${queueTrack.title}_${queueTrack.album}`;
    }
    return queueKey === trackKey;
  });
  
  if (isAlreadyInQueue) {
    debugLog('playlist', `[AUTO-DJ] Track already in current queue, skipping:`, track.title);
    return false;
  }
  
  queue.push(track); 
  debugLog('playlist', `[AUTO-DJ] Track added to queue: ${track.title} by ${track.artist} - Queue length now: ${queue.length}`);
  debouncedUpdateQueueDisplay(); 
  saveAppState();
  
  debugLog('playlist', `[AUTO-DJ] Queue after update:`, queue.map(t => `${t.title} by ${t.artist}`));
  return true;
}

function clearPlaylist() {
  debugLog('playlist', '[CLEAR-PLAYLIST] Clearing entire playlist');
  
  // Stop current playback
  stopAllPlayback();
  
  // Clear the queue
  queue.length = 0;
  currentTrackIndex = -1;
  
  // Save the cleared state
  saveAppState();
  
  // Update UI
  debouncedUpdateQueueDisplay();
  
  // Clear footer info
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
  
  // Reset cover images
  if (coverImageEl) coverImageEl.src = 'assets/default_cover.png';
  
  // Reset playback state
  isPlaying = false;
  
  // Reset layout to search mode (crucial for navigation to work again)
  if (typeof updateUILayout !== 'undefined') {
    updateUILayout();
  }
  
  // Ensure navigation is responsive by collapsing now-playing section
  if (typeof collapseNowPlayingSection !== 'undefined') {
    collapseNowPlayingSection();
  }
  
  debugLog('playlist', '[CLEAR-PLAYLIST] Playlist cleared successfully');
}

// ===== AUTO-DJ AND PLAYLISTS INITIALIZATION =====
function initializeAutoDjAndPlaylists() {
  debugLog('playlist', '[AUTO-DJ] Initializing Auto-DJ and Playlists...');
  
  // Setup navigation click handler for playlists
  // NOTE: Playlists navigation is handled by the main handleNavClick function
  // No additional event listener needed here
  
  // Setup Auto-DJ toggle
  const autoDjToggle = document.getElementById('autoDjToggle');
  if (autoDjToggle) {
    autoDjToggle.addEventListener('change', (e) => {
      toggleAutoDj(e.target.checked);
    });
  }
  
  // Setup playlist search and filter
  const playlistSearch = document.getElementById('playlistSearch');
  const playlistFilter = document.getElementById('playlistFilter');
  const refreshPlaylists = document.getElementById('refreshPlaylists');
  
  if (playlistSearch) {
    playlistSearch.addEventListener('input', () => updatePlaylistsGrid());
  }
  
  if (playlistFilter) {
    playlistFilter.addEventListener('change', () => updatePlaylistsGrid());
  }
  
  if (refreshPlaylists) {
    refreshPlaylists.addEventListener('click', () => {
      loadPlaylistsSection();
    });
  }
  
  // Load initial playlists
  loadPlaylistsSection();
  
  // Load custom playlists for Auto-DJ
  loadCustomPlaylists();
}

// ===== PLAYLIST GRID FUNCTIONS =====
function updatePlaylistsGrid() {
  const grid = document.getElementById('playlistsGrid');
  const search = document.getElementById('playlistSearch')?.value.toLowerCase() || '';
  const filter = document.getElementById('playlistFilter')?.value || 'all';
  
  if (!grid) return;
  
  let filteredPlaylists = autoLearnedPlaylists;
  
  // Apply category filter
  if (filter !== 'all') {
    filteredPlaylists = filteredPlaylists.filter(p => p.category === filter);
  }
  
  // Apply search filter
  if (search) {
    filteredPlaylists = filteredPlaylists.filter(p => 
      p.name.toLowerCase().includes(search)
    );
  }
  
  if (filteredPlaylists.length === 0) {
    grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 20px; color: #666;">Keine Playlists gefunden</div>';
    return;
  }
  
  grid.innerHTML = filteredPlaylists.map(playlist => `
    <div class="playlist-tile" data-playlist-id="${playlist.id}">
      <div class="playlist-info">
        <h3>${playlist.name}</h3>
        <p>${playlist.trackCount || playlist.tracks?.length || 0} Tracks</p>
        <span class="playlist-category">${playlist.category || 'general'}</span>
      </div>
      <div class="playlist-actions">
        <button class="play-playlist-btn" onclick="playPlaylist('${playlist.id}')">
          ▶ Abspielen
        </button>
      </div>
    </div>
  `).join('');
}

async function loadPlaylistsSection() {
  debugLog('playlist', '[PLAYLISTS] Loading playlists section...');
  
  // Show auto-learned playlists only
  renderPlaylistsGrid(autoLearnedPlaylists);
}

function renderPlaylistsGrid(playlists) {
  const grid = document.getElementById('playlistsGrid');
  if (!grid) return;
  
  if (playlists.length === 0) {
    grid.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; color: #666; padding: 40px;">
        <div style="font-size: 3em; margin-bottom: 16px;">🎵</div>
        <h3 style="margin: 0 0 8px 0;">Keine Playlists geladen</h3>
        <p style="margin: 0; font-size: 0.9em;">Verwende das Auto-Learning im Admin-Bereich um Playlists zu laden.</p>
      </div>
    `;
    return;
  }
  
  grid.innerHTML = playlists.map(playlist => `
    <div class="playlist-card" style="
      background: #2a2a2a; 
      border-radius: 8px; 
      padding: 16px; 
      border: 1px solid #333;
      cursor: pointer;
      transition: all 0.2s ease;
    " data-playlist-id="${playlist.id || playlist.name}">
      <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 12px;">
        <div style="font-size: 2em;">
          ${playlist.category === 'germany' ? '🇩🇪' : 
            playlist.category === 'party' ? '🎉' : 
            playlist.category === 'custom' ? '🔗' : '🎵'}
        </div>
        <div style="flex: 1;">
          <h4 style="margin: 0; color: #1DB954; font-size: 1em;">${playlist.name}</h4>
          <div style="color: #666; font-size: 0.8em; margin-top: 4px;">
            ${playlist.trackCount || playlist.tracks?.length || 0} Tracks
            ${playlist.category ? ` • ${playlist.category.toUpperCase()}` : ''}
          </div>
        </div>
      </div>
      
      <div style="display: flex; gap: 8px; margin-top: 12px;">
        <button onclick="loadPlaylistToQueue('${playlist.id || playlist.name}')" 
                style="flex: 1; background: rgba(29, 185, 84, 0.1); border: 1px solid #1DB954; color: #1DB954; padding: 8px 12px; border-radius: 4px; cursor: pointer; font-size: 0.9em;">
          ▶ Abspielen
        </button>
        <button onclick="addPlaylistToQueue('${playlist.id || playlist.name}')" 
                style="background: rgba(52, 152, 219, 0.1); border: 1px solid #3498db; color: #3498db; padding: 8px 12px; border-radius: 4px; cursor: pointer; font-size: 0.9em;">
          + Anhängen
        </button>
      </div>
    </div>
  `).join('');
  
  // Add hover effects
  grid.querySelectorAll('.playlist-card').forEach(card => {
    card.addEventListener('mouseenter', () => {
      card.style.borderColor = '#1DB954';
      card.style.transform = 'translateY(-2px)';
    });
    card.addEventListener('mouseleave', () => {
      card.style.borderColor = '#333';
      card.style.transform = 'translateY(0)';
    });
  });
}

function filterPlaylists() {
  const searchTerm = document.getElementById('playlistSearch')?.value.toLowerCase() || '';
  const categoryFilter = document.getElementById('playlistFilter')?.value || 'all';
  
  const cards = document.querySelectorAll('.playlist-card');
  cards.forEach(card => {
    const playlistName = card.querySelector('h4')?.textContent.toLowerCase() || '';
    const playlistCategory = card.dataset.playlistCategory || '';
    
    const matchesSearch = !searchTerm || playlistName.includes(searchTerm);
    const matchesCategory = categoryFilter === 'all' || playlistCategory === categoryFilter;
    
    card.style.display = (matchesSearch && matchesCategory) ? 'block' : 'none';
  });
}

// ===== PLAYLIST MANAGEMENT FUNCTIONS =====
window.loadPlaylistToQueue = function(playlistId) {
  debugLog('playlist', '[PLAYLISTS] Loading playlist to queue:', playlistId);
  
  const playlist = findPlaylistById(playlistId);
  if (playlist && playlist.tracks) {
    debugLog('playlist', '[PLAYLISTS] Playlist has tracks:', playlist.tracks.length);
    
    // Clear current queue
    queue.length = 0;
    currentTrackIndex = -1;
    
    // Add tracks using proper addToQueue function to ensure correct formatting
    playlist.tracks.forEach(track => {
      // Ensure Spotify tracks have proper structure
      if (track.spotifyUri || track.uri) {
        const queueTrack = {
          title: track.title || track.name,
          artist: track.artist,
          album: track.album,
          spotifyUri: track.spotifyUri || track.uri,
          spotifyId: track.spotifyId || track.id,
          source: 'spotify',
          type: 'spotify',
          uri: track.spotifyUri || track.uri,
          image: track.image || track.spotifyAlbumImage,
          spotifyAlbumImage: track.image || track.spotifyAlbumImage
        };
        queue.push(queueTrack);
      } else {
        queue.push(track);
      }
    });
    
    debouncedUpdateQueueDisplay();
    saveAppState();
    
    // Start playing first track
    if (queue.length > 0) {
      currentTrackIndex = 0;
      playCurrentTrack();
    }
    
    showNotification(`📋 Playlist "${playlist.name}" geladen (${playlist.tracks.length} Tracks)`);
  } else {
    debugLog('PLAYLISTS', 'Playlist not found or has no tracks:', playlistId);
    showNotification(`❌ Playlist "${playlistId}" konnte nicht gefunden werden`);
  }
};

window.addPlaylistToQueue = function(playlistId) {
  debugLog('playlist', '[PLAYLISTS] Adding playlist to queue:', playlistId);
  
  const playlist = findPlaylistById(playlistId);
  if (playlist && playlist.tracks) {
    playlist.tracks.forEach(track => addToQueue(track));
    debouncedUpdateQueueDisplay();
    
    showNotification(`➕ ${playlist.tracks.length} Tracks aus "${playlist.name}" hinzugefügt`);
  }
};

// ===== GLOBAL EXPORTS =====
// Make functions available globally for compatibility
window.debouncedUpdateQueueDisplay = debouncedUpdateQueueDisplay;
window.updateQueueDisplay = updateQueueDisplay;
window.createPlaylistItem = createPlaylistItem;
window.initPlaylistToggle = initPlaylistToggle;
window.startPlaylistMiniVisualizer = startPlaylistMiniVisualizer;
window.stopPlaylistMiniVisualizer = stopPlaylistMiniVisualizer;
window.addToQueueForAutoDj = addToQueueForAutoDj;
window.clearPlaylist = clearPlaylist;
window.initializeAutoDjAndPlaylists = initializeAutoDjAndPlaylists;
window.updatePlaylistsGrid = updatePlaylistsGrid;
window.loadPlaylistsSection = loadPlaylistsSection;
window.renderPlaylistsGrid = renderPlaylistsGrid;
window.filterPlaylists = filterPlaylists;

debugLog('playlist', '[PLAYLISTS] Playlist module loaded successfully');
