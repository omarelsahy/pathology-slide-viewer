const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');
const EventEmitter = require('events');
const WorkerPool = require('./workerPool');

class AutoProcessor extends EventEmitter {
  constructor(slidesDir, convertFunction, options = {}) {
    super();
    
    this.slidesDir = slidesDir;
    this.convertFunction = convertFunction;
    this.isEnabled = options.enabled !== false; // Default to enabled
    this.maxRetries = options.maxRetries || 3;
    this.retryDelay = options.retryDelay || 5000; // 5 seconds
    this.maxConcurrent = options.maxConcurrent || 6; // Increased to 6 parallel conversions
    this.supportedFormats = ['.svs', '.ndpi', '.tif', '.tiff', '.jp2', '.vms', '.vmu', '.scn'];
    this.processedFiles = new Set();
    this.processingQueue = [];
    
    // Initialize worker pool for isolated conversions
    this.workerPool = new WorkerPool(this.maxConcurrent);
    
    // Forward worker pool events
    this.workerPool.on('conversionStarted', (data) => this.emit('processingStarted', data));
    this.workerPool.on('conversionProgress', (data) => this.emit('conversionProgress', data));
    this.workerPool.on('conversionCompleted', (data) => this.emit('fileProcessed', { success: true, ...data }));
    this.workerPool.on('conversionCancelled', (data) => this.emit('fileProcessed', { success: false, cancelled: true, ...data }));
    this.workerPool.on('conversionError', (data) => this.emit('fileProcessed', { success: false, error: data.error, ...data }));
    
    this.watcher = null;
    
    this.init();
  }

  init() {
    if (!this.isEnabled) {
      console.log('Auto-processing is disabled');
      return;
    }

    console.log(`\n=== AUTO PROCESSOR INITIALIZED ===`);
    console.log(`Monitoring directory: ${this.slidesDir}`);
    console.log(`Supported formats: ${this.supportedFormats.join(', ')}`);
    console.log(`Max retries: ${this.maxRetries}`);
    console.log(`Retry delay: ${this.retryDelay}ms`);
    console.log(`Max concurrent: ${this.maxConcurrent}`);
    console.log(`=====================================\n`);

    this.startWatching();
  }

  startWatching() {
    // Configure chokidar watcher with recursive subfolder support
    this.watcher = chokidar.watch(this.slidesDir, {
      ignored: [
        /(^|[\/\\])\../, // Ignore dotfiles
        /.*\.tmp$/, // Ignore temporary files
        /.*\.temp$/, // Ignore temp files
        /.*\.part$/, // Ignore partial downloads
        /.*\.crdownload$/, // Ignore Chrome downloads
        /.*\.download$/ // Ignore other download files
      ],
      persistent: true,
      ignoreInitial: false, // Process existing files on startup
      depth: undefined, // Watch all subdirectories recursively
      followSymlinks: false,
      awaitWriteFinish: {
        stabilityThreshold: 15000, // Wait 15 seconds after file stops changing (increased for large file transfers)
        pollInterval: 1000 // Check every second instead of 500ms to reduce CPU usage
      },
      // Additional stability options
      usePolling: false, // Use native file system events (faster)
      atomic: true // Wait for atomic writes to complete
    });

    this.watcher
      .on('add', (filePath) => this.handleFileAdded(filePath))
      .on('unlink', (filePath) => this.handleFileDeleted(filePath))
      .on('ready', () => {
        console.log('Auto-processor file watcher is ready');
        this.emit('ready');
      })
      .on('error', (error) => {
        console.error('Auto-processor watcher error:', error);
        // Don't emit error to prevent server crash - just log and continue
        // this.emit('error', error);
      });
  }

  handleFileAdded(filePath) {
    const fileName = path.basename(filePath);
    const fileExt = path.extname(fileName).toLowerCase();
    
    // Check if file format is supported
    if (!this.supportedFormats.includes(fileExt)) {
      return;
    }

    // Skip memory check - allow reprocessing of files that may have been deleted and reintroduced
    // if (this.processedFiles.has(filePath)) {
    //   return;
    // }

    // Generate unique name for files in subfolders to avoid conflicts
    const relativePath = path.relative(this.slidesDir, path.dirname(filePath));
    const baseName = path.basename(fileName, fileExt);
    const uniqueName = relativePath && relativePath !== '.' ? 
      `${relativePath.replace(/[\\\/]/g, '_')}_${baseName}` : baseName;
    
    // Check if file already has a DZI conversion using unique name
    const dziPath = path.join(path.dirname(this.slidesDir), 'dzi', `${uniqueName}.dzi`);
    
    if (fs.existsSync(dziPath)) {
      console.log(`Skipping ${fileName} - DZI already exists`);
      return;
    }

    // CRITICAL FIX: Check if file is currently being processed by worker pool (by filename OR unique name)
    const workerStatus = this.workerPool.getStatus();
    if (workerStatus.processingFiles.includes(fileName) || workerStatus.processingFiles.includes(uniqueName)) {
      console.log(`Skipping ${fileName} - already being processed by worker`);
      return;
    }

    // CRITICAL FIX: Check if file is already in queue (by filename OR unique name)
    const alreadyQueued = this.processingQueue.some(item => 
      item.fileName === fileName || item.baseName === uniqueName || item.filePath === filePath
    );
    if (alreadyQueued) {
      console.log(`Skipping ${fileName} - already in queue`);
      return;
    }

    // CRITICAL FIX: Additional check for file stability - ensure file isn't being written to
    try {
      const stats = fs.statSync(filePath);
      const fileAge = Date.now() - stats.mtime.getTime();
      if (fileAge < 5000) { // File modified less than 5 seconds ago
        console.log(`Skipping ${fileName} - file too recent (${fileAge}ms), may still be copying`);
        // Schedule a recheck in 10 seconds
        setTimeout(() => {
          if (!this.processedFiles.has(filePath)) {
            this.handleFileAdded(filePath);
          }
        }, 10000);
        return;
      }
    } catch (error) {
      console.log(`Skipping ${fileName} - cannot access file stats:`, error.message);
      return;
    }

    console.log(`\n=== NEW SLIDE DETECTED ===`);
    console.log(`File: ${fileName}`);
    console.log(`Path: ${filePath}`);
    console.log(`Format: ${fileExt}`);
    console.log(`========================\n`);

    // Don't mark as processed - allow reprocessing if files are deleted and reintroduced
    // this.processedFiles.add(filePath);

    // Add to processing queue
    this.addToQueue({
      filePath,
      fileName,
      baseName: uniqueName, // Use unique name for subfolder files
      retryCount: 0,
      addedAt: new Date()
    });

    this.emit('fileDetected', { filePath, fileName, baseName: uniqueName });
  }

  handleFileDeleted(filePath) {
    const fileName = path.basename(filePath);
    const fileExt = path.extname(fileName).toLowerCase();
    
    // Only handle supported formats
    if (!this.supportedFormats.includes(fileExt)) {
      return;
    }

    // Remove from processed files set so it can be reprocessed if re-added
    if (this.processedFiles.has(filePath)) {
      this.processedFiles.delete(filePath);
      console.log(`\n=== SLIDE DELETED ===`);
      console.log(`File: ${fileName}`);
      console.log(`Path: ${filePath}`);
      console.log(`Removed from processed files tracking`);
      console.log(`====================\n`);
      
      this.emit('fileDeleted', { filePath, fileName });
    }

    // Remove from processing queue if it's waiting to be processed
    const queueIndex = this.processingQueue.findIndex(item => item.filePath === filePath);
    if (queueIndex !== -1) {
      const removedItem = this.processingQueue.splice(queueIndex, 1)[0];
      console.log(`Removed ${fileName} from processing queue`);
      
      this.emit('queueUpdated', {
        queueLength: this.processingQueue.length,
        removed: removedItem
      });
    }
  }

  addToQueue(fileInfo) {
    // Check if file is already in queue
    const existingIndex = this.processingQueue.findIndex(item => item.filePath === fileInfo.filePath);
    if (existingIndex !== -1) {
      console.log(`File ${fileInfo.fileName} is already in queue, skipping`);
      return;
    }

    this.processingQueue.push(fileInfo);
    console.log(`Added to queue: ${fileInfo.fileName} (Queue length: ${this.processingQueue.length})`);
    
    this.emit('queueUpdated', {
      queueLength: this.processingQueue.length,
      added: fileInfo
    });

    // Start processing with worker pool
    this.processWithWorkers();
  }

  async processWithWorkers() {
    if (this.processingQueue.length === 0) {
      return;
    }

    const workerStatus = this.workerPool.getStatus();
    console.log(`\n=== WORKER POOL PROCESSING ===`);
    console.log(`Queue length: ${this.processingQueue.length}`);
    console.log(`Active workers: ${workerStatus.activeWorkers}/${workerStatus.maxWorkers}`);
    console.log(`===============================\n`);

    // Process items from queue with worker pool
    while (this.processingQueue.length > 0 && workerStatus.activeWorkers < workerStatus.maxWorkers) {
      const fileInfo = this.processingQueue.shift();
      
      try {
        console.log(`Starting worker for: ${fileInfo.fileName}`);
        
        // Start worker for this file
        this.workerPool.processSlide(
          fileInfo,
          {
            slidesDir: this.slidesDir,
            dziDir: path.join(path.dirname(this.slidesDir), 'dzi')
          },
          {} // vips config passed to worker
        ).then(result => {
          console.log(`Worker completed for ${fileInfo.fileName}:`, result.success ? 'SUCCESS' : 'FAILED');
          if (!result.success && !result.cancelled && fileInfo.retryCount < this.maxRetries) {
            // Retry logic
            fileInfo.retryCount++;
            console.log(`Scheduling retry ${fileInfo.retryCount}/${this.maxRetries} for ${fileInfo.fileName}`);
            setTimeout(() => {
              this.addToQueue(fileInfo);
            }, this.retryDelay);
          }
        }).catch(error => {
          console.error(`Worker error for ${fileInfo.fileName}:`, error.message);
          if (fileInfo.retryCount < this.maxRetries) {
            fileInfo.retryCount++;
            console.log(`Scheduling retry ${fileInfo.retryCount}/${this.maxRetries} for ${fileInfo.fileName}`);
            setTimeout(() => {
              this.addToQueue(fileInfo);
            }, this.retryDelay);
          }
        });
        
      } catch (error) {
        console.error(`Failed to start worker for ${fileInfo.fileName}:`, error);
      }
      
      // Update status for next iteration
      const newStatus = this.workerPool.getStatus();
      workerStatus.activeWorkers = newStatus.activeWorkers;
    }
  }

  // Cancel conversion for a specific file
  cancelConversion(filename) {
    return this.workerPool.cancelConversion(filename);
  }

  // Get current status including worker pool
  getStatus() {
    const workerStatus = this.workerPool.getStatus();
    return {
      enabled: this.isEnabled,
      queueLength: this.processingQueue.length,
      activeWorkers: workerStatus.activeWorkers,
      maxWorkers: workerStatus.maxWorkers,
      processingFiles: workerStatus.processingFiles,
      processedCount: this.processedFiles.size
    };
  }

  // Get current queue
  getQueue() {
    return this.processingQueue.map(item => ({
      fileName: item.fileName,
      filePath: item.filePath,
      retryCount: item.retryCount,
      addedAt: item.addedAt
    }));
  }

  // Cleanup method
  async cleanup() {
    if (this.watcher) {
      await this.watcher.close();
    }
    if (this.workerPool) {
      await this.workerPool.shutdown();
    }
  }
}

module.exports = AutoProcessor;
