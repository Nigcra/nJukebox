// metadata.go
// ID3 tags, duration and bitrate without ffprobe
// Version: 2026.08.13

package scanner

import (
	"bufio"
	"bytes"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"strings"

	"github.com/dhowden/tag"
	"github.com/tcolgate/mp3"
)

// Container is the format string music-metadata reported for MPEG audio and
// the value that ended up in the format column of every existing row.
const Container = "MPEG"

// Metadata is the subset of music-metadata's common and format objects the
// scanner actually used.
type Metadata struct {
	Title       string
	Artist      string
	Album       string
	AlbumArtist string
	Genre       string
	Year        int
	TrackNumber int
	DiscNumber  int

	// Duration in seconds and Bitrate in bits per second, zero when unknown.
	// Zero is what the Node code treated as missing as well, because it wrote
	// `metadata.format?.duration || null`.
	Duration float64
	Bitrate  int

	// Container is "MPEG" as soon as one audio frame could be decoded and stays
	// empty otherwise, so the caller can fall back to the file extension.
	Container string

	// Picture is the first embedded cover, nil when the file carries none.
	Picture []byte
}

// ReadMetadata reads the tags and scans the audio frames of one file. Tag
// errors are not fatal: a file without any tag still yields duration and
// bitrate, exactly like music-metadata returned an empty common object.
func ReadMetadata(path string) (Metadata, error) {
	file, err := os.Open(path)
	if err != nil {
		return Metadata{}, fmt.Errorf("open %s: %w", path, err)
	}
	defer file.Close()

	info, err := file.Stat()
	if err != nil {
		return Metadata{}, fmt.Errorf("stat %s: %w", path, err)
	}

	// The tags come from dhowden/tag either way: it recognises FLAC by its
	// stream marker and reads Vorbis comments and the picture block, so only
	// duration and bitrate need a format of their own.
	meta := readTags(file)

	if strings.EqualFold(filepath.Ext(path), ".flac") {
		audio, err := scanFLAC(file, info.Size())
		if err != nil {
			return meta, fmt.Errorf("read %s: %w", path, err)
		}
		meta.Duration = audio.duration
		meta.Bitrate = audio.bitrate
		meta.Container = ContainerFLAC
		return meta, nil
	}

	audio, err := scanAudio(file, info.Size())
	if err != nil {
		return meta, err
	}

	meta.Duration = audio.duration
	meta.Bitrate = audio.bitrate
	if audio.frames > 0 {
		meta.Container = Container
	}
	return meta, nil
}

// readTags maps the dhowden/tag metadata onto the music-metadata common fields.
// A file without tags simply produces empty values.
func readTags(file io.ReadSeeker) Metadata {
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return Metadata{}
	}

	tags, err := tag.ReadFrom(file)
	if err != nil || tags == nil {
		// ErrNoTagsFound and a damaged tag both end up here. music-metadata
		// returned an empty common object in that case, the scanner then fell
		// back to the file name.
		return Metadata{}
	}

	track, _ := tags.Track()
	disc, _ := tags.Disc()

	meta := Metadata{
		Title:       tags.Title(),
		Artist:      tags.Artist(),
		Album:       tags.Album(),
		AlbumArtist: tags.AlbumArtist(),
		Genre:       tags.Genre(),
		Year:        tags.Year(),
		TrackNumber: track,
		DiscNumber:  disc,
	}

	if picture := tags.Picture(); picture != nil && len(picture.Data) > 0 {
		meta.Picture = picture.Data
	}
	return meta
}

// audioInfo is the result of the frame scan.
type audioInfo struct {
	duration float64
	bitrate  int
	frames   int
}

// scanAudio walks every MPEG frame of the file and derives duration and
// bitrate from it. The ID3v2 tag at the front and an ID3v1 tag at the end are
// skipped first, otherwise the sync search would hit false frame headers inside
// an embedded cover image.
//
// This is the one place where the Go port is deliberately more precise than the
// Node original: music-metadata stopped after three frames on a CBR stream and
// estimated the duration as round(audioBytes / frameSize) * samplesPerFrame /
// sampleRate. The frame scan counts what is really there (R9).
func scanAudio(file *os.File, size int64) (audioInfo, error) {
	start, err := audioOffset(file)
	if err != nil {
		return audioInfo{}, err
	}

	end := audioEnd(file, size)
	if end <= start {
		return audioInfo{}, nil
	}

	section := io.NewSectionReader(file, start, end-start)
	decoder := mp3.NewDecoder(bufio.NewReaderSize(section, 64*1024))

	var (
		frame   mp3.Frame
		skipped int
		info    audioInfo
		first   = true

		// Frames are counted per stream shape. A sync word inside the audio
		// data decodes into a frame of some other shape, and only the shape
		// with the most frames is the real stream - counting everything would
		// inflate duration and bitrate.
		stats = map[streamShape]*shapeStats{}
	)

	for {
		if err := decoder.Decode(&frame, &skipped); err != nil {
			if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) ||
				errors.Is(err, mp3.ErrNoSyncBits) || errors.Is(err, mp3.ErrPrematureEOF) {
				break
			}
			return info, fmt.Errorf("scan mpeg frames: %w", err)
		}

		rate := int(frame.Header().SampleRate())
		bitrate := int(frame.Header().BitRate())
		if rate <= 0 || bitrate <= 0 {
			continue
		}

		if first {
			first = false

			// The first frame of a VBR file is usually a silent header frame
			// carrying the Xing, Info or VBRI table. It is not audio, encoders
			// do not count it and music-metadata read the frame count out of
			// that very table, so it stays out of the statistics here as well.
			if isHeaderFrame(&frame) {
				continue
			}
		}

		shape := streamShape{
			version: frame.Header().Version(),
			layer:   frame.Header().Layer(),
			rate:    rate,
		}

		entry, ok := stats[shape]
		if !ok {
			entry = &shapeStats{order: len(stats)}
			stats[shape] = entry
		}
		entry.frames++
		entry.samples += int64(frame.Samples())
		entry.bitrateTotal += int64(bitrate)
	}

	var (
		best     *shapeStats
		bestRate int
	)
	for shape, entry := range stats {
		if best == nil || entry.frames > best.frames ||
			(entry.frames == best.frames && entry.order < best.order) {
			best, bestRate = entry, shape.rate
		}
	}
	if best == nil {
		return info, nil
	}

	info.frames = best.frames
	// One division for the whole stream reproduces numberOfSamples / sampleRate
	// exactly instead of accumulating rounding errors over ten thousand frames.
	info.duration = float64(best.samples) / float64(bestRate)

	// Averaged over all frames, which equals the frame header value for a CBR
	// stream and mirrors music-metadata's VBR average.
	info.bitrate = int(math.Round(float64(best.bitrateTotal) / float64(best.frames)))
	return info, nil
}

// streamShape is the part of a frame header that stays constant across a
// stream. Bitrate is not part of it, that is what VBR varies.
type streamShape struct {
	version mp3.FrameVersion
	layer   mp3.FrameLayer
	rate    int
}

// shapeStats accumulates the frames of one stream shape. order records when the
// shape first appeared, so an exact tie is broken by the earlier one.
type shapeStats struct {
	order        int
	frames       int
	samples      int64
	bitrateTotal int64
}

// headerFrameMarkers are the tables a VBR header frame carries.
var headerFrameMarkers = [][]byte{[]byte("Xing"), []byte("Info"), []byte("VBRI")}

// isHeaderFrame reports whether the frame carries a Xing, Info or VBRI table
// instead of audio.
func isHeaderFrame(frame *mp3.Frame) bool {
	buf, err := io.ReadAll(frame.Reader())
	if err != nil {
		return false
	}
	for _, marker := range headerFrameMarkers {
		if bytes.Contains(buf, marker) {
			return true
		}
	}
	return false
}

// audioOffset returns the first byte behind the ID3v2 tag, the same value
// music-metadata tracked as mpegOffset.
func audioOffset(file *os.File) (int64, error) {
	header := make([]byte, 10)
	if _, err := file.ReadAt(header, 0); err != nil {
		if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
			return 0, nil
		}
		return 0, fmt.Errorf("read id3v2 header: %w", err)
	}

	if string(header[0:3]) != "ID3" {
		return 0, nil
	}

	// Bytes 6 to 9 hold the tag size as a syncsafe integer, seven bits each.
	size := int64(header[6]&0x7f)<<21 | int64(header[7]&0x7f)<<14 |
		int64(header[8]&0x7f)<<7 | int64(header[9]&0x7f)

	offset := 10 + size
	if header[5]&0x10 != 0 {
		offset += 10 // footer present
	}
	return offset, nil
}

// audioEnd returns the first byte of a trailing ID3v1 tag, or the file size.
func audioEnd(file *os.File, size int64) int64 {
	if size < 128 {
		return size
	}

	marker := make([]byte, 3)
	if _, err := file.ReadAt(marker, size-128); err != nil {
		return size
	}
	if string(marker) == "TAG" {
		return size - 128
	}
	return size
}

// syncsafe encodes a tag size the way ID3v2 stores it, seven bits per byte.
// Only the tests need it, to build ID3v2 headers.
func syncsafe(size int) [4]byte {
	return [4]byte{
		byte(size >> 21 & 0x7f),
		byte(size >> 14 & 0x7f),
		byte(size >> 7 & 0x7f),
		byte(size & 0x7f),
	}
}

// firstNonEmpty returns the first value that JavaScript would not have treated
// as falsy. Used for the `common.x || fallback` chains of the Node scanner.
func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

// baseNameWithoutExt is path.basename(filePath, path.extname(filePath)).
func baseNameWithoutExt(name string) string {
	base := name
	if index := strings.LastIndexAny(base, `/\`); index >= 0 {
		base = base[index+1:]
	}
	if dot := strings.LastIndex(base, "."); dot > 0 {
		base = base[:dot]
	}
	return base
}
