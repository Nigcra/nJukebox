// flac.go
// Duration and bitrate from the FLAC STREAMINFO block, without a decoder
// Version: 2026.08.16

package scanner

import (
	"encoding/binary"
	"errors"
	"fmt"
	"io"
)

// ContainerFLAC is the format string music-metadata reported for FLAC and the
// value that goes into the format column, next to "MPEG" for MPEG audio.
const ContainerFLAC = "FLAC"

// flacMagic opens every FLAC stream.
var flacMagic = []byte{'f', 'L', 'a', 'C'}

// errNotFLAC means the file does not start with the stream marker. The caller
// treats that like an MP3 without decodable frames: no duration, no bitrate.
var errNotFLAC = errors.New("not a FLAC stream")

// scanFLAC reads STREAMINFO, which FLAC requires to be the first metadata block
// right behind the marker. Everything needed is in there, so unlike MPEG audio
// there is nothing to decode and no frame walk - sample count and sample rate
// give an exact duration even for a stream with a variable block size.
//
// STREAMINFO is 34 bytes. The two fields of interest sit in the eight bytes
// after the block sizes and frame sizes, bit packed:
//
//	20 bits sample rate | 3 bits channels-1 | 5 bits bits per sample-1 | 36 bits total samples
func scanFLAC(r io.ReadSeeker, fileSize int64) (audioInfo, error) {
	if _, err := r.Seek(0, io.SeekStart); err != nil {
		return audioInfo{}, fmt.Errorf("seek to start: %w", err)
	}

	var header [8]byte
	if _, err := io.ReadFull(r, header[:]); err != nil {
		return audioInfo{}, errNotFLAC
	}
	if string(header[:4]) != string(flacMagic) {
		return audioInfo{}, errNotFLAC
	}

	// header[4] is the block header: high bit marks the last block, the low
	// seven bits are the type. STREAMINFO is type 0 and mandatory here.
	if header[4]&0x7F != 0 {
		return audioInfo{}, errNotFLAC
	}
	blockLength := int(header[5])<<16 | int(header[6])<<8 | int(header[7])
	if blockLength < 34 {
		return audioInfo{}, errNotFLAC
	}

	var info [34]byte
	if _, err := io.ReadFull(r, info[:]); err != nil {
		return audioInfo{}, errNotFLAC
	}

	// Bytes 10 to 17 carry the packed sample rate and sample count.
	packed := binary.BigEndian.Uint64(info[10:18])
	sampleRate := packed >> 44           // top 20 bits
	totalSamples := packed & 0xFFFFFFFFF // low 36 bits

	if sampleRate == 0 {
		return audioInfo{}, errNotFLAC
	}

	// frames stays at zero: it counts decoded MPEG frames and has no meaning
	// here. The caller sets the container for FLAC without consulting it.
	//
	// A stream may declare zero total samples when the encoder did not know the
	// length up front. Duration is then unknown, and so is the bitrate - the
	// same "missing" the Node code produced for an MP3 it could not decode.
	if totalSamples == 0 {
		return audioInfo{}, nil
	}

	duration := float64(totalSamples) / float64(sampleRate)
	// FLAC carries no nominal bitrate, so this is the average over the file.
	return audioInfo{
		duration: duration,
		bitrate:  int(float64(fileSize) * 8 / duration),
	}, nil
}
