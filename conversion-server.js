#!/usr/bin/env node

/**
 * Dedicated High-Performance Slide Conversion Server
 * Optimized for ICC transformation and DZI tile generation
 * Runs as a separate process to avoid blocking the main server
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const EventEmitter = require('events');
const fetch = require('node-fetch');

class ConversionServer extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.serverId = options.id || `conversion-${require('os').hostname()}-${Date.now()}`;
    this.port = options.port || 3001;
    this.host = options.host || 'localhost';
    this.mainServerUrl = options.mainServerUrl || 'http://localhost:3102';
    this.maxConcurrent = options.maxConcurrent || Math.min(os.cpus().length, 8);
    this.activeConversions = new Map();
    this.conversionQueue = [];
    this.completedConversions = new Set();
    
    // Setup timestamped logging
    this.setupTimestampedLogging();
    
    // Configuration from main server
    this.centralConfig = null;
    this.heartbeatInterval = null;
    this.configFetched = false;
    
    // Optimized VIPS configuration (will be updated from central config)
    this.vipsConfig = this.setupVipsConfig();
    
    // Express app for API
    this.app = express();
    this.setupRoutes();
    
    console.log(`\n=== CONVERSION SERVER STARTING ===`);
    console.log(`🆔 Server ID: ${this.serverId}`);
    console.log(`🔧 Port: ${this.port}`);
    console.log(`🌐 Host: ${this.host}`);
    console.log(`🎯 Main Server: ${this.mainServerUrl}`);
    console.log(`⚡ Max Concurrent: ${this.maxConcurrent}`);
    console.log(`💻 CPU Cores: ${os.cpus().length}`);
    console.log(`🧠 Available Memory: ${Math.round(os.totalmem() / 1024 / 1024 / 1024)}GB`);
    console.log(`===================================\n`);
  }

  setupTimestampedLogging() {
    // Store original console methods
    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;
    
    // Helper function to get timestamp
    const getTimestamp = () => {
      const now = new Date();
      return now.toLocaleTimeString('en-US', { 
        hour12: false, 
        hour: '2-digit', 
        minute: '2-digit', 
        second: '2-digit',
        timeZoneName: 'short'
      });
    };
    
    // Override console methods with timestamps
    console.log = (...args) => {
      originalLog(`[${getTimestamp()}]`, ...args);
    };
    
    console.warn = (...args) => {
      originalWarn(`[${getTimestamp()}]`, ...args);
    };
    
    console.error = (...args) => {
      originalError(`[${getTimestamp()}]`, ...args);
    };
  }

  setupVipsConfig() {
    const totalCores = os.cpus().length;
    const totalMemoryGB = Math.round(os.totalmem() / 1024 / 1024 / 1024);
    
    // Optimize VIPS for maximum performance - use 70-80% cores and RAM
    const vipsConcurrency = Math.floor(totalCores * 0.75); // Use 75% of cores
    const vipsCacheMemoryGB = Math.min(Math.floor(totalMemoryGB * 0.7), 64); // 70% of RAM or max 64GB
    const vipsCacheMemoryBytes = vipsCacheMemoryGB * 1024 * 1024 * 1024;
    
    // CRITICAL: Set disc threshold HIGH to keep operations in RAM (not disk)
    const discThreshold = process.env.VIPS_DISC_THRESHOLD || (100 * 1024 * 1024 * 1024).toString();
    
    return {
      VIPS_CONCURRENCY: vipsConcurrency.toString(),
      VIPS_CACHE_MAX_MEMORY: vipsCacheMemoryBytes.toString(), // In bytes for consistency
      VIPS_DISC_THRESHOLD: discThreshold, // HIGH = keep in RAM (CRITICAL for performance)
      VIPS_CACHE_MAX_FILES: '1000',
      VIPS_CACHE_TRACE: '0',
      OMP_NUM_THREADS: totalCores.toString(),
      MAGICK_THREAD_LIMIT: totalCores.toString(),
      // Disable VIPS warnings for cleaner output
      // Enable SIMD optimizations
      VIPS_VECTOR: '1'
    };
  }

  // Fetch configuration from main server or load from app-config.json
  async fetchCentralConfig() {
    try {
      console.log(`📡 Fetching configuration from main server: ${this.mainServerUrl}/api/conversion-config`);
      const response = await fetch(`${this.mainServerUrl}/api/conversion-config`);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      this.centralConfig = await response.json();
      console.log(`✅ Central configuration fetched successfully`);
      
    } catch (error) {
      console.log(`⚠️  Could not fetch central configuration: ${error.message}`);
      console.log(`📋 Loading configuration from app-config.json`);
      
      // Try to load from app-config.json
      try {
        const configPath = path.join(__dirname, 'app-config.json');
        
        if (fs.existsSync(configPath)) {
          const configData = fs.readFileSync(configPath, 'utf8');
          const appConfig = JSON.parse(configData);
          
          this.centralConfig = {
            conversion: appConfig.conversion || {}
          };
          
          console.log(`✅ Configuration loaded from app-config.json`);
          console.log(`🔍 ICC Config from app-config.json:`, JSON.stringify(this.centralConfig.conversion.icc, null, 2));
        } else {
          throw new Error('app-config.json not found');
        }
      } catch (configError) {
        console.log(`⚠️  Could not load app-config.json: ${configError.message}`);
        console.log(`📋 Using default configuration`);
        
        // Fallback to default configuration with client-side ICC
        this.centralConfig = {
          conversion: {
            vips: {
              concurrency: Math.min(os.cpus().length, 8),
              maxMemoryMB: Math.floor(os.totalmem() / 1024 / 1024 * 0.7),
              progress: true,
              info: false,
              warning: true
            },
            icc: {
              enabled: false,
              serverSide: false,
              clientSide: true,
              extractProfile: true,
              intermediateFormat: 'tif',
              compression: 'lzw',
              quality: 95,
              useVipsNative: false
            },
            dzi: {
              tileSize: 256,
              overlap: 1,
              quality: 90
            }
          }
        };
      }
    }
    
    console.log(`🔧 Applied central configuration:`);
    console.log(`   └─ VIPS Concurrency: ${this.vipsConfig.VIPS_CONCURRENCY}`);
    console.log(`   └─ VIPS Cache Memory: ${this.vipsConfig.VIPS_CACHE_MAX_MEMORY}`);
    console.log(`   └─ VIPS Disc Threshold: ${this.vipsConfig.VIPS_DISC_THRESHOLD} (${Math.round(parseInt(this.vipsConfig.VIPS_DISC_THRESHOLD) / 1024 / 1024 / 1024)}GB)`);
    console.log(`   └─ Max Concurrent: ${this.maxConcurrent}`);
    console.log(`   └─ ICC Enabled: ${this.centralConfig.conversion?.icc?.enabled}`);
    console.log(`   └─ ICC Server-Side: ${this.centralConfig.conversion?.icc?.serverSide}`);
    console.log(`   └─ ICC Client-Side: ${this.centralConfig.conversion?.icc?.clientSide}`);
  }

  // Register with main server
  async registerWithMainServer() {
    try {
      console.log(`📝 Registering with main server: ${this.mainServerUrl}/api/conversion-servers/register`);
      
      const registrationData = {
        id: this.serverId,
        host: this.host,
        port: this.port,
        maxConcurrent: this.maxConcurrent,
        capabilities: ['icc-transform', 'dzi-generation', 'bigtiff']
      };
      
      const response = await fetch(`${this.mainServerUrl}/api/conversion-servers/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(registrationData)
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const result = await response.json();
      console.log(`✅ Successfully registered with main server`);
      console.log(`   └─ Health check interval: ${result.config?.healthCheckInterval}ms`);
      
      // Start heartbeat
      this.startHeartbeat(result.config?.healthCheckInterval || 10000);
      
      return true;
    } catch (error) {
      console.warn(`⚠️  Could not register with main server: ${error.message}`);
      console.log('🔄 Will retry registration periodically');
      return false;
    }
  }

  // Start heartbeat to main server
  startHeartbeat(interval = 10000) {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    
    this.heartbeatInterval = setInterval(async () => {
      try {
        await fetch(`${this.mainServerUrl}/api/conversion-servers/${this.serverId}/heartbeat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            activeConversions: this.activeConversions.size,
            totalConversions: this.completedConversions.size,
            status: 'active'
          })
        });
      } catch (error) {
        console.warn(`💔 Heartbeat failed: ${error.message}`);
      }
    }, interval);
    
    console.log(`💓 Started heartbeat every ${interval}ms`);
  }

  setupRoutes() {
    this.app.use(express.json({ limit: '100mb' })); // Increased limit for large file operations
    
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
        const now = Date.now();
        const totalElapsed = now - active.startedAt;
        const iccElapsed = active.iccStartTime ? now - active.iccStartTime : 0;
        
        return res.json({
          status: 'processing',
          progress: active.progress || 0,
          phase: active.phase || 'Starting',
          startedAt: active.startedAt,
          totalElapsedMs: totalElapsed,
          totalElapsedSec: Math.round(totalElapsed / 1000),
          iccElapsedMs: iccElapsed,
          iccElapsedSec: Math.round(iccElapsed / 1000),
          iccDuration: active.iccDuration,
          lastUpdate: active.lastUpdate || active.startedAt
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
      // Check if server-side ICC is enabled
      const iccConfig = this.centralConfig?.conversion?.icc || {};
      const useServerSideICC = iccConfig.enabled !== false && iccConfig.serverSide !== false;
      
      if (useServerSideICC) {
        // Two-pass: ICC transform then DZI generation (required for OpenSlide)
        console.log(`🎨 Two-pass ICC correction: transform then DZI generation`);
        await this.performICCTransform(conversionState);
        await this.performDZIConversion(conversionState);
      } else {
        // No ICC processing
        console.log(`⚡ Skipping ICC transform (disabled)`);
        conversionState.tempPath = conversionState.inputPath; // Use original file directly
        await this.performDZIConversion(conversionState);
      }
      
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
      const tempDir = this.centralConfig?.storage?.tempDir || os.tmpdir();
      
      // Get ICC configuration settings
      const iccConfig = this.centralConfig?.conversion?.icc || {
        intermediateFormat: 'tif',
        compression: 'lzw',
        quality: 95,
        useVipsNative: false
      };
      
      // DEBUG: Log ICC config
      console.log(`🔍 ICC Config received:`, JSON.stringify(iccConfig, null, 2));
      
      // Determine intermediate file format and path
      let tempPath, outputFormat;
      if (iccConfig.useVipsNative || iccConfig.useVipsFormat || iccConfig.intermediateFormat === 'v') {
        // Use VIPS native format (.v) - fastest I/O, largest files
        tempPath = path.join(tempDir, `${outputBaseName}_icc_temp.v`);
        outputFormat = ''; // No format specifier needed for .v files
        console.log(`🚀 Using VIPS native format (.v) for maximum I/O speed`);
      } else {
        // Use compressed TIFF (smaller files, slightly slower I/O)
        tempPath = path.join(tempDir, `${outputBaseName}_icc_temp.tif`);
        const compression = iccConfig.compression || 'lzw';
        const quality = iccConfig.quality || 95;
        outputFormat = `[compression=${compression},Q=${quality},bigtiff=true,strip]`;
        console.log(`💾 Using compressed TIFF format with ${compression} compression`);
      }
      
      // Update state with server-side timing
      conversionState.phase = 'ICC Color Transform';
      conversionState.progress = 5;
      conversionState.iccStartTime = Date.now();
      conversionState.lastUpdate = Date.now();
      
      // Calculate optimal concurrency for this conversion
      const optimalConcurrency = this.activeConversions.size === 1 ? 
        this.vipsConfig.VIPS_CONCURRENCY : 
        Math.max(1, Math.floor(this.vipsConfig.VIPS_CONCURRENCY / this.activeConversions.size));
      
      console.log(`ICC Transform: ${path.basename(inputPath)} -> temp (concurrency: ${optimalConcurrency})`);
      
      // Debug: Check what ICC profile info we can get
      console.log(`🔍 Checking ICC profile information...`);
      try {
        const { spawn: syncSpawn } = require('child_process');
        const profileInfo = syncSpawn('vips', ['iccexport', inputPath, '/dev/null'], { encoding: 'utf8' });
        console.log(`📊 ICC Profile debug info available`);
      } catch (err) {
        console.log(`⚠️ Could not get ICC profile info: ${err.message}`);
      }
      
      // OPTIMIZATION: Use embedded ICC profile directly instead of Windows system profiles
      // This is much faster and more accurate for pathology slides
      const args = [
        'icc_transform',
        `${inputPath}[access=sequential]`, // Sequential access reduces memory usage
        `${tempPath}${outputFormat}`, // Dynamic format based on configuration
        '--embedded', // Use the slide's embedded ICC profile as SOURCE
        'srgb',     // Target profile: built-in sRGB
        '--intent', 'perceptual', // Use perceptual intent (Aperio default)
        `--vips-concurrency=${optimalConcurrency}`,
        '--vips-progress'
      ];

      // Log the exact command for verification
      console.log(`🎨 ICC Transform Command: vips ${args.join(' ')}`);
      console.log(`✅ Using EMBEDDED ICC profile from slide (not Windows system profile)`);
      console.log(`🎯 Rendering intent: PERCEPTUAL (Aperio-compatible, step 1 of 2-profile system)`);
      console.log(`📁 Temp file: ${path.basename(tempPath)} (${iccConfig.useVipsNative || iccConfig.intermediateFormat === 'v' ? 'VIPS native' : 'compressed TIFF'})`);

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
            console.log(`ICC Transform Progress: ${outputBaseName} - ${conversionState.progress}% (VIPS: ${percent}%)`);
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
        const iccDuration = Date.now() - conversionState.iccStartTime;
        if (code === 0) {
          conversionState.tempPath = tempPath;
          conversionState.iccDuration = iccDuration;
          console.log(`✅ ICC Transform completed in ${(iccDuration/1000).toFixed(1)}s for ${outputBaseName}`);
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
      
      // For OpenSlide files (.svs), we need to use the two-pass approach
      // OpenSlide doesn't support ICC parameters in the format specifier
      const args = [
        'dzsave',
        `${tempPath}[access=sequential,memory=true]`, // Standard OpenSlide access
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
        // Clean up temp file (but not the original input file)
        try {
          if (fs.existsSync(tempPath) && tempPath !== conversionState.inputPath) {
            fs.unlinkSync(tempPath);
            console.log(`Cleaned up temp file: ${path.basename(tempPath)}`);
          } else if (tempPath === conversionState.inputPath) {
            console.log(`Skipping cleanup of original file: ${path.basename(tempPath)}`);
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

  async extractICCProfile(conversionState) {
    // Extract ICC profile from the original slide for client-side use
    return new Promise((resolve, reject) => {
      const { inputPath, outputBaseName, dziDir } = conversionState;
      
      console.log(`📊 Extracting ICC profile for client-side use: ${outputBaseName}`);
      
      // Use vipsheader to extract ICC profile data
      const proc = spawn('vipsheader', ['-f', 'icc-profile-data', inputPath]);
      
      let profileData = '';
      let errorData = '';
      
      proc.stdout.on('data', (data) => {
        profileData += data.toString();
      });
      
      proc.stderr.on('data', (data) => {
        errorData += data.toString();
      });
      
      proc.on('close', (code) => {
        if (code === 0 && profileData.trim()) {
          try {
            // Save ICC profile to metadata directory
            const metadataDir = path.join(dziDir, 'metadata');
            if (!fs.existsSync(metadataDir)) {
              fs.mkdirSync(metadataDir, { recursive: true });
            }
            
            const metadataPath = path.join(metadataDir, `${outputBaseName}.json`);
            let metadata = {};
            
            // Load existing metadata if available
            if (fs.existsSync(metadataPath)) {
              metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
            }
            
            // Add ICC profile data (base64 encoded binary data from vips)
            metadata.iccProfile = profileData.trim();
            metadata.colorSpace = 'aperio-native';
            metadata.needsTransform = true;
            
            fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
            console.log(`✅ ICC profile extracted and saved for ${outputBaseName}`);
            resolve();
          } catch (error) {
            console.warn(`Failed to save ICC profile for ${outputBaseName}:`, error.message);
            resolve(); // Don't fail conversion if ICC extraction fails
          }
        } else {
          console.warn(`No ICC profile found for ${outputBaseName} (may use default sRGB)`);
          resolve(); // Not all slides have ICC profiles, this is okay
        }
      });
      
      proc.on('error', (error) => {
        console.warn(`ICC profile extraction error for ${outputBaseName}:`, error.message);
        resolve(); // Don't fail conversion if ICC extraction fails
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

  async start() {
    // Step 1: Fetch configuration from main server
    await this.fetchCentralConfig();
    
    // Step 2: Start HTTP server
    return new Promise((resolve) => {
      this.server = this.app.listen(this.port, async () => {
        console.log(`🚀 Conversion Server: http://localhost:${this.port} ✅ RUNNING`);
        console.log(`📊 Ready to process ${this.maxConcurrent} concurrent conversions`);
        
        // Step 3: Register with main server
        await this.registerWithMainServer();
        
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
