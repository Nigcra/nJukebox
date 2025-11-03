// API and Cache module for Jukebox
// Provides data server communication and intelligent cover caching

// Intelligent cover image caching
class CoverCache {
  constructor() {
    if (typeof debugLog !== 'undefined') {
      debugLog('COVER', 'Cover-Cache initialized (using browser cache)');
    }
  }

  // Get cover URL - browser handles caching automatically
  getCover(type, id, artist = null, album = null) {
    // Generate consistent cover URL for content
    let imageUrl;
    const baseURL = window.musicAPI ? window.musicAPI.baseURL : 'http://127.0.0.1:3001';
    
    switch (type) {
      case 'track':
        imageUrl = `${baseURL}/api/cover/${id}`;
        break;
      case 'album':
        const albumKey = `${(artist || 'unknown').toLowerCase()}||${(album || 'unknown').toLowerCase()}`;
        imageUrl = `${baseURL}/api/album-cover/${encodeURIComponent(albumKey)}`;
        break;
      case 'artist':
        imageUrl = `${baseURL}/api/artist-cover/${encodeURIComponent(artist)}`;
        break;
      default:
        return 'assets/default_cover.png';
    }

    return imageUrl;
  }

  // Compatibility methods
  getStats() {
    return { cachingMethod: 'Browser Cache' };
  }

  clear() {
    // Browser manages the cache
  }
}

// Data Server API Client
class DataServerAPI {
  constructor(baseURL = 'http://127.0.0.1:3001') {
    this.baseURL = baseURL;
  }

  async fetch(endpoint, options = {}) {
    try {
      const response = await fetch(`${this.baseURL}${endpoint}`, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...options.headers
        }
      });
      
      if (!response.ok) {
        throw new Error(`API Error: ${response.status} ${response.statusText}`);
      }
      
      return await response.json();
    } catch (error) {
      debugLog('DATA-API', `Data Server API Error (${endpoint}):`, error);
      throw error;
    }
  }

  // Get all tracks with optional filtering
  async getTracks(filters = {}, forceRefresh = false) {
    const params = new URLSearchParams();
    if (filters.artist) params.append('artist', filters.artist);
    if (filters.album) params.append('album', filters.album);
    if (filters.genre) params.append('genre', filters.genre);
    if (filters.year) params.append('year', filters.year);
    if (filters.search) params.append('search', filters.search);
    if (filters.limit) params.append('limit', filters.limit);
    if (filters.offset) params.append('offset', filters.offset);
    if (forceRefresh) params.append('_', Date.now().toString());

    const queryString = params.toString();
    const endpoint = `/api/tracks${queryString ? '?' + queryString : ''}`;
    return await this.fetch(endpoint);
  }

  // Get single track
  async getTrack(id) {
    return await this.fetch(`/api/tracks/${id}`);
  }

  // Get audio stream URL
  getStreamURL(id) {
    return `${this.baseURL}/api/stream/${id}`;
  }

  // Get cover image URL
  getCoverURL(id) {
    return `${this.baseURL}/api/cover/${id}`;
  }

  // Get all artists
  async getArtists() {
    return await this.fetch('/api/artists');
  }

  // Get all albums
  async getAlbums(artist = null, forceRefresh = false) {
    const params = artist ? `?artist=${encodeURIComponent(artist)}` : '';
    const url = `/api/albums${params}${forceRefresh ? (params ? '&' : '?') + '_=' + Date.now() : ''}`;
    return await this.fetch(url);
  }

  // Get all genres
  async getGenres() {
    return await this.fetch('/api/genres');
  }

  // Get library statistics
  async getStats() {
    return await this.fetch('/api/stats');
  }

  // Trigger manual rescan
  async rescan() {
    return await this.fetch('/api/rescan', { method: 'POST' });
  }

  // Health check
  async health() {
    return await this.fetch('/api/health');
  }

  // Record track play for statistics
  async recordTrackPlay(trackId) {
    return await this.fetch(`/api/tracks/${trackId}/play`, { method: 'POST' });
  }

  // Record Spotify track play for statistics  
  async recordSpotifyPlay(spotifyId, trackData = null) {
    const requestData = {};
    if (trackData) {
      requestData.trackData = trackData;
    }
    
    const options = { method: 'POST' };
    if (Object.keys(requestData).length > 0) {
      options.headers = { 'Content-Type': 'application/json' };
      options.body = JSON.stringify(requestData);
    }
    
    return await this.fetch(`/api/spotify/${spotifyId}/play`, options);
  }

  // Get most played tracks
  async getMostPlayedTracks(limit = 10) {
    return await this.fetch(`/api/most-played?limit=${limit}`);
  }

  // Get play statistics
  async getPlayStats() {
    return await this.fetch('/api/play-stats');
  }
}

// Export to global scope for compatibility
if (typeof window !== 'undefined') {
  window.DataServerAPI = DataServerAPI;
  window.CoverCache = CoverCache;
  
  // Initialize global instances
  window.musicAPI = new DataServerAPI();
  window.coverCache = new CoverCache();
}

// ES6 exports removed for compatibility - classes are available globally via window object
