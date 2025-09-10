const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Cleanup function for temporary files
function cleanupTempFiles() {
  const tempDir = os.tmpdir();
  try {
    const tempFiles = fs.readdirSync(tempDir).filter(file => 
      file.startsWith('slide_temp_') || file.startsWith('vips-')
    );
    
    tempFiles.forEach(file => {
      try {
        const fullPath = path.join(tempDir, file);
        if (fs.statSync(fullPath).isFile()) {
          fs.unlinkSync(fullPath);
        }
      } catch (error) {
        // Ignore cleanup errors
      }
    });
  } catch (error) {
    // Ignore if temp dir doesn't exist or can't be read
  }
}

class ConversionWorker {
  constructor(data) {
    // Extract data from workerData structure
    this.slideInfo = data.slideInfo;
    this.config = data.config;
    this.vipsConfig = data.vipsConfig;
    
    // Set up paths and environment
    this.svsPath = this.slideInfo.filePath;
    this.baseName = this.slideInfo.baseName || path.parse(this.slideInfo.fileName).name;
    this.outputPath = path.join(this.config.dziDir, this.baseName);
    
    // Track active processes for cleanup
    this.activeProcesses = new Set();
    
    // Handle empty vipsConfig by creating default VIPS environment
    if (!this.vipsConfig.env) {
      const VipsConfig = require('./vips-config');
      const vipsConfigInstance = new VipsConfig();
      this.vipsEnv = {
        ...process.env,
        ...vipsConfigInstance.getEnvironmentVars()
      };
      this.numWorkers = vipsConfigInstance.optimalThreads;
    } else {
      this.vipsEnv = this.vipsConfig.env;
      this.numWorkers = this.vipsConfig.concurrency || 4;
    }
    
    // Set up cleanup handler for worker termination
    if (parentPort) {
      parentPort.on('close', () => {
        this.cleanup();
      });
    }
  }

  // Clean up all active processes
  cleanup() {
    console.log(`Cleaning up ${this.activeProcesses.size} active processes for ${this.baseName}`);
    for (const proc of this.activeProcesses) {
      try {
        if (!proc.killed) {
          proc.kill('SIGTERM');
          // Force kill after 2 seconds if still running
          setTimeout(() => {
            if (!proc.killed) {
              proc.kill('SIGKILL');
            }
          }, 2000);
        }
      } catch (error) {
        console.error('Error killing process:', error);
      }
    }
    this.activeProcesses.clear();
  }

  async processSlide() {
    console.log(`Worker processing: ${this.svsPath}`);
    console.log(`Worker data:`, JSON.stringify({
      slideInfo: this.slideInfo,
      config: this.config,
      vipsConfig: this.vipsConfig
    }, null, 2));
    
    // Debug: Check if filePath is undefined
    if (!this.slideInfo.filePath) {
      console.error(`ERROR: slideInfo.filePath is undefined!`);
      console.error(`slideInfo:`, this.slideInfo);
      throw new Error(`slideInfo.filePath is undefined - cannot process slide`);
    }

    // Listen for termination messages
    if (parentPort) {
      parentPort.on('message', (message) => {
        if (message.type === 'terminate') {
          console.log(`Received termination signal for ${this.baseName}`);
          this.cleanup();
          process.exit(0);
        }
      });
    }
    
    this.sendProgress('start', { 
      filename: this.baseName, 
      phase: 'Starting Conversion' 
    });
    try {
      console.log(`Starting conversion for ${this.slideInfo.fileName}`);
      this.sendProgress('started', { message: 'Starting conversion...' });
      
      // Check file accessibility with retry mechanism
      await this.waitForFileAccess();
      
      const tempDir = require('os').tmpdir();
      const tempPath = path.join(tempDir, `${this.baseName}_icc_temp.v`);
  
      await this.applyICCTransform(this.svsPath, tempPath, this.vipsEnv);
      await this.convertToDZI(tempPath, this.outputPath, this.vipsEnv, this.baseName);
      await this.extractMetadata();
      
      // Clean up temporary file
      try {
        if (fs.existsSync(tempPath)) {
          fs.unlinkSync(tempPath);
          console.log(`Cleaned up temporary file: ${tempPath}`);
        }
      } catch (error) {
        console.warn('Failed to clean up temp file:', error.message);
      }
      
      this.sendProgress('completed', { message: 'Conversion completed successfully!' });
    } catch (error) {
      console.error(`Conversion failed for ${this.slideInfo.fileName}:`, error);
      this.sendProgress('error', { error: error.message });
    } finally {
      this.cleanup();
    }
  }

  // Wait for file to be accessible and not locked
  async waitForFileAccess(maxRetries = 5, retryDelay = 2000) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Try to open the file for reading to check if it's accessible
        const fs = require('fs').promises;
        const handle = await fs.open(this.slideInfo.filePath, 'r');
        await handle.close();
        
        console.log(`File ${this.slideInfo.fileName} is accessible (attempt ${attempt})`);
        return; // File is accessible
      } catch (error) {
        if (error.code === 'EACCES' || error.code === 'EBUSY' || error.code === 'EPERM') {
          console.log(`File ${this.slideInfo.fileName} is locked/busy, retrying in ${retryDelay}ms (attempt ${attempt}/${maxRetries})`);
          
          if (attempt === maxRetries) {
            throw new Error(`File access denied after ${maxRetries} attempts. File may be locked by another process: ${error.message}`);
          }
          
          // Wait before retrying
          await new Promise(resolve => setTimeout(resolve, retryDelay));
        } else {
          throw error; // Different error, don't retry
        }
      }
    }
  }


  async getSlideInfo(svsPath, vipsEnv) {
    // Skip dimension detection for now and use reasonable defaults
    // The actual conversion will work regardless of these values
    console.log('Skipping slide dimension detection, using default values');
    return Promise.resolve({ width: 40000, height: 30000 });
  }

  async applyICCTransform(inputPath, outputPath, vipsEnv) {
    return new Promise((resolve, reject) => {
      // Find sRGB profile
      const sRgbCandidates = [
        'C\\Windows\\System32\\spool\\drivers\\color\\sRGB Color Space Profile.icm',
        'C\\Windows\\System32\\spool\\drivers\\color\\sRGB IEC61966-2.1.icm',
        'C\\Windows\\System32\\spool\\drivers\\color\\sRGB_v4_ICC_preference.icc'
      ];
      let chosenProfile = sRgbCandidates.find(p => {
        try { return fs.existsSync(p); } catch { return false; }
      });
      if (!chosenProfile) {
        // Fallback to libvips built-in sRGB if file not found
        chosenProfile = 'srgb';
      }

      // Calculate per-worker concurrency to avoid resource contention
      const maxWorkers = 12; // keep in sync with worker pool size
      const perWorkerConcurrency = Math.max(1, Math.floor((vipsEnv.VIPS_CONCURRENCY || 56) / maxWorkers));

      console.log(`ICC Transform command: vips icc_transform "${inputPath}" -> "${outputPath}" (profile: ${chosenProfile}, concurrency: ${perWorkerConcurrency})`);

      const proc = spawn('vips', [
        'icc_transform',
        inputPath,
        outputPath,
        chosenProfile,
        `--vips-concurrency=${perWorkerConcurrency}`,
        '--vips-progress'
      ], { env: vipsEnv });

      // Track this process for cleanup
      this.activeProcesses.add(proc);

      let errBuf = '';
      let lastProgressTime = 0;
      const PROGRESS_THROTTLE_MS = 1000;

      proc.stdout.on('data', (data) => {
        const output = data.toString();
        // Parse progress and forward to frontend with throttling
        const progressMatch = output.match(/(\d+)%\s+complete/);
        if (progressMatch) {
          const percent = parseInt(progressMatch[1], 10);
          const now = Date.now();
          if (now - lastProgressTime > PROGRESS_THROTTLE_MS) {
            this.sendProgress('progress', {
              filename: this.baseName,
              phase: 'ICC Color Transform',
              percent: Math.min(50, Math.round(10 + (percent * 0.4)))
            });
            lastProgressTime = now;
          }
        }
      });

      proc.stderr.on('data', (data) => {
        errBuf += data.toString();
      });

      proc.on('close', (code) => {
        // Remove from active processes
        this.activeProcesses.delete(proc);
        if (code === 0) {
          resolve();
        } else {
          console.error('ICC transform stderr:', errBuf);
          reject(new Error(`ICC transform failed: ${errBuf}`));
        }
      });
    });
  }

  // Convert (icc-transformed) intermediate to Deep Zoom Image tiles
  async convertToDZI(inputPath, outputBasePath, vipsEnv, baseName) {
    return new Promise((resolve, reject) => {
      const args = [
        'dzsave',
        inputPath,
        outputBasePath,
        '--layout', 'dz',
        '--suffix', '.jpg[Q=90,strip]',
        '--overlap', '1',
        '--tile-size', '256',
        `--vips-concurrency=${this.numWorkers || 4}`,
        '--vips-progress'
      ];

      console.log('Running DZI save: vips ' + args.join(' '));
      const proc = spawn('vips', args, { env: vipsEnv });

      // Track this process for cleanup
      this.activeProcesses.add(proc);

      let errBuf = '';
      let lastProgressTime = 0;
      const PROGRESS_THROTTLE_MS = 1000;

      proc.stdout.on('data', (data) => {
        const output = data.toString();
        const progressMatch = output.match(/(\d+)%\s+complete/);
        if (progressMatch) {
          const percent = parseInt(progressMatch[1], 10);
          const now = Date.now();
          if (now - lastProgressTime > PROGRESS_THROTTLE_MS) {
            this.sendProgress('progress', {
              filename: this.baseName,
              phase: 'Creating DZI Tiles',
              percent: Math.min(90, 50 + Math.round(percent * 0.4))
            });
            lastProgressTime = now;
          }
        }
      });

      proc.stderr.on('data', (data) => {
        errBuf += data.toString();
      });

      proc.on('close', (code) => {
        // Remove from active processes
        this.activeProcesses.delete(proc);
        if (code === 0) {
          resolve();
        } else {
          console.error('DZI conversion stderr:', errBuf);
          reject(new Error(`DZI conversion failed: ${errBuf}`));
        }
      });
    });
  }

  sendProgress(type, data) {
    if (parentPort) {
      parentPort.postMessage({ type, data });
    }
  }

  // Extract metadata from the original slide file
  async extractMetadata() {
    try {
      this.sendProgress('progress', { 
        filename: this.baseName, 
        phase: 'Extracting Metadata', 
        percent: 95 
      });

      console.log(`Extracting metadata for ${this.slideInfo.fileName}`);
      
      // Import and initialize metadata extractor
      const SlideMetadataExtractor = require('./slideMetadataExtractor');
      const metadataExtractor = new SlideMetadataExtractor(this.config);
      
      // Extract metadata using the unique baseName for subfolder files
      const metadata = await metadataExtractor.extractMetadata(this.slideInfo.filePath, this.baseName);
      
      console.log(`Metadata extraction completed for ${this.baseName}`);
      console.log(`Label: ${metadata.label ? 'extracted' : 'none'}, Macro: ${metadata.macro ? 'extracted' : 'none'}`);
      
      return metadata;
    } catch (error) {
      console.error(`Metadata extraction failed for ${this.slideInfo.fileName}:`, error);
      // Don't fail the entire conversion if metadata extraction fails
      return null;
    }
  }
}

// Initialize and run worker
cleanupTempFiles();

const worker = new ConversionWorker(workerData);
worker.processSlide()
  .then(result => {
    if (parentPort) {
      parentPort.postMessage({ type: 'result', data: result });
    }
    process.exit(0);
  })
  .catch(error => {
    console.error('Worker error:', error);
    if (parentPort) {
      parentPort.postMessage({ type: 'error', data: { error: error.message } });
    }
    process.exit(1);
  });
