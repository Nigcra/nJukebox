// main.go
// Entry point: starts the web and data listeners of nJukebox
// Version: 2026.08.16

package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"time"

	"github.com/Nigcra/nJukebox/internal/api"
	"github.com/Nigcra/nJukebox/internal/appdb"
	"github.com/Nigcra/nJukebox/internal/config"
	"github.com/Nigcra/nJukebox/internal/eq"
	"github.com/Nigcra/nJukebox/internal/musicdb"
	"github.com/Nigcra/nJukebox/internal/scanner"
	"github.com/Nigcra/nJukebox/internal/spotify"
	"github.com/Nigcra/nJukebox/internal/tui"
	"github.com/Nigcra/nJukebox/internal/web"
)

func main() {
	var (
		root     = flag.String("root", "", "project directory holding the frontend files, config.json, data/ and music/ (default: working directory)")
		webOnly  = flag.Bool("web-only", false, "start only the web server")
		dataOnly = flag.Bool("data-only", false, "start only the data server")
		noTUI    = flag.Bool("no-tui", false, "start without the terminal interface, logging to stdout instead")
	)
	flag.Parse()

	if *webOnly && *dataOnly {
		log.Fatal("--web-only and --data-only are mutually exclusive")
	}

	if *root == "" {
		wd, err := os.Getwd()
		if err != nil {
			log.Fatalf("cannot determine working directory: %v", err)
		}
		*root = wd
	}
	*root = normalizeRoot(*root)

	// The TUI owns the screen, so the log has to go somewhere else - a stray
	// log line would tear a hole into the alt screen. Redirected output (a log
	// file, a pipe, a service manager) gets the plain logger either way.
	useTUI := !*noTUI && isTerminal(os.Stdout)
	var sink *tui.LogSink
	if useTUI {
		sink = tui.NewLogSink(512)
		log.SetOutput(sink)
		log.SetFlags(0) // the TUI stamps its own time
	}

	cfg, loaded, err := config.Load(*root)
	if err != nil {
		log.Printf("failed to load config.json, using defaults: %v", err)
	} else if loaded {
		log.Print("Configuration loaded from config.json")
	}

	webPort, dataPort, note := resolvePorts(cfg.Server.WebPort, cfg.Server.DataPort,
		os.Getenv("PORT"), *webOnly, *dataOnly)
	if note != "" {
		log.Print(note)
	}

	rt := &serverRuntime{root: *root, errs: make(chan error, 2)}

	if !*webOnly {
		data, err := rt.startData(*root)
		if err != nil {
			fatal(useTUI, "data server: %v", err)
		}
		defer data.cleanup()

		rt.dataAddr = fmt.Sprintf("%s:%d", cfg.Server.Host, dataPort)
		log.Printf("Data server listening on http://%s", rt.dataAddr)
		go func() {
			rt.errs <- http.ListenAndServe(rt.dataAddr, data.handler)
		}()
	}

	if !*dataOnly {
		// The web root is web/ and not the project directory, so nothing outside
		// it can be reached even if the allowlist in internal/web ever grew a
		// hole: data/ with the Spotify tokens, the sources and the tooling are
		// simply not below it. That is what the Node server got wrong (S2).
		server, err := web.New(filepath.Join(*root, "web"), cfg.Server.Host, webPort)
		if err != nil {
			fatal(useTUI, "web server: %v", err)
		}
		rt.webAddr = fmt.Sprintf("%s:%d", cfg.Server.Host, webPort)
		rt.webURL = fmt.Sprintf("http://%s:%d/", cfg.Server.Host, webPort)
		// No log line here: ListenAndServe announces itself, and saying it twice
		// only makes the event log look like something happened twice.
		go func() {
			rt.errs <- server.ListenAndServe()
		}()
	}

	if !useTUI {
		log.Fatalf("server stopped: %v", <-rt.errs)
	}

	// A listener that dies takes the whole server with it, but under the TUI it
	// must not call log.Fatal: that would leave the terminal in the alt screen
	// with no way back. Report it and let the user quit.
	go func() {
		if err := <-rt.errs; err != nil {
			log.Printf("server stopped: %v", err)
			rt.setFatal(err)
		}
	}()

	model := tui.New(tui.Config{
		WebURL:   rt.webURL,
		WebAddr:  rt.webAddr,
		DataAddr: rt.dataAddr,
		Root:     rt.root,
		Stats:    rt.snapshot,
		Rescan:   rt.rescan,
		Events:   sink.Events(),
	})
	if err := model.Run(); err != nil {
		log.SetOutput(os.Stderr)
		fmt.Fprintln(os.Stderr, "TUI error:", err)
	}
}

// serverRuntime holds what the TUI needs to read out of the running server.
type serverRuntime struct {
	root     string
	webAddr  string
	dataAddr string
	webURL   string
	errs     chan error

	music   *musicdb.DB
	app     *appdb.DB
	scanner *scanner.Scanner
	spotify *spotify.Manager
	runScan func()

	mu       sync.Mutex
	lastScan string
	fatalErr error
}

// dataServer bundles the API handler with the shutdown of everything it owns.
type dataServer struct {
	handler http.Handler
	cleanup func()
}

// startData opens both databases, starts scanner and token manager, wires up
// the API and keeps the handles the TUI reads from.
func (r *serverRuntime) startData(root string) (*dataServer, error) {
	// initializeServer() created both directories before touching anything else.
	// Without music/ the scanner cannot even list the library.
	for _, dir := range []string{
		filepath.Join(root, "music"),
		filepath.Join(root, "data", "converted"),
	} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return nil, fmt.Errorf("create %s: %w", dir, err)
		}
	}

	music, err := musicdb.Open(filepath.Join(root, "data", "music.db"))
	if err != nil {
		return nil, err
	}

	app, err := appdb.Open(filepath.Join(root, "data", "app.db"))
	if err != nil {
		music.Close()
		return nil, err
	}

	// The debug flag comes from the settings table, defaulting to true like the
	// Node server did.
	debugging := true
	if value, ok := app.GetSetting("admin", "debuggingEnabled", true).(bool); ok {
		debugging = value
	}

	server := api.New(root, music, app, debugging)

	// Loopback spectrum for the footer equalizer. Spotify plays DRM protected
	// audio the browser cannot tap, so the spectrum comes from the system
	// output instead. Capture only runs while a browser is subscribed.
	if eq.Supported() {
		server.RegisterEqualizer(eq.NewEngine())
		log.Print("[EQ] loopback spectrum available at /api/eq/stream")
	}

	// Server side Spotify tokens. The goroutine renews proactively and keeps the
	// login alive without an open browser.
	manager := spotify.NewManager(app, spotify.Options{})
	manager.Start()
	server.RegisterSpotifyAuth(manager)

	// Library scanner. Watching starts before the initial scan, same order as
	// initializeServer() in the Node version.
	musicDir := filepath.Join(root, "music")
	sc := scanner.New(root, musicDir, music)
	sc.SetVerbose(debugging)

	scanCtx, stopScan := context.WithCancel(context.Background())
	if err := sc.Watch(scanCtx); err != nil {
		log.Printf("[SCANNER] could not watch %s: %v", musicDir, err)
	}

	r.music, r.app, r.scanner, r.spotify = music, app, sc, manager

	// One scan path for the API and the TUI, so both record the same summary.
	scan := func(ctx context.Context) error {
		result, err := sc.ScanAll(ctx)
		if err != nil {
			return err
		}
		r.noteScan(result)
		return nil
	}
	server.RegisterRescan(scan)
	r.runScan = func() {
		go func() {
			if err := scan(scanCtx); err != nil {
				log.Printf("[SCANNER] rescan failed: %v", err)
			}
		}()
	}

	go func() {
		if err := scan(scanCtx); err != nil {
			log.Printf("[SCANNER] initial scan failed: %v", err)
			return
		}
		r.mu.Lock()
		summary := r.lastScan
		r.mu.Unlock()
		log.Printf("[SCANNER] initial scan completed: %s", summary)
	}()

	cleanup := func() {
		stopScan()
		sc.Close()
		manager.Stop()
		app.Close()
		music.Close()
	}

	return &dataServer{handler: server, cleanup: cleanup}, nil
}

// noteScan records a finished scan for the TUI.
func (r *serverRuntime) noteScan(result scanner.Result) {
	if result.InProgress {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.lastScan = fmt.Sprintf("%d files, %d updated, %d removed (%s)",
		result.Files, result.Updated, result.Removed, result.Elapsed.Truncate(time.Millisecond))
}

// setFatal records a listener failure so the TUI can show it.
func (r *serverRuntime) setFatal(err error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.fatalErr = err
}

// rescan triggers a library scan from the TUI. Nil-safe: with --web-only there
// is no scanner, and the TUI hides the key.
func (r *serverRuntime) rescan() {
	if r.runScan != nil {
		r.runScan()
	}
}

// snapshot collects the figures the TUI shows. Called once per second, so it
// stays on cheap aggregate queries and tolerates a database that is busy.
func (r *serverRuntime) snapshot() tui.Snapshot {
	var snap tui.Snapshot

	r.mu.Lock()
	snap.LastScanText = r.lastScan
	snap.Err = r.fatalErr
	r.mu.Unlock()

	if r.scanner != nil {
		snap.Scanning = r.scanner.Scanning()
		snap.MusicDir = r.scanner.MusicDir()
	}
	if r.music == nil {
		return snap
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	if stats, err := r.music.GetStats(ctx); err == nil {
		snap.Tracks = stats.TotalTracks
		snap.Artists = stats.TotalArtists
		snap.Albums = stats.TotalAlbums
		snap.Genres = stats.TotalGenres
		if stats.TotalDuration != nil {
			snap.Duration = time.Duration(*stats.TotalDuration) * time.Second
		}
	}
	if plays, err := r.music.GetPlayStats(ctx); err == nil && plays.TotalPlays != nil {
		snap.Plays = *plays.TotalPlays
	}
	if r.app != nil {
		if queue, err := r.app.GetQueueStats(ctx); err == nil {
			snap.Sessions = queue.ActiveSessions
		}
		if id, _ := r.app.GetSetting("spotify", "clientId", "").(string); id != "" {
			snap.SpotifyConfigured = true
		}
	}
	if r.spotify != nil {
		if status, err := r.spotify.Status(ctx); err == nil {
			snap.SpotifyConnected = status.Connected
			if status.Connected {
				snap.SpotifyConfigured = true
			}
			if status.ExpiresAt > 0 {
				snap.SpotifyExpires = time.UnixMilli(status.ExpiresAt)
			}
		}
	}
	return snap
}

// fatal reports a startup failure. Under the TUI the log goes to the sink that
// nobody is draining yet, so the message has to reach stderr directly.
func fatal(useTUI bool, format string, args ...any) {
	if useTUI {
		log.SetOutput(os.Stderr)
	}
	log.Fatalf(format, args...)
}

// isTerminal reports whether f is an interactive terminal. Redirected output -
// a log file, a pipe, a service manager - is not, and must keep the plain
// logger rather than a TUI drawing escape sequences into a file.
func isTerminal(f *os.File) bool {
	info, err := f.Stat()
	if err != nil {
		return false
	}
	return info.Mode()&os.ModeCharDevice != 0
}

// normalizeRoot makes the project directory canonical enough that the same
// installation always yields the same file paths.
//
// The scanner stores absolute paths in tracks.file_path, and SQLite compares
// text case sensitively. On Windows the same directory can be addressed as
// "c:\..." or "C:\...", so starting the server once with a lower case drive
// letter would insert a second row for every file that is already in the
// library. Node never had this problem because it derived the root from
// __dirname, which always comes back with an upper case drive letter; --root is
// new here, and it accepts whatever the caller typed.
func normalizeRoot(path string) string {
	cleaned := filepath.Clean(path)

	if len(cleaned) >= 2 && cleaned[1] == ':' {
		drive := cleaned[0]
		if drive >= 'a' && drive <= 'z' {
			cleaned = string(drive-'a'+'A') + cleaned[1:]
		}
	}

	return cleaned
}

// resolvePorts decides which ports the two listeners use and returns a note to
// log when the environment asked for something that cannot be honoured.
//
// The Node servers honoured a PORT environment variable above the configured
// port. That worked because they were two processes: each read PORT for its own
// single listener. This binary runs both, so applying PORT to both would point
// them at the same address - the second bind fails with "address already in
// use" and the whole process dies.
//
// PORT therefore only applies when exactly one listener runs. With both, it is
// ignored and said out loud rather than silently doing damage.
func resolvePorts(configuredWeb, configuredData int, env string, webOnly, dataOnly bool) (web, data int, note string) {
	web, data = configuredWeb, configuredData

	if env == "" {
		return web, data, ""
	}

	parsed, err := strconv.Atoi(env)
	if err != nil {
		return web, data, fmt.Sprintf("ignoring invalid PORT value %q: %v", env, err)
	}

	switch {
	case webOnly:
		return parsed, data, ""
	case dataOnly:
		return web, parsed, ""
	default:
		return web, data, fmt.Sprintf(
			"ignoring PORT=%s: it cannot apply to the web and the data listener at once, "+
				"use --web-only or --data-only, or set the ports in config.json", env)
	}
}
