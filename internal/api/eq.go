// eq.go
// Server-Sent Events stream of the loopback spectrum for the footer equalizer
// Version: 2026.08.14

package api

import (
	"encoding/base64"
	"fmt"
	"net/http"

	"github.com/Nigcra/nJukebox/internal/eq"
)

// RegisterEqualizer wires up the loopback spectrum engine. Stays nil on
// platforms without capture support; the endpoint then answers 503 and the
// frontend keeps its analyser fallback.
func (s *Server) RegisterEqualizer(engine *eq.Engine) {
	s.eq = engine
}

// handleEqStream pushes base64 encoded 256 byte spectrum frames as SSE. The
// capture starts with the first subscriber and stops with the last, so the
// audio device is only held while a browser is actually listening.
func (s *Server) handleEqStream(w http.ResponseWriter, r *http.Request, _ map[string]string) {
	if s.eq == nil {
		http.Error(w, "loopback capture not supported on this platform", http.StatusServiceUnavailable)
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusServiceUnavailable)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")

	frames, cancel := s.eq.Subscribe()
	defer cancel()

	fmt.Fprint(w, "retry: 5000\n\n")
	flusher.Flush()

	for {
		select {
		case <-r.Context().Done():
			return
		case frame := <-frames:
			fmt.Fprintf(w, "data: %s\n\n", base64.StdEncoding.EncodeToString(frame))
			flusher.Flush()
		}
	}
}
