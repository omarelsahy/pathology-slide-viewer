const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const WebSocket = require('ws');
const { exec } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Create necessary directories if they don't exist
const uploadsDir = path.join(__dirname, 'uploads');
const slidesDir = path.join(__dirname, 'public', 'slides');
const dziDir = path.join(__dirname, 'public', 'dzi');

[uploadsDir, slidesDir, dziDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// SVS to DZI conversion function
function convertSvsToDzi(svsPath, outputName) {
  return new Promise((resolve, reject) => {
    const outputPath = path.join(dziDir, outputName);
    
    // Using VIPS command to convert SVS to DZI
    const command = `vips dzsave "${svsPath}" "${outputPath}" --layout dz --suffix .jpg[Q=90] --overlap 1 --tile-size 256`;
    
    console.log(`Converting ${svsPath} to DZI format...`);
    console.log(`Command: ${command}`);
    
    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error(`Conversion error: ${error}`);
        // Try alternative method with Sharp
        convertWithSharp(svsPath, outputName)
          .then(resolve)
          .catch(reject);
        return;
      }
      
      console.log(`Conversion completed: ${outputPath}.dzi`);
      resolve(`${outputPath}.dzi`);
    });
  });
}

// Alternative conversion using Sharp (fallback)
function convertWithSharp(svsPath, outputName) {
  return new Promise((resolve, reject) => {
    const sharp = require('sharp');
    const outputPath = path.join(dziDir, `${outputName}.dzi`);
    
    console.log(`Attempting Sharp conversion for ${svsPath}...`);
    
    // Sharp doesn't directly support SVS, so we'll create a basic tile structure
    sharp(svsPath)
      .tile({
        size: 256,
        overlap: 1,
        layout: 'dz'
      })
      .dz()
      .toFile(outputPath.replace('.dzi', ''))
      .then(() => {
        console.log(`Sharp conversion completed: ${outputPath}`);
        resolve(outputPath);
      })
      .catch(error => {
        console.error(`Sharp conversion failed: ${error}`);
        reject(error);
      });
  });
}

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API endpoint to list available slides
app.get('/api/slides', (req, res) => {
  const slideFiles = [];
  
  // Check original slides directory
  if (fs.existsSync(slidesDir)) {
    const originalFiles = fs.readdirSync(slidesDir);
    const supportedFormats = ['.svs', '.ndpi', '.tif', '.tiff', '.jp2', '.vms', '.vmu', '.scn'];
    
    originalFiles
      .filter(file => {
        const ext = path.extname(file).toLowerCase();
        return supportedFormats.includes(ext);
      })
      .forEach(file => {
        const baseName = path.basename(file, path.extname(file));
        const dziPath = path.join(dziDir, `${baseName}.dzi`);
        const hasDzi = fs.existsSync(dziPath);
        
        slideFiles.push({
          name: baseName,
          originalFile: `/slides/${file}`,
          dziFile: hasDzi ? `/dzi/${baseName}.dzi` : null,
          format: path.extname(file).toLowerCase(),
          converted: hasDzi,
          size: fs.statSync(path.join(slidesDir, file)).size
        });
      });
  }
  
  // Check for standalone DZI files
  if (fs.existsSync(dziDir)) {
    const dziFiles = fs.readdirSync(dziDir).filter(file => file.endsWith('.dzi'));
    dziFiles.forEach(file => {
      const baseName = path.basename(file, '.dzi');
      const existing = slideFiles.find(slide => slide.name === baseName);
      
      if (!existing) {
        slideFiles.push({
          name: baseName,
          originalFile: null,
          dziFile: `/dzi/${file}`,
          format: '.dzi',
          converted: true,
          size: 0
        });
      }
    });
  }
  
  console.log('Found slides:', slideFiles);
  res.json(slideFiles);
});

// Serve slide files directly
app.get('/slides/:filename', (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(slidesDir, filename);
  
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Slide not found' });
  }
  
  // For SVS and other large files, we need to stream them
  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;
  
  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunksize = (end - start) + 1;
    const file = fs.createReadStream(filePath, { start, end });
    const head = {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': 'application/octet-stream',
    };
    res.writeHead(206, head);
    file.pipe(res);
  } else {
    const head = {
      'Content-Length': fileSize,
      'Content-Type': 'application/octet-stream',
    };
    res.writeHead(200, head);
    fs.createReadStream(filePath).pipe(res);
  }
});

// Serve DZI files
app.use('/dzi', express.static(dziDir));

// API endpoint to convert SVS to DZI
app.post('/api/convert/:filename', async (req, res) => {
  const filename = req.params.filename;
  const svsPath = path.join(slidesDir, filename);
  
  if (!fs.existsSync(svsPath)) {
    return res.status(404).json({ error: 'Slide file not found' });
  }
  
  const baseName = path.basename(filename, path.extname(filename));
  
  try {
    console.log(`Starting conversion of ${filename}...`);
    res.json({ message: 'Conversion started', status: 'processing' });
    
    // Start conversion in background
    convertSvsToDzi(svsPath, baseName)
      .then(dziPath => {
        console.log(`Conversion completed: ${dziPath}`);
        // Notify connected WebSocket clients
        wss.clients.forEach(client => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({
              type: 'conversion_complete',
              filename: baseName,
              dziPath: `/dzi/${baseName}.dzi`
            }));
          }
        });
      })
      .catch(error => {
        console.error(`Conversion failed: ${error}`);
        wss.clients.forEach(client => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({
              type: 'conversion_error',
              filename: baseName,
              error: error.message
            }));
          }
        });
      });
      
  } catch (error) {
    console.error('Conversion error:', error);
    res.status(500).json({ error: 'Conversion failed', details: error.message });
  }
});

// Create HTTP server
const server = app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

// WebSocket server for real-time updates
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  console.log('New client connected');
  
  ws.on('close', () => {
    console.log('Client disconnected');
  });
});

module.exports = { app, server };
