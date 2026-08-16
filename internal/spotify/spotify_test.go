// spotify_test.go
// Token handling against a simulated Spotify accounts endpoint
// Version: 2026.08.13

package spotify

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/Nigcra/nJukebox/internal/appdb"
)

// The client id is a placeholder. Neither a real client id nor a real token
// ever appears in this repository.
const testClientID = "test-client-id"

// clock is a hand cranked time source, so a token can be aged without waiting.
type clock struct {
	mu sync.Mutex
	at time.Time
}

func newClock() *clock {
	return &clock{at: time.Date(2026, 8, 13, 12, 0, 0, 0, time.UTC)}
}

func (c *clock) now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.at
}

func (c *clock) advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.at = c.at.Add(d)
}

// fakeSpotify simulates accounts.spotify.com/api/token: code exchange, refresh
// with rotation and invalid_grant.
type fakeSpotify struct {
	server *httptest.Server

	mu        sync.Mutex
	exchanges int
	refreshes int
	issued    int
	// accepted holds the refresh tokens that still work. Rotation removes the
	// predecessor, exactly like Spotify does.
	accepted map[string]bool
	seen     []string
	delay    time.Duration
	// rejectAll answers every refresh with invalid_grant.
	rejectAll bool
	// offline answers every request with 503, which is a temporary failure.
	offline bool
}

func newFakeSpotify(t *testing.T) *fakeSpotify {
	t.Helper()

	fake := &fakeSpotify{accepted: map[string]bool{}}
	fake.server = httptest.NewServer(http.HandlerFunc(fake.serve))
	t.Cleanup(fake.server.Close)
	return fake
}

func (f *fakeSpotify) serve(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		http.Error(w, "bad form", http.StatusBadRequest)
		return
	}

	f.mu.Lock()
	delay := f.delay
	offline := f.offline
	f.mu.Unlock()

	if delay > 0 {
		time.Sleep(delay)
	}
	if offline {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}

	switch r.Form.Get("grant_type") {
	case "authorization_code":
		f.mu.Lock()
		f.exchanges++
		f.mu.Unlock()
		f.issue(w, "")
	case "refresh_token":
		sent := r.Form.Get("refresh_token")

		f.mu.Lock()
		f.refreshes++
		f.seen = append(f.seen, sent)
		rejected := f.rejectAll || !f.accepted[sent]
		if !rejected {
			// Rotation: the token that was just used stops working.
			delete(f.accepted, sent)
		}
		f.mu.Unlock()

		if rejected {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"error":"invalid_grant","error_description":"Refresh token revoked"}`))
			return
		}
		f.issue(w, sent)
	default:
		http.Error(w, "unsupported grant", http.StatusBadRequest)
	}
}

// issue writes a fresh token pair and remembers the new refresh token.
func (f *fakeSpotify) issue(w http.ResponseWriter, _ string) {
	f.mu.Lock()
	f.issued++
	number := f.issued
	refresh := fmt.Sprintf("refresh-%d", number)
	f.accepted[refresh] = true
	f.mu.Unlock()

	payload := TokenResponse{
		AccessToken:  fmt.Sprintf("access-%d", number),
		TokenType:    "Bearer",
		ExpiresIn:    3600,
		RefreshToken: refresh,
		Scope:        "streaming user-read-email user-modify-playback-state",
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(payload)
}

func (f *fakeSpotify) counts() (exchanges, refreshes int) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.exchanges, f.refreshes
}

// accept registers a refresh token as valid without going through a login.
func (f *fakeSpotify) accept(token string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.accepted[token] = true
}

// newTestManager wires a manager to a temporary app.db and the fake endpoint.
func newTestManager(t *testing.T, fake *fakeSpotify, c *clock) (*Manager, *appdb.DB) {
	t.Helper()

	app, err := appdb.Open(filepath.Join(t.TempDir(), "app.db"))
	if err != nil {
		t.Fatalf("open app database: %v", err)
	}
	t.Cleanup(func() { app.Close() })

	if err := app.SetSetting(context.Background(), "spotify", "clientId", testClientID, true); err != nil {
		t.Fatalf("store client id: %v", err)
	}

	manager := NewManager(app, Options{TokenURL: fake.server.URL, Now: c.now})
	return manager, app
}

// TestLoginRotatesRefreshToken is the core promise of phase 6: after three
// renewals the database holds a different refresh token than right after login,
// and every one of them was stored.
func TestLoginRotatesRefreshToken(t *testing.T) {
	fake := newFakeSpotify(t)
	c := newClock()
	manager, app := newTestManager(t, fake, c)
	ctx := context.Background()

	if _, err := manager.HandleCallback(ctx, "auth-code", "verifier", "http://localhost:5500/spotify_login.html"); err != nil {
		t.Fatalf("login: %v", err)
	}

	afterLogin, err := app.GetSpotifyAuth(ctx)
	if err != nil || afterLogin == nil {
		t.Fatalf("state after login: %v", err)
	}
	if afterLogin.RefreshToken == "" {
		t.Fatal("login stored no refresh token")
	}

	previous := afterLogin.RefreshToken
	for round := 1; round <= 3; round++ {
		// Let the access token run out, the way an hour of playback would.
		c.advance(61 * time.Minute)

		if _, err := manager.Token(ctx); err != nil {
			t.Fatalf("refresh %d: %v", round, err)
		}

		state, err := app.GetSpotifyAuth(ctx)
		if err != nil || state == nil {
			t.Fatalf("state after refresh %d: %v", round, err)
		}
		if state.RefreshToken == previous {
			t.Fatalf("refresh %d did not store the rotated refresh token", round)
		}
		if state.LastRefreshAt != c.now().Unix() {
			t.Fatalf("refresh %d did not record last_refresh_at", round)
		}
		previous = state.RefreshToken
	}

	if previous == afterLogin.RefreshToken {
		t.Fatal("refresh token in the database is still the one from the login")
	}

	if exchanges, refreshes := fake.counts(); exchanges != 1 || refreshes != 3 {
		t.Fatalf("expected 1 exchange and 3 refreshes, got %d and %d", exchanges, refreshes)
	}
}

// TestExpiredTokenIsRefreshedNotDeleted covers bugs A and E: an access token
// that ran out hours ago is renewed, and the row survives.
func TestExpiredTokenIsRefreshedNotDeleted(t *testing.T) {
	fake := newFakeSpotify(t)
	c := newClock()
	manager, app := newTestManager(t, fake, c)
	ctx := context.Background()

	fake.accept("stored-refresh")
	seed := appdb.SpotifyAuth{
		AccessToken:  "stale-access",
		TokenType:    "Bearer",
		ExpiresIn:    3600,
		RefreshToken: "stored-refresh",
		Scope:        "streaming",
		// Nine hours ago: far outside the five minute window the old frontend
		// needed to hit, which is exactly the case that used to be unrecoverable.
		ExpiresAt:    c.now().Add(-9 * time.Hour).Unix(),
		RefreshValid: true,
	}
	if err := app.SaveSpotifyAuth(ctx, seed); err != nil {
		t.Fatalf("seed state: %v", err)
	}

	token, err := manager.Token(ctx)
	if err != nil {
		t.Fatalf("token after long expiry: %v", err)
	}
	if token.AccessToken == "stale-access" {
		t.Fatal("the stale access token was handed out unchanged")
	}
	if token.ExpiresAt <= c.now().Unix() {
		t.Fatal("the renewed token is already expired")
	}

	state, err := app.GetSpotifyAuth(ctx)
	if err != nil {
		t.Fatalf("state after refresh: %v", err)
	}
	if state == nil {
		t.Fatal("the token row was deleted instead of refreshed")
	}
	if state.RefreshToken == "" {
		t.Fatal("the refresh token was dropped")
	}
}

// TestInvalidGrantLogsOutOnce checks the one case in which tokens are removed,
// and that no retry loop follows it.
func TestInvalidGrantLogsOutOnce(t *testing.T) {
	fake := newFakeSpotify(t)
	c := newClock()
	manager, app := newTestManager(t, fake, c)
	ctx := context.Background()

	// A refresh token the endpoint does not know: this is what a rotated or
	// revoked token looks like from the outside.
	if err := app.SaveSpotifyAuth(ctx, appdb.SpotifyAuth{
		AccessToken:  "stale-access",
		TokenType:    "Bearer",
		ExpiresIn:    3600,
		RefreshToken: "revoked-refresh",
		ExpiresAt:    c.now().Add(-time.Hour).Unix(),
		RefreshValid: true,
	}); err != nil {
		t.Fatalf("seed state: %v", err)
	}

	_, err := manager.Token(ctx)
	if err == nil {
		t.Fatal("a revoked refresh token must not produce a token")
	}
	if !IsInvalidGrant(err) {
		t.Fatalf("expected invalid_grant, got %v", err)
	}

	state, err := app.GetSpotifyAuth(ctx)
	if err != nil {
		t.Fatalf("state after invalid_grant: %v", err)
	}
	if state != nil {
		t.Fatal("the rejected login was not removed")
	}

	// Every later call has to fail locally, without touching the network.
	for attempt := 0; attempt < 3; attempt++ {
		if _, err := manager.Token(ctx); err != ErrNotConnected {
			t.Fatalf("attempt %d: expected ErrNotConnected, got %v", attempt, err)
		}
	}

	if _, refreshes := fake.counts(); refreshes != 1 {
		t.Fatalf("expected exactly one refresh attempt, got %d", refreshes)
	}
}

// TestSingleFlight makes sure ten simultaneous readers trigger one renewal.
// More than one would rotate the refresh token several times and invalidate all
// but the last, which is how bug G killed the login for good.
func TestSingleFlight(t *testing.T) {
	fake := newFakeSpotify(t)
	c := newClock()
	manager, app := newTestManager(t, fake, c)
	ctx := context.Background()

	fake.accept("stored-refresh")
	fake.mu.Lock()
	fake.delay = 50 * time.Millisecond
	fake.mu.Unlock()

	if err := app.SaveSpotifyAuth(ctx, appdb.SpotifyAuth{
		AccessToken:  "stale-access",
		TokenType:    "Bearer",
		ExpiresIn:    3600,
		RefreshToken: "stored-refresh",
		ExpiresAt:    c.now().Add(-time.Minute).Unix(),
		RefreshValid: true,
	}); err != nil {
		t.Fatalf("seed state: %v", err)
	}

	const readers = 10
	start := make(chan struct{})
	tokens := make([]string, readers)
	errs := make([]error, readers)

	var wg sync.WaitGroup
	for i := 0; i < readers; i++ {
		wg.Add(1)
		go func(index int) {
			defer wg.Done()
			<-start
			token, err := manager.Token(ctx)
			tokens[index] = token.AccessToken
			errs[index] = err
		}(i)
	}

	close(start)
	wg.Wait()

	for i, err := range errs {
		if err != nil {
			t.Fatalf("reader %d failed: %v", i, err)
		}
		if tokens[i] != tokens[0] {
			t.Fatalf("reader %d got a different token than reader 0", i)
		}
	}

	if _, refreshes := fake.counts(); refreshes != 1 {
		t.Fatalf("expected exactly one refresh for %d readers, got %d", readers, refreshes)
	}
}

// TestTemporaryFailureKeepsRefreshToken covers the difference between "Spotify
// said no" and "Spotify was unreachable".
func TestTemporaryFailureKeepsRefreshToken(t *testing.T) {
	fake := newFakeSpotify(t)
	c := newClock()
	manager, app := newTestManager(t, fake, c)
	ctx := context.Background()

	fake.accept("stored-refresh")
	fake.mu.Lock()
	fake.offline = true
	fake.mu.Unlock()

	if err := app.SaveSpotifyAuth(ctx, appdb.SpotifyAuth{
		AccessToken:  "stale-access",
		TokenType:    "Bearer",
		ExpiresIn:    3600,
		RefreshToken: "stored-refresh",
		ExpiresAt:    c.now().Add(-time.Minute).Unix(),
		RefreshValid: true,
	}); err != nil {
		t.Fatalf("seed state: %v", err)
	}

	if _, err := manager.Token(ctx); err == nil {
		t.Fatal("an unreachable endpoint must not yield a token")
	}

	state, err := app.GetSpotifyAuth(ctx)
	if err != nil {
		t.Fatalf("state after outage: %v", err)
	}
	if state == nil || state.RefreshToken != "stored-refresh" {
		t.Fatal("a temporary failure cost the refresh token")
	}
	if state.RefreshFailures != 1 {
		t.Fatalf("expected one counted failure, got %d", state.RefreshFailures)
	}

	// Once the endpoint answers again, the same refresh token still works.
	fake.mu.Lock()
	fake.offline = false
	fake.mu.Unlock()

	if _, err := manager.Token(ctx); err != nil {
		t.Fatalf("recovery after outage: %v", err)
	}

	state, err = app.GetSpotifyAuth(ctx)
	if err != nil || state == nil {
		t.Fatalf("state after recovery: %v", err)
	}
	if state.RefreshFailures != 0 {
		t.Fatalf("failure counter was not reset, got %d", state.RefreshFailures)
	}
}

// TestMissingClientIDKeepsTokens: a configuration gap is not a broken login.
func TestMissingClientIDKeepsTokens(t *testing.T) {
	fake := newFakeSpotify(t)
	c := newClock()
	manager, app := newTestManager(t, fake, c)
	ctx := context.Background()

	if _, err := app.DeleteSetting(ctx, "spotify", "clientId"); err != nil {
		t.Fatalf("remove client id: %v", err)
	}
	if err := app.SaveSpotifyAuth(ctx, appdb.SpotifyAuth{
		AccessToken:  "stale-access",
		ExpiresIn:    3600,
		RefreshToken: "stored-refresh",
		ExpiresAt:    c.now().Add(-time.Minute).Unix(),
		RefreshValid: true,
	}); err != nil {
		t.Fatalf("seed state: %v", err)
	}

	if _, err := manager.Token(ctx); err != ErrNoClientID {
		t.Fatalf("expected ErrNoClientID, got %v", err)
	}

	state, err := app.GetSpotifyAuth(ctx)
	if err != nil || state == nil || state.RefreshToken != "stored-refresh" {
		t.Fatal("a missing client id cost the refresh token")
	}
	if _, refreshes := fake.counts(); refreshes != 0 {
		t.Fatalf("expected no request without a client id, got %d", refreshes)
	}
}

// TestAdoptMigratesBrowserRefreshToken covers risk R3.
func TestAdoptMigratesBrowserRefreshToken(t *testing.T) {
	fake := newFakeSpotify(t)
	c := newClock()
	manager, app := newTestManager(t, fake, c)
	ctx := context.Background()

	fake.accept("legacy-refresh")

	token, err := manager.Adopt(ctx, "legacy-refresh")
	if err != nil {
		t.Fatalf("adopt: %v", err)
	}
	if token.AccessToken == "" {
		t.Fatal("adopt returned no access token")
	}

	state, err := app.GetSpotifyAuth(ctx)
	if err != nil || state == nil {
		t.Fatalf("state after adopt: %v", err)
	}
	if state.RefreshToken == "legacy-refresh" {
		t.Fatal("adopt stored the old token instead of the rotated one")
	}

	// A token Spotify does not know must not end up in the database.
	if _, err := manager.Adopt(ctx, "made-up"); !IsInvalidGrant(err) {
		t.Fatalf("expected invalid_grant for an unknown token, got %v", err)
	}
}

// TestBackgroundRefreshRunsWithoutBrowser: the goroutine renews on its own, no
// open tab required. That is what makes a 24 hour kiosk run survive.
func TestBackgroundRefreshRunsWithoutBrowser(t *testing.T) {
	fake := newFakeSpotify(t)
	c := newClock()

	app, err := appdb.Open(filepath.Join(t.TempDir(), "app.db"))
	if err != nil {
		t.Fatalf("open app database: %v", err)
	}
	t.Cleanup(func() { app.Close() })

	if err := app.SetSetting(context.Background(), "spotify", "clientId", testClientID, true); err != nil {
		t.Fatalf("store client id: %v", err)
	}

	fake.accept("stored-refresh")
	if err := app.SaveSpotifyAuth(context.Background(), appdb.SpotifyAuth{
		AccessToken:  "stale-access",
		ExpiresIn:    3600,
		RefreshToken: "stored-refresh",
		// Ten minutes left, well inside the proactive window.
		ExpiresAt:    c.now().Add(10 * time.Minute).Unix(),
		RefreshValid: true,
	}); err != nil {
		t.Fatalf("seed state: %v", err)
	}

	manager := NewManager(app, Options{TokenURL: fake.server.URL, Now: c.now, Interval: 10 * time.Millisecond})
	manager.Start()
	defer manager.Stop()

	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		state, err := app.GetSpotifyAuth(context.Background())
		if err != nil {
			t.Fatalf("read state: %v", err)
		}
		if state != nil && state.AccessToken != "stale-access" {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("the background goroutine did not renew the token")
}

// TestStatusReportsRenewableSession: an expired access token with a working
// refresh token is a connected session, not a logged out one.
func TestStatusReportsRenewableSession(t *testing.T) {
	fake := newFakeSpotify(t)
	c := newClock()
	manager, app := newTestManager(t, fake, c)
	ctx := context.Background()

	status, err := manager.Status(ctx)
	if err != nil {
		t.Fatalf("status without login: %v", err)
	}
	if status.Connected || len(status.Scopes) != 0 {
		t.Fatal("status reported a connection without a login")
	}

	if err := app.SaveSpotifyAuth(ctx, appdb.SpotifyAuth{
		AccessToken:  "stale-access",
		ExpiresIn:    3600,
		RefreshToken: "stored-refresh",
		Scope:        "streaming user-modify-playback-state",
		ExpiresAt:    c.now().Add(-3 * time.Hour).Unix(),
		RefreshValid: true,
	}); err != nil {
		t.Fatalf("seed state: %v", err)
	}

	status, err = manager.Status(ctx)
	if err != nil {
		t.Fatalf("status with expired access token: %v", err)
	}
	if !status.Connected {
		t.Fatal("an expired access token with a refresh token must count as connected")
	}
	if len(status.Scopes) != 2 {
		t.Fatalf("expected two scopes, got %v", status.Scopes)
	}

	if err := manager.Logout(ctx); err != nil {
		t.Fatalf("logout: %v", err)
	}
	status, err = manager.Status(ctx)
	if err != nil {
		t.Fatalf("status after logout: %v", err)
	}
	if status.Connected {
		t.Fatal("status still reports a connection after the logout")
	}
}
