// scanner_test.go
// Directory walk, database writes, cover fallback and the file watcher
// Version: 2026.08.13

package scanner

import (
	"context"
	"fmt"
	"image"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/Nigcra/nJukebox/internal/musicdb"
)

// library builds a project root with a music directory and an open database.
func library(t *testing.T) (root, musicDir string, db *musicdb.DB) {
	t.Helper()

	root = t.TempDir()
	musicDir = filepath.Join(root, "music")
	if err := os.MkdirAll(musicDir, 0o755); err != nil {
		t.Fatalf("create music directory: %v", err)
	}

	db, err := musicdb.Open(filepath.Join(root, "data", "music.db"))
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	t.Cleanup(func() { db.Close() })

	return root, musicDir, db
}

// trackByPath fetches one row and fails when it is missing.
func trackByPath(t *testing.T, db *musicdb.DB, path string) musicdb.Track {
	t.Helper()

	track, err := db.GetTrackByPath(context.Background(), path)
	if err != nil {
		t.Fatalf("lookup %s: %v", path, err)
	}
	if track == nil {
		t.Fatalf("no row for %s", path)
	}
	return *track
}

func text(value *string) string {
	if value == nil {
		return "<null>"
	}
	return *value
}

func number(value *int64) string {
	if value == nil {
		return "<null>"
	}
	return fmt.Sprint(*value)
}

// imageSize reads the dimensions of a written cover.
func imageSize(t *testing.T, path string) (int, int) {
	t.Helper()

	file, err := os.Open(path)
	if err != nil {
		t.Fatalf("open cover: %v", err)
	}
	defer file.Close()

	config, _, err := image.DecodeConfig(file)
	if err != nil {
		t.Fatalf("decode cover: %v", err)
	}
	return config.Width, config.Height
}

func TestScanAllWritesTracks(t *testing.T) {
	root, musicDir, db := library(t)

	tagged := taggedMP3(t, filepath.Join(musicDir, "Artist - Song.mp3"), 120)

	// A file without any tag, in a subdirectory, next to a folder cover.
	bareDir := filepath.Join(musicDir, "Some Album")
	bare := writeMP3(t, filepath.Join(bareDir, "bare.mp3"), mpegFrames(80))
	if err := os.WriteFile(filepath.Join(bareDir, "folder.jpg"), testJPEG(t, 800, 600), 0o644); err != nil {
		t.Fatalf("write folder cover: %v", err)
	}

	sc := New(root, musicDir, db)
	result, err := sc.ScanAll(context.Background())
	if err != nil {
		t.Fatalf("ScanAll: %v", err)
	}
	if result.Files != 2 || result.Processed != 2 || result.Updated != 2 || result.Errors != 0 {
		t.Fatalf("unexpected result %+v", result)
	}

	got := trackByPath(t, db, tagged)
	if text(got.Title) != "Test Title" {
		t.Errorf("title = %s", text(got.Title))
	}
	if text(got.Artist) != "Test Artist" {
		t.Errorf("artist = %s", text(got.Artist))
	}
	if text(got.Album) != "Test Album" {
		t.Errorf("album = %s", text(got.Album))
	}
	if text(got.AlbumArtist) != "Test Album Artist" {
		t.Errorf("album artist = %s", text(got.AlbumArtist))
	}
	// "Alternative Rock/Rock/Cover" is split, the first valid part wins.
	if text(got.Genre) != "Alternative Rock" {
		t.Errorf("genre = %s", text(got.Genre))
	}
	if number(got.Year) != "1997" {
		t.Errorf("year = %s", number(got.Year))
	}
	if number(got.TrackNumber) != "3" || number(got.DiscNumber) != "2" {
		t.Errorf("track/disc = %s/%s", number(got.TrackNumber), number(got.DiscNumber))
	}
	if text(got.Format) != Container {
		t.Errorf("format = %s", text(got.Format))
	}
	if number(got.HasCover) != "1" {
		t.Errorf("has_cover = %s", number(got.HasCover))
	}
	if got.Duration == nil || *got.Duration <= 0 {
		t.Errorf("duration = %v", got.Duration)
	}
	if number(got.Bitrate) != fmt.Sprint(testBitrate) {
		t.Errorf("bitrate = %s", number(got.Bitrate))
	}

	// The stored cover path is relative to the project root and uses the
	// platform separator, which is a backslash on Windows (R7).
	wantCover := filepath.Join("data", "covers", "Artist - Song_cover.jpg")
	if text(got.CoverPath) != wantCover {
		t.Errorf("cover_path = %s, want %s", text(got.CoverPath), wantCover)
	}
	width, height := imageSize(t, filepath.Join(root, wantCover))
	if width != 500 || height != 333 {
		t.Errorf("embedded cover is %dx%d, want 500x333", width, height)
	}

	bareTrack := trackByPath(t, db, bare)
	if text(bareTrack.Title) != "bare" {
		t.Errorf("title fallback = %s, want the file name", text(bareTrack.Title))
	}
	if text(bareTrack.Artist) != "Unknown Artist" || text(bareTrack.Album) != "Unknown Album" {
		t.Errorf("fallbacks = %s / %s", text(bareTrack.Artist), text(bareTrack.Album))
	}
	// album_artist falls back to common.artist, not to "Unknown Artist".
	if bareTrack.AlbumArtist != nil {
		t.Errorf("album_artist = %s, want NULL", text(bareTrack.AlbumArtist))
	}
	if bareTrack.Genre != nil {
		t.Errorf("genre = %s, want NULL", text(bareTrack.Genre))
	}

	wantFolderCover := filepath.Join("data", "covers", "Some Album", "bare_cover.jpg")
	if text(bareTrack.CoverPath) != wantFolderCover {
		t.Errorf("cover_path = %s, want %s", text(bareTrack.CoverPath), wantFolderCover)
	}
	width, height = imageSize(t, filepath.Join(root, wantFolderCover))
	if width != 500 || height != 375 {
		t.Errorf("folder cover is %dx%d, want 500x375", width, height)
	}
}

func TestScanAllSkipsUnchangedFiles(t *testing.T) {
	root, musicDir, db := library(t)
	taggedMP3(t, filepath.Join(musicDir, "one.mp3"), 30)
	taggedMP3(t, filepath.Join(musicDir, "two.mp3"), 30)

	sc := New(root, musicDir, db)
	if _, err := sc.ScanAll(context.Background()); err != nil {
		t.Fatalf("first scan: %v", err)
	}

	second, err := sc.ScanAll(context.Background())
	if err != nil {
		t.Fatalf("second scan: %v", err)
	}
	if second.Skipped != 2 || second.Updated != 0 {
		t.Errorf("second scan: %+v, want 2 skipped and 0 written", second)
	}
}

// TestScanAllBatchesTransactions runs more files than fit into one transaction,
// so both the intermediate commit and the final one are exercised (R8).
func TestScanAllBatchesTransactions(t *testing.T) {
	root, musicDir, db := library(t)
	for i := 0; i < 5; i++ {
		taggedMP3(t, filepath.Join(musicDir, fmt.Sprintf("track-%d.mp3", i)), 10)
	}

	sc := New(root, musicDir, db)
	sc.transactionSize = 2

	result, err := sc.ScanAll(context.Background())
	if err != nil {
		t.Fatalf("ScanAll: %v", err)
	}
	if result.Updated != 5 {
		t.Errorf("wrote %d rows, want 5", result.Updated)
	}

	tracks, err := db.GetTracks(context.Background(), musicdb.TrackFilters{})
	if err != nil {
		t.Fatalf("read tracks: %v", err)
	}
	if len(tracks) != 5 {
		t.Errorf("database holds %d rows, want 5", len(tracks))
	}
}

func TestScanAllRefusesSecondRun(t *testing.T) {
	root, musicDir, db := library(t)

	sc := New(root, musicDir, db)
	sc.scanning.Store(true)

	result, err := sc.ScanAll(context.Background())
	if err != nil {
		t.Fatalf("ScanAll: %v", err)
	}
	if !result.InProgress {
		t.Error("a concurrent scan has to report InProgress instead of running")
	}
}

func TestScanPath(t *testing.T) {
	root, musicDir, db := library(t)
	path := taggedMP3(t, filepath.Join(musicDir, "single.mp3"), 20)

	sc := New(root, musicDir, db)
	if err := sc.ScanPath(context.Background(), path); err != nil {
		t.Fatalf("ScanPath: %v", err)
	}

	got := trackByPath(t, db, path)
	if text(got.Title) != "Test Title" {
		t.Errorf("title = %s", text(got.Title))
	}
}

func TestFolderCoverOrder(t *testing.T) {
	root, musicDir, db := library(t)
	path := writeMP3(t, filepath.Join(musicDir, "bare.mp3"), mpegFrames(10))

	// cover.jpg comes second in the fallback list, so folder.jpg has to win.
	if err := os.WriteFile(filepath.Join(musicDir, "cover.jpg"), testJPEG(t, 400, 800), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(musicDir, "folder.jpg"), testJPEG(t, 800, 400), 0o644); err != nil {
		t.Fatal(err)
	}

	sc := New(root, musicDir, db)
	relative := sc.findFolderCover(path)
	if relative == "" {
		t.Fatal("no folder cover found")
	}

	width, height := imageSize(t, filepath.Join(root, relative))
	if width != 500 || height != 250 {
		t.Errorf("cover is %dx%d, want 500x250 from folder.jpg", width, height)
	}
}

func TestCoverPathsAreRelativeToRoot(t *testing.T) {
	root, musicDir, db := library(t)
	sc := New(root, musicDir, db)

	relative, absolute, err := sc.coverPaths(filepath.Join(musicDir, "Artist", "Album", "song.mp3"))
	if err != nil {
		t.Fatalf("coverPaths: %v", err)
	}

	want := filepath.Join("data", "covers", "Artist", "Album", "song_cover.jpg")
	if relative != want {
		t.Errorf("relative = %q, want %q", relative, want)
	}
	if absolute != filepath.Join(root, want) {
		t.Errorf("absolute = %q", absolute)
	}
	if filepath.Separator == '\\' && !strings.Contains(relative, `\`) {
		t.Errorf("stored path %q has to use backslashes on Windows (R7)", relative)
	}
}

func TestFindMusicFiles(t *testing.T) {
	dir := t.TempDir()

	writeMP3(t, filepath.Join(dir, "a.mp3"), mpegFrames(1))
	writeMP3(t, filepath.Join(dir, "nested", "b.MP3"), mpegFrames(1))
	writeMP3(t, filepath.Join(dir, "nested", "deep", "c.mp3"), mpegFrames(1))
	if err := os.WriteFile(filepath.Join(dir, "cover.jpg"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "notes.txt"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	// The walk goes by extension alone, so the content does not matter here.
	// Whether the file is really FLAC is decided later, when it is read.
	if err := os.WriteFile(filepath.Join(dir, "song.flac"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "nested", "loud.FLAC"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}

	files, err := FindMusicFiles(dir)
	if err != nil {
		t.Fatalf("FindMusicFiles: %v", err)
	}
	if len(files) != 5 {
		t.Fatalf("found %d files, want 5 (three MP3, two FLAC): %v", len(files), files)
	}
	var flacs int
	for _, file := range files {
		if !IsSupportedFormat(file) {
			t.Errorf("%s is not a supported format", file)
		}
		if strings.EqualFold(filepath.Ext(file), ".flac") {
			flacs++
		}
	}
	if flacs != 2 {
		t.Errorf("found %d FLAC files, want 2", flacs)
	}
}

func TestIsIgnored(t *testing.T) {
	root, musicDir, db := library(t)
	sc := New(root, musicDir, db)

	cases := map[string]bool{
		filepath.Join(musicDir, "song.mp3"):                    false,
		filepath.Join(musicDir, "Album", "song.mp3"):           false,
		filepath.Join(musicDir, ".hidden", "song.mp3"):         true,
		filepath.Join(musicDir, "Album", ".sync-part"):         true,
		filepath.Join(musicDir, "Album", ".hidden", "a.mp3"):   true,
		filepath.Join(musicDir, "Album", "no.dot", "song.mp3"): false,
	}

	for path, want := range cases {
		if got := sc.isIgnored(path); got != want {
			t.Errorf("isIgnored(%q) = %v, want %v", path, got, want)
		}
	}
}

// TestWatcher covers the full loop: a file that appears is indexed after the
// debounce delay, a file that disappears is removed from the database.
func TestWatcher(t *testing.T) {
	root, musicDir, db := library(t)

	sc := New(root, musicDir, db)
	sc.SetDebounce(50 * time.Millisecond)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	if err := sc.Watch(ctx); err != nil {
		t.Fatalf("Watch: %v", err)
	}
	defer sc.Close()

	path := taggedMP3(t, filepath.Join(musicDir, "new.mp3"), 15)

	waitFor(t, "track to be indexed", func() bool {
		track, err := db.GetTrackByPath(context.Background(), path)
		return err == nil && track != nil
	})

	if err := os.Remove(path); err != nil {
		t.Fatalf("remove file: %v", err)
	}

	waitFor(t, "track to be removed", func() bool {
		track, err := db.GetTrackByPath(context.Background(), path)
		return err == nil && track == nil
	})
}

// waitFor polls until the condition holds or the test gives up.
func waitFor(t *testing.T, what string, condition func() bool) {
	t.Helper()

	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		if condition() {
			return
		}
		time.Sleep(25 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", what)
}
