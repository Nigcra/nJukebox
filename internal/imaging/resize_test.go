// resize_test.go
// Geometry of fit:inside with withoutEnlargement
// Version: 2026.08.13

package imaging

import (
	"bytes"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"testing"
)

func solid(width, height int, fill color.RGBA) *image.RGBA {
	img := image.NewRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			img.SetRGBA(x, y, fill)
		}
	}
	return img
}

func TestFitInside(t *testing.T) {
	cases := []struct {
		name                  string
		width, height         int
		wantWidth, wantHeight int
		maxWidth, maxHeight   int
		mustBeTheSameImageRef bool
	}{
		{name: "landscape", width: 600, height: 400, maxWidth: 500, maxHeight: 500, wantWidth: 500, wantHeight: 333},
		{name: "portrait", width: 400, height: 600, maxWidth: 500, maxHeight: 500, wantWidth: 333, wantHeight: 500},
		{name: "square", width: 1000, height: 1000, maxWidth: 500, maxHeight: 500, wantWidth: 500, wantHeight: 500},
		{name: "exact size", width: 500, height: 500, maxWidth: 500, maxHeight: 500, wantWidth: 500, wantHeight: 500, mustBeTheSameImageRef: true},
		{name: "smaller stays untouched", width: 120, height: 80, maxWidth: 500, maxHeight: 500, wantWidth: 120, wantHeight: 80, mustBeTheSameImageRef: true},
		{name: "rounds to nearest", width: 1499, height: 1000, maxWidth: 500, maxHeight: 500, wantWidth: 500, wantHeight: 334},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			src := solid(tc.width, tc.height, color.RGBA{R: 10, G: 200, B: 30, A: 255})
			got := FitInside(src, tc.maxWidth, tc.maxHeight)

			bounds := got.Bounds()
			if bounds.Dx() != tc.wantWidth || bounds.Dy() != tc.wantHeight {
				t.Errorf("size is %dx%d, want %dx%d", bounds.Dx(), bounds.Dy(), tc.wantWidth, tc.wantHeight)
			}
			if tc.mustBeTheSameImageRef && got != image.Image(src) {
				t.Error("an image that already fits must not be re-encoded (withoutEnlargement)")
			}
		})
	}
}

func TestFitJPEGFromPNG(t *testing.T) {
	var source bytes.Buffer
	if err := png.Encode(&source, solid(800, 200, color.RGBA{R: 200, A: 255})); err != nil {
		t.Fatalf("encode source: %v", err)
	}

	encoded, err := FitJPEG(bytes.NewReader(source.Bytes()), 500, 500, 85)
	if err != nil {
		t.Fatalf("FitJPEG: %v", err)
	}

	decoded, err := jpeg.Decode(bytes.NewReader(encoded))
	if err != nil {
		t.Fatalf("decode result: %v", err)
	}
	if bounds := decoded.Bounds(); bounds.Dx() != 500 || bounds.Dy() != 125 {
		t.Errorf("result is %dx%d, want 500x125", bounds.Dx(), bounds.Dy())
	}
}

// TestFitInsideKeepsColour makes sure the box filter does not shift a solid
// colour, which would show up on every cover.
func TestFitInsideKeepsColour(t *testing.T) {
	fill := color.RGBA{R: 12, G: 180, B: 240, A: 255}
	scaled := FitInside(solid(1000, 1000, fill), 500, 500)

	r, g, b, a := scaled.At(250, 250).RGBA()
	if uint8(r>>8) != fill.R || uint8(g>>8) != fill.G || uint8(b>>8) != fill.B || uint8(a>>8) != fill.A {
		t.Errorf("centre pixel is %d/%d/%d/%d, want %v", r>>8, g>>8, b>>8, a>>8, fill)
	}
}
