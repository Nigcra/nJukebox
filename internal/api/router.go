// router.go
// Segment based router that matches on the undecoded path
// Version: 2026.08.16

package api

import (
	"net/http"
	"net/url"
	"strings"
	"sync"

	"github.com/Nigcra/nJukebox/internal/appdb"
	"github.com/Nigcra/nJukebox/internal/eq"
	"github.com/Nigcra/nJukebox/internal/musicdb"
	"github.com/Nigcra/nJukebox/internal/spotify"
)

// Server holds the dependencies of the data API.
type Server struct {
	root    string
	music   *musicdb.DB
	app     *appdb.DB
	routes  []route
	debugMu chan struct{} // guards debugging, a channel keeps it dependency free

	debugging bool

	// rescan is wired up by RegisterRescan once the scanner exists.
	rescan RescanFunc

	// eq is wired up by RegisterEqualizer where loopback capture exists.
	eq *eq.Engine

	// spotify is wired up by RegisterSpotifyAuth. Playing a Spotify title looks
	// up its genre through it, so it stays nil when nobody is logged in.
	spotify       *spotify.Manager
	spotifyClient *spotify.Client

	// genreCache maps a lower cased artist name to the genre found for it,
	// including the empty string for artists Spotify lists none for.
	genreMu    sync.Mutex
	genreCache map[string]string
}

type handlerFunc func(w http.ResponseWriter, r *http.Request, params map[string]string)

type route struct {
	method   string
	segments []string
	handler  handlerFunc
}

// New builds the data API server.
func New(root string, music *musicdb.DB, app *appdb.DB, debugging bool) *Server {
	s := &Server{
		root:      root,
		music:     music,
		app:       app,
		debugMu:   make(chan struct{}, 1),
		debugging: debugging,
	}
	s.debugMu <- struct{}{}
	s.registerRoutes()
	return s
}

// register adds a route. A segment starting with ':' is a parameter.
func (s *Server) register(method, pattern string, handler handlerFunc) {
	s.routes = append(s.routes, route{
		method:   method,
		segments: strings.Split(strings.Trim(pattern, "/"), "/"),
		handler:  handler,
	})
}

func (s *Server) registerRoutes() {
	// System
	s.register(http.MethodGet, "/api/health", s.handleHealth)
	s.register(http.MethodGet, "/api/debug-config", s.handleGetDebugConfig)

	// Loopback spectrum for the footer equalizer (SSE, new in the Go port)
	s.register(http.MethodGet, "/api/eq/stream", s.handleEqStream)

	// Tracks and library aggregates
	s.register(http.MethodGet, "/api/tracks", s.handleGetTracks)
	s.register(http.MethodGet, "/api/tracks/:id", s.handleGetTrack)
	s.register(http.MethodGet, "/api/artists", s.handleGetArtists)
	s.register(http.MethodGet, "/api/albums", s.handleGetAlbums)
	s.register(http.MethodGet, "/api/genres", s.handleGetGenres)
	s.register(http.MethodGet, "/api/stats", s.handleGetStats)

	// Statistics and history
	s.register(http.MethodGet, "/api/most-played", s.handleGetMostPlayed)
	s.register(http.MethodGet, "/api/play-stats", s.handleGetPlayStats)
	s.register(http.MethodGet, "/api/plays", s.handleGetPlays)

	// Streaming and covers
	s.register(http.MethodGet, "/api/stream/:id", s.handleStream)
	s.register(http.MethodGet, "/api/cover/:id", s.handleGetCover)
	s.register(http.MethodGet, "/api/album-cover/:albumKey", s.handleGetAlbumCover)
	s.register(http.MethodGet, "/api/artist-cover/:artistName", s.handleGetArtistCover)
	s.register(http.MethodGet, "/api/conversion-status/:id", s.handleConversionStatus)

	// Spotify metadata and playlists
	s.register(http.MethodGet, "/api/spotify/tracks", s.handleGetSpotifyTracks)
	s.register(http.MethodGet, "/api/custom-playlists", s.handleGetCustomPlaylists)

	// Settings. The history route has three segments after /api/settings and
	// therefore never collides with :category/:key.
	s.register(http.MethodGet, "/api/settings", s.handleGetSettings)
	s.register(http.MethodGet, "/api/settings/history/:category/:key", s.handleGetSettingHistory)
	s.register(http.MethodGet, "/api/settings/:category/:key", s.handleGetSetting)

	// Session
	s.register(http.MethodGet, "/api/session/spotify", s.handleGetSessionSpotify)
	s.register(http.MethodGet, "/api/session/tokens", s.handleGetSessionTokens)
	s.register(http.MethodGet, "/api/session/app/:sessionKey", s.handleGetSessionApp)
	s.register(http.MethodGet, "/api/session/ui/:stateKey", s.handleGetSessionUI)

	// Queue
	s.register(http.MethodGet, "/api/queue/load", s.handleQueueLoad)
	s.register(http.MethodGet, "/api/queue/stats", s.handleQueueStats)

	// Write endpoints. Fixed segments are registered before the parameterized
	// routes of the same length so they always win.
	s.register(http.MethodPost, "/api/tracks/:id/play", s.handleTrackPlay)
	s.register(http.MethodPost, "/api/spotify/add", s.handleSpotifyAdd)
	s.register(http.MethodPost, "/api/spotify/bulk-add", s.handleSpotifyBulkAdd)
	s.register(http.MethodPost, "/api/spotify/:spotify_id/play", s.handleSpotifyPlay)
	s.register(http.MethodDelete, "/api/spotify/:spotify_id", s.handleSpotifyRemove)
	s.register(http.MethodPost, "/api/play-history", s.handlePlayHistory)
	s.register(http.MethodPost, "/api/debug-config", s.handleSetDebugConfig)
	s.register(http.MethodPost, "/api/cleanup", s.handleCleanup)
	s.register(http.MethodPost, "/api/clear-database", s.handleClearDatabase)

	s.register(http.MethodPost, "/api/custom-playlists", s.handleAddCustomPlaylist)
	s.register(http.MethodDelete, "/api/custom-playlists", s.handleClearCustomPlaylists)
	s.register(http.MethodDelete, "/api/custom-playlists/:id", s.handleDeleteCustomPlaylist)

	s.register(http.MethodPost, "/api/queue/save", s.handleQueueSave)
	s.register(http.MethodPost, "/api/queue/cleanup", s.handleQueueCleanup)

	s.register(http.MethodPost, "/api/settings/batch", s.handleSettingsBatch)
	s.register(http.MethodPost, "/api/settings/:category/:key", s.handleSetSetting)
	s.register(http.MethodDelete, "/api/settings/:category/:key", s.handleDeleteSetting)

	s.register(http.MethodPost, "/api/session/spotify", s.handleSaveSessionSpotify)
	s.register(http.MethodDelete, "/api/session/spotify", s.handleClearSessionSpotify)
	s.register(http.MethodPost, "/api/session/app/:sessionKey", s.handleSaveSessionApp)
	s.register(http.MethodDelete, "/api/session/app/:sessionKey", s.handleDeleteSessionApp)
	s.register(http.MethodPost, "/api/session/ui/:stateKey", s.handleSaveSessionUI)
	s.register(http.MethodDelete, "/api/session/ui/:stateKey", s.handleDeleteSessionUI)
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// The cors() middleware answered every request with this header.
	w.Header().Set("Access-Control-Allow-Origin", "*")

	if r.Method == http.MethodOptions {
		w.Header().Set("Access-Control-Allow-Methods", "GET,HEAD,PUT,PATCH,POST,DELETE")

		// cors() was configured without an allowedHeaders list, so it reflected
		// Access-Control-Request-Headers and added the matching Vary. Without
		// that reflection a browser rejects every preflight, and the frontend
		// runs on :5500 while this server listens on :3001 - so a JSON POST or
		// a DELETE never reaches a handler.
		w.Header().Add("Vary", "Access-Control-Request-Headers")
		if requested := r.Header.Get("Access-Control-Request-Headers"); requested != "" {
			w.Header().Set("Access-Control-Allow-Headers", requested)
		}

		w.Header().Set("Content-Length", "0")
		w.WriteHeader(http.StatusNoContent)
		return
	}

	// EscapedPath keeps percent sequences intact. Splitting here and decoding
	// each segment afterwards is what closes R1: "AC%2FDC" stays one segment
	// instead of falling apart into two.
	segments := strings.Split(strings.Trim(r.URL.EscapedPath(), "/"), "/")

	for _, route := range s.routes {
		params, ok := match(route, r.Method, segments)
		if !ok {
			continue
		}
		route.handler(w, r, params)
		return
	}

	notFoundHTML(w, r.Method, r.URL.EscapedPath())
}

// match compares a route against the request segments and extracts the
// parameters. Parameters are unescaped once, which is what Express did before
// handing them to the handler.
func match(rt route, method string, segments []string) (map[string]string, bool) {
	if rt.method != method {
		return nil, false
	}
	if len(rt.segments) != len(segments) {
		return nil, false
	}

	params := map[string]string{}
	for i, pattern := range rt.segments {
		if strings.HasPrefix(pattern, ":") {
			decoded, err := url.PathUnescape(segments[i])
			if err != nil {
				// Express handed the raw value through when decoding failed.
				decoded = segments[i]
			}
			params[pattern[1:]] = decoded
			continue
		}
		if pattern != segments[i] {
			return nil, false
		}
	}
	return params, true
}

// decodeAgain reproduces the second decodeURIComponent the cover handlers ran on
// an already decoded parameter. When it throws, the once decoded value is kept -
// that is defect D3, and the behaviour is preserved deliberately.
func decodeAgain(value string) string {
	decoded, err := url.PathUnescape(value)
	if err != nil {
		return value
	}
	return decoded
}

// isDebugging reports the current debug flag.
func (s *Server) isDebugging() bool {
	<-s.debugMu
	value := s.debugging
	s.debugMu <- struct{}{}
	return value
}

// setDebugging updates the debug flag.
func (s *Server) setDebugging(enabled bool) {
	<-s.debugMu
	s.debugging = enabled
	s.debugMu <- struct{}{}
}
