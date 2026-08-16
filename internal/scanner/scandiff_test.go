// scandiff_test.go
// Full scan comparison against a Node generated music.db
// Version: 2026.08.13

package scanner

import (
	"context"
	"database/sql"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	_ "modernc.org/sqlite"

	"github.com/Nigcra/nJukebox/internal/musicdb"
)

// durationTolerance is the accepted difference in seconds. music-metadata
// estimated the duration of a CBR stream from the file size, the Go port counts
// the frames, so the values differ slightly (R9).
const durationTolerance = 0.5

// row is the subset of the tracks table the comparison looks at.
type row struct {
	title       string
	artist      string
	album       string
	albumArtist string
	genre       string
	year        string
	trackNumber string
	discNumber  string
	duration    sql.NullFloat64
	bitrate     string
	format      string
	coverPath   string
	hasCover    string
}

// TestScanDiff scans a copy of a music library from scratch and compares the
// result against a reference database that the Node scanner produced. Both
// paths come from the environment, so the test is a no-op in a normal run:
//
//	NJUKEBOX_SCAN_SRC  music directory to scan - a copy, never the original
//	NJUKEBOX_REF_DB    music.db the Node scanner wrote
//	NJUKEBOX_SCAN_OUT  optional output root, keeps database and covers
//
// Rows are matched on the file name, because the copy lives somewhere else and
// file_path holds an absolute path.
func TestScanDiff(t *testing.T) {
	source := os.Getenv("NJUKEBOX_SCAN_SRC")
	reference := os.Getenv("NJUKEBOX_REF_DB")
	if source == "" || reference == "" {
		t.Skip("NJUKEBOX_SCAN_SRC and NJUKEBOX_REF_DB are not set")
	}

	// NJUKEBOX_SCAN_OUT keeps the scanned database and the written covers
	// around for inspection. Without it everything lands in a temp directory.
	root := os.Getenv("NJUKEBOX_SCAN_OUT")
	if root == "" {
		root = t.TempDir()
	}

	db, err := musicdb.Open(filepath.Join(root, "data", "music.db"))
	if err != nil {
		t.Fatalf("open scan database: %v", err)
	}
	defer db.Close()

	sc := New(root, source, db)
	result, err := sc.ScanAll(context.Background())
	if err != nil {
		t.Fatalf("scan failed: %v", err)
	}
	t.Logf("scanned %d files, %d written, %d errors, %s",
		result.Files, result.Updated, result.Errors, result.Elapsed)

	scanned, err := readRows(filepath.Join(root, "data", "music.db"))
	if err != nil {
		t.Fatalf("read scanned rows: %v", err)
	}
	expected, err := readRows(reference)
	if err != nil {
		t.Fatalf("read reference rows: %v", err)
	}

	names := make([]string, 0, len(expected))
	for name := range expected {
		names = append(names, name)
	}
	sort.Strings(names)

	missing := 0
	for _, name := range names {
		want := expected[name]
		got, ok := scanned[name]
		if !ok {
			missing++
			t.Errorf("%s: not indexed by the Go scanner", name)
			continue
		}

		compare(t, name, "title", want.title, got.title)
		compare(t, name, "artist", want.artist, got.artist)
		compare(t, name, "album", want.album, got.album)
		compare(t, name, "album_artist", want.albumArtist, got.albumArtist)
		compare(t, name, "genre", want.genre, got.genre)
		compare(t, name, "year", want.year, got.year)
		compare(t, name, "track_number", want.trackNumber, got.trackNumber)
		compare(t, name, "disc_number", want.discNumber, got.discNumber)
		// cover_path is relative to the project root and mirrors the layout
		// below the music directory, so a copy has to produce the same string.
		compare(t, name, "cover_path", want.coverPath, got.coverPath)
		compare(t, name, "has_cover", want.hasCover, got.hasCover)
		compare(t, name, "format", want.format, got.format)

		switch {
		case want.duration.Valid != got.duration.Valid:
			t.Errorf("%s: duration presence differs, reference valid=%v scan valid=%v",
				name, want.duration.Valid, got.duration.Valid)
		case want.duration.Valid:
			delta := math.Abs(want.duration.Float64 - got.duration.Float64)
			if delta > durationTolerance {
				t.Errorf("%s: duration %.4f vs %.4f, delta %.4f s exceeds %.1f s",
					name, want.duration.Float64, got.duration.Float64, delta, durationTolerance)
			} else if delta > 0 {
				t.Logf("%s: duration delta %.4f s (within tolerance)", name, delta)
			}
		}

		if want.bitrate != got.bitrate {
			t.Logf("%s: bitrate %s vs %s", name, want.bitrate, got.bitrate)
		}
	}

	t.Logf("compared %d reference rows against %d scanned rows, %d missing",
		len(expected), len(scanned), missing)
}

func compare(t *testing.T, name, column, want, got string) {
	t.Helper()
	if want != got {
		t.Errorf("%s: %s is %q, expected %q", name, column, got, want)
	}
}

// readRows loads the tracks table keyed by file name. Duplicate file names -
// the same track below different roots - have to be identical, otherwise the
// comparison cannot decide which row to use.
func readRows(path string) (map[string]row, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	defer db.Close()

	rows, err := db.Query(`SELECT file_path, title, artist, album, album_artist, genre,
		year, track_number, disc_number, duration, bitrate, format, cover_path, has_cover
		FROM tracks ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make(map[string]row)
	for rows.Next() {
		var (
			filePath string
			r        row
			title    sql.NullString
			artist   sql.NullString
			album    sql.NullString
			aArtist  sql.NullString
			genre    sql.NullString
			year     sql.NullInt64
			track    sql.NullInt64
			disc     sql.NullInt64
			bitrate  sql.NullInt64
			format   sql.NullString
			cover    sql.NullString
			hasCover sql.NullInt64
		)
		if err := rows.Scan(&filePath, &title, &artist, &album, &aArtist, &genre,
			&year, &track, &disc, &r.duration, &bitrate, &format, &cover, &hasCover); err != nil {
			return nil, err
		}

		r.title = nullString(title)
		r.artist = nullString(artist)
		r.album = nullString(album)
		r.albumArtist = nullString(aArtist)
		r.genre = nullString(genre)
		r.year = nullInt(year)
		r.trackNumber = nullInt(track)
		r.discNumber = nullInt(disc)
		r.bitrate = nullInt(bitrate)
		r.format = nullString(format)
		r.coverPath = nullString(cover)
		r.hasCover = nullInt(hasCover)

		name := filePath
		if index := strings.LastIndexAny(name, `/\`); index >= 0 {
			name = name[index+1:]
		}
		out[name] = r
	}
	return out, rows.Err()
}

func nullString(value sql.NullString) string {
	if !value.Valid {
		return "<null>"
	}
	return value.String
}

func nullInt(value sql.NullInt64) string {
	if !value.Valid {
		return "<null>"
	}
	return fmt.Sprint(value.Int64)
}
