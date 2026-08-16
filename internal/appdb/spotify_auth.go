// spotify_auth.go
// Additive schema extension and accessors for server side Spotify token handling
// Version: 2026.08.13

package appdb

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

// SpotifyAuth is the full token state phase 6 works on. It covers the original
// columns plus the three added by MigrateSpotifyAuthSchema.
//
// The refresh token is the valuable half of this struct: it survives the access
// token by design, so it is only ever removed on an explicit logout or after
// Spotify rejected it with invalid_grant.
type SpotifyAuth struct {
	AccessToken     string
	TokenType       string
	RefreshToken    string
	Scope           string
	ExpiresIn       int64
	ExpiresAt       int64
	RefreshValid    bool
	LastRefreshAt   int64
	RefreshFailures int64
}

// Expired reports whether the access token is past its expiry.
func (s SpotifyAuth) Expired(now time.Time) bool {
	return s.ExpiresAt <= now.Unix()
}

// spotifyAuthColumns lists the columns added on top of the original schema.
// Every statement is additive, so an old app.db stays readable by the deprecated
// endpoints that only select the original columns.
var spotifyAuthColumns = []struct {
	name string
	ddl  string
}{
	{"refresh_token_valid", "ALTER TABLE spotify_tokens ADD COLUMN refresh_token_valid INTEGER DEFAULT 1"},
	{"last_refresh_at", "ALTER TABLE spotify_tokens ADD COLUMN last_refresh_at INTEGER"},
	{"refresh_failures", "ALTER TABLE spotify_tokens ADD COLUMN refresh_failures INTEGER DEFAULT 0"},
}

// MigrateSpotifyAuthSchema adds the phase 6 columns when they are missing.
//
// SQLite has no "ADD COLUMN IF NOT EXISTS", so the existing columns are read
// from PRAGMA table_info first. That makes the migration idempotent and lets it
// run on every start without a version table.
func (a *DB) MigrateSpotifyAuthSchema(ctx context.Context) error {
	existing, err := a.tableColumns(ctx, "spotify_tokens")
	if err != nil {
		return err
	}
	// A database that has not created the table yet needs no migration; the
	// schema in db.go already contains it.
	if len(existing) == 0 {
		return nil
	}

	for _, column := range spotifyAuthColumns {
		if existing[column.name] {
			continue
		}
		if _, err := a.db.ExecContext(ctx, column.ddl); err != nil {
			return fmt.Errorf("add column %s: %w", column.name, err)
		}
	}
	return nil
}

// tableColumns returns the column names of a table as a set.
func (a *DB) tableColumns(ctx context.Context, table string) (map[string]bool, error) {
	// The table name is a constant from this package, never user input.
	rows, err := a.read.QueryContext(ctx, "PRAGMA table_info("+table+")")
	if err != nil {
		return nil, fmt.Errorf("read schema of %s: %w", table, err)
	}
	defer rows.Close()

	columns := map[string]bool{}
	for rows.Next() {
		var (
			cid        int
			name       string
			columnType sql.NullString
			notNull    int
			dflt       sql.NullString
			primaryKey int
		)
		if err := rows.Scan(&cid, &name, &columnType, &notNull, &dflt, &primaryKey); err != nil {
			return nil, fmt.Errorf("scan schema of %s: %w", table, err)
		}
		columns[name] = true
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return columns, nil
}

// GetSpotifyAuth returns the current token state, or nil when nothing is stored.
func (a *DB) GetSpotifyAuth(ctx context.Context) (*SpotifyAuth, error) {
	const query = `SELECT access_token, token_type, expires_in, refresh_token, scope,
			expires_at, refresh_token_valid, last_refresh_at, refresh_failures
		FROM spotify_tokens
		ORDER BY created_at DESC, id DESC
		LIMIT 1`

	var (
		state        SpotifyAuth
		tokenType    sql.NullString
		refreshToken sql.NullString
		scope        sql.NullString
		refreshValid sql.NullInt64
		lastRefresh  sql.NullInt64
		failures     sql.NullInt64
	)

	err := a.read.QueryRowContext(ctx, query).Scan(
		&state.AccessToken, &tokenType, &state.ExpiresIn, &refreshToken, &scope,
		&state.ExpiresAt, &refreshValid, &lastRefresh, &failures,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get spotify auth: %w", err)
	}

	state.TokenType = tokenType.String
	state.RefreshToken = refreshToken.String
	state.Scope = scope.String
	// A row written before the migration has no flag; treat it as valid.
	state.RefreshValid = !refreshValid.Valid || refreshValid.Int64 != 0
	state.LastRefreshAt = lastRefresh.Int64
	state.RefreshFailures = failures.Int64

	return &state, nil
}

// SaveSpotifyAuth replaces the stored state in a single transaction.
//
// Atomicity is what closes bug G: Spotify rotates the refresh token on every
// PKCE refresh and invalidates the previous one, so a half written row would
// leave the database with a refresh token that no longer works.
func (a *DB) SaveSpotifyAuth(ctx context.Context, state SpotifyAuth) error {
	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin spotify auth write: %w", err)
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, "DELETE FROM spotify_tokens"); err != nil {
		return fmt.Errorf("clear spotify auth: %w", err)
	}

	const query = `INSERT INTO spotify_tokens (
			access_token, token_type, expires_in, refresh_token, scope, expires_at,
			refresh_token_valid, last_refresh_at, refresh_failures,
			created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`

	refreshValid := 0
	if state.RefreshValid {
		refreshValid = 1
	}

	var lastRefresh any
	if state.LastRefreshAt > 0 {
		lastRefresh = state.LastRefreshAt
	}

	if _, err := tx.ExecContext(ctx, query,
		state.AccessToken, nullableText(state.TokenType), state.ExpiresIn,
		nullableText(state.RefreshToken), nullableText(state.Scope), state.ExpiresAt,
		refreshValid, lastRefresh, state.RefreshFailures,
	); err != nil {
		return fmt.Errorf("save spotify auth: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit spotify auth write: %w", err)
	}
	return nil
}

// NoteSpotifyRefreshFailure counts a failed refresh attempt without touching the
// tokens. A network outage must never cost the refresh token.
func (a *DB) NoteSpotifyRefreshFailure(ctx context.Context) error {
	_, err := a.db.ExecContext(ctx,
		`UPDATE spotify_tokens
			SET refresh_failures = COALESCE(refresh_failures, 0) + 1,
				updated_at = CURRENT_TIMESTAMP`)
	if err != nil {
		return fmt.Errorf("count spotify refresh failure: %w", err)
	}
	return nil
}

// nullableText stores an empty string as NULL, which is what the original rows
// contained when a field was absent.
func nullableText(value string) any {
	if value == "" {
		return nil
	}
	return value
}
