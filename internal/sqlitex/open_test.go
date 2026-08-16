// open_test.go
// Verifies the pragmas reach every connection and that readers never wait
// Version: 2026.08.16

package sqlitex

import (
	"context"
	"path/filepath"
	"testing"
	"time"
)

// The pragmas are passed through the DSN, and the values are percent-encoded by
// url.Values.Encode. If the driver ever stopped decoding them, busy_timeout
// would silently fall back to 0 and journal_mode to the rollback journal.
func TestPragmasApplyToBothPools(t *testing.T) {
	path := filepath.Join(t.TempDir(), "pragma.db")
	write, read, err := Open(path)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer write.Close()
	defer read.Close()

	for _, c := range []struct {
		name string
		q    string
		want string
	}{
		{"busy_timeout", "PRAGMA busy_timeout", "5000"},
		{"journal_mode", "PRAGMA journal_mode", "wal"},
	} {
		var onWriter, onReader string
		if err := write.QueryRow(c.q).Scan(&onWriter); err != nil {
			t.Fatalf("%s on writer: %v", c.name, err)
		}
		if err := read.QueryRow(c.q).Scan(&onReader); err != nil {
			t.Fatalf("%s on reader: %v", c.name, err)
		}
		if onWriter != c.want || onReader != c.want {
			t.Errorf("%s: writer %q, reader %q, want %q", c.name, onWriter, onReader, c.want)
		}
	}
}

// This is the regression the split exists for. With reads and writes sharing a
// single connection the query below waits for the transaction to finish, which
// during a library scan meant the whole interface waited on the scanner.
func TestReadDoesNotWaitForAnOpenWriteTransaction(t *testing.T) {
	path := filepath.Join(t.TempDir(), "concurrent.db")
	write, read, err := Open(path)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer write.Close()
	defer read.Close()

	if _, err := write.Exec(`CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)`); err != nil {
		t.Fatalf("create: %v", err)
	}
	if _, err := write.Exec(`INSERT INTO t (v) VALUES ('committed')`); err != nil {
		t.Fatalf("seed: %v", err)
	}

	tx, err := write.BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	// The write lock is taken here and held until Commit.
	if _, err := tx.Exec(`INSERT INTO t (v) VALUES ('uncommitted')`); err != nil {
		t.Fatalf("insert in transaction: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	var count int
	if err := read.QueryRowContext(ctx, `SELECT COUNT(*) FROM t`).Scan(&count); err != nil {
		t.Fatalf("read blocked while a write transaction was open: %v", err)
	}
	if count != 1 {
		t.Errorf("reader saw %d rows, want 1 - it must see the last committed snapshot, not the open transaction", count)
	}

	if err := tx.Commit(); err != nil {
		t.Fatalf("commit: %v", err)
	}

	if err := read.QueryRow(`SELECT COUNT(*) FROM t`).Scan(&count); err != nil {
		t.Fatalf("read after commit: %v", err)
	}
	if count != 2 {
		t.Errorf("reader saw %d rows after commit, want 2", count)
	}
}
