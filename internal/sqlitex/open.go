// open.go
// Shared SQLite pool setup: one serialized writer plus a pool of WAL readers
// Version: 2026.08.16

package sqlitex

import (
	"database/sql"
	"fmt"
	"net/url"
	"os"
	"path/filepath"

	_ "modernc.org/sqlite"
)

// BusyTimeoutMS is how long a connection waits for a lock before giving up.
// With writers serialized through a single connection this should never be
// reached from inside the process; it covers a second process holding the file,
// a golden run or a manual sqlite3 session.
const BusyTimeoutMS = 5000

// Readers is the size of the read pool. WAL lets any number of readers run
// alongside the writer, so this only needs to cover the requests the interface
// makes at once - browsing, covers and a stream start. Every connection carries
// its own page cache, which is why it is not larger.
const Readers = 4

// Open returns two pools for the same database file.
//
// The writer is capped at a single connection. That serializes every write
// inside the process the way the Node server did, so two writers never race for
// the file and SQLITE_BUSY does not arise between them.
//
// The reader pool is separate and never waits behind a write transaction: in
// WAL mode readers see the last committed snapshot while a writer is working.
// Sharing one connection for both is what used to stall the interface during a
// library scan - a request for a track, a cover or the play count queued behind
// the scanner's batch.
//
// Callers must route Query and QueryRow through the reader and everything that
// writes through the writer. Both are closed by the caller.
func Open(path string) (write *sql.DB, read *sql.DB, err error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, nil, fmt.Errorf("create data directory: %w", err)
	}

	// journal_mode is a property of the file and survives, but setting it on
	// every connection keeps a freshly created database from being opened in
	// rollback mode by whichever pool connects first.
	dsn := path + "?" + url.Values{"_pragma": {
		fmt.Sprintf("busy_timeout(%d)", BusyTimeoutMS),
		"journal_mode(WAL)",
	}}.Encode()

	write, err = sql.Open("sqlite", dsn)
	if err != nil {
		return nil, nil, fmt.Errorf("open database: %w", err)
	}
	write.SetMaxOpenConns(1)

	if err := write.Ping(); err != nil {
		write.Close()
		return nil, nil, fmt.Errorf("connect to database: %w", err)
	}

	read, err = sql.Open("sqlite", dsn)
	if err != nil {
		write.Close()
		return nil, nil, fmt.Errorf("open database for reading: %w", err)
	}
	read.SetMaxOpenConns(Readers)

	if err := read.Ping(); err != nil {
		write.Close()
		read.Close()
		return nil, nil, fmt.Errorf("connect to database for reading: %w", err)
	}

	return write, read, nil
}
