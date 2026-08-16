// mosaic.go
// Artist cover mosaic: grid selection, centred crop and JPEG encoding
// Version: 2026.08.13

package imaging

import (
	"bytes"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	_ "image/gif" // decoder registration, sharp accepted these too
	"image/jpeg"  // encoder for the finished mosaic
	_ "image/png" // decoder registration
	"os"
)

const (
	// CellSize is the edge length of one grid cell in pixels.
	CellSize = 150

	// Quality is the JPEG quality of the finished mosaic.
	Quality = 85
)

// Background is the fill colour behind the covers, RGB(40, 40, 40).
var Background = color.RGBA{R: 40, G: 40, B: 40, A: 255}

// ErrNoCovers reports that not a single cover file could be read. The Node
// implementation sent the default cover in that case instead of an empty grid.
var ErrNoCovers = errors.New("imaging: no usable cover images")

// Grid returns the number of columns and rows for a given cover count. The
// thresholds are the ones data_server.js used; a count of zero lands in the
// 2x2 branch there as well, because only a count of exactly one is special.
func Grid(count int) (cols, rows int) {
	switch {
	case count == 1:
		return 1, 1
	case count <= 4:
		return 2, 2
	case count <= 9:
		return 3, 3
	case count <= 16:
		return 4, 4
	default:
		return 5, 5
	}
}

// Mosaic composes the cover files into a single JPEG. Covers beyond the grid
// capacity are dropped, covers that cannot be read leave their cell empty - both
// exactly as the Node version behaved. When no cover at all could be read,
// ErrNoCovers is returned and the caller falls back to the default cover.
func Mosaic(coverPaths []string) ([]byte, error) {
	cols, rows := Grid(len(coverPaths))

	// The grid is chosen from the full list, the list is truncated afterwards.
	if capacity := cols * rows; len(coverPaths) > capacity {
		coverPaths = coverPaths[:capacity]
	}

	canvas := image.NewRGBA(image.Rect(0, 0, cols*CellSize, rows*CellSize))
	draw.Draw(canvas, canvas.Bounds(), &image.Uniform{C: Background}, image.Point{}, draw.Src)

	placed := 0
	for i, path := range coverPaths {
		cover, err := loadCover(path)
		if err != nil {
			// A broken cover was logged and skipped, the cell stays background.
			continue
		}

		tile := scaleCover(cover, CellSize)
		if tile == nil {
			continue
		}

		left := (i % cols) * CellSize
		top := (i / cols) * CellSize
		target := image.Rect(left, top, left+CellSize, top+CellSize)
		draw.Draw(canvas, target, tile, image.Point{}, draw.Over)
		placed++
	}

	if placed == 0 {
		return nil, ErrNoCovers
	}

	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, canvas, &jpeg.Options{Quality: Quality}); err != nil {
		return nil, fmt.Errorf("encode mosaic: %w", err)
	}
	return buf.Bytes(), nil
}

// loadCover decodes one cover file.
func loadCover(path string) (image.Image, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	img, _, err := image.Decode(file)
	if err != nil {
		return nil, fmt.Errorf("decode cover %s: %w", path, err)
	}
	return img, nil
}

// scaleCover reproduces sharp's fit:cover for a square target: the source is
// cropped to a centred square and then scaled to size x size.
//
// Downscaling averages the source area behind every target pixel, which is a box
// filter; upscaling degrades to nearest neighbour. sharp used lanczos3, so the
// pixels differ. Byte identity with libvips is unreachable by design - the
// golden baseline pins the cached file, not the encoder output.
func scaleCover(src image.Image, size int) *image.RGBA {
	bounds := src.Bounds()

	side := bounds.Dx()
	if bounds.Dy() < side {
		side = bounds.Dy()
	}
	if side <= 0 || size <= 0 {
		return nil
	}

	offsetX := bounds.Min.X + (bounds.Dx()-side)/2
	offsetY := bounds.Min.Y + (bounds.Dy()-side)/2

	dst := image.NewRGBA(image.Rect(0, 0, size, size))
	for y := 0; y < size; y++ {
		y0 := offsetY + y*side/size
		y1 := offsetY + (y+1)*side/size
		if y1 <= y0 {
			y1 = y0 + 1
		}

		for x := 0; x < size; x++ {
			x0 := offsetX + x*side/size
			x1 := offsetX + (x+1)*side/size
			if x1 <= x0 {
				x1 = x0 + 1
			}
			dst.SetRGBA(x, y, averageArea(src, x0, y0, x1, y1))
		}
	}
	return dst
}

// averageArea averages one source rectangle. The values come back
// alpha-premultiplied, which is what image.RGBA stores, so no conversion is
// needed and covers with transparency blend onto the background.
func averageArea(src image.Image, x0, y0, x1, y1 int) color.RGBA {
	var sumR, sumG, sumB, sumA uint64

	for y := y0; y < y1; y++ {
		for x := x0; x < x1; x++ {
			r, g, b, a := src.At(x, y).RGBA()
			sumR += uint64(r)
			sumG += uint64(g)
			sumB += uint64(b)
			sumA += uint64(a)
		}
	}

	count := uint64((x1 - x0) * (y1 - y0))
	if count == 0 {
		return Background
	}

	return color.RGBA{
		R: uint8((sumR / count) >> 8),
		G: uint8((sumG / count) >> 8),
		B: uint8((sumB / count) >> 8),
		A: uint8((sumA / count) >> 8),
	}
}
