const fs = require('fs-extra');
const path = require('path');
const chokidar = require('chokidar');
// PKG Bugfix: Dynamic import for music-metadata ES module
let parseFile;
const sharp = require('sharp');
const { execSync } = require('child_process');
const ffprobeStatic = require('ffprobe-static');
const ffprobePath = ffprobeStatic.path;
const { validateGenres } = require('./valid_genres');

class MusicScanner {
  constructor(musicDir, database) {
    this.musicDir = musicDir;
    this.db = database;
    this.watcher = null;
    this.supportedFormats = ['.mp3']; // Only support MP3 files
    this.scanning = false;
    this.musicMetadataLoaded = false;
  }

  // PKG Bugfix: Dynamic loader for music-metadata ES module
  async loadMusicMetadata() {
    if (this.musicMetadataLoaded) return;
    
    try {
      // Try different loading methods for PKG compatibility
      if (typeof __dirname !== 'undefined' && __dirname.includes('snapshot')) {
        // We're in PKG environment - try to load from filesystem
        const musicMetadataPath = require.resolve('music-metadata/lib/index.js');
        const musicMetadata = require(musicMetadataPath);
        parseFile = musicMetadata.parseFile || musicMetadata.default?.parseFile;
      } else {
        // Normal Node.js environment
        const musicMetadata = require('music-metadata');
        parseFile = musicMetadata.parseFile;
      }
      
      if (!parseFile) {
        throw new Error('parseFile function not found in music-metadata');
      }
      
      this.musicMetadataLoaded = true;
      console.log('[SCANNER] ✅ music-metadata loaded successfully');
    } catch (error) {
      console.error('❌ Failed to load music-metadata:', error.message);
      // Fallback: disable metadata parsing
      parseFile = async () => ({ common: {}, format: {} });
    }
  }

  async init() {
    console.log(`🔍 Music Scanner initialized for: ${this.musicDir}`);
    
    // PKG Bugfix: Load music-metadata dynamically
    await this.loadMusicMetadata();
    await this.setupWatcher();
  }

  async setupWatcher() {
    // Watch for file changes
    this.watcher = chokidar.watch(this.musicDir, {
      ignored: /(^|[\/\\])\../, // ignore dotfiles
      persistent: true,
      ignoreInitial: true
    });

    this.watcher
      .on('add', async (filePath) => {
        if (this.isSupportedFormat(filePath)) {
          console.log(`➕ New file detected: ${filePath}`);
          await this.scanFile(filePath);
        }
      })
      .on('change', async (filePath) => {
        if (this.isSupportedFormat(filePath)) {
          console.log(`🔄 File changed: ${filePath}`);
          await this.scanFile(filePath);
        }
      })
      .on('unlink', async (filePath) => {
        if (this.isSupportedFormat(filePath)) {
          console.log(`➖ File removed: ${filePath}`);
          await this.db.removeTrack(filePath);
        }
      });

    console.log('[SCANNER] 👁️  File watcher started');
  }

  isSupportedFormat(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return this.supportedFormats.includes(ext);
  }

  async scanAll() {
    if (this.scanning) {
      console.log('[SCANNER] ⏳ Scan already in progress...');
      return;
    }

    this.scanning = true;
    console.log('[SCANNER] 🔍 Starting full music library scan...');

    try {
      const files = await this.findMusicFiles(this.musicDir);
      console.log(`[SCANNER] 📁 Found ${files.length} music files`);

      let processed = 0;
      let errors = 0;
      const concurrency = 20; // Process 20 files in parallel
      const transactionSize = 100; // Commit every 100 files instead of every batch
      
      // Start a transaction for multiple batches
      await this.db.beginTransaction();
      let filesInTransaction = 0;
      
      // Process files in batches for parallel execution
      for (let i = 0; i < files.length; i += concurrency) {
        const batch = files.slice(i, i + concurrency);
        
        // Pre-fetch existing tracks for this batch (avoid DB locks during parallel processing)
        const existingTracksMap = new Map();
        for (const file of batch) {
          try {
            const existing = await this.db.getTrackByPath(file);
            if (existing) {
              existingTracksMap.set(file, existing);
            }
          } catch (err) {
            // Continue if lookup fails
          }
        }
        
        try {
          const results = await Promise.allSettled(
            batch.map(file => this.scanFile(file, existingTracksMap.get(file)))
          );
          
          results.forEach((result, index) => {
            if (result.status === 'fulfilled') {
              processed++;
              filesInTransaction++;
            } else {
              console.error(`❌ Error processing ${path.basename(batch[index])}:`, result.reason?.message || result.reason);
              errors++;
            }
          });
          
          // Commit transaction every transactionSize files
          if (filesInTransaction >= transactionSize || i + concurrency >= files.length) {
            await this.db.commitTransaction();
            filesInTransaction = 0;
            // Start new transaction if there are more files
            if (i + concurrency < files.length) {
              await this.db.beginTransaction();
            }
          }
          
          if (processed % 50 === 0 || i + concurrency >= files.length) {
            console.log(`📊 Progress: ${processed}/${files.length} files processed, ${errors} errors`);
          }
        } catch (batchError) {
          // Rollback on error
          await this.db.rollbackTransaction();
          console.error('❌ Batch error, rolling back:', batchError.message);
          // Restart transaction
          await this.db.beginTransaction();
          filesInTransaction = 0;
        }
      }

      console.log(`[SCANNER] ✅ Scan completed: ${processed} processed, ${errors} errors`);
    } catch (error) {
      console.error('❌ Full scan failed:', error);
    } finally {
      this.scanning = false;
    }
  }

  async findMusicFiles(dir) {
    const files = [];
    
    async function walk(currentDir) {
      const entries = await fs.readdir(currentDir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        
        if (entry.isDirectory()) {
          await walk(fullPath);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (['.mp3'].includes(ext)) { // Only support MP3 files
            files.push(fullPath);
          }
        }
      }
    }
    
    await walk(dir);
    return files;
  }

  async scanFile(filePath, existingTrack = null) {
    try {
      const stats = await fs.stat(filePath);
      
      // Check if file was already processed and hasn't changed (use pre-fetched data if available)
      if (!existingTrack) {
        existingTrack = await this.db.getTrackByPath(filePath);
      }
      if (existingTrack && existingTrack.file_mtime === stats.mtime.getTime()) {
        return; // Skip unchanged files
      }

      console.log(`🎵 Processing: ${path.basename(filePath)}`);
      
      // Parse metadata with error handling
      let metadata = null;
      let common = {};
      
      try {
        metadata = await parseFile(filePath);
        common = metadata.common || {};
      } catch (metadataError) {
        console.warn(`⚠️  Metadata error for ${path.basename(filePath)}: ${metadataError.message}`);
        
        // Try ffprobe as fallback
        try {
          console.log(`🔄 Trying ffprobe fallback for: ${path.basename(filePath)}`);
          const ffprobeData = await this.parseWithFfprobe(filePath);
          common = ffprobeData.common;
          metadata = ffprobeData.metadata;
        } catch (ffprobeError) {
          console.warn(`⚠️  FFprobe also failed: ${ffprobeError.message}`);
          console.log(`📄 Using filename-based fallback for: ${path.basename(filePath)}`);
          
          // Create fallback metadata from filename and basic file info
          const basename = path.basename(filePath, path.extname(filePath));
          common = {
            title: basename,
            artist: 'Unknown Artist',
            album: 'Unknown Album'
          };
          metadata = {
            format: {
              container: path.extname(filePath).slice(1).toLowerCase(),
              duration: null,
              bitrate: null
            }
          };
        }
      }
      
      // Extract cover art with error handling
      let coverPath = null;
      let hasCover = false;
      
      console.log(`🔍 Processing cover for: ${path.basename(filePath)}`);
      
      try {
        if (common.picture && common.picture.length > 0) {
          console.log(`🖼️  Found embedded cover for: ${path.basename(filePath)}`);
          coverPath = await this.extractCoverArt(filePath, common.picture[0]);
          if (coverPath) {
            hasCover = true;
            console.log(`✅ Extracted cover for: ${path.basename(filePath)} -> ${coverPath}`);
          } else {
            console.log(`❌ Failed to extract cover for: ${path.basename(filePath)}`);
          }
        } else {
          // If no embedded cover, look for folder-based cover art
          console.log(`🔍 No embedded cover found for ${path.basename(filePath)}, searching for folder cover...`);
          coverPath = await this.findFolderCover(filePath);
          if (coverPath) {
            hasCover = true;
            console.log(`✅ Found folder cover for ${path.basename(filePath)}: ${path.basename(coverPath)}`);
          } else {
            console.log(`ℹ️  No folder cover found for ${path.basename(filePath)}`);
          }
        }
      } catch (coverError) {
        console.warn(`⚠️  Cover extraction failed for ${path.basename(filePath)}: ${coverError.message}`);
        console.warn(`⚠️  Cover error stack: ${coverError.stack}`);
      }

      // Prepare track data
      const trackData = {
        file_path: filePath,
        file_size: stats.size,
        file_mtime: stats.mtime.getTime(),
        title: common.title || path.basename(filePath, path.extname(filePath)),
        artist: common.artist || 'Unknown Artist',
        album: common.album || 'Unknown Album',
        album_artist: common.albumartist || common.artist,
        genre: validateGenres(common.genre), // Use validated genre or null
        year: common.year || null,
        track_number: common.track?.no || null,
        disc_number: common.disk?.no || null,
        duration: metadata.format?.duration || null,
        bitrate: metadata.format?.bitrate || null,
        format: metadata.format?.container || path.extname(filePath).slice(1),
        cover_path: coverPath,
        has_cover: hasCover
      };

      // Insert into database
      await this.db.insertTrack(trackData);
      
      // Return info about whether cover was found
      return { hasCover };
      
    } catch (error) {
      console.error(`❌ Error scanning ${filePath}:`, error.message);
      throw error;
    }
  }

  async extractCoverArt(musicFilePath, pictureData) {
    try {
      // Create covers directory structure
      const musicRelPath = path.relative(this.musicDir, musicFilePath);
      const coverDir = path.join('./data/covers', path.dirname(musicRelPath));
      await fs.ensureDir(coverDir);

      // Generate cover filename
      const baseName = path.basename(musicFilePath, path.extname(musicFilePath));
      const coverFileName = `${baseName}_cover.jpg`;
      const coverPath = path.join(coverDir, coverFileName);

      // Convert and save cover art
      await sharp(pictureData.data)
        .resize(500, 500, { 
          fit: 'inside',
          withoutEnlargement: true 
        })
        .jpeg({ quality: 85 })
        .toFile(coverPath);

      return coverPath;
      
    } catch (error) {
      console.error('Error extracting cover art:', error);
      return null;
    }
  }

  async parseWithFfprobe(filePath) {
    try {
      const command = `"${ffprobePath}" -v quiet -print_format json -show_format -show_streams "${filePath}"`;
      const output = execSync(command, { encoding: 'utf8', timeout: 10000 });
      const data = JSON.parse(output);
      
      const audioStream = data.streams?.find(s => s.codec_type === 'audio');
      const format = data.format || {};
      const tags = format.tags || {};
      
      // Extract cover art if present
      let picture = null;
      try {
        // For MP3 files, check video streams for embedded covers
        const videoStream = data.streams?.find(s => s.codec_type === 'video');
        if (videoStream) {
          const coverData = await this.extractCoverWithFfmpeg(filePath);
          if (coverData) {
            picture = [{ data: coverData, format: 'image/jpeg' }];
          }
        }
      } catch (coverError) {
        console.warn(`⚠️  FFprobe cover extraction failed for ${path.basename(filePath)}: ${coverError.message}`);
      }
      
      return {
        common: {
          title: tags.title || tags.TITLE,
          artist: tags.artist || tags.ARTIST,
          album: tags.album || tags.ALBUM,
          albumartist: tags.albumartist || tags.ALBUMARTIST,
          genre: validateGenres(tags.genre || tags.GENRE), // Use validated genre
          year: tags.date ? parseInt(tags.date) : (tags.DATE ? parseInt(tags.DATE) : null),
          track: tags.track ? { no: parseInt(tags.track) } : (tags.TRACK ? { no: parseInt(tags.TRACK) } : null),
          disk: tags.disc ? { no: parseInt(tags.disc) } : (tags.DISC ? { no: parseInt(tags.DISC) } : null),
          picture: picture
        },
        metadata: {
          format: {
            container: path.extname(filePath).slice(1).toLowerCase(),
            duration: parseFloat(format.duration) || null,
            bitrate: parseInt(format.bit_rate) || (audioStream ? parseInt(audioStream.bit_rate) : null)
          }
        }
      };
    } catch (error) {
      throw new Error(`FFprobe parsing failed: ${error.message}`);
    }
  }

  async findFolderCover(musicFilePath) {
    try {
      const musicDir = path.dirname(musicFilePath);
      const coverNames = ['folder.jpg', 'cover.jpg', 'album.jpg', 'front.jpg', 'folder.png', 'cover.png', 'album.png', 'front.png'];
      
      for (const coverName of coverNames) {
        const coverPath = path.join(musicDir, coverName);
        if (await fs.pathExists(coverPath)) {
          // Copy to our covers directory structure
          const musicRelPath = path.relative(this.musicDir, musicFilePath);
          const targetCoverDir = path.join('./data/covers', path.dirname(musicRelPath));
          await fs.ensureDir(targetCoverDir);
          
          const baseName = path.basename(musicFilePath, path.extname(musicFilePath));
          const targetCoverPath = path.join(targetCoverDir, `${baseName}_cover.jpg`);
          
          // Convert and resize the found cover
          await sharp(coverPath)
            .resize(500, 500, { 
              fit: 'inside',
              withoutEnlargement: true 
            })
            .jpeg({ quality: 85 })
            .toFile(targetCoverPath);
            
          return targetCoverPath;
        }
      }
      
      return null;
    } catch (error) {
      console.warn(`Error finding folder cover: ${error.message}`);
      return null;
    }
  }

  async extractCoverWithFfmpeg(filePath) {
    try {
      const ffmpegPath = require('ffmpeg-static');
      const tempDir = path.join('./data/temp');
      await fs.ensureDir(tempDir);
      
      const tempCoverPath = path.join(tempDir, `temp_cover_${Date.now()}.jpg`);
      
      const command = `"${ffmpegPath}" -i "${filePath}" -an -vcodec copy "${tempCoverPath}" -y`;
      execSync(command, { encoding: 'utf8', timeout: 10000, stdio: 'ignore' });
      
      if (await fs.pathExists(tempCoverPath)) {
        const coverData = await fs.readFile(tempCoverPath);
        await fs.remove(tempCoverPath); // Clean up temp file
        return coverData;
      }
      
      return null;
    } catch (error) {
      console.warn(`FFmpeg cover extraction failed: ${error.message}`);
      return null;
    }
  }

  async destroy() {
    if (this.watcher) {
      await this.watcher.close();
      console.log('[SCANNER] 👁️  File watcher stopped');
    }
  }
}

module.exports = MusicScanner;
