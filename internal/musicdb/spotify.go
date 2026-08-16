// spotify.go
// Queries against the spotify_tracks table
// Version: 2026.08.16

package musicdb

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
)

// SpotifyTrack mirrors one row of the spotify_tracks table.
type SpotifyTrack struct {
	ID          int64   `json:"id"`
	SpotifyID   string  `json:"spotify_id"`
	Title       *string `json:"title"`
	Artist      *string `json:"artist"`
	Album       *string `json:"album"`
	Genre       *string `json:"genre"`
	Year        *int64  `json:"year"`
	Duration    *int64  `json:"duration"`
	ImageURL    *string `json:"image_url"`
	PreviewURL  *string `json:"preview_url"`
	SpotifyURI  *string `json:"spotify_uri"`
	Popularity  *int64  `json:"popularity"`
	AddedDate   *string `json:"added_date"`
	LastPlayed  *string `json:"last_played"`
	PlayCount   *int64  `json:"play_count"`
	IsAvailable *int64  `json:"is_available"`
	CreatedAt   *string `json:"created_at"`
	UpdatedAt   *string `json:"updated_at"`
}

const spotifyTrackColumns = `id, spotify_id, title, artist, album, genre, year,
	duration, image_url, preview_url, spotify_uri, popularity, added_date,
	last_played, play_count, is_available, created_at, updated_at`

func scanSpotifyTrack(scan func(dest ...any) error) (SpotifyTrack, error) {
	var t SpotifyTrack
	err := scan(
		&t.ID, &t.SpotifyID, &t.Title, &t.Artist, &t.Album, &t.Genre, &t.Year,
		&t.Duration, &t.ImageURL, &t.PreviewURL, &t.SpotifyURI, &t.Popularity,
		&t.AddedDate, &t.LastPlayed, &t.PlayCount, &t.IsAvailable,
		&t.CreatedAt, &t.UpdatedAt,
	)
	return t, err
}

// SpotifyTrackFilters mirrors the options getSpotifyTracks() accepted. Unlike
// the local track filters these compare case sensitively - that difference is
// in the original and is kept.
type SpotifyTrackFilters struct {
	Limit  string
	Offset string
	Search string
	Artist string
	Album  string
	Genre  string
	Year   string
}

// AddSpotifyTrack writes or replaces a Spotify track.
func (d *DB) AddSpotifyTrack(ctx context.Context, t SpotifyTrack) (int64, error) {
	const query = `INSERT OR REPLACE INTO spotify_tracks (
			spotify_id, title, artist, album, genre, year, duration,
			image_url, preview_url, spotify_uri, popularity, added_date, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`

	result, err := d.db.ExecContext(ctx, query,
		t.SpotifyID, t.Title, t.Artist, t.Album, t.Genre, t.Year, t.Duration,
		t.ImageURL, t.PreviewURL, t.SpotifyURI, t.Popularity, t.AddedDate,
	)
	if err != nil {
		return 0, fmt.Errorf("add spotify track: %w", err)
	}
	return result.LastInsertId()
}

// GetSpotifyTrack looks up one track by its Spotify id.
func (d *DB) GetSpotifyTrack(ctx context.Context, spotifyID string) (*SpotifyTrack, error) {
	row := d.read.QueryRowContext(ctx, "SELECT "+spotifyTrackColumns+" FROM spotify_tracks WHERE spotify_id = ?", spotifyID)
	track, err := scanSpotifyTrack(row.Scan)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get spotify track: %w", err)
	}
	return &track, nil
}

// GetSpotifyAlbumImage returns the cover Spotify holds for an album, empty when
// there is none. Used as the fallback of /api/album-cover: a title that only
// exists on Spotify has no file on disk and therefore no extracted cover, but
// it does carry an image url.
func (d *DB) GetSpotifyAlbumImage(ctx context.Context, artist, album string) (string, error) {
	const query = `SELECT image_url FROM spotify_tracks
		WHERE LOWER(artist) = LOWER(?) AND LOWER(album) = LOWER(?)
			AND image_url IS NOT NULL AND image_url != ''
		LIMIT 1`

	var image string
	err := d.read.QueryRowContext(ctx, query, artist, album).Scan(&image)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("get spotify album image: %w", err)
	}
	return image, nil
}

// GetSpotifyArtistImage returns one cover Spotify holds for an artist. The
// artist mosaic needs local files, so an artist that only exists on Spotify
// falls back to a single image instead.
func (d *DB) GetSpotifyArtistImage(ctx context.Context, artist string) (string, error) {
	const query = `SELECT image_url FROM spotify_tracks
		WHERE LOWER(artist) = LOWER(?) AND image_url IS NOT NULL AND image_url != ''
		ORDER BY play_count DESC, id
		LIMIT 1`

	var image string
	err := d.read.QueryRowContext(ctx, query, artist).Scan(&image)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("get spotify artist image: %w", err)
	}
	return image, nil
}

// GetSpotifyTracks lists Spotify tracks. LIMIT and OFFSET are always applied,
// defaulting to 50 and 0 like the original.
func (d *DB) GetSpotifyTracks(ctx context.Context, f SpotifyTrackFilters) ([]SpotifyTrack, error) {
	query := "SELECT " + spotifyTrackColumns + " FROM spotify_tracks WHERE 1=1"
	var params []any

	if f.Search != "" {
		query += " AND (title LIKE ? OR artist LIKE ? OR album LIKE ?)"
		term := "%" + f.Search + "%"
		params = append(params, term, term, term)
	}
	if f.Artist != "" {
		query += " AND artist LIKE ?"
		params = append(params, "%"+f.Artist+"%")
	}
	if f.Album != "" {
		query += " AND album LIKE ?"
		params = append(params, "%"+f.Album+"%")
	}
	if f.Genre != "" {
		query += " AND genre LIKE ?"
		params = append(params, "%"+f.Genre+"%")
	}
	if f.Year != "" {
		query += " AND year = ?"
		params = append(params, f.Year)
	}

	limit := f.Limit
	if limit == "" {
		limit = "50"
	}
	offset := f.Offset
	if offset == "" {
		offset = "0"
	}

	query += " ORDER BY popularity DESC, added_date DESC LIMIT ? OFFSET ?"
	params = append(params, limit, offset)

	rows, err := d.read.QueryContext(ctx, query, params...)
	if err != nil {
		return nil, fmt.Errorf("query spotify tracks: %w", err)
	}
	defer rows.Close()

	tracks := []SpotifyTrack{}
	for rows.Next() {
		track, err := scanSpotifyTrack(rows.Scan)
		if err != nil {
			return nil, fmt.Errorf("scan spotify track: %w", err)
		}
		tracks = append(tracks, track)
	}
	return tracks, rows.Err()
}

// RemoveSpotifyTrack deletes a Spotify track.
func (d *DB) RemoveSpotifyTrack(ctx context.Context, spotifyID string) (int64, error) {
	result, err := d.db.ExecContext(ctx, "DELETE FROM spotify_tracks WHERE spotify_id = ?", spotifyID)
	if err != nil {
		return 0, fmt.Errorf("remove spotify track: %w", err)
	}
	return result.RowsAffected()
}

// UpdateSpotifyTrackPlayCount increments the play counter of a Spotify track.
func (d *DB) UpdateSpotifyTrackPlayCount(ctx context.Context, spotifyID string) (int64, error) {
	const query = `UPDATE spotify_tracks
		SET play_count = play_count + 1,
			last_played = CURRENT_TIMESTAMP,
			updated_at = CURRENT_TIMESTAMP
		WHERE spotify_id = ?`

	result, err := d.db.ExecContext(ctx, query, spotifyID)
	if err != nil {
		return 0, fmt.Errorf("update spotify track play count: %w", err)
	}
	return result.RowsAffected()
}

// SetSpotifyTrackGenre fills in the genre of a track that has none. Rows added
// before the artist lookup existed, or added while nobody was logged in, catch
// up the next time the title is played.
//
// It never overwrites a genre that is already there - the auto learning writes
// the playlist name into that column, and that is the more deliberate label of
// the two.
func (d *DB) SetSpotifyTrackGenre(ctx context.Context, spotifyID, genre string) error {
	const query = `UPDATE spotify_tracks
		SET genre = ?, updated_at = CURRENT_TIMESTAMP
		WHERE spotify_id = ? AND (genre IS NULL OR genre = '')`

	if _, err := d.db.ExecContext(ctx, query, genre, spotifyID); err != nil {
		return fmt.Errorf("set spotify track genre: %w", err)
	}
	return nil
}

// SetSpotifyTrackImage fills in the cover of a track that has none, so the
// album views stop falling back to the default image. Like the genre it never
// overwrites a value that is already there.
func (d *DB) SetSpotifyTrackImage(ctx context.Context, spotifyID, imageURL string) error {
	const query = `UPDATE spotify_tracks
		SET image_url = ?, updated_at = CURRENT_TIMESTAMP
		WHERE spotify_id = ? AND (image_url IS NULL OR image_url = '')`

	if _, err := d.db.ExecContext(ctx, query, imageURL, spotifyID); err != nil {
		return fmt.Errorf("set spotify track image: %w", err)
	}
	return nil
}

// SpotifyStats is the result of getSpotifyStats().
type SpotifyStats struct {
	TotalTracks   int64    `json:"total_tracks"`
	UniqueArtists int64    `json:"unique_artists"`
	UniqueAlbums  int64    `json:"unique_albums"`
	AvgPopularity *float64 `json:"avg_popularity"`
	TotalPlays    *int64   `json:"total_plays"`
}

// GetSpotifyStats aggregates the Spotify track counters.
func (d *DB) GetSpotifyStats(ctx context.Context) (SpotifyStats, error) {
	const query = `SELECT
			COUNT(*) as total_tracks,
			COUNT(DISTINCT artist) as unique_artists,
			COUNT(DISTINCT album) as unique_albums,
			AVG(popularity) as avg_popularity,
			SUM(play_count) as total_plays
		FROM spotify_tracks`

	var s SpotifyStats
	err := d.read.QueryRowContext(ctx, query).Scan(
		&s.TotalTracks, &s.UniqueArtists, &s.UniqueAlbums, &s.AvgPopularity, &s.TotalPlays,
	)
	if err != nil {
		return s, fmt.Errorf("query spotify stats: %w", err)
	}
	return s, nil
}
