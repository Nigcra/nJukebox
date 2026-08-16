// queue.go
// Read endpoints for the persisted queue state
// Version: 2026.08.13

package api

import (
	"net/http"

	"github.com/Nigcra/nJukebox/internal/appdb"
)

// queueMissingResponse is returned when a session has no stored queue.
type queueMissingResponse struct {
	Success   bool   `json:"success"`
	Message   string `json:"message"`
	SessionID string `json:"sessionId"`
}

type queueLoadResponse struct {
	Success    bool              `json:"success"`
	QueueState *appdb.QueueState `json:"queueState"`
	SessionID  string            `json:"sessionId"`
}

func (s *Server) handleQueueLoad(w http.ResponseWriter, r *http.Request, _ map[string]string) {
	sessionID := sessionIDFrom(r)

	state, err := s.app.LoadQueueState(r.Context(), sessionID)
	if err != nil {
		failPlain(w, http.StatusInternalServerError, "Failed to load queue state")
		return
	}

	if state == nil {
		writeJSON(w, http.StatusOK, queueMissingResponse{
			Success:   false,
			Message:   "No queue state found",
			SessionID: sessionID,
		})
		return
	}

	writeJSON(w, http.StatusOK, queueLoadResponse{
		Success:    true,
		QueueState: state,
		SessionID:  sessionID,
	})
}

type queueStatsResponse struct {
	Success  bool                   `json:"success"`
	Stats    appdb.QueueStats       `json:"stats"`
	Sessions []appdb.SessionSummary `json:"sessions"`
}

func (s *Server) handleQueueStats(w http.ResponseWriter, r *http.Request, _ map[string]string) {
	stats, err := s.app.GetQueueStats(r.Context())
	if err != nil {
		failPlain(w, http.StatusInternalServerError, "Failed to get queue statistics")
		return
	}

	sessions, err := s.app.GetAllSessions(r.Context())
	if err != nil {
		failPlain(w, http.StatusInternalServerError, "Failed to get queue statistics")
		return
	}

	writeJSON(w, http.StatusOK, queueStatsResponse{
		Success:  true,
		Stats:    stats,
		Sessions: sessions,
	})
}

// sessionIDFrom reads the session header, falling back to "default".
func sessionIDFrom(r *http.Request) string {
	if value := r.Header.Get("x-session-id"); value != "" {
		return value
	}
	return "default"
}
