// session_raw.go
// Session blob write that can bind SQL NULL
// Version: 2026.08.13

package appdb

import (
	"context"
	"fmt"
)

// SaveSessionDataRaw stores an already encoded JSON blob under a session key.
//
// A nil blob is bound as SQL NULL. That is what JSON.stringify(undefined)
// produced in Node whenever the request body carried no data: the NOT NULL
// column rejected the insert and the handler answered 500. The golden baseline
// froze exactly that answer for POST /api/session/app and POST /api/session/ui,
// so the failure has to keep coming from the database instead of being faked in
// the handler.
func (a *DB) SaveSessionDataRaw(ctx context.Context, sessionID string, data []byte) (int64, error) {
	const query = `INSERT OR REPLACE INTO session_data (session_id, data, updated_at)
		VALUES (?, ?, CURRENT_TIMESTAMP)`

	var payload any
	if data != nil {
		payload = string(data)
	}

	result, err := a.db.ExecContext(ctx, query, sessionID, payload)
	if err != nil {
		return 0, fmt.Errorf("save session data: %w", err)
	}
	return result.LastInsertId()
}
