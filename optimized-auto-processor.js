const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');
const EventEmitter = require('events');
const ConversionClient = require('./conversion-client');

class OptimizedAutoProcessor extends EventEmitter {
  constructor(slidesDir, options = {}) {
    super();
    
    this.slidesDir = slidesDir;
    this.isEnabled = options.enabled !== false;
    this.supportedFormats = ['.svs', '.ndpi', '.tif', '.tiff', '.jp2', '.vms', '.vmu', '.scn'];
    this.processedFiles = new Set();
    this.processingQueue = [];
    
    // Initialize conversion client
    this.conversionClient = new ConversionClient({
      url: options.conversionServerUrl || 'http://localhost:3001',
      pollInterval: 1000
    });
    
    // Forward conversion client events
    this.conversionClient.on('conversionProgress', (data) => {
      this.emit('conversionProgress', data);
    });
    
    this.conversionClient.on('conversionCompleted', (data) => {
      this.emit('fileProcessed', { success: true, ...data });
    });
    
    this.conversionClient.on('conversionError', (data) => {
      this.emit('fileProcessed', { success: false, error: data.error, ...data });
    });
    
    this.watcher = null;
    this.init();
  }

  async init() {
    if (!this.isEnabled) {
      console.log('Auto-processing is disabled');
      return;
    }

    // Check if conversion server is available
    try {
      const isAvailable = await this.conversionClient.isAvailable();
      if (!isAvailable) {
        console.log('⚠️  Conversion server not available - auto-processing disabled');
        console.log('   Start conversion server with: npm run start:conversion-server');
        return;
      }
      
      const health = await this.conversionClient.getHealth();
      console.log(`\n=== OPTIMIZED AUTO PROCESSOR INITIALIZED ===`);
      console.log(`📁 Monitoring directory: ${this.slidesDir}`);
      console.log(`📋 Supported formats: ${this.supportedFormats.join(', ')}`);
      console.log(`🔧 Conversion server: ${this.conversionClient.conversionServerUrl} ✅ CONNECTED`);
      console.log(`   └─ Max Concurrent: ${health.maxConcurrent} | Active: ${health.activeConversions} | Queue: ${health.queueLength}`);
      console.log(`============================================\n`);
      
    } catch (error) {
      console.error('Failed to connect to conversion server:', error.message);
      return;
    }

    this.startWatching();
  }

  startWatching() {
    this.watcher = chokidar.watch(this.slidesDir, {
      ignored: [
        /(^|[\/\\])\../, // Ignore dotfiles
        /.*\.tmp$/, /.*\.temp$/, /.*\.part$/,
        /.*\.crdownload$/, /.*\.download$/
      ],
      persistent: true,
      ignoreInitial: false,
      depth: undefined,
      followSymlinks: false,
      awaitWriteFinish: {
        stabilityThreshold: 5000, // Reduced from 15000ms to 5000ms
        pollInterval: 500 // Reduced from 1000ms to 500ms
      },
      usePolling: true, // Enable polling for better reliability
      interval: 1000, // Poll every second
      binaryInterval: 2000, // Poll binary files every 2 seconds
      atomic: true
    });

    this.watcher
      .on('add', (filePath) => this.handleFileAdded(filePath))
      .on('unlink', (filePath) => this.handleFileDeleted(filePath))
      .on('ready', () => {
        console.log('Optimized auto-processor file watcher is ready');
        this.emit('ready');
      })
      .on('error', (error) => {
        console.error('Auto-processor watcher error:', error);
      });
  }

  async handleFileAdded(filePath) {
    const fileName = path.basename(filePath);
    const fileExt = path.extname(fileName).toLowerCase();
    
    if (!this.supportedFormats.includes(fileExt)) {
      return;
    }

    if (this.processedFiles.has(filePath)) {
      return;
    }

    // Generate unique name for subfolders
    const relativePath = path.relative(this.slidesDir, path.dirname(filePath));
    const baseName = path.basename(fileName, fileExt);
    const uniqueName = relativePath && relativePath !== '.' ? 
      `${relativePath.replace(/[\\\/]/g, '_')}_${baseName}` : baseName;
    
    // Check if DZI already exists
    const dziPath = path.join(path.dirname(this.slidesDir), 'dzi', `${uniqueName}.dzi`);
    if (fs.existsSync(dziPath)) {
      console.log(`Skipping ${fileName} - DZI already exists`);
      this.processedFiles.add(filePath);
      return;
    }

    // Check if already being processed
    try {
      const status = await this.conversionClient.getConversionStatus(uniqueName);
      if (status.status === 'processing' || status.status === 'queued' || status.status === 'completed') {
        console.log(`Skipping ${fileName} - already ${status.status}`);
        this.processedFiles.add(filePath);
        return;
      }
    } catch (error) {
      // Status check failed, continue with processing
    }

    // File stability check - reduced threshold for better responsiveness
    try {
      const stats = fs.statSync(filePath);
      const fileAge = Date.now() - stats.mtime.getTime();
      if (fileAge < 2000) { // Reduced from 5000ms to 2000ms
        console.log(`File too recent, waiting: ${fileName} (${fileAge}ms old)`);
        setTimeout(() => {
          if (!this.processedFiles.has(filePath)) {
            this.handleFileAdded(filePath);
          }
        }, 3000); // Reduced from 10000ms to 3000ms
        return;
      }
    } catch (error) {
      console.log(`Cannot access file, retrying: ${fileName} - ${error.message}`);
      // Retry after a short delay instead of giving up
      setTimeout(() => {
        if (!this.processedFiles.has(filePath)) {
          this.handleFileAdded(filePath);
        }
      }, 5000);
      return;
    }

    console.log(`\n=== NEW SLIDE DETECTED ===`);
    console.log(`File: ${fileName}`);
    console.log(`Path: ${filePath}`);
    console.log(`Format: ${fileExt}`);
    console.log(`========================\n`);

    this.processedFiles.add(filePath);
    await this.startConversion(filePath, uniqueName);
  }

  async startConversion(filePath, baseName) {
    try {
      const dziDir = path.join(path.dirname(this.slidesDir), 'dzi');
      
      // Ensure DZI directory exists
      if (!fs.existsSync(dziDir)) {
        fs.mkdirSync(dziDir, { recursive: true });
      }

      console.log(`Starting optimized conversion for: ${baseName}`);
      
      const result = await this.conversionClient.startConversion(
        filePath,
        baseName,
        this.slidesDir,
        dziDir
      );
      
      console.log(`Conversion queued: ${baseName} (position: ${result.queuePosition})`);
      
      this.emit('fileDetected', { 
        filePath, 
        fileName: path.basename(filePath), 
        baseName,
        conversionId: result.conversionId,
        queuePosition: result.queuePosition
      });
      
    } catch (error) {
      console.error(`Failed to start conversion for ${baseName}:`, error.message);
      this.emit('fileProcessed', { 
        success: false, 
        error: error.message, 
        filename: baseName,
        fileName: path.basename(filePath),
        baseName: baseName
      });
    }
  }

  handleFileDeleted(filePath) {
    const fileName = path.basename(filePath);
    const fileExt = path.extname(fileName).toLowerCase();
    
    if (!this.supportedFormats.includes(fileExt)) {
      return;
    }

    if (this.processedFiles.has(filePath)) {
      this.processedFiles.delete(filePath);
      console.log(`\n=== SLIDE DELETED ===`);
      console.log(`File: ${fileName}`);
      console.log(`Removed from processed files tracking`);
      console.log(`====================\n`);
      
      this.emit('fileDeleted', { filePath, fileName });
    }
  }

  // Method to clear processed file tracking (called from server delete function)
  clearProcessedFile(filePath) {
    if (this.processedFiles.has(filePath)) {
      this.processedFiles.delete(filePath);
      console.log(`Cleared processed file tracking for: ${filePath}`);
    }
    
    // Also try to clear by basename if full path doesn't match
    const fileName = path.basename(filePath);
    for (const processedPath of this.processedFiles) {
      if (path.basename(processedPath) === fileName) {
        this.processedFiles.delete(processedPath);
        console.log(`Cleared processed file tracking by filename: ${processedPath}`);
        break;
      }
    }
  }

  async cancelConversion(filename) {
    try {
      return await this.conversionClient.cancelConversion(filename);
    } catch (error) {
      console.error(`Failed to cancel conversion for ${filename}:`, error.message);
      return { success: false, error: error.message };
    }
  }

  async getStatus() {
    try {
      const serverHealth = await this.conversionClient.getHealth();
      return {
        enabled: this.isEnabled,
        conversionServer: {
          available: true,
          activeConversions: serverHealth.activeConversions,
          queueLength: serverHealth.queueLength,
          maxConcurrent: serverHealth.maxConcurrent
        },
        processedCount: this.processedFiles.size,
        activePolling: this.conversionClient.getActivePolling()
      };
    } catch (error) {
      return {
        enabled: this.isEnabled,
        conversionServer: {
          available: false,
          error: error.message
        },
        processedCount: this.processedFiles.size
      };
    }
  }

  // Compatibility methods for existing server code
  getQueue() {
    return this.processingQueue.map(item => ({
      fileName: item.fileName,
      filePath: item.filePath,
      retryCount: item.retryCount || 0,
      addedAt: item.addedAt
    }));
  }

  async cleanup() {
    if (this.watcher) {
      await this.watcher.close();
    }
    if (this.conversionClient) {
      this.conversionClient.stopAllPolling();
    }
  }
}

module.exports = OptimizedAutoProcessor;
