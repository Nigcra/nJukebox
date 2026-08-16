// server_test.go
// Shared test server, built on empty databases created from the schema
// Version: 2026.08.16

package api

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Nigcra/nJukebox/internal/appdb"
	"github.com/Nigcra/nJukebox/internal/musicdb"
)

// newTestServer builds a server on databases created fresh in a temporary
// directory. Open() applies the schema itself, so nothing has to be checked in
// - a test that needs rows inserts them explicitly.
func newTestServer(t *testing.T) *Server {
	t.Helper()

	root := t.TempDir()
	dir := filepath.Join(root, "data")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatalf("create data directory: %v", err)
	}

	music, err := musicdb.Open(filepath.Join(dir, "music.db"))
	if err != nil {
		t.Fatalf("open music database: %v", err)
	}
	t.Cleanup(func() { music.Close() })

	app, err := appdb.Open(filepath.Join(dir, "app.db"))
	if err != nil {
		t.Fatalf("open app database: %v", err)
	}
	t.Cleanup(func() { app.Close() })

	return New(root, music, app, true)
}

// jsonRequest builds a request with the content type the handlers expect.
func jsonRequest(method, target, body string) *http.Request {
	r := httptest.NewRequest(method, target, strings.NewReader(body))
	if body != "" {
		r.Header.Set("Content-Type", "application/json")
	}
	return r
}
