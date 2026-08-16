// batch_test.go
// Verifies the write batch is committed while the workers are still parsing
// Version: 2026.08.16

package scanner

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/Nigcra/nJukebox/internal/musicdb"
)

// writeResults used to hold its transaction across the wait for the next parsed
// file, so the write lock was held for as long as the pool needed to read tags
// and cover art for a whole batch of transactionSize files. Everything else
// that wanted to write - a play count, the play history - waited that long.
//
// The batch is far from full here and the channel stays open, so the only thing
// that can make the rows visible is the commit on an idle channel.
func TestBatchCommitsWhileWorkersAreStillParsing(t *testing.T) {
	dir := t.TempDir()
	musicDir := filepath.Join(dir, "music")
	if err := os.MkdirAll(musicDir, 0o755); err != nil {
		t.Fatalf("create music dir: %v", err)
	}

	db, err := musicdb.Open(filepath.Join(dir, "music.db"))
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	t.Cleanup(func() { db.Close() })

	s := New(dir, musicDir, db)

	out := make(chan scanned)
	done := make(chan error, 1)
	result := &Result{}
	go func() { done <- s.writeResults(context.Background(), out, result) }()

	title := "Early"
	out <- scanned{path: "a.mp3", track: &musicdb.Track{
		FilePath: filepath.Join(musicDir, "a.mp3"), Title: &title,
	}}

	// Stand in for the workers parsing the next file. The channel is idle, so
	// the batch has to be committed rather than held open.
	deadline := time.Now().Add(5 * time.Second)
	var count int
	for {
		count = trackCount(t, db)
		if count > 0 || time.Now().After(deadline) {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if count != 1 {
		t.Errorf("track not visible while the channel was idle: got %d rows, want 1", count)
	}

	close(out)
	if err := <-done; err != nil {
		t.Fatalf("writeResults: %v", err)
	}
	if result.Updated != 1 {
		t.Errorf("Updated = %d, want 1", result.Updated)
	}
}

// A batch that keeps filling must still be committed in one go, otherwise the
// batching that R8 asks for is gone.
func TestFullBatchStillCommitsAtTransactionSize(t *testing.T) {
	dir := t.TempDir()
	musicDir := filepath.Join(dir, "music")
	if err := os.MkdirAll(musicDir, 0o755); err != nil {
		t.Fatalf("create music dir: %v", err)
	}

	db, err := musicdb.Open(filepath.Join(dir, "music.db"))
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	t.Cleanup(func() { db.Close() })

	s := New(dir, musicDir, db)
	s.transactionSize = 3

	// Buffered and pre-filled, so the consumer always finds something ready and
	// never takes the idle path.
	out := make(chan scanned, 6)
	for i := range 6 {
		title := "T"
		out <- scanned{path: "x.mp3", track: &musicdb.Track{
			FilePath: filepath.Join(musicDir, string(rune('a'+i))+".mp3"), Title: &title,
		}}
	}
	close(out)

	if err := s.writeResults(context.Background(), out, &Result{}); err != nil {
		t.Fatalf("writeResults: %v", err)
	}
	if got := trackCount(t, db); got != 6 {
		t.Errorf("got %d rows, want 6", got)
	}
}
