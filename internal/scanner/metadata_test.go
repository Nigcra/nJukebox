// metadata_test.go
// Tag mapping, frame scan and the ID3 offsets, on synthetic MPEG frames
// Version: 2026.08.13

package scanner

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/color"
	"image/jpeg"
	"math"
	"os"
	"path/filepath"
	"testing"
)

// One MPEG 1 Layer 3 frame, 128 kbit/s, 44100 Hz, stereo, no CRC, no padding.
// The header decodes to 417 bytes and 1152 samples.
const (
	testFrameSize    = 417
	testFrameSamples = 1152
	testSampleRate   = 44100
	testBitrate      = 128000
)

var testFrameHeader = []byte{0xFF, 0xFB, 0x90, 0x00}

// frameDuration is the playing time of a single test frame.
var frameDuration = float64(testFrameSamples) / float64(testSampleRate)

// mpegFrames builds count identical frames. The payload stays zero, so it can
// never look like a sync word.
func mpegFrames(count int) []byte {
	var buf bytes.Buffer
	for i := 0; i < count; i++ {
		buf.Write(testFrameHeader)
		buf.Write(make([]byte, testFrameSize-len(testFrameHeader)))
	}
	return buf.Bytes()
}

// xingFrame builds a frame carrying an Info table, the way an encoder writes it
// in front of the audio.
func xingFrame() []byte {
	frame := make([]byte, testFrameSize)
	copy(frame, testFrameHeader)
	copy(frame[4+32:], []byte("Info"))
	return frame
}

// id3v2Frame builds one ID3v2.3 frame with a latin1 text payload.
func id3v2Frame(id, text string) []byte {
	payload := append([]byte{0x00}, []byte(text)...)

	var buf bytes.Buffer
	buf.WriteString(id)
	binary.Write(&buf, binary.BigEndian, uint32(len(payload)))
	buf.Write([]byte{0x00, 0x00})
	buf.Write(payload)
	return buf.Bytes()
}

// id3v2Picture builds an APIC frame with the given JPEG bytes.
func id3v2Picture(image []byte) []byte {
	var payload bytes.Buffer
	payload.WriteByte(0x00) // latin1
	payload.WriteString("image/jpeg")
	payload.WriteByte(0x00)
	payload.WriteByte(0x03) // front cover
	payload.WriteByte(0x00) // empty description
	payload.Write(image)

	var buf bytes.Buffer
	buf.WriteString("APIC")
	binary.Write(&buf, binary.BigEndian, uint32(payload.Len()))
	buf.Write([]byte{0x00, 0x00})
	buf.Write(payload.Bytes())
	return buf.Bytes()
}

// id3v2Tag wraps the frames into a complete ID3v2.3 tag.
func id3v2Tag(frames ...[]byte) []byte {
	var body bytes.Buffer
	for _, frame := range frames {
		body.Write(frame)
	}

	size := syncsafe(body.Len())

	var buf bytes.Buffer
	buf.WriteString("ID3")
	buf.Write([]byte{0x03, 0x00, 0x00})
	buf.Write(size[:])
	buf.Write(body.Bytes())
	return buf.Bytes()
}

// id3v1Tag builds a minimal trailing ID3v1 tag.
func id3v1Tag() []byte {
	tag := make([]byte, 128)
	copy(tag, "TAG")
	copy(tag[3:], "old title")
	return tag
}

// testJPEG encodes a solid colour image.
func testJPEG(t *testing.T, width, height int) []byte {
	t.Helper()

	img := image.NewRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			img.SetRGBA(x, y, color.RGBA{R: uint8(x % 256), G: uint8(y % 256), B: 0x40, A: 0xFF})
		}
	}

	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 90}); err != nil {
		t.Fatalf("encode test jpeg: %v", err)
	}
	return buf.Bytes()
}

// writeMP3 assembles a file out of the given parts.
func writeMP3(t *testing.T, path string, parts ...[]byte) string {
	t.Helper()

	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("create directory: %v", err)
	}

	var buf bytes.Buffer
	for _, part := range parts {
		buf.Write(part)
	}
	if err := os.WriteFile(path, buf.Bytes(), 0o644); err != nil {
		t.Fatalf("write test file: %v", err)
	}
	return path
}

// taggedMP3 is the file the metadata and scanner tests share.
func taggedMP3(t *testing.T, path string, frames int) string {
	t.Helper()

	tag := id3v2Tag(
		id3v2Frame("TIT2", "Test Title"),
		id3v2Frame("TPE1", "Test Artist"),
		id3v2Frame("TALB", "Test Album"),
		id3v2Frame("TPE2", "Test Album Artist"),
		id3v2Frame("TCON", "Alternative Rock/Rock/Cover"),
		id3v2Frame("TYER", "1997"),
		id3v2Frame("TRCK", "3/12"),
		id3v2Frame("TPOS", "2/2"),
		id3v2Picture(testJPEG(t, 600, 400)),
	)
	return writeMP3(t, path, tag, mpegFrames(frames), id3v1Tag())
}

func TestReadMetadataTags(t *testing.T) {
	path := taggedMP3(t, filepath.Join(t.TempDir(), "track.mp3"), 100)

	meta, err := ReadMetadata(path)
	if err != nil {
		t.Fatalf("ReadMetadata: %v", err)
	}

	if meta.Title != "Test Title" {
		t.Errorf("title = %q", meta.Title)
	}
	if meta.Artist != "Test Artist" {
		t.Errorf("artist = %q", meta.Artist)
	}
	if meta.Album != "Test Album" {
		t.Errorf("album = %q", meta.Album)
	}
	if meta.AlbumArtist != "Test Album Artist" {
		t.Errorf("album artist = %q", meta.AlbumArtist)
	}
	if meta.Genre != "Alternative Rock/Rock/Cover" {
		t.Errorf("genre = %q", meta.Genre)
	}
	if meta.Year != 1997 {
		t.Errorf("year = %d", meta.Year)
	}
	if meta.TrackNumber != 3 {
		t.Errorf("track number = %d", meta.TrackNumber)
	}
	if meta.DiscNumber != 2 {
		t.Errorf("disc number = %d", meta.DiscNumber)
	}
	if len(meta.Picture) == 0 {
		t.Error("no embedded picture found")
	}
	if meta.Container != Container {
		t.Errorf("container = %q, want %q", meta.Container, Container)
	}
}

func TestReadMetadataAudio(t *testing.T) {
	const frames = 250
	path := taggedMP3(t, filepath.Join(t.TempDir(), "track.mp3"), frames)

	meta, err := ReadMetadata(path)
	if err != nil {
		t.Fatalf("ReadMetadata: %v", err)
	}

	want := float64(frames) * frameDuration
	if math.Abs(meta.Duration-want) > 1e-9 {
		t.Errorf("duration = %.9f, want %.9f", meta.Duration, want)
	}
	if meta.Bitrate != testBitrate {
		t.Errorf("bitrate = %d, want %d", meta.Bitrate, testBitrate)
	}
}

// TestReadMetadataWithoutTags covers the file the Node scanner fell back on:
// no ID3 tag at all, so only the audio properties are known.
func TestReadMetadataWithoutTags(t *testing.T) {
	path := writeMP3(t, filepath.Join(t.TempDir(), "bare.mp3"), mpegFrames(40))

	meta, err := ReadMetadata(path)
	if err != nil {
		t.Fatalf("ReadMetadata: %v", err)
	}

	if meta.Title != "" || meta.Artist != "" || meta.Album != "" {
		t.Errorf("expected empty tags, got %+v", meta)
	}
	if meta.Container != Container {
		t.Errorf("container = %q, want %q", meta.Container, Container)
	}
	if want := 40 * frameDuration; math.Abs(meta.Duration-want) > 1e-9 {
		t.Errorf("duration = %.9f, want %.9f", meta.Duration, want)
	}
}

// TestReadMetadataSkipsHeaderFrame pins that the Xing/Info frame is not counted
// as audio: encoders do not count it either and music-metadata read its frame
// count out of that table.
func TestReadMetadataSkipsHeaderFrame(t *testing.T) {
	path := writeMP3(t, filepath.Join(t.TempDir(), "vbr.mp3"), xingFrame(), mpegFrames(100))

	meta, err := ReadMetadata(path)
	if err != nil {
		t.Fatalf("ReadMetadata: %v", err)
	}

	if want := 100 * frameDuration; math.Abs(meta.Duration-want) > 1e-9 {
		t.Errorf("duration = %.9f, want %.9f (header frame must not count)", meta.Duration, want)
	}
}

// TestReadMetadataIgnoresFalseSync feeds a byte sequence that looks like a
// Layer 1 frame header into the middle of the stream. Such a frame belongs to
// no real MPEG stream and must not distort duration or bitrate.
func TestReadMetadataIgnoresFalseSync(t *testing.T) {
	// MPEG 1 Layer 1, 448 kbit/s: a shape no Layer 3 stream ever has.
	falseSync := append([]byte{0xFF, 0xFF, 0xE0, 0x00}, make([]byte, 400)...)
	path := writeMP3(t, filepath.Join(t.TempDir(), "noise.mp3"),
		mpegFrames(50), falseSync, mpegFrames(50))

	meta, err := ReadMetadata(path)
	if err != nil {
		t.Fatalf("ReadMetadata: %v", err)
	}

	if meta.Bitrate != testBitrate {
		t.Errorf("bitrate = %d, want %d", meta.Bitrate, testBitrate)
	}
	// The bogus frame swallows part of the stream, so only the frame count is
	// allowed to shrink - never to grow beyond the real frames.
	if want := 100 * frameDuration; meta.Duration > want+1e-9 {
		t.Errorf("duration = %.9f, must not exceed %.9f", meta.Duration, want)
	}
}

func TestAudioOffsets(t *testing.T) {
	dir := t.TempDir()

	t.Run("without id3", func(t *testing.T) {
		path := writeMP3(t, filepath.Join(dir, "plain.mp3"), mpegFrames(3))
		file, err := os.Open(path)
		if err != nil {
			t.Fatal(err)
		}
		defer file.Close()

		offset, err := audioOffset(file)
		if err != nil {
			t.Fatalf("audioOffset: %v", err)
		}
		if offset != 0 {
			t.Errorf("offset = %d, want 0", offset)
		}

		info, _ := file.Stat()
		if end := audioEnd(file, info.Size()); end != info.Size() {
			t.Errorf("end = %d, want %d", end, info.Size())
		}
	})

	t.Run("with id3v2 and id3v1", func(t *testing.T) {
		tag := id3v2Tag(id3v2Frame("TIT2", "x"))
		path := writeMP3(t, filepath.Join(dir, "tagged.mp3"), tag, mpegFrames(3), id3v1Tag())

		file, err := os.Open(path)
		if err != nil {
			t.Fatal(err)
		}
		defer file.Close()

		offset, err := audioOffset(file)
		if err != nil {
			t.Fatalf("audioOffset: %v", err)
		}
		if offset != int64(len(tag)) {
			t.Errorf("offset = %d, want %d", offset, len(tag))
		}

		info, _ := file.Stat()
		want := info.Size() - 128
		if end := audioEnd(file, info.Size()); end != want {
			t.Errorf("end = %d, want %d", end, want)
		}
	})
}

func TestBaseNameWithoutExt(t *testing.T) {
	cases := map[string]string{
		filepath.Join("a", "b", "track.mp3"): "track",
		"track.mp3":                          "track",
		"track":                              "track",
		"track.name.mp3":                     "track.name",
		".hidden":                            ".hidden", // path.extname(".hidden") is empty
	}

	for in, want := range cases {
		if got := baseNameWithoutExt(in); got != want {
			t.Errorf("baseNameWithoutExt(%q) = %q, want %q", in, got, want)
		}
	}
}
