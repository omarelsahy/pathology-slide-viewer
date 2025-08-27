const path = require('path');

// Configuration system for server vs client modes
class Config {
  constructor() {
    this.mode = process.env.NODE_MODE || 'server'; // 'server' or 'client'
    this.environment = process.env.NODE_ENV || 'development';
    
    // Common configuration
    this.port = process.env.PORT || 3000;
    this.apiVersion = 'v1';
    
    // Security
    this.apiKey = process.env.LAB_API_KEY || this.generateDefaultApiKey();
    
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
      'http://localhost:3001', // Home development
      process.env.HOME_CLIENT_URL || '*' // Allow home computer access
    ];
    
    // File paths (local to lab computer)
    this.slidesDir = path.join(__dirname, 'public', 'slides');
    this.dziDir = path.join(__dirname, 'public', 'dzi');
    this.uploadsDir = path.join(__dirname, 'uploads');
    
    // Auto-processor enabled by default on lab server
    this.autoProcessorEnabled = true;
    
    // Performance settings for lab computer
    this.enableVipsOptimization = true;
    this.enableDefenderExclusions = true;
  }

  initClientMode() {
    console.log('🏠 Initializing HOME CLIENT mode');
    
    // Home client configuration
    this.allowRemoteConnections = false;
    this.corsOrigins = ['http://localhost:3000'];
    
    // Lab server connection settings
    this.labServer = {
      url: process.env.LAB_SERVER_URL || 'http://192.168.1.100:3000',
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
      autoProcessor: this.autoProcessorEnabled,
      vipsOptimization: this.enableVipsOptimization,
      ...(this.isClientMode() && {
        labServerUrl: this.labServer.url
      })
    };
  }
}

module.exports = new Config();
