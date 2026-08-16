// capture_windows.go
// WASAPI loopback capture of the default render device, pure Go via COM
// Version: 2026.08.14

//go:build windows

package eq

import (
	"errors"
	"fmt"
	"log"
	"runtime"
	"time"
	"unsafe"

	"github.com/go-ole/go-ole"
	"github.com/moutend/go-wca/pkg/wca"
)

const captureSupported = true

// errDeviceChanged restarts the session when Windows switched the default
// output. A loopback client keeps capturing the device it was opened on, so a
// headset powering up would otherwise leave the capture on the now silent
// speakers without any error ever surfacing.
var errDeviceChanged = errors.New("default output device changed")

// captureRun keeps a loopback session alive until stop closes. Every failure -
// device gone, format change, default output switched - tears the session down
// and the next attempt opens against the then current default device.
func captureRun(e *Engine, stop <-chan struct{}) {
	for {
		err := captureOnce(e, stop)
		select {
		case <-stop:
			return
		default:
		}
		if err != nil {
			log.Printf("[EQ] loopback capture: %v (reopening)", err)
		}
		select {
		case <-stop:
			return
		case <-time.After(3 * time.Second):
		}
	}
}

func captureOnce(e *Engine, stop <-chan struct{}) error {
	// COM state is per thread; the whole session stays on one OS thread.
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()

	if err := ole.CoInitializeEx(0, ole.COINIT_APARTMENTTHREADED); err != nil {
		return fmt.Errorf("CoInitializeEx: %w", err)
	}
	defer ole.CoUninitialize()

	var enumerator *wca.IMMDeviceEnumerator
	if err := wca.CoCreateInstance(wca.CLSID_MMDeviceEnumerator, 0, wca.CLSCTX_ALL, wca.IID_IMMDeviceEnumerator, &enumerator); err != nil {
		return fmt.Errorf("device enumerator: %w", err)
	}
	defer enumerator.Release()

	var device *wca.IMMDevice
	if err := enumerator.GetDefaultAudioEndpoint(wca.ERender, wca.EConsole, &device); err != nil {
		return fmt.Errorf("default render endpoint: %w", err)
	}
	defer device.Release()

	var deviceID string
	if err := device.GetId(&deviceID); err != nil {
		deviceID = ""
	}

	var client *wca.IAudioClient
	if err := device.Activate(wca.IID_IAudioClient, wca.CLSCTX_ALL, nil, &client); err != nil {
		return fmt.Errorf("activate audio client: %w", err)
	}
	defer client.Release()

	// Shared mode loopback must use the mix format of the audio engine.
	var wfx *wca.WAVEFORMATEX
	if err := client.GetMixFormat(&wfx); err != nil {
		return fmt.Errorf("mix format: %w", err)
	}
	defer ole.CoTaskMemFree(uintptr(unsafe.Pointer(wfx)))

	decode, err := sampleDecoder(wfx)
	if err != nil {
		return err
	}
	channels := int(wfx.NChannels)

	// 100 ms buffer, expressed in units of 100 ns. Event driven loopback is
	// unreliable by design, polling is the documented safe route.
	const bufferDuration wca.REFERENCE_TIME = 1_000_000
	if err := client.Initialize(wca.AUDCLNT_SHAREMODE_SHARED, wca.AUDCLNT_STREAMFLAGS_LOOPBACK, bufferDuration, 0, wfx, nil); err != nil {
		return fmt.Errorf("initialize loopback: %w", err)
	}

	var capture *wca.IAudioCaptureClient
	if err := client.GetService(wca.IID_IAudioCaptureClient, &capture); err != nil {
		return fmt.Errorf("capture client: %w", err)
	}
	defer capture.Release()

	if err := client.Start(); err != nil {
		return fmt.Errorf("start capture: %w", err)
	}
	defer client.Stop()

	log.Printf("[EQ] loopback capture running: %d Hz, %d channels", wfx.NSamplesPerSec, channels)

	poll := time.NewTicker(10 * time.Millisecond)
	defer poll.Stop()
	deviceCheck := time.NewTicker(2 * time.Second)
	defer deviceCheck.Stop()

	mono := make([]float64, 0, 4096)

	for {
		select {
		case <-stop:
			return nil

		case <-deviceCheck.C:
			var current *wca.IMMDevice
			if err := enumerator.GetDefaultAudioEndpoint(wca.ERender, wca.EConsole, &current); err != nil {
				continue
			}
			var id string
			idErr := current.GetId(&id)
			current.Release()
			if idErr == nil && deviceID != "" && id != deviceID {
				return errDeviceChanged
			}

		case <-poll.C:
			for {
				var next uint32
				if err := capture.GetNextPacketSize(&next); err != nil {
					return fmt.Errorf("packet size: %w", err)
				}
				if next == 0 {
					break
				}
				var data *byte
				var frames, flags uint32
				if err := capture.GetBuffer(&data, &frames, &flags, nil, nil); err != nil {
					return fmt.Errorf("get buffer: %w", err)
				}
				if frames > 0 {
					mono = mono[:0]
					if flags&wca.AUDCLNT_BUFFERFLAGS_SILENT != 0 {
						for i := uint32(0); i < frames; i++ {
							mono = append(mono, 0)
						}
					} else {
						mono = decode(data, int(frames), channels, mono)
					}
					e.ingest(mono)
				}
				if err := capture.ReleaseBuffer(frames); err != nil {
					return fmt.Errorf("release buffer: %w", err)
				}
			}
		}
	}
}

// decoder converts one captured packet into mono float64 samples.
type decoder func(data *byte, frames, channels int, dst []float64) []float64

// sampleDecoder picks the converter for the mix format. Shared mode mixes in
// 32 bit float on every current Windows; 16 bit PCM is kept as a fallback.
func sampleDecoder(wfx *wca.WAVEFORMATEX) (decoder, error) {
	const (
		formatPCM        = 1
		formatIEEEFloat  = 3
		formatExtensible = 0xFFFE
	)
	tag := int(wfx.WFormatTag)
	bits := int(wfx.WBitsPerSample)

	if tag == formatExtensible {
		// WAVEFORMATEXTENSIBLE: the SubFormat GUID sits at byte offset 24 of
		// the packed C struct, and its Data1 field selects the base format.
		data1 := *(*uint32)(unsafe.Add(unsafe.Pointer(wfx), 24))
		switch data1 {
		case formatPCM:
			tag = formatPCM
		case formatIEEEFloat:
			tag = formatIEEEFloat
		default:
			return nil, fmt.Errorf("unsupported loopback sample format: subformat %#x", data1)
		}
	}

	switch {
	case tag == formatIEEEFloat && bits == 32:
		return decodeFloat32, nil
	case tag == formatPCM && bits == 16:
		return decodeInt16, nil
	}
	return nil, fmt.Errorf("unsupported loopback sample format: tag %#x, %d bit", tag, bits)
}

func decodeFloat32(data *byte, frames, channels int, dst []float64) []float64 {
	src := unsafe.Slice((*float32)(unsafe.Pointer(data)), frames*channels)
	for f := 0; f < frames; f++ {
		sum := 0.0
		for c := 0; c < channels; c++ {
			sum += float64(src[f*channels+c])
		}
		dst = append(dst, sum/float64(channels))
	}
	return dst
}

func decodeInt16(data *byte, frames, channels int, dst []float64) []float64 {
	src := unsafe.Slice((*int16)(unsafe.Pointer(data)), frames*channels)
	for f := 0; f < frames; f++ {
		sum := 0.0
		for c := 0; c < channels; c++ {
			sum += float64(src[f*channels+c]) / 32768
		}
		dst = append(dst, sum/float64(channels))
	}
	return dst
}
