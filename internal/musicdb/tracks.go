// tracks.go
// Track, artist, album and genre queries against music.db
// Version: 2026.08.16

package musicdb

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
)

// Track mirrors one row of the tracks table. Every nullable column is a
// pointer and no field carries omitempty: the Node driver sent missing values
// as null and the frontend checks for their presence (R2).
type Track struct {
	ID          int64    `json:"id"`
	FilePath    string   `json:"file_path"`
	FileSize    *int64   `json:"file_size"`
	FileMtime   *int64   `json:"file_mtime"`
	Title       *string  `json:"title"`
	Artist      *string  `json:"artist"`
	Album       *string  `json:"album"`
	AlbumArtist *string  `json:"album_artist"`
	Genre       *string  `json:"genre"`
	Year        *int64   `json:"year"`
	TrackNumber *int64   `json:"track_number"`
	DiscNumber  *int64   `json:"disc_number"`
	Duration    *float64 `json:"duration"`
	Bitrate     *int64   `json:"bitrate"`
	Format      *string  `json:"format"`
	CoverPath   *string  `json:"cover_path"`
	HasCover    *int64   `json:"has_cover"`
	PlayCount   *int64   `json:"play_count"`
	LastPlayed  *string  `json:"last_played"`
	CreatedAt   *string  `json:"created_at"`
	UpdatedAt   *string  `json:"updated_at"`

	// Set only on rows that come from spotify_tracks, null for local files. The
	// frontend already keys off uri to route playback through the Spotify SDK
	// instead of /api/stream, and off type/source for the cover.
	Source   *string `json:"source"`
	URI      *string `json:"uri"`
	Type     *string `json:"type"`
	ImageURL *string `json:"image_url"`
}

// trackColumns lists the columns in table order, which is the order SELECT *
// produced in the Node implementation.
const trackColumns = `id, file_path, file_size, file_mtime, title, artist, album,
	album_artist, genre, year, track_number, disc_number, duration, bitrate,
	format, cover_path, has_cover, play_count, last_played, created_at, updated_at`

func scanTrack(scan func(dest ...any) error) (Track, error) {
	var t Track
	err := scan(
		&t.ID, &t.FilePath, &t.FileSize, &t.FileMtime, &t.Title, &t.Artist,
		&t.Album, &t.AlbumArtist, &t.Genre, &t.Year, &t.TrackNumber,
		&t.DiscNumber, &t.Duration, &t.Bitrate, &t.Format, &t.CoverPath,
		&t.HasCover, &t.PlayCount, &t.LastPlayed, &t.CreatedAt, &t.UpdatedAt,
	)
	return t, err
}

// The library views span both sources: files the scanner found and Spotify
// titles that were played or learned. Both tables carry the same descriptive
// columns, so artists, albums and genres can be counted across them.
//
// UNION ALL rather than UNION: a title held locally and on Spotify counts twice,
// exactly as two copies of the same file always did. Anything that needs a file
// on disk - streaming, covers, the scanner - stays on the tracks table alone.
const (
	libraryArtists = `
		SELECT artist FROM tracks WHERE artist IS NOT NULL AND artist != ''
		UNION ALL
		SELECT artist FROM spotify_tracks WHERE artist IS NOT NULL AND artist != ''`

	libraryAlbums = `
		SELECT album, artist, year FROM tracks WHERE album IS NOT NULL AND album != ''
		UNION ALL
		SELECT album, artist, year FROM spotify_tracks WHERE album IS NOT NULL AND album != ''`

	libraryGenres = `
		SELECT genre FROM tracks WHERE genre IS NOT NULL AND genre != ''
		UNION ALL
		SELECT genre FROM spotify_tracks WHERE genre IS NOT NULL AND genre != ''`

	// Spotify ids are negated so they can never collide with a local track id.
	// GetTrackByID resolves them through this same union, because the frontend
	// reloads a track by id before playing it. Columns a Spotify row cannot fill
	// stay NULL, exactly as they do for a local file whose tag is missing.
	libraryTracks = `
		SELECT id, file_path, file_size, file_mtime, title, artist, album,
			album_artist, genre, year, track_number, disc_number, duration, bitrate,
			format, cover_path, has_cover, play_count, last_played, created_at,
			updated_at, NULL as source, NULL as uri, NULL as type, NULL as image_url
		FROM tracks
		UNION ALL
		SELECT -id, 'spotify:track:' || spotify_id, NULL, NULL, title, artist, album,
			NULL, genre, year, NULL, NULL, duration, NULL,
			NULL, NULL, 0, play_count, last_played, created_at,
			updated_at, 'spotify', 'spotify:track:' || spotify_id, 'spotify', image_url
		FROM spotify_tracks`
)

// libraryTrackColumns names the columns of the libraryTracks union in order.
const libraryTrackColumns = trackColumns + `, source, uri, type, image_url`

func scanLibraryTrack(scan func(dest ...any) error) (Track, error) {
	var t Track
	err := scan(
		&t.ID, &t.FilePath, &t.FileSize, &t.FileMtime, &t.Title, &t.Artist,
		&t.Album, &t.AlbumArtist, &t.Genre, &t.Year, &t.TrackNumber,
		&t.DiscNumber, &t.Duration, &t.Bitrate, &t.Format, &t.CoverPath,
		&t.HasCover, &t.PlayCount, &t.LastPlayed, &t.CreatedAt, &t.UpdatedAt,
		&t.Source, &t.URI, &t.Type, &t.ImageURL,
	)
	return t, err
}

// TrackFilters mirrors the filters getTracks() accepted.
type TrackFilters struct {
	Artist string
	Album  string
	Genre  string
	Year   string
	Search string
	Limit  string
	Offset string
}

// GetTracks reproduces getTracks() including the "WHERE 1=1" pattern, the LIKE
// wrapping and the rule that OFFSET is only appended when a LIMIT is present.
func (d *DB) GetTracks(ctx context.Context, f TrackFilters) ([]Track, error) {
	query := "SELECT " + libraryTrackColumns + " FROM (" + libraryTracks + ") WHERE 1=1"
	var params []any

	if f.Artist != "" {
		query += " AND LOWER(artist) LIKE LOWER(?)"
		params = append(params, "%"+f.Artist+"%")
	}
	if f.Album != "" {
		query += " AND LOWER(album) LIKE LOWER(?)"
		params = append(params, "%"+f.Album+"%")
	}
	if f.Genre != "" {
		query += " AND LOWER(genre) LIKE LOWER(?)"
		params = append(params, "%"+f.Genre+"%")
	}
	if f.Year != "" {
		query += " AND year = ?"
		params = append(params, f.Year)
	}
	if f.Search != "" {
		query += " AND (LOWER(title) LIKE LOWER(?) OR LOWER(artist) LIKE LOWER(?) OR LOWER(album) LIKE LOWER(?))"
		term := "%" + f.Search + "%"
		params = append(params, term, term, term)
	}

	query += " ORDER BY LOWER(artist), LOWER(album), track_number, LOWER(title)"

	if f.Limit != "" {
		query += " LIMIT ?"
		params = append(params, f.Limit)

		if f.Offset != "" {
			query += " OFFSET ?"
			params = append(params, f.Offset)
		}
	}

	rows, err := d.read.QueryContext(ctx, query, params...)
	if err != nil {
		return nil, fmt.Errorf("query tracks: %w", err)
	}
	defer rows.Close()

	tracks := []Track{}
	for rows.Next() {
		track, err := scanLibraryTrack(rows.Scan)
		if err != nil {
			return nil, fmt.Errorf("scan track: %w", err)
		}
		tracks = append(tracks, track)
	}
	return tracks, rows.Err()
}

// GetTrackByID returns the track or nil when it does not exist.
//
// This goes through the library union rather than the tracks table alone: the
// frontend reloads a track by id before it plays it, and a Spotify row picked
// from the artist, album or genre view carries a negative id. Answering those
// with a 404 left the title unplayable everywhere outside the search.
func (d *DB) GetTrackByID(ctx context.Context, id string) (*Track, error) {
	// CAST is needed because the id arrives as a string from the URL. Selecting
	// from the union drops the column affinity that would otherwise convert it,
	// and SQLite would compare '-66' as text against -66 as a number.
	row := d.read.QueryRowContext(ctx,
		"SELECT "+libraryTrackColumns+" FROM ("+libraryTracks+") WHERE id = CAST(? AS INTEGER)", id)
	track, err := scanLibraryTrack(row.Scan)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get track by id: %w", err)
	}
	return &track, nil
}

// GetTrackByPath returns the track or nil when it does not exist.
func (d *DB) GetTrackByPath(ctx context.Context, filePath string) (*Track, error) {
	row := d.read.QueryRowContext(ctx, "SELECT "+trackColumns+" FROM tracks WHERE file_path = ?", filePath)
	track, err := scanTrack(row.Scan)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get track by path: %w", err)
	}
	return &track, nil
}

// GetTrackWithCover finds one track of an album that has a cover on disk.
func (d *DB) GetTrackWithCover(ctx context.Context, artist, album string) (*Track, error) {
	const query = `SELECT ` + trackColumns + ` FROM tracks
		WHERE LOWER(artist) = LOWER(?)
		AND LOWER(album) = LOWER(?)
		AND has_cover = 1
		AND cover_path IS NOT NULL
		LIMIT 1`

	row := d.read.QueryRowContext(ctx, query, artist, album)
	track, err := scanTrack(row.Scan)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get track with cover: %w", err)
	}
	return &track, nil
}

// AlbumCover is one row of getArtistAlbumCovers().
type AlbumCover struct {
	Album     *string `json:"album"`
	CoverPath *string `json:"cover_path"`
	HasCover  *int64  `json:"has_cover"`
}

// GetArtistAlbumCovers lists the distinct album covers of one artist, used to
// build the artist mosaic.
func (d *DB) GetArtistAlbumCovers(ctx context.Context, artist string) ([]AlbumCover, error) {
	const query = `SELECT DISTINCT album, cover_path, has_cover
		FROM tracks
		WHERE LOWER(artist) = LOWER(?)
		AND has_cover = 1
		AND cover_path IS NOT NULL
		ORDER BY album`

	rows, err := d.read.QueryContext(ctx, query, artist)
	if err != nil {
		return nil, fmt.Errorf("query artist album covers: %w", err)
	}
	defer rows.Close()

	covers := []AlbumCover{}
	for rows.Next() {
		var c AlbumCover
		if err := rows.Scan(&c.Album, &c.CoverPath, &c.HasCover); err != nil {
			return nil, fmt.Errorf("scan artist album cover: %w", err)
		}
		covers = append(covers, c)
	}
	return covers, rows.Err()
}

// Artist is one row of getArtists().
type Artist struct {
	Artist     string `json:"artist"`
	TrackCount int64  `json:"track_count"`
}

// GetArtists reproduces the two stage deduplication of getArtists(): artists
// are grouped case insensitively, but the spelling shown is the one that occurs
// most often. Deliberately kept as two queries - the aggregate cannot pick the
// dominant spelling on its own.
//
// SQLite's LOWER() is ASCII only, so umlauts do not fold. That is intentional
// (R6): fixing it would regroup artists and shift the layout.
func (d *DB) GetArtists(ctx context.Context) ([]Artist, error) {
	const detailQuery = `SELECT artist, COUNT(*) as count
		FROM (` + libraryArtists + `)
		GROUP BY artist
		ORDER BY COUNT(*) DESC`

	const aggregateQuery = `SELECT
			LOWER(artist) as lower_artist,
			COUNT(*) as track_count
		FROM (` + libraryArtists + `)
		GROUP BY LOWER(artist)
		ORDER BY LOWER(artist)`

	type spelling struct {
		artist string
		count  int64
	}

	detailRows, err := d.read.QueryContext(ctx, detailQuery)
	if err != nil {
		return nil, fmt.Errorf("query artist spellings: %w", err)
	}
	defer detailRows.Close()

	dominant := make(map[string]spelling)
	for detailRows.Next() {
		var s spelling
		if err := detailRows.Scan(&s.artist, &s.count); err != nil {
			return nil, fmt.Errorf("scan artist spelling: %w", err)
		}
		// Strictly less than, so the first row of a tie wins - same as the
		// JavaScript version iterating the result in query order.
		key := strings.ToLower(s.artist)
		if existing, ok := dominant[key]; !ok || existing.count < s.count {
			dominant[key] = s
		}
	}
	if err := detailRows.Err(); err != nil {
		return nil, err
	}

	aggRows, err := d.read.QueryContext(ctx, aggregateQuery)
	if err != nil {
		return nil, fmt.Errorf("query artist counts: %w", err)
	}
	defer aggRows.Close()

	artists := []Artist{}
	for aggRows.Next() {
		var (
			lowerArtist string
			trackCount  int64
		)
		if err := aggRows.Scan(&lowerArtist, &trackCount); err != nil {
			return nil, fmt.Errorf("scan artist count: %w", err)
		}

		name := lowerArtist
		if s, ok := dominant[lowerArtist]; ok {
			name = s.artist
		}
		artists = append(artists, Artist{Artist: name, TrackCount: trackCount})
	}
	return artists, aggRows.Err()
}

// Album is one row of getAlbums().
type Album struct {
	Album      *string `json:"album"`
	Artist     *string `json:"artist"`
	TrackCount int64   `json:"track_count"`
	Year       *int64  `json:"year"`
}

// GetAlbums lists albums, optionally restricted to one artist.
func (d *DB) GetAlbums(ctx context.Context, artist string) ([]Album, error) {
	query := `SELECT album, artist, COUNT(*) as track_count, MIN(year) as year
		FROM (` + libraryAlbums + `)`
	var params []any

	if artist != "" {
		query += " WHERE LOWER(artist) = LOWER(?)"
		params = append(params, artist)
	}

	query += " GROUP BY LOWER(album), LOWER(artist) ORDER BY LOWER(artist), year, LOWER(album)"

	rows, err := d.read.QueryContext(ctx, query, params...)
	if err != nil {
		return nil, fmt.Errorf("query albums: %w", err)
	}
	defer rows.Close()

	albums := []Album{}
	for rows.Next() {
		var a Album
		if err := rows.Scan(&a.Album, &a.Artist, &a.TrackCount, &a.Year); err != nil {
			return nil, fmt.Errorf("scan album: %w", err)
		}
		albums = append(albums, a)
	}
	return albums, rows.Err()
}

// Genre is one row of getGenres().
type Genre struct {
	Genre      *string `json:"genre"`
	TrackCount int64   `json:"track_count"`
}

// GetGenres lists the genres present in the library.
func (d *DB) GetGenres(ctx context.Context) ([]Genre, error) {
	const query = `SELECT genre, COUNT(*) as track_count
		FROM (` + libraryGenres + `)
		GROUP BY genre
		ORDER BY genre`

	rows, err := d.read.QueryContext(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("query genres: %w", err)
	}
	defer rows.Close()

	genres := []Genre{}
	for rows.Next() {
		var g Genre
		if err := rows.Scan(&g.Genre, &g.TrackCount); err != nil {
			return nil, fmt.Errorf("scan genre: %w", err)
		}
		genres = append(genres, g)
	}
	return genres, rows.Err()
}

// Stats is the result of getStats().
type Stats struct {
	TotalTracks   int64    `json:"total_tracks"`
	TotalArtists  int64    `json:"total_artists"`
	TotalAlbums   int64    `json:"total_albums"`
	TotalGenres   int64    `json:"total_genres"`
	TotalDuration *float64 `json:"total_duration"`
	AverageYear   *float64 `json:"average_year"`
	OldestYear    *int64   `json:"oldest_year"`
	NewestYear    *int64   `json:"newest_year"`
}

// GetStats aggregates the library counters.
func (d *DB) GetStats(ctx context.Context) (Stats, error) {
	const query = `SELECT
			COUNT(*) as total_tracks,
			COUNT(DISTINCT artist) as total_artists,
			COUNT(DISTINCT album) as total_albums,
			COUNT(DISTINCT genre) as total_genres,
			SUM(duration) as total_duration,
			AVG(year) as average_year,
			MIN(year) as oldest_year,
			MAX(year) as newest_year
		FROM tracks`

	var s Stats
	err := d.read.QueryRowContext(ctx, query).Scan(
		&s.TotalTracks, &s.TotalArtists, &s.TotalAlbums, &s.TotalGenres,
		&s.TotalDuration, &s.AverageYear, &s.OldestYear, &s.NewestYear,
	)
	if err != nil {
		return s, fmt.Errorf("query stats: %w", err)
	}
	return s, nil
}

// InsertTrack writes or replaces a track row and returns its id.
func (d *DB) InsertTrack(ctx context.Context, exec Execer, t Track) (int64, error) {
	const query = `INSERT OR REPLACE INTO tracks (
			file_path, file_size, file_mtime, title, artist, album, album_artist,
			genre, year, track_number, disc_number, duration, bitrate, format,
			cover_path, has_cover, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`

	hasCover := int64(0)
	if t.HasCover != nil && *t.HasCover != 0 {
		hasCover = 1
	}

	result, err := exec.ExecContext(ctx, query,
		t.FilePath, t.FileSize, t.FileMtime, t.Title, t.Artist, t.Album,
		t.AlbumArtist, t.Genre, t.Year, t.TrackNumber, t.DiscNumber,
		t.Duration, t.Bitrate, t.Format, t.CoverPath, hasCover,
	)
	if err != nil {
		return 0, fmt.Errorf("insert track: %w", err)
	}
	return result.LastInsertId()
}

// RemoveTrack deletes a track by id and returns the number of affected rows.
func (d *DB) RemoveTrack(ctx context.Context, id int64) (int64, error) {
	result, err := d.db.ExecContext(ctx, "DELETE FROM tracks WHERE id = ?", id)
	if err != nil {
		return 0, fmt.Errorf("remove track: %w", err)
	}
	return result.RowsAffected()
}

// RemoveTrackByPath deletes a track by file path.
func (d *DB) RemoveTrackByPath(ctx context.Context, filePath string) (int64, error) {
	result, err := d.db.ExecContext(ctx, "DELETE FROM tracks WHERE file_path = ?", filePath)
	if err != nil {
		return 0, fmt.Errorf("remove track by path: %w", err)
	}
	return result.RowsAffected()
}

// UpdateTrackPlayCount increments the play counter of a local track.
func (d *DB) UpdateTrackPlayCount(ctx context.Context, id string) (int64, error) {
	const query = `UPDATE tracks
		SET play_count = play_count + 1,
			last_played = CURRENT_TIMESTAMP,
			updated_at = CURRENT_TIMESTAMP
		WHERE id = ?`

	result, err := d.db.ExecContext(ctx, query, id)
	if err != nil {
		return 0, fmt.Errorf("update track play count: %w", err)
	}
	return result.RowsAffected()
}

// CleanupOrphans removes cover rows whose album no longer has any track.
func (d *DB) CleanupOrphans(ctx context.Context) (int64, error) {
	const query = `DELETE FROM covers WHERE album_key NOT IN (
			SELECT DISTINCT LOWER(artist) || '||' || LOWER(album)
			FROM tracks
			WHERE artist IS NOT NULL AND album IS NOT NULL
		)`

	result, err := d.db.ExecContext(ctx, query)
	if err != nil {
		return 0, fmt.Errorf("cleanup orphaned covers: %w", err)
	}
	return result.RowsAffected()
}

// ClearDatabase empties the library tables and resets their auto increment
// counters. Admin function.
func (d *DB) ClearDatabase(ctx context.Context) error {
	const statements = `
		DELETE FROM tracks;
		DELETE FROM spotify_tracks;
		DELETE FROM covers;
		DELETE FROM custom_playlists;
		UPDATE sqlite_sequence SET seq = 0 WHERE name IN ('tracks', 'spotify_tracks', 'covers', 'custom_playlists');
	`
	if _, err := d.db.ExecContext(ctx, statements); err != nil {
		return fmt.Errorf("clear database: %w", err)
	}
	return nil
}

// Cover is one row of the covers table.
type Cover struct {
	ID        int64   `json:"id"`
	AlbumKey  string  `json:"album_key"`
	CoverPath string  `json:"cover_path"`
	Width     *int64  `json:"width"`
	Height    *int64  `json:"height"`
	Format    *string `json:"format"`
	CreatedAt *string `json:"created_at"`
}

// InsertCover writes or replaces a cover entry.
func (d *DB) InsertCover(ctx context.Context, exec Execer, albumKey, coverPath string, width, height *int64, format *string) (int64, error) {
	const query = `INSERT OR REPLACE INTO covers (album_key, cover_path, width, height, format)
		VALUES (?, ?, ?, ?, ?)`

	result, err := exec.ExecContext(ctx, query, albumKey, coverPath, width, height, format)
	if err != nil {
		return 0, fmt.Errorf("insert cover: %w", err)
	}
	return result.LastInsertId()
}

// GetCover looks up a cover by album key.
func (d *DB) GetCover(ctx context.Context, albumKey string) (*Cover, error) {
	const query = `SELECT id, album_key, cover_path, width, height, format, created_at
		FROM covers WHERE album_key = ?`

	var c Cover
	err := d.read.QueryRowContext(ctx, query, albumKey).Scan(
		&c.ID, &c.AlbumKey, &c.CoverPath, &c.Width, &c.Height, &c.Format, &c.CreatedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get cover: %w", err)
	}
	return &c, nil
}

// Execer accepts both *sql.DB and *sql.Tx, so the scanner can run its inserts
// inside one transaction.
type Execer interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}

// Exec returns the database itself as an Execer for callers without a
// transaction.
func (d *DB) Exec() Execer { return d.db }
