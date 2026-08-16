// program_test.go
// Drives the update loop: keys, tab switching, events and quitting
// Version: 2026.08.16

package tui

import (
	"strings"
	"sync/atomic"
	"testing"
	"time"

	tea "github.com/charmbracelet/bubbletea"
)

// press feeds one key through Update, the same way Bubble Tea would. The
// program's own input driver is platform specific and headless-hostile, so the
// tests drive the model directly - that is the part this package owns.
func press(m *model, key string) tea.Cmd {
	var msg tea.Msg
	switch key {
	case "left", "right", "tab", "shift+tab", "esc":
		msg = tea.KeyMsg{Type: keyType(key)}
	default:
		msg = tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune(key)}
	}
	_, cmd := m.Update(msg)
	return cmd
}

func keyType(name string) tea.KeyType {
	switch name {
	case "left":
		return tea.KeyLeft
	case "right":
		return tea.KeyRight
	case "tab":
		return tea.KeyTab
	case "shift+tab":
		return tea.KeyShiftTab
	default:
		return tea.KeyEsc
	}
}

func TestTabKeys(t *testing.T) {
	m := newTestModel(sample())

	for _, tc := range []struct {
		key  string
		want tabIndex
	}{
		{"2", tabLibrary},
		{"3", tabLogs},
		{"1", tabDashboard},
		{"right", tabLibrary},
		{"right", tabLogs},
		{"right", tabDashboard}, // wraps
		{"left", tabLogs},       // wraps back
		{"tab", tabDashboard},
		{"shift+tab", tabLogs},
	} {
		press(m, tc.key)
		if m.tab != tc.want {
			t.Errorf("after %q the tab is %d, want %d", tc.key, m.tab, tc.want)
		}
	}
}

func TestQuitKeys(t *testing.T) {
	for _, key := range []string{"q", "esc"} {
		m := newTestModel(sample())
		cmd := press(m, key)
		if !m.quitting {
			t.Errorf("%q did not set quitting", key)
		}
		if cmd == nil {
			t.Errorf("%q returned no command, expected tea.Quit", key)
		}
		if view := m.View(); !strings.Contains(view, "Stopping") {
			t.Errorf("%q: view after quit is %q", key, view)
		}
	}
}

func TestRescanKey(t *testing.T) {
	var calls atomic.Int32
	m := New(Config{
		WebURL: "http://127.0.0.1:5500/",
		Root:   `C:\njukebox`,
		Stats:  func() Snapshot { return sample() },
		Rescan: func() { calls.Add(1) },
	})
	m.Update(tea.WindowSizeMsg{Width: 120, Height: 34})

	press(m, "r")
	if got := calls.Load(); got != 1 {
		t.Fatalf("rescan called %d times, want 1", got)
	}
	if len(m.logs) == 0 || !strings.Contains(stripANSI(m.logs[len(m.logs)-1]), "rescan requested") {
		t.Error("rescan was not written to the event log")
	}

	// With no scanner the key must be inert rather than panic on a nil callback.
	bare := newTestModel(sample())
	bare.cfg.Rescan = nil
	press(bare, "r")
}

// TestEventPipeline covers the path from a server log line to the screen: the
// sink classifies it, waitForEvent picks it up, Update appends it.
func TestEventPipeline(t *testing.T) {
	sink := NewLogSink(8)
	m := New(Config{
		WebURL: "http://127.0.0.1:5500/",
		Root:   `C:\njukebox`,
		Stats:  func() Snapshot { return Snapshot{} },
		Events: sink.Events(),
	})
	m.Update(tea.WindowSizeMsg{Width: 120, Height: 34})
	m.tab = tabLogs

	sink.Write([]byte("Data server listening on http://127.0.0.1:3001\n"))

	// Init wires the event wait; run the command the way Bubble Tea would.
	cmd := waitForEvent(m.cfg.Events)
	if cmd == nil {
		t.Fatal("no event command")
	}
	msg := cmd()
	event, ok := msg.(eventMsg)
	if !ok {
		t.Fatalf("got %T, want eventMsg", msg)
	}
	if _, next := m.Update(event); next == nil {
		t.Error("Update did not re-arm the event wait")
	}

	view := stripANSI(m.View())
	if !strings.Contains(view, "Data server listening") {
		t.Error("the event never reached the screen")
	}
	if event.Level != "ok" {
		t.Errorf("event level %q, want ok", event.Level)
	}
}

// TestTickRefreshesSnapshot proves the figures actually update over time rather
// than freezing on whatever was collected at startup.
func TestTickRefreshesSnapshot(t *testing.T) {
	var tracks atomic.Int64
	tracks.Store(10)

	m := New(Config{
		WebURL: "http://127.0.0.1:5500/",
		Root:   `C:\njukebox`,
		Stats:  func() Snapshot { return Snapshot{Tracks: tracks.Load()} },
	})
	m.Update(tea.WindowSizeMsg{Width: 120, Height: 34})

	if !strings.Contains(stripANSI(m.View()), "10") {
		t.Fatal("initial snapshot not shown")
	}

	tracks.Store(4711)
	if _, cmd := m.Update(tickMsg(time.Now())); cmd == nil {
		t.Error("tick did not schedule the next one")
	}
	if got := stripANSI(m.View()); !strings.Contains(got, "4 711") {
		t.Error("view still shows the stale figure after a tick")
	}
}

// TestNilEventChannel guards the --web-only path, where nothing produces events.
func TestNilEventChannel(t *testing.T) {
	m := New(Config{
		WebURL: "http://127.0.0.1:5500/",
		Root:   `C:\njukebox`,
		Stats:  func() Snapshot { return Snapshot{} },
	})
	m.Update(tea.WindowSizeMsg{Width: 100, Height: 30})

	if cmd := waitForEvent(nil); cmd != nil {
		t.Error("waitForEvent(nil) must not return a command")
	}
	if cmd := m.Init(); cmd == nil {
		t.Error("Init must still schedule the tick without an event channel")
	}
}
