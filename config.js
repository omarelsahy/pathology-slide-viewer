const path = require('path');
const fs = require('fs');

// Configuration system for server vs client modes
class Config {
  constructor() {
    this.mode = process.env.NODE_MODE || 'server'; // 'server' or 'client'
    this.environment = process.env.NODE_ENV || 'development';
    
    // Define all default ports in one place (single source of truth)
    this.defaultPorts = {
      server: 3101,    // Backend API server
      client: 3102,    // Frontend development server
      labServer: 3101
    };
    
    // Common configuration
    this.port = process.env.PORT || this.defaultPorts.server;
    this.apiVersion = 'v1';
    
    // Security
    this.apiKey = process.env.LAB_API_KEY || this.generateDefaultApiKey();
    
    // Try to load GUI config if present (so services can honor GUI settings)
    this.guiConfig = this.loadGuiConfig();
    
    // Load GUI-specific settings
    this.autoDeleteOriginal = this.guiConfig?.autoDeleteOriginal || false;

    // Mode-specific configuration
    if (this.mode === 'server') {
      this.initServerMode();
    } else {
      this.initClientMode();
    }
  }

  initServerMode() {
    console.log('🧪 Initializing LAB SERVER mode');
    
    // Lab server configuration
    this.allowRemoteConnections = true;
    this.corsOrigins = [
      `http://localhost:${this.defaultPorts.client}`, // Frontend development server
      process.env.HOME_CLIENT_URL || '*' // Allow home computer access
    ];
    
    // File paths (local to lab computer) - allow env override, then GUI config, then default
    const guiSlides = this.guiConfig?.sourceDir;
    const guiDzi = this.guiConfig?.destinationDir;
    this.slidesDir = process.env.SLIDES_DIR || guiSlides || path.join(__dirname, 'public', 'slides');
    this.dziDir = process.env.DZI_DIR || guiDzi || path.join(__dirname, 'public', 'dzi');
    this.uploadsDir = path.join(__dirname, 'uploads');
    
    // Auto-processor enabled by default on lab server
    this.autoProcessorEnabled = true;
    
    // Parallel processing settings
    this.maxParallelSlides = this.guiConfig?.maxParallelSlides || 6; // Increased from 3 to 6
    
    // Server port: env PORT wins; otherwise use GUI selection if available
    if (!process.env.PORT && this.guiConfig?.serverPort) {
      this.port = this.guiConfig.serverPort;
    }

    // Performance settings for lab computer
    this.enableVipsOptimization = true;
    this.enableDefenderExclusions = true;

    // Apply VIPS logging defaults from GUI if env not already set
    if (this.guiConfig?.vipsSettings) {
      const s = this.guiConfig.vipsSettings;
      if (process.env.VIPS_PROGRESS === undefined) process.env.VIPS_PROGRESS = s.progress ? '1' : '0';
      if (process.env.VIPS_INFO === undefined) process.env.VIPS_INFO = s.info ? '1' : '0';
      if (process.env.VIPS_WARNING === undefined) process.env.VIPS_WARNING = s.warning ? '1' : '0';
      if (process.env.VIPS_CONCURRENCY === undefined && s.concurrency) process.env.VIPS_CONCURRENCY = String(s.concurrency);
      if (process.env.VIPS_NTHR === undefined && s.concurrency) process.env.VIPS_NTHR = String(s.concurrency);
      if (process.env.VIPS_CACHE_MAX_MEMORY === undefined && s.maxMemoryMB) process.env.VIPS_CACHE_MAX_MEMORY = String(s.maxMemoryMB * 1024 * 1024);
      if (process.env.VIPS_CACHE_MAX === undefined && s.cacheMaxMB) process.env.VIPS_CACHE_MAX = String(s.cacheMaxMB);
      if (process.env.VIPS_DISC_THRESHOLD === undefined && s.discThresholdMB) process.env.VIPS_DISC_THRESHOLD = String(s.discThresholdMB * 1024 * 1024);
      if (process.env.VIPS_BUFFER_SIZE === undefined && s.bufferSizeMB) process.env.VIPS_BUFFER_SIZE = String(s.bufferSizeMB * 1024 * 1024);
    }
  }

  initClientMode() {
    console.log('🏠 Initializing HOME CLIENT mode');
    
    // Home client configuration
    this.allowRemoteConnections = false;
    this.corsOrigins = [`http://localhost:${this.defaultPorts.client}`];
    
    // Lab server connection settings
    this.labServer = {
      url: process.env.LAB_SERVER_URL || `http://192.168.1.100:${this.defaultPorts.labServer}`,
      apiKey: this.apiKey,
      timeout: 30000, // 30 seconds
      retryAttempts: 3
    };
    
    // Local paths (for caching and temp files)
    this.cacheDir = path.join(__dirname, 'cache');
    this.tempDir = path.join(__dirname, 'temp');
    
    // Disable auto-processor on home client
    this.autoProcessorEnabled = false;
    
    // Disable VIPS on home computer
    this.enableVipsOptimization = false;
  }

  generateDefaultApiKey() {
    // Generate a simple default API key for development
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
      autoProcessor: this.autoProcessorEnabled,
      vipsOptimization: this.enableVipsOptimization,
      ...(this.isClientMode() && {
        labServerUrl: this.labServer.url
      })
    };
  }

  loadGuiConfig() {
    try {
      const p = path.join(__dirname, 'gui-config.json');
      if (fs.existsSync(p)) {
        return JSON.parse(fs.readFileSync(p, 'utf8'));
      }
    } catch (e) {
      // ignore and fall back to defaults
    }
    return null;
  }
}

module.exports = new Config();
