// prune_test.go
// Verifies that a track survives one failed lookup and only dies on the second
// Version: 2026.08.13

package scanner

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/Nigcra/nJukebox/internal/musicdb"
)

// pruneFixture builds a library with one real file plus extra rows pointing at
// paths that do not exist.
func pruneFixture(t *testing.T, ghosts ...string) (*Scanner, *musicdb.DB, string) {
	t.Helper()

	dir := t.TempDir()
	musicDir := filepath.Join(dir, "music")
	if err := os.MkdirAll(musicDir, 0o755); err != nil {
		t.Fatalf("create music dir: %v", err)
	}

	real := taggedMP3(t, filepath.Join(musicDir, "keeper.mp3"), 40)

	db, err := musicdb.Open(filepath.Join(dir, "music.db"))
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	t.Cleanup(func() { db.Close() })

	ctx := context.Background()
	for _, ghost := range ghosts {
		title := "Ghost"
		if _, err := db.InsertTrack(ctx, db.Exec(), musicdb.Track{
			FilePath: ghost,
			Title:    &title,
		}); err != nil {
			t.Fatalf("insert ghost row: %v", err)
		}
	}

	return New(dir, musicDir, db), db, real
}

func trackCount(t *testing.T, db *musicdb.DB) int {
	t.Helper()
	tracks, err := db.GetTracks(context.Background(), musicdb.TrackFilters{})
	if err != nil {
		t.Fatalf("count tracks: %v", err)
	}
	return len(tracks)
}

// The core of the request: one miss must not delete anything.
func TestPruneKeepsTrackAfterFirstMiss(t *testing.T) {
	ghost := filepath.Join(t.TempDir(), "gone.mp3")
	scanner, db, _ := pruneFixture(t, ghost)
	ctx := context.Background()

	result, err := scanner.ScanAll(ctx)
	if err != nil {
		t.Fatalf("first scan: %v", err)
	}
	if result.Removed != 0 {
		t.Errorf("first scan removed %d tracks, want 0", result.Removed)
	}
	if got := trackCount(t, db); got != 2 {
		t.Fatalf("after first scan %d tracks, want 2", got)
	}

	misses, err := db.MissCount(ctx, ghost)
	if err != nil {
		t.Fatalf("miss count: %v", err)
	}
	if misses != 1 {
		t.Errorf("miss count = %d, want 1", misses)
	}
}

// The second scan in a row is the one that deletes.
func TestPruneRemovesTrackOnSecondMiss(t *testing.T) {
	ghost := filepath.Join(t.TempDir(), "gone.mp3")
	scanner, db, _ := pruneFixture(t, ghost)
	ctx := context.Background()

	if _, err := scanner.ScanAll(ctx); err != nil {
		t.Fatalf("first scan: %v", err)
	}

	result, err := scanner.ScanAll(ctx)
	if err != nil {
		t.Fatalf("second scan: %v", err)
	}
	if result.Removed != 1 {
		t.Errorf("second scan removed %d tracks, want 1", result.Removed)
	}
	if got := trackCount(t, db); got != 1 {
		t.Errorf("after second scan %d tracks, want 1", got)
	}

	// The bookkeeping row has to go with it.
	misses, err := db.MissCount(ctx, ghost)
	if err != nil {
		t.Fatalf("miss count: %v", err)
	}
	if misses != 0 {
		t.Errorf("miss count = %d after removal, want 0", misses)
	}
}

// A file that comes back breaks the run, and the counter starts over. This is
// the case the whole design exists for: a volume that was briefly away.
func TestPruneResetsWhenFileReturns(t *testing.T) {
	scanner, db, real := pruneFixture(t)
	ctx := context.Background()

	// A second file that never moves, so the scan is never empty - an empty
	// scan would skip pruning altogether and prove nothing here.
	taggedMP3(t, filepath.Join(scanner.musicDir, "anchor.mp3"), 40)
	if _, err := scanner.ScanAll(ctx); err != nil {
		t.Fatalf("initial scan: %v", err)
	}

	// Away for one scan.
	hidden := real + ".away"
	if err := os.Rename(real, hidden); err != nil {
		t.Fatalf("hide file: %v", err)
	}
	if _, err := scanner.ScanAll(ctx); err != nil {
		t.Fatalf("scan with hidden file: %v", err)
	}

	misses, err := db.MissCount(ctx, real)
	if err != nil {
		t.Fatalf("miss count: %v", err)
	}
	if misses != 1 {
		t.Fatalf("miss count = %d, want 1", misses)
	}

	// Back again.
	if err := os.Rename(hidden, real); err != nil {
		t.Fatalf("restore file: %v", err)
	}
	if _, err := scanner.ScanAll(ctx); err != nil {
		t.Fatalf("scan with restored file: %v", err)
	}

	misses, err = db.MissCount(ctx, real)
	if err != nil {
		t.Fatalf("miss count: %v", err)
	}
	if misses != 0 {
		t.Errorf("miss count = %d after the file returned, want 0", misses)
	}

	// And a third scan must still not delete it.
	result, err := scanner.ScanAll(ctx)
	if err != nil {
		t.Fatalf("third scan: %v", err)
	}
	if result.Removed != 0 {
		t.Errorf("removed %d tracks, want 0", result.Removed)
	}
	if got := trackCount(t, db); got != 2 {
		t.Errorf("%d tracks left, want 2", got)
	}
}

// An empty music directory looks exactly like an unmounted drive. However often
// it happens, nothing may be deleted.
func TestPruneNeverRunsOnAnEmptyScan(t *testing.T) {
	ghost := filepath.Join(t.TempDir(), "gone.mp3")
	scanner, db, real := pruneFixture(t, ghost)
	ctx := context.Background()

	// Index the real file first, so the library really holds two rows.
	if _, err := scanner.ScanAll(ctx); err != nil {
		t.Fatalf("initial scan: %v", err)
	}
	if got := trackCount(t, db); got != 2 {
		t.Fatalf("setup wrong: %d tracks, want 2", got)
	}

	// Now the whole directory goes away, the way an unmounted drive looks.
	if err := os.Remove(real); err != nil {
		t.Fatalf("remove the only file: %v", err)
	}

	for i := 0; i < 3; i++ {
		result, err := scanner.ScanAll(ctx)
		if err != nil {
			t.Fatalf("scan %d: %v", i+1, err)
		}
		if result.Removed != 0 {
			t.Fatalf("scan %d removed %d tracks, want 0", i+1, result.Removed)
		}
	}

	if got := trackCount(t, db); got != 2 {
		t.Errorf("%d tracks left, want 2 - an empty scan must not delete", got)
	}
}

// The counter is in the database, so restarting the server does not hand out a
// fresh grace period.
func TestPruneCounterSurvivesRestart(t *testing.T) {
	ghost := filepath.Join(t.TempDir(), "gone.mp3")
	scanner, db, _ := pruneFixture(t, ghost)
	ctx := context.Background()

	if _, err := scanner.ScanAll(ctx); err != nil {
		t.Fatalf("first scan: %v", err)
	}

	// A new Scanner value stands for a restarted process; the database is the
	// same file.
	restarted := New(scanner.root, scanner.musicDir, db)
	result, err := restarted.ScanAll(ctx)
	if err != nil {
		t.Fatalf("scan after restart: %v", err)
	}
	if result.Removed != 1 {
		t.Errorf("removed %d tracks after restart, want 1", result.Removed)
	}
	if got := trackCount(t, db); got != 1 {
		t.Errorf("%d tracks left, want 1", got)
	}
}

// A path on a volume that cannot be reached must not even be counted.
func TestVolumeReachable(t *testing.T) {
	if !volumeReachable(t.TempDir()) {
		t.Error("the temporary directory should sit on a reachable volume")
	}

	// A drive letter that is almost certainly not mounted.
	if filepath.VolumeName(`Q:\some\path`) != "" && volumeReachable(`Q:\some\path`) {
		t.Log("drive Q: exists on this machine, skipping the negative case")
	}
}
