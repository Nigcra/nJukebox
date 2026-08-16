// respond.go
// Express compatible JSON responses including weak ETags
// Version: 2026.08.13

package api

import (
	"bytes"
	"crypto/sha1"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
)

// writeJSON sends a response the way Express res.json() did.
//
// The body has to be byte identical to JSON.stringify: the golden baseline
// compares the ETag, and that ETag is a hash of exactly these bytes. Two
// consequences follow. Response structs must declare their fields in the same
// order the JavaScript object literals used, and HTML escaping has to be off -
// Go would turn "&" into "&", JSON.stringify does not.
func writeJSON(w http.ResponseWriter, status int, payload any) {
	var buf bytes.Buffer
	encoder := json.NewEncoder(&buf)
	encoder.SetEscapeHTML(false)

	if err := encoder.Encode(payload); err != nil {
		log.Printf("encode response: %v", err)
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	// Encode appends a newline, JSON.stringify does not.
	body := bytes.TrimSuffix(buf.Bytes(), []byte("\n"))

	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("ETag", weakETag(body))
	w.Header().Set("Content-Length", strconv.Itoa(len(body)))
	w.WriteHeader(status)

	if _, err := w.Write(body); err != nil {
		log.Printf("write response: %v", err)
	}
}

// weakETag reproduces the etag package Express uses: the hex length of the body,
// a hyphen, and the first 27 characters of the base64 encoded SHA-1.
func weakETag(body []byte) string {
	if len(body) == 0 {
		return `W/"0-2jmj7l5rSw0yVb/vlWAYkK/YBwk"`
	}

	sum := sha1.Sum(body)
	hash := base64.StdEncoding.EncodeToString(sum[:])
	return fmt.Sprintf("W/%q", fmt.Sprintf("%x-%s", len(body), hash[:27]))
}

// errorResponse is the { success: false, error: ... } shape most handlers use.
type errorResponse struct {
	Success bool   `json:"success"`
	Error   string `json:"error"`
}

// messageErrorResponse is the { error: ... } shape the playlist, queue, settings
// and session handlers use. The inconsistency is in the original.
type messageErrorResponse struct {
	Error string `json:"error"`
}

// fail sends the { success: false, error } shape.
func fail(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, errorResponse{Success: false, Error: message})
}

// failPlain sends the { error } shape without the success flag.
func failPlain(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, messageErrorResponse{Error: message})
}

// notFoundHTML reproduces the default 404 page of Express, down to the line
// breaks. The frontend never sees it, but the baseline froze it.
func notFoundHTML(w http.ResponseWriter, method, path string) {
	body := "<!DOCTYPE html>\n" +
		"<html lang=\"en\">\n" +
		"<head>\n" +
		"<meta charset=\"utf-8\">\n" +
		"<title>Error</title>\n" +
		"</head>\n" +
		"<body>\n" +
		"<pre>Cannot " + method + " " + escapeHTML(path) + "</pre>\n" +
		"</body>\n" +
		"</html>\n"

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Content-Length", strconv.Itoa(len(body)))
	w.WriteHeader(http.StatusNotFound)

	if _, err := w.Write([]byte(body)); err != nil {
		log.Printf("write 404 response: %v", err)
	}
}

// escapeHTML mirrors the escape-html package used by Express for the 404 page.
func escapeHTML(s string) string {
	var out bytes.Buffer
	for _, r := range s {
		switch r {
		case '"':
			out.WriteString("&quot;")
		case '&':
			out.WriteString("&amp;")
		case '\'':
			out.WriteString("&#39;")
		case '<':
			out.WriteString("&lt;")
		case '>':
			out.WriteString("&gt;")
		default:
			out.WriteRune(r)
		}
	}
	return out.String()
}
