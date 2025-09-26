const path = require('path');
const fs = require('fs');

/**
 * Unified Configuration System for Pathology Slide Viewer
 * Consolidates all configuration sources into a single, coherent system
 */
class AppConfig {
  constructor() {
    this.configPath = path.join(__dirname, '..', 'app-config.json');
    this.envPath = path.join(__dirname, '..', '.env');
    
    // Load configuration in order of precedence:
    // 1. Environment variables (highest priority)
    // 2. .env file
    // 3. app-config.json (default values)
    this.loadConfiguration();
    
    // Apply environment-specific overrides
    this.applyEnvironmentOverrides();
    
    // Validate configuration
    this.validateConfiguration();
  }

  loadConfiguration() {
    // Load base configuration from JSON file
    try {
      const configData = fs.readFileSync(this.configPath, 'utf8');
      this.config = JSON.parse(configData);
    } catch (error) {
      console.error('Failed to load app-config.json:', error.message);
      this.config = this.getDefaultConfig();
    }

    // Load .env file if it exists
    this.loadEnvFile();
  }

  loadEnvFile() {
    if (fs.existsSync(this.envPath)) {
      const envContent = fs.readFileSync(this.envPath, 'utf8');
      const envLines = envContent.split('\n');
      
      envLines.forEach(line => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const [key, ...valueParts] = trimmed.split('=');
          if (key && valueParts.length > 0) {
            const value = valueParts.join('=').trim();
            process.env[key.trim()] = value;
          }
        }
      });
    }
  }

  applyEnvironmentOverrides() {
    // Apply environment variable overrides
    if (process.env.NODE_MODE) {
      this.config.app.mode = process.env.NODE_MODE;
    }
    
    if (process.env.PORT) {
      this.config.services.backend.port = parseInt(process.env.PORT);
    }
    
    if (process.env.GUI_PORT) {
      this.config.services.gui.port = parseInt(process.env.GUI_PORT);
    }
    
    if (process.env.CONVERSION_PORT) {
      this.config.services.conversion.port = parseInt(process.env.CONVERSION_PORT);
    }
    
    if (process.env.SLIDES_DIR) {
      this.config.storage.slidesDir = process.env.SLIDES_DIR;
    }
    
    if (process.env.DZI_DIR) {
      this.config.storage.dziDir = process.env.DZI_DIR;
    }
    
    if (process.env.TEMP_DIR) {
      this.config.storage.tempDir = process.env.TEMP_DIR;
    }
    
    if (process.env.MAX_CONCURRENT) {
      this.config.services.conversion.maxConcurrent = parseInt(process.env.MAX_CONCURRENT);
    }
    
    if (process.env.VIPS_CONCURRENCY) {
      this.config.conversion.vips.concurrency = parseInt(process.env.VIPS_CONCURRENCY);
    }
    
    if (process.env.VIPS_CACHE_MAX_MEMORY) {
      this.config.conversion.vips.maxMemoryMB = Math.floor(parseInt(process.env.VIPS_CACHE_MAX_MEMORY) / (1024 * 1024));
    }

    // Apply VIPS environment variables
    this.applyVipsEnvironment();
  }

  applyVipsEnvironment() {
    const vipsConfig = this.config.conversion.vips;
    
    // Set VIPS environment variables based on configuration
    process.env.VIPS_CONCURRENCY = String(vipsConfig.concurrency);
    process.env.VIPS_NTHR = String(vipsConfig.concurrency);
    process.env.VIPS_CACHE_MAX_MEMORY = String(vipsConfig.maxMemoryMB * 1024 * 1024);
    process.env.VIPS_CACHE_MAX = String(vipsConfig.cacheMaxMB);
    process.env.VIPS_DISC_THRESHOLD = String(vipsConfig.discThresholdMB * 1024 * 1024);
    process.env.VIPS_BUFFER_SIZE = String(vipsConfig.bufferSizeMB * 1024 * 1024);
    
    process.env.VIPS_PROGRESS = vipsConfig.progress ? '1' : '0';
    process.env.VIPS_INFO = vipsConfig.info ? '1' : '0';
    process.env.VIPS_WARNING = vipsConfig.warning ? '1' : '0';
  }

  validateConfiguration() {
    // Ensure required directories exist
    this.ensureDirectories();
    
    // Validate port numbers
    this.validatePorts();
    
    // Validate paths
    this.validatePaths();
  }

  ensureDirectories() {
    const dirs = [
      this.getAbsolutePath(this.config.storage.slidesDir),
      this.getAbsolutePath(this.config.storage.dziDir),
      this.getAbsolutePath(this.config.storage.tempDir),
      this.getAbsolutePath(this.config.storage.uploadsDir),
      this.getAbsolutePath(this.config.storage.cacheDir),
      this.getAbsolutePath(this.config.storage.logsDir)
    ];

    dirs.forEach(dir => {
      if (!fs.existsSync(dir)) {
        try {
          fs.mkdirSync(dir, { recursive: true });
          console.log(`Created directory: ${dir}`);
        } catch (error) {
          console.warn(`Failed to create directory ${dir}:`, error.message);
        }
      }
    });
  }

  validatePorts() {
    const ports = [
      this.config.services.backend.port,
      this.config.services.gui.port,
      this.config.services.conversion.port
    ];

    const uniquePorts = new Set(ports);
    if (uniquePorts.size !== ports.length) {
      throw new Error('Port conflict detected: All services must use different ports');
    }

    ports.forEach(port => {
      if (port < 1024 || port > 65535) {
        throw new Error(`Invalid port number: ${port}. Must be between 1024 and 65535`);
      }
    });
  }

  validatePaths() {
    // Convert relative paths to absolute paths
    Object.keys(this.config.storage).forEach(key => {
      if (key.endsWith('Dir')) {
        this.config.storage[key] = this.getAbsolutePath(this.config.storage[key]);
      }
    });
  }

  getAbsolutePath(relativePath) {
    if (path.isAbsolute(relativePath)) {
      return relativePath;
    }
    return path.resolve(__dirname, '..', relativePath);
  }

  getDefaultConfig() {
    return {
      app: {
        name: "Pathology Slide Viewer",
        version: "1.0.0",
        mode: "server"
      },
      services: {
        backend: { port: 3102, host: "0.0.0.0" },
        gui: { port: 3003, enabled: true, autoStart: false },
        conversion: { port: 3001, enabled: true, autoStart: true, maxConcurrent: 4 }
      },
      storage: {
        slidesDir: "public/slides",
        dziDir: "public/dzi",
        tempDir: "temp",
        uploadsDir: "uploads",
        cacheDir: "cache",
        logsDir: "logs"
      },
      conversion: {
        autoProcessor: { enabled: true, maxParallelSlides: 3 },
        vips: { concurrency: 4, maxMemoryMB: 2048, progress: true, info: false, warning: true },
        icc: { enabled: true, useEmbedded: true },
        dzi: { tileSize: 256, overlap: 1, quality: 90 }
      }
    };
  }

  // Getter methods for easy access
  get app() { return this.config.app; }
  get services() { return this.config.services; }
  get storage() { return this.config.storage; }
  get conversion() { return this.config.conversion; }
  get security() { return this.config.security; }
  get performance() { return this.config.performance; }
  get logging() { return this.config.logging; }

  // Convenience methods
  isServerMode() { return this.config.app.mode === 'server'; }
  isClientMode() { return this.config.app.mode === 'client'; }
  
  getServiceUrl(serviceName) {
    const service = this.config.services[serviceName];
    if (!service) return null;
    return `http://${service.host || 'localhost'}:${service.port}`;
  }

  // Configuration summary for logging
  getSummary() {
    return {
      mode: this.config.app.mode,
      services: {
        backend: `${this.config.services.backend.host}:${this.config.services.backend.port}`,
        gui: this.config.services.gui.enabled ? `localhost:${this.config.services.gui.port}` : 'disabled',
        conversion: this.config.services.conversion.enabled ? `localhost:${this.config.services.conversion.port}` : 'disabled'
      },
      storage: {
        slides: this.config.storage.slidesDir,
        dzi: this.config.storage.dziDir,
        temp: this.config.storage.tempDir
      },
      autoProcessor: this.config.conversion.autoProcessor.enabled
    };
  }

  // Save current configuration back to file
  save() {
    try {
      const configData = JSON.stringify(this.config, null, 2);
      fs.writeFileSync(this.configPath, configData, 'utf8');
      console.log('Configuration saved successfully');
    } catch (error) {
      console.error('Failed to save configuration:', error.message);
    }
  }
}

// Export singleton instance
module.exports = new AppConfig();
