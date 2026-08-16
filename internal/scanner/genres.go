// genres.go
// Genre validation, ported verbatim from lib/valid_genres.js
// Version: 2026.08.13

package scanner

import (
	"regexp"
	"strings"
)

// ValidGenres is the definitive list of valid music genres. Only tracks with
// exactly these genres are categorized accordingly, all others end up as
// "Unknown". Order and duplicates are taken over unchanged from
// lib/valid_genres.js - the list is not extended.
var ValidGenres = []string{
	// Electronic/Dance
	"Electronic", "Dance", "House", "Techno", "Trance", "Dubstep", "EDM", "Electro",
	"Progressive House", "Deep House", "Tech House", "Minimal", "Ambient", "Drum & Bass",
	"Jungle", "Breakbeat", "Hardcore", "Hardstyle", "Gabber", "IDM", "Downtempo",
	"Chillout", "Lounge", "Trip Hop", "Synthwave", "Synthpop", "New Wave",

	// Pop
	"Pop", "Dance Pop", "Synth Pop", "Electropop", "Teen Pop", "Adult Contemporary",
	"Contemporary R&B", "Europop", "J-Pop", "K-Pop", "Latin Pop", "Ballad",

	// Rock
	"Rock", "Hard Rock", "Soft Rock", "Classic Rock", "Alternative Rock", "Indie Rock",
	"Progressive Rock", "Psychedelic Rock", "Punk Rock", "Post-Punk", "New Wave",
	"Grunge", "Metal", "Heavy Metal", "Death Metal", "Black Metal", "Power Metal",
	"Thrash Metal", "Folk Rock", "Country Rock", "Southern Rock", "Blues Rock",

	// Hip-Hop/Rap
	"Hip Hop", "Hip-Hop", "Rap", "Gangsta Rap", "East Coast Hip Hop", "West Coast Hip Hop",
	"Southern Hip Hop", "Trap", "Conscious Hip Hop", "Alternative Hip Hop", "Old School Hip Hop",
	"Boom Bap", "Crunk", "Grime", "UK Hip Hop", "German Rap", "Deutschrap", "French Rap",

	// R&B/Soul/Funk
	"R&B", "Soul", "Funk", "Disco", "Motown", "Neo-Soul", "Contemporary R&B",
	"Classic Soul", "Northern Soul", "Gospel", "Blues", "Rhythm & Blues",

	// Country/Folk
	"Country", "Country Pop", "Country Rock", "Bluegrass", "Folk", "Folk Rock",
	"Americana", "Alt-Country", "Honky Tonk", "Western", "Celtic", "Traditional",

	// Jazz
	"Jazz", "Smooth Jazz", "Bebop", "Cool Jazz", "Free Jazz", "Fusion", "Swing",
	"Big Band", "Dixieland", "Contemporary Jazz", "Acid Jazz", "Nu Jazz",

	// Classical/Instrumental
	"Classical", "Baroque", "Romantic", "Modern Classical", "Orchestral", "Chamber Music",
	"Opera", "Instrumental", "Soundtrack", "Score", "New Age", "Meditation",

	// World Music
	"World", "World Music", "Latin", "Salsa", "Reggaeton", "Bachata", "Merengue",
	"Bossa Nova", "Samba", "Tango", "Flamenco", "Reggae", "Dancehall", "Ska",
	"Afrobeat", "Highlife", "Soukous", "Bhangra", "Bollywood", "Arabic", "Turkish",
	"Greek", "Russian", "French", "Italian", "Spanish", "Portuguese", "German",

	// Alternative/Indie
	"Alternative", "Indie", "Indie Pop", "Indie Rock", "Alternative Rock", "Shoegaze",
	"Dream Pop", "Post-Rock", "Math Rock", "Emo", "Screamo", "Hardcore", "Metalcore",

	// Era/Style Descriptors (not decades)
	"Oldies", "Retro", "Vintage",

	// Miscellaneous
	"Easy Listening", "Smooth", "Chill", "Acoustic", "Live", "Unplugged",
	"Cover", "Remix", "Compilation", "Christmas", "Holiday", "Seasonal",
	"Experimental", "Avant-Garde", "Noise", "Industrial", "Gothic",
}

// jsWhitespace is the exact character set String.prototype.trim() removes and
// the one \s matches in a JavaScript regular expression. Go's \s knows only
// five of them and strings.TrimSpace uses a third set, so the set is spelled
// out to keep the cleaning identical to the Node implementation.
const jsWhitespace = "\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006" +
	"\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"

// jsSpaceClass is jsWhitespace as a regular expression character class.
const jsSpaceClass = `[\t\n\v\f\r \x{00a0}\x{1680}\x{2000}-\x{200a}\x{2028}\x{2029}\x{202f}\x{205f}\x{3000}\x{feff}]`

// cleanPatterns removes prefixes and suffixes that are not part of the genre.
// Same patterns and same order as valid_genres.js.
var cleanPatterns = []*regexp.Regexp{
	regexp.MustCompile(`(?i)^genre:` + jsSpaceClass + `*`),
	regexp.MustCompile(`(?i)` + jsSpaceClass + `*music$`),
	regexp.MustCompile(jsSpaceClass + `*[0-9]{4}$`),   // Remove years like "Pop 2023"
	regexp.MustCompile(jsSpaceClass + `*\([0-9]+\)$`), // Remove numbers in parentheses
}

// jsTrim reproduces String.prototype.trim().
func jsTrim(value string) string {
	return strings.Trim(value, jsWhitespace)
}

// ValidateGenre normalizes and validates a single genre. An empty result means
// the JavaScript version returned null.
func ValidateGenre(rawGenre string) string {
	// !rawGenre is true for an empty string as well.
	if rawGenre == "" {
		return ""
	}

	cleanGenre := jsTrim(rawGenre)

	// Every pattern is anchored, so replacing all matches equals JavaScript
	// replacing the first one.
	for _, pattern := range cleanPatterns {
		cleanGenre = pattern.ReplaceAllString(cleanGenre, "")
	}

	cleanGenre = jsTrim(cleanGenre)

	lowered := strings.ToLower(cleanGenre)
	for _, validGenre := range ValidGenres {
		if strings.ToLower(validGenre) == lowered {
			return validGenre
		}
	}
	return ""
}

// ValidateGenres is the array branch of validateGenres(): the values are
// validated as they are and are never split. Returns the first valid genre, or
// an empty string when none matches.
func ValidateGenres(rawGenres []string) string {
	if len(rawGenres) == 0 {
		return ""
	}

	for _, genre := range rawGenres {
		if valid := ValidateGenre(genre); valid != "" {
			return valid
		}
	}
	return ""
}

// genreSeparators is the split expression of the string branch, /[,;\/&+]/.
var genreSeparators = regexp.MustCompile(`[,;/&+]`)

// ValidateGenresString is the string branch of validateGenres(): the value is
// split on the common separators first, then every part is validated.
//
// This is the branch the scanner uses, because dhowden/tag hands the genre over
// as one string. It is also the branch that reproduces the existing database:
// the rows there hold "Dance" for the tag "Dance/Electronic" and "Alternative
// Rock" for "Alternative Rock/Rock/Cover", which only the split produces.
//
// The price is a quirk of the original function that is kept on purpose: "&" is
// a separator, so "R&B", "Drum & Bass" and "Rhythm & Blues" can never match
// through this branch even though they are in the list.
func ValidateGenresString(rawGenres string) string {
	if rawGenres == "" {
		return ""
	}

	parts := genreSeparators.Split(rawGenres, -1)
	for i, part := range parts {
		parts[i] = jsTrim(part)
	}
	return ValidateGenres(parts)
}
