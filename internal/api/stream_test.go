// stream_test.go
// Verifies the media type the stream endpoint announces per file
// Version: 2026.08.16

package api

import "testing"

// Chrome refuses to decode a FLAC stream announced as audio/mpeg, so this is
// not cosmetic. Node sent audio/mpeg unconditionally because the scanner only
// ever indexed MP3.
func TestAudioContentType(t *testing.T) {
	for path, want := range map[string]string{
		`C:\music\song.mp3`:   "audio/mpeg",
		`C:\music\song.MP3`:   "audio/mpeg",
		`/music/song.flac`:    "audio/flac",
		`/music/song.FLAC`:    "audio/flac",
		`/music/song.Flac`:    "audio/flac",
		`/music/no-extension`: "audio/mpeg",
	} {
		if got := audioContentType(path); got != want {
			t.Errorf("audioContentType(%q) = %q, want %q", path, got, want)
		}
	}
}
