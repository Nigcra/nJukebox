// ===== LIBRARY RENDERING FUNCTIONS =====
// Exported from web_renderer.js - Library Renderer Module (Core)

// Initialize domCache if not already present
if (!window.domCache) {
  window.domCache = {
    artists: new Map(),
    albums: new Map(),
    tracks: new Map()
  };
}
const domCache = window.domCache;

async function renderArtistsList(preserveAZFilter = false) {
  try {
    libraryGridEl.classList.add('hidden');
    libraryListEl.classList.remove('hidden');
    
    // Check DOM cache first - use only "all" filter for cache
    const artistsCacheKey = `artists-all`;
    if (domCache.artists && domCache.artists.has && domCache.artists.has(artistsCacheKey) && browsedArtists && browsedArtists.length > 0) {
      debugLog('CACHE', 'Using cached artists view and applying filter');
      libraryListEl.innerHTML = '';
      libraryListEl.appendChild(domCache.artists.get(artistsCacheKey).cloneNode(true));
      
      // Rebind event listeners for cached artist cards
      const artistCards = libraryListEl.querySelectorAll('[data-artist-card]');
      artistCards.forEach(artistCard => {
        const artistName = artistCard.dataset.artistName;
        
        // Rebind click event
        artistCard.addEventListener('click', () => {
          handleNavigationActivity('artist');
          navigationState.currentArtist = artistName;
          renderAlbumsList(artistName);
        });
        
        // Rebind hover events
        artistCard.addEventListener('mouseenter', () => {
          artistCard.style.backgroundColor = '#2a2a2a';
          artistCard.style.transform = 'translateY(-5px)';
          artistCard.style.boxShadow = '0 8px 15px rgba(0, 0, 0, 0.4)';
          artistCard.style.borderColor = '#1DB954';
        });
        artistCard.addEventListener('mouseleave', () => {
          artistCard.style.backgroundColor = '#1e1e1e';
          artistCard.style.transform = 'translateY(0)';
          artistCard.style.boxShadow = '0 4px 6px rgba(0, 0, 0, 0.3)';
          artistCard.style.borderColor = 'transparent';
        });
      });
      
      // Wende A-Z Filter client-seitig an
      applyAZFilterToArtists(currentAZFilter);
      
      // Update navigation state
      navigationState.level = 'artists';
      navigationState.currentArtist = null;
      navigationState.currentAlbum = null;
      updateBreadcrumb();
      return;
    }
    
    const loadingText = (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.messages.loadingArtistsGeneric') : 'Lade Künstler...';
    libraryListEl.innerHTML = `<div class="loading">${loadingText}</div>`;
    
    const response = await musicAPI.getArtists();
    const artists = response.data || response; // Handle both formats
    browsedArtists = artists;
    
    // Update navigation state
    navigationState.level = 'artists';
    navigationState.currentArtist = null;
    navigationState.currentAlbum = null;
    updateBreadcrumb();
    
    // Reset A-Z filter when switching to artists view to show all artists initially
    // But preserve it if this is called from A-Z navigation
    if (!preserveAZFilter && currentAZFilter !== 'all') {
      currentAZFilter = 'all';
      // Update the active button
      const azButtons = document.querySelectorAll('#azNavButtons .az-btn');
      azButtons.forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.letter === 'all') {
          btn.classList.add('active');
        }
      });
    }
    
    libraryListEl.innerHTML = '';
    
    // Group artists by first letter
    const artistsByLetter = {};
    artists.forEach(artist => {
      const firstChar = (artist.name || artist.artist).charAt(0).toUpperCase();
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

    // Apply A-Z filter - but render all for caching
    let lettersToShow = Object.keys(artistsByLetter);
    
    // Sortiere alle Buchstaben, aber zeige erstmal alle
    const sortedLetters = lettersToShow.sort((a, b) => {
      if (a === '0-9') return -1;
      if (b === '0-9') return 1;
      if (a === '#') return 1;
      if (b === '#') return -1;
      return a.localeCompare(b);
    });
    
    sortedLetters.forEach(letter => {
      // Artist letter section container  
      const letterSection = document.createElement('div');
      letterSection.className = 'artist-letter-section';
      
      // Letter header
      const letterHeader = document.createElement('div');
      letterHeader.className = 'letter-header';
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
      letterSection.appendChild(letterHeader);
      
      // Artists container for this letter
      const artistsContainer = document.createElement('div');
      artistsContainer.style.cssText = `
        display: flex;
        flex-wrap: wrap;
        gap: 1rem;
        margin-bottom: 2rem;
        padding: 0 1rem;
      `;
      
      // Sort artists within this letter
      const sortedArtists = artistsByLetter[letter].sort((a, b) => {
        const nameA = (a.name || a.artist).toLowerCase();
        const nameB = (b.name || b.artist).toLowerCase();
        return nameA.localeCompare(nameB);
      });
      
      sortedArtists.forEach(artist => {
        const artistCard = document.createElement('div');
        artistCard.setAttribute('data-artist-card', 'true');
        artistCard.setAttribute('data-artist-name', artist.name || artist.artist);
        artistCard.style.cssText = `
          width: 150px;
          background-color: #1e1e1e;
          border-radius: 0.5rem;
          padding: 1rem;
          cursor: pointer;
          transition: all 0.3s ease;
          box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
          border: 2px solid transparent;
          text-align: center;
        `;
        
        artistCard.addEventListener('mouseenter', () => {
          artistCard.style.backgroundColor = '#2a2a2a';
          artistCard.style.transform = 'translateY(-5px)';
          artistCard.style.boxShadow = '0 8px 15px rgba(0, 0, 0, 0.4)';
          artistCard.style.borderColor = '#1DB954';
        });
        artistCard.addEventListener('mouseleave', () => {
          artistCard.style.backgroundColor = '#1e1e1e';
          artistCard.style.transform = 'translateY(0)';
          artistCard.style.boxShadow = '0 4px 6px rgba(0, 0, 0, 0.3)';
          artistCard.style.borderColor = 'transparent';
        });
        
        // Artist avatar container (with mosaic cover)
        const avatarContainer = document.createElement('div');
        avatarContainer.style.cssText = `
          width: 100%;
          height: 118px;
          margin-bottom: 0.8rem;
          border-radius: 0.3rem;
          overflow: hidden;
          background: linear-gradient(135deg, #1DB954, #0d5f2a);
          display: flex;
          align-items: center;
          justify-content: center;
          position: relative;
        `;
        
        // Try to load artist mosaic cover, fallback to icon
        const artistName = artist.name || artist.artist;
        
        const avatarImg = document.createElement('img');
        avatarImg.style.cssText = `
          width: 100%;
          height: 100%;
          object-fit: cover;
          border-radius: 0.3rem;
        `;
        
        // Fallback icon if image fails to load
        const avatarIcon = document.createElement('span');
        avatarIcon.textContent = '👤';
        avatarIcon.style.cssText = `
          font-size: 3rem;
          color: white;
          display: none;
        `;
        
        // Load cover optimized with cache
        loadCoverOptimized(avatarImg, 'artist', artistName, artistName);
        
        // Handle load success/failure with event listeners
        avatarImg.onload = () => {
          avatarIcon.style.display = 'none';
          avatarImg.style.display = 'block';
        };
        
        avatarImg.onerror = () => {
          avatarImg.style.display = 'none';
          avatarIcon.style.display = 'flex';
          avatarIcon.style.alignItems = 'center';
          avatarIcon.style.justifyContent = 'center';
          avatarIcon.style.width = '100%';
          avatarIcon.style.height = '100%';
        };
        
        // Add both image and fallback icon to container
        avatarContainer.appendChild(avatarImg);
        avatarContainer.appendChild(avatarIcon);
        artistCard.appendChild(avatarContainer);
        
        // Artist name
        const nameDiv = document.createElement('div');
        nameDiv.textContent = artist.name || artist.artist;
        nameDiv.style.cssText = `
          font-weight: bold;
          font-size: 1rem;
          margin-bottom: 0.4rem;
          color: #fff;
          text-align: center;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          line-height: 1.2;
        `;
        artistCard.appendChild(nameDiv);
        
        // Track count (like artist name in albums)
        const countDiv = document.createElement('div');
        countDiv.textContent = `${artist.track_count} ${artist.track_count === 1 ? 'Track' : 'Tracks'}`;
        countDiv.style.cssText = `
          font-size: 0.8rem;
          color: #666;
          text-align: center;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        `;
        artistCard.appendChild(countDiv);
        
        artistCard.addEventListener('click', () => {
          handleNavigationActivity('artist');
          navigationState.currentArtist = artist.name || artist.artist;
          renderAlbumsList(artist.name || artist.artist);
        });
        
        artistsContainer.appendChild(artistCard);
      });
      
      // Add artists container to letter section
      letterSection.appendChild(artistsContainer);
      
      // Add complete letter section to library
      libraryListEl.appendChild(letterSection);
    });
    
    // Apply current A-Z filter after rendering all
    applyAZFilterToArtists(currentAZFilter);
    
    if (sortedLetters.length === 0) {
      const noResultsDiv = document.createElement('div');
      const noArtistsText = (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.messages.noArtistsFound') : 'Keine Künstler gefunden';
      noResultsDiv.textContent = noArtistsText;
      noResultsDiv.style.cssText = `
        padding: 2rem;
        text-align: center;
        color: #999;
      `;
      libraryListEl.appendChild(noResultsDiv);
    }
    
    // Cache the DOM for later use - always without filter
    const artistsKey = `artists-all`;
    if (!domCache.artists.has(artistsKey)) {
      debugLog('CACHE', 'Caching komplette Artists-Ansicht (ohne Filter)');
      domCache.artists.set(artistsKey, libraryListEl.cloneNode(true));
    }
    
  } catch (error) {
    debugLog('LIBRARY', 'Error loading artists:', error);
    const errorText = (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.messages.errorLoadingArtists') : 'Fehler beim Laden der Künstler';
    libraryListEl.innerHTML = `<div class="error">${errorText}</div>`;
  }
}

async function renderAlbumsList(artistName = null) {
  try {
    libraryGridEl.classList.remove('hidden');
    libraryListEl.classList.add('hidden');
    
    // Prüfe DOM-Cache zuerst
    const cacheKey = artistName || 'all';
    if (domCache.albums.has(cacheKey) && browsedAlbums && browsedAlbums.length > 0) {
      debugLog('CACHE', `Using cached Albums view for: ${cacheKey}`);
      libraryGridEl.innerHTML = '';
      libraryGridEl.appendChild(domCache.albums.get(cacheKey));
      
      // Rebind event listeners for cached album cards
      const albumCards = libraryGridEl.querySelectorAll('[data-album-card]');
      albumCards.forEach(albumCard => {
        const artistName = albumCard.dataset.artist;
        const albumName = albumCard.dataset.album;
        
        // Rebind click event
        albumCard.addEventListener('click', () => {
          handleNavigationActivity('album');
          navigationState.level = 'tracks';
          navigationState.currentArtist = artistName;
          navigationState.currentAlbum = albumName;
          updateBreadcrumb();
          renderTracksList(artistName, albumName);
        });
        
        // Rebind hover events
        albumCard.addEventListener('mouseenter', () => {
          albumCard.style.backgroundColor = '#2a2a2a';
          albumCard.style.transform = 'translateY(-5px)';
          albumCard.style.boxShadow = '0 8px 15px rgba(0, 0, 0, 0.4)';
        });
        albumCard.addEventListener('mouseleave', () => {
          albumCard.style.backgroundColor = '#1e1e1e';
          albumCard.style.transform = 'translateY(0)';
          albumCard.style.boxShadow = '0 4px 6px rgba(0, 0, 0, 0.3)';
        });
      });
      
      // Update navigation state
      if (artistName) {
        navigationState.level = 'albums';
        navigationState.currentArtist = artistName;
        navigationState.currentAlbum = null;
      } else {
        navigationState.level = 'albums';
        navigationState.currentArtist = null;
        navigationState.currentAlbum = null;
      }
      updateBreadcrumb();
      return;
    }
    
    const loadingAlbumsText = (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.messages.loadingAlbums') : 'Lade Alben...';
    libraryGridEl.innerHTML = `<div class="loading">${loadingAlbumsText}</div>`;
    
    const response = artistName ? 
      await musicAPI.getAlbums(artistName) : 
      await musicAPI.getAlbums();
    const albums = response.data || response; // Handle both formats
    browsedAlbums = albums;
    
    // Update navigation state
    if (artistName) {
      navigationState.level = 'albums';
      navigationState.currentArtist = artistName;
      navigationState.currentAlbum = null;
    } else {
      navigationState.level = 'root';
      navigationState.currentArtist = null;
      navigationState.currentAlbum = null;
    }
    updateBreadcrumb();
    
    libraryGridEl.innerHTML = '';
    
    // Reset to standard grid layout for albums view
    libraryGridEl.style.display = 'grid';
    libraryGridEl.style.gridTemplateColumns = 'repeat(auto-fill, minmax(200px, 1fr))';
    libraryGridEl.style.gap = '1rem';
    libraryGridEl.style.padding = '0';
    libraryGridEl.style.justifyItems = 'center';
    
    // Apply letter filter if no specific artist
    let filteredAlbums = albums;
    if (!artistName && currentAZFilter !== 'all') {
      if (currentAZFilter === '0-9') {
        filteredAlbums = albums.filter(album => {
          const firstChar = (album.name || album.album).charAt(0);
          return /[0-9]/.test(firstChar);
        });
      } else {
        const letter = currentAZFilter.toUpperCase();
        filteredAlbums = albums.filter(album => 
          (album.name || album.album).charAt(0).toUpperCase() === letter
        );
      }
    }

    filteredAlbums.forEach(album => {
      const albumCard = document.createElement('div');
      albumCard.setAttribute('data-album-card', 'true');
      albumCard.setAttribute('data-artist', artistName || album.artist);
      albumCard.setAttribute('data-album', album.name || album.album);
      albumCard.style.width = '200px';
      albumCard.style.margin = '0';
      albumCard.style.backgroundColor = '#1e1e1e';
      albumCard.style.borderRadius = '0.5rem';
      albumCard.style.padding = '1rem';
      albumCard.style.cursor = 'pointer';
      albumCard.style.transition = 'all 0.3s ease';
      albumCard.style.boxShadow = '0 4px 6px rgba(0, 0, 0, 0.3)';
      
      albumCard.addEventListener('mouseenter', () => {
        albumCard.style.backgroundColor = '#2a2a2a';
        albumCard.style.transform = 'translateY(-5px)';
        albumCard.style.boxShadow = '0 8px 15px rgba(0, 0, 0, 0.4)';
      });
      albumCard.addEventListener('mouseleave', () => {
        albumCard.style.backgroundColor = '#1e1e1e';
        albumCard.style.transform = 'translateY(0)';
        albumCard.style.boxShadow = '0 4px 6px rgba(0, 0, 0, 0.3)';
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
      
      // Get actual cover from music server using optimized cache
      const artistKey = (artistName || album.artist || 'unknown').toLowerCase();
      const albumName = (album.name || album.album || 'unknown').toLowerCase();
      
      const img = document.createElement('img');
      img.style.width = '100%';
      img.style.height = '100%';
      img.style.objectFit = 'cover';
      
      // Load cover with cache optimization
      loadCoverOptimized(img, 'album', albumName, artistKey, albumName);
      
      // On error, show fallback icon
      img.onerror = () => {
        img.style.display = 'none';
        const iconSpan = document.createElement('span');
        iconSpan.textContent = '💿';
        iconSpan.style.fontSize = '3rem';
        iconSpan.style.color = '#666';
        coverContainer.appendChild(iconSpan);
      };
      
      coverContainer.appendChild(img);
      
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
      albumCard.appendChild(nameSpan);
      
      // Artist name (smaller, below album name)
      const artistSpan = document.createElement('div');
      artistSpan.textContent = artistName || album.artist || ((typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.messages.unknownArtist') : 'Unbekannter Künstler');
      artistSpan.style.fontSize = '0.9rem';
      artistSpan.style.color = '#999';
      artistSpan.style.textAlign = 'center';
      artistSpan.style.marginBottom = '0.4rem';
      albumCard.appendChild(artistSpan);
      
      // Album info
      const infoSpan = document.createElement('div');
      let infoText = `${album.track_count} ${album.track_count === 1 ? 'Track' : 'Tracks'}`;
      if (album.year) {
        infoText += ` • ${album.year}`;
      }
      infoSpan.textContent = infoText;
      infoSpan.style.fontSize = '0.8rem';
      infoSpan.style.color = '#666';
      infoSpan.style.textAlign = 'center';
      albumCard.appendChild(infoSpan);
      
      albumCard.addEventListener('click', () => {
        handleNavigationActivity('album');
        navigationState.level = 'tracks';
        navigationState.currentArtist = artistName || album.artist;
        navigationState.currentAlbum = album.name || album.album;
        updateBreadcrumb();
        renderTracksList(artistName || album.artist, album.name || album.album);
      });
      
      libraryGridEl.appendChild(albumCard);
    });
    
    if (albums.length === 0) {
      const noResultsDiv = document.createElement('div');
      const noAlbumsText = (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.messages.noAlbumsFound') : 'Keine Alben gefunden';
      noResultsDiv.textContent = noAlbumsText;
      noResultsDiv.style.padding = '2rem';
      noResultsDiv.style.textAlign = 'center';
      noResultsDiv.style.color = '#999';
      noResultsDiv.style.gridColumn = '1 / -1';
      libraryGridEl.appendChild(noResultsDiv);
    }
    
    // Cache das DOM für späteren Gebrauch
    const albumsCacheKey = artistName || 'all';
    if (!domCache.albums.has(albumsCacheKey)) {
      debugLog('CACHE', `Caching Albums view for: ${albumsCacheKey}`);
      domCache.albums.set(albumsCacheKey, libraryGridEl.cloneNode(true));
    }
    
  } catch (error) {
    debugLog('LIBRARY', 'Error loading albums:', error);
    const errorLoadingAlbumsText = (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.messages.errorLoadingArtists') : 'Fehler beim Laden der Alben';
    libraryGridEl.innerHTML = `<div class="error">${errorLoadingAlbumsText}</div>`;
  }
}

async function renderTracksList(artistName, albumName = null) {
  try {
    libraryGridEl.classList.add('hidden');
    libraryListEl.classList.remove('hidden');
    
    // Prüfe DOM-Cache zuerst
    const tracksCacheKey = `${artistName}-${albumName || 'all'}`;
    if (domCache.tracks.has(tracksCacheKey) && browsedTracks && browsedTracks.length > 0) {
      debugLog('CACHE', `Using cached Tracks view for: ${tracksCacheKey}`);
      libraryListEl.innerHTML = '';
      libraryListEl.appendChild(domCache.tracks.get(tracksCacheKey));
      
      // Update navigation state
      navigationState.level = 'tracks';
      navigationState.currentArtist = artistName;
      navigationState.currentAlbum = albumName;
      updateBreadcrumb();
      return;
    }
    
    const loadingTracksText = (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.messages.loadingTracks') : 'Lade Tracks...';
    libraryListEl.innerHTML = `<div class="loading">${loadingTracksText}</div>`;
    
    const filters = { artist: artistName };
    if (albumName) {
      filters.album = albumName;
    }
    
    const response = await musicAPI.getTracks(filters);
    const tracks = response.data || response; // Handle both formats
    browsedTracks = tracks;
    
    // Update navigation state
    navigationState.level = 'tracks';
    navigationState.currentArtist = artistName;
    navigationState.currentAlbum = albumName;
    updateBreadcrumb();
    
    libraryListEl.innerHTML = '';
    
    // Add album header if we have an album
    if (albumName && tracks.length > 0) {
      const albumHeader = document.createElement('div');
      albumHeader.style.cssText = `
        display: flex;
        align-items: center;
        padding: 2rem 1rem;
        margin-bottom: 2rem;
        background: linear-gradient(135deg, #1e1e1e 0%, #333 100%);
        border-radius: 1rem;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
      `;
      
      // Album cover
      const artistKey = (artistName || 'unknown').toLowerCase();
      const albumNameKey = (albumName || 'unknown').toLowerCase();
      const albumKey = `${artistKey}||${albumNameKey}`;
      const coverUrl = `http://localhost:3001/api/album-cover/${encodeURIComponent(albumKey)}`;
      
      const coverImg = document.createElement('img');
      coverImg.src = coverUrl;
      coverImg.style.cssText = `
        width: 200px;
        height: 200px;
        border-radius: 1rem;
        margin-right: 2rem;
        object-fit: cover;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
      `;
      
      coverImg.onerror = () => {
        coverImg.style.display = 'none';
        const iconDiv = document.createElement('div');
        iconDiv.textContent = '💿';
        iconDiv.style.cssText = `
          width: 200px;
          height: 200px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 4rem;
          background: #333;
          border-radius: 1rem;
          margin-right: 2rem;
          color: #666;
        `;
        albumHeader.insertBefore(iconDiv, albumHeader.firstChild);
      };
      
      albumHeader.appendChild(coverImg);
      
      // Album info
      const infoDiv = document.createElement('div');
      infoDiv.style.flex = '1';
      
      const albumTitle = document.createElement('h1');
      albumTitle.textContent = albumName;
      albumTitle.style.cssText = `
        font-size: 3rem;
        font-weight: bold;
        margin: 0 0 1rem 0;
        color: #fff;
        line-height: 1.2;
      `;
      
      const artistTitle = document.createElement('h2');
      artistTitle.textContent = artistName;
      artistTitle.style.cssText = `
        font-size: 1.5rem;
        font-weight: normal;
        margin: 0 0 1rem 0;
        color: #1DB954;
        cursor: pointer;
      `;
      
      artistTitle.addEventListener('click', () => {
        navigationState.level = 'albums';
        navigationState.currentAlbum = null;
        updateBreadcrumb();
        renderAlbumsList(artistName);
      });
      
      const yearSpan = document.createElement('span');
      if (tracks[0] && tracks[0].year) {
        yearSpan.textContent = tracks[0].year;
        yearSpan.style.cssText = `
          font-size: 1.1rem;
          color: #999;
          margin-right: 1rem;
        `;
      }
      
      const trackCount = document.createElement('span');
      trackCount.textContent = `${tracks.length} ${tracks.length === 1 ? 'Track' : 'Tracks'}`;
      trackCount.style.cssText = `
        font-size: 1.1rem;
        color: #999;
      `;
      
      infoDiv.appendChild(albumTitle);
      infoDiv.appendChild(artistTitle);
      
      const metaDiv = document.createElement('div');
      metaDiv.style.display = 'flex';
      metaDiv.style.alignItems = 'center';
      metaDiv.appendChild(yearSpan);
      metaDiv.appendChild(trackCount);
      infoDiv.appendChild(metaDiv);
      
      albumHeader.appendChild(infoDiv);
      libraryListEl.appendChild(albumHeader);
    }
    
    tracks.forEach(track => {
      const li = document.createElement('li');
      const isRecent = isTrackRecentlyPlayed(track);
      const isInQueue = isTrackInQueue(track);
      
      li.style.padding = '0.6rem';
      li.style.marginBottom = '0.5rem';
      li.style.backgroundColor = '#1e1e1e';
      li.style.borderRadius = '0.4rem';
      li.style.display = 'flex';
      li.style.alignItems = 'center';
      li.style.cursor = 'pointer';
      li.style.transition = 'background-color 0.2s';
      
      if ((isRecent || isInQueue) && !isAdminMode) {
        li.classList.add('disabled');
        li.style.backgroundColor = '#151515';
        li.style.color = '#666';
        li.style.cursor = 'not-allowed';
      } else {
        li.addEventListener('mouseenter', () => {
          li.style.backgroundColor = '#2a2a2a';
        });
        li.addEventListener('mouseleave', () => {
          li.style.backgroundColor = '#1e1e1e';
        });
      }
      
      // Track number
      if (track.track_number) {
        const numberSpan = document.createElement('span');
        numberSpan.textContent = track.track_number.toString().padStart(2, '0');
        numberSpan.style.marginRight = '0.8rem';
        numberSpan.style.color = '#999';
        numberSpan.style.fontSize = '0.9rem';
        numberSpan.style.minWidth = '2rem';
        li.appendChild(numberSpan);
      }
      
      // Cover or icon
      if (track.cover_path || track.image || track.image_url || (track.type === 'spotify' && track.album)) {
        const img = document.createElement('img');
        img.style.width = '40px';
        img.style.height = '40px';
        img.style.objectFit = 'cover';
        img.style.borderRadius = '0.2rem';
        img.style.marginRight = '0.8rem';
        
        // Use optimized cover loading for server tracks
        if (track.type !== 'spotify') {
          const artistKey = (track.artist || 'unknown').toLowerCase();
          const albumNameKey = (track.album || 'unknown').toLowerCase();
          loadCoverOptimized(img, 'album', albumNameKey, artistKey, albumNameKey);
        } else if (track.image_url) {
          img.src = track.image_url;
        }
        
        img.onerror = () => {
          img.style.display = 'none';
          const iconSpan = document.createElement('span');
          iconSpan.textContent = '🎵';
          iconSpan.style.fontSize = '1.5rem';
          iconSpan.style.marginRight = '0.8rem';
          iconSpan.style.color = '#666';
          iconSpan.style.minWidth = '40px';
          iconSpan.style.textAlign = 'center';
          li.insertBefore(iconSpan, li.children[track.track_number ? 1 : 0]);
        };
        
        li.appendChild(img);
      } else {
        const iconSpan = document.createElement('span');
        iconSpan.textContent = '🎵';
        iconSpan.style.fontSize = '1.5rem';
        iconSpan.style.marginRight = '0.8rem';
        iconSpan.style.color = '#666';
        iconSpan.style.minWidth = '40px';
        iconSpan.style.textAlign = 'center';
        li.appendChild(iconSpan);
      }
      
      // Track info
      const infoDiv = document.createElement('div');
      infoDiv.style.flex = '1';
      
      const titleDiv = document.createElement('div');
      titleDiv.textContent = track.title;
      titleDiv.style.fontWeight = 'bold';
      titleDiv.style.marginBottom = '0.2rem';
      titleDiv.style.color = (isRecent || isInQueue) && !isAdminMode ? '#666' : '#fff';
      infoDiv.appendChild(titleDiv);
      
      if (!albumName || track.artist !== artistName) {
        const detailsDiv = document.createElement('div');
        let detailsText = '';
        if (!albumName) detailsText += track.artist;
        if (!albumName && track.album) detailsText += ' • ';
        if (track.album && track.album !== albumName) detailsText += track.album;
        detailsDiv.textContent = detailsText;
        detailsDiv.style.fontSize = '0.8rem';
        detailsDiv.style.color = '#999';
        infoDiv.appendChild(detailsDiv);
      }
      
      li.appendChild(infoDiv);
      
      // Duration
      if (track.duration) {
        const durationSpan = document.createElement('span');
        const minutes = Math.floor(track.duration / 60);
        const seconds = Math.floor(track.duration % 60);
        durationSpan.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
        durationSpan.style.marginLeft = '1rem';
        durationSpan.style.color = '#666';
        durationSpan.style.fontSize = '0.9rem';
        li.appendChild(durationSpan);
      }
      
      // Play button - only show if not disabled
      if (!(isRecent || isInQueue) || isAdminMode) {
        const playButton = document.createElement('button');
        playButton.innerHTML = '▶';
        playButton.style.marginLeft = '1rem';
        playButton.style.background = 'none';
        playButton.style.border = 'none';
        playButton.style.color = '#1DB954';
        playButton.style.cursor = 'pointer';
        playButton.style.fontSize = '1.2rem';
        playButton.style.padding = '0.5rem';
        playButton.style.borderRadius = '50%';
        playButton.style.transition = 'background-color 0.2s';
        
        playButton.addEventListener('mouseenter', () => {
          playButton.style.backgroundColor = '#1DB954';
          playButton.style.color = '#fff';
        });
        playButton.addEventListener('mouseleave', () => {
          playButton.style.backgroundColor = 'transparent';
          playButton.style.color = '#1DB954';
        });
        
        playButton.addEventListener('click', (e) => {
          e.stopPropagation();
          playTrack(track.id);
        });
        
        li.appendChild(playButton);
        
        // Click to play track
        li.addEventListener('click', () => {
          playTrack(track.id);
        });
      }
      
      libraryListEl.appendChild(li);
    });
    
    if (tracks.length === 0) {
      const noResultsDiv = document.createElement('div');
      const noTracksText = (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.messages.noTracksFound') : 'Keine Tracks gefunden';
      noResultsDiv.textContent = noTracksText;
      noResultsDiv.style.padding = '2rem';
      noResultsDiv.style.textAlign = 'center';
      noResultsDiv.style.color = '#999';
      libraryListEl.appendChild(noResultsDiv);
    }
    
    // Cache das DOM für späteren Gebrauch
    const cacheKey = `${artistName}-${albumName || 'all'}`;
    if (!domCache.tracks.has(cacheKey)) {
      debugLog('CACHE', `Caching Tracks view for: ${cacheKey}`);
      domCache.tracks.set(cacheKey, libraryListEl.cloneNode(true));
    }
    
  } catch (error) {
    debugLog('LIBRARY', 'Error loading tracks:', error);
    const errorLoadingTracksText = (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.messages.errorLoadingArtists') : 'Fehler beim Laden der Tracks';
    libraryListEl.innerHTML = `<div class="error">${errorLoadingTracksText}</div>`;
  }
}

// Main renderLibrary function that routes to specific renderers
function renderLibrary() {
  debugLog('[DEBUG] === renderLibrary ENTRY ===');
  const filter = currentFilter;
  debugLog('[DEBUG] === renderLibrary aufgerufen mit filter:', filter, 'navigationState.level:', navigationState.level);
  
  // Handle hierarchical navigation
  if (filter === 'artist') {
    if (navigationState.level === 'root' || navigationState.level === 'artists') {
      return renderArtistsList();
    } else if (navigationState.level === 'albums') {
      return renderAlbumsList(navigationState.currentArtist);
    } else if (navigationState.level === 'tracks') {
      return renderTracksList(navigationState.currentArtist, navigationState.currentAlbum);
    }
  }
  
  // Handle other category views
  if (filter === 'genre') {
    return renderGenresList();
  }
  
  if (filter === 'decade') {
    return renderDecadesList();
  }
  
  if (filter === 'album') {
    return renderAllAlbumsList();
  }

  if (currentView==='cover') { return renderCoverView(filter); }
  debugLog('[DEBUG] Check filter === "new":', filter === 'new', 'filter:', filter);
  if (filter==='new') {
    debugLog('[DEBUG] Rufe renderRecentAlbums() auf...');
    return renderRecentAlbums();
  }
  
  libraryGridEl.classList.add('hidden');
  libraryListEl.classList.remove('hidden');
  
  // Default track list view
  libraryListEl.innerHTML='';
  let filtered = library;
  if (filter!=='all') { const letter=filter.toUpperCase(); filtered = library.filter((item)=> item.title.charAt(0).toUpperCase()===letter); }
  filtered.forEach((item)=>{ 
    const li=document.createElement('li');
    const isRecent = isTrackRecentlyPlayed(item);
    const isInQueue = isTrackInQueue(item);
    
    if (item.image) { 
      const img=document.createElement('img'); 
      img.src=item.image; 
      img.style.width='40px'; 
      img.style.height='40px'; 
      img.style.objectFit='cover'; 
      img.style.marginRight='0.5rem'; 
      li.appendChild(img);
    } else { 
      const spanIcon=document.createElement('span'); 
      spanIcon.textContent='🎵'; 
      spanIcon.style.marginRight='0.5rem'; 
      spanIcon.style.color='#1DB954'; 
      li.appendChild(spanIcon);
    } 
    
    const spanTitle=document.createElement('span'); 
    spanTitle.textContent=item.title; 
    li.appendChild(spanTitle);
    
    li.style.padding='0.6rem'; 
    li.style.marginBottom='0.5rem'; 
    li.style.backgroundColor='#1e1e1e'; 
    li.style.borderRadius='0.4rem'; 
    li.style.display='flex'; 
    li.style.alignItems='center'; 
    li.style.cursor='pointer';
    
    if ((isRecent || isInQueue) && !isAdminMode) {
      li.classList.add('disabled');
      li.style.backgroundColor='#151515';
      li.style.color='#666';
      li.style.cursor='not-allowed';
      li.addEventListener('click', (e)=> {
        e.preventDefault();
        if (isInQueue) {
          alert(`Dieser Titel ist bereits in der Playlist.`);
        } else if (isRecent) {
          const now = Date.now();
          const oneHour = 60 * 60 * 1000;
          const playEntry = playedTracks.find(played => 
            (played.uri === (item.uri || null)) || (played.path === (item.path || null))
          );
          if (playEntry) {
            const remainingTime = Math.ceil((oneHour - (now - playEntry.timestamp)) / (60 * 1000));
            alert(`Dieser Titel wurde kürzlich gespielt. Bitte warte noch ${remainingTime} Minuten.`);
          }
        }
      });
    } else {
      li.addEventListener('click', ()=> addToQueue(item));
    }
    
    libraryListEl.appendChild(li); 
  });
}

// Export functions globally for compatibility
window.renderLibrary = renderLibrary;
window.renderArtistsList = renderArtistsList;
window.renderAlbumsList = renderAlbumsList;
window.renderTracksList = renderTracksList;
