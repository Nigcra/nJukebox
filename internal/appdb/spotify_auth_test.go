// spotify_auth_test.go
// Checks the additive token schema migration against an old database
// Version: 2026.08.13

package appdb

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"
)

// oldSchema is the spotify_tokens table as it was before phase 6.
const oldSchema = `
CREATE TABLE spotify_tokens (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	access_token TEXT NOT NULL,
	token_type TEXT DEFAULT 'Bearer',
	expires_in INTEGER NOT NULL,
	refresh_token TEXT,
	scope TEXT,
	expires_at INTEGER NOT NULL,
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);`

// writeOldDatabase creates a database in the pre phase 6 shape holding one row.
func writeOldDatabase(t *testing.T) string {
	t.Helper()

	path := filepath.Join(t.TempDir(), "app.db")
	handle, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("create old database: %v", err)
	}
	defer handle.Close()

	if _, err := handle.Exec(oldSchema); err != nil {
		t.Fatalf("create old table: %v", err)
	}
	if _, err := handle.Exec(
		`INSERT INTO spotify_tokens (access_token, token_type, expires_in, refresh_token, scope, expires_at)
			VALUES (?, ?, ?, ?, ?, ?)`,
		"old-access", "Bearer", 3600, "old-refresh", "streaming", 1000,
	); err != nil {
		t.Fatalf("seed old row: %v", err)
	}
	return path
}

// TestMigrationOnOldDatabase: opening an old app.db adds the three columns and
// leaves the existing row intact and readable.
func TestMigrationOnOldDatabase(t *testing.T) {
	path := writeOldDatabase(t)
	ctx := context.Background()

	app, err := Open(path)
	if err != nil {
		t.Fatalf("open old database: %v", err)
	}
	defer app.Close()

	columns, err := app.tableColumns(ctx, "spotify_tokens")
	if err != nil {
		t.Fatalf("read columns: %v", err)
	}
	for _, column := range spotifyAuthColumns {
		if !columns[column.name] {
			t.Fatalf("column %s missing after the migration", column.name)
		}
	}

	// The deprecated endpoint reads the original columns and must not notice.
	tokens, err := app.GetSpotifyTokens(ctx)
	if err != nil {
		t.Fatalf("read old row: %v", err)
	}
	if tokens == nil || tokens.AccessToken != "old-access" {
		t.Fatal("the existing row is no longer readable")
	}
	if tokens.RefreshToken == nil || *tokens.RefreshToken != "old-refresh" {
		t.Fatal("the refresh token of the existing row was lost")
	}

	// The new reader has to work on the migrated row as well. refresh_token_valid
	// defaults to 1, so a row from before phase 6 counts as renewable.
	state, err := app.GetSpotifyAuth(ctx)
	if err != nil {
		t.Fatalf("read migrated row: %v", err)
	}
	if state == nil || !state.RefreshValid {
		t.Fatal("the migrated row is not marked as renewable")
	}
	if state.RefreshFailures != 0 || state.LastRefreshAt != 0 {
		t.Fatalf("unexpected defaults: failures=%d lastRefresh=%d", state.RefreshFailures, state.LastRefreshAt)
	}
}

// TestMigrationIsIdempotent: running it again changes nothing and does not fail.
func TestMigrationIsIdempotent(t *testing.T) {
	path := writeOldDatabase(t)
	ctx := context.Background()

	app, err := Open(path)
	if err != nil {
		t.Fatalf("open old database: %v", err)
	}
	defer app.Close()

	before, err := app.tableColumns(ctx, "spotify_tokens")
	if err != nil {
		t.Fatalf("read columns: %v", err)
	}

	for run := 0; run < 3; run++ {
		if err := app.MigrateSpotifyAuthSchema(ctx); err != nil {
			t.Fatalf("migration run %d: %v", run, err)
		}
	}

	after, err := app.tableColumns(ctx, "spotify_tokens")
	if err != nil {
		t.Fatalf("read columns after repeat: %v", err)
	}
	if len(before) != len(after) {
		t.Fatalf("column count changed from %d to %d", len(before), len(after))
	}

	tokens, err := app.GetSpotifyTokens(ctx)
	if err != nil || tokens == nil || tokens.AccessToken != "old-access" {
		t.Fatal("the row did not survive the repeated migration")
	}
}

// TestCleanupKeepsRowsWithRefreshToken is bug F: the daily cleanup used to throw
// away the refresh token together with the expired access token.
func TestCleanupKeepsRowsWithRefreshToken(t *testing.T) {
	ctx := context.Background()

	app, err := Open(filepath.Join(t.TempDir(), "app.db"))
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	defer app.Close()

	if err := app.SaveSpotifyAuth(ctx, SpotifyAuth{
		AccessToken:  "expired-access",
		TokenType:    "Bearer",
		ExpiresIn:    3600,
		RefreshToken: "still-good",
		ExpiresAt:    1000, // long past
		RefreshValid: true,
	}); err != nil {
		t.Fatalf("seed renewable row: %v", err)
	}

	removed, err := app.CleanupExpiredSpotifyTokens(ctx)
	if err != nil {
		t.Fatalf("cleanup: %v", err)
	}
	if removed != 0 {
		t.Fatalf("cleanup removed %d renewable row(s)", removed)
	}

	state, err := app.GetSpotifyAuth(ctx)
	if err != nil || state == nil || state.RefreshToken != "still-good" {
		t.Fatal("the refresh token did not survive the cleanup")
	}

	// A row without a refresh token is worthless once it expired and still goes.
	if err := app.SaveSpotifyAuth(ctx, SpotifyAuth{
		AccessToken: "expired-access",
		TokenType:   "Bearer",
		ExpiresIn:   3600,
		ExpiresAt:   1000,
	}); err != nil {
		t.Fatalf("seed dead row: %v", err)
	}

	removed, err = app.CleanupExpiredSpotifyTokens(ctx)
	if err != nil {
		t.Fatalf("cleanup of the dead row: %v", err)
	}
	if removed != 1 {
		t.Fatalf("expected one removed row, got %d", removed)
	}
}
