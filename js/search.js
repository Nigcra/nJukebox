/**
 * Search Module for nJukebox
 * Handles enhanced search functionality with local and Spotify integration
 * Uses event delegation for robust click handling
 */

(function() {
  'use strict';
  
  // Module dependencies (will be injected)
  let deps = {};
  
  /**
   * Initialize search module with dependencies
   */
  function init(dependencies) {
    deps = dependencies || {};
    
    debugLog('SEARCH', '🔍 Search module initializing...');
    
    // Setup search UI handlers
    setupSearchHandlers();
    
    // Setup event delegation for search results
    setupSearchResultsDelegation();
    
    debugLog('SEARCH', '✅ Search module initialized');
  }
  
  /**
   * Setup search button and input handlers
   */
  function setupSearchHandlers() {
    const globalSearchNavButton = document.getElementById('globalSearchNavButton');
    const globalSearchButton = document.getElementById('globalSearchButton');
    const searchInput = document.getElementById('searchInput');
    
    if (globalSearchNavButton) {
      globalSearchNavButton.addEventListener('click', () => {
        deps.currentFilter = 'search';
        document.querySelectorAll('.nav-tile').forEach(tile => tile.classList.remove('active'));
        globalSearchNavButton.classList.add('active');
        renderEnhancedSearch(searchInput ? searchInput.value : '');
        if (deps.saveAppState) deps.saveAppState();
      });
    }
    
    if (globalSearchButton) {
      globalSearchButton.addEventListener('click', () => {
        deps.currentFilter = 'search';
        document.querySelectorAll('.nav-tile').forEach(tile => tile.classList.remove('active'));
        if (globalSearchNavButton) {
          globalSearchNavButton.classList.add('active');
        }
        renderEnhancedSearch(searchInput ? searchInput.value : '');
        if (deps.saveAppState) deps.saveAppState();
      });
    }
    
    if (searchInput) {
      searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          deps.currentFilter = 'search';
          document.querySelectorAll('.nav-tile').forEach(tile => tile.classList.remove('active'));
          if (globalSearchNavButton) {
            globalSearchNavButton.classList.add('active');
          }
          renderEnhancedSearch(searchInput.value);
          if (deps.saveAppState) deps.saveAppState();
        }
      });
    }
  }
  
  /**
   * Setup event delegation for search results
   * This approach is more robust than inline handlers
   */
  function setupSearchResultsDelegation() {
    const libraryList = document.getElementById('libraryList');
    
    if (!libraryList) return;
    
    // Delegate all clicks to parent container
    libraryList.addEventListener('click', (e) => {
      // Find the closest track item
      const spotifyTrack = e.target.closest('.spotify-track-item');
      const localTrack = e.target.closest('.track-item[data-source="local"]');
      
      if (spotifyTrack) {
        handleSpotifyTrackClick(spotifyTrack);
      } else if (localTrack) {
        handleLocalTrackClick(localTrack);
      }
    });
    
    debugLog('SEARCH', '✅ Event delegation setup complete');
  }
  
  /**
   * Handle click on Spotify track
   */
  function handleSpotifyTrackClick(trackElement) {
    const trackData = {
      id: trackElement.dataset.spotifyId,
      uri: trackElement.dataset.uri,
      name: trackElement.querySelector('.track-title')?.textContent || '',
      artist: trackElement.dataset.artist || '',
      album: trackElement.dataset.album || '',
      image: trackElement.querySelector('.track-cover-small')?.src || '',
      duration_ms: parseInt(trackElement.dataset.duration) || 0
    };
    
    debugLog('SEARCH', '🎵 Spotify track clicked:', trackData.name);
    
    if (deps.addSpotifyTrackToQueue) {
      deps.addSpotifyTrackToQueue(trackData);
    } else {
      console.warn('addSpotifyTrackToQueue not available');
    }
  }
  
  /**
   * Handle click on local track
   */
  function handleLocalTrackClick(trackElement) {
    const trackIndex = parseInt(trackElement.dataset.index);
    
    debugLog('SEARCH', '🎵 Local track clicked, index:', trackIndex);
    
    if (!isNaN(trackIndex) && deps.playTrack) {
      deps.playTrack(trackIndex);
    } else {
      console.warn('playTrack not available or invalid index');
    }
  }
  
  /**
   * Perform enhanced search (local + Spotify)
   */
  async function performEnhancedSearch(query) {
    if (!query.trim()) {
      if (deps.renderLibrary) {
        deps.renderLibrary();
      }
      return;
    }
    
    debugLog('SEARCH', '🔍 Performing enhanced search:', query);
    
    // Search local tracks
    const localTracks = await searchLocalTracks(query);
    
    // Search Spotify if connected
    let spotifyTracks = [];
    if (deps.spotifyAccessToken && deps.searchSpotifyDirect) {
      try {
        spotifyTracks = await deps.searchSpotifyDirect(query);
      } catch (error) {
        console.warn('Spotify search failed:', error);
      }
    }
    
    // Render combined results
    renderEnhancedSearchResults(localTracks, spotifyTracks, query);
  }
  
  /**
   * Search local tracks via API
   */
  async function searchLocalTracks(query) {
    try {
      if (!deps.dataServerAPI) {
        console.error('dataServerAPI not available');
        return [];
      }
      
      const response = await deps.dataServerAPI.getTracks({ search: query, limit: 50 });
      return response.tracks || [];
    } catch (error) {
      console.error('Local search failed:', error);
      return [];
    }
  }
  
  /**
   * Render enhanced search results
   */
  function renderEnhancedSearchResults(localTracks, spotifyTracks, query) {
    const libraryList = document.getElementById('libraryList');
    const libraryGrid = document.getElementById('libraryGrid');
    
    if (!libraryList) return;
    
    // Clear existing content
    libraryList.innerHTML = '';
    if (libraryGrid) {
      libraryGrid.innerHTML = '';
      libraryGrid.classList.add('hidden');
    }
    
    // Show list view for search results
    libraryList.classList.remove('hidden');
    
    const totalResults = localTracks.length + spotifyTracks.length;
    
    if (totalResults === 0) {
      libraryList.innerHTML = `
        <li class="search-no-results">
          <div class="search-message">
            <h3>🔍 Keine Ergebnisse für "${escapeHtml(query)}"</h3>
            <p>Versuchen Sie andere Suchbegriffe oder prüfen Sie die Spotify-Verbindung.</p>
          </div>
        </li>
      `;
      return;
    }
    
    // Add search header
    libraryList.innerHTML = `
      <li class="search-header">
        <div class="search-info">
          <h3>🔍 Suchergebnisse für "${escapeHtml(query)}"</h3>
          <span class="search-count">${totalResults} Ergebnisse</span>
        </div>
      </li>
    `;
    
    // Add Spotify results first
    spotifyTracks.forEach(track => {
      const li = createSpotifyTrackListItem(track);
      libraryList.appendChild(li);
    });
    
    // Add local results second
    localTracks.forEach((track, index) => {
      const li = createLocalTrackListItem(track, index);
      libraryList.appendChild(li);
    });
  }
  
  /**
   * Create Spotify track list item
   * NO inline handlers - uses event delegation
   */
  function createSpotifyTrackListItem(track) {
    const li = document.createElement('li');
    li.className = 'spotify-track-item';
    
    // Store data in attributes for event delegation
    li.dataset.spotifyId = track.id || '';
    li.dataset.uri = track.uri || '';
    li.dataset.artist = track.artist || '';
    li.dataset.album = track.album || '';
    li.dataset.duration = track.duration_ms || '';
    
    const duration = track.duration_ms ? formatTime(track.duration_ms / 1000) : '';
    const coverUrl = track.image || 'assets/default_cover.png';
    
    li.innerHTML = `
      <img class="track-cover-small" src="${coverUrl}" alt="Cover" 
           onerror="this.src='assets/default_cover.png'" 
           style="width: 50px; height: 50px; border-radius: 6px; object-fit: cover; margin-right: 0.75rem; flex-shrink: 0; background: #2a2a2a;">
      <div class="track-info">
        <div class="track-title">${escapeHtml(track.name)}</div>
        <div class="track-details">${escapeHtml(track.artist)} • ${escapeHtml(track.album)} ${duration ? '• ' + duration : ''}</div>
      </div>
      <div class="spotify-badge" 
           style="margin-left: auto; color: #1DB954; padding: 4px 8px; border-radius: 4px; font-size: 0.8em; font-weight: bold;" 
           title="Remote/Spotify Track">🌐</div>
    `;
    
    return li;
  }
  
  /**
   * Create local track list item
   * NO inline handlers - uses event delegation
   */
  function createLocalTrackListItem(track, index) {
    const li = document.createElement('li');
    li.className = 'track-item';
    li.dataset.source = 'local';
    li.dataset.index = index;
    
    const duration = track.duration ? formatTime(track.duration) : '';
    
    li.innerHTML = `
      <img class="track-cover-small" src="${track.cover || 'assets/default_cover.png'}" 
           alt="Cover" onerror="this.src='assets/default_cover.png'"
           style="width: 50px; height: 50px; border-radius: 6px; object-fit: cover; margin-right: 0.75rem; flex-shrink: 0; background: #2a2a2a;">
      <div class="track-info">
        <div class="track-title">${escapeHtml(track.title)}</div>
        <div class="track-details">${escapeHtml(track.artist)} • ${escapeHtml(track.album)} ${duration ? '• ' + duration : ''}</div>
      </div>
    `;
    
    return li;
  }
  
  /**
   * Render enhanced search view
   */
  function renderEnhancedSearch(query = '') {
    performEnhancedSearch(query);
  }
  
  /**
   * Helper: Format time
   */
  function formatTime(seconds) {
    if (!seconds || isNaN(seconds)) return '';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }
  
  /**
   * Helper: Escape HTML
   */
  function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
  
  /**
   * Helper: Debug log
   */
  function debugLog(category, ...args) {
    if (typeof window.debugLog === 'function') {
      window.debugLog(category, ...args);
    }
  }
  
  // Export module interface
  window.SearchModule = {
    init,
    performEnhancedSearch,
    renderEnhancedSearch,
    renderEnhancedSearchResults
  };
  
  debugLog('SEARCH', '📦 Search module loaded');
  
})();
