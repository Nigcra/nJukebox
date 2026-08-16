// spotify.go
// Read endpoints for stored Spotify tracks and custom playlists
// Version: 2026.08.13

package api

import (
	"net/http"
	"strconv"

	"github.com/Nigcra/nJukebox/internal/musicdb"
)

type spotifyTracksResponse struct {
	Success bool                   `json:"success"`
	Tracks  []musicdb.SpotifyTrack `json:"tracks"`
	Count   int                    `json:"count"`
}

func (s *Server) handleGetSpotifyTracks(w http.ResponseWriter, r *http.Request, _ map[string]string) {
	query := r.URL.Query()

	// Defaults are 50 and 0 here, and unlike getTracks both are always applied:
	// getSpotifyTracks appends LIMIT and OFFSET unconditionally.
	filters := musicdb.SpotifyTrackFilters{
		Limit:  intOrDefault(query.Get("limit"), "50"),
		Offset: intOrDefault(query.Get("offset"), "0"),
		Search: query.Get("search"),
	}

	tracks, err := s.music.GetSpotifyTracks(r.Context(), filters)
	if err != nil {
		fail(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, spotifyTracksResponse{
		Success: true,
		Tracks:  tracks,
		Count:   len(tracks),
	})
}

type customPlaylistsResponse struct {
	Playlists []musicdb.CustomPlaylist `json:"playlists"`
}

func (s *Server) handleGetCustomPlaylists(w http.ResponseWriter, r *http.Request, _ map[string]string) {
	playlists, err := s.music.GetCustomPlaylists(r.Context())
	if err != nil {
		failPlain(w, http.StatusInternalServerError, "Failed to get custom playlists")
		return
	}
	writeJSON(w, http.StatusOK, customPlaylistsResponse{Playlists: playlists})
}

// intOrDefault parses like parseInt and falls back to the default when the value
// is not a number. A zero stays zero here - it is passed to the query either way.
func intOrDefault(raw, fallback string) string {
	if raw == "" {
		return fallback
	}
	value, ok := jsParseInt(raw)
	if !ok {
		return fallback
	}
	return strconv.FormatInt(value, 10)
}
