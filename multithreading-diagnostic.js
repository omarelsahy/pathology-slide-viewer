// Multithreading Diagnostic for Home Computer
// Checks if VIPS is actually using multiple threads during conversion

const os = require('os');
const fs = require('fs');
const path = require('path');
const { exec, spawn } = require('child_process');
const { performance } = require('perf_hooks');

class MultithreadingDiagnostic {
  constructor() {
    this.results = {
      timestamp: new Date().toISOString(),
      system: {},
      vipsConfig: {},
      actualThreading: {},
      cpuUtilization: {},
      recommendations: []
    };
  }

  // Analyze system specs
  analyzeSystem() {
    console.log('🔍 Analyzing system configuration...');
    
    const cpus = os.cpus();
    const totalMemory = os.totalmem();
    
    this.results.system = {
      cpuModel: cpus[0].model,
      cores: cpus.length,
      clockSpeed: cpus[0].speed,
      totalMemoryGB: (totalMemory / 1024 / 1024 / 1024).toFixed(1),
      platform: os.platform(),
      arch: os.arch()
    };

    console.log(`CPU: ${this.results.system.cpuModel}`);
    console.log(`Cores: ${this.results.system.cores} @ ${this.results.system.clockSpeed} MHz`);
    console.log(`Memory: ${this.results.system.totalMemoryGB} GB`);
  }

  // Check VIPS configuration and capabilities
  async checkVipsConfig() {
    console.log('\n🔍 Checking VIPS configuration...');
    
    return new Promise((resolve) => {
      exec('vips --version && vips --vips-config', (error, stdout, stderr) => {
        if (error) {
          this.results.vipsConfig = { error: 'VIPS not found', details: error.message };
          console.log('❌ VIPS not found');
          resolve();
          return;
        }

        const config = stdout.toLowerCase();
        this.results.vipsConfig = {
          version: this.extractVersion(stdout),
          hasThreading: config.includes('threads') && config.includes('yes'),
          hasOpenMP: config.includes('openmp') && config.includes('yes'),
          hasGLib: config.includes('glib') && config.includes('yes'),
          fullConfig: stdout
        };

        console.log(`VIPS Version: ${this.results.vipsConfig.version}`);
        console.log(`Threading Support: ${this.results.vipsConfig.hasThreading ? 'YES' : 'NO'}`);
        console.log(`OpenMP Support: ${this.results.vipsConfig.hasOpenMP ? 'YES' : 'NO'}`);
        console.log(`GLib Support: ${this.results.vipsConfig.hasGLib ? 'YES' : 'NO'}`);

        resolve();
      });
    });
  }

  // Test actual CPU utilization during VIPS operation
  async testActualThreading() {
    console.log('\n🔍 Testing actual CPU utilization during VIPS operation...');
    
    // Create a test image for conversion
    const testImagePath = path.join(__dirname, 'test-image.tif');
    const testOutputPath = path.join(__dirname, 'test-output');
    
    try {
      // Create a test image if it doesn't exist
      if (!fs.existsSync(testImagePath)) {
        console.log('Creating test image...');
        await this.createTestImage(testImagePath);
      }

      console.log('Starting CPU monitoring...');
      const cpuMonitor = this.startCpuMonitoring();

      console.log('Running VIPS conversion...');
      const conversionStart = performance.now();
      
      await this.runVipsConversion(testImagePath, testOutputPath);
      
      const conversionTime = performance.now() - conversionStart;
      const cpuStats = await this.stopCpuMonitoring(cpuMonitor);

      this.results.actualThreading = {
        conversionTimeMs: conversionTime.toFixed(1),
        maxCpuUsage: cpuStats.maxUsage,
        avgCpuUsage: cpuStats.avgUsage,
        coresUtilized: cpuStats.coresUsed,
        isMultithreaded: cpuStats.coresUsed > 1.5 // Allow for measurement variance
      };

      console.log(`Conversion Time: ${(conversionTime / 1000).toFixed(1)} seconds`);
      console.log(`Max CPU Usage: ${cpuStats.maxUsage.toFixed(1)}%`);
      console.log(`Cores Utilized: ${cpuStats.coresUsed.toFixed(1)}`);
      console.log(`Multithreading Active: ${this.results.actualThreading.isMultithreaded ? 'YES' : 'NO'}`);

      // Cleanup
      this.cleanup([testImagePath, testOutputPath, `${testOutputPath}.dzi`, `${testOutputPath}_files`]);

    } catch (error) {
      console.log(`Threading test failed: ${error.message}`);
      this.results.actualThreading = { error: error.message };
    }
  }

  // Create a test image for conversion testing
  async createTestImage(outputPath) {
    return new Promise((resolve, reject) => {
      // Create a 2048x2048 test image
      const command = `vips black "${outputPath}" 2048 2048 --bands 3`;
      exec(command, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`Failed to create test image: ${error.message}`));
          return;
        }
        resolve();
      });
    });
  }

  // Run VIPS conversion and measure performance
  async runVipsConversion(inputPath, outputPath) {
    return new Promise((resolve, reject) => {
      const command = `vips dzsave "${inputPath}" "${outputPath}" --tile-size 256 --overlap 1`;
      exec(command, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`VIPS conversion failed: ${error.message}`));
          return;
        }
        resolve();
      });
    });
  }

  // Monitor CPU usage during conversion
  startCpuMonitoring() {
    const samples = [];
    let previousCpus = os.cpus();
    
    const interval = setInterval(() => {
      const currentCpus = os.cpus();
      let totalUsage = 0;
      let activeCores = 0;

      currentCpus.forEach((cpu, index) => {
        const prevCpu = previousCpus[index];
        if (!prevCpu) return;
        
        const prevTotal = Object.values(prevCpu.times).reduce((acc, time) => acc + time, 0);
        const prevIdle = prevCpu.times.idle;
        
        const currTotal = Object.values(cpu.times).reduce((acc, time) => acc + time, 0);
        const currIdle = cpu.times.idle;
        
        const totalDiff = currTotal - prevTotal;
        const idleDiff = currIdle - prevIdle;
        
        const usage = totalDiff > 0 ? ((totalDiff - idleDiff) / totalDiff) * 100 : 0;
        
        if (usage > 10) activeCores++; // Core is considered active if >10% usage
        totalUsage += usage;
      });

      samples.push({
        totalUsage: totalUsage / currentCpus.length,
        activeCores: activeCores,
        timestamp: Date.now()
      });
      
      previousCpus = currentCpus;
    }, 500); // Sample every 500ms

    return { interval, samples };
  }

  // Stop CPU monitoring and calculate stats
  async stopCpuMonitoring(monitor) {
    clearInterval(monitor.interval);
    
    if (monitor.samples.length === 0) {
      return { maxUsage: 0, avgUsage: 0, coresUsed: 0 };
    }

    const maxUsage = Math.max(...monitor.samples.map(s => s.totalUsage));
    const avgUsage = monitor.samples.reduce((sum, s) => sum + s.totalUsage, 0) / monitor.samples.length;
    const maxCores = Math.max(...monitor.samples.map(s => s.activeCores));

    return {
      maxUsage: maxUsage,
      avgUsage: avgUsage,
      coresUsed: maxCores
    };
  }

  // Cleanup test files
  cleanup(paths) {
    paths.forEach(filePath => {
      try {
        if (fs.existsSync(filePath)) {
          const stat = fs.statSync(filePath);
          if (stat.isDirectory()) {
            fs.rmSync(filePath, { recursive: true, force: true });
          } else {
            fs.unlinkSync(filePath);
          }
        }
      } catch (error) {
        console.log(`Cleanup warning: ${error.message}`);
      }
    });
  }

  // Generate recommendations
  generateRecommendations() {
    console.log('\n📋 Analysis Results...');

    if (!this.results.actualThreading.isMultithreaded) {
      this.results.recommendations.push({
        priority: 'HIGH',
        issue: 'VIPS is running single-threaded',
        impact: 'Not utilizing multiple CPU cores',
        solution: 'Install VIPS with OpenMP/threading support'
      });
    }

    if (this.results.actualThreading.coresUtilized < this.results.system.cores * 0.25) {
      this.results.recommendations.push({
        priority: 'MEDIUM',
        issue: 'Low CPU core utilization',
        impact: 'Underutilizing available processing power',
        solution: 'Optimize VIPS threading configuration'
      });
    }

    // Display results
    if (this.results.recommendations.length === 0) {
      console.log('✅ No threading issues detected');
    } else {
      this.results.recommendations.forEach((rec, index) => {
        console.log(`\n${index + 1}. [${rec.priority}] ${rec.issue}`);
        console.log(`   Impact: ${rec.impact}`);
        console.log(`   Solution: ${rec.solution}`);
      });
    }
  }

  extractVersion(output) {
    const versionMatch = output.match(/vips-(\d+\.\d+\.\d+)/i);
    return versionMatch ? versionMatch[1] : 'Unknown';
  }

  // Save results
  saveResults() {
    const filename = `multithreading-diagnostic-${Date.now()}.json`;
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

  // Run complete diagnostic
  async runDiagnostic() {
    console.log('🚀 Multithreading Diagnostic for VIPS');
    console.log('Testing actual CPU utilization during conversion\n');
    console.log('=' .repeat(60));

    this.analyzeSystem();
    await this.checkVipsConfig();
    await this.testActualThreading();
    this.generateRecommendations();

    console.log('\n' + '='.repeat(60));
    console.log('🏁 Multithreading Diagnostic Complete');
    
    this.saveResults();

    return this.results;
  }
}

module.exports = MultithreadingDiagnostic;

// Run diagnostic if called directly
if (require.main === module) {
  const diagnostic = new MultithreadingDiagnostic();
  diagnostic.runDiagnostic().catch(console.error);
}
