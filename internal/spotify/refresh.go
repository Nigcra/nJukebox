// refresh.go
// Token renewal with rotation, mutex guarded single flight and atomic persistence
// Version: 2026.08.13

package spotify

import (
	"context"
	"log"
	"time"

	"github.com/Nigcra/nJukebox/internal/appdb"
)

// refreshCall is one in flight renewal. Everyone who arrives while it runs waits
// for its result instead of starting a second one - ten browser tabs asking for
// a token at the same moment must not send ten refresh requests, because
// Spotify rotates the refresh token and would invalidate all but one of them.
type refreshCall struct {
	done  chan struct{}
	state appdb.SpotifyAuth
	err   error
}

// refresh renews the access token, at most once at a time. minRemaining is the
// lifetime below which the renewal is due: five minutes for a browser asking
// for a token, half an hour for the proactive goroutine.
func (m *Manager) refresh(ctx context.Context, minRemaining time.Duration) (appdb.SpotifyAuth, error) {
	m.mu.Lock()
	if call := m.pending; call != nil {
		m.mu.Unlock()
		select {
		case <-call.done:
			return call.state, call.err
		case <-ctx.Done():
			return appdb.SpotifyAuth{}, ctx.Err()
		}
	}

	call := &refreshCall{done: make(chan struct{})}
	m.pending = call
	m.mu.Unlock()

	// The leader must not inherit the caller's cancellation: a browser that
	// walks away mid request would otherwise abort a renewal several other
	// callers are waiting for, and could leave a rotated token unsaved.
	leaderCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), backgroundTimeout)
	call.state, call.err = m.refreshOnce(leaderCtx, minRemaining)
	cancel()

	m.mu.Lock()
	m.pending = nil
	m.mu.Unlock()

	close(call.done)
	return call.state, call.err
}

// refreshOnce performs the actual renewal. It re-reads the state first, so a
// caller that queued behind a finished refresh never sends the rotated - and by
// then invalid - predecessor.
func (m *Manager) refreshOnce(ctx context.Context, minRemaining time.Duration) (appdb.SpotifyAuth, error) {
	state, err := m.app.GetSpotifyAuth(ctx)
	if err != nil {
		return appdb.SpotifyAuth{}, err
	}
	if state == nil || state.RefreshToken == "" || !state.RefreshValid {
		return appdb.SpotifyAuth{}, ErrNotConnected
	}
	if m.remaining(*state) >= minRemaining {
		// Somebody renewed while this call was queueing.
		return *state, nil
	}

	clientID, err := m.clientID(ctx)
	if err != nil {
		// No client id is a configuration problem, not a broken login. The
		// refresh token stays exactly where it is.
		return appdb.SpotifyAuth{}, err
	}

	response, err := m.client.Refresh(ctx, clientID, state.RefreshToken)
	if err != nil {
		if IsInvalidGrant(err) {
			// The only case in which tokens are deleted: Spotify says the
			// refresh token itself is dead, so keeping it would only produce an
			// endless retry loop. One clean logout, then ErrNotConnected for
			// every later call because the row is gone.
			if _, clearErr := m.app.ClearSpotifyTokens(ctx); clearErr != nil {
				log.Printf("[SPOTIFY] Could not remove the rejected login: %v", clearErr)
			}
			log.Print("[SPOTIFY] Refresh token rejected (invalid_grant), stored login removed - a new login is required")
			return appdb.SpotifyAuth{}, err
		}

		// Everything else - network, DNS, 5xx, rate limit - is temporary. Count
		// it and try again later with the same refresh token.
		if noteErr := m.app.NoteSpotifyRefreshFailure(ctx); noteErr != nil {
			log.Printf("[SPOTIFY] Could not record the failed refresh: %v", noteErr)
		}
		return appdb.SpotifyAuth{}, err
	}

	next := merge(*state, response, m.now())
	if err := m.app.SaveSpotifyAuth(ctx, next); err != nil {
		return appdb.SpotifyAuth{}, err
	}

	if next.RefreshToken != state.RefreshToken {
		log.Print("[SPOTIFY] Access token renewed, rotated refresh token stored")
	} else {
		log.Print("[SPOTIFY] Access token renewed")
	}
	return next, nil
}

// merge folds a token response into the stored state.
//
// Rotation is handled here: Spotify sends a new refresh token with most PKCE
// refreshes and invalidates the old one, but not with every single response. An
// empty field therefore means "keep the previous one", never "clear it".
func merge(previous appdb.SpotifyAuth, response *TokenResponse, now time.Time) appdb.SpotifyAuth {
	next := previous

	next.AccessToken = response.AccessToken
	if response.TokenType != "" {
		next.TokenType = response.TokenType
	}
	if next.TokenType == "" {
		next.TokenType = "Bearer"
	}

	expiresIn := response.ExpiresIn
	if expiresIn <= 0 {
		expiresIn = defaultExpiresIn
	}
	next.ExpiresIn = expiresIn
	next.ExpiresAt = now.Unix() + expiresIn

	if response.RefreshToken != "" {
		next.RefreshToken = response.RefreshToken
	}
	if response.Scope != "" {
		next.Scope = response.Scope
	}

	next.RefreshValid = true
	next.LastRefreshAt = now.Unix()
	next.RefreshFailures = 0

	return next
}
