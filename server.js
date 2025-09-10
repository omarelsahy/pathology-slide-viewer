require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const cors = require('cors');
const { spawn, exec } = require('child_process');
const WebSocket = require('ws');
const { Worker } = require('worker_threads');
const config = require('./config');
const { workerPool } = require('./workerPool');

// Load VIPS configuration
require('./vips-config');

let vipsLib = null;
try {
  // Optional wasm-vips for in-process pipeline
  vipsLib = require('wasm-vips');
} catch (_) { /* wasm-vips not installed; will use CLI */ }

// Cleanup function to remove leftover __delete_ directories
function cleanupDeleteDirectories() {
  try {
    const dziDir = config.dziDir;
    if (!fs.existsSync(dziDir)) return;
    
    const entries = fs.readdirSync(dziDir, { withFileTypes: true });
    const deleteDirectories = entries.filter(entry => 
      entry.isDirectory() && entry.name.startsWith('__delete_')
    );
    
    if (deleteDirectories.length > 0) {
      console.log(`Found ${deleteDirectories.length} leftover __delete_ directories, cleaning up...`);
      
      deleteDirectories.forEach(dir => {
        const deletePath = path.join(dziDir, dir.name);
        try {
          if (process.platform === 'win32') {
            const { exec } = require('child_process');
            exec(`rmdir /s /q "${deletePath}"`, (error) => {
              if (error) {
                console.warn(`Failed to cleanup ${dir.name}:`, error.message);
              } else {
                console.log(`Cleaned up: ${dir.name}`);
              }
            });
          } else {
            fs.rmSync(deletePath, { recursive: true, force: true });
            console.log(`Cleaned up: ${dir.name}`);
          }
        } catch (error) {
          console.warn(`Failed to cleanup ${dir.name}:`, error.message);
        }
      });
    }
  } catch (error) {
    console.warn('Error during __delete_ directory cleanup:', error.message);
  }
}

// Helper function to find and kill VIPS processes
function killVipsProcesses() {
  return new Promise((resolve) => {
    const isWindows = process.platform === 'win32';
    
    if (isWindows) {
      // Windows: Use tasklist and taskkill
      exec('tasklist /FI "IMAGENAME eq vips.exe" /FO CSV', (error, stdout) => {
        if (error) {
          console.log('No VIPS processes found or error checking:', error.message);
          resolve();
          return;
        }
        
        const lines = stdout.split('\n').slice(1); // Skip header
        const pids = [];
        
        for (const line of lines) {
          if (line.includes('vips.exe')) {
            const match = line.match(/"(\d+)"/g);
            if (match && match[1]) {
              const pid = match[1].replace(/"/g, '');
              pids.push(pid);
            }
          }
        }
        
        if (pids.length > 0) {
          console.log(`Found ${pids.length} VIPS processes to terminate: ${pids.join(', ')}`);
          const killCommand = `taskkill /F /PID ${pids.join(' /PID ')}`;
          
          exec(killCommand, (killError, killStdout) => {
            if (killError) {
              console.warn('Error killing VIPS processes:', killError.message);
            } else {
              console.log('Successfully terminated VIPS processes:', killStdout);
            }
            resolve();
          });
        } else {
          console.log('No VIPS processes found to terminate');
          resolve();
        }
      });
    } else {
      // Unix-like: Use pkill
      exec('pkill -f vips', (error) => {
        if (error) {
          console.log('No VIPS processes found or error killing:', error.message);
        } else {
          console.log('Successfully terminated VIPS processes');
        }
        resolve();
      });
    }
  });
}

// Helper function to safely delete files with retry logic for locked files
function deleteFileWithRetry(filePath, maxRetries = 3) {
  return new Promise(async (resolve, reject) => {
    let retries = maxRetries;
    
    const attemptDelete = async () => {
      try {
        if (fs.existsSync(filePath)) {
          if (fs.lstatSync(filePath).isDirectory()) {
            fs.rmSync(filePath, { recursive: true, force: true });
          } else {
            fs.unlinkSync(filePath);
          }
          console.log(`Removed: ${path.basename(filePath)}`);
        }
        resolve();
      } catch (error) {
        if (retries > 0 && (error.code === 'EBUSY' || error.code === 'EPERM' || error.code === 'ENOTEMPTY')) {
          retries--;
          console.log(`File locked, retrying in 3s... (${retries} attempts left): ${path.basename(filePath)}`);
          
          // Kill VIPS processes before retrying
          if (retries === maxRetries - 1) {
            console.log('Attempting to kill VIPS processes that may be holding file handles...');
            await killVipsProcesses();
          }
          
          setTimeout(attemptDelete, 3000); // Increased to 3 seconds
        } else {
          console.warn(`Failed to delete ${filePath}:`, error.message);
          reject(error);
        }
      }
    };
    attemptDelete();
  });
}

const VipsConfig = require('./vips-config');
const SlideMetadataExtractor = require('./slideMetadataExtractor');
const LabServerClient = require('./services/labServerClient');

const app = express();
const PORT = config.port;
let vipsConfig, labClient, autoProcessor, metadataExtractor;

// Active conversion tracking
const activeConversions = new Map(); // filename -> { processes: [], progressTimer, startTime, outputName }

// Configure Express for tile serving priority
app.use((req, res, next) => {
  // Prioritize tile requests for user viewing experience
  if (req.url.includes('/dzi/') || req.url.includes('.dzi') || req.url.includes('_files/')) {
    req.priority = 'high';
  }
  next();
});

if (config.isServerMode()) {
  // Initialize VIPS configuration and metadata extractor for lab server
  vipsConfig = new VipsConfig();
  metadataExtractor = new SlideMetadataExtractor(config);
} else {
  // Initialize lab server client for home computer
  labClient = new LabServerClient(config);
}

// Middleware
// Allow dynamic origins in server mode to support access via IP/hostname
const corsOptions = config.isServerMode()
  ? { origin: (origin, callback) => callback(null, true), credentials: true }
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

// Backend server - only serve API endpoints, no static files
// Static files are now served by the separate frontend server on port 3002

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

// Redirect legacy function to use worker pool system
function convertSvsToDzi(svsPath, outputName) {
  console.log('Legacy convertSvsToDzi called - redirecting to worker pool system');
  
  // Use worker pool system like manual conversions do
  if (!workerPool) {
    const WorkerPool = require('./workerPool');
    workerPool = new WorkerPool(3);
  }

  const fileInfo = {
    fileName: path.basename(svsPath),
    filePath: svsPath,
    baseName: outputName,
    retryCount: 0
  };

  // Create VIPS configuration
  const VipsConfig = require('./vips-config');
  const vipsConfig = new VipsConfig();
  
  return workerPool.processSlide(
    fileInfo,
    {
      slidesDir: path.dirname(svsPath),
      dziDir: config.dziDir
    },
    {
      env: {
        ...process.env,
        ...vipsConfig.getEnvironmentVars()
      },
      concurrency: vipsConfig.optimalThreads
    }
  ).then(result => {
    if (result.success) {
      return {
        success: true,
        dziPath: `${path.join(config.dziDir, outputName)}.dzi`,
        duration: result.elapsedMs || 0,
        metadata: {},
        stats: {
          originalSize: 0,
          convertedSize: 0,
          fileCount: 0,
          processingRate: 0,
          startTime: Date.now(),
          endTime: Date.now()
        }
      };
    } else {
      throw new Error(result.error || 'Conversion failed');
    }
  });
}

// Backend API server - no static routes, only API endpoints

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
  
  // Recursively scan slides directory and all subfolders
  function scanSlidesRecursively(dir, relativePath = '') {
    if (!fs.existsSync(dir)) return;
    
    const items = fs.readdirSync(dir, { withFileTypes: true });
    const supportedFormats = ['.svs', '.ndpi', '.tif', '.tiff', '.jp2', '.vms', '.vmu', '.scn'];
    
    items.forEach(item => {
      const fullPath = path.join(dir, item.name);
      const relativeFilePath = path.join(relativePath, item.name);
      
      if (item.isDirectory()) {
        // Recursively scan subdirectories
        scanSlidesRecursively(fullPath, relativeFilePath);
      } else if (item.isFile()) {
        const ext = path.extname(item.name).toLowerCase();
        if (supportedFormats.includes(ext)) {
          const baseName = path.basename(item.name, ext);
          const uniqueName = relativePath ? `${relativePath.replace(/[\\\/]/g, '_')}_${baseName}` : baseName;
          const dziPath = path.join(config.dziDir, `${uniqueName}.dzi`);
          const hasDzi = fs.existsSync(dziPath);
          
          // Metadata-derived assets
          const metadataDir = path.join(config.dziDir, 'metadata');
          const labelFs = path.join(metadataDir, `${uniqueName}_label.jpg`);
          const macroFs = path.join(metadataDir, `${uniqueName}_macro.jpg`);
          const metadataJsonPath = path.join(metadataDir, `${uniqueName}_metadata.json`);
          const labelUrl = fs.existsSync(labelFs) ? `/dzi/metadata/${uniqueName}_label.jpg` : null;
          const macroUrl = fs.existsSync(macroFs) ? `/dzi/metadata/${uniqueName}_macro.jpg` : null;
          const thumbnailUrl = macroUrl || labelUrl || null;
          
          // Read metadata JSON if it exists
          let metadata = null;
          let slideLabel = null;
          if (fs.existsSync(metadataJsonPath)) {
            try {
              const metadataContent = fs.readFileSync(metadataJsonPath, 'utf8');
              metadata = JSON.parse(metadataContent);
              slideLabel = metadata.label || metadata.description || metadata.title || null;
            } catch (error) {
              console.warn(`Failed to read metadata for ${uniqueName}:`, error.message);
            }
          }
          
          slideFiles.push({
            name: uniqueName,
            originalName: baseName,
            folder: relativePath || 'root',
            originalFile: `/slides/${relativeFilePath.replace(/\\/g, '/')}`,
            dziFile: hasDzi ? `/dzi/${uniqueName}.dzi` : null,
            format: ext,
            converted: hasDzi,
            size: fs.statSync(fullPath).size,
            labelUrl,
            macroUrl,
            thumbnailUrl,
            label: slideLabel,
            metadata
          });
        }
      }
    });
  }
  
  scanSlidesRecursively(config.slidesDir);
  
  // Check for standalone DZI files
  if (fs.existsSync(config.dziDir)) {
    const dziFiles = fs.readdirSync(config.dziDir).filter(file => file.endsWith('.dzi'));
    dziFiles.forEach(file => {
      const baseName = path.basename(file, '.dzi');
      const existing = slideFiles.find(slide => slide.name === baseName);
      
      if (!existing) {
        // Metadata-derived assets for standalone DZI
        const metadataDir = path.join(config.dziDir, 'metadata');
        const labelFs = path.join(metadataDir, `${baseName}_label.jpg`);
        const macroFs = path.join(metadataDir, `${baseName}_macro.jpg`);
        const labelUrl = fs.existsSync(labelFs) ? `/dzi/metadata/${baseName}_label.jpg` : null;
        const macroUrl = fs.existsSync(macroFs) ? `/dzi/metadata/${baseName}_macro.jpg` : null;
        const thumbnailUrl = macroUrl || labelUrl || null;
        slideFiles.push({
          name: baseName,
          originalFile: null,
          dziFile: `/dzi/${file}`,
          format: '.dzi',
          converted: true,
          size: 0,
          labelUrl,
          macroUrl,
          thumbnailUrl
        });
      }
    });
  }
  
  console.log('Found slides:', slideFiles);
  res.json(slideFiles);
});

// Serve slide files directly
app.get('/slides/*', async (req, res) => {
  const filename = req.params[0]; // Use wildcard to capture full path including subfolders
  
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

  // Server mode - handle subfolder paths
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
  // Ensure CORS headers are present on DZI XML and tile JPG responses
  // Use credentials: false for static so wildcard ACAO is permitted if configured by proxies
  const dziCors = cors({ origin: (origin, cb) => cb(null, true), credentials: false });
  // Manual header guard to ensure headers are present even if upstream/proxy interferes
  const dziHeaders = (req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Range');
    return req.method === 'OPTIONS' ? res.sendStatus(204) : next();
  };

  // Serve static files with optimized settings for tile serving priority
  const staticOptions = {
    maxAge: '1d', // Cache tiles for better performance
    etag: true,
    lastModified: true,
    setHeaders: (res, path) => {
      // Prioritize tile serving responses
      if (path.includes('_files/') || path.endsWith('.dzi')) {
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.setHeader('X-Priority', 'high');
      }
    }
  };

  app.use('/dzi', dziHeaders, dziCors, express.static(config.dziDir, staticOptions));
  app.use('/slides', express.static(config.slidesDir, staticOptions));
  // Explicit preflight
  app.options('/dzi/*', dziCors, (req, res) => res.sendStatus(204));
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

// API endpoint to cancel conversion
app.post('/api/convert/:filename/cancel', async (req, res) => {
  const filename = req.params.filename;
  const baseName = path.basename(filename, path.extname(filename));
  
  if (config.isClientMode()) {
    // Proxy cancel request to lab server
    try {
      const result = await labClient.cancelConversion(baseName);
      res.json(result);
    } catch (error) {
      res.status(503).json({ error: 'Lab server unavailable', details: error.message });
    }
    return;
  }

  // Server mode - cancel conversion
  const conversion = activeConversions.get(baseName);
  if (!conversion) {
    return res.status(404).json({ error: 'No active conversion found for this file' });
  }

  try {
    console.log(`Cancelling conversion of ${filename}...`);
    
    // Kill all active processes more aggressively on Windows
    const killPromises = conversion.processes.map(proc => {
      return new Promise((resolve) => {
        if (!proc || proc.killed) {
          resolve();
          return;
        }
        
        console.log(`Killing process PID ${proc.pid} with SIGTERM`);
        
        // On Windows, use taskkill for more reliable process termination
        if (process.platform === 'win32') {
          try {
            // Kill the process tree to ensure all child processes are terminated
            exec(`taskkill /F /T /PID ${proc.pid}`, (error) => {
              if (error) {
                console.log(`taskkill failed for PID ${proc.pid}, trying Node.js kill`);
                try {
                  proc.kill('SIGKILL');
                } catch (killError) {
                  console.log(`Node.js kill also failed for PID ${proc.pid}:`, killError.message);
                }
              } else {
                console.log(`Successfully killed process tree for PID ${proc.pid}`);
              }
              resolve();
            });
          } catch (error) {
            console.log(`taskkill command failed, falling back to Node.js kill:`, error.message);
            proc.kill('SIGTERM');
            resolve();
          }
        } else {
          // Unix-like systems
          proc.kill('SIGTERM');
          
          // Force kill after 2 seconds if still running
          setTimeout(() => {
            if (proc && !proc.killed) {
              console.log(`Force killing process PID ${proc.pid} with SIGKILL`);
              proc.kill('SIGKILL');
            }
            resolve();
          }, 2000);
        }
      });
    });
    
    // Wait for all processes to be killed before proceeding
    await Promise.all(killPromises);
    
    // Clear progress timer
    if (conversion.progressTimer) {
      clearInterval(conversion.progressTimer);
    }
    
    // Wait a moment for processes to fully terminate before cleanup
    setTimeout(async () => {
      console.log(`Cleaning up partial files for ${baseName}...`);
      
      // Clean up partial files immediately and thoroughly
      const outputPath = path.join(config.dziDir, `${baseName}.dzi`);
      const tilesDir = path.join(config.dziDir, `${baseName}_files`);
      const tempFiles = [
        outputPath,
        tilesDir,
        path.join(__dirname, `temp_srgb_${conversion.startTime}.v`),
        path.join(__dirname, `temp_stream_${conversion.startTime}.v`)
      ];
      
      // Delete partial files with retry logic for Windows file locking
      const deletePromises = tempFiles.map(filePath => 
        deleteFileWithRetry(filePath, 5).catch(error => 
          console.warn(`Failed to delete ${filePath}:`, error.message)
        )
      );
      await Promise.all(deletePromises);
      
      // Also clean up any other temp files that might be related
      try {
        const tempPattern = new RegExp(`temp_.*_${conversion.startTime}\\.v$`);
        const files = fs.readdirSync(__dirname);
        for (const file of files) {
          if (tempPattern.test(file)) {
            const tempPath = path.join(__dirname, file);
            try {
              fs.unlinkSync(tempPath);
              console.log(`Cleaned up temp file: ${file}`);
            } catch (error) {
              console.warn(`Failed to clean up temp file ${file}:`, error.message);
            }
          }
        }
      } catch (error) {
        console.warn(`Failed to clean up additional temp files:`, error.message);
      }
    }, 3000); // Wait 3 seconds for processes to fully terminate
    
    // Remove from tracking immediately to stop progress updates
    activeConversions.delete(baseName);
    
    // Stop any ongoing progress monitoring
    console.log(`Stopping progress monitoring for ${baseName}`);
    
    // Mark file as cancelled to prevent autoprocessor from re-processing
    const originalFile = path.join(config.slidesDir, `${baseName}.svs`);
    const cancelledFlagFile = path.join(config.slidesDir, `.${actualBaseName}.cancelled`);
    
    try {
      fs.writeFileSync(cancelledFlagFile, JSON.stringify({
        cancelledAt: new Date().toISOString(),
        originalFile: originalFile,
        reason: 'User cancelled conversion'
      }));
      console.log(`Created cancellation flag: ${cancelledFlagFile}`);
    } catch (error) {
      console.warn(`Failed to create cancellation flag: ${error.message}`);
    }
    
    // Notify clients immediately
    broadcastToClients({
      type: 'conversion_cancelled',
      filename: baseName
    });
    
    res.json({ message: 'Conversion cancelled successfully', filename: baseName });
    
  } catch (error) {
    console.error(`Failed to cancel conversion: ${error}`);
    res.status(500).json({ error: 'Failed to cancel conversion', details: error.message });
  }
});

// API endpoint to kill hanging VIPS processes
app.post('/api/kill-vips-processes', async (req, res) => {
  try {
    console.log('Manual VIPS process termination requested');
    await killVipsProcesses();
    res.json({ message: 'VIPS processes terminated successfully' });
  } catch (error) {
    console.error('Error killing VIPS processes:', error);
    res.status(500).json({ error: 'Failed to kill VIPS processes', details: error.message });
  }
});

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
    // Find the actual slide file by searching through the slides directory
    let actualSlidePath = null;
    let actualBaseName = null;
    let actualRelativePath = null;
    
    // Search recursively for the file that matches this unique name
    function findSlideFile(dir, relativePath = '') {
      if (!fs.existsSync(dir)) return false;
      
      const items = fs.readdirSync(dir, { withFileTypes: true });
      const supportedFormats = ['.svs', '.ndpi', '.tif', '.tiff', '.jp2', '.vms', '.vmu', '.scn'];
      
      for (const item of items) {
        const fullPath = path.join(dir, item.name);
        const relativeFilePath = path.join(relativePath, item.name);
        
        if (item.isDirectory()) {
          // Recursively search subdirectories
          if (findSlideFile(fullPath, relativeFilePath)) {
            return true; // Found in subdirectory
          }
        } else if (item.isFile()) {
          const ext = path.extname(item.name).toLowerCase();
          if (supportedFormats.includes(ext)) {
            const baseName = path.basename(item.name, ext);
            const uniqueName = relativePath ? `${relativePath.replace(/[\\\/]/g, '_')}_${baseName}` : baseName;
            
            console.log(`Checking file: ${relativeFilePath}, uniqueName: ${uniqueName}, looking for: ${filename}`);
            
            if (uniqueName === filename) {
              actualSlidePath = fullPath;
              actualBaseName = uniqueName;
              actualRelativePath = relativeFilePath;
              console.log(`Found matching slide: ${actualSlidePath}`);
              return true;
            }
          }
        }
      }
      return false;
    }
    
    findSlideFile(config.slidesDir);
    
    // If original slide file not found, use the filename directly as the base name
    // This allows deletion of DZI/metadata files even when original slide is missing
    if (!actualSlidePath) {
      actualBaseName = filename; // Use the provided filename as the base name
      console.log(`Original slide file not found for ${filename}, proceeding with DZI/metadata cleanup only`);
    }
    
    // Define file paths
    const dziPath = path.join(config.dziDir, `${actualBaseName}.dzi`);
    const tilesDir = path.join(config.dziDir, `${actualBaseName}_files`);
    
    // Metadata files
    const metadataDir = path.join(config.dziDir, 'metadata');
    const labelPath = path.join(metadataDir, `${actualBaseName}_label.jpg`);
    const macroPath = path.join(metadataDir, `${actualBaseName}_macro.jpg`);
    const metadataJsonPath = path.join(metadataDir, `${actualBaseName}_metadata.json`);
    
    let deletedFiles = [];
    
    // Delete original slide file with retry logic for locked files (only if it exists)
    if (actualSlidePath && fs.existsSync(actualSlidePath)) {
      try {
        await deleteFileWithRetry(actualSlidePath, 5); // 5 retries with 3 second delays
        deletedFiles.push('original');
      } catch (error) {
        // If deletion fails, offer manual process termination
        console.error(`Failed to delete ${actualSlidePath} after retries:`, error.message);
        res.status(423).json({ 
          error: 'File is locked by running processes', 
          details: error.message,
          suggestion: 'Try using the "Kill VIPS Processes" button and then delete again',
          filename: filename
        });
        return;
      }
    }
    
    // Delete DZI file
    if (fs.existsSync(dziPath)) {
      fs.unlinkSync(dziPath);
      deletedFiles.push('dzi');
    }
    
    // Delete metadata files
    if (fs.existsSync(labelPath)) {
      fs.unlinkSync(labelPath);
      deletedFiles.push('label');
    }
    
    if (fs.existsSync(macroPath)) {
      fs.unlinkSync(macroPath);
      deletedFiles.push('macro');
    }
    
    if (fs.existsSync(metadataJsonPath)) {
      fs.unlinkSync(metadataJsonPath);
      deletedFiles.push('metadata');
    }
    
    // Delete cancellation flag if it exists
    const cancelledFlagFile = path.join(config.slidesDir, `.${actualBaseName}.cancelled`);
    if (fs.existsSync(cancelledFlagFile)) {
      fs.unlinkSync(cancelledFlagFile);
      deletedFiles.push('cancellation-flag');
      console.log(`Deleted cancellation flag: ${cancelledFlagFile}`);
    }
    
    // Delete tiles directory (fully asynchronous to prevent blocking)
    if (fs.existsSync(tilesDir)) {
      // Immediately rename tiles directory to mark for deletion (this is fast)
      const tempDeleteDir = path.join(config.dziDir, `__delete_${actualBaseName}_${Date.now()}`);
      try {
        fs.renameSync(tilesDir, tempDeleteDir);
        deletedFiles.push('tiles');

        // Directory renamed for deletion - actual cleanup handled by periodic process
        console.log(`Marked for deletion: ${tempDeleteDir}`);

      } catch (renameError) {
        // Fallback to original method if initial rename fails
        console.warn(`Fast deletion failed, falling back to standard method:`, renameError);
        setImmediate(() => {
          fs.rmSync(tilesDir, { recursive: true, force: true });
        });
        deletedFiles.push('tiles');
      }
    }
    
    console.log(`Deleted slide: ${filename} (${deletedFiles.join(', ')})`);
    
    // Check if we actually deleted anything
    if (deletedFiles.length === 0) {
      return res.status(404).json({ 
        error: 'No files found to delete',
        message: `No DZI, metadata, or original files found for ${filename}`
      });
    }

    // Clear from auto-processor tracking if it exists
    if (autoProcessor && typeof autoProcessor.clearProcessedFile === 'function') {
      autoProcessor.clearProcessedFile(actualSlidePath || actualBaseName);
    }
    
    // Clear from conversion server tracking
    try {
      // Cancel any active conversion for this slide
      if (activeConversions && activeConversions.has(actualBaseName)) {
        activeConversions.delete(actualBaseName);
      }
      
      // Clear from conversion server completed tracking
      const conversionServerUrl = config.conversionServerUrl || 'http://localhost:3001';
      console.log(`Clearing conversion server tracking for: ${actualBaseName}`);
      try {
        const response = await fetch(`${conversionServerUrl}/clear/${encodeURIComponent(actualBaseName)}`, { 
          method: 'DELETE',
          timeout: 3000 
        });
        if (response.ok) {
          console.log(`✅ Cleared conversion server tracking for: ${actualBaseName}`);
        } else {
          console.warn(`⚠️ Failed to clear conversion server tracking: ${response.status}`);
        }
      } catch (fetchError) {
        console.warn(`⚠️ Conversion server unavailable for clearing: ${fetchError.message}`);
      }
    } catch (error) {
      console.warn('Failed to clear conversion server tracking:', error.message);
    }

    // Broadcast deletion to WebSocket clients
    broadcastToClients({
      type: 'slide_deleted',
      filename: actualBaseName,
      deletedComponents: deletedFiles
    });
    
    res.json({ 
      success: true,
      message: 'Slide deleted successfully', 
      filename: actualBaseName,
      deletedComponents: deletedFiles 
    });
    
  } catch (error) {
    console.error('Error deleting slide:', error);
    res.status(500).json({ error: 'Failed to delete slide', details: error.message });
  }
});

// Common conversion function used by both manual and auto conversions
async function startConversion(filename, isAutoConversion = false) {
  const svsPath = path.join(config.slidesDir, filename);
  
  if (!fs.existsSync(svsPath)) {
    throw new Error('Slide file not found');
  }
  
  const baseName = path.basename(filename, path.extname(filename));
  
  // Check if conversion is already running for this file
  if (activeConversions.has(baseName)) {
    throw new Error('Conversion already in progress for this file');
  }
  
  console.log(`Starting ${isAutoConversion ? 'auto-' : 'manual '}conversion of ${filename}...`);
  
  // Notify clients that conversion started
  broadcastToClients({
    type: isAutoConversion ? 'auto_processing_started' : 'conversion_started',
    filename: baseName
  });
  
  // Use optimized auto-processor for both manual and auto conversions
  if (autoProcessor && autoProcessor.conversionClient) {
    try {
      // Track conversion
      activeConversions.set(baseName, {
        processes: [],
        progressTimer: null,
        startTime: Date.now(),
        outputName: baseName
      });

      // Start conversion using optimized conversion server
      const result = await autoProcessor.conversionClient.startConversion(
        svsPath,
        baseName,
        config.slidesDir,
        config.dziDir
      );
      
      console.log(`Optimized conversion queued: ${baseName} (position: ${result.queuePosition})`);
      
      // Set up progress polling for manual conversions
      if (!isAutoConversion) {
        // Create a temporary event listener for this specific manual conversion
        const manualProgressHandler = (data) => {
          if (data.fileName === baseName || data.filename === baseName || data.baseName === baseName) {
            console.log(`Manual conversion progress: ${baseName} - ${data.phase} ${data.percent}%`);
            broadcastToClients({
              type: 'conversion_progress',
              filename: baseName,
              fileName: baseName,
              baseName: baseName,
              phase: data.phase,
              percent: data.percent,
              isAutoConversion: false
            });
          }
        };
        
        const manualCompleteHandler = (data) => {
          if (data.fileName === baseName || data.filename === baseName || data.baseName === baseName) {
            console.log(`Manual conversion completed: ${baseName}`);
            broadcastToClients({
              type: 'conversion_complete',
              filename: baseName,
              fileName: baseName,
              baseName: baseName,
              success: data.success
            });
            // Clean up event listeners
            autoProcessor.conversionClient.removeListener('conversionProgress', manualProgressHandler);
            autoProcessor.conversionClient.removeListener('conversionCompleted', manualCompleteHandler);
            autoProcessor.conversionClient.removeListener('conversionError', manualErrorHandler);
            activeConversions.delete(baseName);
          }
        };
        
        const manualErrorHandler = (data) => {
          if (data.fileName === baseName || data.filename === baseName || data.baseName === baseName) {
            console.log(`Manual conversion error: ${baseName} - ${data.error}`);
            broadcastToClients({
              type: 'conversion_error',
              filename: baseName,
              fileName: baseName,
              baseName: baseName,
              error: data.error
            });
            // Clean up event listeners
            autoProcessor.conversionClient.removeListener('conversionProgress', manualProgressHandler);
            autoProcessor.conversionClient.removeListener('conversionCompleted', manualCompleteHandler);
            autoProcessor.conversionClient.removeListener('conversionError', manualErrorHandler);
            activeConversions.delete(baseName);
          }
        };
        
        // Add event listeners for this manual conversion
        autoProcessor.conversionClient.on('conversionProgress', manualProgressHandler);
        autoProcessor.conversionClient.on('conversionCompleted', manualCompleteHandler);
        autoProcessor.conversionClient.on('conversionError', manualErrorHandler);
        
        autoProcessor.conversionClient.startProgressPolling(baseName);
      }
      
      return { 
        message: 'Conversion started', 
        status: result.queuePosition > 1 ? 'queued' : 'processing', 
        queuePosition: result.queuePosition,
        baseName: baseName
      };
      
    } catch (error) {
      activeConversions.delete(baseName);
      throw error;
    }
  }
  
  // Fallback to old worker pool system if optimized processor not available
  if (!workerPool) {
    const WorkerPool = require('./workerPool');
    workerPool = new WorkerPool(3);
    
    // Set up worker pool event forwarding for manual conversions
    workerPool.on('conversionStarted', (data) => {
      console.log(`Manual conversion started: ${data.fileName}`);
      broadcastToClients({
        type: 'conversion_started',
        filename: data.baseName || data.fileName
      });
    });
    
    workerPool.on('conversionProgress', (data) => {
      console.log(`Manual conversion progress: ${data.fileName} - ${data.phase} ${data.percent}%`);
      broadcastToClients({
        type: 'conversion_progress',
        filename: data.baseName || data.fileName,
        phase: data.phase,
        percent: data.percent,
        vipsPercent: data.percent,
        elapsedMs: data.elapsedMs
      });
    });
    
    workerPool.on('conversionCompleted', (data) => {
      console.log(`Manual conversion completed: ${data.fileName}`);
      broadcastToClients({
        type: 'conversion_complete',
        filename: data.baseName || data.fileName,
        dziPath: `/dzi/${data.baseName || data.fileName}.dzi`
      });
    });
    
    workerPool.on('conversionError', (data) => {
      console.log(`Manual conversion error: ${data.fileName} - ${data.error}`);
      broadcastToClients({
        type: 'conversion_error',
        filename: data.baseName || data.fileName,
        error: data.error
      });
    });
  }

  // Track conversion
  activeConversions.set(baseName, {
    processes: [],
    progressTimer: null,
    startTime: Date.now(),
    outputName: baseName
  });

  const fileInfo = {
    fileName: filename,
    filePath: svsPath,
    baseName: baseName,
    retryCount: 0
  };

  // Create VIPS configuration
  const VipsConfig = require('./vips-config');
  const vipsConfig = new VipsConfig();
  
  workerPool.processSlide(
    fileInfo,
    {
      slidesDir: config.slidesDir,
      dziDir: config.dziDir
    },
    {
      env: {
        ...process.env,
        ...vipsConfig.getEnvironmentVars()
      },
      concurrency: vipsConfig.optimalThreads
    }
  ).then(async (result) => {
    console.log(`Conversion completed: ${result.success ? 'SUCCESS' : 'FAILED'}`);
    // Clean up tracking
    activeConversions.delete(baseName);
    
    if (result.success) {
      // Check if auto-delete is enabled and delete original file
      if (config.autoDeleteOriginal) {
        try {
          const originalPath = path.join(config.slidesDir, filename);
          if (fs.existsSync(originalPath)) {
            await deleteFileWithRetry(originalPath, 3);
            console.log(`Auto-deleted original file: ${filename}`);
            broadcastToClients({
              type: 'conversion_auto_delete',
              filename: baseName,
              originalFile: filename
            });
          }
        } catch (error) {
          console.warn(`Failed to auto-delete original file ${filename}:`, error.message);
        }
      }
      
      // Notify connected WebSocket clients
      broadcastToClients({
        type: 'conversion_complete',
        filename: baseName,
        dziPath: `/dzi/${baseName}.dzi`
      });
    } else {
      broadcastToClients({
        type: 'conversion_error',
        filename: baseName,
        error: result.error || 'Conversion failed'
      });
    }
  }).catch(error => {
    console.error(`Conversion failed for ${filename}:`, error);
    activeConversions.delete(baseName);
    broadcastToClients({
      type: 'conversion_error',
      filename: baseName,
      error: error.message
    });
  });
    
  return { message: 'Conversion started', status: 'processing' };
}

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

  try {
    const result = await startConversion(filename, false);
    res.json(result);
  } catch (error) {
    console.error('Conversion error:', error);
    res.status(500).json({ error: 'Conversion failed', details: error.message });
  }
});

// API endpoint to rename a slide
app.put('/api/slides/:filename/rename', async (req, res) => {
  const filename = req.params.filename;
  const { newName } = req.body;
  
  if (!newName || !newName.trim()) {
    return res.status(400).json({ error: 'New name is required' });
  }
  
  if (config.isClientMode()) {
    // Proxy rename request to lab server
    try {
      const result = await labClient.renameSlide(filename, newName.trim());
      res.json(result);
    } catch (error) {
      res.status(503).json({ error: 'Lab server unavailable', details: error.message });
    }
    return;
  }

  // Server mode - rename slide and associated files
  try {
    // Find the actual slide file by searching through the slides directory
    let actualSlidePath = null;
    let actualBaseName = null;
    let actualRelativePath = null;
    
    // Search recursively for the file that matches this unique name
    function findSlideFile(dir, relativePath = '') {
      if (!fs.existsSync(dir)) return false;
      
      const items = fs.readdirSync(dir, { withFileTypes: true });
      const supportedFormats = ['.svs', '.ndpi', '.tif', '.tiff', '.jp2', '.vms', '.vmu', '.scn'];
      
      for (const item of items) {
        const fullPath = path.join(dir, item.name);
        const relativeFilePath = path.join(relativePath, item.name);
        
        if (item.isDirectory()) {
          if (findSlideFile(fullPath, relativeFilePath)) {
            return true;
          }
        } else if (item.isFile()) {
          const ext = path.extname(item.name).toLowerCase();
          if (supportedFormats.includes(ext)) {
            const baseName = path.basename(item.name, ext);
            const uniqueName = relativePath ? `${relativePath.replace(/[\\\/]/g, '_')}_${baseName}` : baseName;
            
            if (uniqueName === filename) {
              actualSlidePath = fullPath;
              actualBaseName = uniqueName;
              actualRelativePath = relativeFilePath;
              return true;
            }
          }
        }
      }
      return false;
    }
    
    findSlideFile(config.slidesDir);
    
    if (!actualSlidePath) {
      return res.status(404).json({ error: 'Slide file not found' });
    }
    
    // Generate new unique name
    const slideDir = path.dirname(actualSlidePath);
    const originalExt = path.extname(actualSlidePath);
    const newFileName = `${newName.trim()}${originalExt}`;
    const newSlidePath = path.join(slideDir, newFileName);
    
    // Check if new name already exists
    if (fs.existsSync(newSlidePath)) {
      return res.status(409).json({ error: 'A slide with this name already exists' });
    }
    
    // Calculate new unique name for DZI files
    const relativeDirPath = path.relative(config.slidesDir, slideDir);
    const newBaseName = path.basename(newFileName, originalExt);
    const newUniqueName = relativeDirPath ? `${relativeDirPath.replace(/[\\\/]/g, '_')}_${newBaseName}` : newBaseName;
    
    // Rename original slide file
    fs.renameSync(actualSlidePath, newSlidePath);
    
    // Rename associated DZI files if they exist
    const oldDziPath = path.join(config.dziDir, `${actualBaseName}.dzi`);
    const oldTilesDir = path.join(config.dziDir, `${actualBaseName}_files`);
    const newDziPath = path.join(config.dziDir, `${newUniqueName}.dzi`);
    const newTilesDir = path.join(config.dziDir, `${newUniqueName}_files`);
    
    if (fs.existsSync(oldDziPath)) {
      fs.renameSync(oldDziPath, newDziPath);
    }
    
    if (fs.existsSync(oldTilesDir)) {
      fs.renameSync(oldTilesDir, newTilesDir);
    }
    
    // Rename metadata files
    const metadataDir = path.join(config.dziDir, 'metadata');
    const oldLabelPath = path.join(metadataDir, `${actualBaseName}_label.jpg`);
    const oldMacroPath = path.join(metadataDir, `${actualBaseName}_macro.jpg`);
    const oldMetadataJsonPath = path.join(metadataDir, `${actualBaseName}_metadata.json`);
    const newLabelPath = path.join(metadataDir, `${newUniqueName}_label.jpg`);
    const newMacroPath = path.join(metadataDir, `${newUniqueName}_macro.jpg`);
    const newMetadataJsonPath = path.join(metadataDir, `${newUniqueName}_metadata.json`);
    
    if (fs.existsSync(oldLabelPath)) {
      fs.renameSync(oldLabelPath, newLabelPath);
    }
    
    if (fs.existsSync(oldMacroPath)) {
      fs.renameSync(oldMacroPath, newMacroPath);
    }
    
    if (fs.existsSync(oldMetadataJsonPath)) {
      fs.renameSync(oldMetadataJsonPath, newMetadataJsonPath);
    }
    
    // Check if we actually deleted anything
    if (deletedComponents.length === 0) {
      return res.status(404).json({ 
        error: 'No files found to delete',
        message: `No DZI, metadata, or original files found for ${filename}`
      });
    }

    res.json({ 
      success: true, 
      filename: actualBaseName,
      deletedComponents,
      message: deletedComponents.length > 0 ? `Deleted: ${deletedComponents.join(', ')}` : 'No files found to delete'
    });
    
  } catch (error) {
    console.error('Error renaming slide:', error);
    res.status(500).json({ error: 'Failed to rename slide', details: error.message });
  }
});

// API endpoint to generate label/thumbnail for a slide
app.post('/api/slides/:filename/generate-thumbnail', async (req, res) => {
  const filename = req.params.filename;
  
  if (config.isClientMode()) {
    return res.status(501).json({ error: 'Thumbnail generation not available in client mode' });
  }

  try {
    // Find the slide file
    let actualSlidePath = null;
    let actualBaseName = null;
    
    function findSlideFile(dir, relativePath = '') {
      if (!fs.existsSync(dir)) return false;
      
      const items = fs.readdirSync(dir, { withFileTypes: true });
      const supportedFormats = ['.svs', '.ndpi', '.tif', '.tiff', '.jp2', '.vms', '.vmu', '.scn'];
      
      for (const item of items) {
        const fullPath = path.join(dir, item.name);
        const relativeFilePath = path.join(relativePath, item.name);
        
        if (item.isDirectory()) {
          if (findSlideFile(fullPath, relativeFilePath)) {
            return true;
          }
        } else {
          const ext = path.extname(item.name).toLowerCase();
          if (supportedFormats.includes(ext)) {
            const baseName = path.basename(item.name, ext);
            const uniqueName = relativePath ? `${relativePath.replace(/[\\\/]/g, '_')}_${baseName}` : baseName;
            
            if (uniqueName === filename) {
              actualSlidePath = fullPath;
              actualBaseName = uniqueName;
              return true;
            }
          }
        }
      }
      return false;
    }
    
    findSlideFile(config.slidesDir);
    
    if (!actualSlidePath) {
      return res.status(404).json({ error: 'Slide file not found' });
    }

    // Generate thumbnail using slideMetadataExtractor
    const slideMetadataExtractor = require('./slideMetadataExtractor');
    const metadataDir = path.join(config.dziDir, 'metadata');
    
    if (!fs.existsSync(metadataDir)) {
      fs.mkdirSync(metadataDir, { recursive: true });
    }

    await slideMetadataExtractor.extractMetadata(actualSlidePath, actualBaseName, metadataDir);
    
    // Check what was generated
    const labelPath = path.join(metadataDir, `${actualBaseName}_label.jpg`);
    const macroPath = path.join(metadataDir, `${actualBaseName}_macro.jpg`);
    
    const labelUrl = fs.existsSync(labelPath) ? `/dzi/metadata/${actualBaseName}_label.jpg` : null;
    const macroUrl = fs.existsSync(macroPath) ? `/dzi/metadata/${actualBaseName}_macro.jpg` : null;
    const thumbnailUrl = macroUrl || labelUrl || null;

    res.json({
      success: true,
      labelUrl,
      macroUrl,
      thumbnailUrl,
      message: 'Thumbnail generated successfully'
    });

  } catch (error) {
    console.error('Error generating thumbnail:', error);
    res.status(500).json({ error: 'Failed to generate thumbnail', details: error.message });
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

// Cleanup function to remove leftover __delete_ directories
function cleanupDeleteDirectories() {
  try {
    const dziDir = config.dziDir;
    if (!fs.existsSync(dziDir)) return;
    
    const entries = fs.readdirSync(dziDir, { withFileTypes: true });
    const deleteDirectories = entries.filter(entry => 
      entry.isDirectory() && entry.name.startsWith('__delete_')
    );
    
    if (deleteDirectories.length > 0) {
      console.log(`Found ${deleteDirectories.length} leftover __delete_ directories, cleaning up...`);
      
      deleteDirectories.forEach(dir => {
        const deletePath = path.join(dziDir, dir.name);
        try {
          if (process.platform === 'win32') {
            const { exec } = require('child_process');
            exec(`rmdir /s /q "${deletePath}"`, (error) => {
              if (error) {
                console.warn(`Failed to cleanup ${dir.name}:`, error.message);
              } else {
                console.log(`Cleaned up: ${dir.name}`);
              }
            });
          } else {
            fs.rmSync(deletePath, { recursive: true, force: true });
            console.log(`Cleaned up: ${dir.name}`);
          }
        } catch (error) {
          console.warn(`Failed to cleanup ${dir.name}:`, error.message);
        }
      });
    }
  } catch (error) {
    console.warn('Error during __delete_ directory cleanup:', error.message);
  }
}

// Create HTTP server
const server = app.listen(PORT, async () => {
  console.log(`\n=== PATHOLOGY SLIDE VIEWER ===`);
  console.log(`Mode: ${config.mode.toUpperCase()}`);
  console.log(`🌐 Main Server: http://localhost:${PORT}`);
  
  // Check conversion server connection status
  if (config.isServerMode() && autoProcessor) {
    try {
      const health = await autoProcessor.conversionClient.getHealth();
      console.log(`🔧 Conversion Server: http://localhost:3001 ✅ CONNECTED`);
      console.log(`   └─ Max Concurrent: ${health.maxConcurrent} | Active: ${health.activeConversions} | Queue: ${health.queueLength}`);
    } catch (error) {
      console.log(`🔧 Conversion Server: http://localhost:3001 ❌ DISCONNECTED`);
      console.log(`   └─ Error: ${error.message}`);
    }
  }
  
  if (config.isClientMode()) {
    console.log(`🏥 Lab Server: ${config.labServer.url}`);
  }
  
  console.log(`Configuration:`, config.getSummary());
  console.log(`=============================\n`);
  
  // Clean up any leftover __delete_ directories on startup
  cleanupDeleteDirectories();
  
  // Set up periodic cleanup every 5 minutes when idle
  setInterval(() => {
    cleanupDeleteDirectories();
  }, 5 * 60 * 1000);
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
  
  // Send current active conversions to restore progress bars on refresh
  if (activeConversions.size > 0) {
    activeConversions.forEach((conversionData, baseName) => {
      // Send conversion_started to trigger UI setup
      ws.send(JSON.stringify({
        type: 'conversion_started',
        filename: baseName
      }));
      
      // Also send current progress if available
      if (conversionData.lastProgress) {
        ws.send(JSON.stringify({
          type: 'conversion_progress',
          filename: baseName,
          ...conversionData.lastProgress
        }));
      }
    });
    console.log(`Sent ${activeConversions.size} active conversion states to new client`);
  }
  
  ws.on('close', () => {
    console.log('Client disconnected');
  });
});

// Initialize auto-processor in server mode (already declared at top)
if (config.isServerMode()) {
  const OptimizedAutoProcessor = require('./optimized-auto-processor');
  autoProcessor = new OptimizedAutoProcessor(config.slidesDir, {
    enabled: true,
    conversionServerUrl: 'http://localhost:3001'
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

  autoProcessor.on('processingStarted', (data) => {
    console.log(`Auto-processing started: ${data.fileName}`);
    broadcastToClients({
      type: 'auto_processing_started',
      filename: data.fileName || data.filename,
      fileName: data.fileName,
      baseName: data.baseName
    });
  });

  autoProcessor.on('conversionProgress', (data) => {
    console.log(`Auto-processing progress: ${data.fileName} - ${data.phase} ${data.percent}%`);
    broadcastToClients({
      type: 'conversion_progress',
      filename: data.fileName || data.filename,
      fileName: data.fileName,
      baseName: data.baseName,
      phase: data.phase,
      percent: data.percent,
      isAutoConversion: true
    });
  });

  autoProcessor.on('fileProcessed', async (data) => {
    console.log(`Auto-processing completed: ${data.fileName} - ${data.success ? 'SUCCESS' : 'FAILED'}`);
    console.log(`Auto-delete config: ${config.autoDeleteOriginal}, filePath: ${data.filePath}`);
    
    if (data.success) {
      // Check if auto-delete is enabled and delete original file
      if (config.autoDeleteOriginal && data.filePath) {
        try {
          console.log(`Attempting to auto-delete: ${data.filePath}`);
          if (fs.existsSync(data.filePath)) {
            await deleteFileWithRetry(data.filePath, 3);
            console.log(`✅ Auto-deleted original file: ${data.fileName}`);
            broadcastToClients({
              type: 'conversion_auto_delete',
              filename: data.baseName,
              originalFile: data.fileName
            });
          } else {
            console.warn(`⚠️ Original file not found for auto-delete: ${data.filePath}`);
          }
        } catch (error) {
          console.warn(`❌ Failed to auto-delete original file ${data.fileName}:`, error.message);
        }
      } else {
        console.log(`Auto-delete skipped - enabled: ${config.autoDeleteOriginal}, filePath: ${!!data.filePath}`);
      }
      
      broadcastToClients({
        type: 'conversion_complete',
        fileName: data.fileName,
        baseName: data.baseName,
        dziPath: `/dzi/${data.baseName}.dzi`,
        isAutoConversion: true
      });
    } else {
      broadcastToClients({
        type: 'conversion_error',
        fileName: data.fileName,
        baseName: data.baseName,
        error: data.error || 'Auto-conversion failed',
        isAutoConversion: true
      });
    }
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
