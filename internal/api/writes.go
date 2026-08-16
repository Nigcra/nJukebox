// writes.go
// Write endpoints: request body decoding, play counts, Spotify library and history
// Version: 2026.08.16

package api

import (
	"bytes"
	"encoding/json"
	"io"
	"log"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/Nigcra/nJukebox/internal/musicdb"
)

// Request body handling

// jsonBody is a decoded request body. Every value stays raw so a handler can
// tell an absent key (undefined in JavaScript) from an explicit null - several
// endpoints behave differently for the two, most visibly POST /api/settings.
type jsonBody map[string]json.RawMessage

// decodeBody reproduces express.json(). It only parses when the request
// announces JSON, an empty body yields an empty object, and anything that is
// neither object nor array is rejected because the parser ran in strict mode.
// The second result reports a syntax error; the caller then answers like the
// Express error middleware did.
func decodeBody(r *http.Request) (jsonBody, bool) {
	body := jsonBody{}

	contentType := r.Header.Get("Content-Type")
	if index := strings.IndexByte(contentType, ';'); index >= 0 {
		contentType = contentType[:index]
	}
	if !strings.EqualFold(strings.TrimSpace(contentType), "application/json") {
		// Without a JSON content type express.json() left req.body at {}.
		return body, true
	}

	raw, err := io.ReadAll(r.Body)
	if err != nil {
		return nil, false
	}

	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 {
		return body, true
	}

	switch trimmed[0] {
	case '{':
		if err := json.Unmarshal(trimmed, &body); err != nil {
			return nil, false
		}
		return body, true
	case '[':
		// An array parses, it just has none of the expected properties.
		if !json.Valid(trimmed) {
			return nil, false
		}
		return body, true
	default:
		return nil, false
	}
}

// raw returns the untouched value of a key, or nil when it is absent.
func (b jsonBody) raw(key string) json.RawMessage {
	value, ok := b[key]
	if !ok {
		return nil
	}
	return compactJSON(value)
}

// has reports whether the key was present at all.
func (b jsonBody) has(key string) bool {
	_, ok := b[key]
	return ok
}

// text returns the value as a string. The second result is false when the key
// is absent or holds anything but a JSON string - that is the case where the
// Node code ran into a TypeError calling a string method.
func (b jsonBody) text(key string) (string, bool) {
	raw, ok := b[key]
	if !ok {
		return "", false
	}
	var value string
	if err := json.Unmarshal(raw, &value); err != nil {
		return "", false
	}
	return value, true
}

// number returns the value as a float, like every JavaScript number.
func (b jsonBody) number(key string) (float64, bool) {
	raw, ok := b[key]
	if !ok {
		return 0, false
	}
	var value float64
	if err := json.Unmarshal(raw, &value); err != nil {
		return 0, false
	}
	return value, true
}

// boolean returns the value only when it really is a JSON boolean, which is
// what "typeof enabled === 'boolean'" asked for.
func (b jsonBody) boolean(key string) (bool, bool) {
	raw, ok := b[key]
	if !ok {
		return false, false
	}
	var value bool
	if err := json.Unmarshal(raw, &value); err != nil {
		return false, false
	}
	return value, true
}

// decoded turns the value into the Go equivalent of the JavaScript value.
func (b jsonBody) decoded(key string) (any, bool) {
	raw, ok := b[key]
	if !ok {
		return nil, false
	}
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		return nil, false
	}
	return value, true
}

// truthy applies the JavaScript truthiness rules. Absent, null, false, 0 and
// the empty string are falsy, everything else is truthy.
func (b jsonBody) truthy(key string) bool {
	raw, ok := b[key]
	if !ok {
		return false
	}

	trimmed := bytes.TrimSpace(raw)
	switch {
	case len(trimmed) == 0:
		return false
	case bytes.Equal(trimmed, []byte("null")), bytes.Equal(trimmed, []byte("false")):
		return false
	case trimmed[0] == '"':
		var value string
		if err := json.Unmarshal(trimmed, &value); err != nil {
			return false
		}
		return value != ""
	case trimmed[0] == '{', trimmed[0] == '[':
		return true
	default:
		var value float64
		if err := json.Unmarshal(trimmed, &value); err != nil {
			return true
		}
		return value != 0
	}
}

// optionalText returns a pointer that is nil for absent, null or non string
// values, which is how those reached the database as NULL.
func (b jsonBody) optionalText(key string) *string {
	value, ok := b.text(key)
	if !ok {
		return nil
	}
	return &value
}

// compactJSON removes the whitespace a client may have sent, because
// JSON.stringify never emitted any and the ETag hangs on the exact bytes.
func compactJSON(raw json.RawMessage) json.RawMessage {
	var buf bytes.Buffer
	if err := json.Compact(&buf, raw); err != nil {
		return raw
	}
	return json.RawMessage(buf.Bytes())
}

// internalError answers like the Express error middleware, which is what a
// malformed request body ran into before any handler was reached.
func internalError(w http.ResponseWriter) {
	fail(w, http.StatusInternalServerError, "Internal server error")
}

// jsNumberString renders a JSON value the way String(value) would, so it can be
// fed to the parseInt helper.
func jsNumberString(raw json.RawMessage) string {
	trimmed := strings.TrimSpace(string(raw))
	if len(trimmed) > 0 && trimmed[0] == '"' {
		var value string
		if err := json.Unmarshal([]byte(trimmed), &value); err == nil {
			return value
		}
	}
	return trimmed
}

// Play counts

type trackPlayResponse struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
	TrackID *int64 `json:"trackId"`
}

// handleTrackPlay increments the play counter of a local track.
func (s *Server) handleTrackPlay(w http.ResponseWriter, r *http.Request, params map[string]string) {
	trackID := params["id"]

	track, err := s.music.GetTrackByID(r.Context(), trackID)
	if err != nil {
		fail(w, http.StatusInternalServerError, err.Error())
		return
	}
	if track == nil {
		fail(w, http.StatusNotFound, "Track not found")
		return
	}

	if _, err := s.music.UpdateTrackPlayCount(r.Context(), trackID); err != nil {
		fail(w, http.StatusInternalServerError, err.Error())
		return
	}

	// parseInt(trackId): a value without digits became NaN, and JSON.stringify
	// turns NaN into null.
	var parsed *int64
	if value, ok := jsParseInt(trackID); ok {
		parsed = &value
	}

	writeJSON(w, http.StatusOK, trackPlayResponse{
		Success: true,
		Message: "Play count updated",
		TrackID: parsed,
	})
}

type spotifyPlayResponse struct {
	Success   bool   `json:"success"`
	Message   string `json:"message"`
	SpotifyID string `json:"spotifyId"`
	Tracked   bool   `json:"tracked"`
}

// handleSpotifyPlay increments the play counter of a Spotify track and adds the
// track on the fly when the request carries enough metadata.
func (s *Server) handleSpotifyPlay(w http.ResponseWriter, r *http.Request, params map[string]string) {
	body, ok := decodeBody(r)
	if !ok {
		internalError(w)
		return
	}

	spotifyID := params["spotify_id"]
	spotifyID = strings.TrimPrefix(spotifyID, "spotify_")

	track, err := s.music.GetSpotifyTrack(r.Context(), spotifyID)
	if err != nil {
		fail(w, http.StatusInternalServerError, err.Error())
		return
	}

	if track == nil {
		var trackData jsonBody
		if raw, present := body["trackData"]; present {
			_ = json.Unmarshal(raw, &trackData)
		}

		if trackData.truthy("title") && trackData.truthy("artist") {
			album := ""
			if value, ok := trackData.text("album"); ok {
				album = value
			}

			var popularity int64
			if value, ok := trackData.number("popularity"); ok {
				popularity = int64(value)
			}

			title, _ := trackData.text("title")
			artist, _ := trackData.text("artist")

			// Spotify has no genre on the track, only on the artist. Without
			// this the title would land in the library with an empty genre and
			// never show up in the genre view.
			artistID, _ := trackData.text("artist_id")
			genre := s.spotifyGenre(r.Context(), artistID, artist)

			// The auto add path builds an object with duration_ms, external_url
			// and added_at, none of which addSpotifyTrack reads. Those columns
			// stayed NULL, and they still do.
			newTrack := musicdb.SpotifyTrack{
				SpotifyID:  spotifyID,
				Title:      &title,
				Artist:     &artist,
				Album:      &album,
				ImageURL:   trackData.optionalText("image_url"),
				PreviewURL: trackData.optionalText("preview_url"),
				Popularity: &popularity,
			}
			if genre != "" {
				newTrack.Genre = &genre
			}

			// An add failure was logged and swallowed, the request continued.
			if _, addErr := s.music.AddSpotifyTrack(r.Context(), newTrack); addErr == nil {
				track, err = s.music.GetSpotifyTrack(r.Context(), spotifyID)
				if err != nil {
					fail(w, http.StatusInternalServerError, err.Error())
					return
				}
			}
		}

		if track == nil {
			writeJSON(w, http.StatusOK, spotifyPlayResponse{
				Success:   true,
				Message:   "Spotify track not in database - play count not recorded",
				SpotifyID: spotifyID,
				Tracked:   false,
			})
			return
		}
	}

	// Rows written before the artist lookup existed, or while nobody was logged
	// in, catch up here - the genre view fills itself as the evening goes on.
	if track.Genre == nil || *track.Genre == "" {
		artistName := ""
		if track.Artist != nil {
			artistName = *track.Artist
		}
		if genre := s.spotifyGenre(r.Context(), "", artistName); genre != "" {
			if err := s.music.SetSpotifyTrackGenre(r.Context(), spotifyID, genre); err != nil {
				log.Printf("[GENRE] %v", err)
			}
		}
	}

	// Same for the cover: a row only carries one when the object in the queue
	// happened to hold an image, and several paths into the queue do not. Left
	// empty the album falls back to the default cover in every view.
	if track.ImageURL == nil || *track.ImageURL == "" {
		if image := s.spotifyTrackImage(r.Context(), spotifyID); image != "" {
			if err := s.music.SetSpotifyTrackImage(r.Context(), spotifyID, image); err != nil {
				log.Printf("[COVER] %v", err)
			}
		}
	}

	if _, err := s.music.UpdateSpotifyTrackPlayCount(r.Context(), spotifyID); err != nil {
		fail(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, spotifyPlayResponse{
		Success:   true,
		Message:   "Spotify play count updated",
		SpotifyID: spotifyID,
		Tracked:   true,
	})
}

// Spotify library

type spotifyExistingResponse struct {
	Success bool                  `json:"success"`
	Message string                `json:"message"`
	Track   *musicdb.SpotifyTrack `json:"track"`
}

type spotifyRateLimitedResponse struct {
	Success          bool   `json:"success"`
	Message          string `json:"message"`
	RemainingMinutes int64  `json:"remainingMinutes"`
}

type spotifyAddedResponse struct {
	Success bool           `json:"success"`
	Message string         `json:"message"`
	Track   *musicdb.Track `json:"track"`
}

// spotifyAddedWithoutTrack is the same answer without the track key. The lookup
// after the insert used getTrackById, which reads the tracks table with the
// rowid of a spotify_tracks row - it usually finds nothing, and an undefined
// property is dropped by JSON.stringify instead of serialised as null.
type spotifyAddedWithoutTrackResponse struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
}

// handleSpotifyAdd stores a Spotify track in the local library.
func (s *Server) handleSpotifyAdd(w http.ResponseWriter, r *http.Request, _ map[string]string) {
	body, ok := decodeBody(r)
	if !ok {
		internalError(w)
		return
	}

	spotifyID, _ := body.text("spotify_id")

	existing, err := s.music.GetSpotifyTrack(r.Context(), spotifyID)
	if err != nil {
		fail(w, http.StatusInternalServerError, err.Error())
		return
	}

	if existing != nil {
		const oneHourMillis = int64(60 * 60 * 1000)
		difference := millisSince(existing.AddedDate)

		if difference < oneHourMillis {
			remaining := int64(math.Ceil(float64(oneHourMillis-difference) / float64(60*1000)))
			writeJSON(w, http.StatusTooManyRequests, spotifyRateLimitedResponse{
				Success:          false,
				Message:          "Track wurde kürzlich hinzugefügt. Bitte warte noch " + strconv.FormatInt(remaining, 10) + " Minuten.",
				RemainingMinutes: remaining,
			})
			return
		}

		writeJSON(w, http.StatusOK, spotifyExistingResponse{
			Success: true,
			Message: "Track already in library",
			Track:   existing,
		})
		return
	}

	addedDate := time.Now().UTC().Format("2006-01-02T15:04:05.000Z")

	var popularity int64
	if value, ok := body.number("popularity"); ok {
		popularity = int64(value)
	}

	newTrack := musicdb.SpotifyTrack{
		SpotifyID:  spotifyID,
		Title:      body.optionalText("name"),
		Artist:     body.optionalText("artist"),
		Album:      body.optionalText("album"),
		Genre:      body.optionalText("genre"),
		Year:       parseYear(body.raw("year")),
		Duration:   durationSeconds(body),
		ImageURL:   body.optionalText("image_url"),
		PreviewURL: body.optionalText("preview_url"),
		SpotifyURI: body.optionalText("spotify_uri"),
		Popularity: &popularity,
		AddedDate:  &addedDate,
	}

	insertedID, err := s.music.AddSpotifyTrack(r.Context(), newTrack)
	if err != nil {
		fail(w, http.StatusInternalServerError, err.Error())
		return
	}

	track, err := s.music.GetTrackByID(r.Context(), strconv.FormatInt(insertedID, 10))
	if err != nil {
		fail(w, http.StatusInternalServerError, err.Error())
		return
	}

	if track == nil {
		writeJSON(w, http.StatusOK, spotifyAddedWithoutTrackResponse{
			Success: true,
			Message: "Track added to library",
		})
		return
	}

	writeJSON(w, http.StatusOK, spotifyAddedResponse{
		Success: true,
		Message: "Track added to library",
		Track:   track,
	})
}

type spotifyRemovedResponse struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
}

// handleSpotifyRemove deletes a Spotify track from the library.
func (s *Server) handleSpotifyRemove(w http.ResponseWriter, r *http.Request, params map[string]string) {
	if _, err := s.music.RemoveSpotifyTrack(r.Context(), params["spotify_id"]); err != nil {
		fail(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, spotifyRemovedResponse{
		Success: true,
		Message: "Spotify track removed from library",
	})
}

type bulkAddResult struct {
	TrackID   int64           `json:"trackId"`
	SpotifyID json.RawMessage `json:"spotify_id"`
}

type bulkAddResponse struct {
	Success      bool            `json:"success"`
	Message      string          `json:"message"`
	AddedCount   int             `json:"addedCount"`
	SkippedCount int             `json:"skippedCount"`
	Results      []bulkAddResult `json:"results"`
}

// handleSpotifyBulkAdd stores a batch of Spotify tracks. Failures inside the
// loop were logged and skipped, and the request still answered 200.
func (s *Server) handleSpotifyBulkAdd(w http.ResponseWriter, r *http.Request, _ map[string]string) {
	body, ok := decodeBody(r)
	if !ok {
		internalError(w)
		return
	}

	raw, present := body["tracks"]
	if !present || !isJSONArray(raw) {
		fail(w, http.StatusBadRequest, "Tracks must be an array")
		return
	}

	var entries []json.RawMessage
	if err := json.Unmarshal(raw, &entries); err != nil {
		fail(w, http.StatusBadRequest, "Tracks must be an array")
		return
	}

	addedCount := 0
	skippedCount := 0
	results := []bulkAddResult{}

	for _, entry := range entries {
		var trackData jsonBody
		if err := json.Unmarshal(entry, &trackData); err != nil {
			continue
		}

		spotifyID, _ := trackData.text("spotify_id")

		existing, err := s.music.GetSpotifyTrack(r.Context(), spotifyID)
		if err != nil {
			continue
		}
		if existing != nil {
			skippedCount++
			continue
		}

		genre := "Unknown"
		if trackData.truthy("genre") {
			if value, ok := trackData.text("genre"); ok {
				genre = value
			}
		}

		var popularity int64
		if value, ok := trackData.number("popularity"); ok {
			popularity = int64(value)
		}

		addedDate := time.Now().UTC().Format("2006-01-02T15:04:05.000Z")

		insertedID, err := s.music.AddSpotifyTrack(r.Context(), musicdb.SpotifyTrack{
			SpotifyID:  spotifyID,
			Title:      trackData.optionalText("name"),
			Artist:     trackData.optionalText("artist"),
			Album:      trackData.optionalText("album"),
			Genre:      &genre,
			Year:       parseYear(trackData.raw("year")),
			Duration:   durationSeconds(trackData),
			ImageURL:   trackData.optionalText("image_url"),
			PreviewURL: trackData.optionalText("preview_url"),
			SpotifyURI: trackData.optionalText("spotify_uri"),
			Popularity: &popularity,
			AddedDate:  &addedDate,
		})
		if err != nil {
			continue
		}

		addedCount++
		results = append(results, bulkAddResult{
			TrackID:   insertedID,
			SpotifyID: nullRaw(trackData.raw("spotify_id")),
		})
	}

	writeJSON(w, http.StatusOK, bulkAddResponse{
		Success: true,
		Message: "Added " + strconv.Itoa(addedCount) + " tracks, skipped " +
			strconv.Itoa(skippedCount) + " existing",
		AddedCount:   addedCount,
		SkippedCount: skippedCount,
		Results:      results,
	})
}

// Play history

type playHistoryData struct {
	ID       int64 `json:"id"`
	PlayedAt int64 `json:"played_at"`
}

type playHistoryResponse struct {
	Success bool            `json:"success"`
	Data    playHistoryData `json:"data"`
	Message string          `json:"message"`
}

// handlePlayHistory appends one play to the reporting history. The timestamp is
// always taken from the server clock in milliseconds (R5).
func (s *Server) handlePlayHistory(w http.ResponseWriter, r *http.Request, _ map[string]string) {
	body, ok := decodeBody(r)
	if !ok {
		internalError(w)
		return
	}

	if !body.truthy("trackData") || !body.truthy("source") {
		fail(w, http.StatusBadRequest, "Track data and source are required")
		return
	}

	source, _ := body.text("source")
	if source != "local" && source != "spotify" {
		fail(w, http.StatusBadRequest, `Source must be either "local" or "spotify"`)
		return
	}

	var trackData jsonBody
	if raw, present := body["trackData"]; present {
		_ = json.Unmarshal(raw, &trackData)
	}

	record := musicdb.PlayRecord{
		Title:  "Unknown Title",
		Artist: "Unknown Artist",
	}
	if trackData.truthy("title") {
		if value, ok := trackData.text("title"); ok {
			record.Title = value
		}
	}
	if trackData.truthy("artist") {
		if value, ok := trackData.text("artist"); ok {
			record.Artist = value
		}
	}
	if trackData.truthy("album") {
		if value, ok := trackData.text("album"); ok {
			record.Album = value
		}
	}

	record.TrackID = parseTrackID(trackData.raw("id"))

	// trackData.spotify_id || trackData.id
	record.SpotifyID = scalarText(trackData.raw("spotify_id"))
	if record.SpotifyID == nil {
		record.SpotifyID = scalarText(trackData.raw("id"))
	}

	id, playedAt, err := s.music.RecordPlayHistory(r.Context(), record, source)
	if err != nil {
		fail(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, playHistoryResponse{
		Success: true,
		Data:    playHistoryData{ID: id, PlayedAt: playedAt},
		Message: "Play history recorded successfully",
	})
}

// Debug flag

// handleSetDebugConfig switches the global debug flag.
func (s *Server) handleSetDebugConfig(w http.ResponseWriter, r *http.Request, _ map[string]string) {
	body, ok := decodeBody(r)
	if !ok {
		internalError(w)
		return
	}

	enabled, isBoolean := body.boolean("enabled")
	if !isBoolean {
		fail(w, http.StatusBadRequest, "Invalid enabled parameter")
		return
	}

	s.setDebugging(enabled)
	writeJSON(w, http.StatusOK, debugConfigResponse{Success: true, Debugging: enabled})
}

// Shared value conversions

// isJSONArray reports whether the raw value is a JSON array.
func isJSONArray(raw json.RawMessage) bool {
	trimmed := bytes.TrimSpace(raw)
	return len(trimmed) > 0 && trimmed[0] == '['
}

// parseYear mirrors "parseInt(year) || null": a missing digit or a zero ends up
// as NULL in the database.
func parseYear(raw json.RawMessage) *int64 {
	if len(raw) == 0 {
		return nil
	}
	value, ok := jsParseInt(jsNumberString(raw))
	if !ok || value == 0 {
		return nil
	}
	return &value
}

// durationSeconds mirrors "Math.floor(duration_ms / 1000)". A missing value
// produced NaN, which sqlite3 bound as NULL.
func durationSeconds(body jsonBody) *int64 {
	millis, ok := body.number("duration_ms")
	if !ok {
		return nil
	}
	seconds := int64(math.Floor(millis / 1000))
	return &seconds
}

// scalarText renders a truthy scalar the way String(value) would and returns
// nil for everything falsy, which is what the "a || b" chains relied on.
func scalarText(raw json.RawMessage) *string {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 {
		return nil
	}
	switch {
	case bytes.Equal(trimmed, []byte("null")), bytes.Equal(trimmed, []byte("false")):
		return nil
	case trimmed[0] == '"':
		var value string
		if err := json.Unmarshal(trimmed, &value); err != nil || value == "" {
			return nil
		}
		return &value
	case trimmed[0] == '{', trimmed[0] == '[':
		return nil
	default:
		var value float64
		if err := json.Unmarshal(trimmed, &value); err != nil || value == 0 {
			return nil
		}
		text := formatJSNumber(value)
		return &text
	}
}

// formatJSNumber renders a float like Number.prototype.toString.
func formatJSNumber(value float64) string {
	if value == math.Trunc(value) && math.Abs(value) < 1e21 {
		return strconv.FormatInt(int64(value), 10)
	}
	return strconv.FormatFloat(value, 'g', -1, 64)
}

// parseTrackID reads trackData.id as an integer. A string containing digits is
// accepted because SQLite converts it on an INTEGER column anyway.
func parseTrackID(raw json.RawMessage) *int64 {
	if len(raw) == 0 {
		return nil
	}
	value, ok := jsParseInt(jsNumberString(raw))
	if !ok {
		return nil
	}
	return &value
}

// millisSince returns the age of an ISO timestamp in milliseconds. A missing
// value behaved like new Date(null), which is the epoch and therefore old.
func millisSince(iso *string) int64 {
	if iso == nil {
		return time.Now().UnixMilli()
	}

	parsed, err := time.Parse(time.RFC3339, *iso)
	if err != nil {
		parsed, err = time.Parse("2006-01-02T15:04:05.000Z", *iso)
	}
	if err != nil {
		// new Date("garbage") is an Invalid Date, and every comparison with
		// NaN is false - the track counted as old.
		return time.Now().UnixMilli()
	}
	return time.Now().UnixMilli() - parsed.UnixMilli()
}
