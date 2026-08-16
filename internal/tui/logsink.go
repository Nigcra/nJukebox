// logsink.go
// Captures the standard logger so the TUI can show it instead of stdout
// Version: 2026.08.16

package tui

import (
	"strings"
	"sync"
	"time"
)

// Event is one line of the event log.
type Event struct {
	Time    time.Time
	Level   string // "ok", "warn", "error" or "" for plain information
	Message string
}

// LogSink is an io.Writer for log.SetOutput. Everything the server logs ends up
// in the TUI rather than on stdout, which would tear holes into the alt screen.
//
// Writes never block. A server that cannot log because nobody drains the
// channel would be a far worse failure than a dropped line, so a full buffer
// discards the oldest entry instead of stalling the caller.
type LogSink struct {
	mu      sync.Mutex
	events  chan Event
	dropped int
}

// NewLogSink returns a sink buffering up to size events.
func NewLogSink(size int) *LogSink {
	if size < 1 {
		size = 256
	}
	return &LogSink{events: make(chan Event, size)}
}

// Events is the channel the TUI reads from.
func (s *LogSink) Events() <-chan Event { return s.events }

// Write implements io.Writer for the log package.
func (s *LogSink) Write(p []byte) (int, error) {
	for _, line := range strings.Split(strings.TrimRight(string(p), "\n"), "\n") {
		if trimmed := strings.TrimSpace(line); trimmed != "" {
			s.Emit(classify(trimmed), trimmed)
		}
	}
	return len(p), nil
}

// Emit pushes one event, dropping the oldest if the buffer is full.
func (s *LogSink) Emit(level, message string) {
	event := Event{Time: time.Now(), Level: level, Message: message}

	s.mu.Lock()
	defer s.mu.Unlock()

	select {
	case s.events <- event:
	default:
		// Make room and retry once. Both operations are non-blocking, so a
		// reader racing us can only make the send succeed sooner.
		select {
		case <-s.events:
			s.dropped++
		default:
		}
		select {
		case s.events <- event:
		default:
			s.dropped++
		}
	}
}

// Dropped reports how many events were discarded because the buffer was full.
func (s *LogSink) Dropped() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.dropped
}

// classify guesses a severity from the message. The server logs through the
// plain log package without levels, so the wording is all there is to go on.
func classify(message string) string {
	lower := strings.ToLower(message)

	switch {
	case containsAny(lower, "failed", "error", "cannot", "could not", "fatal", "refused", "denied"):
		return "error"
	case containsAny(lower, "warn", "ignoring", "retry", "missing", "unreachable"):
		return "warn"
	case containsAny(lower, "listening", "completed", "available", "loaded", "started"):
		return "ok"
	default:
		return ""
	}
}

func containsAny(haystack string, needles ...string) bool {
	for _, needle := range needles {
		if strings.Contains(haystack, needle) {
			return true
		}
	}
	return false
}
