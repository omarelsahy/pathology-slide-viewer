const chokidar = require('chokidar');
const path = require('path');
const fs = require('fs');
const EventEmitter = require('events');

class AutoProcessor extends EventEmitter {
  constructor(slidesDir, convertFunction, options = {}) {
    super();
    
    this.slidesDir = slidesDir;
    this.convertFunction = convertFunction;
    this.isEnabled = options.enabled !== false; // Default to enabled
    this.maxRetries = options.maxRetries || 3;
    this.retryDelay = options.retryDelay || 5000; // 5 seconds
    this.processingQueue = [];
    this.isProcessing = false;
    this.supportedFormats = ['.svs', '.ndpi', '.tif', '.tiff', '.jp2', '.vms', '.vmu', '.scn'];
    this.watcher = null;
    this.processedFiles = new Set(); // Track processed files to avoid duplicates
    
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
    console.log(`=====================================\n`);

    this.startWatching();
  }

  startWatching() {
    // Configure chokidar watcher
    this.watcher = chokidar.watch(this.slidesDir, {
      ignored: /(^|[\/\\])\../, // Ignore dotfiles
      persistent: true,
      ignoreInitial: false, // Process existing files on startup
      awaitWriteFinish: {
        stabilityThreshold: 2000, // Wait 2 seconds after file stops changing
        pollInterval: 100
      }
    });

    this.watcher
      .on('add', (filePath) => this.handleFileAdded(filePath))
      .on('ready', () => {
        console.log('Auto-processor file watcher is ready');
        this.emit('ready');
      })
      .on('error', (error) => {
        console.error('Auto-processor watcher error:', error);
        this.emit('error', error);
      });
  }

  handleFileAdded(filePath) {
    const fileName = path.basename(filePath);
    const fileExt = path.extname(fileName).toLowerCase();
    
    // Check if file format is supported
    if (!this.supportedFormats.includes(fileExt)) {
      return;
    }

    // Check if file was already processed
    if (this.processedFiles.has(filePath)) {
      return;
    }

    // Check if file already has a DZI conversion
    const baseName = path.basename(fileName, fileExt);
    const dziPath = path.join(path.dirname(this.slidesDir), 'dzi', `${baseName}.dzi`);
    
    if (fs.existsSync(dziPath)) {
      console.log(`Skipping ${fileName} - DZI already exists`);
      this.processedFiles.add(filePath);
      return;
    }

    console.log(`\n=== NEW SLIDE DETECTED ===`);
    console.log(`File: ${fileName}`);
    console.log(`Path: ${filePath}`);
    console.log(`Format: ${fileExt}`);
    console.log(`========================\n`);

    // Add to processing queue
    this.addToQueue({
      filePath,
      fileName,
      baseName,
      retryCount: 0,
      addedAt: new Date()
    });

    this.emit('fileDetected', { filePath, fileName, baseName });
  }

  addToQueue(fileInfo) {
    // Check if file is already in queue
    const existingIndex = this.processingQueue.findIndex(item => item.filePath === fileInfo.filePath);
    if (existingIndex !== -1) {
      console.log(`File ${fileInfo.fileName} is already in processing queue`);
      return;
    }

    this.processingQueue.push(fileInfo);
    console.log(`Added to queue: ${fileInfo.fileName} (Queue length: ${this.processingQueue.length})`);
    
    this.emit('queueUpdated', {
      queueLength: this.processingQueue.length,
      added: fileInfo
    });

    // Start processing if not already running
    if (!this.isProcessing) {
      this.processQueue();
    }
  }

  async processQueue() {
    if (this.isProcessing || this.processingQueue.length === 0) {
      return;
    }

    this.isProcessing = true;
    console.log(`\n=== QUEUE PROCESSING STARTED ===`);
    console.log(`Queue length: ${this.processingQueue.length}`);
    console.log(`===============================\n`);

    while (this.processingQueue.length > 0) {
      const fileInfo = this.processingQueue.shift();
      
      try {
        await this.processFile(fileInfo);
        this.processedFiles.add(fileInfo.filePath);
        
        this.emit('fileProcessed', {
          success: true,
          fileInfo,
          queueLength: this.processingQueue.length
        });

      } catch (error) {
        console.error(`Processing failed for ${fileInfo.fileName}:`, error.message);
        
        // Handle retry logic
        if (fileInfo.retryCount < this.maxRetries) {
          fileInfo.retryCount++;
          console.log(`Scheduling retry ${fileInfo.retryCount}/${this.maxRetries} for ${fileInfo.fileName} in ${this.retryDelay}ms`);
          
          setTimeout(() => {
            this.addToQueue(fileInfo);
          }, this.retryDelay);

          this.emit('fileRetry', {
            fileInfo,
            retryCount: fileInfo.retryCount,
            maxRetries: this.maxRetries
          });

        } else {
          console.error(`Max retries exceeded for ${fileInfo.fileName}`);
          this.emit('fileProcessed', {
            success: false,
            fileInfo,
            error: error.message,
            queueLength: this.processingQueue.length
          });
        }
      }

      // Emit queue update
      this.emit('queueUpdated', {
        queueLength: this.processingQueue.length,
        processed: fileInfo
      });
    }

    this.isProcessing = false;
    console.log(`\n=== QUEUE PROCESSING COMPLETED ===\n`);
    this.emit('queueEmpty');
  }

  async processFile(fileInfo) {
    const { filePath, fileName, baseName } = fileInfo;
    
    console.log(`\n=== AUTO-PROCESSING STARTED ===`);
    console.log(`File: ${fileName}`);
    console.log(`Started: ${new Date().toLocaleTimeString()}`);
    console.log(`==============================\n`);

    this.emit('processingStarted', fileInfo);

    try {
      // Call the existing conversion function
      const result = await this.convertFunction(filePath, baseName);
      
      console.log(`\n=== AUTO-PROCESSING COMPLETED ===`);
      console.log(`File: ${fileName}`);
      console.log(`Completed: ${new Date().toLocaleTimeString()}`);
      console.log(`DZI Path: ${result.dziPath}`);
      console.log(`================================\n`);

      this.emit('processingCompleted', {
        fileInfo,
        result
      });

      return result;

    } catch (error) {
      console.error(`\n=== AUTO-PROCESSING FAILED ===`);
      console.error(`File: ${fileName}`);
      console.error(`Error: ${error.message}`);
      console.error(`=============================\n`);

      this.emit('processingFailed', {
        fileInfo,
        error
      });

      throw error;
    }
  }

  // Control methods
  enable() {
    if (this.isEnabled) return;
    
    this.isEnabled = true;
    console.log('Auto-processing enabled');
    this.startWatching();
    this.emit('enabled');
  }

  disable() {
    if (!this.isEnabled) return;
    
    this.isEnabled = false;
    console.log('Auto-processing disabled');
    
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    
    this.emit('disabled');
  }

  // Status methods
  getStatus() {
    return {
      enabled: this.isEnabled,
      isProcessing: this.isProcessing,
      queueLength: this.processingQueue.length,
      processedCount: this.processedFiles.size,
      supportedFormats: this.supportedFormats
    };
  }

  getQueue() {
    return this.processingQueue.map(item => ({
      fileName: item.fileName,
      retryCount: item.retryCount,
      addedAt: item.addedAt
    }));
  }

  // Cleanup
  destroy() {
    console.log('Shutting down auto-processor...');
    
    if (this.watcher) {
      this.watcher.close();
    }
    
    this.processingQueue = [];
    this.processedFiles.clear();
    this.removeAllListeners();
    
    console.log('Auto-processor shutdown complete');
  }
}

module.exports = AutoProcessor;
