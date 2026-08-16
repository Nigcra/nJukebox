// capture_other.go
// Stub for platforms without loopback capture
// Version: 2026.08.14

//go:build !windows

package eq

const captureSupported = false

// captureRun has nothing to capture here; it just waits for the stop signal so
// the engine lifecycle stays identical across platforms.
func captureRun(_ *Engine, stop <-chan struct{}) {
	<-stop
}
