// VIPS Performance Configuration Module
// Optimizes VIPS settings for pathology slide conversion

const os = require('os');
const { exec } = require('child_process');

class VipsConfig {
  constructor() {
    this.cpuCount = os.cpus().length;
    this.totalMemory = os.totalmem();
    this.availableMemory = os.freemem();
    
    // Calculate optimal settings based on system resources
    this.optimalThreads = Math.max(1, Math.floor(this.cpuCount * 0.5)); // Use 50% of CPU cores
    this.maxMemoryMB = Math.floor((this.totalMemory * 0.4) / (1024 * 1024)); // Use 40% of total RAM
    this.tileBufferSize = Math.min(512, Math.floor(this.maxMemoryMB / 4)); // Quarter of allocated memory for tile buffer
    
    console.log(`VIPS Configuration initialized:`);
    console.log(`  CPU Cores: ${this.cpuCount} (using ${this.optimalThreads} threads)`);
    console.log(`  Total Memory: ${(this.totalMemory / 1024 / 1024 / 1024).toFixed(1)} GB`);
    console.log(`  Max VIPS Memory: ${this.maxMemoryMB} MB`);
    console.log(`  Tile Buffer Size: ${this.tileBufferSize} MB`);
  }

  // Get optimized VIPS environment variables
  getEnvironmentVars() {
    return {
      // Threading configuration
      VIPS_CONCURRENCY: this.optimalThreads.toString(),
      VIPS_NTHR: this.optimalThreads.toString(),
      
      // Memory management
      VIPS_DISC_THRESHOLD: (this.maxMemoryMB * 1024 * 1024).toString(), // Convert to bytes
      VIPS_CACHE_MAX: this.maxMemoryMB.toString(),
      VIPS_CACHE_MAX_MEMORY: (this.maxMemoryMB * 1024 * 1024).toString(),
      
      // I/O optimization
      VIPS_BUFFER_SIZE: (this.tileBufferSize * 1024 * 1024).toString(),
      
      // Progress reporting
      VIPS_PROGRESS: '1',
      
      // Disable some checks for performance
      VIPS_NOVECTOR: '0', // Enable vectorization
      VIPS_WARNING: '0'   // Reduce warning output
    };
  }

  // Get optimized VIPS command with performance flags
  getOptimizedCommand(inputPath, outputPath, options = {}) {
    const {
      tileSize = 256,
      overlap = 1,
      quality = 80,
      layout = 'dz',
      suffix = '.jpg',
      preserveProfile = false,
      intent = 'perceptual'
    } = options;

    // Use basic VIPS command for now - add optimizations gradually
    let command = `vips dzsave "${inputPath}" "${outputPath}"`;
    command += ` --layout ${layout}`;
    command += ` --suffix ${suffix}[Q=${quality}]`;
    command += ` --overlap ${overlap}`;
    command += ` --tile-size ${tileSize}`;
    
    // Note: Color management options --profile and --intent are not supported in all VIPS versions
    // VIPS will automatically preserve embedded profiles when available
    
    return command;
  }

  // Check if GPU acceleration is available
  async checkGpuSupport() {
    return new Promise((resolve) => {
      exec('vips --vips-config', (error, stdout, stderr) => {
        if (error) {
          resolve({ available: false, reason: 'VIPS not found or error checking config' });
          return;
        }
        
        const config = stdout.toLowerCase();
        const hasOpenCL = config.includes('opencl') && config.includes('yes');
        const hasCuda = config.includes('cuda') && config.includes('yes');
        
        resolve({
          available: hasOpenCL || hasCuda,
          opencl: hasOpenCL,
          cuda: hasCuda,
          details: stdout
        });
      });
    });
  }

  // Get system performance metrics
  getSystemMetrics() {
    return {
      cpuCount: this.cpuCount,
      totalMemoryGB: (this.totalMemory / 1024 / 1024 / 1024).toFixed(1),
      availableMemoryGB: (os.freemem() / 1024 / 1024 / 1024).toFixed(1),
      loadAverage: os.loadavg(),
      platform: os.platform(),
      arch: os.arch()
    };
  }

  // Adjust settings based on current system load
  adjustForLoad() {
    const load = os.loadavg()[0]; // 1-minute load average
    const loadPerCore = load / this.cpuCount;
    
    if (loadPerCore > 0.8) {
      // High load - reduce thread count
      this.optimalThreads = Math.max(1, Math.floor(this.optimalThreads * 0.7));
      console.log(`High system load detected (${load.toFixed(2)}), reducing threads to ${this.optimalThreads}`);
    }
    
    return this.optimalThreads;
  }

  // Create a performance benchmark function
  async benchmarkConversion(testFile, outputDir) {
    const startTime = Date.now();
    const startMetrics = this.getSystemMetrics();
    
    console.log('Starting VIPS performance benchmark...');
    console.log('System metrics at start:', startMetrics);
    
    // This would be called by the actual conversion function
    // Return benchmark data structure
    return {
      startTime,
      startMetrics,
      config: {
        threads: this.optimalThreads,
        memoryMB: this.maxMemoryMB,
        bufferSizeMB: this.tileBufferSize
      }
    };
  }
}

module.exports = VipsConfig;
