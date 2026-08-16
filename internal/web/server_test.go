// server_test.go
// Verifies the rewrites, the allowlist and that nothing above the root is served
// Version: 2026.08.16

package web

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

// fixture builds a project directory of the real shape: the frontend under
// web/, everything the browser must never see next to it.
func fixture(t *testing.T) string {
	t.Helper()
	project := t.TempDir()

	write := func(rel, body string) {
		full := filepath.Join(project, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			t.Fatalf("create %s: %v", rel, err)
		}
		if err := os.WriteFile(full, []byte(body), 0o644); err != nil {
			t.Fatalf("write %s: %v", rel, err)
		}
	}

	write("web/jukebox.html", "<!doctype html>")
	write("web/spotify_login.html", "<!doctype html>")
	write("web/style.css", "body{}")
	write("web/jukebox.js", "// main")
	write("web/js/visualizer.js", "// module")
	write("web/assets/default_cover.png", "\x89PNG")
	write("web/locales/de.json", `{"a":1}`)

	// Not below the web root and therefore unreachable by construction. These
	// have to exist for the test to mean anything - a path that 404s because
	// the file is missing proves nothing about the allowlist.
	write("config.json", `{"server":{"webPort":5500}}`)
	write("go.mod", "module example")
	write("data/app.db", "SQLite format 3")
	write("internal/web/server.go", "package web")
	write("tools/verify_web.ps1", "# tooling")
	write("go.sum", "h1:example")

	return project
}

func newTestServer(t *testing.T) *Server {
	t.Helper()
	s, err := New(filepath.Join(fixture(t), "web"), "127.0.0.1", 0)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	return s
}

func get(t *testing.T, s *Server, target string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	s.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, target, nil))
	return rec
}

func TestServesTheFrontend(t *testing.T) {
	s := newTestServer(t)

	for _, c := range []struct {
		target string
		typ    string
	}{
		{"/", "text/html"},
		{"/index_web", "text/html"},
		{"/spotify_player", "text/html"},
		{"/style.css", "text/css"},
		{"/style.css?v=123", "text/css"},
		{"/jukebox.js", "application/javascript"},
		{"/js/visualizer.js", "application/javascript"},
		{"/assets/default_cover.png", "image/png"},
		{"/locales/de.json", "application/json"},
	} {
		rec := get(t, s, c.target)
		if rec.Code != http.StatusOK {
			t.Errorf("GET %s = %d, want 200", c.target, rec.Code)
			continue
		}
		if got := rec.Header().Get("Content-Type"); got != c.typ {
			t.Errorf("GET %s content type = %q, want %q", c.target, got, c.typ)
		}
	}
}

// S2. The web root is web/, so these are not below it at all - which is the
// point of the move. config.json is the one that used to be served.
func TestDoesNotServeAnythingOutsideTheWebRoot(t *testing.T) {
	s := newTestServer(t)

	for _, target := range []string{
		"/config.json",
		"/go.mod",
		"/data/app.db",
		"/internal/web/server.go",
		"/CLAUDE.md",
		"/.git/config",
		"/tools/verify_web.ps1",
		"/go.sum",
		// The frontend must not be reachable through its directory name either,
		// which would happen if the root were still the project directory.
		"/web/style.css",
		"/web/jukebox.html",
		"/does_not_exist.js",
	} {
		if rec := get(t, s, target); rec.Code != http.StatusNotFound {
			t.Errorf("GET %s = %d, want 404", target, rec.Code)
		}
	}
}

// S1. Nothing may escape the root, whatever the separator or encoding.
func TestRejectsTraversal(t *testing.T) {
	s := newTestServer(t)

	for _, target := range []string{
		"/../config.json",
		"/../../../../Windows/win.ini",
		"/..%2F..%2Fconfig.json",
		"/js/../../config.json",
		`/js\..\..\config.json`,
		"/js/../../../Windows/win.ini",
	} {
		if rec := get(t, s, target); rec.Code != http.StatusNotFound {
			t.Errorf("GET %s = %d, want 404", target, rec.Code)
		}
	}
}
