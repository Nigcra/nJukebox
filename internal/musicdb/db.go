// db.go
// Opens music.db, applies the schema and runs the column migrations
// Version: 2026.08.16

package musicdb

import (
	"context"
	"database/sql"
	"fmt"
	"log"

	"github.com/Nigcra/nJukebox/internal/sqlitex"
)

// DB wraps the music library database.
type DB struct {
	// db is the writer, serialized to one connection. read is the reader pool.
	// Every Query and QueryRow goes through read, everything else through db.
	db   *sql.DB
	read *sql.DB
	path string

	// sessionID groups play history entries of one server run, like the Node
	// implementation did per process.
	sessionID string
}

// Open connects to the database at path, enables WAL mode and makes sure the
// schema and the migrations are in place. An existing database is used as is -
// the schema statements are all IF NOT EXISTS.
func Open(path string) (*DB, error) {
	// Writes keep the single serialized connection the Node server effectively
	// had. Reads get their own pool so a request never queues behind the
	// scanner's batch - see internal/sqlitex.
	handle, reader, err := sqlitex.Open(path)
	if err != nil {
		return nil, fmt.Errorf("music database: %w", err)
	}

	db := &DB{db: handle, read: reader, path: path}

	fail := func(err error) (*DB, error) {
		handle.Close()
		reader.Close()
		return nil, err
	}

	if err := db.createTables(); err != nil {
		return fail(err)
	}
	// Additive and idempotent, see missing.go. Holds the miss counters that
	// keep a single failed lookup from deleting anything.
	if err := db.createMissingTable(); err != nil {
		return fail(err)
	}
	if err := db.runMigrations(); err != nil {
		return fail(err)
	}

	return db, nil
}

// Close releases both database handles.
func (d *DB) Close() error {
	if d.db == nil {
		return nil
	}
	err := d.db.Close()
	if d.read != nil {
		if rerr := d.read.Close(); err == nil {
			err = rerr
		}
	}
	return err
}

// Handle exposes the writer pool for the few places that need raw access.
func (d *DB) Handle() *sql.DB { return d.db }

// Begin starts a transaction. The scanner wraps its batches in one, which
// matters more here than in Node because pure-Go SQLite is slower at bulk
// writes (R8).
func (d *DB) Begin(ctx context.Context) (*sql.Tx, error) {
	return d.db.BeginTx(ctx, nil)
}

// schema is taken verbatim from lib/music_database.js. Column order, types and
// defaults must not change - existing databases are used without migration.
const schema = `
CREATE TABLE IF NOT EXISTS tracks (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	file_path TEXT UNIQUE NOT NULL,
	file_size INTEGER,
	file_mtime INTEGER,
	title TEXT,
	artist TEXT,
	album TEXT,
	album_artist TEXT,
	genre TEXT,
	year INTEGER,
	track_number INTEGER,
	disc_number INTEGER,
	duration REAL,
	bitrate INTEGER,
	format TEXT,
	cover_path TEXT,
	has_cover BOOLEAN DEFAULT FALSE,
	play_count INTEGER DEFAULT 0,
	last_played DATETIME,
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(artist);
CREATE INDEX IF NOT EXISTS idx_tracks_album ON tracks(album);
CREATE INDEX IF NOT EXISTS idx_tracks_genre ON tracks(genre);
CREATE INDEX IF NOT EXISTS idx_tracks_year ON tracks(year);
CREATE INDEX IF NOT EXISTS idx_tracks_file_path ON tracks(file_path);
CREATE INDEX IF NOT EXISTS idx_tracks_mtime ON tracks(file_mtime);

CREATE TABLE IF NOT EXISTS covers (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	album_key TEXT UNIQUE NOT NULL,
	cover_path TEXT NOT NULL,
	width INTEGER,
	height INTEGER,
	format TEXT,
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_covers_album_key ON covers(album_key);

CREATE TABLE IF NOT EXISTS spotify_tracks (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	spotify_id TEXT UNIQUE NOT NULL,
	title TEXT,
	artist TEXT,
	album TEXT,
	genre TEXT,
	year INTEGER,
	duration INTEGER,
	image_url TEXT,
	preview_url TEXT,
	spotify_uri TEXT,
	popularity INTEGER DEFAULT 0,
	added_date DATETIME DEFAULT CURRENT_TIMESTAMP,
	last_played DATETIME,
	play_count INTEGER DEFAULT 0,
	is_available BOOLEAN DEFAULT TRUE,
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_spotify_tracks_spotify_id ON spotify_tracks(spotify_id);
CREATE INDEX IF NOT EXISTS idx_spotify_tracks_artist ON spotify_tracks(artist);
CREATE INDEX IF NOT EXISTS idx_spotify_tracks_album ON spotify_tracks(album);
CREATE INDEX IF NOT EXISTS idx_spotify_tracks_genre ON spotify_tracks(genre);
CREATE INDEX IF NOT EXISTS idx_spotify_tracks_year ON spotify_tracks(year);
CREATE INDEX IF NOT EXISTS idx_spotify_tracks_popularity ON spotify_tracks(popularity);

CREATE TABLE IF NOT EXISTS custom_playlists (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	name TEXT NOT NULL,
	spotify_url TEXT NOT NULL,
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_custom_playlists_name ON custom_playlists(name);

CREATE TABLE IF NOT EXISTS play_history (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	track_id INTEGER,
	spotify_id TEXT,
	title TEXT NOT NULL,
	artist TEXT NOT NULL,
	album TEXT,
	source TEXT NOT NULL CHECK(source IN ('local', 'spotify')),
	played_at INTEGER NOT NULL,
	session_id TEXT,
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_play_history_played_at ON play_history(played_at);
CREATE INDEX IF NOT EXISTS idx_play_history_source ON play_history(source);
CREATE INDEX IF NOT EXISTS idx_play_history_artist ON play_history(artist);
CREATE INDEX IF NOT EXISTS idx_play_history_track_id ON play_history(track_id);
CREATE INDEX IF NOT EXISTS idx_play_history_spotify_id ON play_history(spotify_id);
`

func (d *DB) createTables() error {
	if _, err := d.db.Exec(schema); err != nil {
		return fmt.Errorf("create music database tables: %w", err)
	}
	return nil
}

// runMigrations adds the two columns that older databases are missing. Same
// checks and same order as the Node implementation.
func (d *DB) runMigrations() error {
	columns, err := d.tableColumns("tracks")
	if err != nil {
		return err
	}

	var migrations []string
	if !columns["play_count"] {
		migrations = append(migrations, "ALTER TABLE tracks ADD COLUMN play_count INTEGER DEFAULT 0")
		log.Print("[DB] Adding play_count column to tracks table")
	}
	if !columns["last_played"] {
		migrations = append(migrations, "ALTER TABLE tracks ADD COLUMN last_played DATETIME")
		log.Print("[DB] Adding last_played column to tracks table")
	}

	if len(migrations) == 0 {
		return nil
	}

	log.Print("[DB] Running database migrations...")
	for i, statement := range migrations {
		log.Printf("[DB] Running migration %d/%d: %s", i+1, len(migrations), statement)
		if _, err := d.db.Exec(statement); err != nil {
			return fmt.Errorf("migration %d failed: %w", i+1, err)
		}
	}
	log.Print("[DB] All migrations completed successfully")
	return nil
}

func (d *DB) tableColumns(table string) (map[string]bool, error) {
	rows, err := d.read.Query(fmt.Sprintf("PRAGMA table_info(%s)", table))
	if err != nil {
		return nil, fmt.Errorf("read columns of %s: %w", table, err)
	}
	defer rows.Close()

	columns := make(map[string]bool)
	for rows.Next() {
		var (
			cid        int
			name       string
			columnType string
			notNull    int
			defaultVal any
			primaryKey int
		)
		if err := rows.Scan(&cid, &name, &columnType, &notNull, &defaultVal, &primaryKey); err != nil {
			return nil, fmt.Errorf("scan column info of %s: %w", table, err)
		}
		columns[name] = true
	}
	return columns, rows.Err()
}
