// Definitive list of valid music genres
// Only tracks with exactly these genres will be categorized accordingly
// All others will be classified as "Unknown"

const VALID_GENRES = [
  // Electronic/Dance
  'Electronic', 'Dance', 'House', 'Techno', 'Trance', 'Dubstep', 'EDM', 'Electro',
  'Progressive House', 'Deep House', 'Tech House', 'Minimal', 'Ambient', 'Drum & Bass',
  'Jungle', 'Breakbeat', 'Hardcore', 'Hardstyle', 'Gabber', 'IDM', 'Downtempo',
  'Chillout', 'Lounge', 'Trip Hop', 'Synthwave', 'Synthpop', 'New Wave',
  
  // Pop
  'Pop', 'Dance Pop', 'Synth Pop', 'Electropop', 'Teen Pop', 'Adult Contemporary',
  'Contemporary R&B', 'Europop', 'J-Pop', 'K-Pop', 'Latin Pop', 'Ballad',
  
  // Rock
  'Rock', 'Hard Rock', 'Soft Rock', 'Classic Rock', 'Alternative Rock', 'Indie Rock',
  'Progressive Rock', 'Psychedelic Rock', 'Punk Rock', 'Post-Punk', 'New Wave',
  'Grunge', 'Metal', 'Heavy Metal', 'Death Metal', 'Black Metal', 'Power Metal',
  'Thrash Metal', 'Folk Rock', 'Country Rock', 'Southern Rock', 'Blues Rock',
  
  // Hip-Hop/Rap
  'Hip Hop', 'Hip-Hop', 'Rap', 'Gangsta Rap', 'East Coast Hip Hop', 'West Coast Hip Hop',
  'Southern Hip Hop', 'Trap', 'Conscious Hip Hop', 'Alternative Hip Hop', 'Old School Hip Hop',
  'Boom Bap', 'Crunk', 'Grime', 'UK Hip Hop', 'German Rap', 'Deutschrap', 'French Rap',
  
  // R&B/Soul/Funk
  'R&B', 'Soul', 'Funk', 'Disco', 'Motown', 'Neo-Soul', 'Contemporary R&B',
  'Classic Soul', 'Northern Soul', 'Gospel', 'Blues', 'Rhythm & Blues',
  
  // Country/Folk
  'Country', 'Country Pop', 'Country Rock', 'Bluegrass', 'Folk', 'Folk Rock',
  'Americana', 'Alt-Country', 'Honky Tonk', 'Western', 'Celtic', 'Traditional',
  
  // Jazz
  'Jazz', 'Smooth Jazz', 'Bebop', 'Cool Jazz', 'Free Jazz', 'Fusion', 'Swing',
  'Big Band', 'Dixieland', 'Contemporary Jazz', 'Acid Jazz', 'Nu Jazz',
  
  // Classical/Instrumental
  'Classical', 'Baroque', 'Romantic', 'Modern Classical', 'Orchestral', 'Chamber Music',
  'Opera', 'Instrumental', 'Soundtrack', 'Score', 'New Age', 'Meditation',
  
  // World Music
  'World', 'World Music', 'Latin', 'Salsa', 'Reggaeton', 'Bachata', 'Merengue',
  'Bossa Nova', 'Samba', 'Tango', 'Flamenco', 'Reggae', 'Dancehall', 'Ska',
  'Afrobeat', 'Highlife', 'Soukous', 'Bhangra', 'Bollywood', 'Arabic', 'Turkish',
  'Greek', 'Russian', 'French', 'Italian', 'Spanish', 'Portuguese', 'German',
  
  // Alternative/Indie
  'Alternative', 'Indie', 'Indie Pop', 'Indie Rock', 'Alternative Rock', 'Shoegaze',
  'Dream Pop', 'Post-Rock', 'Math Rock', 'Emo', 'Screamo', 'Hardcore', 'Metalcore',
  
  // Era/Style Descriptors (not decades)
  'Oldies', 'Retro', 'Vintage',
  
  // Miscellaneous
  'Easy Listening', 'Smooth', 'Chill', 'Acoustic', 'Live', 'Unplugged',
  'Cover', 'Remix', 'Compilation', 'Christmas', 'Holiday', 'Seasonal',
  'Experimental', 'Avant-Garde', 'Noise', 'Industrial', 'Gothic'
];

// Function to normalize and validate genre
function validateGenre(rawGenre) {
  if (!rawGenre || typeof rawGenre !== 'string') {
    return null;
  }
  
  // Clean the genre string
  let cleanGenre = rawGenre.trim();
  
  // Remove common prefixes/suffixes that aren't part of the genre
  const cleanPatterns = [
    /^genre:\s*/i,
    /\s*music$/i,
    /\s*\d{4}$/,  // Remove years like "Pop 2023"
    /\s*\(\d+\)$/  // Remove numbers in parentheses
  ];
  
  cleanPatterns.forEach(pattern => {
    cleanGenre = cleanGenre.replace(pattern, '');
  });
  
  // Trim again after cleaning
  cleanGenre = cleanGenre.trim();
  
  // Check for exact match (case insensitive)
  const matchedGenre = VALID_GENRES.find(validGenre => 
    validGenre.toLowerCase() === cleanGenre.toLowerCase()
  );
  
  return matchedGenre || null;
}

// Function to process multiple genres (from tags that might have multiple values)
function validateGenres(rawGenres) {
  if (!rawGenres) return null;
  
  let genreArray = [];
  
  // Handle different input types
  if (Array.isArray(rawGenres)) {
    genreArray = rawGenres;
  } else if (typeof rawGenres === 'string') {
    // Split by common separators
    genreArray = rawGenres.split(/[,;\/&+]/).map(g => g.trim());
  }
  
  // Validate each genre
  const validGenres = genreArray
    .map(genre => validateGenre(genre))
    .filter(genre => genre !== null);
  
  // Return the first valid genre found, or null if none
  return validGenres.length > 0 ? validGenres[0] : null;
}

module.exports = {
  VALID_GENRES,
  validateGenre,
  validateGenres
};
