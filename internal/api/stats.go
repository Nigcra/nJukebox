// stats.go
// Play statistics, most played tracks and the reporting period query
// Version: 2026.08.13

package api

import (
	"net/http"
	"os"
	"runtime"
	"strconv"
	"time"

	"github.com/Nigcra/nJukebox/internal/musicdb"
)

var startedAt = time.Now()

type healthResponse struct {
	Success   bool        `json:"success"`
	Status    string      `json:"status"`
	Uptime    float64     `json:"uptime"`
	Memory    memoryUsage `json:"memory"`
	Debugging bool        `json:"debugging"`
}

// memoryUsage mirrors the shape of process.memoryUsage(). The values differ
// between runtimes, but the baseline replaces the whole field anyway - only its
// presence is compared.
type memoryUsage struct {
	RSS          uint64 `json:"rss"`
	HeapTotal    uint64 `json:"heapTotal"`
	HeapUsed     uint64 `json:"heapUsed"`
	External     uint64 `json:"external"`
	ArrayBuffers uint64 `json:"arrayBuffers"`
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request, _ map[string]string) {
	var stats runtime.MemStats
	runtime.ReadMemStats(&stats)

	writeJSON(w, http.StatusOK, healthResponse{
		Success: true,
		Status:  "healthy",
		Uptime:  time.Since(startedAt).Seconds(),
		Memory: memoryUsage{
			RSS:       stats.Sys,
			HeapTotal: stats.HeapSys,
			HeapUsed:  stats.HeapAlloc,
		},
		Debugging: s.isDebugging(),
	})
}

type debugConfigResponse struct {
	Success   bool `json:"success"`
	Debugging bool `json:"debugging"`
}

func (s *Server) handleGetDebugConfig(w http.ResponseWriter, _ *http.Request, _ map[string]string) {
	writeJSON(w, http.StatusOK, debugConfigResponse{Success: true, Debugging: s.isDebugging()})
}

type mostPlayedResponse struct {
	Success bool             `json:"success"`
	Data    []map[string]any `json:"data"`
	Total   int              `json:"total"`
}

func (s *Server) handleGetMostPlayed(w http.ResponseWriter, r *http.Request, _ map[string]string) {
	// parseInt(req.query.limit) || 10 - anything falsy falls back to ten.
	limit := "10"
	if raw := r.URL.Query().Get("limit"); raw != "" {
		if value, ok := jsParseInt(raw); ok && value != 0 {
			limit = strconv.FormatInt(value, 10)
		}
	}

	tracks, err := s.music.GetMostPlayedTracks(r.Context(), limit)
	if err != nil {
		fail(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, mostPlayedResponse{
		Success: true,
		Data:    tracks,
		Total:   len(tracks),
	})
}

type playStatsResponse struct {
	Success bool              `json:"success"`
	Data    musicdb.PlayStats `json:"data"`
}

func (s *Server) handleGetPlayStats(w http.ResponseWriter, r *http.Request, _ map[string]string) {
	stats, err := s.music.GetPlayStats(r.Context())
	if err != nil {
		fail(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, playStatsResponse{Success: true, Data: stats})
}

type playsResponse struct {
	Success bool                       `json:"success"`
	Plays   []musicdb.PlayHistoryEntry `json:"plays"`
	Count   int                        `json:"count"`
	Period  playsPeriod                `json:"period"`
}

type playsPeriod struct {
	Start string `json:"start"`
	End   string `json:"end"`
}

func (s *Server) handleGetPlays(w http.ResponseWriter, r *http.Request, _ map[string]string) {
	query := r.URL.Query()
	start := query.Get("start")
	end := query.Get("end")

	if start == "" || end == "" {
		fail(w, http.StatusBadRequest, "Start and end timestamps are required")
		return
	}

	startValue, startOK := jsParseInt(start)
	endValue, endOK := jsParseInt(end)
	if !startOK || !endOK {
		fail(w, http.StatusBadRequest, "Invalid timestamp format")
		return
	}

	plays, err := s.music.GetPlaysForPeriod(r.Context(),
		strconv.FormatInt(startValue, 10), strconv.FormatInt(endValue, 10))
	if err != nil {
		fail(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, playsResponse{
		Success: true,
		Plays:   plays,
		Count:   len(plays),
		Period: playsPeriod{
			Start: isoTimestamp(startValue),
			End:   isoTimestamp(endValue),
		},
	})
}

// isoTimestamp formats like Date.prototype.toISOString: always UTC, always with
// three decimal places.
func isoTimestamp(millis int64) string {
	return time.UnixMilli(millis).UTC().Format("2006-01-02T15:04:05.000Z")
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}
