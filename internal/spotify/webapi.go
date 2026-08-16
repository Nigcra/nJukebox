// webapi.go
// Spotify Web API lookups beyond the accounts endpoints
// Version: 2026.08.16

package spotify

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
)

// DefaultAPIBase is the Spotify Web API root. Tests point the client at a local
// httptest server instead.
const DefaultAPIBase = "https://api.spotify.com/v1"

// artistPayload is the part of an artist object this package reads. Spotify
// lists genres on the artist, never on the track - that is the whole reason
// this lookup exists.
type artistPayload struct {
	Name   string   `json:"name"`
	Genres []string `json:"genres"`
}

// ArtistGenres returns the genres Spotify lists for an artist id, most relevant
// first. An artist without genres yields an empty slice and no error: plenty of
// artists simply have none, and that is not a failure.
func (c *Client) ArtistGenres(ctx context.Context, accessToken, artistID string) ([]string, error) {
	if artistID == "" {
		return nil, nil
	}

	var artist artistPayload
	if err := c.getJSON(ctx, accessToken, c.apiURL()+"/artists/"+url.PathEscape(artistID), &artist); err != nil {
		return nil, err
	}
	return artist.Genres, nil
}

// SearchArtistGenres finds an artist by name and returns its genres. The fallback
// for tracks that reach the server without an artist id - the queue is fed from
// several places and not all of them carry one.
//
// Only an exact, case insensitive name match counts. Spotify's search is fuzzy
// enough to answer "Alan Walker" with someone else entirely, and a wrong genre
// is worse than none.
func (c *Client) SearchArtistGenres(ctx context.Context, accessToken, name string) ([]string, error) {
	if name == "" {
		return nil, nil
	}

	query := url.Values{}
	query.Set("q", name)
	query.Set("type", "artist")
	query.Set("limit", "5")

	var payload struct {
		Artists struct {
			Items []artistPayload `json:"items"`
		} `json:"artists"`
	}
	if err := c.getJSON(ctx, accessToken, c.apiURL()+"/search?"+query.Encode(), &payload); err != nil {
		return nil, err
	}

	for _, artist := range payload.Artists.Items {
		if strings.EqualFold(artist.Name, name) {
			return artist.Genres, nil
		}
	}
	return nil, nil
}

// TrackAlbumImage returns the album cover Spotify holds for a track, empty when
// it has none.
//
// Rows written by a play request only carry an image when the object in the
// queue happened to hold one, and several paths into the queue do not. Without
// the image the album shows the default cover, so it is fetched here instead.
func (c *Client) TrackAlbumImage(ctx context.Context, accessToken, trackID string) (string, error) {
	if trackID == "" {
		return "", nil
	}

	var payload struct {
		Album struct {
			Images []struct {
				URL string `json:"url"`
			} `json:"images"`
		} `json:"album"`
	}
	if err := c.getJSON(ctx, accessToken, c.apiURL()+"/tracks/"+url.PathEscape(trackID), &payload); err != nil {
		return "", err
	}

	images := payload.Album.Images
	if len(images) == 0 {
		return "", nil
	}
	// Spotify sorts them largest first. The frontend has always preferred the
	// middle size for grid tiles, so the second entry wins where there is one.
	if len(images) > 1 {
		return images[1].URL, nil
	}
	return images[0].URL, nil
}

func (c *Client) apiURL() string {
	if c.apiBase != "" {
		return c.apiBase
	}
	return DefaultAPIBase
}

// getJSON runs one authorised GET and decodes the body. A non 2xx answer becomes
// an *Error carrying the status, so callers can tell an expired token from a
// missing artist.
func (c *Client) getJSON(ctx context.Context, accessToken, endpoint string, out any) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return fmt.Errorf("spotify web api request: %w", err)
	}
	request.Header.Set("Authorization", "Bearer "+accessToken)

	response, err := c.httpClient.Do(request)
	if err != nil {
		return fmt.Errorf("spotify web api: %w", err)
	}
	defer response.Body.Close()

	body, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return fmt.Errorf("spotify web api body: %w", err)
	}

	if response.StatusCode < 200 || response.StatusCode > 299 {
		return &Error{Status: response.StatusCode, Code: "web_api"}
	}

	if err := json.Unmarshal(body, out); err != nil {
		return fmt.Errorf("spotify web api decode: %w", err)
	}
	return nil
}
