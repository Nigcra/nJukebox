// ===== DECADE RENDERING FUNCTIONS =====
// Complete original functions from web_renderer.js extracted 1:1

async function renderDecadesList() {
  try {
    libraryGridEl.classList.add('hidden');
    libraryListEl.classList.remove('hidden');
    libraryListEl.innerHTML = '<div class="loading">Lade Jahrzehnte...</div>';
    
    // Get all tracks and group by decade
    const response = await musicAPI.getTracks();
    const tracks = response.data || response;
    
    // Reset navigation state
    navigationState.level = 'root';
    navigationState.currentArtist = null;
    navigationState.currentAlbum = null;
    updateBreadcrumb();
    
    // Note: A-Z filter is not applicable to decades list (years, not alphabetic names)
    
    // Group tracks by decade
    const decades = {};
    tracks.forEach(track => {
      if (track.year) {
        const decade = Math.floor(track.year / 10) * 10;
        const decadeKey = `${decade}s`;
        if (!decades[decadeKey]) {
          decades[decadeKey] = { 
            decade: decadeKey, 
            year_start: decade,
            tracks: [],
            artists: new Set(),
            albums: new Set()
          };
        }
        decades[decadeKey].tracks.push(track);
        decades[decadeKey].artists.add(track.artist);
        decades[decadeKey].albums.add(`${track.artist}||${track.album}`);
      }
    });
    
    // Decade styling configuration
    const decadeStyles = {
      '1950s': { 
        icon: '🎷', 
        color: '#8B4513', 
        accent: '#CD853F', 
        name: (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.labels.decade1950s') : 'Die Goldenen 50er', 
        desc: (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.labels.decade1950sDesc') : 'Rock \'n\' Roll & Jazz' 
      },
      '1960s': { 
        icon: '🌼', 
        color: '#9932CC', 
        accent: '#DA70D6', 
        name: (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.labels.decade1960s') : 'Die Swinging 60s', 
        desc: (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.labels.decade1960sDesc') : 'Beat & Psychedelic' 
      },
      '1970s': { 
        icon: '🕺', 
        color: '#FF8C00', 
        accent: '#FFA500', 
        name: (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.labels.decade1970s') : 'Die Groovigen 70er', 
        desc: (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.labels.decade1970sDesc') : 'Disco & Funk' 
      },
      '1980s': { 
        icon: '⚡', 
        color: '#FF1493', 
        accent: '#FF69B4', 
        name: (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.labels.decade1980s') : 'Die Elektrischen 80er', 
        desc: (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.labels.decade1980sDesc') : 'Synthpop & New Wave' 
      },
      '1990s': { 
        icon: '🎸', 
        color: '#32CD32', 
        accent: '#98FB98', 
        name: (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.labels.decade1990s') : 'Die Alternativen 90er', 
        desc: (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.labels.decade1990sDesc') : 'Grunge & Hip-Hop' 
      },
      '2000s': { 
        icon: '💿', 
        color: '#00CED1', 
        accent: '#48D1CC', 
        name: (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.labels.decade2000s') : 'Die Digitalen 2000er', 
        desc: (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.labels.decade2000sDesc') : 'Pop & R&B' 
      },
      '2010s': { 
        icon: '📱', 
        color: '#1DB954', 
        accent: '#1ED760', 
        name: (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.labels.decade2010s') : 'Die Streaming 2010er', 
        desc: (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.labels.decade2010sDesc') : 'EDM & Indie' 
      },
      '2020s': { 
        icon: '🎵', 
        color: '#FF6B6B', 
        accent: '#FF8E8E', 
        name: (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.labels.decade2020s') : 'Die Modernen 2020er', 
        desc: (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.labels.decade2020sDesc') : 'TikTok & Viral' 
      }
    };
    
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
        ">${(typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.labels.musicTimeline') : '🎼 Zeitreise durch die Musik'}</h2>
        <p style="
          margin: 0; 
          color: #999; 
          font-size: 1.1rem;
        ">${(typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.labels.decadesDescription') : 'Entdecke die Sounds vergangener Jahrzehnte'}</p>
      </div>
    `;
    
    // Sort decades
    const sortedDecades = Object.values(decades).sort((a, b) => a.year_start - b.year_start);
    
    sortedDecades.forEach((decade, index) => {
      const style = decadeStyles[decade.decade] || { 
        icon: '🎵', 
        color: '#666', 
        accent: '#999', 
        name: decade.decade, 
        desc: 'Musik aus dieser Zeit' 
      };
      
      const li = document.createElement('li');
      li.style.cssText = `
        padding: 1.5rem;
        margin-bottom: 1rem;
        background: linear-gradient(135deg, ${style.color}15 0%, ${style.accent}08 100%);
        border-radius: 16px;
        display: flex;
        align-items: center;
        cursor: pointer;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        border: 2px solid ${style.color}40;
        position: relative;
        overflow: hidden;
        animation: slideInFromLeft 0.6s ease-out ${index * 0.1}s both;
      `;
      
      // Add CSS animation keyframes if not already added
      if (!document.querySelector('#decadeAnimations')) {
        const styleSheet = document.createElement('style');
        styleSheet.id = 'decadeAnimations';
        styleSheet.textContent = `
          @keyframes slideInFromLeft {
            from {
              opacity: 0;
              transform: translateX(-50px);
            }
            to {
              opacity: 1;
              transform: translateX(0);
            }
          }
          @keyframes pulse {
            0%, 100% { transform: scale(1); }
            50% { transform: scale(1.05); }
          }
          .decade-glow {
            box-shadow: 0 0 30px ${style.color}60 !important;
            transform: translateY(-2px) !important;
          }
        `;
        document.head.appendChild(styleSheet);
      }
      
      li.addEventListener('mouseenter', () => {
        li.classList.add('decade-glow');
        li.style.background = `linear-gradient(135deg, ${style.color}25 0%, ${style.accent}15 100%)`;
        li.style.borderColor = style.color + '80';
      });
      
      li.addEventListener('mouseleave', () => {
        li.classList.remove('decade-glow');
        li.style.background = `linear-gradient(135deg, ${style.color}15 0%, ${style.accent}08 100%)`;
        li.style.borderColor = style.color + '40';
      });
      
      // Decorative background pattern
      const pattern = document.createElement('div');
      pattern.style.cssText = `
        position: absolute;
        top: 0;
        right: 0;
        width: 100px;
        height: 100%;
        background: linear-gradient(45deg, ${style.accent}10 25%, transparent 25%),
                    linear-gradient(-45deg, ${style.accent}10 25%, transparent 25%),
                    linear-gradient(45deg, transparent 75%, ${style.accent}10 75%),
                    linear-gradient(-45deg, transparent 75%, ${style.accent}10 75%);
        background-size: 20px 20px;
        opacity: 0.3;
        pointer-events: none;
      `;
      li.appendChild(pattern);
      
      // Icon container with animation
      const iconContainer = document.createElement('div');
      iconContainer.style.cssText = `
        background: ${style.color}30;
        border: 2px solid ${style.color};
        border-radius: 50%;
        width: 70px;
        height: 70px;
        display: flex;
        align-items: center;
        justify-content: center;
        margin-right: 1.5rem;
        font-size: 2rem;
        transition: all 0.3s ease;
        position: relative;
        z-index: 2;
      `;
      iconContainer.textContent = style.icon;
      
      li.addEventListener('mouseenter', () => {
        iconContainer.style.animation = 'pulse 1s infinite';
        iconContainer.style.background = style.color + '50';
      });
      
      li.addEventListener('mouseleave', () => {
        iconContainer.style.animation = 'none';
        iconContainer.style.background = style.color + '30';
      });
      
      li.appendChild(iconContainer);
      
      // Text content
      const textContainer = document.createElement('div');
      textContainer.style.cssText = `
        flex: 1;
        position: relative;
        z-index: 2;
      `;
      
      const nameSpan = document.createElement('div');
      nameSpan.textContent = style.name;
      nameSpan.style.cssText = `
        font-weight: bold;
        font-size: 1.4rem;
        margin-bottom: 0.3rem;
        color: ${style.color};
        text-shadow: 0 0 10px ${style.color}40;
      `;
      textContainer.appendChild(nameSpan);
      
      const descSpan = document.createElement('div');
      descSpan.textContent = style.desc;
      descSpan.style.cssText = `
        font-size: 0.9rem;
        color: #bbb;
        margin-bottom: 0.5rem;
        font-style: italic;
      `;
      textContainer.appendChild(descSpan);
      
      // Statistics
      const statsContainer = document.createElement('div');
      statsContainer.style.cssText = `
        display: flex;
        gap: 1rem;
        flex-wrap: wrap;
      `;
      
      const trackCount = document.createElement('span');
      trackCount.textContent = `🎵 ${decade.tracks.length} Songs`;
      trackCount.style.cssText = `
        font-size: 0.8rem;
        color: #999;
        background: rgba(255,255,255,0.1);
        padding: 0.2rem 0.5rem;
        border-radius: 12px;
        border: 1px solid rgba(255,255,255,0.2);
      `;
      statsContainer.appendChild(trackCount);
      
      const artistCount = document.createElement('span');
      const artistText = (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.labels.artists') : 'Künstler';
      artistCount.textContent = `👤 ${decade.artists.size} ${artistText}`;
      artistCount.style.cssText = `
        font-size: 0.8rem;
        color: #999;
        background: rgba(255,255,255,0.1);
        padding: 0.2rem 0.5rem;
        border-radius: 12px;
        border: 1px solid rgba(255,255,255,0.2);
      `;
      statsContainer.appendChild(artistCount);
      
      const albumCount = document.createElement('span');
      const albumText = (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.labels.albums') : 'Alben';
      albumCount.textContent = `💿 ${decade.albums.size} ${albumText}`;
      albumCount.style.cssText = `
        font-size: 0.8rem;
        color: #999;
        background: rgba(255,255,255,0.1);
        padding: 0.2rem 0.5rem;
        border-radius: 12px;
        border: 1px solid rgba(255,255,255,0.2);
      `;
      statsContainer.appendChild(albumCount);
      
      textContainer.appendChild(statsContainer);
      li.appendChild(textContainer);
      
      // Arrow indicator
      const arrow = document.createElement('div');
      arrow.style.cssText = `
        color: ${style.color};
        font-size: 1.5rem;
        transition: transform 0.3s ease;
        position: relative;
        z-index: 2;
      `;
      arrow.textContent = '→';
      
      li.addEventListener('mouseenter', () => {
        arrow.style.transform = 'translateX(5px)';
      });
      
      li.addEventListener('mouseleave', () => {
        arrow.style.transform = 'translateX(0)';
      });
      
      li.appendChild(arrow);
      
      li.addEventListener('click', () => {
        handleNavigationActivity('decade');
        navigationState.level = 'artists_in_decade';
        navigationState.currentDecade = decade.decade;
        navigationState.currentDecadeTracks = decade.tracks;
        updateBreadcrumb();
        renderDecadeArtists(decade.decade, decade.tracks);
      });
      
      libraryListEl.appendChild(li);
    });
    
    if (sortedDecades.length === 0) {
      const li = document.createElement('li');
      li.innerHTML = `
        <div style="
          text-align: center;
          padding: 3rem;
          color: #666;
          font-size: 1.2rem;
        ">
          <div style="font-size: 3rem; margin-bottom: 1rem;">🎵</div>
          <div>Keine Jahrzehnte gefunden</div>
          <div style="font-size: 0.9rem; margin-top: 0.5rem; color: #999;">
            Füge Musik mit Jahresangaben hinzu
          </div>
        </div>
      `;
      li.style.cssText = `
        background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%);
        border-radius: 12px;
        border: 1px solid #333;
      `;
      libraryListEl.appendChild(li);
    }
    
  } catch (error) {
    debugLog('LIBRARY', 'Error loading decades:', error);
    libraryListEl.innerHTML = `
      <div style="
        text-align: center;
        padding: 3rem;
        color: #ff6b6b;
        background: linear-gradient(135deg, #1a1a1a 0%, #2d1a1a 100%);
        border-radius: 12px;
        border: 1px solid #ff6b6b40;
      ">
        <div style="font-size: 3rem; margin-bottom: 1rem;">⚠️</div>
        <div style="font-size: 1.2rem; margin-bottom: 0.5rem;">Fehler beim Laden der Jahrzehnte</div>
        <div style="font-size: 0.9rem; color: #999;">${error.message}</div>
      </div>
    `;
  }
}

async function renderDecadeArtists(decadeName, tracks) {
  try {
    libraryGridEl.classList.add('hidden');
    libraryListEl.classList.remove('hidden');
    const loadingText = (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.messages.loadingArtists') : 'Lade Künstler...';
    libraryListEl.innerHTML = `<div class="loading">${loadingText}</div>`;
    
    // Hide A-Z navigation in decade context
    const azNav = document.getElementById('azNav');
    if (azNav) azNav.style.display = 'none';
    
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
    
    // No A-Z filtering for decade artists view
    let filteredArtists = artists;
    
    libraryListEl.innerHTML = '';
    
    // Decade theme colors
    const decadeThemes = {
      '1950s': { color: '#8B4513', accent: '#CD853F', icon: '🎷' },
      '1960s': { color: '#9932CC', accent: '#DA70D6', icon: '🌼' },
      '1970s': { color: '#FF8C00', accent: '#FFA500', icon: '🕺' },
      '1980s': { color: '#FF1493', accent: '#FF69B4', icon: '⚡' },
      '1990s': { color: '#32CD32', accent: '#98FB98', icon: '🎸' },
      '2000s': { color: '#00CED1', accent: '#48D1CC', icon: '💿' },
      '2010s': { color: '#1DB954', accent: '#1ED760', icon: '📱' },
      '2020s': { color: '#FF6B6B', accent: '#FF8E8E', icon: '🎵' }
    };
    
    const theme = decadeThemes[decadeName] || { color: '#1DB954', accent: '#1ED760', icon: '🎵' };
    
    // Unified header style matching other pages
    const headerDiv = document.createElement('div');
    headerDiv.style.cssText = `
      text-align: center; 
      padding: 2rem 1rem; 
      background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%);
      border-radius: 12px;
      margin-bottom: 2rem;
      border: 1px solid #333;
    `;
    
    const titleH2 = document.createElement('h2');
    titleH2.textContent = `${theme.icon} ${decadeName}`;
    titleH2.style.cssText = `
      margin: 0 0 0.5rem 0; 
      color: ${theme.color}; 
      font-size: 2.5rem;
      text-shadow: 0 0 20px ${theme.color}40;
    `;
    
    const subtitleP = document.createElement('p');
    subtitleP.textContent = `${filteredArtists.length} ${filteredArtists.length === 1 ? t('ui.labels.artist') : t('ui.labels.artists')} • ${tracks.length} ${tracks.length === 1 ? t('ui.labels.track') : t('ui.labels.tracks')}`;
    subtitleP.style.cssText = `
      margin: 0; 
      color: #999; 
      font-size: 1.1rem;
    `;
    
    headerDiv.appendChild(titleH2);
    headerDiv.appendChild(subtitleP);
    libraryListEl.appendChild(headerDiv);
    
    // Artists container exactly like in renderArtistsList
    const artistsContainer = document.createElement('div');
    artistsContainer.style.cssText = `
      display: flex;
      flex-wrap: wrap;
      gap: 1rem;
      margin-bottom: 2rem;
      padding: 0 1rem;
    `;
    
    // Artists cards with exact same styling as original
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
        artistCard.style.borderColor = theme.color;
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
        background: linear-gradient(135deg, ${theme.color}, ${theme.accent});
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
        color: white;
        display: none;
      `;
      
      // Handle image load success/failure
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
      
      // Artist name - exact same styling as original
      const nameDiv = document.createElement('div');
      nameDiv.textContent = artistName;
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
      
      // Track count - exact same styling as original
      const countDiv = document.createElement('div');
      countDiv.textContent = `${trackCount} ${trackCount === 1 ? 'Track' : 'Tracks'}`;
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
        navigationState.level = 'albums';
        navigationState.currentArtist = artistName;
        navigationState.currentAlbum = null;
        updateBreadcrumb();
        renderAlbumsList(artistName);
      });
      
      artistsContainer.appendChild(artistCard);
    });
    
    libraryListEl.appendChild(artistsContainer);
    
    if (filteredArtists.length === 0) {
      const noResultsDiv = document.createElement('div');
      const noResultsText = currentAZFilter === 'all' 
        ? (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.messages.noArtistsInDecade') : 'Keine Künstler in diesem Jahrzehnt gefunden'
        : (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.messages.noArtistsWithLetter').replace('{letter}', currentAZFilter) : `Keine Künstler gefunden, die mit "${currentAZFilter}" beginnen`;
      noResultsDiv.textContent = noResultsText;
      noResultsDiv.style.cssText = `
        padding: 2rem;
        text-align: center;
        color: #999;
      `;
      libraryListEl.appendChild(noResultsDiv);
    }
    
  } catch (error) {
    debugLog('LIBRARY', 'Error loading decade artists:', error);
    const errorText = (typeof window.i18nSystem !== 'undefined' && window.i18nSystem) ? window.i18nSystem.t('ui.messages.errorLoadingArtists') : 'Fehler beim Laden der Künstler';
    libraryListEl.innerHTML = `<div class="error">${errorText}</div>`;
  }
}

function renderDecadeTracks(decadeName, tracks) {
  // Get decade theme
  const decadeThemes = {
    '1950s': { color: '#8B4513', icon: '🎷' },
    '1960s': { color: '#9932CC', icon: '🌼' },
    '1970s': { color: '#FF8C00', icon: '🕺' },
    '1980s': { color: '#FF1493', icon: '⚡' },
    '1990s': { color: '#32CD32', icon: '🎸' },
    '2000s': { color: '#00CED1', icon: '💿' },
    '2010s': { color: '#1DB954', icon: '📱' },
    '2020s': { color: '#FF6B6B', icon: '🎵' }
  };
  
  const theme = decadeThemes[decadeName] || { color: '#1DB954', icon: '🎵' };
  
  libraryListEl.innerHTML = `<div style="
    text-align: center; 
    padding: 2rem 1rem; 
    background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%);
    border-radius: 12px;
    margin-bottom: 2rem;
    border: 1px solid #333;
  ">
    <h2 style="
      margin: 0 0 0.5rem 0; 
      color: ${theme.color}; 
      font-size: 2.5rem;
      text-shadow: 0 0 20px ${theme.color}40;
    ">${theme.icon} ${decadeName}</h2>
    <p style="
      margin: 0; 
      color: #999; 
      font-size: 1.1rem;
    ">${tracks.length} ${tracks.length === 1 ? 'Track' : 'Tracks'}</p>
  </div>`;
  
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
    
    // Year
    if (track.year) {
      const yearSpan = document.createElement('span');
      yearSpan.textContent = track.year.toString();
      yearSpan.style.marginRight = '0.8rem';
      yearSpan.style.color = '#999';
      yearSpan.style.fontSize = '0.9rem';
      yearSpan.style.minWidth = '3rem';
      li.appendChild(yearSpan);
    }
    
    // Cover or icon
    if (track.cover_path || track.image) {
      const img = document.createElement('img');
      img.src = track.cover_path ? musicAPI.getCoverURL(track.id) : track.image;
      img.style.width = '40px';
      img.style.height = '40px';
      img.style.objectFit = 'cover';
      img.style.borderRadius = '0.2rem';
      img.style.marginRight = '0.8rem';
      li.appendChild(img);
    } else {
      const iconSpan = document.createElement('span');
      iconSpan.textContent = '🎵';
      iconSpan.style.marginRight = '0.8rem';
      iconSpan.style.color = '#1DB954';
      li.appendChild(iconSpan);
    }
    
    const textContainer = document.createElement('div');
    textContainer.style.flex = '1';
    
    const titleSpan = document.createElement('div');
    titleSpan.textContent = track.title;
    titleSpan.style.fontWeight = 'bold';
    titleSpan.style.marginBottom = '0.2rem';
    textContainer.appendChild(titleSpan);
    
    const artistAlbumSpan = document.createElement('div');
    artistAlbumSpan.textContent = `${track.artist} • ${track.album}`;
    artistAlbumSpan.style.fontSize = '0.8rem';
    artistAlbumSpan.style.color = '#999';
    textContainer.appendChild(artistAlbumSpan);
    
    li.appendChild(textContainer);
    
    if (track.duration) {
      const durationSpan = document.createElement('span');
      const minutes = Math.floor(track.duration / 60);
      const seconds = Math.floor(track.duration % 60);
      durationSpan.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
      durationSpan.style.color = '#999';
      durationSpan.style.fontSize = '0.9rem';
      li.appendChild(durationSpan);
    }
    
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
    } else {
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
}

// Export functions globally for compatibility
window.renderDecadesList = renderDecadesList;
window.renderDecadeArtists = renderDecadeArtists;
window.renderDecadeTracks = renderDecadeTracks;
