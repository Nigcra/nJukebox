// ===== GENRE RENDERING FUNCTIONS =====
// Exported from web_renderer.js - Library Renderer Module (Genres)

async function renderGenresList() {
  try {
    libraryGridEl.classList.add('hidden');
    libraryListEl.classList.remove('hidden');
    const loadingGenresText = (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.messages.loadingGenres') : 'Lade Genres...';
    libraryListEl.innerHTML = `<div class="loading">${loadingGenresText}</div>`;
    
    const response = await musicAPI.getGenres();
    const genres = response.data || response;
    
    // Reset navigation state
    navigationState.level = 'root';
    navigationState.currentArtist = null;
    navigationState.currentAlbum = null;
    navigationState.currentGenreCategory = null;
    navigationState.currentGenreCategoryData = null;
    navigationState.currentGenre = null;
    updateBreadcrumb();
    
    libraryListEl.innerHTML = '';
    
    // No A-Z filtering for genres
    let filteredGenres = genres;
    
    // Genre theme colors and icons with categories
    const genreCategories = {
      'Rock & Metal': {
        color: '#FF4500', accent: '#FF6347', icon: '🎸',
        genres: ['Rock', 'Metal', 'Hard Rock', 'Heavy Metal', 'Progressive Rock', 'Classic Rock', 'Alternative Rock']
      },
      'Pop & Mainstream': {
        color: '#FF69B4', accent: '#FFB6C1', icon: '🎤',
        genres: ['Pop', 'Top 40', 'Mainstream', 'Teen Pop', 'Europop', 'K-Pop', 'J-Pop']
      },
      'Hip Hop & Rap': {
        color: '#32CD32', accent: '#98FB98', icon: '🎧',
        genres: ['Hip Hop', 'Rap', 'Trap', 'Gangsta Rap', 'Old School Hip Hop', 'East Coast Hip Hop', 'West Coast Hip Hop']
      },
      'Electronic & Dance': {
        color: '#00CED1', accent: '#48D1CC', icon: '🎛️',
        genres: ['Electronic', 'Dance', 'House', 'Techno', 'Trance', 'Dubstep', 'EDM', 'Ambient', 'Drum & Bass']
      },
      'Jazz & Blues': {
        color: '#4169E1', accent: '#6495ED', icon: '🎷',
        genres: ['Jazz', 'Blues', 'Swing', 'Bebop', 'Smooth Jazz', 'Jazz Fusion', 'Traditional Blues']
      },
      'R&B & Soul': {
        color: '#DC143C', accent: '#F08080', icon: '🎵',
        genres: ['R&B', 'Soul', 'Funk', 'Motown', 'Neo-Soul', 'Contemporary R&B', 'Gospel']
      },
      'Classical & Orchestral': {
        color: '#8B4513', accent: '#CD853F', icon: '🎻',
        genres: ['Classical', 'Orchestra', 'Chamber Music', 'Opera', 'Symphony', 'Baroque', 'Romantic']
      },
      'Country & Folk': {
        color: '#DAA520', accent: '#F0E68C', icon: '🤠',
        genres: ['Country', 'Folk', 'Bluegrass', 'Americana', 'Country Rock', 'Western', 'Traditional Folk']
      },
      'Alternative & Indie': {
        color: '#8A2BE2', accent: '#DA70D6', icon: '🎨',
        genres: ['Alternative', 'Indie', 'Indie Rock', 'Indie Pop', 'Art Rock', 'Post-Rock', 'Experimental']
      },
      'Punk & Hardcore': {
        color: '#FF0000', accent: '#FF6B6B', icon: '⚡',
        genres: ['Punk', 'Hardcore', 'Punk Rock', 'Post-Punk', 'Ska Punk', 'Pop Punk', 'Hardcore Punk']
      },
      'World & Regional': {
        color: '#228B22', accent: '#90EE90', icon: '🌍',
        genres: ['Reggae', 'Latin', 'World Music', 'African', 'Celtic', 'Flamenco', 'Bossa Nova', 'Salsa']
      }
    };
    
    // Group genres into categories
    const categorizedGenres = {};
    const uncategorizedGenres = [];
    
    filteredGenres.forEach(genre => {
      const genreName = genre.name || genre.genre;
      let categorized = false;
      
      for (const [categoryName, category] of Object.entries(genreCategories)) {
        if (category.genres.some(g => genreName.toLowerCase().includes(g.toLowerCase()) || g.toLowerCase().includes(genreName.toLowerCase()))) {
          if (!categorizedGenres[categoryName]) {
            categorizedGenres[categoryName] = {
              ...category,
              genres: [],
              totalTracks: 0
            };
          }
          categorizedGenres[categoryName].genres.push(genre);
          categorizedGenres[categoryName].totalTracks += genre.track_count;
          categorized = true;
          break;
        }
      }
      
      if (!categorized) {
        uncategorizedGenres.push(genre);
      }
    });
    
    // Add uncategorized genres as "Andere Genres" category if any exist
    if (uncategorizedGenres.length > 0) {
      categorizedGenres['Andere Genres'] = {
        color: '#666666', accent: '#999999', icon: '🎵',
        genres: uncategorizedGenres,
        totalTracks: uncategorizedGenres.reduce((sum, g) => sum + g.track_count, 0)
      };
    }
    
    const categoryKeys = Object.keys(categorizedGenres);
    
    // Header
    libraryListEl.innerHTML = `
      <div style="
        text-align: center; 
        padding: 2rem 1rem; 
        background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%);
        border-radius: 12px;
        margin-bottom: 2rem;
        border: 1px solid #333;
      ">
        <h2 style="
          margin: 0 0 0.5rem 0; 
          color: #1DB954; 
          font-size: 2.5rem;
          text-shadow: 0 0 20px rgba(29, 185, 84, 0.3);
        ">${(typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.labels.musicGenres') : '🎨 Musikgenres'}</h2>
        <p style="
          margin: 0; 
          color: #999; 
          font-size: 1.1rem;
        ">${(typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.labels.genresDescription') : 'Entdecke die Vielfalt der Musikstile'}</p>
      </div>
    `;
    
    // Genres container
    const genresContainer = document.createElement('div');
    genresContainer.style.cssText = `
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 1.5rem;
      padding: 0;
    `;
    
    categoryKeys.forEach((categoryName, index) => {
      const category = categorizedGenres[categoryName];
      
      const genreCard = document.createElement('div');
      genreCard.style.cssText = `
        background: linear-gradient(135deg, #1e1e1e 0%, #2a2a2a 100%);
        border-radius: 12px;
        padding: 1.5rem;
        cursor: pointer;
        transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
        box-shadow: 0 4px 15px rgba(0, 0, 0, 0.3);
        border: 2px solid transparent;
        text-align: center;
        position: relative;
        overflow: hidden;
        animation: fadeInUp 0.6s ease-out ${index * 0.1}s both;
        min-height: 180px;
        display: flex;
        flex-direction: column;
        justify-content: center;
      `;
      
      // Add CSS animation if not exists
      if (!document.querySelector('#genreCardAnimations')) {
        const styleSheet = document.createElement('style');
        styleSheet.id = 'genreCardAnimations';
        styleSheet.textContent = `
          @keyframes fadeInUp {
            from {
              opacity: 0;
              transform: translateY(30px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }
        `;
        document.head.appendChild(styleSheet);
      }
      
      genreCard.addEventListener('mouseenter', () => {
        genreCard.style.background = `linear-gradient(135deg, ${category.color}20 0%, ${category.accent}10 100%)`;
        genreCard.style.borderColor = category.color + '80';
        genreCard.style.transform = 'translateY(-8px) scale(1.02)';
        genreCard.style.boxShadow = `0 8px 25px ${category.color}40, 0 0 0 1px ${category.color}60`;
      });
      
      genreCard.addEventListener('mouseleave', () => {
        genreCard.style.background = 'linear-gradient(135deg, #1e1e1e 0%, #2a2a2a 100%)';
        genreCard.style.borderColor = 'transparent';
        genreCard.style.transform = 'translateY(0) scale(1)';
        genreCard.style.boxShadow = '0 4px 15px rgba(0, 0, 0, 0.3)';
      });
      
      // Background pattern
      const pattern = document.createElement('div');
      pattern.style.cssText = `
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: linear-gradient(45deg, ${category.accent}05 25%, transparent 25%),
                    linear-gradient(-45deg, ${category.accent}05 25%, transparent 25%);
        background-size: 20px 20px;
        opacity: 0.3;
        pointer-events: none;
      `;
      genreCard.appendChild(pattern);
      
      // Content container
      const contentContainer = document.createElement('div');
      contentContainer.style.cssText = `
        position: relative;
        z-index: 2;
      `;
      
      // Category icon
      const iconDiv = document.createElement('div');
      iconDiv.textContent = category.icon;
      iconDiv.style.cssText = `
        font-size: 3rem;
        margin-bottom: 1rem;
        text-shadow: 0 0 20px ${category.color}40;
      `;
      contentContainer.appendChild(iconDiv);
      
      // Category name
      const nameDiv = document.createElement('div');
      nameDiv.textContent = categoryName;
      nameDiv.style.cssText = `
        font-weight: bold;
        color: #fff;
        margin-bottom: 0.8rem;
        font-size: 1.3rem;
        line-height: 1.3;
        word-wrap: break-word;
      `;
      contentContainer.appendChild(nameDiv);
      
      // Genre count and track count
      const statsDiv = document.createElement('div');
      statsDiv.innerHTML = `
        <div style="
          font-size: 0.9rem;
          color: ${category.color};
          background: ${category.color}20;
          padding: 0.4rem 1rem;
          border-radius: 20px;
          border: 1px solid ${category.color}40;
          display: inline-block;
          font-weight: 500;
          margin-bottom: 0.5rem;
        ">${category.genres.length} ${category.genres.length === 1 ? 'Genre' : 'Genres'}</div>
        <div style="
          font-size: 0.8rem;
          color: #999;
        ">${category.totalTracks} ${category.totalTracks === 1 ? 'Track' : 'Tracks'}</div>
      `;
      contentContainer.appendChild(statsDiv);
      
      genreCard.appendChild(contentContainer);
      
      // Click handler - show expanded genre list for this category
      genreCard.addEventListener('click', async () => {
        showGenreCategory(categoryName, category);
      });
      
      genresContainer.appendChild(genreCard);
    });
    
    libraryListEl.appendChild(genresContainer);
    
    if (filteredGenres.length === 0) {
      const noResultsDiv = document.createElement('div');
      noResultsDiv.innerHTML = `
        <div style="
          text-align: center;
          padding: 3rem;
          color: #666;
          font-size: 1.2rem;
        ">
          <div style="font-size: 3rem; margin-bottom: 1rem;">🎨</div>
          <div>${currentAZFilter === 'all' 
            ? ((typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.messages.noGenresFound') : 'Keine Genres gefunden')
            : ((typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.messages.noGenresFoundWithFilter', `Keine Genres gefunden, die mit "${currentAZFilter}" beginnen`).replace('{filter}', currentAZFilter) : `Keine Genres gefunden, die mit "${currentAZFilter}" beginnen`)}</div>
          <div style="font-size: 0.9rem; margin-top: 0.5rem; color: #999;">
            Versuche einen anderen Filter
          </div>
        </div>
      `;
      noResultsDiv.style.cssText = `
        background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%);
        border-radius: 12px;
        border: 1px solid #333;
        margin: 2rem 0;
      `;
      libraryListEl.appendChild(noResultsDiv);
    }
    
  } catch (error) {
    debugLog('LIBRARY', 'Error loading genres:', error);
    libraryListEl.innerHTML = `
      <div style="
        text-align: center;
        padding: 3rem;
        color: #ff6b6b;
        background: linear-gradient(135deg, #1a1a1a 0%, #2d1a1a 100%);
        border-radius: 12px;
        border: 1px solid #ff6b6b40;
        margin: 2rem 0;
      ">
        <div style="font-size: 3rem; margin-bottom: 1rem;">⚠️</div>
        <div style="font-size: 1.2rem; margin-bottom: 0.5rem;">Fehler beim Laden der Genres</div>
        <div style="font-size: 0.9rem; color: #999;">${error.message}</div>
      </div>
    `;
  }
}

// Function to show individual genres within a category
function showGenreCategory(categoryName, category) {
  // Update navigation state for genre category
  navigationState.level = 'genre_category';
  navigationState.currentGenreCategory = categoryName;
  navigationState.currentGenreCategoryData = category;
  updateBreadcrumb();
  
  libraryListEl.innerHTML = '';
  
  // Unified header style with category-specific colors
  const headerDiv = document.createElement('div');
  headerDiv.style.cssText = `
    text-align: center; 
    padding: 2rem 1rem; 
    background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%);
    border-radius: 12px;
    margin-bottom: 2rem;
    border: 1px solid #333;
    position: relative;
    overflow: hidden;
  `;
  
  // Background pattern
  const pattern = document.createElement('div');
  pattern.style.cssText = `
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: linear-gradient(45deg, ${category.accent}05 25%, transparent 25%),
                linear-gradient(-45deg, ${category.accent}05 25%, transparent 25%);
    background-size: 30px 30px;
    opacity: 0.3;
    pointer-events: none;
  `;
  headerDiv.appendChild(pattern);
  
  const headerContent = document.createElement('div');
  headerContent.style.cssText = `
    position: relative;
    z-index: 2;
  `;
  
  const titleH2 = document.createElement('h2');
  titleH2.textContent = `${category.icon} ${categoryName}`;
  titleH2.style.cssText = `
    margin: 0 0 0.5rem 0; 
    color: ${category.color}; 
    font-size: 2.5rem;
    text-shadow: 0 0 20px ${category.color}40;
  `;
  headerContent.appendChild(titleH2);
  
  const subtitleP = document.createElement('p');
  subtitleP.textContent = `${category.genres.length} ${category.genres.length === 1 ? 'Genre' : 'Genres'} • ${category.totalTracks} ${category.totalTracks === 1 ? 'Track' : 'Tracks'}`;
  subtitleP.style.cssText = `
    margin: 0; 
    color: #999; 
    font-size: 1.1rem;
  `;
  headerContent.appendChild(subtitleP);
  
  headerDiv.appendChild(headerContent);
  
  // Add header to container
  libraryListEl.appendChild(headerDiv);
  
  // Individual genres container
  const genresContainer = document.createElement('div');
  genresContainer.style.cssText = `
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 1rem;
    padding: 0;
  `;
  
  category.genres.forEach((genre, index) => {
    const genreName = genre.name || genre.genre;
    
    const genreCard = document.createElement('div');
    genreCard.style.cssText = `
      background: linear-gradient(135deg, #1e1e1e 0%, #2a2a2a 100%);
      border-radius: 8px;
      padding: 1.2rem;
      cursor: pointer;
      transition: all 0.3s ease;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      border: 2px solid transparent;
      text-align: center;
      animation: fadeInUp 0.4s ease-out ${index * 0.05}s both;
      min-height: 120px;
      display: flex;
      flex-direction: column;
      justify-content: center;
    `;
    
    genreCard.addEventListener('mouseenter', () => {
      genreCard.style.background = `linear-gradient(135deg, ${category.color}15 0%, ${category.accent}08 100%)`;
      genreCard.style.borderColor = category.color + '60';
      genreCard.style.transform = 'translateY(-4px)';
      genreCard.style.boxShadow = `0 8px 20px ${category.color}30`;
    });
    
    genreCard.addEventListener('mouseleave', () => {
      genreCard.style.background = 'linear-gradient(135deg, #1e1e1e 0%, #2a2a2a 100%)';
      genreCard.style.borderColor = 'transparent';
      genreCard.style.transform = 'translateY(0)';
      genreCard.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.3)';
    });
    
    // Genre name
    const nameDiv = document.createElement('div');
    nameDiv.textContent = genreName;
    nameDiv.style.cssText = `
      font-weight: bold;
      color: #fff;
      margin-bottom: 0.8rem;
      font-size: 1.1rem;
      line-height: 1.3;
    `;
    genreCard.appendChild(nameDiv);
    
    // Track count
    const countDiv = document.createElement('div');
    countDiv.textContent = `${genre.track_count} ${genre.track_count === 1 ? 'Track' : 'Tracks'}`;
    countDiv.style.cssText = `
      font-size: 0.85rem;
      color: ${category.color};
      background: ${category.color}20;
      padding: 0.3rem 0.8rem;
      border-radius: 15px;
      border: 1px solid ${category.color}40;
      display: inline-block;
    `;
    genreCard.appendChild(countDiv);
    
    // Click handler
    genreCard.addEventListener('click', async () => {
      handleNavigationActivity('genre');
      navigationState.level = 'artists_in_genre';
      navigationState.currentGenre = genreName;
      updateBreadcrumb();
      renderGenreArtists(genreName);
    });
    
    genresContainer.appendChild(genreCard);
  });
  
  libraryListEl.appendChild(genresContainer);
}

async function renderGenreArtists(genreName) {
  try {
    libraryGridEl.classList.add('hidden');
    libraryListEl.classList.remove('hidden');
    const loadingText = (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.messages.loadingArtistsGeneric') : 'Lade Künstler...';
    libraryListEl.innerHTML = `<div class="loading">${loadingText}</div>`;
    
    // Hide A-Z navigation in genre context
    const azNav = document.getElementById('azNav');
    if (azNav) azNav.style.display = 'none';
    
    // Get tracks for this genre and extract unique artists
    const tracksResponse = await musicAPI.getTracks({ genre: genreName });
    const tracks = tracksResponse.data || tracksResponse;
    
    // Group by artist
    const artistTracks = {};
    tracks.forEach(track => {
      const artist = track.artist || ((typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.messages.unknownArtist') : 'Unbekannter Künstler');
      if (!artistTracks[artist]) {
        artistTracks[artist] = [];
      }
      artistTracks[artist].push(track);
    });
    
    const artists = Object.keys(artistTracks).sort();
    
    // No A-Z filtering for genre artists view
    let filteredArtists = artists;
    
    libraryListEl.innerHTML = '';
    
    // Artists container exactly like in renderArtistsList
    const artistsContainer = document.createElement('div');
    artistsContainer.style.cssText = `
      display: flex;
      flex-wrap: wrap;
      gap: 1rem;
      margin-bottom: 2rem;
      padding: 0;
    `;
    
    // Artists cards with exact same styling as main artists view
    filteredArtists.forEach(artistName => {
      const trackCount = artistTracks[artistName].length;
      
      const artistCard = document.createElement('div');
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
      
      // Artist avatar container (with mosaic cover) - exact same as original
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
      const artistCoverUrl = `http://localhost:3001/api/artist-cover/${encodeURIComponent(artistName)}`;
      
      const avatarImg = document.createElement('img');
      avatarImg.style.cssText = `
        width: 100%;
        height: 100%;
        object-fit: cover;
        border-radius: 0.3rem;
      `;
      avatarImg.src = artistCoverUrl;
      
      // Fallback icon if image fails to load
      const avatarIcon = document.createElement('span');
      avatarIcon.textContent = '👤';
      avatarIcon.style.cssText = `
        font-size: 3rem;
        color: #fff;
        text-shadow: 0 0 10px rgba(255, 255, 255, 0.3);
        display: none;
      `;
      
      avatarImg.onerror = () => {
        avatarImg.style.display = 'none';
        avatarIcon.style.display = 'block';
      };
      
      avatarContainer.appendChild(avatarImg);
      avatarContainer.appendChild(avatarIcon);
      artistCard.appendChild(avatarContainer);
      
      // Artist name
      const nameDiv = document.createElement('div');
      nameDiv.textContent = artistName;
      nameDiv.style.cssText = `
        font-weight: bold;
        color: #fff;
        margin-bottom: 0.3rem;
        font-size: 0.9rem;
        line-height: 1.2;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      `;
      artistCard.appendChild(nameDiv);
      
      // Track count
      const countDiv = document.createElement('div');
      countDiv.textContent = `${trackCount} ${trackCount === 1 ? 'Track' : 'Tracks'}`;
      countDiv.style.cssText = `
        color: #999;
        font-size: 0.75rem;
      `;
      artistCard.appendChild(countDiv);
      
      // Click handler
      artistCard.addEventListener('click', () => {
        handleNavigationActivity('artist');
        // Navigation state for genre -> artist -> tracks
        navigationState.level = 'tracks_in_genre_artist';
        navigationState.currentArtist = artistName;
        updateBreadcrumb();
        renderGenreTracks(genreName, artistName);
      });
      
      artistsContainer.appendChild(artistCard);
    });
    
    libraryListEl.appendChild(artistsContainer);
    
    if (artists.length === 0) {
      const noResultsDiv = document.createElement('div');
      noResultsDiv.innerHTML = `
        <div style="
          text-align: center;
          padding: 3rem;
          color: #666;
          font-size: 1.2rem;
        ">
          <div style="font-size: 3rem; margin-bottom: 1rem;">🎤</div>
          <div>Keine Künstler für "${genreName}" gefunden</div>
          <div style="font-size: 0.9rem; margin-top: 0.5rem; color: #999;">
            Versuche ein anderes Genre
          </div>
        </div>
      `;
      noResultsDiv.style.cssText = `
        background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%);
        border-radius: 12px;
        border: 1px solid #333;
        margin: 2rem 0;
      `;
      libraryListEl.appendChild(noResultsDiv);
    }
    
  } catch (error) {
    debugLog('LIBRARY', 'Error loading genre artists:', error);
    libraryListEl.innerHTML = `
      <div style="
        text-align: center;
        padding: 3rem;
        color: #ff6b6b;
        background: linear-gradient(135deg, #1a1a1a 0%, #2d1a1a 100%);
        border-radius: 12px;
        border: 1px solid #ff6b6b40;
        margin: 2rem 0;
      ">
        <div style="font-size: 3rem; margin-bottom: 1rem;">⚠️</div>
        <div style="font-size: 1.2rem; margin-bottom: 0.5rem;">Fehler beim Laden der Künstler</div>
        <div style="font-size: 0.9rem; color: #999;">${error.message}</div>
      </div>
    `;
  }
}

async function renderGenreTracks(genreName, artistName) {
  try {
    libraryGridEl.classList.add('hidden');
    libraryListEl.classList.remove('hidden');
    const loadingTracksText = (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.messages.loadingTracks') : 'Lade Tracks...';
    libraryListEl.innerHTML = `<div class="loading">${loadingTracksText}</div>`;
    
    // Get tracks for this genre and artist
    const tracksResponse = await musicAPI.getTracks({ genre: genreName, artist: artistName });
    const tracks = tracksResponse.data || tracksResponse;
    
    libraryListEl.innerHTML = '';
    
    // Tracks exactly like renderTracksList
    tracks.forEach((track, index) => {
      const li = document.createElement('li');
      const isRecent = isTrackRecentlyPlayed(track);
      const isInQueue = isTrackInQueue(track);
      
      li.style.padding = '0.8rem';
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
      const numberSpan = document.createElement('span');
      numberSpan.textContent = (index + 1).toString().padStart(2, '0');
      numberSpan.style.marginRight = '1rem';
      numberSpan.style.color = '#666';
      numberSpan.style.fontFamily = 'monospace';
      numberSpan.style.fontSize = '0.9rem';
      li.appendChild(numberSpan);
      
      // Track info
      const infoDiv = document.createElement('div');
      infoDiv.style.flex = '1';
      
      const titleDiv = document.createElement('div');
      titleDiv.textContent = track.title;
      titleDiv.style.fontWeight = 'bold';
      titleDiv.style.marginBottom = '0.2rem';
      infoDiv.appendChild(titleDiv);
      
      const detailsDiv = document.createElement('div');
      detailsDiv.textContent = `${track.artist} • ${track.album}`;
      detailsDiv.style.fontSize = '0.8rem';
      detailsDiv.style.color = '#999';
      infoDiv.appendChild(detailsDiv);
      
      li.appendChild(infoDiv);
      
      // Duration
      const durationSpan = document.createElement('span');
      const minutes = Math.floor(track.duration / 60);
      const seconds = Math.floor(track.duration % 60);
      durationSpan.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
      durationSpan.style.marginLeft = '1rem';
      durationSpan.style.color = '#666';
      durationSpan.style.fontSize = '0.9rem';
      li.appendChild(durationSpan);
      
      // Play button
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
      
      li.appendChild(playButton);
      
      // Original click logic with proper disabled/enabled handling
      if ((isRecent || isInQueue) && !isAdminMode) {
        li.addEventListener('click', (e) => {
          e.preventDefault();
          if (isInQueue) {
            if (typeof toast !== 'undefined') {
              toast.warning(`Dieser Titel ist bereits in der Playlist.`);
            } else {
              alert(`Dieser Titel ist bereits in der Playlist.`);
            }
          } else if (isRecent) {
            const now = Date.now();
            const oneHour = 60 * 60 * 1000;
            const playEntry = playedTracks.find(played => 
              (played.uri === (track.uri || null)) || (played.path === (track.path || null))
            );
            if (playEntry) {
              const remainingTime = Math.ceil((oneHour - (now - playEntry.timestamp)) / (60 * 1000));
              if (typeof toast !== 'undefined') {
                toast.info(`Dieser Titel wurde kürzlich gespielt. Bitte warte noch ${remainingTime} Minuten.`);
              } else {
                alert(`Dieser Titel wurde kürzlich gespielt. Bitte warte noch ${remainingTime} Minuten.`);
              }
            }
          }
        });
        // Disable play button for restricted tracks
        playButton.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (isInQueue) {
            if (typeof toast !== 'undefined') {
              toast.warning(`Dieser Titel ist bereits in der Playlist.`);
            } else {
              alert(`Dieser Titel ist bereits in der Playlist.`);
            }
          } else if (isRecent) {
            const now = Date.now();
            const oneHour = 60 * 60 * 1000;
            const playEntry = playedTracks.find(played => 
              (played.uri === (track.uri || null)) || (played.path === (track.path || null))
            );
            if (playEntry) {
              const remainingTime = Math.ceil((oneHour - (now - playEntry.timestamp)) / (60 * 1000));
              if (typeof toast !== 'undefined') {
                toast.info(`Dieser Titel wurde kürzlich gespielt. Bitte warte noch ${remainingTime} Minuten.`);
              } else {
                alert(`Dieser Titel wurde kürzlich gespielt. Bitte warte noch ${remainingTime} Minuten.`);
              }
            }
          }
        });
      } else {
        // Normal click handlers for enabled tracks
        playButton.addEventListener('click', (e) => {
          e.stopPropagation();
          const queueItem = {
            id: track.id,
            title: track.title,
            artist: track.artist,
            album: track.album,
            image: track.cover_path ? musicAPI.getCoverURL(track.id) : (track.image || 'assets/default_cover.png'),
            uri: null,
            path: track.file_path,
            source: 'server'
          };
          addToQueue(queueItem);
        });
        
        li.addEventListener('click', () => {
          const queueItem = {
            id: track.id,
            title: track.title,
            artist: track.artist,
            album: track.album,
            image: track.cover_path ? musicAPI.getCoverURL(track.id) : (track.image || 'assets/default_cover.png'),
            uri: null,
            path: track.file_path,
            source: 'server'
          };
          addToQueue(queueItem);
        });
      }
      
      libraryListEl.appendChild(li);
    });
    
    if (tracks.length === 0) {
      const noResultsDiv = document.createElement('div');
      noResultsDiv.innerHTML = `
        <div style="
          text-align: center;
          padding: 3rem;
          color: #666;
          font-size: 1.2rem;
        ">
          <div style="font-size: 3rem; margin-bottom: 1rem;">🎵</div>
          <div>Keine Tracks für "${artistName}" in "${genreName}" gefunden</div>
          <div style="font-size: 0.9rem; margin-top: 0.5rem; color: #999;">
            Versuche einen anderen Künstler oder ein anderes Genre
          </div>
        </div>
      `;
      noResultsDiv.style.cssText = `
        background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%);
        border-radius: 12px;
        border: 1px solid #333;
        margin: 2rem 0;
      `;
      libraryListEl.appendChild(noResultsDiv);
    }
    
  } catch (error) {
    debugLog('LIBRARY', 'Error loading genre tracks:', error);
    libraryListEl.innerHTML = `
      <div style="
        text-align: center;
        padding: 3rem;
        color: #ff6b6b;
        background: linear-gradient(135deg, #1a1a1a 0%, #2d1a1a 100%);
        border-radius: 12px;
        border: 1px solid #ff6b6b40;
        margin: 2rem 0;
      ">
        <div style="font-size: 3rem; margin-bottom: 1rem;">⚠️</div>
        <div style="font-size: 1.2rem; margin-bottom: 0.5rem;">Fehler beim Laden der Tracks</div>
        <div style="font-size: 0.9rem; color: #999;">${error.message}</div>
      </div>
    `;
  }
}

// Export functions globally for compatibility
window.renderGenresList = renderGenresList;
window.showGenreCategory = showGenreCategory;
window.renderGenreArtists = renderGenreArtists;
window.renderGenreTracks = renderGenreTracks;
