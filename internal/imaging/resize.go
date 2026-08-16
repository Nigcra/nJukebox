// resize.go
// sharp's fit:inside with withoutEnlargement, plus JPEG encoding
// Version: 2026.08.13

package imaging

import (
	"bytes"
	"fmt"
	"image"
	"image/jpeg"
	"io"
)

// FitInside reproduces sharp's resize(maxW, maxH, {fit: 'inside',
// withoutEnlargement: true}): the image is scaled down until it fits into the
// box, keeping its aspect ratio. An image that already fits is returned
// untouched, which is what withoutEnlargement means.
func FitInside(src image.Image, maxW, maxH int) image.Image {
	bounds := src.Bounds()
	width, height := bounds.Dx(), bounds.Dy()
	if width <= 0 || height <= 0 || maxW <= 0 || maxH <= 0 {
		return src
	}

	// The smaller of the two ratios decides, so both edges end up inside.
	scale := float64(maxW) / float64(width)
	if vertical := float64(maxH) / float64(height); vertical < scale {
		scale = vertical
	}
	if scale >= 1 {
		return src
	}

	targetW := int(float64(width)*scale + 0.5)
	targetH := int(float64(height)*scale + 0.5)
	if targetW < 1 {
		targetW = 1
	}
	if targetH < 1 {
		targetH = 1
	}
	return scaleTo(src, targetW, targetH)
}

// EncodeJPEG writes the image as JPEG with the given quality.
func EncodeJPEG(img image.Image, quality int) ([]byte, error) {
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: quality}); err != nil {
		return nil, fmt.Errorf("encode jpeg: %w", err)
	}
	return buf.Bytes(), nil
}

// FitJPEG decodes an image, scales it into the box and encodes it as JPEG. It
// is the Go equivalent of the sharp pipeline the scanner used for cover art.
func FitJPEG(r io.Reader, maxW, maxH, quality int) ([]byte, error) {
	img, _, err := image.Decode(r)
	if err != nil {
		return nil, fmt.Errorf("decode image: %w", err)
	}
	return EncodeJPEG(FitInside(img, maxW, maxH), quality)
}

// scaleTo scales the whole source image to width x height with a box filter.
// Same trade-off as the mosaic: sharp used lanczos3, so single pixels differ,
// but no cover is compared byte for byte anywhere.
func scaleTo(src image.Image, width, height int) *image.RGBA {
	bounds := src.Bounds()
	srcW, srcH := bounds.Dx(), bounds.Dy()

	dst := image.NewRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		y0 := bounds.Min.Y + y*srcH/height
		y1 := bounds.Min.Y + (y+1)*srcH/height
		if y1 <= y0 {
			y1 = y0 + 1
		}

		for x := 0; x < width; x++ {
			x0 := bounds.Min.X + x*srcW/width
			x1 := bounds.Min.X + (x+1)*srcW/width
			if x1 <= x0 {
				x1 = x0 + 1
			}
			dst.SetRGBA(x, y, averageArea(src, x0, y0, x1, y1))
		}
	}
	return dst
}
