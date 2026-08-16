// writes_queue.go
// Write endpoints for the persisted queue state
// Version: 2026.08.13

package api

import (
	"encoding/json"
	"net/http"

	"github.com/Nigcra/nJukebox/internal/appdb"
)

type queueSaveResponse struct {
	Success     bool   `json:"success"`
	StateID     int64  `json:"stateId"`
	SessionID   string `json:"sessionId"`
	QueueLength int    `json:"queueLength"`
}

// handleQueueSave stores the queue of one session.
func (s *Server) handleQueueSave(w http.ResponseWriter, r *http.Request, _ map[string]string) {
	body, ok := decodeBody(r)
	if !ok {
		// express.json() ran in strict mode, so a body that is not an object or
		// an array never reached the handler: the parser raised a SyntaxError
		// and the error middleware answered. The "Invalid queue state data"
		// branch of the handler was therefore unreachable.
		internalError(w)
		return
	}

	sessionID := sessionIDFrom(r)

	state := appdb.QueueState{
		Queue:        truthyRaw(body.raw("queue")),
		PlayedTracks: truthyRaw(body.raw("playedTracks")),
	}
	if value, ok := body.number("currentTrackIndex"); ok {
		state.CurrentTrackIndex = int64(value)
	}
	if value, ok := body.text("currentFilter"); ok {
		state.CurrentFilter = value
	}
	if value, ok := body.text("currentView"); ok {
		state.CurrentView = value
	}
	if value, ok := body.text("currentAZFilter"); ok {
		state.CurrentAZFilter = value
	}
	if value, ok := body.number("volume"); ok {
		state.Volume = value
	}

	stateID, err := s.app.SaveQueueState(r.Context(), sessionID, state)
	if err != nil {
		failPlain(w, http.StatusInternalServerError, "Failed to save queue state")
		return
	}

	writeJSON(w, http.StatusOK, queueSaveResponse{
		Success:     true,
		StateID:     stateID,
		SessionID:   sessionID,
		QueueLength: arrayLength(body.raw("queue")),
	})
}

type queueCleanupResponse struct {
	Success bool            `json:"success"`
	Cleaned int64           `json:"cleaned"`
	MaxAge  json.RawMessage `json:"maxAge"`
}

// defaultQueueMaxAge is the "7 * 24 * 60 * 60 * 1000" default of the handler.
var defaultQueueMaxAge = json.RawMessage("604800000")

// handleQueueCleanup deletes old queue states.
//
// The unit mismatch is part of the original and stays: the handler defaults
// maxAge to seven days in milliseconds and hands that number to
// cleanupOldQueueStates(maxAgeHours), which multiplies it by 3600000 again. The
// cutoff lands far in the past and nothing is ever deleted with the default.
func (s *Server) handleQueueCleanup(w http.ResponseWriter, r *http.Request, _ map[string]string) {
	body, ok := decodeBody(r)
	if !ok {
		internalError(w)
		return
	}

	maxAgeRaw := defaultQueueMaxAge
	maxAge := float64(7 * 24 * 60 * 60 * 1000)
	numeric := true

	if body.has("maxAge") {
		maxAgeRaw = body.raw("maxAge")
		value, isNumber := body.number("maxAge")
		if isNumber {
			maxAge = value
		} else {
			// A non numeric maxAge produced NaN, sqlite3 bound that as NULL and
			// "timestamp < NULL" matched no row.
			numeric = false
		}
	}

	var cleaned int64
	if numeric {
		count, err := s.app.CleanupOldQueueStates(r.Context(), maxAge)
		if err != nil {
			failPlain(w, http.StatusInternalServerError, "Failed to cleanup queue states")
			return
		}
		cleaned = count
	}

	writeJSON(w, http.StatusOK, queueCleanupResponse{
		Success: true,
		Cleaned: cleaned,
		MaxAge:  nullRaw(maxAgeRaw),
	})
}

// truthyRaw keeps a value only when it is truthy, mirroring "queue || []".
func truthyRaw(raw json.RawMessage) json.RawMessage {
	body := jsonBody{"value": raw}
	if len(raw) == 0 || !body.truthy("value") {
		return nil
	}
	return raw
}

// arrayLength mirrors "queueState.queue?.length || 0".
func arrayLength(raw json.RawMessage) int {
	if !isJSONArray(raw) {
		return 0
	}
	var entries []json.RawMessage
	if err := json.Unmarshal(raw, &entries); err != nil {
		return 0
	}
	return len(entries)
}
