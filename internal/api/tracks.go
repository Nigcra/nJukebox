// tracks.go
// Read endpoints for tracks, artists, albums, genres and library statistics
// Version: 2026.08.13

package api

import (
	"net/http"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/Nigcra/nJukebox/internal/musicdb"
)

// tracksResponse is { success, data, total } in that order.
type tracksResponse struct {
	Success bool            `json:"success"`
	Data    []musicdb.Track `json:"data"`
	Total   int             `json:"total"`
}

type trackResponse struct {
	Success bool           `json:"success"`
	Data    *musicdb.Track `json:"data"`
}

func (s *Server) handleGetTracks(w http.ResponseWriter, r *http.Request, _ map[string]string) {
	query := r.URL.Query()

	// The Node handler defaulted limit to 50000 and offset to 0 and then ran
	// both through parseInt. A zero is falsy in JavaScript, which is why an
	// offset of 0 never produced an OFFSET clause.
	filters := musicdb.TrackFilters{
		Artist: query.Get("artist"),
		Album:  query.Get("album"),
		Genre:  query.Get("genre"),
		Year:   query.Get("year"),
		Search: query.Get("search"),
		Limit:  truthyInt(query.Get("limit"), "50000"),
		Offset: truthyInt(query.Get("offset"), "0"),
	}

	tracks, err := s.music.GetTracks(r.Context(), filters)
	if err != nil {
		fail(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, tracksResponse{
		Success: true,
		Data:    tracks,
		Total:   len(tracks),
	})
}

func (s *Server) handleGetTrack(w http.ResponseWriter, r *http.Request, params map[string]string) {
	track, err := s.music.GetTrackByID(r.Context(), params["id"])
	if err != nil {
		fail(w, http.StatusInternalServerError, err.Error())
		return
	}
	if track == nil {
		fail(w, http.StatusNotFound, "Track not found")
		return
	}

	writeJSON(w, http.StatusOK, trackResponse{Success: true, Data: track})
}

type artistsResponse struct {
	Success bool             `json:"success"`
	Data    []musicdb.Artist `json:"data"`
}

func (s *Server) handleGetArtists(w http.ResponseWriter, r *http.Request, _ map[string]string) {
	artists, err := s.music.GetArtists(r.Context())
	if err != nil {
		fail(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, artistsResponse{Success: true, Data: artists})
}

type albumsResponse struct {
	Success bool            `json:"success"`
	Data    []musicdb.Album `json:"data"`
}

func (s *Server) handleGetAlbums(w http.ResponseWriter, r *http.Request, _ map[string]string) {
	albums, err := s.music.GetAlbums(r.Context(), r.URL.Query().Get("artist"))
	if err != nil {
		fail(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, albumsResponse{Success: true, Data: albums})
}

type genresResponse struct {
	Success bool            `json:"success"`
	Data    []musicdb.Genre `json:"data"`
}

func (s *Server) handleGetGenres(w http.ResponseWriter, r *http.Request, _ map[string]string) {
	genres, err := s.music.GetGenres(r.Context())
	if err != nil {
		fail(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, genresResponse{Success: true, Data: genres})
}

type statsResponse struct {
	Success bool          `json:"success"`
	Data    musicdb.Stats `json:"data"`
}

func (s *Server) handleGetStats(w http.ResponseWriter, r *http.Request, _ map[string]string) {
	stats, err := s.music.GetStats(r.Context())
	if err != nil {
		fail(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, statsResponse{Success: true, Data: stats})
}

// conversionStatusNative is the answer for formats that play natively.
type conversionStatusNative struct {
	Success         bool   `json:"success"`
	NeedsConversion bool   `json:"needsConversion"`
	Format          string `json:"format"`
	Status          string `json:"status"`
}

// conversionStatusPending is the answer for the formats the endpoint promises to
// convert. Dead code in practice - the scanner only indexes MP3 and the stream
// endpoint rejects everything else - but it is ported so the frontend keeps
// working.
type conversionStatusPending struct {
	Success         bool   `json:"success"`
	NeedsConversion bool   `json:"needsConversion"`
	OriginalFormat  string `json:"originalFormat"`
	TargetFormat    string `json:"targetFormat"`
	IsCached        bool   `json:"isCached"`
	Status          string `json:"status"`
}

func (s *Server) handleConversionStatus(w http.ResponseWriter, r *http.Request, params map[string]string) {
	track, err := s.music.GetTrackByID(r.Context(), params["id"])
	if err != nil {
		fail(w, http.StatusInternalServerError, err.Error())
		return
	}
	if track == nil {
		fail(w, http.StatusNotFound, "Track not found")
		return
	}

	extension := strings.ToLower(filepath.Ext(track.FilePath))
	needsConversion := extension == ".flac" || extension == ".ogg" ||
		extension == ".m4a" || extension == ".wma"

	if !needsConversion {
		writeJSON(w, http.StatusOK, conversionStatusNative{
			Success:         true,
			NeedsConversion: false,
			Format:          extension,
			Status:          "native",
		})
		return
	}

	mtime := int64(0)
	if track.FileMtime != nil {
		mtime = *track.FileMtime
	}
	cacheKey := strconv.FormatInt(track.ID, 10) + "_" + strconv.FormatInt(mtime, 10)
	cached := fileExists(filepath.Join(s.root, "data", "converted", cacheKey+".mp3"))

	status := "will-convert"
	if cached {
		status = "cached"
	}

	writeJSON(w, http.StatusOK, conversionStatusPending{
		Success:         true,
		NeedsConversion: true,
		OriginalFormat:  extension,
		TargetFormat:    ".mp3",
		IsCached:        cached,
		Status:          status,
	})
}

// truthyInt applies the JavaScript rules the query parameters went through:
// parseInt on the raw value, then a truthiness check. NaN and zero both mean
// "do not apply", which is why an offset of 0 was silently dropped.
func truthyInt(raw, fallback string) string {
	if raw == "" {
		raw = fallback
	}
	value, ok := jsParseInt(raw)
	if !ok || value == 0 {
		return ""
	}
	return strconv.FormatInt(value, 10)
}

// jsParseInt mimics parseInt: leading whitespace and an optional sign, then as
// many digits as possible. Trailing garbage is ignored, a missing digit is NaN.
func jsParseInt(raw string) (int64, bool) {
	s := strings.TrimLeft(raw, " \t\n\r\f\v")

	negative := false
	if strings.HasPrefix(s, "+") {
		s = s[1:]
	} else if strings.HasPrefix(s, "-") {
		negative = true
		s = s[1:]
	}

	end := 0
	for end < len(s) && s[end] >= '0' && s[end] <= '9' {
		end++
	}
	if end == 0 {
		return 0, false
	}

	value, err := strconv.ParseInt(s[:end], 10, 64)
	if err != nil {
		return 0, false
	}
	if negative {
		value = -value
	}
	return value, true
}
