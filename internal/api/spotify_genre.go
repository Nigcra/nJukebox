// spotify_genre.go
// Fills in what a played Spotify title is missing: genre from its artist, cover from its album
// Version: 2026.08.16

package api

import (
	"context"
	"log"
	"strings"
	"time"
)

// genreLookupTimeout caps what a play request is willing to wait for the two
// extra calls. Recording a play must not hang on a slow Spotify - without a
// genre the title still lands in the library, it just misses the genre view.
const genreLookupTimeout = 5 * time.Second

// spotifyGenre returns a genre for a played title, empty when none can be found.
//
// Spotify keeps genres on the artist, never on the track, so this costs one
// lookup per artist. The result is cached for the process lifetime, misses
// included: an artist Spotify lists no genre for would otherwise be looked up
// again on every single play, and a party plays the same artist over and over.
func (s *Server) spotifyGenre(ctx context.Context, artistID, artistName string) string {
	if s.spotify == nil || s.spotifyClient == nil || artistName == "" {
		return ""
	}

	key := strings.ToLower(artistName)

	s.genreMu.Lock()
	cached, hit := s.genreCache[key]
	s.genreMu.Unlock()
	if hit {
		return cached
	}

	lookupCtx, cancel := context.WithTimeout(ctx, genreLookupTimeout)
	defer cancel()

	// No login, or the refresh failed. Neither is this handler's business.
	token, err := s.spotify.Token(lookupCtx)
	if err != nil {
		return ""
	}

	var genres []string
	if artistID != "" {
		genres, err = s.spotifyClient.ArtistGenres(lookupCtx, token.AccessToken, artistID)
		if err != nil {
			log.Printf("[GENRE] artist lookup failed for %q: %v", artistName, err)
		}
	}
	if len(genres) == 0 {
		genres, err = s.spotifyClient.SearchArtistGenres(lookupCtx, token.AccessToken, artistName)
		if err != nil {
			log.Printf("[GENRE] artist search failed for %q: %v", artistName, err)
		}
	}

	// A failed lookup is not an answer. Caching it would keep this artist
	// without a genre for the rest of the process over a single expired token
	// or one bad connection - the next play tries again instead.
	if err != nil {
		return ""
	}

	genre := ""
	if len(genres) > 0 {
		// Spotify orders them by relevance and writes them lower case
		// ("german pop", "eurodance"). The genre view groups case sensitively,
		// so without this every Spotify genre would sit apart from the
		// capitalised ones the scanner reads out of ID3 tags.
		genre = titleCase(genres[0])
	}

	s.genreMu.Lock()
	s.genreCache[key] = genre
	s.genreMu.Unlock()

	return genre
}

// spotifyTrackImage fetches the album cover of a played title, empty when there
// is none to be had.
//
// No cache here: unlike the artist genre this is one lookup per track, and the
// result goes straight into the row, so the same title never asks twice.
func (s *Server) spotifyTrackImage(ctx context.Context, trackID string) string {
	if s.spotify == nil || s.spotifyClient == nil || trackID == "" {
		return ""
	}

	lookupCtx, cancel := context.WithTimeout(ctx, genreLookupTimeout)
	defer cancel()

	token, err := s.spotify.Token(lookupCtx)
	if err != nil {
		return ""
	}

	image, err := s.spotifyClient.TrackAlbumImage(lookupCtx, token.AccessToken, trackID)
	if err != nil {
		log.Printf("[COVER] album image lookup failed for %s: %v", trackID, err)
		return ""
	}
	return image
}

// titleCase upper cases the first letter of every word and leaves the rest
// alone, which is what ID3 genres look like.
func titleCase(genre string) string {
	words := strings.Split(genre, " ")
	for i, word := range words {
		if word == "" {
			continue
		}
		words[i] = strings.ToUpper(word[:1]) + word[1:]
	}
	return strings.Join(words, " ")
}
