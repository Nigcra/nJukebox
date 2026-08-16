// stream.go
// Audio streaming endpoint with the range handling of data_server.js
// Version: 2026.08.16

package api

import (
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"

	"github.com/Nigcra/nJukebox/internal/scanner"
)

// audioContentType picks the media type from the file extension. Anything the
// scanner does not index cannot reach this point, so the fallback only ever
// applies to a row written before a format was dropped from the list.
func audioContentType(path string) string {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".flac":
		return "audio/flac"
	default:
		return "audio/mpeg"
	}
}

// audioMissingResponse is the 404 body of the stream endpoint. The field order
// matches the object literal, because the ETag is a hash of exactly these bytes.
type audioMissingResponse struct {
	Success       bool   `json:"success"`
	Error         string `json:"error"`
	AttemptedPath string `json:"attempted_path"`
}

func (s *Server) handleStream(w http.ResponseWriter, r *http.Request, params map[string]string) {
	track, err := s.music.GetTrackByID(r.Context(), params["id"])
	if err != nil {
		log.Printf("[STREAM] error streaming track: %v", err)
		fail(w, http.StatusInternalServerError, err.Error())
		return
	}
	if track == nil {
		fail(w, http.StatusNotFound, "Track not found")
		return
	}

	filePath := s.resolveTrackPath(track.FilePath)
	if !fileExists(filePath) {
		writeJSON(w, http.StatusNotFound, audioMissingResponse{
			Success:       false,
			Error:         "Audio file not found",
			AttemptedPath: filePath,
		})
		return
	}

	// Node rejected everything but MP3 here because that was all the scanner
	// indexed. The guard stays - it keeps a row pointing at some other file from
	// being streamed - but it now allows what the scanner accepts.
	if !scanner.IsSupportedFormat(filePath) {
		fail(w, http.StatusUnsupportedMediaType, "Unsupported media type. Only MP3 and FLAC files are supported.")
		return
	}

	if s.isDebugging() {
		title := ""
		if track.Title != nil {
			title = *track.Title
		}
		log.Printf("[STREAM] Serving audio: %s", title)
	}

	file, err := os.Open(filePath)
	if err != nil {
		log.Printf("[STREAM] error streaming track: %v", err)
		fail(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer file.Close()

	info, err := file.Stat()
	if err != nil {
		log.Printf("[STREAM] error streaming track: %v", err)
		fail(w, http.StatusInternalServerError, err.Error())
		return
	}
	size := info.Size()

	// The header set of both writeHead() calls in data_server.js. Range support
	// is announced in either case, the CORS headers are repeated per response.
	// Node sent audio/mpeg unconditionally because it only ever served MP3.
	w.Header().Set("Content-Type", audioContentType(filePath))
	w.Header().Set("Cache-Control", "public, max-age=3600")
	w.Header().Set("Accept-Ranges", "bytes")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Range")

	rangeHeader := r.Header.Get("Range")
	if rangeHeader == "" {
		w.Header().Set("Content-Length", strconv.FormatInt(size, 10))
		w.WriteHeader(http.StatusOK)
		if _, err := io.Copy(w, file); err != nil {
			log.Printf("[STREAM] write response: %v", err)
		}
		return
	}

	start, end := parseNodeRange(rangeHeader, size)
	length := end - start + 1
	if length < 0 {
		length = 0
	}

	w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, size))
	w.Header().Set("Content-Length", strconv.FormatInt(length, 10))
	w.WriteHeader(http.StatusPartialContent)

	if _, err := io.Copy(w, io.NewSectionReader(file, start, length)); err != nil {
		log.Printf("[STREAM] write range response: %v", err)
	}
}

// parseNodeRange mirrors the hand rolled parser of data_server.js: strip the
// first "bytes=", split on "-", parseInt both halves and default the end to the
// last byte. Values that cannot be parsed or point outside the file are clamped
// here - the Node version would have written a NaN into the header and crashed
// the read stream.
func parseNodeRange(header string, size int64) (start, end int64) {
	spec := strings.Replace(header, "bytes=", "", 1)
	parts := strings.Split(spec, "-")

	if value, ok := jsParseInt(parts[0]); ok {
		start = value
	}

	// An empty second half is falsy in JavaScript and means "until the end".
	end = size - 1
	if len(parts) > 1 && parts[1] != "" {
		if value, ok := jsParseInt(parts[1]); ok {
			end = value
		}
	}

	if size > 0 {
		if start < 0 {
			start = 0
		}
		if start >= size {
			start = size - 1
		}
		if end >= size {
			end = size - 1
		}
		if end < start {
			end = start
		}
	}
	return start, end
}

// resolveTrackPath reproduces the path resolution of data_server.js: an absolute
// path is used as it is when it exists, otherwise it is re-anchored below the
// project root. A relative path is joined with the root directly.
func (s *Server) resolveTrackPath(stored string) string {
	if !isAbsolutePath(stored) {
		return s.joinRoot(stored)
	}
	if fileExists(stored) {
		return stored
	}

	relative, err := filepath.Rel(filepath.Dir(s.root), stored)
	if err != nil {
		// path.relative() returned the target unchanged when the two paths sat
		// on different volumes.
		relative = stored
	}
	return filepath.Join(s.root, relative)
}

// isAbsolutePath mirrors path.isAbsolute of the platform Node ran on: on Windows
// a leading separator counts as absolute even without a drive letter.
func isAbsolutePath(path string) bool {
	if filepath.IsAbs(path) {
		return true
	}
	if runtime.GOOS == "windows" {
		return strings.HasPrefix(path, `\`) || strings.HasPrefix(path, "/")
	}
	return false
}
