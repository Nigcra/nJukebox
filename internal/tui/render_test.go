// render_test.go
// Renders every tab so the layout can be eyeballed and stays regression tested
// Version: 2026.08.16

package tui

import (
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	tea "github.com/charmbracelet/bubbletea"
)

// sample is a populated snapshot, so the views are exercised with real widths
// rather than a row of zeroes.
func sample() Snapshot {
	return Snapshot{
		Tracks:            12483,
		Artists:           947,
		Albums:            1622,
		Genres:            41,
		Plays:             38215,
		Duration:          892 * time.Hour,
		Sessions:          3,
		SpotifyConfigured: true,
		SpotifyConnected:  true,
		SpotifyExpires:    time.Date(2026, 8, 16, 14, 32, 5, 0, time.Local),
		MusicDir:          `C:\Users\Nigcra\Desktop\nJukebox\music`,
		LastScanText:      "12483 files, 17 updated, 0 removed (4.812s)",
	}
}

func newTestModel(snap Snapshot) *model {
	m := New(Config{
		WebURL:   "http://127.0.0.1:5500/",
		WebAddr:  "127.0.0.1:5500",
		DataAddr: "127.0.0.1:3001",
		Root:     `C:\Users\Nigcra\Desktop\nJukebox`,
		Stats:    func() Snapshot { return snap },
		Rescan:   func() {},
	})
	m.Update(tea.WindowSizeMsg{Width: 120, Height: 34})
	m.snap = snap
	return m
}

// TestViewsRender walks every tab and checks the content that must appear.
func TestViewsRender(t *testing.T) {
	m := newTestModel(sample())
	m.appendLog(Event{Time: time.Now(), Level: "ok", Message: "Data server listening on http://127.0.0.1:3001"})
	m.appendLog(Event{Time: time.Now(), Level: "warn", Message: "[SCANNER] could not watch music: permission denied"})
	m.appendLog(Event{Time: time.Now(), Level: "error", Message: "initial scan failed: disk offline"})

	cases := []struct {
		tab  tabIndex
		want []string
	}{
		{tabDashboard, []string{"Tracks", "12 483", "Artists", "Spotify", "Data API", "Uptime", "127.0.0.1:3001"}},
		{tabLibrary, []string{"Music library", "Scanner", "Last scan", "12483 files", "linked", "Genres"}},
		{tabLogs, []string{"Event log", "listening", "scan failed"}},
	}

	for _, tc := range cases {
		m.tab = tc.tab
		view := m.View()
		for _, want := range tc.want {
			if !strings.Contains(stripANSI(view), want) {
				t.Errorf("tab %d: view is missing %q", tc.tab, want)
			}
		}
		// The status bar is pinned to the bottom on every tab.
		if !strings.Contains(stripANSI(view), "tracks") {
			t.Errorf("tab %d: status bar missing", tc.tab)
		}
	}
}

// TestViewFitsTerminal guards the pinned status bar: the rendered frame must
// never be taller than the terminal, or the bar scrolls out of sight.
func TestViewFitsTerminal(t *testing.T) {
	for _, size := range []struct{ w, h int }{{80, 24}, {120, 34}, {200, 60}} {
		m := newTestModel(sample())
		m.Update(tea.WindowSizeMsg{Width: size.w, Height: size.h})
		for tab := tabDashboard; tab <= tabLogs; tab++ {
			m.tab = tab
			lines := strings.Split(m.View(), "\n")
			if len(lines) > size.h {
				t.Errorf("%dx%d tab %d: %d lines exceed the terminal height",
					size.w, size.h, tab, len(lines))
			}
		}
	}
}

// TestEmptySnapshot covers a server that has not collected anything yet and a
// --web-only start, where there is no scanner and no data listener.
func TestEmptySnapshot(t *testing.T) {
	m := New(Config{
		WebURL:  "http://127.0.0.1:5500/",
		WebAddr: "127.0.0.1:5500",
		Root:    `C:\njukebox`,
		Stats:   func() Snapshot { return Snapshot{} },
	})
	m.Update(tea.WindowSizeMsg{Width: 100, Height: 30})

	for tab := tabDashboard; tab <= tabLogs; tab++ {
		m.tab = tab
		view := stripANSI(m.View())
		if strings.TrimSpace(view) == "" {
			t.Fatalf("tab %d rendered nothing", tab)
		}
		if tab == tabDashboard && !strings.Contains(view, "off") {
			t.Error("dashboard should mark the missing data listener as off")
		}
	}

	// Without a scanner the rescan hint must not be offered.
	m.tab = tabDashboard
	if strings.Contains(stripANSI(m.View()), "Rescan library") {
		t.Error("rescan hint shown although no scanner is running")
	}
}

// TestFatalErrorSurfaces checks that a dead listener is visible rather than
// silently leaving the figures on screen.
func TestFatalErrorSurfaces(t *testing.T) {
	snap := sample()
	snap.Err = errors.New("listen tcp 127.0.0.1:5500: address already in use")
	m := newTestModel(snap)

	view := stripANSI(m.View())
	if !strings.Contains(view, "address already in use") {
		t.Error("listener error not shown on the dashboard")
	}
	if !strings.Contains(view, "● error") {
		t.Error("status bar does not show the error state")
	}
}

func TestFormatCount(t *testing.T) {
	cases := map[int64]string{0: "0", 42: "42", 999: "999", 1000: "1 000", 12483: "12 483", 1234567: "1 234 567"}
	for in, want := range cases {
		if got := formatCount(in); got != want {
			t.Errorf("formatCount(%d) = %q, want %q", in, got, want)
		}
	}
}

func TestFormatDuration(t *testing.T) {
	cases := map[time.Duration]string{
		0:                            "–",
		45 * time.Second:             "45s",
		90 * time.Second:             "1m 30s",
		3 * time.Hour:                "3h 0m",
		50 * time.Hour:               "2d 2h",
		892 * time.Hour:              "37d 4h",
		-1 * time.Second:             "–",
		2*time.Hour + 30*time.Minute: "2h 30m",
	}
	for in, want := range cases {
		if got := formatDuration(in); got != want {
			t.Errorf("formatDuration(%v) = %q, want %q", in, got, want)
		}
	}
}

// TestLogSinkNeverBlocks is the property that matters most about the sink: the
// server logs from request paths, and a full buffer must not stall them.
func TestLogSinkNeverBlocks(t *testing.T) {
	sink := NewLogSink(4)

	done := make(chan struct{})
	go func() {
		for i := 0; i < 1000; i++ {
			sink.Write([]byte("line\n"))
		}
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("writing to a full sink blocked")
	}

	if sink.Dropped() == 0 {
		t.Error("expected dropped events with a buffer of 4 and 1000 writes")
	}
	// The newest events survive, so the tail of the log is what is kept.
	select {
	case event := <-sink.Events():
		if event.Message != "line" {
			t.Errorf("unexpected event %q", event.Message)
		}
	default:
		t.Error("sink is empty although it should hold the newest events")
	}
}

func TestLogSinkClassifiesAndSplits(t *testing.T) {
	sink := NewLogSink(16)
	sink.Write([]byte("Data server listening on http://127.0.0.1:3001\n[SCANNER] initial scan failed: disk gone\n"))

	first := <-sink.Events()
	if first.Level != "ok" {
		t.Errorf("listening line classified as %q, want ok", first.Level)
	}
	second := <-sink.Events()
	if second.Level != "error" {
		t.Errorf("failure line classified as %q, want error", second.Level)
	}
	if strings.Contains(second.Message, "\n") {
		t.Error("multi-line write was not split")
	}
}

// TestDumpViews writes the rendered tabs to a file when TUI_DUMP is set, so the
// layout can be inspected with real colours. Not an assertion.
func TestDumpViews(t *testing.T) {
	path := os.Getenv("TUI_DUMP")
	if path == "" {
		t.Skip("set TUI_DUMP=<file> to dump the rendered views")
	}

	m := newTestModel(sample())
	m.appendLog(Event{Time: time.Now(), Level: "ok", Message: "Data server listening on http://127.0.0.1:3001"})
	m.appendLog(Event{Time: time.Now(), Level: "", Message: "Configuration loaded from config.json"})
	m.appendLog(Event{Time: time.Now(), Level: "warn", Message: "ignoring PORT=8080: it cannot apply to both listeners"})
	m.appendLog(Event{Time: time.Now(), Level: "ok", Message: "[SCANNER] initial scan completed: 12483 files, 17 updated"})
	m.appendLog(Event{Time: time.Now(), Level: "error", Message: "[SCANNER] could not watch music: permission denied"})

	var out strings.Builder
	for tab, name := range tabNames {
		m.tab = tabIndex(tab)
		out.WriteString("\n===== " + name + " =====\n")
		out.WriteString(m.View())
		out.WriteString("\n")
	}
	if err := os.WriteFile(path, []byte(out.String()), 0o644); err != nil {
		t.Fatal(err)
	}
}

// stripANSI removes escape sequences so assertions match on the text.
func stripANSI(s string) string {
	var b strings.Builder
	for i := 0; i < len(s); {
		if s[i] == 0x1b {
			for i < len(s) && s[i] != 'm' {
				i++
			}
			i++ // skip the terminating m
			continue
		}
		b.WriteByte(s[i])
		i++
	}
	return b.String()
}
