// missing.go
// Bookkeeping for files that disappeared, so a track is only removed after it
// was missing twice in a row
// Version: 2026.08.13

package musicdb

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
)

// missingSchema is additive. It lives in music.db but is never part of any API
// response - no endpoint enumerates tables - so the frozen baseline does not
// see it.
const missingSchema = `
CREATE TABLE IF NOT EXISTS missing_files (
	file_path TEXT PRIMARY KEY NOT NULL,
	misses INTEGER NOT NULL DEFAULT 1,
	first_missing_at INTEGER NOT NULL,
	last_missing_at INTEGER NOT NULL
);
`

func (d *DB) createMissingTable() error {
	if _, err := d.db.Exec(missingSchema); err != nil {
		return fmt.Errorf("create missing_files table: %w", err)
	}
	return nil
}

// RecordMissing counts one more consecutive miss for a path and returns the new
// total. The counter is persisted on purpose: a track that vanished before a
// restart must not get a fresh grace period just because the server was
// restarted.
func (d *DB) RecordMissing(ctx context.Context, filePath string, now int64) (int64, error) {
	const query = `INSERT INTO missing_files (file_path, misses, first_missing_at, last_missing_at)
		VALUES (?, 1, ?, ?)
		ON CONFLICT(file_path) DO UPDATE SET
			misses = misses + 1,
			last_missing_at = excluded.last_missing_at`

	if _, err := d.db.ExecContext(ctx, query, filePath, now, now); err != nil {
		return 0, fmt.Errorf("record missing file: %w", err)
	}

	var misses int64
	err := d.read.QueryRowContext(ctx,
		"SELECT misses FROM missing_files WHERE file_path = ?", filePath).Scan(&misses)
	if err != nil {
		return 0, fmt.Errorf("read miss count: %w", err)
	}
	return misses, nil
}

// MissCount returns how often a path was missing in a row, 0 when it is not
// being tracked.
func (d *DB) MissCount(ctx context.Context, filePath string) (int64, error) {
	var misses int64
	err := d.read.QueryRowContext(ctx,
		"SELECT misses FROM missing_files WHERE file_path = ?", filePath).Scan(&misses)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, nil
	}
	if err != nil {
		return 0, fmt.Errorf("read miss count: %w", err)
	}
	return misses, nil
}

// ForgetMissing drops the bookkeeping for a path. Called when a file turns up
// again - the run of consecutive misses is broken - and after the track was
// finally removed.
func (d *DB) ForgetMissing(ctx context.Context, filePath string) error {
	if _, err := d.db.ExecContext(ctx,
		"DELETE FROM missing_files WHERE file_path = ?", filePath); err != nil {
		return fmt.Errorf("forget missing file: %w", err)
	}
	return nil
}

// MissingEntry is one row of the bookkeeping table.
type MissingEntry struct {
	FilePath       string
	Misses         int64
	FirstMissingAt int64
	LastMissingAt  int64
}

// ListMissing returns everything currently under observation. Used by the
// scanner to clean up entries for paths that are no longer in the library.
func (d *DB) ListMissing(ctx context.Context) ([]MissingEntry, error) {
	rows, err := d.read.QueryContext(ctx,
		"SELECT file_path, misses, first_missing_at, last_missing_at FROM missing_files")
	if err != nil {
		return nil, fmt.Errorf("list missing files: %w", err)
	}
	defer rows.Close()

	entries := []MissingEntry{}
	for rows.Next() {
		var e MissingEntry
		if err := rows.Scan(&e.FilePath, &e.Misses, &e.FirstMissingAt, &e.LastMissingAt); err != nil {
			return nil, fmt.Errorf("scan missing file: %w", err)
		}
		entries = append(entries, e)
	}
	return entries, rows.Err()
}
