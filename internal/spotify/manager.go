// manager.go
// Server side Spotify token state: guaranteed valid tokens and proactive renewal
// Version: 2026.08.13

package spotify

import (
	"context"
	"errors"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/Nigcra/nJukebox/internal/appdb"
)

// Phase 6 timings.
//
// refreshBuffer is the remaining lifetime below which a token is renewed on
// access. It is deliberately the same five minutes the old frontend used, but
// without the upper bound that made the window unrecoverable once it was missed
// (bug E): an access token that expired hours ago is refreshed just the same.
const (
	refreshBuffer     = 5 * time.Minute
	proactiveInterval = 45 * time.Minute
	proactiveWindow   = 30 * time.Minute
	backgroundTimeout = 60 * time.Second
)

// Sentinel errors of this package.
var (
	// ErrNotConnected means there is no usable login: no row, no refresh token,
	// or a refresh token Spotify has rejected.
	ErrNotConnected = errors.New("spotify: not connected")

	// ErrNoClientID means the admin has not configured spotify.clientId yet.
	ErrNoClientID = errors.New("spotify: no client id configured")
)

// Token is what the API hands to the browser. It is always valid at the moment
// it is returned.
type Token struct {
	AccessToken string
	TokenType   string
	ExpiresAt   int64
	ExpiresIn   int64
	Scope       string
}

// Status is the connection state for the UI.
type Status struct {
	Connected bool
	ExpiresAt int64
	Scopes    []string
}

// Options configures a Manager. The zero value is the production setup.
type Options struct {
	// TokenURL overrides the Spotify accounts endpoint. Tests set it.
	TokenURL string

	// Interval is the period of the proactive refresh goroutine.
	Interval time.Duration

	// Now overrides the clock, again for tests.
	Now func() time.Time
}

// Manager owns the stored Spotify login.
//
// It is the single place that writes tokens. The browser only ever reads
// through it, which is what removes the whole class of bugs that came from
// three frontend code paths fighting over sessionStorage.
type Manager struct {
	app    *appdb.DB
	client *Client
	now    func() time.Time

	interval time.Duration

	// mu guards pending. The refresh itself runs outside the lock so a slow
	// network call does not block readers.
	mu      sync.Mutex
	pending *refreshCall

	startOnce sync.Once
	stopOnce  sync.Once
	started   bool
	stop      chan struct{}
	done      chan struct{}
}

// NewManager builds a manager on top of app.db.
func NewManager(app *appdb.DB, opts Options) *Manager {
	client := NewClient()
	if opts.TokenURL != "" {
		client.tokenURL = opts.TokenURL
	}

	now := opts.Now
	if now == nil {
		now = time.Now
	}

	interval := opts.Interval
	if interval <= 0 {
		interval = proactiveInterval
	}

	return &Manager{
		app:      app,
		client:   client,
		now:      now,
		interval: interval,
		stop:     make(chan struct{}),
		done:     make(chan struct{}),
	}
}

// Start launches the proactive refresh goroutine. It runs independently of any
// browser: no throttled tab, no closed window and no kiosk idle can stop it.
func (m *Manager) Start() {
	m.startOnce.Do(func() {
		m.mu.Lock()
		m.started = true
		m.mu.Unlock()
		go m.loop()
	})
}

// Stop ends the goroutine and waits for it. Calling it without a preceding
// Start is allowed and does nothing.
func (m *Manager) Stop() {
	m.mu.Lock()
	started := m.started
	m.mu.Unlock()
	if !started {
		return
	}

	m.stopOnce.Do(func() { close(m.stop) })
	<-m.done
}

func (m *Manager) loop() {
	defer close(m.done)

	ticker := time.NewTicker(m.interval)
	defer ticker.Stop()

	for {
		select {
		case <-m.stop:
			return
		case <-ticker.C:
			m.tick()
		}
	}
}

// tick renews the token when less than proactiveWindow is left. With the
// default 45 minute interval and Spotify's one hour lifetime that is every run.
func (m *Manager) tick() {
	ctx, cancel := context.WithTimeout(context.Background(), backgroundTimeout)
	defer cancel()

	state, err := m.app.GetSpotifyAuth(ctx)
	if err != nil {
		log.Printf("[SPOTIFY] Background refresh could not read the token state: %v", err)
		return
	}
	if state == nil || state.RefreshToken == "" || !state.RefreshValid {
		return
	}
	if m.remaining(*state) >= proactiveWindow {
		return
	}

	if _, err := m.refresh(ctx, proactiveWindow); err != nil {
		if errors.Is(err, ErrNotConnected) {
			return
		}
		log.Printf("[SPOTIFY] Background refresh failed: %v", err)
		return
	}
	log.Print("[SPOTIFY] Access token renewed in the background")
}

// Token returns an access token that is valid right now, refreshing on the way
// when less than refreshBuffer is left or the token has already expired.
func (m *Manager) Token(ctx context.Context) (Token, error) {
	state, err := m.app.GetSpotifyAuth(ctx)
	if err != nil {
		return Token{}, err
	}
	if state == nil {
		return Token{}, ErrNotConnected
	}

	if !m.needsRefresh(*state) {
		return tokenOf(*state), nil
	}

	if state.RefreshToken == "" || !state.RefreshValid {
		// Nothing to renew with. A token that is still valid is handed out
		// anyway - this is not a reason to delete anything.
		if !state.Expired(m.now()) {
			return tokenOf(*state), nil
		}
		return Token{}, ErrNotConnected
	}

	refreshed, err := m.refresh(ctx, refreshBuffer)
	if err != nil {
		return Token{}, err
	}
	return tokenOf(refreshed), nil
}

// Status reports the connection state without ever touching the network.
func (m *Manager) Status(ctx context.Context) (Status, error) {
	state, err := m.app.GetSpotifyAuth(ctx)
	if err != nil {
		return Status{}, err
	}
	if state == nil {
		return Status{Scopes: []string{}}, nil
	}

	// Connected means renewable, not "unexpired": an expired access token with a
	// working refresh token is a connected session.
	connected := state.RefreshToken != "" && state.RefreshValid
	if !connected && !state.Expired(m.now()) {
		connected = true
	}

	return Status{
		Connected: connected,
		ExpiresAt: state.ExpiresAt,
		Scopes:    splitScopes(state.Scope),
	}, nil
}

// Logout drops the stored login on purpose. This and a refusal by Spotify are
// the only two ways tokens ever leave the database.
func (m *Manager) Logout(ctx context.Context) error {
	if _, err := m.app.ClearSpotifyTokens(ctx); err != nil {
		return err
	}
	log.Print("[SPOTIFY] Stored login removed on request")
	return nil
}

// HandleCallback completes the PKCE login and stores the result.
func (m *Manager) HandleCallback(ctx context.Context, code, verifier, redirectURI string) (Token, error) {
	clientID, err := m.clientID(ctx)
	if err != nil {
		return Token{}, err
	}

	response, err := m.client.ExchangeCode(ctx, clientID, code, verifier, redirectURI)
	if err != nil {
		return Token{}, err
	}

	state := merge(appdb.SpotifyAuth{}, response, m.now())
	if err := m.app.SaveSpotifyAuth(ctx, state); err != nil {
		return Token{}, err
	}

	log.Printf("[SPOTIFY] Login stored, access token valid for %d seconds, refresh token present: %t",
		state.ExpiresIn, state.RefreshToken != "")
	return tokenOf(state), nil
}

// Adopt takes over a refresh token that is still lying around in the browser's
// localStorage (risk R3). It is verified against Spotify right away, so an
// unusable token never reaches the database.
func (m *Manager) Adopt(ctx context.Context, refreshToken string) (Token, error) {
	if strings.TrimSpace(refreshToken) == "" {
		return Token{}, ErrNotConnected
	}

	clientID, err := m.clientID(ctx)
	if err != nil {
		return Token{}, err
	}

	response, err := m.client.Refresh(ctx, clientID, refreshToken)
	if err != nil {
		return Token{}, err
	}

	state := merge(appdb.SpotifyAuth{RefreshToken: refreshToken}, response, m.now())
	if err := m.app.SaveSpotifyAuth(ctx, state); err != nil {
		return Token{}, err
	}

	log.Print("[SPOTIFY] Adopted a refresh token from the browser")
	return tokenOf(state), nil
}

// clientID reads spotify.clientId from the settings table.
func (m *Manager) clientID(ctx context.Context) (string, error) {
	value, err := m.app.GetSettingFromDB(ctx, "spotify", "clientId", nil)
	if err != nil {
		// The cache is the same source the rest of the server reads from.
		value = m.app.GetSetting("spotify", "clientId", nil)
	}

	text, ok := value.(string)
	if !ok || strings.TrimSpace(text) == "" {
		return "", ErrNoClientID
	}
	return strings.TrimSpace(text), nil
}

// remaining is the lifetime left on the access token. It goes negative once the
// token has expired, and that is deliberate: every threshold comparison in this
// package stays true afterwards, which is what makes the refresh window
// recoverable at all (bug E).
func (m *Manager) remaining(state appdb.SpotifyAuth) time.Duration {
	return time.Duration(state.ExpiresAt-m.now().Unix()) * time.Second
}

// needsRefresh is true once the remaining lifetime drops below the buffer.
func (m *Manager) needsRefresh(state appdb.SpotifyAuth) bool {
	return m.remaining(state) < refreshBuffer
}

func tokenOf(state appdb.SpotifyAuth) Token {
	tokenType := state.TokenType
	if tokenType == "" {
		tokenType = "Bearer"
	}
	return Token{
		AccessToken: state.AccessToken,
		TokenType:   tokenType,
		ExpiresAt:   state.ExpiresAt,
		ExpiresIn:   state.ExpiresIn,
		Scope:       state.Scope,
	}
}

func splitScopes(scope string) []string {
	scopes := strings.Fields(scope)
	if scopes == nil {
		return []string{}
	}
	return scopes
}
