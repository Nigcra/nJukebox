// spotify_auth_test.go
// Route order and answers of the phase 6 Spotify endpoints
// Version: 2026.08.13

package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Nigcra/nJukebox/internal/spotify"
)

// fakeAccounts is a stand-in for accounts.spotify.com. It answers every grant
// with a fresh token pair; the detailed behaviour is covered in the tests of
// the spotify package.
func fakeAccounts(t *testing.T) *httptest.Server {
	t.Helper()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseForm(); err != nil {
			http.Error(w, "bad form", http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"access_token":  "test-access",
			"token_type":    "Bearer",
			"expires_in":    3600,
			"refresh_token": "test-refresh",
			"scope":         "streaming user-modify-playback-state",
		})
	}))
	t.Cleanup(server.Close)
	return server
}

// newSpotifyAuthServer builds an API server with the phase 6 routes registered.
func newSpotifyAuthServer(t *testing.T) *Server {
	t.Helper()

	s := newTestServer(t)
	accounts := fakeAccounts(t)

	// The client id is a placeholder; a real one never appears in tests.
	if err := s.app.SetSetting(context.Background(), "spotify", "clientId", "test-client-id", true); err != nil {
		t.Fatalf("store client id: %v", err)
	}

	s.RegisterSpotifyAuth(spotify.NewManager(s.app, spotify.Options{TokenURL: accounts.URL}))
	return s
}

func call(t *testing.T, s *Server, method, target, body string) *httptest.ResponseRecorder {
	t.Helper()

	recorder := httptest.NewRecorder()
	s.ServeHTTP(recorder, jsonRequest(method, target, body))
	return recorder
}

// TestSpotifyAuthFlow walks through login, token delivery, status and logout.
func TestSpotifyAuthFlow(t *testing.T) {
	s := newSpotifyAuthServer(t)

	// Without a login there is no token, and that is a 401 - not a 404 and not
	// a deleted row.
	if got := call(t, s, http.MethodGet, "/api/spotify/token", ""); got.Code != http.StatusUnauthorized {
		t.Fatalf("token without login: status = %d, want 401 (%s)", got.Code, got.Body.String())
	}

	login := call(t, s, http.MethodPost, "/api/spotify/auth/callback",
		`{"code":"auth-code","code_verifier":"verifier","redirect_uri":"http://localhost:5500/spotify_login.html"}`)
	if login.Code != http.StatusOK {
		t.Fatalf("callback: status = %d (%s)", login.Code, login.Body.String())
	}

	token := call(t, s, http.MethodGet, "/api/spotify/token", "")
	if token.Code != http.StatusOK {
		t.Fatalf("token: status = %d (%s)", token.Code, token.Body.String())
	}

	var payload struct {
		Success     bool   `json:"success"`
		AccessToken string `json:"access_token"`
		ExpiresAt   int64  `json:"expires_at"`
	}
	if err := json.Unmarshal(token.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode token answer: %v", err)
	}
	if !payload.Success || payload.AccessToken == "" || payload.ExpiresAt == 0 {
		t.Fatalf("incomplete token answer: %s", token.Body.String())
	}

	status := call(t, s, http.MethodGet, "/api/spotify/auth/status", "")
	if status.Code != http.StatusOK || !strings.Contains(status.Body.String(), `"connected":true`) {
		t.Fatalf("status after login: %d %s", status.Code, status.Body.String())
	}

	// The deprecated shim still answers, and still without a tokenExpiry field.
	shim := call(t, s, http.MethodGet, "/api/session/spotify", "")
	if shim.Code != http.StatusOK || shim.Body.String() != `{"success":true,"hasTokens":true}` {
		t.Fatalf("deprecated shim changed: %d %s", shim.Code, shim.Body.String())
	}

	logout := call(t, s, http.MethodDelete, "/api/spotify/auth", "")
	if logout.Code != http.StatusOK {
		t.Fatalf("logout: status = %d (%s)", logout.Code, logout.Body.String())
	}

	if got := call(t, s, http.MethodGet, "/api/spotify/token", ""); got.Code != http.StatusUnauthorized {
		t.Fatalf("token after logout: status = %d, want 401", got.Code)
	}
	if got := call(t, s, http.MethodGet, "/api/spotify/auth/status", ""); !strings.Contains(got.Body.String(), `"connected":false`) {
		t.Fatalf("status after logout: %s", got.Body.String())
	}
}

// TestSpotifyAuthRouteOrder is the reason the routes are prepended: they share
// their segment count with the parameterized library routes.
func TestSpotifyAuthRouteOrder(t *testing.T) {
	s := newSpotifyAuthServer(t)

	// Four segments, same shape as POST /api/spotify/:spotify_id/play.
	callback := call(t, s, http.MethodPost, "/api/spotify/auth/callback", `{}`)
	if callback.Code != http.StatusBadRequest {
		t.Fatalf("callback route was shadowed: status = %d (%s)", callback.Code, callback.Body.String())
	}
	if !strings.Contains(callback.Body.String(), "code_verifier") {
		t.Fatalf("callback did not answer: %s", callback.Body.String())
	}

	// Three segments, same shape as DELETE /api/spotify/:spotify_id.
	logout := call(t, s, http.MethodDelete, "/api/spotify/auth", "")
	if !strings.Contains(logout.Body.String(), `"connected":false`) {
		t.Fatalf("logout route was shadowed: %s", logout.Body.String())
	}

	// The library routes must keep working. Prepending cannot shadow them
	// because every phase 6 pattern consists of fixed segments.
	play := call(t, s, http.MethodPost, "/api/spotify/4uLU6hMCjMI75M1A2tKUQC/play", `{}`)
	if play.Code != http.StatusOK || !strings.Contains(play.Body.String(), `"spotifyId":"4uLU6hMCjMI75M1A2tKUQC"`) {
		t.Fatalf("play route broken: %d %s", play.Code, play.Body.String())
	}

	remove := call(t, s, http.MethodDelete, "/api/spotify/4uLU6hMCjMI75M1A2tKUQC", "")
	if remove.Code != http.StatusOK || !strings.Contains(remove.Body.String(), "removed from library") {
		t.Fatalf("remove route broken: %d %s", remove.Code, remove.Body.String())
	}

	// GET /api/spotify/tracks is a fixed route of the same length as
	// /api/spotify/token and must still reach the library handler.
	tracks := call(t, s, http.MethodGet, "/api/spotify/tracks", "")
	if tracks.Code != http.StatusOK || strings.Contains(tracks.Body.String(), "access_token") {
		t.Fatalf("tracks route broken: %d", tracks.Code)
	}
}

// TestPreflightReflectsRequestHeaders: the frontend runs on :5500 and this
// server on :3001, so a JSON POST and a DELETE are preflighted. Without the
// reflected Access-Control-Allow-Headers the browser drops the request before
// any handler sees it - cors() reflected them, and so does this server.
func TestPreflightReflectsRequestHeaders(t *testing.T) {
	s := newSpotifyAuthServer(t)

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodOptions, "/api/spotify/auth/callback", nil)
	request.Header.Set("Origin", "http://127.0.0.1:5500")
	request.Header.Set("Access-Control-Request-Method", "POST")
	request.Header.Set("Access-Control-Request-Headers", "content-type")
	s.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusNoContent {
		t.Fatalf("preflight status = %d, want 204", recorder.Code)
	}
	if got := recorder.Header().Get("Access-Control-Allow-Headers"); got != "content-type" {
		t.Fatalf("Access-Control-Allow-Headers = %q, want content-type", got)
	}
	if got := recorder.Header().Get("Access-Control-Allow-Origin"); got != "*" {
		t.Fatalf("Access-Control-Allow-Origin = %q, want *", got)
	}
	if got := recorder.Header().Get("Vary"); got != "Access-Control-Request-Headers" {
		t.Fatalf("Vary = %q, want Access-Control-Request-Headers", got)
	}
}

// TestSpotifyAdoptRequiresToken guards the R3 migration endpoint.
func TestSpotifyAdoptRequiresToken(t *testing.T) {
	s := newSpotifyAuthServer(t)

	empty := call(t, s, http.MethodPost, "/api/spotify/auth/adopt", `{"refresh_token":""}`)
	if empty.Code != http.StatusBadRequest {
		t.Fatalf("empty adopt: status = %d (%s)", empty.Code, empty.Body.String())
	}

	adopted := call(t, s, http.MethodPost, "/api/spotify/auth/adopt", `{"refresh_token":"legacy-refresh"}`)
	if adopted.Code != http.StatusOK || !strings.Contains(adopted.Body.String(), `"connected":true`) {
		t.Fatalf("adopt: %d %s", adopted.Code, adopted.Body.String())
	}

	if got := call(t, s, http.MethodGet, "/api/spotify/token", ""); got.Code != http.StatusOK {
		t.Fatalf("token after adopt: status = %d (%s)", got.Code, got.Body.String())
	}
}
