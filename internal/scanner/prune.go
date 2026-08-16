// prune.go
// Removes tracks whose file disappeared, but only after two scans in a row
// Version: 2026.08.13

package scanner

import (
	"context"
	"os"
	"path/filepath"
	"time"
)

// requiredMisses is how often a file has to be gone before its row is deleted.
// One miss is never enough: a volume that was briefly unavailable, a network
// share that had not reconnected yet or a drive letter that came up late would
// otherwise cost the whole library. The counter lives in the database, so the
// two scans may well be two separate server starts.
const requiredMisses = 2

// pruneMissing deletes tracks whose file is gone for the second time.
//
// Three guards stand in front of the delete:
//
//  1. The caller skips this pass entirely when the scan found no files at all.
//     A scan that sees nothing must never delete anything.
//  2. A file is only counted as missing when its volume is reachable. If the
//     drive or share is not mounted, the run of misses is left untouched.
//  3. The row is removed only at the second consecutive miss, and a file that
//     reappears resets the counter to zero.
func (s *Scanner) pruneMissing(ctx context.Context, known map[string]int64, found map[string]bool) (int, error) {
	now := time.Now().UnixMilli()
	removed := 0

	for path := range known {
		if found[path] {
			// Present in this scan - clear any earlier miss.
			if err := s.db.ForgetMissing(ctx, path); err != nil {
				return removed, err
			}
			continue
		}

		// The path may sit outside the music directory; older libraries carry
		// absolute paths from a previous location. Check the file itself before
		// deciding it is gone.
		if _, err := os.Stat(path); err == nil {
			if err := s.db.ForgetMissing(ctx, path); err != nil {
				return removed, err
			}
			continue
		}

		if !volumeReachable(path) {
			s.logf("[SCANNER] Volume for %s is not reachable, leaving the entry alone", path)
			continue
		}

		misses, err := s.db.RecordMissing(ctx, path, now)
		if err != nil {
			return removed, err
		}

		if misses < requiredMisses {
			s.logf("[SCANNER] File missing (%d of %d), keeping it for now: %s",
				misses, requiredMisses, path)
			continue
		}

		if _, err := s.db.RemoveTrackByPath(ctx, path); err != nil {
			return removed, err
		}
		if err := s.db.ForgetMissing(ctx, path); err != nil {
			return removed, err
		}

		s.logf("[SCANNER] Removed track, file gone for %d scans: %s", misses, path)
		removed++
	}

	// Paths that are no longer in the library at all - removed by hand or by
	// the watcher - must not keep a counter around.
	entries, err := s.db.ListMissing(ctx)
	if err != nil {
		return removed, err
	}
	for _, entry := range entries {
		if _, stillKnown := known[entry.FilePath]; stillKnown {
			continue
		}
		if err := s.db.ForgetMissing(ctx, entry.FilePath); err != nil {
			return removed, err
		}
	}

	return removed, nil
}

// volumeReachable reports whether the drive or share a path lives on can be
// reached at all. On Windows that is "C:\" or "\\server\share", elsewhere the
// filesystem root.
func volumeReachable(path string) bool {
	root := filepath.VolumeName(path)
	if root == "" {
		root = string(filepath.Separator)
	} else {
		root += string(filepath.Separator)
	}

	info, err := os.Stat(root)
	return err == nil && info.IsDir()
}
