// history.go
// Play history, play statistics and custom playlists
// Version: 2026.08.13

package musicdb

import (
	"context"
	"fmt"
	"math/rand"
	"sort"
	"sync"
	"time"
)

var sessionOnce sync.Mutex

// SessionID returns the id that groups all plays of this server run. Created
// lazily on first use, exactly like getSessionId() did.
func (d *DB) SessionID() string {
	sessionOnce.Lock()
	defer sessionOnce.Unlock()

	if d.sessionID == "" {
		d.sessionID = fmt.Sprintf("session_%d_%s", time.Now().UnixMilli(), randomSuffix(9))
	}
	return d.sessionID
}

// ResetSession drops the current session id so the next play starts a new one.
func (d *DB) ResetSession() {
	sessionOnce.Lock()
	defer sessionOnce.Unlock()
	d.sessionID = ""
}

// randomSuffix mimics Math.random().toString(36).substr(2, 9).
func randomSuffix(n int) string {
	const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz"
	out := make([]byte, n)
	for i := range out {
		out[i] = alphabet[rand.Intn(len(alphabet))]
	}
	return string(out)
}

// PlayHistoryEntry is one row of getPlaysForPeriod().
type PlayHistoryEntry struct {
	ID         int64   `json:"id"`
	TrackID    *int64  `json:"track_id"`
	SpotifyID  *string `json:"spotify_id"`
	Title      string  `json:"title"`
	Artist     string  `json:"artist"`
	Album      *string `json:"album"`
	Source     string  `json:"source"`
	Timestamp  int64   `json:"timestamp"`
	SessionID  *string `json:"session_id"`
	PlayedDate *string `json:"played_date"`
}

// PlayRecord describes the track that was played.
type PlayRecord struct {
	TrackID   *int64
	SpotifyID *string
	Title     string
	Artist    string
	Album     string
}

// RecordPlayHistory appends one play. The timestamp is always taken from the
// server clock in milliseconds - a played_at supplied by the client is ignored,
// same as in the Node implementation (R5).
func (d *DB) RecordPlayHistory(ctx context.Context, rec PlayRecord, source string) (int64, int64, error) {
	const query = `INSERT INTO play_history (
			track_id, spotify_id, title, artist, album, source, played_at, session_id
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`

	playedAt := time.Now().UnixMilli()

	// Only the column matching the source is filled, the other stays NULL.
	var trackID *int64
	var spotifyID *string
	if source == "local" {
		trackID = rec.TrackID
	}
	if source == "spotify" {
		spotifyID = rec.SpotifyID
	}

	result, err := d.db.ExecContext(ctx, query,
		trackID, spotifyID, rec.Title, rec.Artist, rec.Album, source, playedAt, d.SessionID(),
	)
	if err != nil {
		return 0, 0, fmt.Errorf("record play history: %w", err)
	}

	id, err := result.LastInsertId()
	if err != nil {
		return 0, playedAt, fmt.Errorf("record play history: %w", err)
	}
	return id, playedAt, nil
}

// GetPlaysForPeriod returns the plays between two millisecond timestamps.
func (d *DB) GetPlaysForPeriod(ctx context.Context, start, end string) ([]PlayHistoryEntry, error) {
	const query = `SELECT
			id,
			track_id,
			spotify_id,
			title,
			artist,
			album,
			source,
			played_at as timestamp,
			session_id,
			datetime(played_at/1000, 'unixepoch', 'localtime') as played_date
		FROM play_history
		WHERE played_at >= ? AND played_at <= ?
		ORDER BY played_at ASC`

	rows, err := d.read.QueryContext(ctx, query, start, end)
	if err != nil {
		return nil, fmt.Errorf("query play history: %w", err)
	}
	defer rows.Close()

	entries := []PlayHistoryEntry{}
	for rows.Next() {
		var e PlayHistoryEntry
		if err := rows.Scan(
			&e.ID, &e.TrackID, &e.SpotifyID, &e.Title, &e.Artist, &e.Album,
			&e.Source, &e.Timestamp, &e.SessionID, &e.PlayedDate,
		); err != nil {
			return nil, fmt.Errorf("scan play history entry: %w", err)
		}
		entries = append(entries, e)
	}
	return entries, rows.Err()
}

// PlayStats is the result of getPlayStats().
type PlayStats struct {
	TotalTracks      int64    `json:"total_tracks"`
	TotalPlays       *int64   `json:"total_plays"`
	AvgPlaysPerTrack *float64 `json:"avg_plays_per_track"`
	MaxPlays         *int64   `json:"max_plays"`
}

// GetPlayStats aggregates play counters across local and Spotify tracks.
func (d *DB) GetPlayStats(ctx context.Context) (PlayStats, error) {
	const query = `SELECT
			COUNT(*) as total_tracks,
			SUM(play_count) as total_plays,
			AVG(play_count) as avg_plays_per_track,
			MAX(play_count) as max_plays
		FROM (
			SELECT play_count FROM tracks
			UNION ALL
			SELECT play_count FROM spotify_tracks
		)`

	var s PlayStats
	err := d.read.QueryRowContext(ctx, query).Scan(
		&s.TotalTracks, &s.TotalPlays, &s.AvgPlaysPerTrack, &s.MaxPlays,
	)
	if err != nil {
		return s, fmt.Errorf("query play stats: %w", err)
	}
	return s, nil
}

// GetMostPlayedTracks merges the most played local and Spotify tracks. The two
// result sets have different columns, so the rows are kept as maps to preserve
// exactly the fields the Node version sent.
func (d *DB) GetMostPlayedTracks(ctx context.Context, limit string) ([]map[string]any, error) {
	const localQuery = `SELECT
			id, title, artist, album, play_count, last_played,
			'local' as source, file_path
		FROM tracks
		WHERE play_count > 0
		ORDER BY play_count DESC, last_played DESC
		LIMIT ?`

	const spotifyQuery = `SELECT
			id, title, artist, album, play_count, last_played,
			'spotify' as source, spotify_id, spotify_uri, image_url
		FROM spotify_tracks
		WHERE play_count > 0
		ORDER BY play_count DESC, last_played DESC
		LIMIT ?`

	local, err := d.queryRowMaps(ctx, localQuery, limit)
	if err != nil {
		return nil, err
	}
	spotify, err := d.queryRowMaps(ctx, spotifyQuery, limit)
	if err != nil {
		return nil, err
	}

	combined := append(local, spotify...)

	// Sort by play count, then by last played, descending. Stable, because the
	// JavaScript sort was stable and rows compare equal more often than not.
	sort.SliceStable(combined, func(i, j int) bool {
		a, b := combined[i], combined[j]
		countA, countB := asInt64(a["play_count"]), asInt64(b["play_count"])
		if countA != countB {
			return countA > countB
		}
		// Both timestamps share the "YYYY-MM-DD HH:MM:SS" format, so comparing
		// the strings orders them like comparing the parsed dates. A missing
		// value sorts last, matching new Date(null) being the epoch.
		return asString(a["last_played"]) > asString(b["last_played"])
	})

	max := parseLimit(limit)
	if max >= 0 && len(combined) > max {
		combined = combined[:max]
	}
	return combined, nil
}

// queryRowMaps runs a query and returns every row as a column name to value
// map, preserving NULL as nil.
func (d *DB) queryRowMaps(ctx context.Context, query string, args ...any) ([]map[string]any, error) {
	rows, err := d.read.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("query: %w", err)
	}
	defer rows.Close()

	columns, err := rows.Columns()
	if err != nil {
		return nil, fmt.Errorf("read columns: %w", err)
	}

	out := []map[string]any{}
	for rows.Next() {
		values := make([]any, len(columns))
		pointers := make([]any, len(columns))
		for i := range values {
			pointers[i] = &values[i]
		}
		if err := rows.Scan(pointers...); err != nil {
			return nil, fmt.Errorf("scan row: %w", err)
		}

		row := make(map[string]any, len(columns))
		for i, name := range columns {
			// The driver hands text back as []byte; JSON needs a string.
			if raw, ok := values[i].([]byte); ok {
				row[name] = string(raw)
				continue
			}
			row[name] = values[i]
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

func asInt64(v any) int64 {
	switch value := v.(type) {
	case int64:
		return value
	case float64:
		return int64(value)
	default:
		return 0
	}
}

func asString(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}

// parseLimit turns the raw limit parameter into a slice bound. Anything that is
// not a positive number means "no limit", which is how the Node code behaved
// when slice() received a non-number.
func parseLimit(limit string) int {
	value := 0
	for _, r := range limit {
		if r < '0' || r > '9' {
			return -1
		}
		value = value*10 + int(r-'0')
	}
	if limit == "" {
		return -1
	}
	return value
}

// CustomPlaylist is one row of the custom_playlists table.
type CustomPlaylist struct {
	ID         int64   `json:"id"`
	Name       string  `json:"name"`
	SpotifyURL string  `json:"spotify_url"`
	CreatedAt  *string `json:"created_at"`
	UpdatedAt  *string `json:"updated_at"`
}

// AddCustomPlaylist appends a playlist and returns its id.
func (d *DB) AddCustomPlaylist(ctx context.Context, name, spotifyURL string) (int64, error) {
	result, err := d.db.ExecContext(ctx,
		"INSERT INTO custom_playlists (name, spotify_url) VALUES (?, ?)", name, spotifyURL)
	if err != nil {
		return 0, fmt.Errorf("add custom playlist: %w", err)
	}
	return result.LastInsertId()
}

// GetCustomPlaylists lists the playlists, newest first.
func (d *DB) GetCustomPlaylists(ctx context.Context) ([]CustomPlaylist, error) {
	rows, err := d.read.QueryContext(ctx,
		"SELECT id, name, spotify_url, created_at, updated_at FROM custom_playlists ORDER BY created_at DESC")
	if err != nil {
		return nil, fmt.Errorf("query custom playlists: %w", err)
	}
	defer rows.Close()

	playlists := []CustomPlaylist{}
	for rows.Next() {
		var p CustomPlaylist
		if err := rows.Scan(&p.ID, &p.Name, &p.SpotifyURL, &p.CreatedAt, &p.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan custom playlist: %w", err)
		}
		playlists = append(playlists, p)
	}
	return playlists, rows.Err()
}

// DeleteCustomPlaylist removes one playlist.
func (d *DB) DeleteCustomPlaylist(ctx context.Context, id string) (int64, error) {
	result, err := d.db.ExecContext(ctx, "DELETE FROM custom_playlists WHERE id = ?", id)
	if err != nil {
		return 0, fmt.Errorf("delete custom playlist: %w", err)
	}
	return result.RowsAffected()
}

// ClearCustomPlaylists removes all playlists.
func (d *DB) ClearCustomPlaylists(ctx context.Context) (int64, error) {
	result, err := d.db.ExecContext(ctx, "DELETE FROM custom_playlists")
	if err != nil {
		return 0, fmt.Errorf("clear custom playlists: %w", err)
	}
	return result.RowsAffected()
}
