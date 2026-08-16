// covers.go
// Cover endpoints: track cover, album cover and the cached artist mosaic
// Version: 2026.08.16

package api

import (
	"errors"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
	"unicode/utf16"

	"github.com/Nigcra/nJukebox/internal/imaging"
)

// artistCoverMaxAge is the lifetime of a cached artist mosaic. A younger file is
// served untouched, only an older one is regenerated.
const artistCoverMaxAge = 24 * time.Hour

// handleGetCover serves the cover of a single track.
func (s *Server) handleGetCover(w http.ResponseWriter, r *http.Request, params map[string]string) {
	id := params["id"]

	// Both headers are set before any lookup happens, so even the default cover
	// carries the ETag of the requested id. The value is derived from the once
	// decoded parameter, which is what Express handed to the handler.
	w.Header().Set("Cache-Control", "public, max-age=3600")
	w.Header().Set("ETag", `"cover-`+id+`"`)

	track, err := s.music.GetTrackByID(r.Context(), id)
	if err != nil {
		// The Node handler caught every error and answered with the default
		// cover instead of a status code.
		log.Printf("[COVER] error fetching cover: %v", err)
		s.sendDefaultCover(w, r)
		return
	}

	// !track.cover_path in JavaScript is true for null and for an empty string.
	if track == nil || track.CoverPath == nil || *track.CoverPath == "" {
		// A Spotify row has no extracted cover but carries an image url.
		if track != nil && track.ImageURL != nil && *track.ImageURL != "" {
			http.Redirect(w, r, *track.ImageURL, http.StatusFound)
			return
		}
		s.sendDefaultCover(w, r)
		return
	}

	coverPath := s.joinRoot(*track.CoverPath)
	if !fileExists(coverPath) {
		s.sendDefaultCover(w, r)
		return
	}

	s.sendFile(w, r, coverPath)
}

// handleGetAlbumCover serves the cover of an album addressed as "artist||album".
func (s *Server) handleGetAlbumCover(w http.ResponseWriter, r *http.Request, params map[string]string) {
	raw := params["albumKey"]

	w.Header().Set("Cache-Control", "public, max-age=3600")
	w.Header().Set("ETag", `"album-`+etagSegment(raw)+`"`)

	if s.isDebugging() {
		log.Printf("[COVER] Requesting album cover for: %s", raw)
	}

	// The handler decoded the already decoded parameter a second time. That is
	// defect D3 and it is reproduced on purpose - the golden baseline froze it.
	albumKey := decodeAgain(raw)

	parts := strings.Split(albumKey, "||")
	artist := parts[0]
	album := ""
	if len(parts) > 1 {
		album = parts[1]
	}

	// Destructuring gives undefined for a missing second element, and both an
	// empty string and undefined are falsy.
	if artist == "" || album == "" {
		s.sendDefaultCover(w, r)
		return
	}

	trackWithCover, err := s.music.GetTrackWithCover(r.Context(), artist, album)
	if err != nil {
		log.Printf("[COVER] error fetching album cover: %v", err)
		s.sendDefaultCover(w, r)
		return
	}
	if trackWithCover == nil || trackWithCover.CoverPath == nil || *trackWithCover.CoverPath == "" {
		s.sendAlbumFallback(w, r, artist, album)
		return
	}

	coverPath := s.joinRoot(*trackWithCover.CoverPath)
	if !fileExists(coverPath) {
		s.sendAlbumFallback(w, r, artist, album)
		return
	}

	s.sendFile(w, r, coverPath)
}

// handleGetArtistCover serves a mosaic built from all album covers of an artist.
// The mosaic is cached on disk for 24 hours.
func (s *Server) handleGetArtistCover(w http.ResponseWriter, r *http.Request, params map[string]string) {
	raw := params["artistName"]

	w.Header().Set("Cache-Control", "public, max-age=3600")
	w.Header().Set("ETag", `"artist-`+etagSegment(raw)+`"`)

	artistName := decodeAgain(raw)

	covers, err := s.music.GetArtistAlbumCovers(r.Context(), artistName)
	if err != nil {
		log.Printf("[COVER] error creating artist cover: %v", err)
		s.sendDefaultCover(w, r)
		return
	}
	if len(covers) == 0 {
		s.sendArtistFallback(w, r, artistName)
		return
	}

	cacheDir := filepath.Join(s.root, "data", "artist-covers")
	if err := os.MkdirAll(cacheDir, 0o755); err != nil {
		log.Printf("[COVER] error creating artist cover cache directory: %v", err)
		s.sendDefaultCover(w, r)
		return
	}

	cachePath := filepath.Join(cacheDir, safeArtistName(artistName)+"_mosaic.jpg")
	if info, err := os.Stat(cachePath); err == nil && time.Since(info.ModTime()) < artistCoverMaxAge {
		if s.isDebugging() {
			log.Printf("[COVER] Serving cached artist cover: %s", cachePath)
		}
		s.sendFile(w, r, cachePath)
		return
	}

	if s.isDebugging() {
		log.Printf("[COVER] Generating new artist mosaic for: %s", artistName)
	}

	// A NULL cover_path cannot occur - the query filters it out - but an empty
	// path simply fails to open and leaves its cell empty, which keeps the grid
	// size derived from the full row count.
	coverPaths := make([]string, len(covers))
	for i, cover := range covers {
		if cover.CoverPath == nil {
			continue
		}
		coverPaths[i] = s.joinRoot(*cover.CoverPath)
	}

	mosaic, err := imaging.Mosaic(coverPaths)
	if err != nil {
		if !errors.Is(err, imaging.ErrNoCovers) {
			log.Printf("[COVER] error creating artist cover: %v", err)
		}
		s.sendArtistFallback(w, r, artistName)
		return
	}

	// Writing the cache happened inside the try block, so a failing write ended
	// in the catch and produced the default cover instead of the mosaic.
	if err := os.WriteFile(cachePath, mosaic, 0o644); err != nil {
		log.Printf("[COVER] error caching artist cover: %v", err)
		s.sendDefaultCover(w, r)
		return
	}

	// res.send() on a buffer: content type and length, no Accept-Ranges. The
	// cache lifetime replaces the browser cache header set at the top.
	w.Header().Set("Content-Type", "image/jpeg")
	w.Header().Set("Cache-Control", "public, max-age=86400")
	w.Header().Set("Content-Length", strconv.Itoa(len(mosaic)))
	w.WriteHeader(http.StatusOK)

	if _, err := w.Write(mosaic); err != nil {
		log.Printf("[COVER] write mosaic response: %v", err)
	}
}

// sendDefaultCover answers with the fallback image of every cover endpoint. It
// lives in the frontend directory because the browser loads it directly as
// well, so this reads across into web/ rather than from the project root.
func (s *Server) sendDefaultCover(w http.ResponseWriter, r *http.Request) {
	s.sendFile(w, r, filepath.Join(s.root, "web", "assets", "default_cover.png"))
}

// sendAlbumFallback answers when no cover was extracted from a file. A title
// that only exists on Spotify has no file and therefore no extracted cover, but
// it carries an image url - and that image sits on Spotify's CDN, so a redirect
// is enough. Nothing has to be pulled through this server.
//
// Local files keep precedence: this runs only after the tracks table came up
// empty, so an album that has both still shows its own cover.
func (s *Server) sendAlbumFallback(w http.ResponseWriter, r *http.Request, artist, album string) {
	image, err := s.music.GetSpotifyAlbumImage(r.Context(), artist, album)
	if err != nil {
		log.Printf("[COVER] error fetching spotify album image: %v", err)
	}
	if image != "" {
		http.Redirect(w, r, image, http.StatusFound)
		return
	}
	s.sendDefaultCover(w, r)
}

// sendArtistFallback is the same idea for the artist mosaic, which needs local
// files to tile. An artist that only exists on Spotify gets a single image.
func (s *Server) sendArtistFallback(w http.ResponseWriter, r *http.Request, artist string) {
	image, err := s.music.GetSpotifyArtistImage(r.Context(), artist)
	if err != nil {
		log.Printf("[COVER] error fetching spotify artist image: %v", err)
	}
	if image != "" {
		http.Redirect(w, r, image, http.StatusFound)
		return
	}
	s.sendDefaultCover(w, r)
}

// sendFile serves a file the way res.sendFile() did: content type from the
// extension, byte ranges enabled, and headers that are already set are kept.
func (s *Server) sendFile(w http.ResponseWriter, r *http.Request, path string) {
	file, err := os.Open(path)
	if err != nil {
		// Unreachable for the default cover, and every other caller checks the
		// file first. Express forwarded the error to its 404 handler.
		log.Printf("[COVER] cannot open %s: %v", path, err)
		http.Error(w, "Not Found", http.StatusNotFound)
		return
	}
	defer file.Close()

	info, err := file.Stat()
	if err != nil || info.IsDir() {
		log.Printf("[COVER] cannot stat %s: %v", path, err)
		http.Error(w, "Not Found", http.StatusNotFound)
		return
	}

	// Setting the type explicitly keeps ServeContent from sniffing and keeps the
	// answer independent of the MIME registry of the host.
	if w.Header().Get("Content-Type") == "" {
		w.Header().Set("Content-Type", contentTypeFor(path))
	}
	w.Header().Set("Accept-Ranges", "bytes")

	http.ServeContent(w, r, "", info.ModTime(), file)
}

// contentTypeFor maps the extensions the cover directories can contain. Express
// used the mime database and fell back to application/octet-stream.
func contentTypeFor(path string) string {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".png":
		return "image/png"
	case ".gif":
		return "image/gif"
	case ".webp":
		return "image/webp"
	case ".bmp":
		return "image/bmp"
	default:
		return "application/octet-stream"
	}
}

// joinRoot resolves a path stored in the database against the project root.
// Existing rows carry Windows separators ("data\covers\cover.jpg"), so both
// separators have to work (R7).
func (s *Server) joinRoot(stored string) string {
	normalized := strings.ReplaceAll(stored, "\\", string(filepath.Separator))
	normalized = strings.ReplaceAll(normalized, "/", string(filepath.Separator))
	return filepath.Join(s.root, normalized)
}

// etagSegment reproduces replace(/[^a-zA-Z0-9-]/g, '-') on the ETag value.
//
// JavaScript walks UTF-16 code units, so one character outside the BMP produces
// two hyphens. Reproducing that keeps the ETag a byte exact fingerprint of the
// decoding: "AC%2FDC" has to end up as "artist-AC-DC".
func etagSegment(value string) string {
	units := utf16.Encode([]rune(value))
	out := make([]byte, 0, len(units))

	for _, unit := range units {
		switch {
		case unit >= 'a' && unit <= 'z',
			unit >= 'A' && unit <= 'Z',
			unit >= '0' && unit <= '9',
			unit == '-':
			out = append(out, byte(unit))
		default:
			out = append(out, '-')
		}
	}
	return string(out)
}

// safeArtistName reproduces replace(/[^a-z0-9]/gi, '_').toLowerCase(), the cache
// file name of the artist mosaic. The i flag keeps upper case letters, the
// following toLowerCase folds them.
func safeArtistName(name string) string {
	units := utf16.Encode([]rune(name))
	out := make([]byte, 0, len(units))

	for _, unit := range units {
		switch {
		case unit >= 'a' && unit <= 'z', unit >= '0' && unit <= '9':
			out = append(out, byte(unit))
		case unit >= 'A' && unit <= 'Z':
			out = append(out, byte(unit-'A'+'a'))
		default:
			out = append(out, '_')
		}
	}
	return string(out)
}
