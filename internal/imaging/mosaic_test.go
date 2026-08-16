// mosaic_test.go
// Geometry tests for the artist mosaic
// Version: 2026.08.13

package imaging

import (
	"bytes"
	"errors"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"os"
	"path/filepath"
	"testing"
)

func TestGrid(t *testing.T) {
	cases := []struct {
		count      int
		cols, rows int
	}{
		{0, 2, 2}, // never reached by the handler, but this is what the chain did
		{1, 1, 1},
		{2, 2, 2},
		{4, 2, 2},
		{5, 3, 3},
		{9, 3, 3},
		{10, 4, 4},
		{16, 4, 4},
		{17, 5, 5},
		{25, 5, 5},
		{99, 5, 5},
	}

	for _, c := range cases {
		cols, rows := Grid(c.count)
		if cols != c.cols || rows != c.rows {
			t.Errorf("Grid(%d) = %dx%d, want %dx%d", c.count, cols, rows, c.cols, c.rows)
		}
	}
}

func TestMosaicDimensions(t *testing.T) {
	cases := []struct {
		covers int
		size   int
	}{
		{1, 1 * CellSize},
		{3, 2 * CellSize},
		{5, 3 * CellSize},
		{16, 4 * CellSize},
		{30, 5 * CellSize},
	}

	for _, c := range cases {
		paths := writeCovers(t, c.covers, 200, 200, color.RGBA{R: 200, G: 30, B: 30, A: 255})

		data, err := Mosaic(paths)
		if err != nil {
			t.Fatalf("Mosaic(%d covers): %v", c.covers, err)
		}

		img, err := jpeg.Decode(bytes.NewReader(data))
		if err != nil {
			t.Fatalf("decode mosaic: %v", err)
		}

		bounds := img.Bounds()
		if bounds.Dx() != c.size || bounds.Dy() != c.size {
			t.Errorf("%d covers: mosaic is %dx%d, want %dx%d",
				c.covers, bounds.Dx(), bounds.Dy(), c.size, c.size)
		}
	}
}

// TestMosaicBackground checks that an unused cell keeps RGB(40, 40, 40).
func TestMosaicBackground(t *testing.T) {
	// Two covers in a 2x2 grid leave the whole second row empty.
	paths := writeCovers(t, 2, 200, 200, color.RGBA{R: 10, G: 200, B: 10, A: 255})

	data, err := Mosaic(paths)
	if err != nil {
		t.Fatalf("Mosaic: %v", err)
	}

	img, err := jpeg.Decode(bytes.NewReader(data))
	if err != nil {
		t.Fatalf("decode mosaic: %v", err)
	}

	assertColor(t, img, CellSize/2, CellSize+CellSize/2, Background, "empty cell")
	assertColor(t, img, CellSize/2, CellSize/2, color.RGBA{R: 10, G: 200, B: 10, A: 255}, "first cover")
}

// TestMosaicCropsToSquare checks the fit:cover behaviour: a wide cover is cropped
// in the centre, so the stripes at its left and right edge must not show up.
func TestMosaicCropsToSquare(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "wide.png")

	img := image.NewRGBA(image.Rect(0, 0, 600, 200))
	for y := 0; y < 200; y++ {
		for x := 0; x < 600; x++ {
			// Only the centre square is blue, the rest is red.
			c := color.RGBA{R: 220, A: 255}
			if x >= 200 && x < 400 {
				c = color.RGBA{B: 220, A: 255}
			}
			img.SetRGBA(x, y, c)
		}
	}
	writePNG(t, path, img)

	data, err := Mosaic([]string{path})
	if err != nil {
		t.Fatalf("Mosaic: %v", err)
	}

	mosaic, err := jpeg.Decode(bytes.NewReader(data))
	if err != nil {
		t.Fatalf("decode mosaic: %v", err)
	}

	if bounds := mosaic.Bounds(); bounds.Dx() != CellSize || bounds.Dy() != CellSize {
		t.Fatalf("mosaic is %dx%d, want %dx%d", bounds.Dx(), bounds.Dy(), CellSize, CellSize)
	}

	assertColor(t, mosaic, 5, CellSize/2, color.RGBA{B: 220, A: 255}, "left edge after crop")
	assertColor(t, mosaic, CellSize-6, CellSize/2, color.RGBA{B: 220, A: 255}, "right edge after crop")
}

// TestMosaicSkipsUnreadable checks that a broken cover only empties its own cell
// and does not shift the remaining covers.
func TestMosaicSkipsUnreadable(t *testing.T) {
	paths := writeCovers(t, 2, 200, 200, color.RGBA{R: 10, G: 10, B: 220, A: 255})
	paths[0] = filepath.Join(t.TempDir(), "missing.jpg")

	data, err := Mosaic(paths)
	if err != nil {
		t.Fatalf("Mosaic: %v", err)
	}

	img, err := jpeg.Decode(bytes.NewReader(data))
	if err != nil {
		t.Fatalf("decode mosaic: %v", err)
	}

	assertColor(t, img, CellSize/2, CellSize/2, Background, "cell of the missing cover")
	assertColor(t, img, CellSize+CellSize/2, CellSize/2, color.RGBA{R: 10, G: 10, B: 220, A: 255}, "second cover")
}

func TestMosaicWithoutUsableCovers(t *testing.T) {
	dir := t.TempDir()
	paths := []string{filepath.Join(dir, "a.jpg"), filepath.Join(dir, "b.jpg")}

	if _, err := Mosaic(paths); !errors.Is(err, ErrNoCovers) {
		t.Fatalf("Mosaic() error = %v, want ErrNoCovers", err)
	}
}

// writeCovers creates count single coloured PNG covers in a temporary directory.
func writeCovers(t *testing.T, count, width, height int, c color.RGBA) []string {
	t.Helper()

	dir := t.TempDir()
	paths := make([]string, 0, count)

	for i := 0; i < count; i++ {
		img := image.NewRGBA(image.Rect(0, 0, width, height))
		for y := 0; y < height; y++ {
			for x := 0; x < width; x++ {
				img.SetRGBA(x, y, c)
			}
		}

		path := filepath.Join(dir, "cover"+string(rune('a'+i%26))+string(rune('a'+i/26))+".png")
		writePNG(t, path, img)
		paths = append(paths, path)
	}
	return paths
}

func writePNG(t *testing.T, path string, img image.Image) {
	t.Helper()

	file, err := os.Create(path)
	if err != nil {
		t.Fatalf("create %s: %v", path, err)
	}
	defer file.Close()

	if err := png.Encode(file, img); err != nil {
		t.Fatalf("encode %s: %v", path, err)
	}
}

// assertColor compares one pixel with a tolerance, because the mosaic is JPEG
// encoded and single colours shift by a few units.
func assertColor(t *testing.T, img image.Image, x, y int, want color.RGBA, what string) {
	t.Helper()

	const tolerance = 8

	r, g, b, _ := img.At(x, y).RGBA()
	got := color.RGBA{R: uint8(r >> 8), G: uint8(g >> 8), B: uint8(b >> 8), A: 255}

	if diff(got.R, want.R) > tolerance || diff(got.G, want.G) > tolerance || diff(got.B, want.B) > tolerance {
		t.Errorf("%s at (%d,%d) = %v, want %v", what, x, y, got, want)
	}
}

func diff(a, b uint8) int {
	if a > b {
		return int(a - b)
	}
	return int(b - a)
}
