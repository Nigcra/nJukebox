// scan.go
// Lookup the scanner needs before it opens its first write transaction
// Version: 2026.08.13

package musicdb

import (
	"context"
	"fmt"
)

// GetTrackFingerprints returns the modification time of every indexed file,
// keyed by file path. The scanner reads them in one go before it starts
// writing: the database runs on a single connection, so a lookup issued while
// a batch transaction is open would have to wait for that transaction.
//
// A NULL file_mtime becomes 0, which never matches a real timestamp and
// therefore forces a rescan of that row.
func (d *DB) GetTrackFingerprints(ctx context.Context) (map[string]int64, error) {
	rows, err := d.read.QueryContext(ctx, "SELECT file_path, file_mtime FROM tracks")
	if err != nil {
		return nil, fmt.Errorf("query track fingerprints: %w", err)
	}
	defer rows.Close()

	fingerprints := make(map[string]int64)
	for rows.Next() {
		var (
			filePath string
			mtime    *int64
		)
		if err := rows.Scan(&filePath, &mtime); err != nil {
			return nil, fmt.Errorf("scan track fingerprint: %w", err)
		}
		if mtime == nil {
			fingerprints[filePath] = 0
			continue
		}
		fingerprints[filePath] = *mtime
	}
	return fingerprints, rows.Err()
}
