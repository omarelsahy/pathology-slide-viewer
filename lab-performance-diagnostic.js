// Lab Computer Specific Performance Diagnostic
// Identifies why a high-spec lab computer (56 cores, 128GB RAM) is slower than home computer

const os = require('os');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { performance } = require('perf_hooks');

class LabPerformanceDiagnostic {
  constructor() {
    this.results = {
      timestamp: new Date().toISOString(),
      comparison: {},
      bottlenecks: [],
      recommendations: []
    };
  }

  // Compare actual vs expected performance
  async analyzePerformanceGap() {
    console.log('🔍 Analyzing performance gap on high-spec lab computer...');
    
    const cpus = os.cpus();
    const totalMemory = os.totalmem();
    
    this.results.comparison = {
      labSpecs: {
        cores: cpus.length,
        memoryGB: (totalMemory / 1024 / 1024 / 1024).toFixed(1),
        cpuModel: cpus[0].model
      },
      expectedPerformance: 'Should be 3-4x faster than 16-core home computer',
      actualPerformance: 'Slower than home computer',
      performanceGap: 'Significant underperformance'
    };

    console.log(`Lab Computer: ${cpus.length} cores, ${(totalMemory / 1024 / 1024 / 1024).toFixed(1)}GB RAM`);
    console.log('Expected: 3-4x faster than home computer');
    console.log('Actual: Slower than home computer');
  }

  // Check VIPS binary version and compilation flags
  async checkVipsBinary() {
    console.log('\n🔍 Analyzing VIPS binary configuration...');
    
    return new Promise((resolve) => {
      exec('vips --version && vips --vips-config', (error, stdout, stderr) => {
        if (error) {
          this.results.vipsBinary = { error: 'VIPS not accessible', details: error.message };
          resolve();
          return;
        }

        const config = stdout.toLowerCase();
        this.results.vipsBinary = {
          version: this.extractVersion(stdout),
          threading: config.includes('threads') && config.includes('yes'),
          openmp: config.includes('openmp') && config.includes('yes'),
          optimization: config.includes('o3') || config.includes('optimize'),
          simd: config.includes('vector') || config.includes('simd'),
          fullOutput: stdout
        };

        console.log(`VIPS Version: ${this.results.vipsBinary.version}`);
        console.log(`Threading: ${this.results.vipsBinary.threading ? 'Available' : 'NOT AVAILABLE'}`);
        console.log(`OpenMP: ${this.results.vipsBinary.openmp ? 'Available' : 'NOT AVAILABLE'}`);
        console.log(`Optimization: ${this.results.vipsBinary.optimization ? 'Enabled' : 'NOT ENABLED'}`);

        resolve();
      });
    });
  }

  // Check for memory allocation issues with large RAM
  async checkMemoryAllocation() {
    console.log('\n🔍 Analyzing memory allocation patterns...');
    
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    
    // Check if system is over-allocating memory
    const memoryPressure = (usedMem / totalMem) > 0.8;
    const swapUsage = usedMem > totalMem * 0.9; // Potential swap usage
    
    this.results.memory = {
      totalGB: (totalMem / 1024 / 1024 / 1024).toFixed(1),
      usedGB: (usedMem / 1024 / 1024 / 1024).toFixed(1),
      freeGB: (freeMem / 1024 / 1024 / 1024).toFixed(1),
      usagePercent: ((usedMem / totalMem) * 100).toFixed(1),
      memoryPressure: memoryPressure,
      potentialSwap: swapUsage
    };

    console.log(`Memory Usage: ${this.results.memory.usedGB}GB / ${this.results.memory.totalGB}GB (${this.results.memory.usagePercent}%)`);
    
    if (memoryPressure) {
      console.log('⚠️  High memory pressure detected');
      this.results.bottlenecks.push('High memory usage may cause performance degradation');
    }
  }

  // Check disk I/O performance with large files
  async checkDiskPerformance() {
    console.log('\n🔍 Testing disk I/O performance...');
    
    const testSizes = [100, 500, 1000]; // MB
    const results = [];
    
    for (const size of testSizes) {
      try {
        const testFile = path.join(__dirname, `temp_test_${size}mb.dat`);
        const testSize = size * 1024 * 1024;
        
        // Write test
        const writeStart = performance.now();
        const buffer = Buffer.alloc(testSize, 0);
        fs.writeFileSync(testFile, buffer);
        const writeTime = performance.now() - writeStart;
        const writeMBps = (testSize / 1024 / 1024) / (writeTime / 1000);

        // Read test
        const readStart = performance.now();
        fs.readFileSync(testFile);
        const readTime = performance.now() - readStart;
        const readMBps = (testSize / 1024 / 1024) / (readTime / 1000);

        // Cleanup
        fs.unlinkSync(testFile);

        results.push({
          sizeMB: size,
          writeMBps: writeMBps.toFixed(1),
          readMBps: readMBps.toFixed(1)
        });

        console.log(`${size}MB test - Write: ${writeMBps.toFixed(1)} MB/s, Read: ${readMBps.toFixed(1)} MB/s`);

      } catch (error) {
        console.log(`${size}MB test failed: ${error.message}`);
      }
    }
    
    this.results.diskPerformance = results;
    
    // Check for performance degradation with larger files
    if (results.length >= 2) {
      const smallWrite = parseFloat(results[0].writeMBps);
      const largeWrite = parseFloat(results[results.length - 1].writeMBps);
      
      if (largeWrite < smallWrite * 0.5) {
        this.results.bottlenecks.push('Disk performance degrades significantly with large files');
      }
    }
  }

  // Check for network storage issues
  async checkStorageLocation() {
    console.log('\n🔍 Analyzing storage configuration...');
    
    const slidesDir = path.join(__dirname, 'public', 'slides');
    const dziDir = path.join(__dirname, 'public', 'dzi');
    
    try {
      const slidesStats = fs.statSync(slidesDir);
      const dziStats = fs.statSync(dziDir);
      
      // Check if directories are on network drives
      const slidesPath = fs.realpathSync(slidesDir);
      const dziPath = fs.realpathSync(dziDir);
      
      const isNetworkSlides = slidesPath.startsWith('\\\\') || slidesPath.includes(':');
      const isNetworkDzi = dziPath.startsWith('\\\\') || dziPath.includes(':');
      
      this.results.storage = {
        slidesPath: slidesPath,
        dziPath: dziPath,
        slidesOnNetwork: isNetworkSlides && slidesPath.startsWith('\\\\'),
        dziOnNetwork: isNetworkDzi && dziPath.startsWith('\\\\'),
        sameVolume: slidesPath.charAt(0) === dziPath.charAt(0)
      };

      console.log(`Slides Directory: ${slidesPath}`);
      console.log(`DZI Directory: ${dziPath}`);
      console.log(`Network Storage: ${this.results.storage.slidesOnNetwork || this.results.storage.dziOnNetwork ? 'YES' : 'NO'}`);
      console.log(`Same Volume: ${this.results.storage.sameVolume ? 'YES' : 'NO'}`);

      if (this.results.storage.slidesOnNetwork || this.results.storage.dziOnNetwork) {
        this.results.bottlenecks.push('Network storage detected - major performance bottleneck');
      }

      if (!this.results.storage.sameVolume) {
        this.results.bottlenecks.push('Cross-volume operations may reduce performance');
      }

    } catch (error) {
      console.log(`Storage analysis failed: ${error.message}`);
    }
  }

  // Check CPU governor and power settings
  async checkPowerSettings() {
    console.log('\n🔍 Checking power and CPU settings...');
    
    return new Promise((resolve) => {
      exec('powershell "Get-WmiObject -Class Win32_Processor | Select-Object Name, MaxClockSpeed, CurrentClockSpeed"', (error, stdout, stderr) => {
        if (error) {
          console.log('Could not check CPU power settings');
          resolve();
          return;
        }

        this.results.powerSettings = {
          cpuInfo: stdout,
          throttlingDetected: stdout.includes('CurrentClockSpeed') && stdout.includes('MaxClockSpeed')
        };

        console.log('CPU Power Settings:');
        console.log(stdout);

        // Check for thermal throttling
        const lines = stdout.split('\n');
        const maxClockLine = lines.find(line => line.includes('MaxClockSpeed'));
        const currentClockLine = lines.find(line => line.includes('CurrentClockSpeed'));
        
        if (maxClockLine && currentClockLine) {
          const maxClock = parseInt(maxClockLine.match(/\d+/)?.[0] || '0');
          const currentClock = parseInt(currentClockLine.match(/\d+/)?.[0] || '0');
          
          if (currentClock < maxClock * 0.8) {
            this.results.bottlenecks.push(`CPU throttling detected: ${currentClock}MHz vs ${maxClock}MHz max`);
          }
        }

        resolve();
      });
    });
  }

  // Generate specific recommendations for lab computer
  generateRecommendations() {
    console.log('\n📋 Generating lab-specific recommendations...');

    // Network storage recommendations
    if (this.results.storage?.slidesOnNetwork || this.results.storage?.dziOnNetwork) {
      this.results.recommendations.push({
        priority: 'CRITICAL',
        category: 'Storage',
        issue: 'Network storage causing major performance bottleneck',
        solution: 'Move slides and DZI output to local SSD storage'
      });
    }

    // Memory allocation recommendations for large RAM systems
    if (this.results.memory?.memoryPressure) {
      this.results.recommendations.push({
        priority: 'HIGH',
        category: 'Memory',
        issue: 'Memory pressure on high-RAM system',
        solution: 'Reduce VIPS memory allocation or check for memory leaks'
      });
    }

    // VIPS binary optimization
    if (!this.results.vipsBinary?.openmp) {
      this.results.recommendations.push({
        priority: 'HIGH',
        category: 'VIPS',
        issue: 'VIPS compiled without OpenMP support',
        solution: 'Install VIPS binary with OpenMP for better multi-threading'
      });
    }

    // CPU throttling
    if (this.results.bottlenecks.some(b => b.includes('throttling'))) {
      this.results.recommendations.push({
        priority: 'HIGH',
        category: 'Hardware',
        issue: 'CPU thermal throttling detected',
        solution: 'Check cooling system and power settings'
      });
    }

    // Disk performance
    if (this.results.bottlenecks.some(b => b.includes('Disk performance'))) {
      this.results.recommendations.push({
        priority: 'MEDIUM',
        category: 'Storage',
        issue: 'Disk performance degrades with large files',
        solution: 'Use NVMe SSD or check disk health'
      });
    }

    // Display recommendations
    this.results.recommendations.forEach((rec, index) => {
      console.log(`\n${index + 1}. [${rec.priority}] ${rec.category}: ${rec.issue}`);
      console.log(`   Solution: ${rec.solution}`);
    });

    if (this.results.recommendations.length === 0) {
      console.log('\n🤔 No obvious bottlenecks detected. Performance issue may be:');
      console.log('   - VIPS binary optimization differences between computers');
      console.log('   - Subtle network latency issues');
      console.log('   - Different slide file locations/access patterns');
    }
  }

  extractVersion(output) {
    const versionMatch = output.match(/vips-(\d+\.\d+\.\d+)/i);
    return versionMatch ? versionMatch[1] : 'Unknown';
  }

  // Save results
  saveResults() {
    const filename = `lab-performance-diagnostic-${Date.now()}.json`;
    const filepath = path.join(__dirname, filename);
    
    try {
      fs.writeFileSync(filepath, JSON.stringify(this.results, null, 2));
      console.log(`\n📄 Results saved to: ${filename}`);
      return filepath;
    } catch (error) {
      console.error('Failed to save results:', error.message);
      return null;
    }
  }

  // Run complete lab diagnostic
  async runLabDiagnostic() {
    console.log('🚀 Lab Computer Performance Diagnostic');
    console.log('Investigating why high-spec lab computer is slower than home computer\n');
    console.log('=' .repeat(70));

    await this.analyzePerformanceGap();
    await this.checkVipsBinary();
    await this.checkMemoryAllocation();
    await this.checkDiskPerformance();
    await this.checkStorageLocation();
    await this.checkPowerSettings();
    this.generateRecommendations();

    console.log('\n' + '='.repeat(70));
    console.log('🏁 Lab Diagnostic Complete');
    
    this.saveResults();
    
    if (this.results.bottlenecks.length > 0) {
      console.log(`\n⚠️  Found ${this.results.bottlenecks.length} potential bottlenecks:`);
      this.results.bottlenecks.forEach((bottleneck, index) => {
        console.log(`   ${index + 1}. ${bottleneck}`);
      });
    }

    return this.results;
  }
}

module.exports = LabPerformanceDiagnostic;

// Run diagnostic if called directly
if (require.main === module) {
  const diagnostic = new LabPerformanceDiagnostic();
  diagnostic.runLabDiagnostic().catch(console.error);
}
