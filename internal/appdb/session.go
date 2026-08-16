// session.go
// Arbitrary per-session JSON blobs used by the frontend state endpoints
// Version: 2026.08.13

package appdb

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
)

// SaveSessionData stores a JSON blob under a session key.
func (a *DB) SaveSessionData(ctx context.Context, sessionID string, data any) (int64, error) {
	encoded, err := json.Marshal(data)
	if err != nil {
		return 0, fmt.Errorf("encode session data: %w", err)
	}

	const query = `INSERT OR REPLACE INTO session_data (session_id, data, updated_at)
		VALUES (?, ?, CURRENT_TIMESTAMP)`

	result, err := a.db.ExecContext(ctx, query, sessionID, string(encoded))
	if err != nil {
		return 0, fmt.Errorf("save session data: %w", err)
	}
	return result.LastInsertId()
}

// GetSessionData returns the stored blob, or nil when the key is unknown.
func (a *DB) GetSessionData(ctx context.Context, sessionID string) (json.RawMessage, error) {
	var data string
	err := a.read.QueryRowContext(ctx,
		"SELECT data FROM session_data WHERE session_id = ?", sessionID).Scan(&data)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get session data: %w", err)
	}

	if !json.Valid([]byte(data)) {
		return nil, fmt.Errorf("parse session data: invalid JSON for session %s", sessionID)
	}
	return json.RawMessage(data), nil
}

// DeleteSessionData removes a stored blob.
func (a *DB) DeleteSessionData(ctx context.Context, sessionID string) (int64, error) {
	result, err := a.db.ExecContext(ctx,
		"DELETE FROM session_data WHERE session_id = ?", sessionID)
	if err != nil {
		return 0, fmt.Errorf("delete session data: %w", err)
	}
	return result.RowsAffected()
}
