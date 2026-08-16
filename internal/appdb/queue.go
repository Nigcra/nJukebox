// queue.go
// Queue state persistence and session bookkeeping
// Version: 2026.08.13

package appdb

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"time"
)

// QueueState is the payload the frontend saves and reloads.
type QueueState struct {
	Queue             json.RawMessage `json:"queue"`
	CurrentTrackIndex int64           `json:"currentTrackIndex"`
	CurrentFilter     string          `json:"currentFilter"`
	CurrentView       string          `json:"currentView"`
	CurrentAZFilter   string          `json:"currentAZFilter"`
	PlayedTracks      json.RawMessage `json:"playedTracks"`
	Volume            float64         `json:"volume"`
	Timestamp         int64           `json:"timestamp"`
}

// SaveQueueState writes the queue for a session, applying the same defaults as
// the Node implementation for missing fields.
func (a *DB) SaveQueueState(ctx context.Context, sessionID string, state QueueState) (int64, error) {
	const query = `INSERT OR REPLACE INTO queue_state (
			session_id, queue_data, current_track_index, current_filter,
			current_view, current_az_filter, played_tracks, volume,
			timestamp, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`

	queueData := "[]"
	if len(state.Queue) > 0 && string(state.Queue) != "null" {
		queueData = string(state.Queue)
	}
	playedTracks := "[]"
	if len(state.PlayedTracks) > 0 && string(state.PlayedTracks) != "null" {
		playedTracks = string(state.PlayedTracks)
	}

	currentFilter := state.CurrentFilter
	if currentFilter == "" {
		currentFilter = "new"
	}
	currentView := state.CurrentView
	if currentView == "" {
		currentView = "list"
	}
	currentAZFilter := state.CurrentAZFilter
	if currentAZFilter == "" {
		currentAZFilter = "all"
	}
	volume := state.Volume
	if volume == 0 {
		// The original used "volume || 0.7", so a zero volume also fell back.
		volume = 0.7
	}

	result, err := a.db.ExecContext(ctx, query,
		sessionID, queueData, state.CurrentTrackIndex, currentFilter,
		currentView, currentAZFilter, playedTracks, volume,
		time.Now().UnixMilli(),
	)
	if err != nil {
		return 0, fmt.Errorf("save queue state: %w", err)
	}
	return result.LastInsertId()
}

// LoadQueueState returns the stored queue or nil when the session is unknown.
func (a *DB) LoadQueueState(ctx context.Context, sessionID string) (*QueueState, error) {
	const query = `SELECT queue_data, current_track_index, current_filter, current_view,
			current_az_filter, played_tracks, volume, timestamp
		FROM queue_state
		WHERE session_id = ?
		ORDER BY updated_at DESC
		LIMIT 1`

	var (
		state        QueueState
		queueData    string
		playedTracks string
	)

	err := a.read.QueryRowContext(ctx, query, sessionID).Scan(
		&queueData, &state.CurrentTrackIndex, &state.CurrentFilter,
		&state.CurrentView, &state.CurrentAZFilter, &playedTracks,
		&state.Volume, &state.Timestamp,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("load queue state: %w", err)
	}

	if !json.Valid([]byte(queueData)) {
		return nil, fmt.Errorf("parse queue state data: invalid JSON in queue_data")
	}
	if !json.Valid([]byte(playedTracks)) {
		return nil, fmt.Errorf("parse queue state data: invalid JSON in played_tracks")
	}

	state.Queue = json.RawMessage(queueData)
	state.PlayedTracks = json.RawMessage(playedTracks)

	return &state, nil
}

// QueueStats summarises the stored queue states of the last 24 hours.
type QueueStats struct {
	ActiveSessions int64   `json:"activeSessions"`
	TotalStates    int64   `json:"totalStates"`
	AvgQueueLength float64 `json:"avgQueueLength"`
	OldestState    *int64  `json:"oldestState"`
	NewestState    *int64  `json:"newestState"`
}

// GetQueueStats aggregates the queue states newer than 24 hours.
func (a *DB) GetQueueStats(ctx context.Context) (QueueStats, error) {
	const query = `SELECT
			COUNT(DISTINCT session_id) as active_sessions,
			COUNT(*) as total_states,
			AVG(json_array_length(queue_data)) as avg_queue_length,
			MIN(timestamp) as oldest_state,
			MAX(timestamp) as newest_state
		FROM queue_state
		WHERE timestamp > ?`

	dayAgo := time.Now().UnixMilli() - 24*60*60*1000

	var (
		stats          QueueStats
		avgQueueLength *float64
	)
	err := a.read.QueryRowContext(ctx, query, dayAgo).Scan(
		&stats.ActiveSessions, &stats.TotalStates, &avgQueueLength,
		&stats.OldestState, &stats.NewestState,
	)
	if err != nil {
		return stats, fmt.Errorf("query queue stats: %w", err)
	}

	// The original replaced a null average with 0 via "|| 0".
	if avgQueueLength != nil {
		stats.AvgQueueLength = *avgQueueLength
	}
	return stats, nil
}

// SessionSummary is one row of getAllSessions().
type SessionSummary struct {
	SessionID    string `json:"session_id"`
	LastActivity *int64 `json:"last_activity"`
	StateCount   int64  `json:"state_count"`
}

// GetAllSessions lists the known sessions, most recent first.
func (a *DB) GetAllSessions(ctx context.Context) ([]SessionSummary, error) {
	const query = `SELECT DISTINCT session_id,
			MAX(timestamp) as last_activity,
			COUNT(*) as state_count
		FROM queue_state
		GROUP BY session_id
		ORDER BY last_activity DESC`

	rows, err := a.read.QueryContext(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("query sessions: %w", err)
	}
	defer rows.Close()

	sessions := []SessionSummary{}
	for rows.Next() {
		var s SessionSummary
		if err := rows.Scan(&s.SessionID, &s.LastActivity, &s.StateCount); err != nil {
			return nil, fmt.Errorf("scan session: %w", err)
		}
		sessions = append(sessions, s)
	}
	return sessions, rows.Err()
}

// CleanupOldQueueStates removes queue states older than maxAgeHours.
func (a *DB) CleanupOldQueueStates(ctx context.Context, maxAgeHours float64) (int64, error) {
	cutoff := time.Now().UnixMilli() - int64(maxAgeHours*60*60*1000)

	result, err := a.db.ExecContext(ctx, "DELETE FROM queue_state WHERE timestamp < ?", cutoff)
	if err != nil {
		return 0, fmt.Errorf("cleanup old queue states: %w", err)
	}

	changes, err := result.RowsAffected()
	if err != nil {
		return 0, err
	}
	log.Printf("Queue cleanup completed: %d states removed", changes)
	return changes, nil
}
