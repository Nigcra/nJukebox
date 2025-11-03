// Simple Node.js server with Spotify login URL rewriting
const http = require('http');
const fs = require('fs');
const path = require('path');
let config = {};
try {
  const configPath = path.join(__dirname, 'config.json');
  if (fs.existsSync(configPath)) {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    console.log('📋 Configuration loaded from config.json');
  }
} catch (error) {
  console.warn('⚠️ Failed to load config.json, using defaults:', error.message);
}

const PORT = process.env.PORT || config.server?.webPort || 5500;
const HOST = config.server?.host || '127.0.0.1';

// Determine the correct root directory for both PKG and normal execution
let ROOT;
if (process.pkg) {
  // Running in PKG - use current working directory (where exe is executed from)
  ROOT = process.cwd();
  console.log('🔧 PKG Mode - Assets loaded from current directory:', ROOT);
} else {
  // Running normally with Node.js
  ROOT = __dirname;
  console.log('🔧 Node.js Mode - Assets loaded from:', ROOT);
}

const mimeTypes = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function sendFile(res, filePath, status=200) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(status, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  let url = req.url.split('?')[0];
  // URL rewrites for HTML files
  if (url === '/spotify_player') url = '/spotify_login.html';
  if (url === '/index_web') url = '/jukebox.html';
  if (url === '/') url = '/jukebox.html';
  
  let decodedUrl;
  try {
    decodedUrl = decodeURIComponent(url);
  } catch (error) {
    console.log(`URI decode error for URL "${url}": ${error.message}`);
    decodedUrl = url; // Use original URL if decoding fails
  }
  
  // Try multiple locations: ROOT, __dirname, and current working directory
  const filePath = path.join(ROOT, decodedUrl);
  fs.stat(filePath, (err, stat) => {
    if (!err && stat.isFile()) {
      sendFile(res, filePath);
    } else if (process.pkg) {
      // In PKG mode, also try the embedded assets location
      const embeddedPath = path.join(__dirname, decodedUrl);
      fs.stat(embeddedPath, (err2, stat2) => {
        if (!err2 && stat2.isFile()) {
          sendFile(res, embeddedPath);
        } else {
          // Try current working directory
          const cwdPath = path.join(process.cwd(), decodedUrl);
          fs.stat(cwdPath, (err3, stat3) => {
            if (!err3 && stat3.isFile()) {
              sendFile(res, cwdPath);
            } else {
              // Try serving static files from all locations
              const staticPath = path.join(ROOT, req.url);
              const embeddedStaticPath = path.join(__dirname, req.url);
              const cwdStaticPath = path.join(process.cwd(), req.url);
              
              fs.stat(staticPath, (err4, stat4) => {
                if (!err4 && stat4.isFile()) {
                  sendFile(res, staticPath);
                } else {
                  fs.stat(embeddedStaticPath, (err5, stat5) => {
                    if (!err5 && stat5.isFile()) {
                      sendFile(res, embeddedStaticPath);
                    } else {
                      fs.stat(cwdStaticPath, (err6, stat6) => {
                        if (!err6 && stat6.isFile()) {
                          sendFile(res, cwdStaticPath);
                        } else {
                          res.writeHead(404);
                          res.end('Not found');
                        }
                      });
                    }
                  });
                }
              });
            }
          });
        }
      });
    } else {
      // Non-PKG mode: try static files in ROOT only
      const staticPath = path.join(ROOT, req.url);
      fs.stat(staticPath, (err2, stat2) => {
        if (!err2 && stat2.isFile()) {
          sendFile(res, staticPath);
        } else {
          res.writeHead(404);
          res.end('Not found');
        }
      });
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log('🌐 Web Server started successfully');
  console.log(`📡 Listening on: http://${HOST}:${PORT}`);
  if (HOST === '0.0.0.0') {
    console.log('🌍 Server accessible from all network interfaces');
  }
  console.log('💡 Server ready to handle requests');
});
