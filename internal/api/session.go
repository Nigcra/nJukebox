// session.go
// Read endpoints for Spotify tokens and per session state
// Version: 2026.08.13

package api

import (
	"encoding/json"
	"net/http"

	"github.com/Nigcra/nJukebox/internal/appdb"
)

// sessionSpotifyResponse deliberately has no expiry field. The Node handler
// read tokens.tokenExpiry, which does not exist - the column is expires_at - so
// the value was undefined and JSON.stringify dropped the key entirely. That is
// bug C, and until phase 6 rewrites this endpoint the shape stays as it was.
type sessionSpotifyResponse struct {
	Success   bool `json:"success"`
	HasTokens bool `json:"hasTokens"`
}

func (s *Server) handleGetSessionSpotify(w http.ResponseWriter, r *http.Request, _ map[string]string) {
	tokens, err := s.app.GetSpotifyTokens(r.Context())
	if err != nil {
		failPlain(w, http.StatusInternalServerError, "Failed to get Spotify tokens")
		return
	}

	writeJSON(w, http.StatusOK, sessionSpotifyResponse{
		Success:   true,
		HasTokens: tokens != nil,
	})
}

type sessionTokensResponse struct {
	Success bool                 `json:"success"`
	Tokens  *appdb.SpotifyTokens `json:"tokens"`
}

func (s *Server) handleGetSessionTokens(w http.ResponseWriter, r *http.Request, _ map[string]string) {
	tokens, err := s.app.GetSpotifyTokens(r.Context())
	if err != nil {
		failPlain(w, http.StatusInternalServerError, "Failed to get tokens")
		return
	}
	writeJSON(w, http.StatusOK, sessionTokensResponse{Success: true, Tokens: tokens})
}

type sessionAppResponse struct {
	Success     bool            `json:"success"`
	SessionData json.RawMessage `json:"sessionData"`
}

func (s *Server) handleGetSessionApp(w http.ResponseWriter, r *http.Request, params map[string]string) {
	data, err := s.app.GetSessionData(r.Context(), params["sessionKey"])
	if err != nil {
		failPlain(w, http.StatusInternalServerError, "Failed to get app session")
		return
	}
	writeJSON(w, http.StatusOK, sessionAppResponse{Success: true, SessionData: nullRaw(data)})
}

type sessionUIResponse struct {
	Success   bool            `json:"success"`
	StateData json.RawMessage `json:"stateData"`
}

func (s *Server) handleGetSessionUI(w http.ResponseWriter, r *http.Request, params map[string]string) {
	data, err := s.app.GetSessionData(r.Context(), params["stateKey"])
	if err != nil {
		failPlain(w, http.StatusInternalServerError, "Failed to get UI state")
		return
	}
	writeJSON(w, http.StatusOK, sessionUIResponse{Success: true, StateData: nullRaw(data)})
}

// nullRaw makes an absent blob encode as null instead of breaking the encoder.
func nullRaw(data json.RawMessage) json.RawMessage {
	if len(data) == 0 {
		return json.RawMessage("null")
	}
	return data
}
