const path = require('path');
const fs = require('fs');
require('dotenv').config(); // Load environment variables from .env file

// Unified Configuration System - Backwards Compatible
class Config {
  constructor() {
    // Load the new unified configuration
    this.appConfig = this.loadAppConfig();
    
    // Maintain backwards compatibility with existing code
    this.mode = this.appConfig.app.mode;
    this.environment = process.env.NODE_ENV || 'production';
    
    // Port configuration from unified system
    this.port = this.appConfig.services.backend.port;
    this.defaultPorts = {
      server: this.appConfig.services.backend.port,
      client: this.appConfig.services.gui.port,
      labServer: this.appConfig.services.backend.port
    };
    
    this.apiVersion = 'v1';
    
    // Security
    this.apiKey = this.appConfig.security?.apiKey?.key || this.generateDefaultApiKey();
    
    // Backwards compatibility - simulate old guiConfig
    this.guiConfig = this.createBackwardsCompatibleGuiConfig();
    this.autoDeleteOriginal = this.appConfig.performance?.autoDeleteOriginal || false;

    // Mode-specific configuration
    if (this.mode === 'server') {
      this.initServerMode();
    } else {
      this.initClientMode();
    }
  }

  loadAppConfig() {
    try {
      const configPath = path.join(__dirname, 'app-config.json');
      if (fs.existsSync(configPath)) {
        const configData = fs.readFileSync(configPath, 'utf8');
        return JSON.parse(configData);
      }
    } catch (error) {
      console.warn('Failed to load app-config.json, using defaults:', error.message);
    }
    
    // Return default configuration if file doesn't exist
    return this.getDefaultAppConfig();
  }

  createBackwardsCompatibleGuiConfig() {
    // Create a gui config object that matches the old format for backwards compatibility
    return {
      sourceDir: this.appConfig.storage.slidesDir,
      destinationDir: this.appConfig.storage.dziDir,
      tempDir: this.appConfig.storage.tempDir,
      serverPort: this.appConfig.services.backend.port,
      maxParallelSlides: this.appConfig.conversion.autoProcessor.maxParallelSlides,
      autoDeleteOriginal: this.appConfig.performance?.autoDeleteOriginal || false,
      vipsSettings: {
        concurrency: this.appConfig.conversion.vips.concurrency,
        maxMemoryMB: this.appConfig.conversion.vips.maxMemoryMB,
        bufferSizeMB: this.appConfig.conversion.vips.bufferSizeMB,
        tileSize: this.appConfig.conversion.dzi.tileSize,
        quality: this.appConfig.conversion.dzi.quality,
        progress: this.appConfig.conversion.vips.progress,
        info: this.appConfig.conversion.vips.info,
        warning: this.appConfig.conversion.vips.warning,
        overlap: this.appConfig.conversion.dzi.overlap,
        layout: this.appConfig.conversion.dzi.layout,
        embedIcc: this.appConfig.conversion.dzi.embedIcc,
        sequential: this.appConfig.conversion.dzi.sequential,
        novector: this.appConfig.conversion.dzi.novector
      }
    };
  }

  getDefaultAppConfig() {
    return {
      app: { name: "Pathology Slide Viewer", version: "1.0.0", mode: "server" },
      services: {
        backend: { port: 3102, host: "0.0.0.0" },
        gui: { port: 3003, enabled: true },
        conversion: { port: 3001, enabled: true, maxConcurrent: 8 }
      },
      storage: {
        slidesDir: "public/slides",
        dziDir: "public/dzi", 
        tempDir: "temp",
        uploadsDir: "uploads"
      },
      conversion: {
        autoProcessor: { enabled: true, maxParallelSlides: 6 },
        vips: { concurrency: 8, maxMemoryMB: 4096, progress: true, info: false, warning: true },
        dzi: { tileSize: 256, overlap: 1, quality: 90 }
      },
      performance: { autoDeleteOriginal: false }
    };
  }

  initServerMode() {
    console.log('🧪 Initializing LAB SERVER mode');
    
    // Lab server configuration
    this.allowRemoteConnections = true;
    this.corsOrigins = this.appConfig.security?.cors?.origins || [
      `http://localhost:${this.appConfig.services.gui.port}`,
      `http://localhost:${this.appConfig.services.backend.port}`,
      '*'
    ];
    
    // File paths - prioritize env vars, then app config
    this.slidesDir = process.env.SLIDES_DIR || this.getAbsolutePath(this.appConfig.storage.slidesDir);
    this.dziDir = process.env.DZI_DIR || this.getAbsolutePath(this.appConfig.storage.dziDir);
    this.uploadsDir = this.getAbsolutePath(this.appConfig.storage.uploadsDir);
    this.tempDir = process.env.TEMP_DIR || this.getAbsolutePath(this.appConfig.storage.tempDir);
    
    // Auto-processor settings
    this.autoProcessorEnabled = this.appConfig.conversion.autoProcessor.enabled;
    this.maxParallelSlides = this.appConfig.conversion.autoProcessor.maxParallelSlides;
    
    // Performance settings
    this.enableVipsOptimization = this.appConfig.performance?.enableOptimizations || true;
    this.enableDefenderExclusions = true;

    // Apply VIPS environment variables from unified config
    this.applyVipsEnvironment();
  }

  applyVipsEnvironment() {
    const vipsConfig = this.appConfig.conversion.vips;
    
    // Apply environment overrides first, then config defaults
    if (!process.env.VIPS_CONCURRENCY) process.env.VIPS_CONCURRENCY = String(vipsConfig.concurrency);
    if (!process.env.VIPS_NTHR) process.env.VIPS_NTHR = String(vipsConfig.concurrency);
    if (!process.env.VIPS_CACHE_MAX_MEMORY) process.env.VIPS_CACHE_MAX_MEMORY = String(vipsConfig.maxMemoryMB * 1024 * 1024);
    if (!process.env.VIPS_PROGRESS) process.env.VIPS_PROGRESS = vipsConfig.progress ? '1' : '0';
    if (!process.env.VIPS_INFO) process.env.VIPS_INFO = vipsConfig.info ? '1' : '0';
    if (!process.env.VIPS_WARNING) process.env.VIPS_WARNING = vipsConfig.warning ? '1' : '0';
    
    if (vipsConfig.bufferSizeMB && !process.env.VIPS_BUFFER_SIZE) {
      process.env.VIPS_BUFFER_SIZE = String(vipsConfig.bufferSizeMB * 1024 * 1024);
    }
  }

  getAbsolutePath(relativePath) {
    if (path.isAbsolute(relativePath)) {
      return relativePath;
    }
    return path.resolve(__dirname, relativePath);
  }

  initClientMode() {
    console.log('🏠 Initializing HOME CLIENT mode');
    
    // Home client configuration
    this.allowRemoteConnections = false;
    this.corsOrigins = [`http://localhost:${this.appConfig.services.gui.port}`];
    
    // Lab server connection settings (for future remote access)
    this.labServer = {
      url: process.env.LAB_SERVER_URL || `http://192.168.1.100:${this.appConfig.services.backend.port}`,
      apiKey: this.apiKey,
      timeout: 30000,
      retryAttempts: 3
    };
    
    // Local paths for client mode
    this.cacheDir = this.getAbsolutePath(this.appConfig.storage.cacheDir);
    this.tempDir = this.getAbsolutePath(this.appConfig.storage.tempDir);
    
    // Disable auto-processor on client
    this.autoProcessorEnabled = false;
    this.enableVipsOptimization = false;
  }

  generateDefaultApiKey() {
    const crypto = require('crypto');
    return crypto.randomBytes(32).toString('hex');
  }

  getApiEndpoint(endpoint) {
    return `/api/${this.apiVersion}${endpoint}`;
  }

  isServerMode() {
    return this.mode === 'server';
  }

  isClientMode() {
    return this.mode === 'client';
  }

  // Get configuration summary for logging
  getSummary() {
    return {
      mode: this.mode,
      environment: this.environment,
      port: this.port,
      slidesDir: this.slidesDir,
      dziDir: this.dziDir,
      tempDir: this.tempDir,
      autoProcessor: this.autoProcessorEnabled,
      vipsOptimization: this.enableVipsOptimization,
      services: {
        backend: this.appConfig.services.backend.port,
        gui: this.appConfig.services.gui.port,
        conversion: this.appConfig.services.conversion.port
      }
    };
  }
}

module.exports = new Config();
