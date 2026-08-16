// webapi_test.go
// Artist genre lookups against a simulated Spotify Web API
// Version: 2026.08.16

package spotify

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

// webAPI returns a client pointed at a stub of the Web API.
func webAPI(t *testing.T, handler http.HandlerFunc) *Client {
	t.Helper()

	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)

	client := NewClient()
	client.apiBase = server.URL
	return client
}

func TestArtistGenresByID(t *testing.T) {
	var gotPath, gotAuth string
	client := webAPI(t, func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotAuth = r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"name":"Ace of Base","genres":["eurodance","swedish pop"]}`))
	})

	genres, err := client.ArtistGenres(context.Background(), "token-abc", "5ROIQiPQ9GYKGfL0Rp2tRi")
	if err != nil {
		t.Fatalf("ArtistGenres: %v", err)
	}

	if gotPath != "/artists/5ROIQiPQ9GYKGfL0Rp2tRi" {
		t.Errorf("path = %q, want /artists/5ROIQiPQ9GYKGfL0Rp2tRi", gotPath)
	}
	if gotAuth != "Bearer token-abc" {
		t.Errorf("authorization = %q, want the bearer token", gotAuth)
	}
	if len(genres) != 2 || genres[0] != "eurodance" {
		t.Errorf("genres = %v, want eurodance first", genres)
	}
}

// An empty id must not produce a request - the caller falls back to the search.
func TestArtistGenresWithoutIDDoesNotCall(t *testing.T) {
	called := false
	client := webAPI(t, func(w http.ResponseWriter, r *http.Request) {
		called = true
	})

	genres, err := client.ArtistGenres(context.Background(), "token-abc", "")
	if err != nil {
		t.Fatalf("ArtistGenres: %v", err)
	}
	if called {
		t.Error("an empty artist id still hit the network")
	}
	if genres != nil {
		t.Errorf("genres = %v, want nil", genres)
	}
}

// Spotify's search is fuzzy. Only an exact, case insensitive name match counts,
// because a wrong genre is worse than none.
func TestSearchArtistGenresRequiresExactName(t *testing.T) {
	const body = `{"artists":{"items":[
		{"name":"Alan Walker Tribute","genres":["tribute"]},
		{"name":"alan walker","genres":["electro house","edm"]}
	]}}`

	client := webAPI(t, func(w http.ResponseWriter, r *http.Request) {
		if got := r.URL.Query().Get("type"); got != "artist" {
			t.Errorf("type = %q, want artist", got)
		}
		if got := r.URL.Query().Get("q"); got != "Alan Walker" {
			t.Errorf("q = %q, want Alan Walker", got)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(body))
	})

	genres, err := client.SearchArtistGenres(context.Background(), "token-abc", "Alan Walker")
	if err != nil {
		t.Fatalf("SearchArtistGenres: %v", err)
	}
	if len(genres) != 2 || genres[0] != "electro house" {
		t.Errorf("genres = %v, want the genres of the exactly matching artist", genres)
	}
}

func TestSearchArtistGenresWithoutMatch(t *testing.T) {
	client := webAPI(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"artists":{"items":[{"name":"Somebody Else","genres":["pop"]}]}}`))
	})

	genres, err := client.SearchArtistGenres(context.Background(), "token-abc", "Nobody At All")
	if err != nil {
		t.Fatalf("SearchArtistGenres: %v", err)
	}
	if genres != nil {
		t.Errorf("genres = %v, want nil when no name matches exactly", genres)
	}
}

// Spotify sorts album images largest first. Grid tiles want the middle one.
func TestTrackAlbumImagePrefersMiddleSize(t *testing.T) {
	var gotPath string
	client := webAPI(t, func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"album":{"images":[
			{"url":"https://i.scdn.co/image/large"},
			{"url":"https://i.scdn.co/image/medium"},
			{"url":"https://i.scdn.co/image/small"}
		]}}`))
	})

	image, err := client.TrackAlbumImage(context.Background(), "token-abc", "4uLU6hMCjMI75M1A2tKUQC")
	if err != nil {
		t.Fatalf("TrackAlbumImage: %v", err)
	}
	if gotPath != "/tracks/4uLU6hMCjMI75M1A2tKUQC" {
		t.Errorf("path = %q, want /tracks/4uLU6hMCjMI75M1A2tKUQC", gotPath)
	}
	if image != "https://i.scdn.co/image/medium" {
		t.Errorf("image = %q, want the middle size", image)
	}
}

// A single image is taken as it is, and no image is not an error.
func TestTrackAlbumImageEdgeCases(t *testing.T) {
	single := webAPI(t, func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"album":{"images":[{"url":"https://i.scdn.co/image/only"}]}}`))
	})
	image, err := single.TrackAlbumImage(context.Background(), "token-abc", "id")
	if err != nil {
		t.Fatalf("TrackAlbumImage: %v", err)
	}
	if image != "https://i.scdn.co/image/only" {
		t.Errorf("image = %q, want the only entry", image)
	}

	none := webAPI(t, func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"album":{"images":[]}}`))
	})
	image, err = none.TrackAlbumImage(context.Background(), "token-abc", "id")
	if err != nil {
		t.Fatalf("TrackAlbumImage without images: %v", err)
	}
	if image != "" {
		t.Errorf("image = %q, want empty", image)
	}
}

// An expired token has to surface as an error, not as "this artist has no
// genres" - otherwise the empty result would be cached and never retried.
func TestArtistGenresReportsHTTPError(t *testing.T) {
	client := webAPI(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error":{"status":401,"message":"The access token expired"}}`))
	})

	_, err := client.ArtistGenres(context.Background(), "stale", "5ROIQiPQ9GYKGfL0Rp2tRi")
	if err == nil {
		t.Fatal("expected an error for HTTP 401")
	}

	var apiErr *Error
	if !errors.As(err, &apiErr) {
		t.Fatalf("error = %v, want an *Error", err)
	}
	if apiErr.Status != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401", apiErr.Status)
	}
}
