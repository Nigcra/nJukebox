// writes_session.go
// Write endpoints for Spotify tokens and per session state
// Version: 2026.08.13

package api

import (
	"math"
	"net/http"
	"time"

	"github.com/Nigcra/nJukebox/internal/appdb"
)

// spotifyTokenScope is the scope string the handler hardcoded.
const spotifyTokenScope = "streaming user-read-email user-read-private user-library-read " +
	"user-library-modify user-read-playback-state user-modify-playback-state"

const spotifyTokenType = "Bearer"

// sessionMessageResponse is the { success, message } shape all session write
// endpoints answer with.
type sessionMessageResponse struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
}

// handleSaveSessionSpotify stores the Spotify tokens the browser sends.
//
// Phase 6 replaces this endpoint with server side token handling; until then it
// stays as it was, bugs included.
func (s *Server) handleSaveSessionSpotify(w http.ResponseWriter, r *http.Request, _ map[string]string) {
	body, ok := decodeBody(r)
	if !ok {
		internalError(w)
		return
	}

	if !body.truthy("accessToken") {
		failPlain(w, http.StatusBadRequest, "Access token is required")
		return
	}

	accessToken, isText := body.text("accessToken")
	if !isText {
		accessToken = string(body.raw("accessToken"))
	}

	// tokenExpiry arrives as an absolute timestamp in milliseconds and is
	// converted to seconds from now.
	var expiresIn int64
	if expiry, ok := body.number("tokenExpiry"); ok {
		seconds := int64(math.Floor(expiry / 1000))
		expiresIn = seconds - time.Now().Unix()
		if expiresIn < 0 {
			expiresIn = 0
		}
	}

	tokenType := spotifyTokenType
	scope := spotifyTokenScope

	tokens := appdb.SpotifyTokens{
		AccessToken:  accessToken,
		TokenType:    &tokenType,
		ExpiresIn:    expiresIn,
		RefreshToken: body.optionalText("refreshToken"),
		Scope:        &scope,
	}

	if _, err := s.app.SaveSpotifyTokens(r.Context(), tokens); err != nil {
		failPlain(w, http.StatusInternalServerError, "Failed to save Spotify tokens")
		return
	}

	writeJSON(w, http.StatusOK, sessionMessageResponse{
		Success: true,
		Message: "Spotify tokens saved",
	})
}

// handleClearSessionSpotify removes every stored token row.
func (s *Server) handleClearSessionSpotify(w http.ResponseWriter, r *http.Request, _ map[string]string) {
	if _, err := s.app.ClearSpotifyTokens(r.Context()); err != nil {
		failPlain(w, http.StatusInternalServerError, "Failed to clear Spotify tokens")
		return
	}

	writeJSON(w, http.StatusOK, sessionMessageResponse{
		Success: true,
		Message: "Spotify tokens cleared",
	})
}

// handleSaveSessionApp stores an arbitrary blob under a session key.
//
// The handler reads req.body.sessionData, while the frontend and the golden
// catalog send { data: ... }. The property is therefore undefined, the insert
// binds NULL against a NOT NULL column and the answer is 500 - see
// w-session-app-set.txt. Sending sessionData does work.
func (s *Server) handleSaveSessionApp(w http.ResponseWriter, r *http.Request, params map[string]string) {
	body, ok := decodeBody(r)
	if !ok {
		internalError(w)
		return
	}

	var payload []byte
	if body.has("sessionData") {
		payload = body.raw("sessionData")
	}

	if _, err := s.app.SaveSessionDataRaw(r.Context(), params["sessionKey"], payload); err != nil {
		failPlain(w, http.StatusInternalServerError, "Failed to save app session")
		return
	}

	writeJSON(w, http.StatusOK, sessionMessageResponse{
		Success: true,
		Message: "App session saved",
	})
}

// handleDeleteSessionApp removes a stored blob.
func (s *Server) handleDeleteSessionApp(w http.ResponseWriter, r *http.Request, params map[string]string) {
	if _, err := s.app.DeleteSessionData(r.Context(), params["sessionKey"]); err != nil {
		failPlain(w, http.StatusInternalServerError, "Failed to delete app session")
		return
	}

	writeJSON(w, http.StatusOK, sessionMessageResponse{
		Success: true,
		Message: "App session deleted",
	})
}

// handleSaveSessionUI stores UI state. Same story as the app session: the
// handler reads stateData, the callers send state, so the blob is undefined and
// the NOT NULL column answers 500 (w-session-ui-set.txt).
func (s *Server) handleSaveSessionUI(w http.ResponseWriter, r *http.Request, params map[string]string) {
	body, ok := decodeBody(r)
	if !ok {
		internalError(w)
		return
	}

	var payload []byte
	if body.has("stateData") {
		payload = body.raw("stateData")
	}

	if _, err := s.app.SaveSessionDataRaw(r.Context(), params["stateKey"], payload); err != nil {
		failPlain(w, http.StatusInternalServerError, "Failed to save UI state")
		return
	}

	writeJSON(w, http.StatusOK, sessionMessageResponse{
		Success: true,
		Message: "UI state saved",
	})
}

// handleDeleteSessionUI deletes a stored UI state. This closes D4.
//
// The Node handler called appDB.deleteUIState(), a method that exists nowhere in
// lib/app_database.js. The TypeError was raised synchronously inside the try
// block, so the catch swallowed it and answered "Failed to delete UI state".
// The route answered 500 for every request and never deleted anything.
//
// GET and POST on the same key already use getSessionData and saveSessionData,
// so pointing DELETE at deleteSessionData is what the endpoint always meant to
// do. The corresponding request is marked as a known defect in the catalog and
// deviates from Node on purpose - see .claude/skills/security-fixes/NODE_DEFECTS.md (D4).
func (s *Server) handleDeleteSessionUI(w http.ResponseWriter, r *http.Request, params map[string]string) {
	if _, err := s.app.DeleteSessionData(r.Context(), params["stateKey"]); err != nil {
		failPlain(w, http.StatusInternalServerError, "Failed to delete UI state")
		return
	}

	writeJSON(w, http.StatusOK, sessionMessageResponse{
		Success: true,
		Message: "UI state deleted",
	})
}
