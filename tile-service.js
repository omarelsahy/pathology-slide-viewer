require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const WebSocket = require('ws');
const fetch = require('node-fetch');
const config = require('./config');
const LabServerClient = require('./services/labServerClient');

const app = express();
const PORT = process.env.TILE_PORT || 3101;
const CONVERSION_SERVICE_URL = process.env.CONVERSION_SERVICE_URL || 'http://localhost:3103';

// Initialize components based on mode
let labClient;

if (config.isClientMode()) {
  // Initialize lab server client for home computer
  labClient = new LabServerClient(config);
}

// Middleware
const corsOptions = config.isServerMode()
  ? { origin: (origin, callback) => callback(null, true) }
  : { origin: config.corsOrigins, credentials: true };
app.use(cors(corsOptions));
app.use(express.json());

// API Authentication middleware for server mode
if (config.isServerMode()) {
  app.use('/api/v1', (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    if (apiKey !== config.apiKey) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
  });
}

// Create necessary directories based on mode
if (config.isServerMode()) {
  // Lab server needs all directories
  [config.uploadsDir, config.slidesDir, config.dziDir].forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
} else {
  // Home client needs cache and temp directories
  [config.cacheDir, config.tempDir].forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
}

// Helper function to make requests to conversion service
async function callConversionService(endpoint, method = 'GET', body = null) {
  const url = `${CONVERSION_SERVICE_URL}${endpoint}`;
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  
  if (body) {
    options.body = JSON.stringify(body);
  }
  
  try {
    const response = await fetch(url, options);
    return await response.json();
  } catch (error) {
    throw new Error(`Conversion service unavailable: ${error.message}`);
  }
}

// API endpoint to list available slides
app.get('/api/slides', async (req, res) => {
  if (config.isClientMode()) {
    // Proxy request to lab server
    try {
      const slides = await labClient.getSlides();
      res.json(slides);
    } catch (error) {
      res.status(503).json({ error: 'Lab server unavailable', details: error.message });
    }
    return;
  }

  // Server mode - original logic
  const slideFiles = [];
  
  // Check original slides directory
  if (fs.existsSync(config.slidesDir)) {
    const originalFiles = fs.readdirSync(config.slidesDir);
    const supportedFormats = ['.svs', '.ndpi', '.tif', '.tiff', '.jp2', '.vms', '.vmu', '.scn'];
    
    originalFiles
      .filter(file => {
        const ext = path.extname(file).toLowerCase();
        return supportedFormats.includes(ext);
      })
      .forEach(file => {
        const baseName = path.basename(file, path.extname(file));
        const dziPath = path.join(config.dziDir, `${baseName}.dzi`);
        const hasDzi = fs.existsSync(dziPath);
        
        slideFiles.push({
          name: baseName,
          originalFile: `/slides/${file}`,
          dziFile: hasDzi ? `/dzi/${baseName}.dzi` : null,
          format: path.extname(file).toLowerCase(),
          converted: hasDzi,
          size: fs.statSync(path.join(config.slidesDir, file)).size
        });
      });
  }
  
  // Check for standalone DZI files
  if (fs.existsSync(config.dziDir)) {
    const dziFiles = fs.readdirSync(config.dziDir).filter(file => file.endsWith('.dzi'));
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
app.get('/slides/:filename', async (req, res) => {
  const filename = req.params.filename;
  
  if (config.isClientMode()) {
    // Proxy request to lab server
    try {
      const stream = await labClient.streamDziTile(`../slides/${filename}`);
      stream.pipe(res);
    } catch (error) {
      res.status(404).json({ error: 'Slide not found on lab server' });
    }
    return;
  }

  // Server mode - original logic
  const filePath = path.join(config.slidesDir, filename);
  
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
if (config.isServerMode()) {
  app.use('/dzi', express.static(config.dziDir));
} else {
  // Client mode - proxy DZI requests to lab server
  app.get('/dzi/*', async (req, res) => {
    try {
      const tilePath = req.params[0];
      const stream = await labClient.streamDziTile(tilePath);
      stream.pipe(res);
    } catch (error) {
      res.status(404).json({ error: 'DZI tile not found on lab server' });
    }
  });
}

// API endpoint to delete a slide
app.delete('/api/slides/:filename', async (req, res) => {
  const filename = req.params.filename;
  
  if (config.isClientMode()) {
    // Proxy deletion request to lab server
    try {
      const result = await labClient.deleteSlide(filename);
      res.json(result);
    } catch (error) {
      res.status(503).json({ error: 'Lab server unavailable', details: error.message });
    }
    return;
  }

  // Server mode - delete slide and associated files
  try {
    const baseName = path.basename(filename, path.extname(filename));
    const slidePath = path.join(config.slidesDir, filename);
    const dziPath = path.join(config.dziDir, `${baseName}.dzi`);
    const tilesDir = path.join(config.dziDir, `${baseName}_files`);
    
    let deletedFiles = [];
    
    // Delete original slide file
    if (fs.existsSync(slidePath)) {
      fs.unlinkSync(slidePath);
      deletedFiles.push('original');
    }
    
    // Delete DZI file
    if (fs.existsSync(dziPath)) {
      fs.unlinkSync(dziPath);
      deletedFiles.push('dzi');
    }
    
    // Delete tiles directory
    if (fs.existsSync(tilesDir)) {
      fs.rmSync(tilesDir, { recursive: true, force: true });
      deletedFiles.push('tiles');
    }
    
    console.log(`Deleted slide: ${filename} (${deletedFiles.join(', ')})`);
    
    // Broadcast deletion to WebSocket clients
    broadcastToClients({
      type: 'slide_deleted',
      filename: baseName,
      deletedComponents: deletedFiles
    });
    
    res.json({ 
      message: 'Slide deleted successfully', 
      filename: baseName,
      deletedComponents: deletedFiles 
    });
    
  } catch (error) {
    console.error('Error deleting slide:', error);
    res.status(500).json({ error: 'Failed to delete slide', details: error.message });
  }
});

// API endpoint to convert SVS to DZI - proxy to conversion service
app.post('/api/convert/:filename', async (req, res) => {
  const filename = req.params.filename;
  
  if (config.isClientMode()) {
    // Proxy conversion request to lab server
    try {
      const result = await labClient.convertSlide(filename);
      res.json(result);
    } catch (error) {
      res.status(503).json({ error: 'Lab server unavailable', details: error.message });
    }
    return;
  }

  // Server mode - proxy to conversion service
  try {
    const result = await callConversionService(`/api/convert/${filename}`, 'POST');
    res.json(result);
  } catch (error) {
    console.error('Conversion service error:', error);
    res.status(503).json({ error: 'Conversion service unavailable', details: error.message });
  }
});

// Performance monitoring endpoint - proxy to conversion service
app.get('/api/performance/status', async (req, res) => {
  try {
    const result = await callConversionService('/api/performance/status');
    res.json(result);
  } catch (error) {
    res.status(503).json({ error: 'Conversion service unavailable', details: error.message });
  }
});

// GPU support check endpoint - proxy to conversion service
app.get('/api/performance/gpu-support', async (req, res) => {
  try {
    const result = await callConversionService('/api/performance/gpu-support');
    res.json(result);
  } catch (error) {
    res.status(503).json({ error: 'Conversion service unavailable', details: error.message });
  }
});

// Auto-processor control endpoints - proxy to conversion service
app.get('/api/auto-processor/status', async (req, res) => {
  if (config.isClientMode()) {
    // Proxy to lab server
    try {
      const status = await labClient.getAutoProcessorStatus();
      res.json(status);
    } catch (error) {
      res.status(503).json({ error: 'Lab server unavailable', details: error.message });
    }
    return;
  }

  try {
    const result = await callConversionService('/api/auto-processor/status');
    res.json(result);
  } catch (error) {
    res.status(503).json({ error: 'Conversion service unavailable', details: error.message });
  }
});

app.post('/api/auto-processor/enable', async (req, res) => {
  if (config.isClientMode()) {
    // Proxy to lab server
    try {
      const result = await labClient.enableAutoProcessor();
      res.json(result);
    } catch (error) {
      res.status(503).json({ error: 'Lab server unavailable', details: error.message });
    }
    return;
  }

  try {
    const result = await callConversionService('/api/auto-processor/enable', 'POST');
    res.json(result);
  } catch (error) {
    res.status(503).json({ error: 'Conversion service unavailable', details: error.message });
  }
});

app.post('/api/auto-processor/disable', async (req, res) => {
  if (config.isClientMode()) {
    // Proxy to lab server
    try {
      const result = await labClient.disableAutoProcessor();
      res.json(result);
    } catch (error) {
      res.status(503).json({ error: 'Lab server unavailable', details: error.message });
    }
    return;
  }

  try {
    const result = await callConversionService('/api/auto-processor/disable', 'POST');
    res.json(result);
  } catch (error) {
    res.status(503).json({ error: 'Conversion service unavailable', details: error.message });
  }
});

// Add lab server connection test endpoint for client mode
if (config.isClientMode()) {
  app.get('/api/lab-connection/test', async (req, res) => {
    try {
      const connectionTest = await labClient.testConnection();
      res.json(connectionTest);
    } catch (error) {
      res.status(503).json({ error: 'Connection test failed', details: error.message });
    }
  });
}

// Create HTTP server
const server = app.listen(PORT, () => {
  console.log(`\n=== TILE SERVICE ===`);
  console.log(`Mode: ${config.mode.toUpperCase()}`);
  console.log(`Server: http://localhost:${PORT}`);
  console.log(`Conversion Service: ${CONVERSION_SERVICE_URL}`);
  if (config.isClientMode()) {
    console.log(`Lab Server: ${config.labServer.url}`);
  }
  console.log(`Configuration:`, config.getSummary());
  console.log(`====================\n`);
});

// WebSocket server for real-time updates
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  console.log('New client connected to tile service');
  
  ws.on('close', () => {
    console.log('Client disconnected from tile service');
  });
});

// WebSocket connection to conversion service for forwarding events
let conversionWs;

function connectToConversionService() {
  if (config.isServerMode()) {
    try {
      conversionWs = new WebSocket(`ws://localhost:3103`);
      
      conversionWs.on('open', () => {
        console.log('Connected to conversion service WebSocket');
      });
      
      conversionWs.on('message', (data) => {
        // Forward conversion service events to frontend clients
        const message = JSON.parse(data);
        broadcastToClients(message);
      });
      
      conversionWs.on('close', () => {
        console.log('Disconnected from conversion service WebSocket');
        // Attempt to reconnect after 5 seconds
        setTimeout(connectToConversionService, 5000);
      });
      
      conversionWs.on('error', (error) => {
        console.error('Conversion service WebSocket error:', error);
      });
    } catch (error) {
      console.error('Failed to connect to conversion service WebSocket:', error);
      // Retry connection after 5 seconds
      setTimeout(connectToConversionService, 5000);
    }
  }
}

// Connect to conversion service WebSocket
connectToConversionService();

// Helper function to broadcast to all WebSocket clients
function broadcastToClients(message) {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(message));
    }
  });
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down tile service...');
  if (conversionWs) {
    conversionWs.close();
  }
  server.close(() => {
    console.log('Tile service closed');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  console.log('\nShutting down tile service...');
  if (conversionWs) {
    conversionWs.close();
  }
  server.close(() => {
    console.log('Tile service closed');
    process.exit(0);
  });
});

module.exports = { app, server };
