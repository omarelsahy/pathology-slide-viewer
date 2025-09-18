#!/usr/bin/env node

/**
 * Dedicated High-Performance Slide Conversion Server
 * Optimized for ICC transformation and DZI tile generation
 * Runs as a separate process to avoid blocking the main server
 */

const express = require('express');
const { Worker } = require('worker_threads');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const EventEmitter = require('events');

class ConversionServer extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.port = options.port || 3001;
    this.maxConcurrent = options.maxConcurrent || Math.min(os.cpus().length, 8); // Restored to 8 with compressed TIFF
    this.activeConversions = new Map();
    this.conversionQueue = [];
    this.completedConversions = new Set();
    
    // Optimized VIPS configuration
    this.vipsConfig = this.setupVipsConfig();
    
    // Express app for API
    this.app = express();
    this.setupRoutes();
    
    console.log(`\n=== CONVERSION SERVER STARTING ===`);
    console.log(`🔧 Port: ${this.port}`);
    console.log(`⚡ Max Concurrent: ${this.maxConcurrent}`);
    console.log(`💻 CPU Cores: ${os.cpus().length}`);
    console.log(`🧠 Available Memory: ${Math.round(os.totalmem() / 1024 / 1024 / 1024)}GB`);
    console.log(`===================================\n`);
  }

  setupVipsConfig() {
    const totalCores = os.cpus().length;
    const totalMemoryGB = Math.round(os.totalmem() / 1024 / 1024 / 1024);
    
    // Optimize VIPS for maximum performance
    const vipsConcurrency = Math.max(totalCores, 32); // Use all cores or minimum 32
    const vipsCacheMemory = Math.min(Math.floor(totalMemoryGB * 0.6), 64); // 60% of RAM or max 64GB
    
    return {
      VIPS_CONCURRENCY: vipsConcurrency,
      VIPS_CACHE_MAX_MEMORY: `${vipsCacheMemory}g`,
      VIPS_CACHE_MAX_FILES: '1000',
      VIPS_CACHE_TRACE: '0',
      OMP_NUM_THREADS: totalCores.toString(),
      MAGICK_THREAD_LIMIT: totalCores.toString(),
      // Disable VIPS warnings for cleaner output
      VIPS_WARNING: '0',
      // Enable SIMD optimizations
      VIPS_VECTOR: '1'
    };
  }

  setupRoutes() {
    this.app.use(express.json());
    
    // Health check
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        activeConversions: this.activeConversions.size,
        queueLength: this.conversionQueue.length,
        maxConcurrent: this.maxConcurrent,
        completedCount: this.completedConversions.size
      });
    });

    // Start conversion
    this.app.post('/convert', (req, res) => {
      const { inputPath, outputBaseName, slidesDir, dziDir } = req.body;
      
      if (!inputPath || !outputBaseName || !slidesDir || !dziDir) {
        return res.status(400).json({ error: 'Missing required parameters' });
      }

      if (!fs.existsSync(inputPath)) {
        return res.status(404).json({ error: 'Input file not found' });
      }

      // Check if already processing (but allow re-conversion of completed files)
      if (this.activeConversions.has(outputBaseName)) {
        console.log(`Conversion blocked for ${outputBaseName}: already in progress`);
        return res.status(409).json({ 
          error: 'Conversion already in progress',
          details: `File is currently being converted`
        });
      }

      // If file was previously completed, remove it from completed set to allow re-conversion
      if (this.completedConversions.has(outputBaseName)) {
        console.log(`Allowing re-conversion of previously completed file: ${outputBaseName}`);
        this.completedConversions.delete(outputBaseName);
      }

      const conversionId = this.queueConversion({
        inputPath,
        outputBaseName,
        slidesDir,
        dziDir,
        requestedAt: new Date()
      });

      res.json({
        success: true,
        conversionId,
        message: 'Conversion queued',
        queuePosition: this.conversionQueue.length
      });
    });

    // Get conversion status
    this.app.get('/status/:basename', (req, res) => {
      const basename = req.params.basename;
      
      if (this.completedConversions.has(basename)) {
        return res.json({ status: 'completed', progress: 100 });
      }
      
      const active = this.activeConversions.get(basename);
      if (active) {
        return res.json({
          status: 'processing',
          progress: active.progress || 0,
          phase: active.phase || 'Starting',
          startedAt: active.startedAt
        });
      }
      
      const queuePosition = this.conversionQueue.findIndex(item => item.outputBaseName === basename);
      if (queuePosition !== -1) {
        return res.json({
          status: 'queued',
          queuePosition: queuePosition + 1,
          estimatedStart: 'Calculating...'
        });
      }
      
      res.status(404).json({ error: 'Conversion not found' });
    });

    // Cancel conversion
    this.app.delete('/convert/:basename', (req, res) => {
      const basename = req.params.basename;
      
      // Remove from queue if queued
      const queueIndex = this.conversionQueue.findIndex(c => c.outputBaseName === basename);
      if (queueIndex !== -1) {
        this.conversionQueue.splice(queueIndex, 1);
        return res.json({ success: true, message: 'Conversion removed from queue' });
      }
      
      // Cancel active conversion
      const active = this.activeConversions.get(basename);
      if (active && active.process) {
        active.process.kill('SIGTERM');
        this.activeConversions.delete(basename);
        return res.json({ success: true, message: 'Conversion cancelled' });
      }
      
      res.status(404).json({ error: 'Conversion not found' });
    });

    // Clear conversion tracking (for comprehensive deletion)
    this.app.delete('/clear/:basename', (req, res) => {
      const basename = req.params.basename;
      
      // Remove from all tracking
      this.activeConversions.delete(basename);
      this.completedConversions.delete(basename);
      
      // Remove from queue if present
      const queueIndex = this.conversionQueue.findIndex(c => c.outputBaseName === basename);
      if (queueIndex !== -1) {
        this.conversionQueue.splice(queueIndex, 1);
      }
      
      console.log(`Cleared all tracking for: ${basename}`);
      res.json({ success: true, message: 'Conversion tracking cleared' });
    });
  }

  queueConversion(conversionData) {
    const conversionId = `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    conversionData.id = conversionId;
    
    this.conversionQueue.push(conversionData);
    this.processQueue();
    
    return conversionId;
  }

  async processQueue() {
    while (this.conversionQueue.length > 0 && this.activeConversions.size < this.maxConcurrent) {
      const conversion = this.conversionQueue.shift();
      await this.startConversion(conversion);
    }
  }

  async startConversion(conversionData) {
    const { inputPath, outputBaseName, slidesDir, dziDir } = conversionData;
    
    console.log(`\n=== STARTING CONVERSION ===`);
    console.log(`File: ${path.basename(inputPath)}`);
    console.log(`Output: ${outputBaseName}`);
    console.log(`Active: ${this.activeConversions.size}/${this.maxConcurrent}`);
    console.log(`===========================\n`);

    const conversionState = {
      ...conversionData,
      startedAt: new Date(),
      progress: 0,
      phase: 'Starting'
    };

    this.activeConversions.set(outputBaseName, conversionState);

    try {
      // Step 1: ICC Color Transform (optimized)
      await this.performICCTransform(conversionState);
      
      // Step 2: DZI Tile Generation (optimized)
      await this.performDZIConversion(conversionState);
      
      // Step 3: Metadata Extraction (parallel)
      await this.extractMetadata(conversionState);
      
      // Mark as completed
      this.completedConversions.add(outputBaseName);
      this.activeConversions.delete(outputBaseName);
      
      console.log(`✅ Conversion completed: ${outputBaseName}`);
      
      // Process next in queue
      this.processQueue();
      
    } catch (error) {
      console.error(`❌ Conversion failed: ${outputBaseName}`, error);
      this.activeConversions.delete(outputBaseName);
      
      // Process next in queue even if this one failed
      this.processQueue();
    }
  }

  async performICCTransform(conversionState) {
    return new Promise((resolve, reject) => {
      const { inputPath, outputBaseName } = conversionState;
      const tempDir = os.tmpdir();
      const tempPath = path.join(tempDir, `${outputBaseName}_icc_optimized.tif`);
      
      // Update state
      conversionState.phase = 'ICC Color Transform';
      conversionState.progress = 5;
      
      // Find optimal sRGB profile
      const sRgbProfile = this.findOptimalSRGBProfile();
      
      // Calculate optimal concurrency for this conversion
      const optimalConcurrency = Math.max(1, Math.floor(this.vipsConfig.VIPS_CONCURRENCY / this.activeConversions.size));
      
      console.log(`ICC Transform: ${path.basename(inputPath)} -> temp (concurrency: ${optimalConcurrency})`);
      
      // Skip ICC transform if using built-in sRGB or if file is already sRGB
      if (sRgbProfile === 'srgb') {
        console.log('Skipping ICC transform - using direct copy for sRGB');
        // Just copy the file instead of ICC transform
        fs.copyFileSync(inputPath, tempPath);
        conversionState.tempPath = tempPath;
        conversionState.progress = 45;
        resolve();
        return;
      }

      const args = [
        'icc_transform',
        inputPath,
        `${tempPath}[compression=lzw,Q=95]`, // Use LZW compression with high quality
        sRgbProfile,
        '--embedded=true',
        `--vips-concurrency=${optimalConcurrency}`,
        '--vips-progress'
      ];

      const env = {
        ...process.env,
        ...this.vipsConfig
      };

      const proc = spawn('vips', args, { env });
      conversionState.process = proc;

      let lastProgressTime = 0;
      const PROGRESS_THROTTLE = 500; // Update every 500ms

      proc.stdout.on('data', (data) => {
        const output = data.toString();
        const progressMatch = output.match(/(\d+)%\s+complete/);
        if (progressMatch) {
          const percent = parseInt(progressMatch[1], 10);
          const now = Date.now();
          if (now - lastProgressTime > PROGRESS_THROTTLE) {
            conversionState.progress = Math.min(45, 5 + Math.round(percent * 0.4));
            lastProgressTime = now;
          }
        }
      });

      let stderrBuffer = '';
      proc.stderr.on('data', (data) => {
        stderrBuffer += data.toString();
        console.error(`ICC Transform Error: ${data.toString()}`);
      });

      proc.on('close', (code) => {
        if (code === 0) {
          conversionState.tempPath = tempPath;
          resolve();
        } else {
          // Clean up temp file on failure
          try {
            if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
          } catch (e) {}
          console.error(`ICC transform failed with code ${code}, stderr: ${stderrBuffer}`);
          reject(new Error(`ICC transform failed with code ${code}: ${stderrBuffer}`));
        }
      });

      proc.on('error', (error) => {
        reject(error);
      });
    });
  }

  async performDZIConversion(conversionState) {
    return new Promise((resolve, reject) => {
      const { outputBaseName, dziDir, tempPath } = conversionState;
      const outputPath = path.join(dziDir, outputBaseName);
      
      // Update state
      conversionState.phase = 'Creating DZI Tiles';
      conversionState.progress = 50;
      
      // Calculate optimal settings for DZI generation
      const optimalConcurrency = Math.max(1, Math.floor(this.vipsConfig.VIPS_CONCURRENCY / this.activeConversions.size));
      
      console.log(`DZI Generation: temp -> ${outputBaseName}.dzi (concurrency: ${optimalConcurrency})`);
      
      const args = [
        'dzsave',
        tempPath,
        outputPath,
        '--layout', 'dz',
        '--suffix', '.jpg[Q=92,optimize_coding,strip]', // Slightly higher quality, optimized
        '--overlap', '1',
        '--tile-size', '256',
        `--vips-concurrency=${optimalConcurrency}`,
        '--vips-progress'
      ];

      const env = {
        ...process.env,
        ...this.vipsConfig
      };

      const proc = spawn('vips', args, { env });
      conversionState.process = proc;

      let lastProgressTime = 0;
      const PROGRESS_THROTTLE = 500;

      proc.stdout.on('data', (data) => {
        const output = data.toString();
        const progressMatch = output.match(/(\d+)%\s+complete/);
        if (progressMatch) {
          const percent = parseInt(progressMatch[1], 10);
          const now = Date.now();
          if (now - lastProgressTime > PROGRESS_THROTTLE) {
            conversionState.progress = Math.min(90, 50 + Math.round(percent * 0.4));
            lastProgressTime = now;
          }
        }
      });

      proc.stderr.on('data', (data) => {
        console.error(`DZI Generation Error: ${data.toString()}`);
      });

      proc.on('close', (code) => {
        // Clean up temp file
        try {
          if (fs.existsSync(tempPath)) {
            fs.unlinkSync(tempPath);
            console.log(`Cleaned up temp file: ${path.basename(tempPath)}`);
          }
        } catch (e) {
          console.warn('Failed to clean up temp file:', e.message);
        }

        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`DZI generation failed with code ${code}`));
        }
      });

      proc.on('error', (error) => {
        reject(error);
      });
    });
  }

  async extractMetadata(conversionState) {
    // Update state
    conversionState.phase = 'Extracting Metadata';
    conversionState.progress = 95;
    
    try {
      // Import metadata extractor if available
      const SlideMetadataExtractor = require('./slideMetadataExtractor');
      const extractor = new SlideMetadataExtractor({
        dziDir: conversionState.dziDir
      });
      
      await extractor.extractMetadata(conversionState.inputPath, conversionState.outputBaseName);
      console.log(`Metadata extracted for ${conversionState.outputBaseName}`);
    } catch (error) {
      console.warn(`Metadata extraction failed for ${conversionState.outputBaseName}:`, error.message);
      // Don't fail the entire conversion for metadata issues
    }
    
    conversionState.progress = 100;
  }

  findOptimalSRGBProfile() {
    const candidates = [
      'C:\\Windows\\System32\\spool\\drivers\\color\\sRGB Color Space Profile.icm',
      'C:\\Windows\\System32\\spool\\drivers\\color\\sRGB IEC61966-2.1.icm',
      'C:\\Windows\\System32\\spool\\drivers\\color\\sRGB_v4_ICC_preference.icc'
    ];
    
    for (const profile of candidates) {
      try {
        if (fs.existsSync(profile)) {
          console.log(`Using ICC profile: ${profile}`);
          return profile;
        }
      } catch (e) {}
    }
    
    // Fallback to libvips built-in
    console.log('Using built-in sRGB profile');
    return 'srgb';
  }

  start() {
    return new Promise((resolve) => {
      this.server = this.app.listen(this.port, () => {
        console.log(`🚀 Conversion Server: http://localhost:${this.port} ✅ RUNNING`);
        console.log(`📊 Ready to process ${this.maxConcurrent} concurrent conversions`);
        resolve();
      });
    });
  }

  async stop() {
    console.log('🛑 Shutting down conversion server...');
    
    // Cancel all active conversions
    for (const [basename, conversion] of this.activeConversions) {
      if (conversion.process) {
        conversion.process.kill('SIGTERM');
      }
    }
    
    if (this.server) {
      await new Promise((resolve) => {
        this.server.close(resolve);
      });
    }
    
    console.log('✅ Conversion server stopped');
  }
}

// Start server if run directly
if (require.main === module) {
  const server = new ConversionServer({
    port: process.env.CONVERSION_PORT || 3001,
    maxConcurrent: parseInt(process.env.MAX_CONCURRENT) || Math.min(os.cpus().length, 8)
  });
  
  server.start().catch(console.error);
  
  // Graceful shutdown
  process.on('SIGINT', async () => {
    await server.stop();
    process.exit(0);
  });
  
  process.on('SIGTERM', async () => {
    await server.stop();
    process.exit(0);
  });
}

module.exports = ConversionServer;
