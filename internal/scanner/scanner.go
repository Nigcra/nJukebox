// scanner.go
// Music library scan: directory walk, worker pool, batch transactions, watcher
// Version: 2026.08.16

package scanner

import (
	"context"
	"database/sql"
	"fmt"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/fsnotify/fsnotify"

	"github.com/Nigcra/nJukebox/internal/musicdb"
)

// SupportedExtensions lists the file extensions that get indexed, lower case.
// The Node scanner carried ".mp3" alone and said so in a comment; FLAC came
// later and needs its own duration reader, see metadata.go.
var SupportedExtensions = []string{".mp3", ".flac"}

const (
	// TransactionSize is the number of inserts per transaction. Node committed
	// every 100 files, and pure-Go SQLite needs the batching even more (R8).
	TransactionSize = 100

	// DebounceDelay replaces chokidar's awaitWriteFinish: a file is only read
	// once no further event arrived for this long. chokidar used a stability
	// threshold of two seconds.
	DebounceDelay = 2 * time.Second
)

// Result reports what one full scan did.
type Result struct {
	// Files is the number of music files found on disk.
	Files int

	// Processed counts the files that went through without an error, including
	// the unchanged ones - the same counter the Node version printed.
	Processed int

	// Updated counts the files that were actually written to the database.
	Updated int

	// Skipped counts the files whose mtime still matched the database.
	Skipped int

	// Errors counts the files that failed.
	Errors int

	// Removed counts the tracks whose file was gone for the second scan in a
	// row and that were therefore dropped from the library.
	Removed int

	// InProgress is true when another scan was already running and this call
	// did nothing, which is how scanAll() behaved.
	InProgress bool

	// Elapsed is the wall clock time of the scan.
	Elapsed time.Duration
}

// Scanner indexes a music directory into music.db and keeps it up to date.
type Scanner struct {
	root     string
	musicDir string
	db       *musicdb.DB

	workers         int
	transactionSize int
	debounce        time.Duration
	verbose         bool

	scanning atomic.Bool

	mu      sync.Mutex
	watcher *fsnotify.Watcher
	timers  map[string]*time.Timer
}

// New creates a scanner for musicDir. root is the project directory the cover
// files are written below, which is what the Node process' working directory
// was when it wrote "./data/covers".
func New(root, musicDir string, db *musicdb.DB) *Scanner {
	workers := runtime.NumCPU()
	if workers < 2 {
		workers = 2
	}
	if workers > 8 {
		workers = 8
	}

	return &Scanner{
		root:            root,
		musicDir:        musicDir,
		db:              db,
		workers:         workers,
		transactionSize: TransactionSize,
		debounce:        DebounceDelay,
		timers:          map[string]*time.Timer{},
	}
}

// SetWorkers overrides the size of the worker pool. Zero or less keeps the
// default.
func (s *Scanner) SetWorkers(workers int) {
	if workers > 0 {
		s.workers = workers
	}
}

// SetVerbose enables the per file log lines the Node scanner printed.
func (s *Scanner) SetVerbose(verbose bool) { s.verbose = verbose }

// SetDebounce overrides the watcher debounce delay.
func (s *Scanner) SetDebounce(delay time.Duration) {
	if delay > 0 {
		s.debounce = delay
	}
}

// MusicDir returns the directory being indexed.
func (s *Scanner) MusicDir() string { return s.musicDir }

// Scanning reports whether a full scan is currently running.
func (s *Scanner) Scanning() bool { return s.scanning.Load() }

func (s *Scanner) logf(format string, args ...any) { log.Printf(format, args...) }

func (s *Scanner) debugf(format string, args ...any) {
	if s.verbose {
		log.Printf(format, args...)
	}
}

// ScanAll indexes the whole library. It is the entry point for the initial scan
// and for POST /api/rescan.
//
// A scan that is already running is not queued: the call returns immediately
// with InProgress set and no error, exactly like scanAll() logged and returned.
func (s *Scanner) ScanAll(ctx context.Context) (Result, error) {
	if !s.scanning.CompareAndSwap(false, true) {
		s.logf("[SCANNER] Scan already in progress...")
		return Result{InProgress: true}, nil
	}
	defer s.scanning.Store(false)

	started := time.Now()
	s.logf("[SCANNER] Starting full music library scan...")

	files, err := FindMusicFiles(s.musicDir)
	if err != nil {
		return Result{Elapsed: time.Since(started)}, fmt.Errorf("find music files: %w", err)
	}
	s.logf("[SCANNER] Found %d music files", len(files))

	// Every known mtime is read before the first transaction opens. The Node
	// version prefetched per batch; doing it once is not just faster, it is
	// required here because the database runs on a single connection and a
	// query issued while a write transaction is open would block behind it.
	known, err := s.db.GetTrackFingerprints(ctx)
	if err != nil {
		return Result{Files: len(files), Elapsed: time.Since(started)}, err
	}

	result := Result{Files: len(files)}
	if len(files) == 0 {
		result.Elapsed = time.Since(started)
		// Deliberately no pruning here. A scan that finds nothing must never
		// delete anything - an unmounted drive looks exactly like this.
		if len(known) > 0 {
			s.logf("[SCANNER] No files found while %d tracks are indexed - nothing will be removed", len(known))
		}
		s.logf("[SCANNER] Scan completed: 0 processed, 0 errors")
		return result, nil
	}

	jobs := make(chan string)
	out := make(chan scanned, s.workers)

	var wg sync.WaitGroup
	for i := 0; i < s.workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for path := range jobs {
				mtime, seen := known[path]
				track, err := s.scanFile(path, mtime, seen)
				select {
				case out <- scanned{path: path, track: track, err: err}:
				case <-ctx.Done():
					return
				}
			}
		}()
	}

	go func() {
		defer close(jobs)
		for _, path := range files {
			select {
			case jobs <- path:
			case <-ctx.Done():
				return
			}
		}
	}()

	go func() {
		wg.Wait()
		close(out)
	}()

	writeErr := s.writeResults(ctx, out, &result)

	// Only prune once the scan itself went through. A run that already failed
	// says nothing reliable about which files are really gone.
	if writeErr == nil {
		onDisk := make(map[string]bool, len(files))
		for _, path := range files {
			onDisk[path] = true
		}

		removed, err := s.pruneMissing(ctx, known, onDisk)
		result.Removed = removed
		if err != nil {
			writeErr = err
		}
	}

	result.Elapsed = time.Since(started)

	if result.Removed > 0 {
		s.logf("[SCANNER] Scan completed: %d processed, %d errors, %d removed",
			result.Processed, result.Errors, result.Removed)
	} else {
		s.logf("[SCANNER] Scan completed: %d processed, %d errors", result.Processed, result.Errors)
	}
	return result, writeErr
}

// scanned is one worker result. A nil track means the file was unchanged.
type scanned struct {
	path  string
	track *musicdb.Track
	err   error
}

// writeResults is the only goroutine that touches the database during a scan.
// It keeps one transaction open per batch of transactionSize inserts (R8) and
// always drains the channel, so a write error never leaves a worker blocked.
//
// The batch is also committed whenever the workers have nothing ready. An open
// transaction holds a write lock on the database, and it used to be held across
// the wait for the next parsed file - so for as long as the pool needed to read
// tags, duration and cover art for a whole batch, every other writer waited.
// Committing on an empty channel bounds that to the insert work itself.
func (s *Scanner) writeResults(ctx context.Context, out <-chan scanned, result *Result) error {
	var (
		tx       *sql.Tx
		inTx     int
		firstErr error
	)

	commit := func() {
		if tx == nil {
			return
		}
		if err := tx.Commit(); err != nil {
			s.logf("[SCANNER] Commit failed: %v", err)
			if firstErr == nil {
				firstErr = err
			}
		}
		tx = nil
		inTx = 0
	}

	for {
		var (
			item scanned
			ok   bool
		)
		select {
		case item, ok = <-out:
		default:
			// Nothing parsed yet. Release the write lock before blocking on the
			// workers, then wait for real.
			commit()
			item, ok = <-out
		}
		if !ok {
			break
		}

		if item.err != nil {
			result.Errors++
			s.logf("[SCANNER] Error processing %s: %v", filepath.Base(item.path), item.err)
			continue
		}

		result.Processed++

		if item.track == nil {
			result.Skipped++
		} else {
			if tx == nil {
				started, err := s.db.Begin(ctx)
				if err != nil {
					result.Errors++
					if firstErr == nil {
						firstErr = err
					}
					s.logf("[SCANNER] Could not start transaction: %v", err)
					continue
				}
				tx = started
			}

			if _, err := s.db.InsertTrack(ctx, tx, *item.track); err != nil {
				// Same reaction as the Node batch handler: roll back, count the
				// error and carry on with a fresh transaction.
				s.logf("[SCANNER] Insert failed, rolling back: %v", err)
				if rbErr := tx.Rollback(); rbErr != nil {
					s.logf("[SCANNER] Rollback failed: %v", rbErr)
				}
				tx = nil
				inTx = 0
				result.Errors++
				result.Processed--
				if firstErr == nil {
					firstErr = err
				}
				continue
			}

			result.Updated++
			inTx++
			if inTx >= s.transactionSize {
				commit()
			}
		}

		if result.Processed%50 == 0 {
			s.logf("[SCANNER] Progress: %d/%d files processed, %d errors",
				result.Processed, result.Files, result.Errors)
		}
	}

	commit()
	return firstErr
}

// ScanPath indexes a single file and writes it straight away. Used by the
// watcher and available for callers that know which file changed.
func (s *Scanner) ScanPath(ctx context.Context, path string) error {
	existing, err := s.db.GetTrackByPath(ctx, path)
	if err != nil {
		return err
	}

	var (
		mtime int64
		seen  bool
	)
	if existing != nil {
		seen = true
		if existing.FileMtime != nil {
			mtime = *existing.FileMtime
		}
	}

	track, err := s.scanFile(path, mtime, seen)
	if err != nil {
		return err
	}
	if track == nil {
		return nil
	}

	_, err = s.db.InsertTrack(ctx, s.db.Exec(), *track)
	return err
}

// scanFile reads one file and builds its database row. A nil track means the
// file has not changed since the last scan.
func (s *Scanner) scanFile(path string, knownMtime int64, known bool) (*musicdb.Track, error) {
	info, err := os.Stat(path)
	if err != nil {
		return nil, fmt.Errorf("stat %s: %w", path, err)
	}

	mtime := info.ModTime().UnixMilli()
	if known && knownMtime == mtime {
		return nil, nil
	}

	s.debugf("[SCANNER] Processing: %s", filepath.Base(path))

	// A metadata error is not fatal: the Node version fell back to the file
	// name after ffprobe failed as well, and ffprobe is gone (see section 3 of
	// the migration plan).
	meta, err := ReadMetadata(path)
	if err != nil {
		s.logf("[SCANNER] Metadata error for %s: %v", filepath.Base(path), err)
	}

	coverPath := ""
	if len(meta.Picture) > 0 {
		coverPath = s.extractCoverArt(path, meta.Picture)
	} else {
		coverPath = s.findFolderCover(path)
	}

	size := info.Size()
	title := firstNonEmpty(meta.Title, baseNameWithoutExt(path))
	artist := firstNonEmpty(meta.Artist, "Unknown Artist")
	album := firstNonEmpty(meta.Album, "Unknown Album")
	format := firstNonEmpty(meta.Container, strings.TrimPrefix(filepath.Ext(path), "."))
	hasCover := int64(0)
	if coverPath != "" {
		hasCover = 1
	}

	track := musicdb.Track{
		FilePath:  path,
		FileSize:  &size,
		FileMtime: &mtime,
		Title:     &title,
		Artist:    &artist,
		Album:     &album,
		// common.albumartist || common.artist - not the "Unknown Artist"
		// fallback, so a file without any artist tag keeps this column NULL.
		AlbumArtist: optionalString(firstNonEmpty(meta.AlbumArtist, meta.Artist)),
		Genre:       optionalString(ValidateGenresString(meta.Genre)),
		Year:        optionalInt(meta.Year),
		TrackNumber: optionalInt(meta.TrackNumber),
		DiscNumber:  optionalInt(meta.DiscNumber),
		Duration:    optionalFloat(meta.Duration),
		Bitrate:     optionalInt(meta.Bitrate),
		Format:      optionalString(format),
		CoverPath:   optionalString(coverPath),
		HasCover:    &hasCover,
	}
	return &track, nil
}

// FindMusicFiles walks the directory and returns every supported file. Symlinks
// are not followed, which is what fs.readdir with withFileTypes did too.
func FindMusicFiles(dir string) ([]string, error) {
	var files []string

	err := filepath.WalkDir(dir, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			return nil
		}
		if !entry.Type().IsRegular() {
			return nil
		}
		if IsSupportedFormat(path) {
			files = append(files, path)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return files, nil
}

// IsSupportedFormat mirrors isSupportedFormat(), case insensitive.
func IsSupportedFormat(path string) bool {
	ext := filepath.Ext(path)
	for _, supported := range SupportedExtensions {
		if strings.EqualFold(ext, supported) {
			return true
		}
	}
	return false
}

// Watch starts the file watcher. It returns as soon as the watches are in
// place; the events are handled in a goroutine until ctx is cancelled or Close
// is called.
func (s *Scanner) Watch(ctx context.Context) error {
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		return fmt.Errorf("create file watcher: %w", err)
	}

	s.mu.Lock()
	s.watcher = watcher
	s.mu.Unlock()

	if err := s.watchTree(s.musicDir); err != nil {
		watcher.Close()

		s.mu.Lock()
		s.watcher = nil
		s.mu.Unlock()

		return err
	}

	go s.watchLoop(ctx, watcher)
	s.logf("[SCANNER] File watcher started")
	return nil
}

// watchTree adds a watch for dir and every directory below it. fsnotify is not
// recursive, chokidar was.
func (s *Scanner) watchTree(dir string) error {
	return filepath.WalkDir(dir, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			// A directory that vanished mid walk is not worth failing over.
			return nil
		}
		if !entry.IsDir() {
			return nil
		}
		if s.isIgnored(path) {
			return filepath.SkipDir
		}

		s.mu.Lock()
		watcher := s.watcher
		s.mu.Unlock()
		if watcher == nil {
			return filepath.SkipAll
		}
		if err := watcher.Add(path); err != nil {
			s.logf("[SCANNER] Could not watch %s: %v", path, err)
		}
		return nil
	})
}

func (s *Scanner) watchLoop(ctx context.Context, watcher *fsnotify.Watcher) {
	for {
		select {
		case <-ctx.Done():
			return

		case event, ok := <-watcher.Events:
			if !ok {
				return
			}
			s.handleEvent(ctx, event)

		case err, ok := <-watcher.Errors:
			if !ok {
				return
			}
			s.logf("[SCANNER] Watcher error: %v", err)
		}
	}
}

// handleEvent maps the fsnotify events onto the three chokidar handlers.
func (s *Scanner) handleEvent(ctx context.Context, event fsnotify.Event) {
	path := event.Name
	if s.isIgnored(path) {
		return
	}

	switch {
	case event.Has(fsnotify.Remove) || event.Has(fsnotify.Rename):
		s.cancelPending(path)
		if !IsSupportedFormat(path) {
			return
		}
		s.logf("[SCANNER] File removed: %s", path)
		if _, err := s.db.RemoveTrackByPath(ctx, path); err != nil {
			s.logf("[SCANNER] Could not remove %s: %v", path, err)
		}

	case event.Has(fsnotify.Create), event.Has(fsnotify.Write):
		info, err := os.Stat(path)
		if err != nil {
			return
		}
		if info.IsDir() {
			// A whole directory can appear at once. Watch it and pick up the
			// files it already contains.
			if err := s.watchTree(path); err != nil {
				s.logf("[SCANNER] Could not watch %s: %v", path, err)
			}
			files, err := FindMusicFiles(path)
			if err != nil {
				return
			}
			for _, file := range files {
				s.schedule(ctx, file)
			}
			return
		}
		if IsSupportedFormat(path) {
			s.schedule(ctx, path)
		}
	}
}

// schedule debounces the events of one file. Every further event pushes the
// timer back, so a file that is still being copied is only read once it is
// quiet - the job chokidar's awaitWriteFinish did.
func (s *Scanner) schedule(ctx context.Context, path string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if timer, ok := s.timers[path]; ok {
		timer.Reset(s.debounce)
		return
	}

	s.timers[path] = time.AfterFunc(s.debounce, func() {
		s.mu.Lock()
		delete(s.timers, path)
		s.mu.Unlock()

		if ctx.Err() != nil {
			return
		}
		s.logf("[SCANNER] File changed: %s", path)
		if err := s.ScanPath(ctx, path); err != nil {
			s.logf("[SCANNER] Error scanning %s: %v", path, err)
		}
	})
}

func (s *Scanner) cancelPending(path string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if timer, ok := s.timers[path]; ok {
		timer.Stop()
		delete(s.timers, path)
	}
}

// isIgnored reproduces chokidar's dotfile filter, applied to the part of the
// path below the music directory so a dotted parent of the library does not
// hide the whole tree.
func (s *Scanner) isIgnored(path string) bool {
	relative, err := filepath.Rel(s.musicDir, path)
	if err != nil {
		return false
	}
	for _, segment := range strings.Split(filepath.ToSlash(relative), "/") {
		if len(segment) > 1 && strings.HasPrefix(segment, ".") && segment != ".." {
			return true
		}
	}
	return false
}

// Close stops the watcher and drops all pending debounce timers.
func (s *Scanner) Close() error {
	s.mu.Lock()
	watcher := s.watcher
	s.watcher = nil
	for path, timer := range s.timers {
		timer.Stop()
		delete(s.timers, path)
	}
	s.mu.Unlock()

	if watcher == nil {
		return nil
	}
	if err := watcher.Close(); err != nil {
		return fmt.Errorf("close file watcher: %w", err)
	}
	s.logf("[SCANNER] File watcher stopped")
	return nil
}

// optionalString is the `value || null` of the Node track data.
func optionalString(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}

// optionalInt is `value || null`, so a zero stays NULL just like in JavaScript.
func optionalInt(value int) *int64 {
	if value == 0 {
		return nil
	}
	converted := int64(value)
	return &converted
}

// optionalFloat is `value || null` for duration.
func optionalFloat(value float64) *float64 {
	if value == 0 {
		return nil
	}
	return &value
}
