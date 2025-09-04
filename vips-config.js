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
      iccProfile = null,
      embedIcc = true
    } = options;

    // Base VIPS command
    let command = `vips dzsave "${inputPath}" "${outputPath}"`;
    command += ` --layout ${layout}`;
    
    // Handle ICC: Option A - transform to sRGB using embedded input profile, then strip from output tiles
    const fs = require('fs');
    let suffixOptions = `Q=${quality}`;

    // Common Windows sRGB profile locations
    const sRgbCandidates = [
      'C:\\Windows\\System32\\spool\\drivers\\color\\sRGB Color Space Profile.icm',
      'C:\\Windows\\System32\\spool\\drivers\\color\\sRGB IEC61966-2.1.icm',
      'C:\\Windows\\System32\\spool\\drivers\\color\\sRGB_v4_ICC_preference.icc'
    ];
    const sRgbProfile = sRgbCandidates.find(p => {
      try { return fs.existsSync(p); } catch { return false; }
    }) || null;

    if (sRgbProfile) {
      const ts = Date.now();
      const tempTiff = `temp_srgb_${ts}.tiff`;
      // Use --embedded to use input's embedded profile as source, convert to sRGB
      command = `vips icc_transform "${inputPath}" "${tempTiff}" "${sRgbProfile}" --embedded && vips dzsave "${tempTiff}" "${outputPath}"`;
      command += ` --layout ${layout}`;
      // Always strip profiles from tiles for size/perf
      suffixOptions += ',strip';
      // Ensure cleanup
      command += ` && del "${tempTiff}"`;
    } else {
      // No sRGB profile found, proceed without transform but strip profiles
      suffixOptions += ',strip';
    }
    // If embedIcc is true, we still avoid embedding to reduce tile size (Option A)
    
    command += ` --suffix ${suffix}[${suffixOptions}]`;
    command += ` --overlap ${overlap}`;
    command += ` --tile-size ${tileSize}`;
    
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
