// rescan.go
// Manual library rescan endpoint
// Version: 2026.08.13

package api

import (
	"context"
	"log"
	"net/http"
)

// RescanFunc triggers a full library scan. Kept as a function type so the api
// package does not have to import the scanner.
type RescanFunc func(ctx context.Context) error

type rescanResponse struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
}

// RegisterRescan adds POST /api/rescan. The route only exists once a scanner is
// wired up - before phase 7 the endpoint was deliberately absent rather than
// answering with a lie.
func (s *Server) RegisterRescan(scan RescanFunc) {
	s.rescan = scan
	s.register(http.MethodPost, "/api/rescan", s.handleRescan)
}

func (s *Server) handleRescan(w http.ResponseWriter, _ *http.Request, _ map[string]string) {
	if s.rescan == nil {
		fail(w, http.StatusInternalServerError, "scanner not available")
		return
	}

	// Deliberately not r.Context(): a client that disconnects mid-scan must not
	// abort the scan. The Node version ran it detached from the request as well,
	// simply because it never passed a cancellation signal.
	if err := s.rescan(context.Background()); err != nil {
		log.Printf("[SERVER] error during rescan: %v", err)
		fail(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, rescanResponse{Success: true, Message: "Rescan completed"})
}
