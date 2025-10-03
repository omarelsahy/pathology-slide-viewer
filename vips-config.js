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
    this.optimalThreads = Math.max(1, Math.floor(this.cpuCount * 0.75)); // Use 75% of CPU cores for better performance
    this.maxMemoryMB = Math.floor((this.totalMemory * 0.7) / (1024 * 1024)); // Use 70% of total RAM (increased from 40%)
    this.tileBufferSize = Math.min(1024, Math.floor(this.maxMemoryMB / 4)); // Quarter of allocated memory for tile buffer, max 1GB
    
    console.log(`VIPS Configuration initialized:`);
    console.log(`  CPU Cores: ${this.cpuCount} (using ${this.optimalThreads} threads)`);
    console.log(`  Total Memory: ${(this.totalMemory / 1024 / 1024 / 1024).toFixed(1)} GB`);
    console.log(`  Max VIPS Memory: ${this.maxMemoryMB} MB`);
    console.log(`  Tile Buffer Size: ${this.tileBufferSize} MB`);
  }

  // Get optimized VIPS environment variables
  getEnvironmentVars() {
    return {
      // Thread control
      VIPS_CONCURRENCY: this.optimalThreads.toString(),
      
      // Memory optimization
      VIPS_CACHE_MAX_MEMORY: (this.maxMemoryMB * 1024 * 1024).toString(),
      
      // I/O optimization
      VIPS_BUFFER_SIZE: (this.tileBufferSize * 1024 * 1024).toString(),
      
      // TIFF file handling for large files - HIGH threshold to keep everything in RAM
      // Setting this high (100GB) means VIPS will use RAM instead of disk temp files
      VIPS_DISC_THRESHOLD: (100 * 1024 * 1024 * 1024).toString(), // 100GB threshold
      
      // Progress reporting
      VIPS_PROGRESS: process.env.VIPS_PROGRESS || '1',
      
      // Disable leak checking in production (performance improvement)
      VIPS_LEAK: '0'
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
      const tempVips = `temp_srgb_${ts}.v`;
      // Use --embedded to use input's embedded profile as source, convert to sRGB.
      // Read input sequentially to reduce memory pressure and write to VIPS native format (.v)
      const inWithOpts = `${inputPath}[access=sequential]`;
      command = `vips icc_transform "${inWithOpts}" "${tempVips}" "${sRgbProfile}" --embedded && vips dzsave "${tempVips}" "${outputPath}"`;
      command += ` --layout ${layout}`;
      // Always strip profiles from tiles for size/perf
      suffixOptions += ',strip';
      // Ensure cleanup of temp
      command += ` && del "${tempVips}"`;
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
