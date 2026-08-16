// engine_test.go
// Unit tests for the FFT plan and the AnalyserNode style spectrum pipeline
// Version: 2026.08.14

package eq

import (
	"math"
	"testing"
	"time"
)

// The FFT must match a naive DFT, otherwise every band is subtly wrong.
func TestFFTMatchesNaiveDFT(t *testing.T) {
	const n = 16
	plan := newFFTPlan(n)

	input := make([]float64, n)
	for i := range input {
		// Deterministic, aperiodic test signal.
		input[i] = math.Sin(float64(i)*1.3) + 0.5*math.Cos(float64(i)*2.7)
	}

	re := make([]float64, n)
	im := make([]float64, n)
	copy(re, input)
	plan.transform(re, im)

	for k := 0; k < n; k++ {
		var wantRe, wantIm float64
		for i := 0; i < n; i++ {
			angle := -2 * math.Pi * float64(k) * float64(i) / float64(n)
			wantRe += input[i] * math.Cos(angle)
			wantIm += input[i] * math.Sin(angle)
		}
		if math.Abs(re[k]-wantRe) > 1e-9 || math.Abs(im[k]-wantIm) > 1e-9 {
			t.Fatalf("bin %d: got (%g, %g), want (%g, %g)", k, re[k], im[k], wantRe, wantIm)
		}
	}
}

// A pure sine on a bin frequency must peak exactly on that band.
func TestSpectrumSinePeak(t *testing.T) {
	e := NewEngine()

	// Amplitude below full scale: a full scale sine drives the neighbouring
	// bands into the 255 clamp as well and the peak position gets ambiguous.
	const bin = 16
	const amplitude = 0.05
	input := make([]float64, fftSize)
	for i := range input {
		input[i] = amplitude * math.Sin(2*math.Pi*float64(bin)*float64(i)/fftSize)
	}

	var smoothed [Bands]float64
	var frame []byte
	// Repeated frames converge the exponential smoothing.
	for i := 0; i < 60; i++ {
		frame = e.spectrum(input, &smoothed)
	}

	peak := 0
	for k := range frame {
		if frame[k] > frame[peak] {
			peak = k
		}
	}
	if peak != bin {
		t.Fatalf("peak at band %d, want %d", peak, bin)
	}
	if frame[bin] < 200 {
		t.Fatalf("peak band too quiet: %d", frame[bin])
	}
	if frame[bin] <= frame[bin-1] || frame[bin] <= frame[bin+1] {
		t.Fatalf("peak not distinct: %d, neighbours %d and %d", frame[bin], frame[bin-1], frame[bin+1])
	}
	// Far away from the peak the Blackman leakage must have died off.
	if frame[128] > 40 {
		t.Fatalf("distant band unexpectedly loud: %d", frame[128])
	}
}

// Silence must map to zero bytes: log10(0) runs through -Inf and clamping.
func TestSpectrumSilence(t *testing.T) {
	e := NewEngine()

	input := make([]float64, fftSize)
	var smoothed [Bands]float64
	var frame []byte
	for i := 0; i < 5; i++ {
		frame = e.spectrum(input, &smoothed)
	}
	for k, v := range frame {
		if v != 0 {
			t.Fatalf("band %d is %d for silence, want 0", k, v)
		}
	}
}

// The ring buffer must hand back the newest samples in chronological order and
// decay to silence once the capture goes quiet.
func TestIngestSnapshot(t *testing.T) {
	e := NewEngine()

	ramp := make([]float64, fftSize)
	for i := range ramp {
		ramp[i] = float64(i)
	}
	// Ingest with an offset first so the ring position wraps.
	e.ingest(ramp[:100])
	e.ingest(ramp)

	got := make([]float64, fftSize)
	e.snapshot(got)
	for i := range got {
		if got[i] != ramp[i] {
			t.Fatalf("sample %d: got %g, want %g", i, got[i], ramp[i])
		}
	}

	e.lastData = time.Now().Add(-time.Second)
	e.snapshot(got)
	for i := range got {
		if got[i] != 0 {
			t.Fatalf("stale sample %d: got %g, want 0", i, got[i])
		}
	}
}
