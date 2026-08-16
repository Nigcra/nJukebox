// db.go
// Opens app.db and applies the queue, session and settings schema
// Version: 2026.08.16

package appdb

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"sync"

	"github.com/Nigcra/nJukebox/internal/sqlitex"
)

// DB wraps the application database holding queue state, session data,
// Spotify tokens and settings.
type DB struct {
	// db is the writer, serialized to one connection. read is the reader pool.
	// The queue is polled while a track plays, and those reads must not wait
	// behind a queue save or a Spotify token rotation.
	db   *sql.DB
	read *sql.DB
	path string

	// settingsCache mirrors the settings table. It is guarded by a mutex, which
	// is what makes D1 impossible here: the Node version crashed the process
	// because a callback lost its "this" while touching this cache.
	settingsMu    sync.RWMutex
	settingsCache map[string]any
}

// Open connects to the database at path and makes sure the schema exists.
func Open(path string) (*DB, error) {
	handle, reader, err := sqlitex.Open(path)
	if err != nil {
		return nil, fmt.Errorf("app database: %w", err)
	}

	db := &DB{db: handle, read: reader, path: path, settingsCache: make(map[string]any)}

	fail := func(err error) (*DB, error) {
		handle.Close()
		reader.Close()
		return nil, err
	}

	if err := db.createTables(); err != nil {
		return fail(err)
	}
	// Additive and idempotent, see spotify_auth.go. An app.db created before
	// phase 6 gains the three token columns here and stays readable either way.
	if err := db.MigrateSpotifyAuthSchema(context.Background()); err != nil {
		return fail(err)
	}
	if err := db.RestoreCache(); err != nil {
		return fail(err)
	}

	log.Printf("[APP-DB] App database connected: %s", path)
	return db, nil
}

// Close releases both database handles.
func (a *DB) Close() error {
	if a.db == nil {
		return nil
	}
	err := a.db.Close()
	if a.read != nil {
		if rerr := a.read.Close(); err == nil {
			err = rerr
		}
	}
	return err
}

// Handle exposes the writer pool.
func (a *DB) Handle() *sql.DB { return a.db }

// schema is taken verbatim from lib/app_database.js.
const schema = `
CREATE TABLE IF NOT EXISTS queue_state (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	session_id TEXT NOT NULL,
	queue_data TEXT NOT NULL,
	current_track_index INTEGER DEFAULT 0,
	current_filter TEXT DEFAULT 'new',
	current_view TEXT DEFAULT 'list',
	current_az_filter TEXT DEFAULT 'all',
	played_tracks TEXT DEFAULT '[]',
	volume REAL DEFAULT 0.7,
	timestamp INTEGER NOT NULL,
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS queue_items (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	session_id TEXT NOT NULL,
	track_id INTEGER,
	track_data TEXT NOT NULL,
	position INTEGER NOT NULL,
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_queue_session ON queue_state(session_id);
CREATE INDEX IF NOT EXISTS idx_queue_items_session ON queue_items(session_id);

CREATE TABLE IF NOT EXISTS spotify_tokens (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	access_token TEXT NOT NULL,
	token_type TEXT DEFAULT 'Bearer',
	expires_in INTEGER NOT NULL,
	refresh_token TEXT,
	scope TEXT,
	expires_at INTEGER NOT NULL,
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS session_data (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	session_id TEXT UNIQUE NOT NULL,
	data TEXT NOT NULL,
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_session_id ON session_data(session_id);

CREATE TABLE IF NOT EXISTS settings (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	category TEXT NOT NULL,
	key TEXT NOT NULL,
	value TEXT NOT NULL,
	type TEXT DEFAULT 'string',
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_settings_category_key ON settings(category, key);
CREATE INDEX IF NOT EXISTS idx_settings_category ON settings(category);
`

func (a *DB) createTables() error {
	if _, err := a.db.Exec(schema); err != nil {
		return fmt.Errorf("create app database tables: %w", err)
	}
	return nil
}
