require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const cors = require('cors');
const { spawn, exec, execSync } = require('child_process');
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
          setTimeout(attemptDelete, 3000);
        } else {
          console.warn(`Failed to delete ${filePath}:`, error.message);
          reject(error);
        }
      }
    };
    attemptDelete();
  });
}

// Cleanup function to remove leftover __delete_ directories
function cleanupDeleteDirectories() {
  try {
    const dziDir = config.dziDir;
    if (!fs.existsSync(dziDir)) return;
    
    const entries = fs.readdirSync(dziDir, { withFileTypes: true });
    const deleteDirectories = entries.filter(entry => 
      entry.isDirectory() && (
        entry.name.startsWith('__delete_') || 
        entry.name.startsWith('__deleted_') ||
        entry.name.startsWith('__backup_')
      )
    );
    
    if (deleteDirectories.length > 0) {
      console.log(`Found ${deleteDirectories.length} leftover __delete_ directories, cleaning up...`);
      
      deleteDirectories.forEach(dir => {
        const deletePath = path.join(dziDir, dir.name);
        try {
          fs.rmSync(deletePath, { recursive: true, force: true });
          console.log(`Cleaned up: ${dir.name}`);
        } catch (error) {
          console.warn(`Failed to cleanup ${dir.name}:`, error.message);
          if (process.platform === 'win32') {
            try {
              console.log(`Taking ownership of ${dir.name}...`);
              execSync(`takeown /f "${deletePath}" /r /d y`, { timeout: 30000, stdio: 'ignore' });
              execSync(`icacls "${deletePath}" /grant administrators:F /t`, { timeout: 30000, stdio: 'ignore' });
              execSync(`rmdir /s /q "${deletePath}"`, { timeout: 30000 });
              console.log(`Cleaned up with ownership change: ${dir.name}`);
            } catch (cmdError) {
              console.warn(`Windows ownership/deletion failed for ${dir.name}:`, cmdError.message);
            }
          }
        }
      });
    }
  } catch (error) {
    console.warn('Error during deletion directory cleanup:', error.message);
  }
}

// Helper function to start reconversion using _reconvert staging
async function startReconversion(originalSlidePath, baseName) {
  console.log(`Starting reconversion of ${baseName} from ${originalSlidePath}...`);
  
  // Create _reconvert staging directory in DZI directory
  const reconvertDir = path.join(config.dziDir, `${baseName}_reconvert`);
  
  try {
    // Clean up any existing _reconvert directory
    if (fs.existsSync(reconvertDir)) {
      fs.rmSync(reconvertDir, { recursive: true, force: true });
      console.log(`Cleaned up existing _reconvert directory: ${reconvertDir}`);
    }
    
    fs.mkdirSync(reconvertDir, { recursive: true });
    console.log(`Created _reconvert staging directory: ${reconvertDir}`);
    
    // Track reconversion
    activeConversions.set(baseName, {
      processes: [],
      progressTimer: null,
      startTime: Date.now(),
      outputName: baseName,
      isReconversion: true,
      reconvertDir: reconvertDir
    });
    
    // Notify clients that reconversion started
    broadcastToClients({
      type: 'reconversion_started',
      filename: baseName
    });
    
    // Use optimized auto-processor for reconversion to staging directory
    if (autoProcessor && autoProcessor.conversionClient) {
      // Start conversion to _reconvert staging directory
      console.log(`Triggering autoprocessor reconversion: ${originalSlidePath} -> ${reconvertDir}`);
      
      try {
        const result = await autoProcessor.conversionClient.startConversion(
          originalSlidePath,
          baseName,
          config.slidesDir,
          reconvertDir  // Use staging directory as output
        );
        
        console.log(`✅ Reconversion queued to staging: ${baseName} (position: ${result.queuePosition})`);
        console.log(`Reconversion result:`, result);
        
        // Set up progress polling for reconversion
        const reconversionProgressHandler = (data) => {
          if (data.fileName === baseName || data.filename === baseName || data.baseName === baseName) {
            console.log(`Reconversion progress: ${baseName} - ${data.phase} ${data.percent}%`);
            broadcastToClients({
              type: 'reconversion_progress',
              filename: baseName,
              fileName: baseName,
              baseName: baseName,
              phase: data.phase,
              percent: data.percent,
              isReconversion: true
            });
            
            // When reconversion completes, perform atomic replacement
            if (data.phase === 'complete' && data.percent === 100) {
              setTimeout(() => performAtomicReplacement(baseName, reconvertDir), 1000);
            }
          }
        };
        
        if (autoProcessor.conversionClient.on) {
          autoProcessor.conversionClient.on('progress', reconversionProgressHandler);
          
          // Store the handler for cleanup
          const conversion = activeConversions.get(baseName);
          if (conversion) {
            conversion.progressHandler = reconversionProgressHandler;
          }
        }
        
        return { 
          message: 'Reconversion started', 
          status: 'processing',
          queuePosition: result.queuePosition,
          stagingDir: reconvertDir
        };
        
      } catch (conversionError) {
        console.error(`❌ Reconversion failed to start: ${conversionError.message}`);
        throw conversionError;
      }
    } else {
      throw new Error('Conversion client not available');
    }
    
  } catch (error) {
    // Clean up staging directory on error
    if (fs.existsSync(reconvertDir)) {
      try {
        fs.rmSync(reconvertDir, { recursive: true, force: true });
        console.log(`Cleaned up _reconvert staging on error: ${reconvertDir}`);
      } catch (cleanupError) {
        console.warn(`Failed to cleanup _reconvert staging: ${cleanupError.message}`);
      }
    }
    
    // Remove from tracking
    activeConversions.delete(baseName);
    
    // Notify clients of error
    broadcastToClients({
      type: 'reconversion_error',
      filename: baseName,
      error: error.message
    });
    
    throw error;
  }
}

// Helper function to perform atomic replacement after successful reconversion
async function performAtomicReplacement(baseName, reconvertDir) {
  console.log(`Performing atomic replacement for ${baseName}...`);
  
  try {
    // Use organized folder structure: /dzi/{baseName}/{baseName}.dzi
    const slideDir = path.join(config.dziDir, baseName);
    const dziPath = path.join(slideDir, `${baseName}.dzi`);
    const tilesDir = path.join(slideDir, `${baseName}_files`);
    const metadataDir = path.join(slideDir, 'metadata');
    
    // Paths in staging directory
    const stagingDziPath = path.join(reconvertDir, `${baseName}.dzi`);
    const stagingTilesDir = path.join(reconvertDir, `${baseName}_files`);
    const stagingMetadataDir = path.join(reconvertDir, 'metadata');
    
    // Step 1: Backup existing files before replacement
    const timestamp = Date.now();
    const backupDir = path.join(config.dziDir, `__backup_${baseName}_${timestamp}`);
    let backedUpFiles = [];
    
    if (fs.existsSync(dziPath) || fs.existsSync(tilesDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
      console.log(`Created backup directory: ${backupDir}`);
      
      // Backup DZI file
      if (fs.existsSync(dziPath)) {
        const backupDziPath = path.join(backupDir, `${baseName}.dzi`);
        fs.renameSync(dziPath, backupDziPath);
        backedUpFiles.push('dzi');
        console.log(`Backed up DZI: ${dziPath} -> ${backupDziPath}`);
      }
      
      // Backup tiles directory
      if (fs.existsSync(tilesDir)) {
        const backupTilesDir = path.join(backupDir, `${baseName}_files`);
        fs.renameSync(tilesDir, backupTilesDir);
        backedUpFiles.push('tiles');
        console.log(`Backed up tiles: ${tilesDir} -> ${backupTilesDir}`);
      }
      
      // Backup metadata files
      const metadataFiles = [
        { src: path.join(metadataDir, `${baseName}_label.jpg`), name: `${baseName}_label.jpg`, type: 'label' },
        { src: path.join(metadataDir, `${baseName}_macro.jpg`), name: `${baseName}_macro.jpg`, type: 'macro' },
        { src: path.join(metadataDir, `${baseName}_metadata.json`), name: `${baseName}_metadata.json`, type: 'metadata' },
        { src: path.join(metadataDir, `${baseName}.icc`), name: `${baseName}.icc`, type: 'icc' }
      ];
      
      const backupMetadataDir = path.join(backupDir, 'metadata');
      let hasMetadataBackup = false;
      
      for (const file of metadataFiles) {
        if (fs.existsSync(file.src)) {
          if (!hasMetadataBackup) {
            fs.mkdirSync(backupMetadataDir, { recursive: true });
            hasMetadataBackup = true;
          }
          const backupPath = path.join(backupMetadataDir, file.name);
          fs.renameSync(file.src, backupPath);
          backedUpFiles.push(file.type);
          console.log(`Backed up ${file.type}: ${file.src} -> ${backupPath}`);
        }
      }
    }
    
    // Step 2: Move new files from staging to final location
    if (fs.existsSync(stagingDziPath)) {
      fs.renameSync(stagingDziPath, dziPath);
      console.log(`Moved new DZI: ${stagingDziPath} -> ${dziPath}`);
    }
    
    if (fs.existsSync(stagingTilesDir)) {
      fs.renameSync(stagingTilesDir, tilesDir);
      console.log(`Moved new tiles: ${stagingTilesDir} -> ${tilesDir}`);
    }
    
    // Move new metadata files if they exist
    if (fs.existsSync(stagingMetadataDir)) {
      if (!fs.existsSync(metadataDir)) {
        fs.mkdirSync(metadataDir, { recursive: true });
      }
      
      const newMetadataFiles = fs.readdirSync(stagingMetadataDir);
      for (const file of newMetadataFiles) {
        const srcPath = path.join(stagingMetadataDir, file);
        const destPath = path.join(metadataDir, file);
        fs.renameSync(srcPath, destPath);
        console.log(`Moved new metadata: ${file}`);
      }
    }
    
    // Step 3: Clean up staging directory
    if (fs.existsSync(reconvertDir)) {
      fs.rmSync(reconvertDir, { recursive: true, force: true });
      console.log(`Cleaned up staging directory: ${reconvertDir}`);
    }
    
    // Step 4: Delete backup files once reconversion is successful
    if (backedUpFiles.length > 0 && fs.existsSync(backupDir)) {
      try {
        fs.rmSync(backupDir, { recursive: true, force: true });
        console.log(`Deleted backup files: ${backedUpFiles.join(', ')} from ${backupDir}`);
      } catch (backupError) {
        console.warn(`Failed to delete backup directory ${backupDir}:`, backupError.message);
        // Rename backup directory for later cleanup if deletion fails
        try {
          const failedBackupDir = path.join(config.dziDir, `__delete_backup_${baseName}_${timestamp}`);
          fs.renameSync(backupDir, failedBackupDir);
          console.log(`Renamed backup directory for later cleanup: ${failedBackupDir}`);
        } catch (renameError) {
          console.warn(`Failed to rename backup directory: ${renameError.message}`);
        }
      }
    }
    
    // Step 5: Remove from tracking and notify clients
    activeConversions.delete(baseName);
    
    broadcastToClients({
      type: 'reconversion_complete',
      filename: baseName,
      baseName: baseName,
      dziPath: `/dzi/${baseName}/${baseName}.dzi`,
      isReconversion: true,
      backedUpComponents: backedUpFiles
    });
    
    console.log(`Reconversion completed successfully for ${baseName}. Backed up and replaced: ${backedUpFiles.join(', ')}`);
    
  } catch (error) {
    console.error(`Atomic replacement failed for ${baseName}:`, error);
    
    // Clean up staging directory on error
    if (fs.existsSync(reconvertDir)) {
      try {
        fs.rmSync(reconvertDir, { recursive: true, force: true });
        console.log(`Cleaned up staging directory after error: ${reconvertDir}`);
      } catch (cleanupError) {
        console.warn(`Failed to cleanup staging directory: ${cleanupError.message}`);
      }
    }
    
    // Remove from tracking and notify clients of error
    activeConversions.delete(baseName);
    
    broadcastToClients({
      type: 'reconversion_error',
      filename: baseName,
      error: `Atomic replacement failed: ${error.message}`,
      isReconversion: true
    });
  }
}

// API endpoint to reconvert an existing slide
app.post('/api/reconvert/:filename', async (req, res) => {
  const filename = decodeURIComponent(req.params.filename);
  console.log(`RECONVERT request received for: ${filename}`);
  
  if (config.isClientMode()) {
    // Proxy reconversion request to lab server
    try {
      const result = await labClient.reconvertSlide(filename);
      res.json(result);
    } catch (error) {
      console.error(`Lab server reconvert failed for ${filename}:`, error.message);
      res.status(503).json({ error: 'Lab server unavailable', details: error.message });
    }
    return;
  }

  try {
    // Find the original SVS file
    let originalSlidePath = null;
    let actualBaseName = null;
    
    function findOriginalSlide(dir, relativePath = '') {
      if (!fs.existsSync(dir)) return false;
      
      const items = fs.readdirSync(dir, { withFileTypes: true });
      const supportedFormats = ['.svs', '.ndpi', '.tif', '.tiff', '.jp2', '.vms', '.vmu', '.scn'];
      
      for (const item of items) {
        const fullPath = path.join(dir, item.name);
        const relativeFilePath = path.join(relativePath, item.name);
        
        if (item.isDirectory()) {
          if (findOriginalSlide(fullPath, relativeFilePath)) {
            return true;
          }
        } else if (item.isFile()) {
          const ext = path.extname(item.name).toLowerCase();
          if (supportedFormats.includes(ext)) {
            const fileBaseName = path.basename(item.name, ext);
            const uniqueName = relativePath ? `${relativePath.replace(/[\\\/]/g, '_')}_${fileBaseName}` : fileBaseName;
            
            if (uniqueName === filename) {
              originalSlidePath = fullPath;
              actualBaseName = uniqueName;
              return true;
            }
          }
        }
      }
      return false;
    }
    
    findOriginalSlide(config.slidesDir);
    
    if (!originalSlidePath) {
      return res.status(404).json({ 
        error: 'Original slide file not found',
        message: `Cannot reconvert ${filename} - original SVS file is missing`
      });
    }
    
    console.log(`Found original slide for reconversion: ${originalSlidePath}`);
    
    // Check if conversion is already running for this file
    if (activeConversions.has(actualBaseName)) {
      return res.status(409).json({ 
        error: 'Conversion already in progress',
        message: `Conversion already running for ${filename}`
      });
    }
    
    // Start reconversion using _reconvert staging
    const result = await startReconversion(originalSlidePath, actualBaseName);
    res.json(result);
    
  } catch (error) {
    console.error(`Reconversion failed for ${filename}:`, error);
    res.status(500).json({ 
      error: 'Reconversion failed', 
      details: error.message 
    });
  }
});

// API endpoint to trigger autoprocessor for a specific file
app.post('/api/touch-file/:filename', async (req, res) => {
  const filename = decodeURIComponent(req.params.filename);
  console.log(`TOUCH-FILE request received for: ${filename}`);
  
  if (config.isClientMode()) {
    // Proxy touch-file request to lab server
    try {
      const result = await labClient.touchFile(filename);
      res.json(result);
    } catch (error) {
      console.error(`Lab server touch-file failed for ${filename}:`, error.message);
      res.status(503).json({ error: 'Lab server unavailable', details: error.message });
    }
    return;
  }

  try {
    // Find the slide file in slides directory
    let slidePath = null;
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
        } else if (item.isFile()) {
          // Check both original filename and unique name patterns
          if (item.name === filename) {
            slidePath = fullPath;
            actualBaseName = path.basename(item.name, path.extname(item.name));
            return true;
          }
          
          // Also check for unique name pattern (folder_filename)
          const ext = path.extname(item.name).toLowerCase();
          if (supportedFormats.includes(ext)) {
            const fileBaseName = path.basename(item.name, ext);
            const uniqueName = relativePath ? `${relativePath.replace(/[\\\/]/g, '_')}_${fileBaseName}` : fileBaseName;
            
            if (`${uniqueName}${ext}` === filename || uniqueName === path.basename(filename, path.extname(filename))) {
              slidePath = fullPath;
              actualBaseName = uniqueName;
              return true;
            }
          }
        }
      }
      return false;
    }
    
    findSlideFile(config.slidesDir);
    
    if (!slidePath) {
      return res.status(404).json({ 
        error: 'Slide file not found',
        message: `Cannot find slide file: ${filename}`
      });
    }
    
    console.log(`Found slide file for touch: ${slidePath}`);
    
    // Check if conversion is already running for this file
    if (activeConversions.has(actualBaseName)) {
      return res.status(409).json({ 
        error: 'Conversion already in progress',
        message: `Conversion already running for ${actualBaseName}`
      });
    }
    
    // Check if autoprocessor is available
    if (!autoProcessor) {
      return res.status(503).json({ 
        error: 'Autoprocessor not available',
        message: 'Autoprocessor is not initialized in server mode'
      });
    }
    
    // Trigger autoprocessor to process this file
    try {
      console.log(`Triggering autoprocessor for: ${slidePath}`);
      
      // Use the autoprocessor's processFile method or trigger it manually
      if (typeof autoProcessor.processFile === 'function') {
        await autoProcessor.processFile(slidePath);
      } else if (typeof autoProcessor.addToQueue === 'function') {
        await autoProcessor.addToQueue(slidePath);
      } else {
        // Fallback: use the conversion client directly
        const result = await startConversion(path.basename(slidePath), true);
        return res.json({
          message: 'Conversion triggered successfully',
          filename: actualBaseName,
          status: 'processing',
          method: 'direct_conversion'
        });
      }
      
      res.json({
        message: 'File touched successfully - autoprocessor will process it',
        filename: actualBaseName,
        slidePath: slidePath,
        status: 'queued'
      });
      
    } catch (processingError) {
      console.error(`Failed to trigger autoprocessor for ${filename}:`, processingError);
      res.status(500).json({ 
        error: 'Failed to trigger processing',
        details: processingError.message 
      });
    }
    
  } catch (error) {
    console.error(`Touch-file operation failed for ${filename}:`, error);
    res.status(500).json({ 
      error: 'Touch-file operation failed', 
      details: error.message 
    });
  }
});

// API endpoint to cancel ongoing conversion (simplified)
app.post('/api/cancel-conversion/:filename', async (req, res) => {
  const filename = decodeURIComponent(req.params.filename);
  console.log(`CANCEL-CONVERSION request received for: ${filename}`);
  
  if (config.isClientMode()) {
    // Proxy cancel request to lab server
    try {
      const result = await labClient.cancelConversion(filename);
      res.json(result);
    } catch (error) {
      console.error(`Lab server cancel failed for ${filename}:`, error.message);
      res.status(503).json({ error: 'Lab server unavailable', details: error.message });
    }
    return;
  }

  try {
    const baseName = path.basename(filename, path.extname(filename));
    console.log(`Attempting to cancel conversion: ${baseName}`);
    
    // Step 1: Cancel on conversion server (primary method)
    let cancellationResult = null;
    
    // Try using the conversion client's built-in cancel method first
    if (autoProcessor && autoProcessor.conversionClient && autoProcessor.conversionClient.cancelConversion) {
      try {
        console.log(`Trying conversion client cancelConversion: ${baseName}`);
        cancellationResult = await autoProcessor.conversionClient.cancelConversion(baseName);
        console.log(`✅ Conversion client cancelled: ${baseName}`, cancellationResult);
      } catch (clientError) {
        console.log(`❌ Conversion client cancel failed: ${clientError.message}`);
        
        // Fallback to direct HTTP DELETE calls
        const conversionServerUrl = config.conversionServerUrl || 'http://localhost:3001';
        const cancelEndpoints = [
          `/convert/${encodeURIComponent(baseName)}`,
          `/convert/${encodeURIComponent(filename)}`
        ];
        
        for (const endpoint of cancelEndpoints) {
          try {
            console.log(`Trying conversion server DELETE: ${conversionServerUrl}${endpoint}`);
            const response = await fetch(`${conversionServerUrl}${endpoint}`, { 
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json' },
              timeout: 10000 
            });
            
            if (response.ok) {
              cancellationResult = await response.json();
              console.log(`✅ Conversion server cancelled: ${baseName}`);
              break;
            } else {
              const errorText = await response.text();
              console.log(`❌ DELETE ${endpoint} failed (${response.status}): ${errorText}`);
            }
          } catch (endpointError) {
            console.log(`❌ DELETE ${endpoint} error: ${endpointError.message}`);
          }
        }
      }
    } else {
      console.log(`❌ Conversion client not available for cancellation`);
    }
    
    // Step 2: Clean up local files and tracking
    await cleanupCancelledConversion(baseName, filename);
    
    // Step 3: Broadcast cancellation to clients
    broadcastToClients({
      type: 'conversion_cancelled',
      filename: baseName,
      baseName: baseName,
      originalFilename: filename,
      timestamp: new Date().toISOString()
    });
    
    const success = cancellationResult !== null;
    console.log(`${success ? '✅' : '⚠️'} Cancellation ${success ? 'successful' : 'attempted'} for: ${baseName}`);
    
    res.json({
      success: success,
      message: success ? 'Conversion cancelled successfully' : 'Cancellation attempted (conversion server may not have responded)',
      filename: baseName,
      baseName: baseName,
      conversionServerResponse: cancellationResult
    });
    
  } catch (error) {
    console.error(`❌ Cancel conversion failed for ${filename}:`, error);
    res.status(500).json({ 
      error: 'Cancel conversion failed', 
      details: error.message 
    });
  }
});

// Helper function to clean up cancelled conversion files
async function cleanupCancelledConversion(baseName, originalFilename) {
  console.log(`🧹 Cleaning up cancelled conversion: ${baseName}`);
  
  try {
    // Clean up staging directories
    const stagingDirs = [
      path.join(config.dziDir, `${baseName}_convert`),
      path.join(config.dziDir, `${baseName}_reconvert`)
    ];
    
    for (const stagingDir of stagingDirs) {
      if (fs.existsSync(stagingDir)) {
        try {
          fs.rmSync(stagingDir, { recursive: true, force: true });
          console.log(`  ✅ Removed staging directory: ${stagingDir}`);
        } catch (cleanupError) {
          console.warn(`  ⚠️ Failed to remove staging directory ${stagingDir}: ${cleanupError.message}`);
        }
      }
    }
    
    // Remove from active conversions tracking (all variants)
    const removedKeys = [];
    for (const [key, conversion] of activeConversions.entries()) {
      if (key === baseName || 
          key.includes(baseName) || 
          baseName.includes(key) ||
          key.startsWith('VIPS_Process_')) {
        activeConversions.delete(key);
        removedKeys.push(key);
      }
    }
    
    if (removedKeys.length > 0) {
      console.log(`  ✅ Removed from tracking: ${removedKeys.join(', ')}`);
    }
    
    // Create cancellation flag file for future reference
    const cancelledFlagFile = path.join(config.slidesDir, `.${baseName}.cancelled`);
    try {
      fs.writeFileSync(cancelledFlagFile, JSON.stringify({
        cancelledAt: new Date().toISOString(),
        baseName: baseName,
        originalFilename: originalFilename,
        reason: 'User cancellation'
      }));
      console.log(`  ✅ Created cancellation flag: ${cancelledFlagFile}`);
    } catch (flagError) {
      console.warn(`  ⚠️ Failed to create cancellation flag: ${flagError.message}`);
    }
    
    // Clean up any partial DZI files that might exist
    const partialFiles = [
      path.join(config.dziDir, `${baseName}.dzi`),
      path.join(config.dziDir, `${baseName}_files`)
    ];
    
    for (const partialFile of partialFiles) {
      if (fs.existsSync(partialFile)) {
        try {
          if (fs.statSync(partialFile).isDirectory()) {
            fs.rmSync(partialFile, { recursive: true, force: true });
          } else {
            fs.unlinkSync(partialFile);
          }
          console.log(`  ✅ Removed partial file: ${partialFile}`);
        } catch (cleanupError) {
          console.warn(`  ⚠️ Failed to remove partial file ${partialFile}: ${cleanupError.message}`);
        }
      }
    }
    
    console.log(`✅ Cleanup completed for: ${baseName}`);
    
  } catch (error) {
    console.error(`❌ Error during cleanup for ${baseName}:`, error);
  }
}

// Function to reorganize existing slides into organized folder structure
async function reorganizeExistingSlides() {
  console.log('📁 Reorganizing existing slides into organized folders...');
  
  try {
    if (!fs.existsSync(config.dziDir)) {
      console.log('No DZI directory found, skipping reorganization');
      return { reorganized: 0, errors: [] };
    }
    
    const dziFiles = fs.readdirSync(config.dziDir)
      .filter(f => f.endsWith('.dzi') && !f.includes('/'));
    
    let reorganized = 0;
    const errors = [];
    
    console.log(`Found ${dziFiles.length} DZI files to reorganize`);
    
    for (const dziFile of dziFiles) {
      try {
        const baseName = path.basename(dziFile, '.dzi');
        const slideDir = path.join(config.dziDir, baseName);
        
        // Skip if already organized
        if (fs.existsSync(slideDir)) {
          console.log(`⏭️ Skipping ${baseName} - already organized`);
          continue;
        }
        
        console.log(`🔄 Reorganizing: ${baseName}`);
        
        // Create slide directory
        fs.mkdirSync(slideDir, { recursive: true });
        console.log(`  📁 Created directory: ${baseName}/`);
        
        // Move DZI file
        const originalDzi = path.join(config.dziDir, dziFile);
        const newDzi = path.join(slideDir, dziFile);
        fs.renameSync(originalDzi, newDzi);
        console.log(`  ✅ Moved DZI: ${dziFile}`);
        
        // Move tiles directory
        const tilesDir = `${baseName}_files`;
        const originalTiles = path.join(config.dziDir, tilesDir);
        const newTiles = path.join(slideDir, tilesDir);
        
        if (fs.existsSync(originalTiles)) {
          fs.renameSync(originalTiles, newTiles);
          console.log(`  ✅ Moved tiles: ${tilesDir}/`);
        }
        
        // Move metadata files
        const metadataDir = path.join(config.dziDir, 'metadata');
        if (fs.existsSync(metadataDir)) {
          const slideMetadataDir = path.join(slideDir, 'metadata');
          fs.mkdirSync(slideMetadataDir, { recursive: true });
          
          const metadataFiles = fs.readdirSync(metadataDir)
            .filter(f => f.startsWith(baseName));
          
          for (const metadataFile of metadataFiles) {
            const originalMetadata = path.join(metadataDir, metadataFile);
            const newMetadata = path.join(slideMetadataDir, metadataFile);
            fs.renameSync(originalMetadata, newMetadata);
            console.log(`  ✅ Moved metadata: ${metadataFile}`);
          }
        }
        
        reorganized++;
        console.log(`✅ Completed: ${baseName}`);
        
      } catch (slideError) {
        const errorMsg = `Failed to reorganize ${dziFile}: ${slideError.message}`;
        console.error(`❌ ${errorMsg}`);
        errors.push(errorMsg);
      }
    }
    
    // Clean up empty metadata directory
    const metadataDir = path.join(config.dziDir, 'metadata');
    if (fs.existsSync(metadataDir)) {
      try {
        const remainingFiles = fs.readdirSync(metadataDir);
        if (remainingFiles.length === 0) {
          fs.rmdirSync(metadataDir);
          console.log('🗑️ Removed empty metadata directory');
        } else {
          console.log(`ℹ️ Metadata directory still contains ${remainingFiles.length} files`);
        }
      } catch (cleanupError) {
        console.warn('⚠️ Could not clean up metadata directory:', cleanupError.message);
      }
    }
    
    console.log(`✅ Reorganization complete: ${reorganized}/${dziFiles.length} slides reorganized`);
    
    return {
      reorganized: reorganized,
      total: dziFiles.length,
      errors: errors
    };
    
  } catch (error) {
    console.error('❌ Error during slide reorganization:', error.message);
    throw error;
  }
}

// API endpoint to trigger reorganization
app.post('/api/reorganize-slides', async (req, res) => {
  if (config.isClientMode()) {
    return res.status(503).json({ error: 'Reorganization only available in server mode' });
  }

  try {
    console.log('🔄 Starting slide reorganization...');
    const result = await reorganizeExistingSlides();
    
    res.json({
      success: true,
      message: `Successfully reorganized ${result.reorganized} out of ${result.total} slides`,
      reorganized: result.reorganized,
      total: result.total,
      errors: result.errors
    });
    
  } catch (error) {
    console.error('Reorganization failed:', error);
    res.status(500).json({
      error: 'Reorganization failed',
      details: error.message
    });
  }
});

// Browser-friendly GET endpoint for reorganization
app.get('/api/reorganize-slides', async (req, res) => {
  if (config.isClientMode()) {
    return res.status(503).json({ error: 'Reorganization only available in server mode' });
  }

  try {
    console.log('🔄 Starting slide reorganization via browser...');
    const result = await reorganizeExistingSlides();
    
    // Send HTML response for browser
    res.send(`
      <html>
        <head><title>Slide Reorganization</title></head>
        <body style="font-family: Arial, sans-serif; padding: 20px;">
          <h2>✅ Slide Reorganization Complete</h2>
          <p><strong>Successfully reorganized:</strong> ${result.reorganized} out of ${result.total} slides</p>
          ${result.errors.length > 0 ? `
            <h3>❌ Errors:</h3>
            <ul>${result.errors.map(error => `<li>${error}</li>`).join('')}</ul>
          ` : ''}
          <p><a href="javascript:history.back()">← Go Back</a></p>
        </body>
      </html>
    `);
    
  } catch (error) {
    console.error('Reorganization failed:', error);
    res.status(500).send(`
      <html>
        <head><title>Reorganization Error</title></head>
        <body style="font-family: Arial, sans-serif; padding: 20px;">
          <h2>❌ Reorganization Failed</h2>
          <p><strong>Error:</strong> ${error.message}</p>
          <p><a href="javascript:history.back()">← Go Back</a></p>
        </body>
      </html>
    `);
  }
});

// Endpoint to list all active VIPS processes for cancellation selection
app.get('/api/active-processes', async (req, res) => {
  if (config.isClientMode()) {
    return res.status(503).json({ error: 'Active processes endpoint only available in server mode' });
  }

  try {
    const { execSync } = require('child_process');
    
    // Get detailed VIPS processes with command lines
    let vipsProcesses = [];
    try {
      const output = execSync('tasklist /FI "IMAGENAME eq vips.exe" /FO CSV', { 
        encoding: 'utf8',
        timeout: 5000 
      });
      
      const lines = output.split('\n').slice(1);
      vipsProcesses = lines
        .filter(line => line.trim() && line.includes('vips.exe'))
        .map(line => {
          const parts = line.split(',').map(part => part.replace(/"/g, ''));
          return {
            name: parts[0],
            pid: parseInt(parts[1]),
            memory: parts[4]
          };
        });
    } catch (error) {
      console.warn('Could not get VIPS processes:', error.message);
    }
    
    // Get active conversions with more details
    const activeConversionsDetails = Array.from(activeConversions.entries()).map(([baseName, conversion]) => ({
      baseName,
      isReconversion: conversion.isReconversion || false,
      isAutoConversion: conversion.isAutoConversion || false,
      startTime: conversion.startTime,
      isGeneric: conversion.generic || false,
      vipsPid: conversion.vipsPid || null,
      stagingDir: conversion.convertDir || conversion.reconvertDir || null
    }));
    
    res.json({
      timestamp: new Date().toISOString(),
      vipsProcesses,
      activeConversions: activeConversionsDetails,
      totalVipsProcesses: vipsProcesses.length,
      totalActiveConversions: activeConversions.size
    });
    
  } catch (error) {
    res.status(500).json({ error: 'Failed to get active processes', details: error.message });
  }
});

// Debug endpoint to check active conversions and VIPS processes
app.get('/api/debug/active-conversions', async (req, res) => {
  if (config.isClientMode()) {
    return res.status(503).json({ error: 'Debug endpoint only available in server mode' });
  }

  try {
    const { execSync } = require('child_process');
    
    // Get VIPS processes
    let vipsProcesses = [];
    try {
      const output = execSync('tasklist /FI "IMAGENAME eq vips.exe" /FO CSV', { 
        encoding: 'utf8',
        timeout: 5000 
      });
      
      const lines = output.split('\n').slice(1);
      vipsProcesses = lines
        .filter(line => line.trim() && line.includes('vips.exe'))
        .map(line => {
          const parts = line.split(',').map(part => part.replace(/"/g, ''));
          return {
            name: parts[0],
            pid: parseInt(parts[1]),
            memory: parts[4]
          };
        });
    } catch (error) {
      console.warn('Could not get VIPS processes:', error.message);
    }
    
    // Get conversion server status
    let conversionServerStatus = null;
    if (autoProcessor && autoProcessor.conversionClient) {
      try {
        conversionServerStatus = await autoProcessor.conversionClient.getHealth();
      } catch (error) {
        conversionServerStatus = { error: error.message };
      }
    }
    
    // Get staging directories
    const stagingDirs = [];
    if (fs.existsSync(config.dziDir)) {
      const entries = fs.readdirSync(config.dziDir, { withFileTypes: true });
      entries.forEach(entry => {
        if (entry.isDirectory() && (entry.name.endsWith('_convert') || entry.name.endsWith('_reconvert'))) {
          const baseName = entry.name.replace(/_convert$|_reconvert$/, '');
          const isReconversion = entry.name.endsWith('_reconvert');
          stagingDirs.push({ 
            baseName, 
            isReconversion, 
            path: path.join(config.dziDir, entry.name),
            exists: fs.existsSync(path.join(config.dziDir, entry.name))
          });
        }
      });
    }
    
    res.json({
      timestamp: new Date().toISOString(),
      activeConversions: Object.fromEntries(activeConversions.entries()),
      vipsProcesses,
      conversionServerStatus,
      stagingDirectories: stagingDirs,
      dziDir: config.dziDir
    });
    
  } catch (error) {
    res.status(500).json({ error: 'Debug check failed', details: error.message });
  }
});

// Endpoint to cancel a specific VIPS process by PID
app.post('/api/cancel-vips-process/:pid', async (req, res) => {
  const pid = parseInt(req.params.pid);
  console.log(`CANCEL-VIPS-PROCESS request received for PID: ${pid}`);
  
  if (config.isClientMode()) {
    return res.status(503).json({ error: 'VIPS process cancellation only available in server mode' });
  }

  try {
    // Find the active conversion for this PID
    const vipsProcessKey = `VIPS_Process_${pid}`;
    const activeConversion = activeConversions.get(vipsProcessKey);
    
    if (!activeConversion) {
      return res.status(404).json({ 
        error: 'VIPS process not tracked',
        message: `No tracked conversion found for VIPS process PID ${pid}`
      });
    }
    
    console.log(`Found tracked conversion for PID ${pid}, attempting to cancel...`);
    
    // Cancel the conversion on the conversion server using the PID
    let cancellationResult = null;
    if (autoProcessor && autoProcessor.conversionClient) {
      try {
        console.log(`Requesting cancellation from conversion server for PID: ${pid}`);
        const conversionServerUrl = config.conversionServerUrl || 'http://localhost:3001';
        const response = await fetch(`${conversionServerUrl}/cancel-pid/${pid}`, { 
          method: 'POST',
          timeout: 5000 
        });
        
        if (response.ok) {
          cancellationResult = await response.json();
          console.log(`Conversion server PID cancellation response:`, cancellationResult);
        } else {
          console.warn(`Conversion server PID cancellation failed: ${response.status}`);
        }
      } catch (fetchError) {
        console.warn(`Failed to contact conversion server for PID cancellation: ${fetchError.message}`);
      }
    }
    
    // Also try to kill the process directly as fallback
    try {
      const { execSync } = require('child_process');
      execSync(`taskkill /PID ${pid} /F`, { timeout: 5000 });
      console.log(`Directly killed VIPS process PID ${pid}`);
    } catch (killError) {
      console.warn(`Failed to directly kill PID ${pid}: ${killError.message}`);
    }
    
    // Clean up tracking
    activeConversions.delete(vipsProcessKey);
    console.log(`Removed ${vipsProcessKey} from active conversions tracking`);
    
    // Broadcast cancellation to WebSocket clients
    broadcastToClients({
      type: 'vips_process_cancelled',
      pid: pid,
      vipsProcessKey: vipsProcessKey
    });
    
    res.json({
      success: true,
      message: `VIPS process PID ${pid} cancelled successfully`,
      pid: pid,
      vipsProcessKey: vipsProcessKey,
      conversionServerResponse: cancellationResult
    });
    
  } catch (error) {
    console.error(`Cancel VIPS process failed for PID ${pid}:`, error);
    res.status(500).json({ 
      error: 'Cancel VIPS process failed', 
      details: error.message 
    });
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
  
  // Create _convert staging directory in DZI directory
  const convertDir = path.join(config.dziDir, `${baseName}_convert`);
  
  try {
    // Clean up any existing _convert directory
    if (fs.existsSync(convertDir)) {
      fs.rmSync(convertDir, { recursive: true, force: true });
      console.log(`Cleaned up existing _convert directory: ${convertDir}`);
    }
    
    fs.mkdirSync(convertDir, { recursive: true });
    console.log(`Created _convert staging directory: ${convertDir}`);
    
    // Notify clients that conversion started
    broadcastToClients({
      type: isAutoConversion ? 'auto_processing_started' : 'conversion_started',
      filename: baseName
    });
    
    // Track conversion
    activeConversions.set(baseName, {
      processes: [],
      progressTimer: null,
      startTime: Date.now(),
      outputName: baseName,
      isAutoConversion: isAutoConversion,
      convertDir: convertDir
    });
    
    // Use optimized auto-processor for both manual and auto conversions
    if (autoProcessor && autoProcessor.conversionClient) {
      // Start conversion to _convert staging directory
      const result = await autoProcessor.conversionClient.startConversion(
        svsPath,
        baseName,
        config.slidesDir,
        convertDir  // Use staging directory as output
      );
      
      console.log(`Optimized conversion queued to staging: ${baseName} (position: ${result.queuePosition})`);
      
      // Set up progress polling for conversions
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
            
            // When conversion completes, perform atomic move
            if (data.phase === 'complete' && data.percent === 100) {
              setTimeout(() => performAtomicMove(baseName, convertDir, false), 1000);
            }
          }
        };
        
        // Add progress listener
        if (autoProcessor.conversionClient.on) {
          autoProcessor.conversionClient.on('progress', manualProgressHandler);
          
          // Store handler for cleanup
          const conversion = activeConversions.get(baseName);
          if (conversion) {
            conversion.progressHandler = manualProgressHandler;
          }
        }
      } else {
        // For auto conversions, perform atomic move after completion
        setTimeout(() => performAtomicMove(baseName, convertDir, true), 1000);
      }
      
      return { 
        message: 'Conversion started', 
        status: 'processing',
        queuePosition: result.queuePosition,
        stagingDir: convertDir
      };
    } else {
      throw new Error('Conversion client not available');
    }
    
  } catch (error) {
    // Clean up staging directory on error
    if (fs.existsSync(convertDir)) {
      try {
        fs.rmSync(convertDir, { recursive: true, force: true });
        console.log(`Cleaned up _convert staging on error: ${convertDir}`);
      } catch (cleanupError) {
        console.warn(`Failed to cleanup _convert staging: ${cleanupError.message}`);
      }
    }
    
    // Remove from tracking
    activeConversions.delete(baseName);
    
    // Notify clients of error
    broadcastToClients({
      type: isAutoConversion ? 'auto_processing_error' : 'conversion_error',
      filename: baseName,
      error: error.message
    });
    
    throw error;
  }
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

// Helper function to perform atomic move after successful conversion
async function performAtomicMove(baseName, convertDir, isAutoConversion = false) {
  console.log(`Performing atomic move for ${baseName}...`);
  
  try {
    // Use organized folder structure: /dzi/{baseName}/{baseName}.dzi
    const slideDir = path.join(config.dziDir, baseName);
    const dziPath = path.join(slideDir, `${baseName}.dzi`);
    const tilesDir = path.join(slideDir, `${baseName}_files`);
    const metadataDir = path.join(slideDir, 'metadata');
    
    // Paths in staging directory
    const stagingDziPath = path.join(convertDir, `${baseName}.dzi`);
    const stagingTilesDir = path.join(convertDir, `${baseName}_files`);
    const stagingMetadataDir = path.join(convertDir, 'metadata');
    
    // Ensure slide directory exists
    if (!fs.existsSync(slideDir)) {
      fs.mkdirSync(slideDir, { recursive: true });
      console.log(`Created slide directory: ${slideDir}`);
    }
    
    // Step 1: Remove existing files if they exist, then move from staging
    if (fs.existsSync(stagingDziPath)) {
      // Remove existing DZI file if it exists
      if (fs.existsSync(dziPath)) {
        try {
          fs.unlinkSync(dziPath);
          console.log(`Removed existing DZI: ${dziPath}`);
        } catch (error) {
          console.warn(`Failed to remove existing DZI: ${error.message}`);
        }
      }
      fs.renameSync(stagingDziPath, dziPath);
      console.log(`Moved DZI: ${stagingDziPath} -> ${dziPath}`);
    }
    
    if (fs.existsSync(stagingTilesDir)) {
      // Remove existing tiles directory if it exists
      if (fs.existsSync(tilesDir)) {
        try {
          fs.rmSync(tilesDir, { recursive: true, force: true });
          console.log(`Removed existing tiles directory: ${tilesDir}`);
        } catch (error) {
          console.warn(`Failed to remove existing tiles directory: ${error.message}`);
          // Try renaming for later cleanup if removal fails
          try {
            const backupTilesDir = path.join(config.dziDir, `__delete_${baseName}_files_${Date.now()}`);
            fs.renameSync(tilesDir, backupTilesDir);
            console.log(`Renamed existing tiles for cleanup: ${backupTilesDir}`);
          } catch (renameError) {
            console.warn(`Failed to rename existing tiles directory: ${renameError.message}`);
          }
        }
      }
      fs.renameSync(stagingTilesDir, tilesDir);
      console.log(`Moved tiles: ${stagingTilesDir} -> ${tilesDir}`);
    }
    
    // Move metadata files if they exist
    if (fs.existsSync(stagingMetadataDir)) {
      if (!fs.existsSync(metadataDir)) {
        fs.mkdirSync(metadataDir, { recursive: true });
      }
      
      const metadataFiles = fs.readdirSync(stagingMetadataDir);
      for (const file of metadataFiles) {
        const srcPath = path.join(stagingMetadataDir, file);
        const destPath = path.join(metadataDir, file);
        
        // Remove existing metadata file if it exists
        if (fs.existsSync(destPath)) {
          try {
            fs.unlinkSync(destPath);
            console.log(`Removed existing metadata: ${file}`);
          } catch (error) {
            console.warn(`Failed to remove existing metadata ${file}: ${error.message}`);
          }
        }
        
        fs.renameSync(srcPath, destPath);
        console.log(`Moved metadata: ${file}`);
      }
    }
    
    // Step 2: Clean up staging directory
    if (fs.existsSync(convertDir)) {
      fs.rmSync(convertDir, { recursive: true, force: true });
      console.log(`Cleaned up staging directory: ${convertDir}`);
    }
    
    // Step 3: Handle auto-delete if enabled for auto conversions
    if (isAutoConversion && config.autoDeleteOriginal) {
      try {
        const originalPath = path.join(config.slidesDir, `${baseName}.svs`);
        if (fs.existsSync(originalPath)) {
          await deleteFileWithRetry(originalPath, 3);
          console.log(`Auto-deleted original file: ${baseName}.svs`);
          broadcastToClients({
            type: 'conversion_auto_delete',
            filename: baseName,
            originalFile: `${baseName}.svs`
          });
        }
      } catch (error) {
        console.warn(`Failed to auto-delete original file ${baseName}.svs:`, error.message);
      }
    }
    
    // Step 4: Remove from tracking and notify clients
    activeConversions.delete(baseName);
    
    broadcastToClients({
      type: 'conversion_complete',
      filename: baseName,
      baseName: baseName,
      dziPath: `/dzi/${baseName}/${baseName}.dzi`,
      isAutoConversion: isAutoConversion
    });
    
    console.log(`Conversion completed successfully for ${baseName}`);
    
  } catch (error) {
    console.error(`Atomic move failed for ${baseName}:`, error);
    
    // Clean up staging directory on error
    if (fs.existsSync(convertDir)) {
      try {
        fs.rmSync(convertDir, { recursive: true, force: true });
        console.log(`Cleaned up staging directory after error: ${convertDir}`);
      } catch (cleanupError) {
        console.warn(`Failed to cleanup staging directory: ${cleanupError.message}`);
      }
    }
    
    // Remove from tracking and notify clients of error
    activeConversions.delete(baseName);
    
    broadcastToClients({
      type: 'conversion_error',
      filename: baseName,
      error: `Atomic move failed: ${error.message}`,
      isAutoConversion: isAutoConversion
    });
  }
}

// Cleanup function to remove leftover staging directories
function cleanupStagingDirectories() {
  try {
    const dziDir = config.dziDir;
    if (!fs.existsSync(dziDir)) return;
    
    const entries = fs.readdirSync(dziDir, { withFileTypes: true });
    const stagingDirectories = entries.filter(entry => 
      entry.isDirectory() && (entry.name.endsWith('_convert') || entry.name.endsWith('_reconvert'))
    );
    
    if (stagingDirectories.length > 0) {
      console.log(`Found ${stagingDirectories.length} leftover staging directories, cleaning up...`);
      
      stagingDirectories.forEach(dir => {
        const stagingPath = path.join(dziDir, dir.name);
        
        // Check if this staging directory is currently in use
        const baseName = dir.name.replace(/_convert$|_reconvert$/, '');
        const isInUse = activeConversions.has(baseName);
        
        if (!isInUse) {
          try {
            // Check if directory is older than 1 hour (failed/incomplete conversions)
            const stats = fs.statSync(stagingPath);
            const ageInHours = (Date.now() - stats.mtime.getTime()) / (1000 * 60 * 60);
            
            if (ageInHours > 1) {
              fs.rmSync(stagingPath, { recursive: true, force: true });
              console.log(`Cleaned up old staging directory: ${dir.name} (${ageInHours.toFixed(1)}h old)`);
            } else {
              console.log(`Skipping recent staging directory: ${dir.name} (${ageInHours.toFixed(1)}h old)`);
            }
          } catch (error) {
            console.warn(`Failed to cleanup staging directory ${dir.name}:`, error.message);
          }
        } else {
          console.log(`Skipping active staging directory: ${dir.name}`);
        }
      });
    }
  } catch (error) {
    console.warn('Error during staging directory cleanup:', error.message);
  }
}

// Function to detect and sync with ongoing conversions
async function syncWithOngoingVipsProcesses() {
  if (!config.isServerMode()) {
    console.log('Skipping conversion sync - not in server mode');
    return;
  }
  
  console.log(' Syncing with ongoing conversions...');
  
  try {
    // Step 1: Check conversion server for active conversions
    let serverActiveConversions = [];
    if (autoProcessor && autoProcessor.conversionClient) {
      try {
        const health = await autoProcessor.conversionClient.getHealth();
        serverActiveConversions = health.activeConversions || [];
        console.log(`Conversion server reports ${serverActiveConversions.length} active conversions`);
        
        if (serverActiveConversions.length > 0) {
          console.log(`Active conversions on server:`, serverActiveConversions.map(c => c.baseName || c.filename || 'unknown'));
        }
      } catch (error) {
        console.warn('Could not get conversion server status:', error.message);
      }
    }
    
    // Step 2: Check for VIPS processes
    let vipsProcesses = [];
    try {
      const { execSync } = require('child_process');
      const output = execSync('tasklist /FI "IMAGENAME eq vips.exe" /FO CSV', { 
        encoding: 'utf8',
        timeout: 5000 
      });
      
      const lines = output.split('\n').slice(1);
      vipsProcesses = lines
        .filter(line => line.trim() && line.includes('vips.exe'))
        .map(line => {
          const parts = line.split(',').map(part => part.replace(/"/g, ''));
          return {
            name: parts[0],
            pid: parseInt(parts[1]),
            memory: parts[4]
          };
        });
        
      console.log(`Found ${vipsProcesses.length} VIPS processes running`);
    } catch (tasklistError) {
      console.log('No VIPS processes found or tasklist failed');
    }
    
    // Check for staging directories that indicate ongoing conversions
    const stagingDirs = [];
    if (fs.existsSync(config.dziDir)) {
      const entries = fs.readdirSync(config.dziDir, { withFileTypes: true });
      entries.forEach(entry => {
        if (entry.isDirectory() && (entry.name.endsWith('_convert') || entry.name.endsWith('_reconvert'))) {
          const baseName = entry.name.replace(/_convert$|_reconvert$/, '');
          const isReconversion = entry.name.endsWith('_reconvert');
          stagingDirs.push({ baseName, isReconversion, path: path.join(config.dziDir, entry.name) });
        }
      });
    }
    
    console.log(`Found ${stagingDirs.length} staging directories`);
    
    // If we have VIPS processes but no staging directories, try to infer from conversion server
    if (vipsProcesses.length > 0 && stagingDirs.length === 0 && serverActiveConversions.length > 0) {
      console.log('VIPS processes detected but no staging directories - inferring from conversion server...');
      
      for (const activeConv of serverActiveConversions) {
        // Try to extract basename from conversion server data
        const inferredBaseName = activeConv.baseName || activeConv.filename || activeConv.name;
        if (inferredBaseName) {
          console.log(`Inferring ongoing conversion: ${inferredBaseName}`);
          stagingDirs.push({ 
            baseName: inferredBaseName, 
            isReconversion: false, // Default to regular conversion
            path: path.join(config.dziDir, `${inferredBaseName}_convert`),
            inferred: true
          });
        }
      }
    }
    
    // If still no staging dirs but VIPS processes exist, create generic tracking
    if (vipsProcesses.length > 0 && stagingDirs.length === 0) {
      console.log('VIPS processes detected but no conversion info - creating generic tracking...');
      
      // Try to get process command lines to infer filenames
      try {
        const detailedOutput = execSync('wmic process where "name=\'vips.exe\'" get CommandLine,ProcessId /format:csv', { 
          encoding: 'utf8',
          timeout: 10000 
        });
        
        const lines = detailedOutput.split('\n').slice(1);
        for (const line of lines) {
          if (line.trim() && line.includes('vips.exe')) {
            const parts = line.split(',');
            if (parts.length >= 2) {
              const commandLine = parts[1];
              // Try to extract filename from command line
              const match = commandLine.match(/([^\\\/]+)\.(?:svs|ndpi|tif|tiff|jp2|vms|vmu|scn)/i);
              if (match) {
                const inferredBaseName = match[1];
                console.log(`Inferred conversion from VIPS command line: ${inferredBaseName}`);
                stagingDirs.push({ 
                  baseName: inferredBaseName, 
                  isReconversion: commandLine.includes('reconvert'),
                  path: path.join(config.dziDir, `${inferredBaseName}_${commandLine.includes('reconvert') ? 'reconvert' : 'convert'}`),
                  inferred: true
                });
              }
            }
          }
        }
      } catch (wmicError) {
        console.warn('Could not get VIPS command lines:', wmicError.message);
        
        // Last resort: create entries for each VIPS process
        const conversionsToRestore = [];
        
        // Prioritize server active conversions
        for (const serverConv of serverActiveConversions) {
          const baseName = serverConv.baseName || serverConv.filename || serverConv.name;
          if (baseName) {
            conversionsToRestore.push({
              baseName: baseName,
              isReconversion: serverConv.isReconversion || false,
              source: 'conversion_server'
            });
          }
        }
        
        // Add staging directories
        for (const staging of stagingDirs) {
          if (!conversionsToRestore.find(c => c.baseName === staging.baseName)) {
            conversionsToRestore.push({
              baseName: staging.baseName,
              isReconversion: staging.isReconversion,
              source: 'staging_directory'
            });
          }
        }
        
        // If we have VIPS processes but no specific conversions, create generic entries
        if (vipsProcesses.length > 0 && conversionsToRestore.length === 0) {
          for (const vipsProcess of vipsProcesses) {
            conversionsToRestore.push({
              baseName: `VIPS_Process_${vipsProcess.pid}`,
              isReconversion: false,
              source: 'vips_process',
              vipsPid: vipsProcess.pid
            });
          }
        }
        
        // Restore tracking for all identified conversions
        for (const conversion of conversionsToRestore) {
          if (!activeConversions.has(conversion.baseName)) {
            console.log(`✅ Restoring tracking: ${conversion.baseName} (${conversion.source})`);
            activeConversions.set(conversion.baseName, {
              startTime: Date.now() - 60000,
              outputName: conversion.baseName,
              isAutoConversion: false,
              isReconversion: conversion.isReconversion || false,
              restoredFromSync: true,
              source: conversion.source,
              vipsPid: conversion.vipsPid || null
            });

            // Notify clients of restoration
            broadcastToClients({
              type: (conversion.isReconversion ? 'reconversion_restored' : 'conversion_restored'),
              filename: conversion.baseName,
              baseName: conversion.baseName,
              message: `Conversion restored from ${conversion.source}`,
              timestamp: new Date().toISOString()
            });
          }
        }

        console.log(`✅ Restored ${conversionsToRestore.length} active conversion(s)`);
    }

    // End of: if (vipsProcesses.length > 0 && stagingDirs.length === 0)
    }
    
  } catch (error) {
    console.warn('Error syncing with VIPS processes:', error.message);
  }
}

// Create HTTP server
const server = app.listen(PORT, async () => {
  console.log(`\n=== PATHOLOGY SLIDE VIEWER ===`);
  console.log(`Mode: ${config.mode.toUpperCase()}`);
  console.log(` Main Server: http://localhost:${PORT}`);
  
  // Check conversion server connection status
  if (config.isServerMode() && autoProcessor) {
    try {
      const health = await autoProcessor.conversionClient.getHealth();
      console.log(` Conversion Server: http://localhost:3001 CONNECTED`);
      console.log(`   └─ Max Concurrent: ${health.maxConcurrent} | Active: ${health.activeConversions} | Queue: ${health.queueLength}`);
    } catch (error) {
      console.log(` Conversion Server: http://localhost:3001 DISCONNECTED`);
      console.log(`   └─ Error: ${error.message}`);
    }
  }
  
  if (config.isClientMode()) {
    console.log(` Lab Server: ${config.labServer.url}`);
  }
  
  console.log(`Configuration:`, config.getSummary());
  console.log(`=============================\n`);
  
  // Sync with ongoing VIPS processes first
  await syncWithOngoingVipsProcesses();
  
  // Log current active conversions for debugging
  if (activeConversions.size > 0) {
    console.log(`Active conversions after sync: ${Array.from(activeConversions.keys()).join(', ')}`);
  } else {
    console.log('No active conversions detected after sync');
  }
  
  // Clean up any leftover __delete_ directories on startup
  cleanupDeleteDirectories();
  
  // Clean up any leftover staging directories on startup (but preserve active ones)
  cleanupStagingDirectories();
  
  // Set up periodic cleanup every 5 minutes when idle
  setInterval(() => {
    cleanupDeleteDirectories();
    cleanupStagingDirectories();
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

// Initialize auto-processor in server mode
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
    
    if (data.success) {
      // Perform atomic move for auto conversions
      const baseName = data.baseName || path.basename(data.fileName, path.extname(data.fileName));
      const convertDir = path.join(config.dziDir, `${baseName}_convert`);
      
      if (fs.existsSync(convertDir)) {
        await performAtomicMove(baseName, convertDir, true);
      } else {
        // Fallback for conversions that didn't use staging
        broadcastToClients({
          type: 'conversion_complete',
          fileName: data.fileName,
          baseName: data.baseName,
          dziPath: `/dzi/${data.baseName}/${data.baseName}.dzi`,
          isAutoConversion: true
        });
      }
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
          
          // Check for DZI in organized structure first, then fall back to legacy
          const organizedDziPath = path.join(config.dziDir, uniqueName, `${uniqueName}.dzi`);
          const legacyDziPath = path.join(config.dziDir, `${uniqueName}.dzi`);
          const hasDzi = fs.existsSync(organizedDziPath) || fs.existsSync(legacyDziPath);
          const isOrganized = fs.existsSync(organizedDziPath);
          
          // Metadata-derived assets - check organized structure first
          let metadataDir, labelFs, macroFs, metadataJsonPath;
          if (isOrganized) {
            // New organized structure
            metadataDir = path.join(config.dziDir, uniqueName, 'metadata');
            labelFs = path.join(metadataDir, `${uniqueName}_label.jpg`);
            macroFs = path.join(metadataDir, `${uniqueName}_macro.jpg`);
            metadataJsonPath = path.join(metadataDir, `${uniqueName}_metadata.json`);
          } else {
            // Legacy structure
            metadataDir = path.join(config.dziDir, 'metadata');
            labelFs = path.join(metadataDir, `${uniqueName}_label.jpg`);
            macroFs = path.join(metadataDir, `${uniqueName}_macro.jpg`);
            metadataJsonPath = path.join(metadataDir, `${uniqueName}_metadata.json`);
          }
          
          const labelUrl = fs.existsSync(labelFs) ? 
            (isOrganized ? `/dzi/${uniqueName}/metadata/${uniqueName}_label.jpg` : `/dzi/metadata/${uniqueName}_label.jpg`) : null;
          const macroUrl = fs.existsSync(macroFs) ? 
            (isOrganized ? `/dzi/${uniqueName}/metadata/${uniqueName}_macro.jpg` : `/dzi/metadata/${uniqueName}_macro.jpg`) : null;
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
            dziFile: hasDzi ? (isOrganized ? `/dzi/${uniqueName}/${uniqueName}.dzi` : `/dzi/${uniqueName}.dzi`) : null,
            format: ext,
            converted: hasDzi,
            size: fs.statSync(fullPath).size,
            labelUrl,
            macroUrl,
            thumbnailUrl,
            label: slideLabel,
            metadata,
            isOrganized: isOrganized
          });
        }
      }
    });
  }
  
  scanSlidesRecursively(config.slidesDir);
  
  // Check for standalone DZI files (both organized and legacy structure)
  if (fs.existsSync(config.dziDir)) {
    const entries = fs.readdirSync(config.dziDir, { withFileTypes: true });
    
    // Check organized structure (directories containing DZI files)
    entries.forEach(entry => {
      if (entry.isDirectory() && !entry.name.startsWith('_') && !entry.name.startsWith('__')) {
        const slideDir = path.join(config.dziDir, entry.name);
        const dziFile = path.join(slideDir, `${entry.name}.dzi`);
        
        if (fs.existsSync(dziFile)) {
          const baseName = entry.name;
          const existing = slideFiles.find(slide => slide.name === baseName);
          
          if (!existing) {
            // Metadata for organized structure
            const metadataDir = path.join(slideDir, 'metadata');
            const labelFs = path.join(metadataDir, `${baseName}_label.jpg`);
            const macroFs = path.join(metadataDir, `${baseName}_macro.jpg`);
            const labelUrl = fs.existsSync(labelFs) ? `/dzi/${baseName}/metadata/${baseName}_label.jpg` : null;
            const macroUrl = fs.existsSync(macroFs) ? `/dzi/${baseName}/metadata/${baseName}_macro.jpg` : null;
            const thumbnailUrl = macroUrl || labelUrl || null;
            
            slideFiles.push({
              name: baseName,
              originalFile: null,
              dziFile: `/dzi/${baseName}/${baseName}.dzi`,
              format: '.dzi',
              converted: true,
              size: 0,
              labelUrl,
              macroUrl,
              thumbnailUrl,
              isOrganized: true
            });
          }
        }
      }
    });
    
    // Check legacy structure (DZI files in root)
    const legacyDziFiles = entries.filter(entry => entry.isFile() && entry.name.endsWith('.dzi'));
    legacyDziFiles.forEach(entry => {
      const baseName = path.basename(entry.name, '.dzi');
      const existing = slideFiles.find(slide => slide.name === baseName);
      
      if (!existing) {
        // Metadata for legacy structure
        const metadataDir = path.join(config.dziDir, 'metadata');
        const labelFs = path.join(metadataDir, `${baseName}_label.jpg`);
        const macroFs = path.join(metadataDir, `${baseName}_macro.jpg`);
        const labelUrl = fs.existsSync(labelFs) ? `/dzi/metadata/${baseName}_label.jpg` : null;
        const macroUrl = fs.existsSync(macroFs) ? `/dzi/metadata/${baseName}_macro.jpg` : null;
        const thumbnailUrl = macroUrl || labelUrl || null;
        
        slideFiles.push({
          name: baseName,
          originalFile: null,
          dziFile: `/dzi/${baseName}.dzi`,
          format: '.dzi',
          converted: true,
          size: 0,
          labelUrl,
          macroUrl,
          thumbnailUrl,
          isOrganized: false
        });
      }
    });
  }
  
  res.json(slideFiles);
});

// DELETE endpoint for slides
app.delete('/api/slides/:filename', async (req, res) => {
  const filename = decodeURIComponent(req.params.filename);
  console.log(`DELETE request received for: ${filename}`);
  
  if (config.isClientMode()) {
    // Proxy deletion request to lab server
    try {
      const result = await labClient.deleteSlide(filename);
      res.json(result);
    } catch (error) {
      console.error(`Lab server delete failed for ${filename}:`, error.message);
      res.status(503).json({ error: 'Lab server unavailable', details: error.message });
    }
    return;
  }

  // Server mode - delete whatever files exist for this slide
  try {
    const baseName = filename; // Use filename directly as basename
    console.log(`Deleting all files for basename: ${baseName}`);
    
    let deletedFiles = [];
    
    // 1. Try to find and delete original slide file in slides directory
    const slideExtensions = ['.svs', '.ndpi', '.tif', '.tiff', '.jp2', '.vms', '.vmu', '.scn'];
    let originalDeleted = false;
    
    async function findAndDeleteOriginal(dir, relativePath = '') {
      if (!fs.existsSync(dir)) return false;
      
      const items = fs.readdirSync(dir, { withFileTypes: true });
      
      for (const item of items) {
        const fullPath = path.join(dir, item.name);
        const relativeFilePath = path.join(relativePath, item.name);
        
        if (item.isDirectory()) {
          // Recursively search subdirectories
          const result = await findAndDeleteOriginal(fullPath, relativeFilePath);
          if (result) {
            return result;
          }
        } else if (item.isFile()) {
          const ext = path.extname(item.name).toLowerCase();
          if (slideExtensions.includes(ext)) {
            const fileBaseName = path.basename(item.name, ext);
            const uniqueName = relativePath ? `${relativePath.replace(/[\\\/]/g, '_')}_${fileBaseName}` : fileBaseName;
            
            if (uniqueName === baseName) {
              console.log(`Found original slide: ${fullPath}`);
              // Store path for later deletion after DZI cleanup
              return { found: true, path: fullPath };
            }
          }
        }
      }
      return false;
    }
    
    const originalSlideResult = await findAndDeleteOriginal(config.slidesDir);
    let originalSlidePath = null;
    let renamedSlidePath = null;
    
    if (originalSlideResult && originalSlideResult.found) {
      originalSlidePath = originalSlideResult.path;
      
      // Immediately rename .svs to __delete_ so it disappears from GUI
      const slideDir = path.dirname(originalSlidePath);
      const slideExt = path.extname(originalSlidePath);
      renamedSlidePath = path.join(slideDir, `__delete_${baseName}_${Date.now()}${slideExt}`);
      
      try {
        fs.renameSync(originalSlidePath, renamedSlidePath);
        console.log(`✅ Original slide renamed for deletion: ${path.basename(originalSlidePath)} → ${path.basename(renamedSlidePath)}`);
      } catch (renameError) {
        console.warn(`Failed to rename original slide: ${renameError.message}`);
        renamedSlidePath = null; // Keep original path if rename failed
      }
    }
    
    // 2. Delete organized slide folder (contains DZI, tiles, and metadata)
    const organizedSlideDir = path.join(config.dziDir, baseName);
    if (fs.existsSync(organizedSlideDir)) {
      try {
        // Use robocopy mirror method for ultra-fast deletion
        const { spawn } = require('child_process');
        const tempEmptyDir = path.join(config.dziDir, `__empty_${Date.now()}`);
        
        // Create temporary empty directory
        fs.mkdirSync(tempEmptyDir, { recursive: true });
        
        console.log(`Using robocopy mirror method to delete: ${organizedSlideDir}`);
        
        // Immediately rename folder to __delete_ so it appears gone from GUI
        const deletingDir = path.join(config.dziDir, `__delete_${baseName}_${Date.now()}`);
        try {
          fs.renameSync(organizedSlideDir, deletingDir);
          deletedFiles.push('organized-folder-robocopy');
          console.log(`✅ Folder renamed for background deletion: ${organizedSlideDir} → ${path.basename(deletingDir)}`);
        } catch (renameError) {
          console.warn(`Failed to rename folder for deletion: ${renameError.message}`);
          // Continue with original path if rename failed
        }
        
        const targetDir = fs.existsSync(deletingDir) ? deletingDir : organizedSlideDir;
        
        // Use spawn instead of execSync to avoid ENOBUFS buffer overflow
        const robocopyProcess = spawn('robocopy', [
          tempEmptyDir,
          targetDir,
          '/MIR', '/NFL', '/NDL', '/NJH', '/NJS', '/NC', '/NS', '/NP'
        ], { 
          stdio: 'pipe',
          windowsHide: true 
        });
        
        let robocopySuccess = false;
        
        robocopyProcess.on('close', (code) => {
          // Robocopy exit codes: 0-3 are success, others are errors
          if (code <= 3) {
            robocopySuccess = true;
            try {
              // Remove the now-empty target directory
              fs.rmSync(targetDir, { recursive: true, force: true });
              console.log(`✅ Background robocopy cleanup completed: ${path.basename(targetDir)}`);
            } catch (rmdirError) {
              console.warn(`Failed to remove directory after robocopy: ${rmdirError.message}`);
              // Try alternative cleanup methods
              try {
                // Force delete with more aggressive options
                fs.rmSync(targetDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 1000 });
                console.log(`✅ Force deleted directory: ${path.basename(targetDir)}`);
              } catch (forceError) {
                console.warn(`Directory queued for manual cleanup: ${targetDir}`);
              }
            }
          }
          
          // Clean up temporary empty directory
          try { fs.rmdirSync(tempEmptyDir); } catch {}
          
          // If robocopy failed, try standard deletion
          if (!robocopySuccess) {
            console.warn(`Robocopy failed with code ${code}, trying standard deletion`);
            try {
              fs.rmSync(targetDir, { recursive: true, force: true });
              console.log(`Deleted folder (standard fallback): ${path.basename(targetDir)}`);
            } catch (standardError) {
              console.warn(`Standard deletion failed: ${standardError.message}`);
            }
          }
        });
        
        // Wait for robocopy to complete with timeout
        await new Promise((resolve) => {
          const timeout = setTimeout(() => {
            robocopyProcess.kill();
            resolve();
          }, 30000); // 30 second timeout
          
          robocopyProcess.on('close', () => {
            clearTimeout(timeout);
            resolve();
          });
        });
        
      } catch (error) {
        console.warn(`Failed to set up robocopy deletion: ${error.message}`);
        // Fallback to standard deletion
        try {
          fs.rmSync(organizedSlideDir, { recursive: true, force: true });
          deletedFiles.push('organized-folder-fallback');
          console.log(`Deleted organized slide folder (fallback): ${organizedSlideDir}`);
        } catch (fallbackError) {
          console.warn(`All deletion methods failed: ${fallbackError.message}`);
        }
      }
    } else {
      // Fallback: Check for legacy structure files
      console.log(`No organized folder found, checking legacy structure...`);
      
      // Delete legacy DZI file
      const legacyDziPath = path.join(config.dziDir, `${baseName}.dzi`);
      if (fs.existsSync(legacyDziPath)) {
        try {
          await deleteFileWithRetry(legacyDziPath, 5);
          deletedFiles.push('legacy-dzi');
          console.log(`Deleted legacy DZI file: ${legacyDziPath}`);
        } catch (error) {
          console.warn(`Failed to delete legacy DZI file: ${error.message}`);
        }
      }
      
      // Delete legacy tiles folder
      const legacyTilesDir = path.join(config.dziDir, `${baseName}_files`);
      if (fs.existsSync(legacyTilesDir)) {
        try {
          fs.rmSync(legacyTilesDir, { recursive: true, force: true });
          deletedFiles.push('legacy-tiles');
          console.log(`Deleted legacy tiles directory: ${legacyTilesDir}`);
        } catch (error) {
          console.warn(`Failed to delete legacy tiles directory: ${error.message}`);
        }
      }
      
      // Delete legacy metadata files
      const legacyMetadataDir = path.join(config.dziDir, 'metadata');
      const metadataFiles = [
        { path: path.join(legacyMetadataDir, `${baseName}_label.jpg`), type: 'label' },
        { path: path.join(legacyMetadataDir, `${baseName}_macro.jpg`), type: 'macro' },
        { path: path.join(legacyMetadataDir, `${baseName}_metadata.json`), type: 'metadata' },
        { path: path.join(legacyMetadataDir, `${baseName}.icc`), type: 'icc' }
      ];
      
      for (const file of metadataFiles) {
        if (fs.existsSync(file.path)) {
          try {
            fs.unlinkSync(file.path);
            deletedFiles.push(`legacy-${file.type}`);
            console.log(`Deleted legacy ${file.type} file: ${file.path}`);
          } catch (error) {
            console.warn(`Failed to delete legacy ${file.type} file: ${error.message}`);
          }
        }
      }
    }
    
    // 3. Delete cancellation flag if it exists
    const cancelledFlagFile = path.join(config.slidesDir, `.${baseName}.cancelled`);
    if (fs.existsSync(cancelledFlagFile)) {
      try {
        fs.unlinkSync(cancelledFlagFile);
        deletedFiles.push('cancellation-flag');
        console.log(`Deleted cancellation flag: ${cancelledFlagFile}`);
      } catch (error) {
        console.warn(`Failed to delete cancellation flag: ${error.message}`);
      }
    }
    
    // 4. Handle original slide deletion or rollback based on DZI deletion success
    const dziDeletionSucceeded = (deletedFiles.includes('organized-folder-robocopy') || 
                                  deletedFiles.includes('organized-folder-standard') || 
                                  deletedFiles.includes('organized-folder-fallback') ||
                                  deletedFiles.some(file => file.startsWith('legacy-')));
    
    if (originalSlidePath) {
      if (dziDeletionSucceeded) {
        // DZI deletion succeeded - delete the renamed slide file
        const slideToDelete = renamedSlidePath || originalSlidePath;
        try {
          await deleteFileWithRetry(slideToDelete, 5);
          deletedFiles.push('original');
          console.log(`✅ Deleted original slide after DZI cleanup: ${path.basename(slideToDelete)}`);
        } catch (error) {
          console.error(`Failed to delete original slide: ${error.message}`);
          // Don't fail the entire operation if we can't delete the original
          deletedFiles.push('original-failed');
          
          // If we can't delete the renamed file, try to restore original name
          if (renamedSlidePath && renamedSlidePath !== originalSlidePath) {
            try {
              fs.renameSync(renamedSlidePath, originalSlidePath);
              console.log(`⚠️  Restored original slide name after deletion failure: ${path.basename(originalSlidePath)}`);
            } catch (restoreError) {
              console.warn(`Failed to restore original slide name: ${restoreError.message}`);
            }
          }
        }
      } else {
        // DZI deletion failed - restore original slide name if it was renamed
        if (renamedSlidePath && renamedSlidePath !== originalSlidePath) {
          try {
            fs.renameSync(renamedSlidePath, originalSlidePath);
            console.log(`🔄 Restored original slide name after DZI deletion failure: ${path.basename(originalSlidePath)}`);
          } catch (restoreError) {
            console.warn(`Failed to restore original slide name: ${restoreError.message}`);
          }
        }
        console.warn(`DZI deletion failed, keeping original slide: ${path.basename(originalSlidePath)}`);
      }
    }
    
    console.log(`Deletion summary for ${baseName}: ${deletedFiles.join(', ')}`);
    
    // 5. Clean up empty parent DZI directory if it exists and is empty
    try {
      const dziParentDir = config.dziDir;
      if (fs.existsSync(dziParentDir)) {
        const remainingItems = fs.readdirSync(dziParentDir);
        // Filter out temporary directories and check if only system files remain
        const realItems = remainingItems.filter(item => 
          !item.startsWith('__empty_') && 
          !item.startsWith('__delete_') && 
          !item.startsWith('.')
        );
        
        if (realItems.length === 0) {
          console.log(`DZI parent directory is empty, removing: ${dziParentDir}`);
          // Don't delete the main DZI directory, just log it's empty
        }
      }
    } catch (error) {
      console.warn(`Failed to check DZI parent directory: ${error.message}`);
    }
    
    // Check if we actually deleted anything
    if (deletedFiles.length === 0) {
      return res.status(404).json({ 
        error: 'No files found to delete',
        message: `No files found for slide: ${baseName}`
      });
    }

    // Clear from auto-processor tracking if it exists
    if (autoProcessor && typeof autoProcessor.clearProcessedFile === 'function') {
      autoProcessor.clearProcessedFile(baseName);
    }
    
    // Clear from conversion server tracking
    try {
      if (activeConversions && activeConversions.has(baseName)) {
        activeConversions.delete(baseName);
      }
      
      const conversionServerUrl = config.conversionServerUrl || 'http://localhost:3001';
      console.log(`Clearing conversion server tracking for: ${baseName}`);
      try {
        const response = await fetch(`${conversionServerUrl}/clear/${encodeURIComponent(baseName)}`, { 
          method: 'DELETE',
          timeout: 3000 
        });
        if (response.ok) {
          console.log(`Cleared conversion server tracking for: ${baseName}`);
        } else {
          console.warn(`Failed to clear conversion server tracking: ${response.status}`);
        }
      } catch (fetchError) {
        console.warn(`Conversion server unavailable for clearing: ${fetchError.message}`);
      }
    } catch (error) {
      console.warn('Failed to clear conversion server tracking:', error.message);
    }

    // Broadcast deletion to WebSocket clients
    broadcastToClients({
      type: 'slide_deleted',
      filename: baseName,
      deletedComponents: deletedFiles
    });
    
    res.json({ 
      success: true, 
      filename: baseName,
      deletedComponents: deletedFiles 
    });
    
  } catch (error) {
    console.error(`Delete operation failed for ${filename}:`, error);
    res.status(500).json({ 
      error: 'Delete operation failed', 
      details: error.message 
    });
  }
});

// Static file serving for DZI tiles
if (config.isServerMode()) {
  // Server mode - serve DZI files and tiles directly
  const dziHeaders = (req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Range');
    return req.method === 'OPTIONS' ? res.sendStatus(204) : next();
  };

  const dziCors = cors({
    origin: config.corsOrigins,
    methods: ['GET', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Range'],
    credentials: false
  });

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

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nReceived SIGINT, shutting down gracefully...');
  
  if (autoProcessor && typeof autoProcessor.cleanup === 'function') {
    console.log('Cleaning up autoprocessor...');
    autoProcessor.cleanup().catch(error => {
      console.warn('Error during autoprocessor cleanup:', error.message);
    });
  }
  
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

module.exports = { app, server, autoProcessor };
