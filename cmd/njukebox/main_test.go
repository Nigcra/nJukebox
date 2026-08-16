// main_test.go
// Checks the root path normalization that keeps file_path values stable
// Version: 2026.08.13

package main

import (
	"path/filepath"
	"runtime"
	"testing"
)

// A lower case drive letter used to produce a second set of rows for files that
// were already in the library, because SQLite compares file_path as text.
func TestNormalizeRootUppercasesDriveLetter(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("drive letters only exist on Windows")
	}

	cases := []struct {
		in   string
		want string
	}{
		{`c:\Users\Nigcra\Desktop\nJukebox`, `C:\Users\Nigcra\Desktop\nJukebox`},
		{`C:\Users\Nigcra\Desktop\nJukebox`, `C:\Users\Nigcra\Desktop\nJukebox`},
		{`c:\Users\Nigcra\Desktop\nJukebox\`, `C:\Users\Nigcra\Desktop\nJukebox`},
		{`c:/Users/Nigcra/Desktop/nJukebox`, `C:\Users\Nigcra\Desktop\nJukebox`},
		{`c:\Users\Nigcra\..\Nigcra\Desktop\nJukebox`, `C:\Users\Nigcra\Desktop\nJukebox`},
	}

	for _, c := range cases {
		if got := normalizeRoot(c.in); got != c.want {
			t.Errorf("normalizeRoot(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

// Two spellings of the same directory must end up identical, otherwise the
// scanner writes duplicate rows.
func TestNormalizeRootIsStableAcrossSpellings(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("drive letters only exist on Windows")
	}

	lower := normalizeRoot(`c:\temp\njukebox`)
	upper := normalizeRoot(`C:\temp\njukebox`)
	slashes := normalizeRoot(`C:/temp/njukebox`)

	if lower != upper || upper != slashes {
		t.Errorf("spellings diverge: %q, %q, %q", lower, upper, slashes)
	}
}

// Paths without a drive letter must survive unchanged apart from cleaning.
func TestNormalizeRootLeavesRelativePathsAlone(t *testing.T) {
	got := normalizeRoot(filepath.Join("some", "where", ".."))
	if want := "some"; got != want {
		t.Errorf("normalizeRoot = %q, want %q", got, want)
	}
}

// PORT applied to both listeners pointed them at the same address. The second
// bind then failed with "address already in use" and took the process down -
// and the start scripts set PORT themselves, so they broke the server they had
// just started.
func TestResolvePorts(t *testing.T) {
	const (
		web  = 5500
		data = 3001
	)

	cases := []struct {
		name     string
		env      string
		webOnly  bool
		dataOnly bool
		wantWeb  int
		wantData int
		wantNote bool
	}{
		{"no environment", "", false, false, web, data, false},
		{"both listeners ignore PORT", "5500", false, false, web, data, true},
		{"both listeners ignore any PORT", "9000", false, false, web, data, true},
		{"web only honours PORT", "8080", true, false, 8080, data, false},
		{"data only honours PORT", "8080", false, true, web, 8080, false},
		{"garbage is reported", "abc", true, false, web, data, true},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			gotWeb, gotData, note := resolvePorts(web, data, c.env, c.webOnly, c.dataOnly)

			if gotWeb != c.wantWeb {
				t.Errorf("web port = %d, want %d", gotWeb, c.wantWeb)
			}
			if gotData != c.wantData {
				t.Errorf("data port = %d, want %d", gotData, c.wantData)
			}
			if (note != "") != c.wantNote {
				t.Errorf("note = %q, want a note: %v", note, c.wantNote)
			}
		})
	}
}

// The decisive property: the two listeners must never end up on the same port,
// whatever the environment says.
func TestResolvePortsNeverCollide(t *testing.T) {
	for _, env := range []string{"", "3001", "5500", "8080", "abc"} {
		web, data, _ := resolvePorts(5500, 3001, env, false, false)
		if web == data {
			t.Errorf("PORT=%q put both listeners on port %d", env, web)
		}
	}
}
