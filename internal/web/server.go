// server.go
// Static web server with URL rewrites, serving only an explicit allowlist of paths
// Version: 2026.08.13

package web

import (
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strings"
)

// URL rewrites, applied to the raw request path before decoding.
var rewrites = map[string]string{
	"/spotify_player": "/spotify_login.html",
	"/index_web":      "/jukebox.html",
	"/":               "/jukebox.html",
}

// Content types by file extension. Anything not listed is served as
// application/octet-stream - that includes .woff2, which is deliberately kept
// as is because the Node server behaves the same way.
var mimeTypes = map[string]string{
	".html": "text/html",
	".js":   "application/javascript",
	".css":  "text/css",
	".json": "application/json",
	".png":  "image/png",
	".jpg":  "image/jpeg",
	".jpeg": "image/jpeg",
	".svg":  "image/svg+xml",
	".ico":  "image/x-icon",
}

// The allowlist closes S2. It is the second of two barriers now: the web root
// is web/, so data/app.db with the Spotify tokens, the sources and the tooling
// are not below it at all - the Node server served the project directory and
// handed all of that out. The list stays because a directory below web/ can
// still gain a file nobody meant to publish.
//
// config.json is deliberately absent. It sits in the project root as server
// configuration, no frontend code ever fetched it, and the Node web root only
// served it because it happened to lie there.
var allowedFiles = map[string]bool{
	"jukebox.html":       true,
	"spotify_login.html": true,
	"style.css":          true,
	"jukebox.js":         true,
}

// cache/ holds pre-generated track suggestions the frontend fetches in
// loadDefaultSuggestions(). Nothing writes those files today, so the request
// answers 404 either way - but the Node web root served them, and leaving the
// directory out would turn a missing optional cache into a permanent one.
var allowedDirs = []string{"js/", "assets/", "locales/", "cache/"}

// Server serves the frontend files from a fixed root directory.
type Server struct {
	root string
	host string
	port int
}

// New returns a server rooted at root. The root is resolved to an absolute,
// cleaned path because the traversal check depends on it.
func New(root, host string, port int) (*Server, error) {
	abs, err := filepath.Abs(root)
	if err != nil {
		return nil, fmt.Errorf("resolve web root: %w", err)
	}
	info, err := os.Stat(abs)
	if err != nil {
		return nil, fmt.Errorf("web root not readable: %w", err)
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("web root is not a directory: %s", abs)
	}
	return &Server{root: filepath.Clean(abs), host: host, port: port}, nil
}

// Addr is the listen address.
func (s *Server) Addr() string {
	return fmt.Sprintf("%s:%d", s.host, s.port)
}

// ListenAndServe starts the listener and blocks.
func (s *Server) ListenAndServe() error {
	log.Printf("Web server listening on http://%s:%d", s.host, s.port)
	if s.host == "0.0.0.0" {
		log.Print("Web server is reachable from all network interfaces")
	}
	log.Printf("Serving from %s", s.root)

	srv := &http.Server{Addr: s.Addr(), Handler: s}
	return srv.ListenAndServe()
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// EscapedPath keeps percent sequences intact, which is what the Node
	// server matched its rewrites against.
	raw := r.URL.EscapedPath()
	if rewritten, ok := rewrites[raw]; ok {
		raw = rewritten
	}

	// A malformed percent sequence is not an error here: the Node server logs
	// it and falls back to the undecoded value.
	decoded, err := url.PathUnescape(raw)
	if err != nil {
		log.Printf("URI decode error for URL %q: %v", raw, err)
		decoded = raw
	}

	// Second candidate: the undecoded path, mirroring the Node fallback that
	// retried with the raw request URL. It only ever matches a file whose name
	// contains a literal percent sequence.
	candidates := []string{decoded}
	if raw != decoded {
		candidates = append(candidates, raw)
	}

	for _, candidate := range candidates {
		full, ok := s.resolve(candidate)
		if !ok {
			continue
		}
		info, err := os.Stat(full)
		if err != nil || !info.Mode().IsRegular() {
			continue
		}
		s.sendFile(w, full)
		return
	}

	notFound(w)
}

// resolve maps a URL path to a file below the root, or reports that it must not
// be served. It closes S1 and S2 in that order: the path is normalized so that
// no traversal survives, then checked against the allowlist, then verified to
// still sit below the root.
func (s *Server) resolve(urlPath string) (string, bool) {
	// A backslash is a path separator on Windows but not in a URL. Rejecting it
	// outright keeps the normalization below meaningful.
	if strings.ContainsAny(urlPath, `\`) || strings.ContainsRune(urlPath, 0) {
		return "", false
	}

	// path.Clean resolves ".." segments; anything reaching above the root is
	// collapsed to the root itself and can therefore never escape.
	rel := strings.TrimPrefix(path.Clean("/"+strings.TrimPrefix(urlPath, "/")), "/")
	if rel == "" || rel == "." {
		return "", false
	}

	if !allowed(rel) {
		return "", false
	}

	full := filepath.Join(s.root, filepath.FromSlash(rel))

	// Second barrier. Redundant after Clean and the allowlist, but the cost of
	// getting this wrong is the whole file system.
	if !strings.HasPrefix(full, s.root+string(filepath.Separator)) {
		return "", false
	}

	return full, true
}

func allowed(rel string) bool {
	if allowedFiles[rel] {
		return true
	}
	for _, dir := range allowedDirs {
		if strings.HasPrefix(rel, dir) {
			return true
		}
	}
	return false
}

func (s *Server) sendFile(w http.ResponseWriter, full string) {
	data, err := os.ReadFile(full)
	if err != nil {
		notFound(w)
		return
	}

	contentType, ok := mimeTypes[filepath.Ext(full)]
	if !ok {
		contentType = "application/octet-stream"
	}

	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Length", fmt.Sprint(len(data)))
	w.WriteHeader(http.StatusOK)
	if _, err := w.Write(data); err != nil {
		log.Printf("write failed for %s: %v", full, err)
	}
}

// notFound answers exactly like the Node server did: status 404, body
// "Not found", no content type.
func notFound(w http.ResponseWriter) {
	w.Header()["Content-Type"] = nil
	w.WriteHeader(http.StatusNotFound)
	if _, err := w.Write([]byte("Not found")); err != nil {
		log.Printf("write failed for 404 response: %v", err)
	}
}
