// cover.go
// Cover extraction from the ID3 tag and the folder cover fallback
// Version: 2026.08.13

package scanner

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"

	"github.com/Nigcra/nJukebox/internal/imaging"
)

const (
	// CoverSize is the edge length of the box a cover is scaled into.
	CoverSize = 500

	// CoverQuality is the JPEG quality of the written cover.
	CoverQuality = 85
)

// folderCoverNames is the fallback order of lib/music_scanner.js. It is not
// sorted and not extended - the first hit wins, so the order is part of the
// behaviour.
var folderCoverNames = []string{
	"folder.jpg", "cover.jpg", "album.jpg", "front.jpg",
	"folder.png", "cover.png", "album.png", "front.png",
}

// coverPaths returns the cover location for one music file: the path as it is
// stored in the database, relative to the project root, and the absolute path
// to write to.
//
// The relative path is built with filepath.Join, so it carries backslashes on
// Windows exactly like path.join did in Node (R7).
func (s *Scanner) coverPaths(musicFilePath string) (relative, absolute string, err error) {
	musicRelPath, err := filepath.Rel(s.musicDir, musicFilePath)
	if err != nil {
		return "", "", fmt.Errorf("relative cover path for %s: %w", musicFilePath, err)
	}

	coverDir := filepath.Join("data", "covers", filepath.Dir(musicRelPath))
	name := baseNameWithoutExt(musicFilePath) + "_cover.jpg"

	relative = filepath.Join(coverDir, name)
	return relative, filepath.Join(s.root, relative), nil
}

// extractCoverArt scales the embedded picture into the cover directory and
// returns the stored path. An empty result means the Node version returned
// null: the error was logged and the track ended up without a cover.
func (s *Scanner) extractCoverArt(musicFilePath string, picture []byte) string {
	relative, absolute, err := s.coverPaths(musicFilePath)
	if err != nil {
		s.logf("[SCANNER] Error extracting cover art: %v", err)
		return ""
	}

	encoded, err := imaging.FitJPEG(bytes.NewReader(picture), CoverSize, CoverSize, CoverQuality)
	if err != nil {
		s.logf("[SCANNER] Error extracting cover art: %v", err)
		return ""
	}

	if err := writeFile(absolute, encoded); err != nil {
		s.logf("[SCANNER] Error extracting cover art: %v", err)
		return ""
	}
	return relative
}

// findFolderCover looks for a cover file next to the music file and, on a hit,
// converts it into the cover directory. An empty result means no cover.
func (s *Scanner) findFolderCover(musicFilePath string) string {
	sourceDir := filepath.Dir(musicFilePath)

	for _, name := range folderCoverNames {
		candidate := filepath.Join(sourceDir, name)
		if !fileExists(candidate) {
			continue
		}

		relative, absolute, err := s.coverPaths(musicFilePath)
		if err != nil {
			s.logf("[SCANNER] Error finding folder cover: %v", err)
			return ""
		}

		source, err := os.Open(candidate)
		if err != nil {
			s.logf("[SCANNER] Error finding folder cover: %v", err)
			return ""
		}

		encoded, err := imaging.FitJPEG(source, CoverSize, CoverSize, CoverQuality)
		source.Close()
		if err != nil {
			s.logf("[SCANNER] Error finding folder cover: %v", err)
			return ""
		}

		if err := writeFile(absolute, encoded); err != nil {
			s.logf("[SCANNER] Error finding folder cover: %v", err)
			return ""
		}
		return relative
	}

	return ""
}

// writeFile creates the parent directory and writes the file, the Go
// equivalent of fs.ensureDir plus sharp's toFile.
func writeFile(path string, data []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("create cover directory: %w", err)
	}
	if err := os.WriteFile(path, data, 0o644); err != nil {
		return fmt.Errorf("write cover %s: %w", path, err)
	}
	return nil
}

// fileExists is fs.pathExists: a directory counts as existing there as well.
func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}
