// main.go
// Entry point: starts the web and data listeners of nJukebox
// Version: 2026.08.14

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

	"github.com/Nigcra/nJukebox/internal/api"
	"github.com/Nigcra/nJukebox/internal/appdb"
	"github.com/Nigcra/nJukebox/internal/config"
	"github.com/Nigcra/nJukebox/internal/eq"
	"github.com/Nigcra/nJukebox/internal/musicdb"
	"github.com/Nigcra/nJukebox/internal/scanner"
	"github.com/Nigcra/nJukebox/internal/spotify"
	"github.com/Nigcra/nJukebox/internal/web"
)

func main() {
	var (
		root     = flag.String("root", "", "project directory holding the frontend files, config.json, data/ and music/ (default: working directory)")
		webOnly  = flag.Bool("web-only", false, "start only the web server")
		dataOnly = flag.Bool("data-only", false, "start only the data server")
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

	errs := make(chan error, 2)

	if !*webOnly {
		dataServer, cleanup, err := buildDataServer(*root)
		if err != nil {
			log.Fatalf("data server: %v", err)
		}
		defer cleanup()

		addr := fmt.Sprintf("%s:%d", cfg.Server.Host, dataPort)
		log.Printf("Data server listening on http://%s", addr)
		go func() {
			errs <- http.ListenAndServe(addr, dataServer)
		}()
	}

	if !*dataOnly {
		// The web root is web/ and not the project directory, so nothing outside
		// it can be reached even if the allowlist in internal/web ever grew a
		// hole: data/ with the Spotify tokens, the sources and the tooling are
		// simply not below it. That is what the Node server got wrong (S2).
		server, err := web.New(filepath.Join(*root, "web"), cfg.Server.Host, webPort)
		if err != nil {
			log.Fatalf("web server: %v", err)
		}
		go func() {
			errs <- server.ListenAndServe()
		}()
	}

	log.Fatalf("server stopped: %v", <-errs)
}

// buildDataServer opens both databases, starts scanner and token manager and
// wires up the API.
func buildDataServer(root string) (http.Handler, func(), error) {
	// initializeServer() created both directories before touching anything else.
	// Without music/ the scanner cannot even list the library.
	for _, dir := range []string{
		filepath.Join(root, "music"),
		filepath.Join(root, "data", "converted"),
	} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return nil, nil, fmt.Errorf("create %s: %w", dir, err)
		}
	}

	music, err := musicdb.Open(filepath.Join(root, "data", "music.db"))
	if err != nil {
		return nil, nil, err
	}

	app, err := appdb.Open(filepath.Join(root, "data", "app.db"))
	if err != nil {
		music.Close()
		return nil, nil, err
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
	server.RegisterRescan(func(ctx context.Context) error {
		_, err := sc.ScanAll(ctx)
		return err
	})

	go func() {
		result, err := sc.ScanAll(scanCtx)
		if err != nil {
			log.Printf("[SCANNER] initial scan failed: %v", err)
			return
		}
		log.Printf("[SCANNER] initial scan completed: %d files, %d updated", result.Files, result.Updated)
	}()

	cleanup := func() {
		stopScan()
		sc.Close()
		manager.Stop()
		app.Close()
		music.Close()
	}

	return server, cleanup, nil
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
