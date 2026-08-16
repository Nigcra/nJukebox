// engine.go
// Loopback spectrum engine: fans captured audio out as AnalyserNode style bands
// Version: 2026.08.14

package eq

import (
	"math"
	"sync"
	"time"
)

// The frontend equalizer reads its bars from a Web Audio AnalyserNode with
// fftSize 512, smoothingTimeConstant 0.8 and the default decibel range. The
// engine reproduces exactly that pipeline over the loopback capture, so the
// browser can drop the 256 byte frames into its existing data array without
// any further conversion: Blackman window, magnitude / fftSize, exponential
// smoothing, dB, then bytes across [-100 dB, -30 dB].
const (
	fftSize = 512
	// Bands is the number of frequency bands per frame, half the FFT size.
	Bands = fftSize / 2

	// staleAfter treats the ring buffer as silence when no samples arrived,
	// so a paused device decays to zero instead of freezing the last frame.
	staleAfter = 200 * time.Millisecond

	// frameEvery paces the outgoing frames. 30 per second is enough for the
	// 60 fps drawing loop because the analyser smoothing bridges the gap.
	frameEvery = 33 * time.Millisecond

	smoothing = 0.8
	minDb     = -100.0
	maxDb     = -30.0
)

// Engine owns the capture session and distributes spectrum frames. Capture
// only runs while at least one subscriber is connected, so an idle server
// does not hold the audio device open.
type Engine struct {
	mu       sync.Mutex
	subs     map[chan []byte]struct{}
	stop     chan struct{}
	ring     [fftSize]float64
	ringPos  int
	lastData time.Time

	window [fftSize]float64
	plan   *fftPlan
}

// NewEngine prepares the FFT plan and window. It does not touch the audio
// device; that happens on the first Subscribe.
func NewEngine() *Engine {
	e := &Engine{
		subs: make(map[chan []byte]struct{}),
		plan: newFFTPlan(fftSize),
	}
	// Blackman window as specified for AnalyserNode (alpha = 0.16).
	for i := 0; i < fftSize; i++ {
		phase := 2 * math.Pi * float64(i) / float64(fftSize)
		e.window[i] = 0.42 - 0.5*math.Cos(phase) + 0.08*math.Cos(2*phase)
	}
	return e
}

// Supported reports whether this platform can capture the system output.
func Supported() bool {
	return captureSupported
}

// Subscribe returns a channel of spectrum frames and a cancel function. The
// channel holds one frame; a slow reader gets the latest frame, not a backlog.
func (e *Engine) Subscribe() (<-chan []byte, func()) {
	ch := make(chan []byte, 1)

	e.mu.Lock()
	e.subs[ch] = struct{}{}
	if len(e.subs) == 1 {
		stop := make(chan struct{})
		e.stop = stop
		go captureRun(e, stop)
		go e.broadcast(stop)
	}
	e.mu.Unlock()

	var once sync.Once
	cancel := func() {
		once.Do(func() {
			e.mu.Lock()
			delete(e.subs, ch)
			if len(e.subs) == 0 && e.stop != nil {
				close(e.stop)
				e.stop = nil
			}
			e.mu.Unlock()
		})
	}
	return ch, cancel
}

// ingest appends mono samples to the ring buffer. Called by the capture loop;
// silent packets arrive as zeros so the decay stays time driven.
func (e *Engine) ingest(samples []float64) {
	if len(samples) == 0 {
		return
	}
	e.mu.Lock()
	for _, s := range samples {
		e.ring[e.ringPos] = s
		e.ringPos = (e.ringPos + 1) % fftSize
	}
	e.lastData = time.Now()
	e.mu.Unlock()
}

// snapshot copies the newest fftSize samples in chronological order, or zeros
// when the capture has gone quiet.
func (e *Engine) snapshot(dst []float64) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if time.Since(e.lastData) > staleAfter {
		for i := range dst {
			dst[i] = 0
		}
		return
	}
	for i := 0; i < fftSize; i++ {
		dst[i] = e.ring[(e.ringPos+i)%fftSize]
	}
}

// broadcast turns the ring buffer into frames until stop closes. The smoothing
// state lives here so every capture session starts clean, like a fresh
// AnalyserNode.
func (e *Engine) broadcast(stop <-chan struct{}) {
	ticker := time.NewTicker(frameEvery)
	defer ticker.Stop()

	var smoothed [Bands]float64
	input := make([]float64, fftSize)

	for {
		select {
		case <-stop:
			return
		case <-ticker.C:
		}

		e.snapshot(input)
		frame := e.spectrum(input, &smoothed)

		e.mu.Lock()
		for ch := range e.subs {
			// Latest frame wins: drop the unread one instead of blocking.
			select {
			case ch <- frame:
			default:
				select {
				case <-ch:
				default:
				}
				select {
				case ch <- frame:
				default:
				}
			}
		}
		e.mu.Unlock()
	}
}

// spectrum runs the AnalyserNode pipeline over one input window and returns a
// fresh 256 byte frame.
func (e *Engine) spectrum(input []float64, smoothed *[Bands]float64) []byte {
	re := make([]float64, fftSize)
	im := make([]float64, fftSize)
	for i := 0; i < fftSize; i++ {
		re[i] = input[i] * e.window[i]
	}
	e.plan.transform(re, im)

	frame := make([]byte, Bands)
	for k := 0; k < Bands; k++ {
		mag := math.Hypot(re[k], im[k]) / fftSize
		s := smoothing*smoothed[k] + (1-smoothing)*mag
		smoothed[k] = s

		db := math.Inf(-1)
		if s > 0 {
			db = 20 * math.Log10(s)
		}
		v := 255 * (db - minDb) / (maxDb - minDb)
		switch {
		case v < 0 || math.IsNaN(v):
			v = 0
		case v > 255:
			v = 255
		}
		frame[k] = byte(v)
	}
	return frame
}

// fftPlan holds the precomputed tables for an iterative radix-2 FFT.
type fftPlan struct {
	n      int
	rev    []int
	cosTab []float64
	sinTab []float64
}

func newFFTPlan(n int) *fftPlan {
	p := &fftPlan{
		n:      n,
		rev:    make([]int, n),
		cosTab: make([]float64, n/2),
		sinTab: make([]float64, n/2),
	}
	bits := 0
	for 1<<bits < n {
		bits++
	}
	for i := 0; i < n; i++ {
		r := 0
		for b := 0; b < bits; b++ {
			if i&(1<<b) != 0 {
				r |= 1 << (bits - 1 - b)
			}
		}
		p.rev[i] = r
	}
	for j := 0; j < n/2; j++ {
		angle := -2 * math.Pi * float64(j) / float64(n)
		p.cosTab[j] = math.Cos(angle)
		p.sinTab[j] = math.Sin(angle)
	}
	return p
}

// transform computes the in-place FFT of re/im.
func (p *fftPlan) transform(re, im []float64) {
	for i, r := range p.rev {
		if i < r {
			re[i], re[r] = re[r], re[i]
			im[i], im[r] = im[r], im[i]
		}
	}
	for size := 2; size <= p.n; size <<= 1 {
		half := size / 2
		step := p.n / size
		for base := 0; base < p.n; base += size {
			for j := 0; j < half; j++ {
				wRe := p.cosTab[j*step]
				wIm := p.sinTab[j*step]
				a := base + j
				b := a + half
				tRe := re[b]*wRe - im[b]*wIm
				tIm := re[b]*wIm + im[b]*wRe
				re[b] = re[a] - tRe
				im[b] = im[a] - tIm
				re[a] += tRe
				im[a] += tIm
			}
		}
	}
}
