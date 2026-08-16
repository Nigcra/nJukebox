// writes_admin.go
// Administrative write endpoints: orphan cleanup and database reset
// Version: 2026.08.13

package api

import (
	"net/http"
	"os"
	"strconv"

	"github.com/Nigcra/nJukebox/internal/musicdb"
)

type cleanupResponse struct {
	Success      bool   `json:"success"`
	Message      string `json:"message"`
	RemovedCount int    `json:"removedCount"`
}

// handleCleanup removes tracks whose file has disappeared and then drops the
// covers that no longer belong to any album.
func (s *Server) handleCleanup(w http.ResponseWriter, r *http.Request, _ map[string]string) {
	tracks, err := s.music.GetTracks(r.Context(), musicdb.TrackFilters{Limit: "10000"})
	if err != nil {
		fail(w, http.StatusInternalServerError, err.Error())
		return
	}

	removedCount := 0
	for _, track := range tracks {
		if track.FilePath == "" || pathExists(track.FilePath) {
			continue
		}
		if _, err := s.music.RemoveTrack(r.Context(), track.ID); err != nil {
			fail(w, http.StatusInternalServerError, err.Error())
			return
		}
		removedCount++
	}

	if _, err := s.music.CleanupOrphans(r.Context()); err != nil {
		fail(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, cleanupResponse{
		Success:      true,
		Message:      "Cleanup completed: " + strconv.Itoa(removedCount) + " orphaned tracks removed",
		RemovedCount: removedCount,
	})
}

type clearDatabaseResponse struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
}

// handleClearDatabase empties the library tables.
func (s *Server) handleClearDatabase(w http.ResponseWriter, r *http.Request, _ map[string]string) {
	if err := s.music.ClearDatabase(r.Context()); err != nil {
		fail(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, clearDatabaseResponse{
		Success: true,
		Message: "Database cleared successfully",
	})
}

// pathExists mirrors fs.pathExists, which is true for directories as well.
func pathExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}
