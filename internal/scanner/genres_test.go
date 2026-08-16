// genres_test.go
// Checks validateGenre and validateGenres against the JavaScript behaviour
// Version: 2026.08.13

package scanner

import "testing"

func TestValidateGenre(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		{"exact match", "Rock", "Rock"},
		{"case insensitive", "rOcK", "Rock"},
		{"canonical spelling wins", "hip hop", "Hip Hop"},
		{"surrounding whitespace", "  Pop \t", "Pop"},
		{"genre prefix", "Genre: Pop", "Pop"},
		{"music suffix", "Dance Music", "Dance"},
		{"trailing year", "Pop 2023", "Pop"},
		{"number in parentheses", "Rock (17)", "Rock"},
		{"unknown genre", "Vaporwave", ""},
		{"empty", "", ""},
		{"only whitespace", "   ", ""},
		{"unicode whitespace", " Pop ", "Pop"},
		{"ampersand kept in a single value", "R&B", "R&B"},
		{"multi word", "Alternative Rock", "Alternative Rock"},
		// The patterns run once each and in a fixed order, so "music" is looked
		// for while the year is still in the way. Verified against Node.
		{"year and music need two passes", "Pop Music 2023", ""},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := ValidateGenre(tc.in); got != tc.want {
				t.Errorf("ValidateGenre(%q) = %q, want %q", tc.in, got, tc.want)
			}
		})
	}
}

func TestValidateGenresArray(t *testing.T) {
	cases := []struct {
		name string
		in   []string
		want string
	}{
		{"first valid wins", []string{"Vaporwave", "Pop", "Rock"}, "Pop"},
		{"nothing valid", []string{"Vaporwave", "Nightcore"}, ""},
		{"empty list", nil, ""},
		{"values are not split", []string{"Dance/Electronic"}, ""},
		{"ampersand survives", []string{"Drum & Bass"}, "Drum & Bass"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := ValidateGenres(tc.in); got != tc.want {
				t.Errorf("ValidateGenres(%q) = %q, want %q", tc.in, got, tc.want)
			}
		})
	}
}

// TestValidateGenresString pins the branch the scanner uses. The first four
// cases are the genre tags of the reference library and the values the existing
// database holds for them.
func TestValidateGenresString(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		{"plain", "Rock", "Rock"},
		{"slash separated", "Dance/Electronic", "Dance"},
		{"first part invalid", "Female Vocalists/Pop", "Pop"},
		{"three parts", "Alternative Rock/Rock/Cover", "Alternative Rock"},
		{"decade suffix", "Pop/90S", "Pop"},
		{"comma separated", "Jazz, Soul", "Jazz"},
		{"semicolon separated", "Nightcore;Trance", "Trance"},
		{"plus separated", "Noise+Industrial", "Noise"},
		{"empty", "", ""},
		// Documented quirk of the original: "&" is a separator, so the three
		// list entries that contain one can never match through this branch.
		{"ampersand is split", "R&B", ""},
		{"drum and bass is split", "Drum & Bass", ""},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := ValidateGenresString(tc.in); got != tc.want {
				t.Errorf("ValidateGenresString(%q) = %q, want %q", tc.in, got, tc.want)
			}
		})
	}
}

// TestValidGenresListUnchanged guards the size of the list. It must not grow
// while porting.
func TestValidGenresListUnchanged(t *testing.T) {
	const wantEntries = 188

	if len(ValidGenres) != wantEntries {
		t.Errorf("ValidGenres has %d entries, valid_genres.js has %d", len(ValidGenres), wantEntries)
	}
	if ValidGenres[0] != "Electronic" {
		t.Errorf("first entry is %q, want %q", ValidGenres[0], "Electronic")
	}
	if last := ValidGenres[len(ValidGenres)-1]; last != "Gothic" {
		t.Errorf("last entry is %q, want %q", last, "Gothic")
	}
}
