// flac_test.go
// Verifies the STREAMINFO reader, the extension list and the container value
// Version: 2026.08.16

package scanner

import (
	"context"
	"encoding/binary"
	"math"
	"os"
	"path/filepath"
	"testing"

	"github.com/Nigcra/nJukebox/internal/musicdb"
)

// writeFLAC builds the smallest thing that is still a valid FLAC header: the
// stream marker plus a STREAMINFO block marked as the last one. padding is
// appended as fake audio so the file has a size the bitrate can be derived
// from.
func writeFLAC(t *testing.T, path string, sampleRate, channels, bitsPerSample int, totalSamples uint64, padding int) string {
	t.Helper()

	block := make([]byte, 34)
	binary.BigEndian.PutUint16(block[0:2], 4096) // min block size
	binary.BigEndian.PutUint16(block[2:4], 4096) // max block size
	// bytes 4..9 are the min and max frame sizes, left at zero (unknown)

	packed := uint64(sampleRate)<<44 |
		uint64(channels-1)<<41 |
		uint64(bitsPerSample-1)<<36 |
		totalSamples&0xFFFFFFFFF
	binary.BigEndian.PutUint64(block[10:18], packed)
	// bytes 18..33 hold the MD5 of the unencoded audio, irrelevant here

	out := []byte{'f', 'L', 'a', 'C'}
	out = append(out, 0x80, 0x00, 0x00, 0x22) // last block, type 0, length 34
	out = append(out, block...)
	out = append(out, make([]byte, padding)...)

	if err := os.WriteFile(path, out, 0o644); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
	return path
}

// writeTaggedFLAC appends a VORBIS_COMMENT block after STREAMINFO. Comment
// values are length prefixed little endian, unlike everything else in FLAC.
func writeTaggedFLAC(t *testing.T, path string, totalSamples uint64, comments ...string) string {
	t.Helper()

	writeFLAC(t, path, 44100, 2, 16, totalSamples, 0)
	head, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read back: %v", err)
	}
	// Clear the last-block flag on STREAMINFO, the comment block follows.
	head[4] &^= 0x80

	var payload []byte
	vendor := []byte("njukebox test")
	payload = binary.LittleEndian.AppendUint32(payload, uint32(len(vendor)))
	payload = append(payload, vendor...)
	payload = binary.LittleEndian.AppendUint32(payload, uint32(len(comments)))
	for _, c := range comments {
		payload = binary.LittleEndian.AppendUint32(payload, uint32(len(c)))
		payload = append(payload, c...)
	}

	out := append(head, 0x84, byte(len(payload)>>16), byte(len(payload)>>8), byte(len(payload)))
	out = append(out, payload...)
	out = append(out, make([]byte, 2048)...)

	if err := os.WriteFile(path, out, 0o644); err != nil {
		t.Fatalf("write tagged flac: %v", err)
	}
	return path
}

// Tags are the other half of "FLAC is not recognised": without them every file
// would fall back to its name. dhowden/tag reads Vorbis comments, so this needs
// no code of ours - which is exactly why it deserves a test.
func TestFLACTagsAreRead(t *testing.T) {
	path := writeTaggedFLAC(t, filepath.Join(t.TempDir(), "tagged.flac"), 44100*4,
		"TITLE=Lossless Title",
		"ARTIST=The Artist",
		"ALBUM=The Album",
		"ALBUMARTIST=The Album Artist",
		"GENRE=Alternative Rock",
		"DATE=1994",
		"TRACKNUMBER=7",
		"DISCNUMBER=2",
	)

	meta, err := ReadMetadata(path)
	if err != nil {
		t.Fatalf("ReadMetadata: %v", err)
	}

	for name, got := range map[string]string{
		"title":        meta.Title,
		"artist":       meta.Artist,
		"album":        meta.Album,
		"album artist": meta.AlbumArtist,
		"genre":        meta.Genre,
	} {
		if got == "" {
			t.Errorf("%s came back empty", name)
		}
	}
	if meta.Title != "Lossless Title" {
		t.Errorf("title = %q, want %q", meta.Title, "Lossless Title")
	}
	if meta.Artist != "The Artist" {
		t.Errorf("artist = %q, want %q", meta.Artist, "The Artist")
	}
	if meta.Year != 1994 {
		t.Errorf("year = %d, want 1994", meta.Year)
	}
	if meta.TrackNumber != 7 {
		t.Errorf("track number = %d, want 7", meta.TrackNumber)
	}
	if meta.Container != ContainerFLAC {
		t.Errorf("container = %q, want %q", meta.Container, ContainerFLAC)
	}
	if math.Abs(meta.Duration-4) > 0.0005 {
		t.Errorf("duration = %v, want 4", meta.Duration)
	}
}

func TestScanFLACDuration(t *testing.T) {
	dir := t.TempDir()

	for _, c := range []struct {
		name         string
		sampleRate   int
		totalSamples uint64
		want         float64
	}{
		{"three seconds at 44.1 kHz", 44100, 44100 * 3, 3},
		{"half a second at 48 kHz", 48000, 24000, 0.5},
		{"an odd length", 44100, 100000, 100000.0 / 44100.0},
	} {
		t.Run(c.name, func(t *testing.T) {
			path := writeFLAC(t, filepath.Join(dir, c.name+".flac"), c.sampleRate, 2, 16, c.totalSamples, 1024)

			file, err := os.Open(path)
			if err != nil {
				t.Fatalf("open: %v", err)
			}
			defer file.Close()
			info, err := file.Stat()
			if err != nil {
				t.Fatalf("stat: %v", err)
			}

			audio, err := scanFLAC(file, info.Size())
			if err != nil {
				t.Fatalf("scanFLAC: %v", err)
			}
			if math.Abs(audio.duration-c.want) > 0.0005 {
				t.Errorf("duration = %v, want %v", audio.duration, c.want)
			}

			wantBitrate := int(float64(info.Size()) * 8 / c.want)
			if audio.bitrate != wantBitrate {
				t.Errorf("bitrate = %d, want %d", audio.bitrate, wantBitrate)
			}
		})
	}
}

// An encoder that streams to a pipe cannot know the length and writes zero.
// Duration is then genuinely unknown, and the scanner writes null, exactly as
// it does for an MP3 whose frames could not be decoded.
func TestScanFLACWithoutSampleCount(t *testing.T) {
	path := writeFLAC(t, filepath.Join(t.TempDir(), "unknown.flac"), 44100, 2, 16, 0, 512)

	file, err := os.Open(path)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer file.Close()

	audio, err := scanFLAC(file, 1024)
	if err != nil {
		t.Fatalf("scanFLAC: %v", err)
	}
	if audio.duration != 0 || audio.bitrate != 0 {
		t.Errorf("duration = %v, bitrate = %d, want both zero", audio.duration, audio.bitrate)
	}
}

func TestScanFLACRejectsOtherFiles(t *testing.T) {
	path := filepath.Join(t.TempDir(), "not.flac")
	if err := os.WriteFile(path, []byte("ID3\x04\x00\x00 this is not a FLAC stream at all"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}

	file, err := os.Open(path)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer file.Close()

	if _, err := scanFLAC(file, 64); err == nil {
		t.Error("scanFLAC accepted a file that is not FLAC")
	}
}

// ReadMetadata has to route by extension and label the row FLAC, otherwise the
// format column would claim MPEG for every FLAC file.
func TestReadMetadataUsesTheFLACReader(t *testing.T) {
	path := writeFLAC(t, filepath.Join(t.TempDir(), "track.flac"), 44100, 2, 16, 44100*5, 2048)

	meta, err := ReadMetadata(path)
	if err != nil {
		t.Fatalf("ReadMetadata: %v", err)
	}
	if math.Abs(meta.Duration-5) > 0.0005 {
		t.Errorf("duration = %v, want 5", meta.Duration)
	}
	if meta.Container != ContainerFLAC {
		t.Errorf("container = %q, want %q", meta.Container, ContainerFLAC)
	}
	if meta.Bitrate <= 0 {
		t.Errorf("bitrate = %d, want a positive value", meta.Bitrate)
	}
}

// The whole point: a FLAC file in the library has to end up as a row. Queried
// straight off the table so the test does not depend on the read helpers.
func TestScanAllIndexesFLAC(t *testing.T) {
	dir := t.TempDir()
	musicDir := filepath.Join(dir, "music")
	if err := os.MkdirAll(musicDir, 0o755); err != nil {
		t.Fatalf("create music dir: %v", err)
	}

	writeFLAC(t, filepath.Join(musicDir, "lossless.flac"), 44100, 2, 16, 44100*7, 4096)
	taggedMP3(t, filepath.Join(musicDir, "lossy.mp3"), 40)

	db, err := musicdb.Open(filepath.Join(dir, "music.db"))
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	t.Cleanup(func() { db.Close() })

	result, err := New(dir, musicDir, db).ScanAll(context.Background())
	if err != nil {
		t.Fatalf("ScanAll: %v", err)
	}
	if result.Files != 2 {
		t.Errorf("found %d files, want 2 - the FLAC file has to pass the extension filter", result.Files)
	}
	if result.Updated != 2 {
		t.Errorf("wrote %d rows, want 2", result.Updated)
	}

	var format string
	var duration float64
	err = db.Handle().QueryRow(
		`SELECT format, duration FROM tracks WHERE file_path LIKE '%lossless.flac'`,
	).Scan(&format, &duration)
	if err != nil {
		t.Fatalf("read the FLAC row: %v", err)
	}
	if format != ContainerFLAC {
		t.Errorf("format = %q, want %q", format, ContainerFLAC)
	}
	if math.Abs(duration-7) > 0.0005 {
		t.Errorf("duration = %v, want 7", duration)
	}
}

func TestIsSupportedFormat(t *testing.T) {
	for path, want := range map[string]bool{
		"song.mp3":        true,
		"song.MP3":        true,
		"song.flac":       true,
		"song.FLAC":       true,
		"song.Flac":       true,
		"a/b/c/song.flac": true,
		"song.wav":        false,
		"song.m4a":        false,
		"song.ogg":        false,
		"song.flac.txt":   false,
		"flac":            false,
		"cover.jpg":       false,
		"song.mp3.bak":    false,
	} {
		if got := IsSupportedFormat(path); got != want {
			t.Errorf("IsSupportedFormat(%q) = %v, want %v", path, got, want)
		}
	}
}
