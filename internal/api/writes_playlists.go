// writes_playlists.go
// Write endpoints for the custom Spotify playlists
// Version: 2026.08.13

package api

import (
	"net/http"
	"strconv"
	"strings"
)

type playlistAddedResponse struct {
	Success bool  `json:"success"`
	ID      int64 `json:"id"`
}

type playlistSuccessResponse struct {
	Success bool `json:"success"`
}

type playlistClearedResponse struct {
	Success bool  `json:"success"`
	Deleted int64 `json:"deleted"`
}

// handleAddCustomPlaylist stores a Spotify playlist link.
//
// The duplicate check compares the untrimmed request values against the stored
// rows and only trims when inserting, so " Name " and "Name" are two different
// playlists. That is the original behaviour and it stays.
func (s *Server) handleAddCustomPlaylist(w http.ResponseWriter, r *http.Request, _ map[string]string) {
	body, ok := decodeBody(r)
	if !ok {
		internalError(w)
		return
	}

	if !body.truthy("name") || !body.truthy("url") {
		failPlain(w, http.StatusBadRequest, "Name and URL are required")
		return
	}

	name, nameIsText := body.text("name")
	url, urlIsText := body.text("url")
	if !nameIsText || !urlIsText {
		// url.includes() and name.trim() on a non string threw a TypeError,
		// which the catch of the handler turned into this answer.
		failPlain(w, http.StatusInternalServerError, "Internal server error")
		return
	}

	if !strings.Contains(url, "spotify.com/playlist/") &&
		!strings.Contains(url, "open.spotify.com/playlist/") {
		failPlain(w, http.StatusBadRequest, "Invalid Spotify playlist URL")
		return
	}

	existing, err := s.music.GetCustomPlaylists(r.Context())
	if err != nil {
		failPlain(w, http.StatusInternalServerError, "Internal server error")
		return
	}
	for _, playlist := range existing {
		if playlist.SpotifyURL == url || playlist.Name == name {
			failPlain(w, http.StatusBadRequest, "Playlist with this name or URL already exists")
			return
		}
	}

	id, err := s.music.AddCustomPlaylist(r.Context(), strings.TrimSpace(name), strings.TrimSpace(url))
	if err != nil {
		failPlain(w, http.StatusInternalServerError, "Internal server error")
		return
	}

	writeJSON(w, http.StatusOK, playlistAddedResponse{Success: true, ID: id})
}

// handleDeleteCustomPlaylist removes one playlist by id.
func (s *Server) handleDeleteCustomPlaylist(w http.ResponseWriter, r *http.Request, params map[string]string) {
	id, ok := jsParseInt(params["id"])
	if !ok {
		failPlain(w, http.StatusBadRequest, "Invalid playlist ID")
		return
	}

	deleted, err := s.music.DeleteCustomPlaylist(r.Context(), strconv.FormatInt(id, 10))
	if err != nil {
		failPlain(w, http.StatusInternalServerError, "Internal server error")
		return
	}
	if deleted == 0 {
		failPlain(w, http.StatusNotFound, "Playlist not found")
		return
	}

	writeJSON(w, http.StatusOK, playlistSuccessResponse{Success: true})
}

// handleClearCustomPlaylists removes every playlist.
func (s *Server) handleClearCustomPlaylists(w http.ResponseWriter, r *http.Request, _ map[string]string) {
	deleted, err := s.music.ClearCustomPlaylists(r.Context())
	if err != nil {
		failPlain(w, http.StatusInternalServerError, "Internal server error")
		return
	}

	writeJSON(w, http.StatusOK, playlistClearedResponse{Success: true, Deleted: deleted})
}
