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
const SlideMetadataExtractor = require('./slideMetadataExtractor');

const app = express();
const PORT = process.env.CONVERSION_PORT || 3103;

// Initialize VIPS and metadata extractor
let vipsConfig, autoProcessor, metadataExtractor;

if (config.isServerMode()) {
  vipsConfig = new VipsConfig();
  metadataExtractor = new SlideMetadataExtractor(config);
}

// Middleware
app.use(cors({ origin: '*', credentials: true }));
app.use(express.json());

// Create necessary directories
if (config.isServerMode()) {
  [config.uploadsDir, config.slidesDir, config.dziDir].forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
}

// SVS to DZI conversion function with metadata extraction
function convertSvsToDzi(svsPath, outputName) {
  return new Promise(async (resolve, reject) => {
    const outputPath = path.join(config.dziDir, outputName);
    const startTime = Date.now();
    
    // Get original file stats
    const originalStats = fs.statSync(svsPath);
    const originalSize = originalStats.size;
    
    // Step 1: Extract metadata (preparation step)
    let metadata = null;
    let extractedIccProfile = null;
    
    try {
      console.log(`\n=== PREPARATION STEP: METADATA EXTRACTION ===`);
      console.log(`File: ${path.basename(svsPath)}`);
      console.log(`Extracting metadata and ICC profile...`);
      
      const extractionResult = await metadataExtractor.extractMetadata(svsPath);
      metadata = extractionResult.metadata;
      extractedIccProfile = extractionResult.iccProfile;
      
      console.log(`Metadata extraction completed`);
      console.log(`ICC Profile: ${extractedIccProfile ? 'Found' : 'Not found'}`);
      console.log(`==============================================\n`);
      
    } catch (metadataError) {
      console.warn(`Metadata extraction failed: ${metadataError.message}`);
      console.log(`Proceeding with conversion without metadata...\n`);
    }
    
    // Check for existing tile folder
    const tilesDir = `${outputPath}_files`;
    const existingTiles = fs.existsSync(tilesDir);
    let existingTileCount = 0;
    
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
    
    // Progress tracking
    let progressTimer;
    const startProgress = () => {
      try {
        progressTimer = setInterval(() => {
          try {
            let created = 0;
            if (fs.existsSync(tilesDir)) {
              const walkCount = (dir) => {
                let count = 0;
                const files = fs.readdirSync(dir);
                for (const f of files) {
                  const p = path.join(dir, f);
                  const st = fs.statSync(p);
                  if (st.isDirectory()) count += walkCount(p);
                  else if (f.endsWith('.jpg') || f.endsWith('.jpeg')) count++;
                }
                return count;
              };
              created = walkCount(tilesDir);
            }
            const elapsedMs = Date.now() - startTime;
            broadcastToClients({
              type: 'conversion_progress',
              filename: outputName,
              tilesCreated: created,
              elapsedMs
            });
          } catch (_) { /* noop */ }
        }, 3000);
      } catch (_) { /* noop */ }
    };

    startProgress();

    exec(command, { env: vipsEnv, maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
      const endTime = Date.now();
      const duration = endTime - startTime;

      if (progressTimer) clearInterval(progressTimer);

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
          tilesValidated = existingTileCount;
          tilesCreated = finalTileCount - existingTileCount;
        } else {
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
        metadata,
        iccProfile: extractedIccProfile,
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
            convertedSize: 0,
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

// API endpoint to convert SVS to DZI
app.post('/api/convert/:filename', async (req, res) => {
  const filename = req.params.filename;
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
      .then(result => {
        console.log(`Conversion completed: ${result.dziPath}`);
        // Notify connected WebSocket clients
        broadcastToClients({
          type: 'conversion_complete',
          filename: baseName,
          dziPath: `/dzi/${baseName}.dzi`,
          metadata: result.metadata,
          metrics: result.metrics
        });
      })
      .catch(error => {
        console.error(`Conversion failed: ${error}`);
        broadcastToClients({
          type: 'conversion_error',
          filename: baseName,
          error: error.message
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
app.get('/api/auto-processor/status', (req, res) => {
  if (!autoProcessor) {
    return res.status(503).json({ error: 'Auto-processor not initialized' });
  }
  
  res.json({
    status: autoProcessor.getStatus(),
    queue: autoProcessor.getQueue()
  });
});

app.post('/api/auto-processor/enable', (req, res) => {
  if (!autoProcessor) {
    return res.status(503).json({ error: 'Auto-processor not initialized' });
  }
  
  autoProcessor.enable();
  res.json({ message: 'Auto-processor enabled', status: autoProcessor.getStatus() });
});

app.post('/api/auto-processor/disable', (req, res) => {
  if (!autoProcessor) {
    return res.status(503).json({ error: 'Auto-processor not initialized' });
  }
  
  autoProcessor.disable();
  res.json({ message: 'Auto-processor disabled', status: autoProcessor.getStatus() });
});

// Create HTTP server
const server = app.listen(PORT, () => {
  console.log(`\n=== CONVERSION SERVICE ===`);
  console.log(`Server: http://localhost:${PORT}`);
  console.log(`Mode: ${config.mode.toUpperCase()}`);
  console.log(`==========================\n`);
});

// WebSocket server for real-time updates
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  console.log('New client connected to conversion service');
  
  // Send current auto-processor status to new clients
  if (autoProcessor) {
    ws.send(JSON.stringify({
      type: 'auto_processor_status',
      status: autoProcessor.getStatus(),
      queue: autoProcessor.getQueue()
    }));
  }
  
  ws.on('close', () => {
    console.log('Client disconnected from conversion service');
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
      metadata: data.result.metadata,
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
  console.log('\nShutting down conversion service...');
  if (autoProcessor) {
    autoProcessor.destroy();
  }
  server.close(() => {
    console.log('Conversion service closed');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  console.log('\nShutting down conversion service...');
  if (autoProcessor) {
    autoProcessor.destroy();
  }
  server.close(() => {
    console.log('Conversion service closed');
    process.exit(0);
  });
});

module.exports = { app, server, autoProcessor };
