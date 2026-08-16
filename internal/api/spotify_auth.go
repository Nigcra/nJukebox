// spotify_auth.go
// Phase 6 endpoints: server side Spotify login, token delivery and logout
// Version: 2026.08.13

package api

import (
	"errors"
	"log"
	"net/http"
	"strings"

	"github.com/Nigcra/nJukebox/internal/spotify"
)

// spotifyAuthAPI serves the endpoints that replaced the token juggling in the
// browser. The deprecated shims /api/session/spotify and /api/session/tokens
// stay untouched next to them.
type spotifyAuthAPI struct {
	manager *spotify.Manager
}

// RegisterSpotifyAuth adds the phase 6 routes to the router.
//
// The routes are prepended, and that matters: /api/spotify/auth/callback has
// four segments just like POST /api/spotify/:spotify_id/play, and
// DELETE /api/spotify/auth has three just like DELETE /api/spotify/:spotify_id.
// The router takes the first match, so a parameterized route registered earlier
// would swallow both. All five patterns here consist of fixed segments only, so
// putting them in front can never shadow an existing route.
func (s *Server) RegisterSpotifyAuth(manager *spotify.Manager) {
	auth := &spotifyAuthAPI{manager: manager}

	// The play handler needs the same manager to look up artist genres.
	s.spotify = manager
	s.spotifyClient = spotify.NewClient()
	s.genreCache = make(map[string]string)

	routes := []route{
		spotifyRoute(http.MethodPost, "/api/spotify/auth/callback", auth.handleCallback),
		spotifyRoute(http.MethodPost, "/api/spotify/auth/adopt", auth.handleAdopt),
		spotifyRoute(http.MethodGet, "/api/spotify/auth/status", auth.handleStatus),
		spotifyRoute(http.MethodDelete, "/api/spotify/auth", auth.handleLogout),
		spotifyRoute(http.MethodGet, "/api/spotify/token", auth.handleToken),
	}

	s.routes = append(routes, s.routes...)
}

func spotifyRoute(method, pattern string, handler handlerFunc) route {
	return route{
		method:   method,
		segments: strings.Split(strings.Trim(pattern, "/"), "/"),
		handler:  handler,
	}
}

// spotifyTokenResponse is the answer of GET /api/spotify/token. The token in it
// is guaranteed to be valid at the moment it was written.
type spotifyTokenResponse struct {
	Success     bool   `json:"success"`
	AccessToken string `json:"access_token"`
	TokenType   string `json:"token_type"`
	ExpiresIn   int64  `json:"expires_in"`
	ExpiresAt   int64  `json:"expires_at"`
	Scope       string `json:"scope"`
}

// spotifyStatusResponse is the answer of GET /api/spotify/auth/status.
type spotifyStatusResponse struct {
	Connected bool     `json:"connected"`
	ExpiresAt *int64   `json:"expiresAt"`
	Scopes    []string `json:"scopes"`
}

// spotifyConnectionResponse is the answer of the login, adopt and logout routes.
type spotifyConnectionResponse struct {
	Success   bool     `json:"success"`
	Connected bool     `json:"connected"`
	ExpiresAt *int64   `json:"expiresAt"`
	Scopes    []string `json:"scopes"`
}

// handleCallback completes the PKCE login: the browser sends the authorization
// code and its verifier, the server exchanges them and keeps both tokens.
func (a *spotifyAuthAPI) handleCallback(w http.ResponseWriter, r *http.Request, _ map[string]string) {
	body, ok := decodeBody(r)
	if !ok {
		internalError(w)
		return
	}

	code, _ := body.text("code")
	verifier, _ := body.text("code_verifier")
	redirectURI, _ := body.text("redirect_uri")

	if code == "" || verifier == "" {
		fail(w, http.StatusBadRequest, "code and code_verifier are required")
		return
	}
	if redirectURI == "" {
		fail(w, http.StatusBadRequest, "redirect_uri is required")
		return
	}

	token, err := a.manager.HandleCallback(r.Context(), code, verifier, redirectURI)
	if err != nil {
		writeSpotifyAuthError(w, "login", err)
		return
	}

	writeJSON(w, http.StatusOK, spotifyConnectionResponse{
		Success:   true,
		Connected: true,
		ExpiresAt: &token.ExpiresAt,
		Scopes:    strings.Fields(token.Scope),
	})
}

// handleAdopt takes over a refresh token that is still in the browser's
// localStorage from before phase 6 (risk R3). It is a one time migration.
func (a *spotifyAuthAPI) handleAdopt(w http.ResponseWriter, r *http.Request, _ map[string]string) {
	body, ok := decodeBody(r)
	if !ok {
		internalError(w)
		return
	}

	refreshToken, _ := body.text("refresh_token")
	if strings.TrimSpace(refreshToken) == "" {
		fail(w, http.StatusBadRequest, "refresh_token is required")
		return
	}

	token, err := a.manager.Adopt(r.Context(), refreshToken)
	if err != nil {
		writeSpotifyAuthError(w, "adopt", err)
		return
	}

	writeJSON(w, http.StatusOK, spotifyConnectionResponse{
		Success:   true,
		Connected: true,
		ExpiresAt: &token.ExpiresAt,
		Scopes:    strings.Fields(token.Scope),
	})
}

// handleToken hands out an access token that is valid right now. It renews
// transparently when less than five minutes are left - or when the token
// expired long ago, which used to be the moment the login was thrown away.
func (a *spotifyAuthAPI) handleToken(w http.ResponseWriter, r *http.Request, _ map[string]string) {
	token, err := a.manager.Token(r.Context())
	if err != nil {
		writeSpotifyAuthError(w, "token", err)
		return
	}

	writeJSON(w, http.StatusOK, spotifyTokenResponse{
		Success:     true,
		AccessToken: token.AccessToken,
		TokenType:   token.TokenType,
		ExpiresIn:   token.ExpiresIn,
		ExpiresAt:   token.ExpiresAt,
		Scope:       token.Scope,
	})
}

// handleStatus reports the connection state without contacting Spotify.
func (a *spotifyAuthAPI) handleStatus(w http.ResponseWriter, r *http.Request, _ map[string]string) {
	status, err := a.manager.Status(r.Context())
	if err != nil {
		log.Printf("[SPOTIFY] Status could not be read: %v", err)
		fail(w, http.StatusInternalServerError, "status_unavailable")
		return
	}

	response := spotifyStatusResponse{
		Connected: status.Connected,
		Scopes:    status.Scopes,
	}
	if status.Connected {
		expiresAt := status.ExpiresAt
		response.ExpiresAt = &expiresAt
	}

	writeJSON(w, http.StatusOK, response)
}

// handleLogout drops the stored login on purpose.
func (a *spotifyAuthAPI) handleLogout(w http.ResponseWriter, r *http.Request, _ map[string]string) {
	if err := a.manager.Logout(r.Context()); err != nil {
		log.Printf("[SPOTIFY] Logout failed: %v", err)
		fail(w, http.StatusInternalServerError, "logout_failed")
		return
	}

	writeJSON(w, http.StatusOK, spotifyConnectionResponse{
		Success:   true,
		Connected: false,
		ExpiresAt: nil,
		Scopes:    []string{},
	})
}

// writeSpotifyAuthError maps the manager errors onto stable codes the frontend
// can branch on. The error itself only ever goes to the server log - it may
// carry details that have no business in a browser.
func writeSpotifyAuthError(w http.ResponseWriter, stage string, err error) {
	switch {
	case errors.Is(err, spotify.ErrNotConnected):
		fail(w, http.StatusUnauthorized, "not_connected")
	case errors.Is(err, spotify.ErrNoClientID):
		fail(w, http.StatusServiceUnavailable, "no_client_id")
	case spotify.IsInvalidGrant(err):
		log.Printf("[SPOTIFY] %s rejected by Spotify: %v", stage, err)
		fail(w, http.StatusUnauthorized, "invalid_grant")
	default:
		log.Printf("[SPOTIFY] %s failed: %v", stage, err)
		fail(w, http.StatusBadGateway, "spotify_request_failed")
	}
}
