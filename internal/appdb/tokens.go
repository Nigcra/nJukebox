// tokens.go
// Spotify token rows in app.db
// Version: 2026.08.13

package appdb

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log"
	"time"
)

// SpotifyTokens mirrors one row of the spotify_tokens table. The column names
// are what GET /api/session/tokens returned raw, so the field names stay in
// snake_case (bug C in the plan came from reading them as camelCase).
type SpotifyTokens struct {
	AccessToken  string  `json:"access_token"`
	TokenType    *string `json:"token_type"`
	ExpiresIn    int64   `json:"expires_in"`
	RefreshToken *string `json:"refresh_token"`
	Scope        *string `json:"scope"`
	ExpiresAt    int64   `json:"expires_at"`
}

// SaveSpotifyTokens replaces the stored token row. expires_at is derived from
// the current time in seconds plus expires_in, like the original.
func (a *DB) SaveSpotifyTokens(ctx context.Context, t SpotifyTokens) (int64, error) {
	expiresAt := time.Now().Unix() + t.ExpiresIn

	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, fmt.Errorf("begin token write: %w", err)
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, "DELETE FROM spotify_tokens"); err != nil {
		return 0, fmt.Errorf("clear old spotify tokens: %w", err)
	}

	const query = `INSERT INTO spotify_tokens (
			access_token, token_type, expires_in, refresh_token,
			scope, expires_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`

	result, err := tx.ExecContext(ctx, query,
		t.AccessToken, t.TokenType, t.ExpiresIn, t.RefreshToken, t.Scope, expiresAt)
	if err != nil {
		return 0, fmt.Errorf("save spotify tokens: %w", err)
	}

	id, err := result.LastInsertId()
	if err != nil {
		return 0, err
	}
	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("commit token write: %w", err)
	}

	log.Print("Spotify tokens saved to database")
	return id, nil
}

// GetSpotifyTokens returns the most recent token row, or nil when there is none.
func (a *DB) GetSpotifyTokens(ctx context.Context) (*SpotifyTokens, error) {
	const query = `SELECT access_token, token_type, expires_in, refresh_token, scope, expires_at
		FROM spotify_tokens
		ORDER BY created_at DESC
		LIMIT 1`

	var t SpotifyTokens
	err := a.read.QueryRowContext(ctx, query).Scan(
		&t.AccessToken, &t.TokenType, &t.ExpiresIn, &t.RefreshToken, &t.Scope, &t.ExpiresAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get spotify tokens: %w", err)
	}
	return &t, nil
}

// ClearSpotifyTokens removes every token row.
func (a *DB) ClearSpotifyTokens(ctx context.Context) (int64, error) {
	result, err := a.db.ExecContext(ctx, "DELETE FROM spotify_tokens")
	if err != nil {
		return 0, fmt.Errorf("clear spotify tokens: %w", err)
	}
	return result.RowsAffected()
}

// CleanupExpiredSpotifyTokens deletes rows that cannot be renewed any more.
//
// This was bug F: expires_at is the expiry of the access token, one hour, so the
// daily cleanup threw away the refresh token with it. Phase 6 restricts the
// delete to rows without a refresh token - an expired access token is a reason
// to refresh, never a reason to delete. The route is not registered, so the
// golden baseline never observes this function.
func (a *DB) CleanupExpiredSpotifyTokens(ctx context.Context) (int64, error) {
	result, err := a.db.ExecContext(ctx,
		`DELETE FROM spotify_tokens
			WHERE expires_at < ? AND (refresh_token IS NULL OR refresh_token = '')`,
		time.Now().Unix())
	if err != nil {
		return 0, fmt.Errorf("cleanup expired spotify tokens: %w", err)
	}

	changes, err := result.RowsAffected()
	if err != nil {
		return 0, err
	}
	if changes > 0 {
		log.Printf("Cleaned up %d expired Spotify token(s)", changes)
	}
	return changes, nil
}
