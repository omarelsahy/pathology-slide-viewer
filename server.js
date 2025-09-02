require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const WebSocket = require('ws');
const { exec } = require('child_process');
const config = require('./config');
const AutoProcessor = require('./autoProcessor');
const VipsConfig = require('./vips-config');
const LabServerClient = require('./services/labServerClient');

const app = express();
const PORT = config.port;

// Initialize components based on mode
let vipsConfig, labClient, autoProcessor;

if (config.isServerMode()) {
  // Initialize VIPS configuration for lab server
  vipsConfig = new VipsConfig();
} else {
  // Initialize lab server client for home computer
  labClient = new LabServerClient(config);
}

// Middleware
app.use(cors({
  origin: config.corsOrigins,
  credentials: true
}));
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

// Static files
if (config.isServerMode()) {
  app.use(express.static(path.join(__dirname, 'public')));
} else {
  // In client mode, serve UI but proxy slide data
  app.use(express.static(path.join(__dirname, 'public')));
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

// SVS to DZI conversion function
function convertSvsToDzi(svsPath, outputName) {
  return new Promise((resolve, reject) => {
    const outputPath = path.join(config.dziDir, outputName);
    const startTime = Date.now();
    
    // Get original file stats
    const originalStats = fs.statSync(svsPath);
    const originalSize = originalStats.size;
    
    // Check for existing tile folder
    const tilesDir = `${outputPath}_files`;
    const existingTiles = fs.existsSync(tilesDir);
    let existingTileCount = 0;
    
    // Check for existing tile folder (debug logging removed for production)
    
    if (existingTiles) {
      // Count existing tiles
      try {
        const countTiles = (dir) => {
          let count = 0;
          const files = fs.readdirSync(dir);
          files.forEach(file => {
            const filePath = path.join(dir, file);
            const stat = fs.statSync(filePath);
            if (stat.isDirectory()) {
              count += countTiles(filePath);
            } else if (file.endsWith('.jpg') || file.endsWith('.jpeg')) {
              count++;
            }
          });
          return count;
        };
        existingTileCount = countTiles(tilesDir);
      } catch (err) {
        console.error('Error counting existing tiles:', err);
      }
    }
    
    // Using optimized VIPS command to convert SVS to DZI
    const command = vipsConfig.getOptimizedCommand(svsPath, outputPath, {
      tileSize: 256,
      overlap: 1,
      quality: 90
    });
    
    // Set optimized environment variables for VIPS
    const vipsEnv = { ...process.env, ...vipsConfig.getEnvironmentVars() };
    
    console.log(`\n=== CONVERSION STARTED ===`);
    console.log(`File: ${path.basename(svsPath)}`);
    console.log(`Original size: ${(originalSize / 1024 / 1024 / 1024).toFixed(2)} GB`);
    console.log(`Start time: ${new Date(startTime).toLocaleTimeString()}`);
    if (existingTiles) {
      console.log(`Existing tile folder detected: ${path.basename(tilesDir)}`);
      console.log(`Existing tiles found: ${existingTileCount.toLocaleString()}`);
      console.log(`Mode: Validation/repair of existing tiles`);
    } else {
      console.log(`Mode: Full conversion (no existing tiles)`);
    }
    console.log(`Command: ${command}`);
    console.log(`========================\n`);
    
    exec(command, { env: vipsEnv, maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      if (error) {
        console.error(`\n=== CONVERSION FAILED ===`);
        console.error(`Error: ${error}`);
        console.error(`Duration: ${(duration / 1000).toFixed(1)} seconds`);
        console.error(`========================\n`);
        
        // Try alternative method with Sharp
        convertWithSharp(svsPath, outputName, startTime, originalSize)
          .then(resolve)
          .catch(reject);
        return;
      }
      
      // Calculate conversion metrics
      const dziPath = `${outputPath}.dzi`;
      const tilesDir = `${outputPath}_files`;
      
      // Get converted file stats
      let convertedSize = 0;
      let fileCount = 0;
      
      try {
        if (fs.existsSync(dziPath)) {
          convertedSize += fs.statSync(dziPath).size;
          fileCount++;
        }
        
        if (fs.existsSync(tilesDir)) {
          const walkDir = (dir) => {
            const files = fs.readdirSync(dir);
            files.forEach(file => {
              const filePath = path.join(dir, file);
              const stat = fs.statSync(filePath);
              if (stat.isDirectory()) {
                walkDir(filePath);
              } else {
                convertedSize += stat.size;
                fileCount++;
              }
            });
          };
          walkDir(tilesDir);
        }
      } catch (err) {
        console.error('Error calculating converted file size:', err);
      }
      
      // Calculate tile validation metrics
      let finalTileCount = 0;
      let tilesCreated = 0;
      let tilesValidated = 0;
      
      try {
        if (fs.existsSync(tilesDir)) {
          const countFinalTiles = (dir) => {
            let count = 0;
            const files = fs.readdirSync(dir);
            files.forEach(file => {
              const filePath = path.join(dir, file);
              const stat = fs.statSync(filePath);
              if (stat.isDirectory()) {
                count += countFinalTiles(filePath);
              } else if (file.endsWith('.jpg') || file.endsWith('.jpeg')) {
                count++;
              }
            });
            return count;
          };
          finalTileCount = countFinalTiles(tilesDir);
        }
        
        if (existingTiles) {
          // In validation mode
          tilesValidated = existingTileCount;
          tilesCreated = finalTileCount - existingTileCount;
        } else {
          // In full conversion mode
          tilesCreated = finalTileCount;
        }
      } catch (err) {
        console.error('Error calculating tile metrics:', err);
      }

      console.log(`\n=== CONVERSION COMPLETED ===`);
      console.log(`File: ${path.basename(svsPath)}`);
      console.log(`Duration: ${(duration / 1000).toFixed(1)} seconds (${(duration / 60000).toFixed(1)} minutes)`);
      console.log(`Original size: ${(originalSize / 1024 / 1024 / 1024).toFixed(2)} GB`);
      console.log(`Converted size: ${(convertedSize / 1024 / 1024 / 1024).toFixed(2)} GB`);
      console.log(`Size change: ${convertedSize > originalSize ? '+' : ''}${(((convertedSize - originalSize) / originalSize) * 100).toFixed(1)}%`);
      
      if (existingTiles) {
        console.log(`\n--- TILE VALIDATION RESULTS ---`);
        console.log(`Tiles validated: ${tilesValidated.toLocaleString()}`);
        console.log(`Tiles created/repaired: ${tilesCreated.toLocaleString()}`);
        console.log(`Total tiles: ${finalTileCount.toLocaleString()}`);
        console.log(`Validation rate: ${(tilesValidated / (duration / 1000)).toFixed(0)} tiles/second`);
        if (tilesCreated > 0) {
          console.log(`Missing/corrupted tiles found: ${tilesCreated.toLocaleString()}`);
          console.log(`Repair completion: ${((tilesValidated / finalTileCount) * 100).toFixed(1)}% validated, ${((tilesCreated / finalTileCount) * 100).toFixed(1)}% repaired`);
        } else {
          console.log(`All existing tiles validated successfully - no repairs needed`);
        }
        console.log(`------------------------------`);
      } else {
        console.log(`Total tiles created: ${finalTileCount.toLocaleString()}`);
      }
      
      console.log(`Processing rate: ${(originalSize / 1024 / 1024 / (duration / 1000)).toFixed(1)} MB/second`);
      console.log(`VIPS threads used: ${vipsEnv.VIPS_CONCURRENCY}`);
      console.log(`VIPS memory limit: ${Math.floor(parseInt(vipsEnv.VIPS_CACHE_MAX_MEMORY) / (1024 * 1024))} MB`);
      console.log(`End time: ${new Date(endTime).toLocaleTimeString()}`);
      console.log(`============================\n`);
      
      resolve({
        dziPath,
        metrics: {
          duration,
          originalSize,
          convertedSize,
          fileCount,
          processingRate: originalSize / 1024 / 1024 / (duration / 1000),
          startTime,
          endTime
        }
      });
    });
  });
}

// Alternative conversion using Sharp (fallback)
function convertWithSharp(svsPath, outputName, startTime, originalSize) {
  return new Promise((resolve, reject) => {
    const sharp = require('sharp');
    const outputPath = path.join(config.dziDir, outputName);
    const dziPath = `${outputPath}.dzi`;
    
    console.log(`\n=== SHARP FALLBACK CONVERSION ===`);
    console.log(`Attempting Sharp conversion for ${path.basename(svsPath)}...`);
    console.log(`Note: Sharp has limited SVS support`);
    console.log(`================================\n`);
    
    // Sharp tile generation
    sharp(svsPath)
      .tile({
        size: 256,
        overlap: 1,
        layout: 'dz'
      })
      .toFile(outputPath)
      .then(() => {
        const endTime = Date.now();
        const duration = endTime - startTime;
        
        console.log(`\n=== SHARP CONVERSION COMPLETED ===`);
        console.log(`File: ${path.basename(svsPath)}`);
        console.log(`Duration: ${(duration / 1000).toFixed(1)} seconds`);
        console.log(`Method: Sharp fallback`);
        console.log(`=================================\n`);
        
        resolve({
          dziPath,
          metrics: {
            duration,
            originalSize,
            convertedSize: 0, // Sharp doesn't provide easy size calculation
            fileCount: 0,
            processingRate: originalSize / 1024 / 1024 / (duration / 1000),
            startTime,
            endTime: endTime,
            method: 'sharp'
          }
        });
      })
      .catch(error => {
        console.error(`\n=== SHARP CONVERSION FAILED ===`);
        console.error(`Error: ${error.message}`);
        console.error(`===============================\n`);
        reject(error);
      });
  });
}

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

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

// API endpoint to convert SVS to DZI
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

  // Server mode - original logic
  const svsPath = path.join(config.slidesDir, filename);
  
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

// Performance monitoring endpoint
app.get('/api/performance/status', (req, res) => {
  const systemMetrics = vipsConfig.getSystemMetrics();
  const vipsEnv = vipsConfig.getEnvironmentVars();
  
  res.json({
    system: systemMetrics,
    vipsConfig: {
      threads: vipsEnv.VIPS_CONCURRENCY,
      maxMemoryMB: Math.floor(parseInt(vipsEnv.VIPS_CACHE_MAX_MEMORY) / (1024 * 1024)),
      bufferSizeMB: Math.floor(parseInt(vipsEnv.VIPS_BUFFER_SIZE) / (1024 * 1024))
    },
    recommendations: {
      defenderExclusionsConfigured: 'Run setup-defender-exclusions.ps1 as Administrator',
      gpuAcceleration: 'Check /api/performance/gpu-support for GPU acceleration status'
    }
  });
});

// GPU support check endpoint
app.get('/api/performance/gpu-support', async (req, res) => {
  try {
    const gpuSupport = await vipsConfig.checkGpuSupport();
    res.json(gpuSupport);
  } catch (error) {
    res.status(500).json({ error: 'Failed to check GPU support', details: error.message });
  }
});

// Auto-processor control endpoints
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

  if (!autoProcessor) {
    return res.status(503).json({ error: 'Auto-processor not initialized' });
  }
  
  res.json({
    status: autoProcessor.getStatus(),
    queue: autoProcessor.getQueue()
  });
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

  if (!autoProcessor) {
    return res.status(503).json({ error: 'Auto-processor not initialized' });
  }
  
  autoProcessor.enable();
  res.json({ message: 'Auto-processor enabled', status: autoProcessor.getStatus() });
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

  if (!autoProcessor) {
    return res.status(503).json({ error: 'Auto-processor not initialized' });
  }
  
  autoProcessor.disable();
  res.json({ message: 'Auto-processor disabled', status: autoProcessor.getStatus() });
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
  console.log(`\n=== PATHOLOGY SLIDE VIEWER ===`);
  console.log(`Mode: ${config.mode.toUpperCase()}`);
  console.log(`Server: http://localhost:${PORT}`);
  if (config.isClientMode()) {
    console.log(`Lab Server: ${config.labServer.url}`);
  }
  console.log(`Configuration:`, config.getSummary());
  console.log(`=============================\n`);
});

// WebSocket server for real-time updates
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  console.log('New client connected');
  
  // Send current auto-processor status to new clients
  if (autoProcessor) {
    ws.send(JSON.stringify({
      type: 'auto_processor_status',
      status: autoProcessor.getStatus(),
      queue: autoProcessor.getQueue()
    }));
  }
  
  ws.on('close', () => {
    console.log('Client disconnected');
  });
});

// Initialize Auto Processor (only in server mode)
if (config.isServerMode()) {
  autoProcessor = new AutoProcessor(config.slidesDir, convertSvsToDzi, {
    enabled: config.autoProcessorEnabled,
    maxRetries: 3,
    retryDelay: 5000
  });
}

// Auto Processor Event Handlers (only in server mode)
if (config.isServerMode() && autoProcessor) {
  autoProcessor.on('fileDetected', (data) => {
    console.log(`Auto-processor detected new file: ${data.fileName}`);
    broadcastToClients({
      type: 'auto_file_detected',
      fileName: data.fileName,
      baseName: data.baseName
    });
  });

  autoProcessor.on('processingStarted', (fileInfo) => {
    console.log(`Auto-processing started: ${fileInfo.fileName}`);
    broadcastToClients({
      type: 'auto_processing_started',
      fileName: fileInfo.fileName,
      baseName: fileInfo.baseName
    });
  });

  autoProcessor.on('processingCompleted', (data) => {
    console.log(`Auto-processing completed: ${data.fileInfo.fileName}`);
    broadcastToClients({
      type: 'auto_conversion_complete',
      fileName: data.fileInfo.baseName,
      dziPath: `/dzi/${data.fileInfo.baseName}.dzi`,
      metrics: data.result.metrics
    });
  });

  autoProcessor.on('processingFailed', (data) => {
    console.log(`Auto-processing failed: ${data.fileInfo.fileName}`);
    broadcastToClients({
      type: 'auto_conversion_error',
      fileName: data.fileInfo.baseName,
      error: data.error.message
    });
  });

  autoProcessor.on('fileRetry', (data) => {
    console.log(`Auto-processing retry: ${data.fileInfo.fileName} (${data.retryCount}/${data.maxRetries})`);
    broadcastToClients({
      type: 'auto_processing_retry',
      fileName: data.fileInfo.baseName,
      retryCount: data.retryCount,
      maxRetries: data.maxRetries
    });
  });

  autoProcessor.on('queueUpdated', (data) => {
    broadcastToClients({
      type: 'auto_queue_updated',
      queueLength: data.queueLength
    });
  });
}

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
  console.log('\nShutting down server...');
  if (autoProcessor) {
    autoProcessor.destroy();
  }
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  console.log('\nShutting down server...');
  if (autoProcessor) {
    autoProcessor.destroy();
  }
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

module.exports = { app, server, autoProcessor };
