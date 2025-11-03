// Cover Management Module
// Handles all cover image loading and caching operations

// DOM element references
let coverImageEl = null;
let nowPlayingCoverEl = null;

// Initialize DOM references when DOM is ready
function initializeCoverElements() {
  coverImageEl = document.getElementById('coverImage');
  nowPlayingCoverEl = document.getElementById('nowPlayingCover');
}

// Wait for DOM to be ready before initializing elements
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeCoverElements);
} else {
  initializeCoverElements();
}

// Optimized cover loading with caching
function loadCoverOptimized(imgElement, type, id, artist = null, album = null, fallbackUrl = 'assets/default_cover.png') {
  try {
    // Cover-URL generieren
    const coverUrl = coverCache.getCover(type, id, artist, album);
    
    // Check if image already has the correct URL
    if (imgElement.src === coverUrl) {
      return coverUrl; // Already set correctly
    }
    
    // Set URL - browser loads from cache if available
    imgElement.src = coverUrl;
    
    // Fallback for loading errors
    imgElement.onerror = () => {
      if (imgElement.src !== fallbackUrl) {
        imgElement.src = fallbackUrl;
      }
    };
    
    return coverUrl;
  } catch (error) {
    debugLog('COVER', `Cover loading failed for ${type}:${id}, using fallback`);
    imgElement.src = fallbackUrl;
    imgElement.style.opacity = '1';
    return fallbackUrl;
  }
}

// Batch cover loading for better performance
function loadCoversInBatch(coverRequests) {
  // Set all covers immediately - browser handles caching automatically
  coverRequests.forEach((request) => {
    try {
      const { imgElement, type, id, artist, album, fallbackUrl } = request;
      loadCoverOptimized(imgElement, type, id, artist, album, fallbackUrl);
    } catch (error) {
      debugLog('COVER', `Batch cover loading failed for ${request.type}:${request.id}`);
      if (request.imgElement) {
        request.imgElement.src = request.fallbackUrl || 'assets/default_cover.png';
      }
    }
  });
}

// Update now-playing cover for both main and mini player
function updateNowPlayingCover(track) {
  if (!track) {
    if (coverImageEl) coverImageEl.src = 'assets/default_cover.png';
    if (nowPlayingCoverEl) nowPlayingCoverEl.src = 'assets/default_cover.png';
    return 'assets/default_cover.png';
  }

  try {
    let coverUrl = 'assets/default_cover.png';
    
    if (track.type === 'server' && track.id && window.musicAPI) {
      // Use musicAPI directly for local tracks
      coverUrl = window.musicAPI.getCoverURL(track.id);
    } else if (track.type === 'spotify') {
      // For Spotify tracks, try multiple cover sources
      if (track.image) {
        coverUrl = track.image;
      } else if (track.album && track.album.images && track.album.images.length > 0) {
        coverUrl = track.album.images[0].url;
      } else if (track.spotifyAlbumImage) {
        coverUrl = track.spotifyAlbumImage;
      }
    } else if (track.image) {
      coverUrl = track.image;
    } else if (track.id && window.musicAPI) {
      // Fallback for any track with ID
      coverUrl = window.musicAPI.getCoverURL(track.id);
    }
    
    // Update both cover elements with fallback handling
    if (coverImageEl) {
      coverImageEl.src = coverUrl;
      coverImageEl.onerror = () => {
        if (coverImageEl.src !== 'assets/default_cover.png') {
          coverImageEl.src = 'assets/default_cover.png';
        }
      };
    }
    if (nowPlayingCoverEl) {
      nowPlayingCoverEl.src = coverUrl;
      nowPlayingCoverEl.onerror = () => {
        if (nowPlayingCoverEl.src !== 'assets/default_cover.png') {
          nowPlayingCoverEl.src = 'assets/default_cover.png';
        }
      };
    }
    
    debugLog('COVER', `Now-Playing Cover aktualisiert: ${coverUrl}`);
    return coverUrl;
  } catch (error) {
    debugLog('COVER', 'Now-Playing Cover Ladevorgang fehlgeschlagen, verwende Default');
    if (coverImageEl) coverImageEl.src = 'assets/default_cover.png';
    if (nowPlayingCoverEl) nowPlayingCoverEl.src = 'assets/default_cover.png';
    return 'assets/default_cover.png';
  }
}

// Export functions to global scope for compatibility
if (typeof window !== 'undefined') {
  window.loadCoverOptimized = loadCoverOptimized;
  window.loadCoversInBatch = loadCoversInBatch;
  window.updateNowPlayingCover = updateNowPlayingCover;
}
