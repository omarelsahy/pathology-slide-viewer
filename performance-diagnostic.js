// Performance Diagnostic Tool for Pathology Slide Viewer
// Identifies bottlenecks causing slow conversions on lab computer

const os = require('os');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { performance } = require('perf_hooks');

class PerformanceDiagnostic {
  constructor() {
    this.results = {
      timestamp: new Date().toISOString(),
      system: {},
      vips: {},
      storage: {},
      antimalware: {},
      recommendations: []
    };
  }

  // System hardware analysis
  analyzeSystemHardware() {
    console.log('🔍 Analyzing system hardware...');
    
    const cpus = os.cpus();
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const loadAvg = os.loadavg();

    this.results.system = {
      cpuModel: cpus[0].model,
      cpuCores: cpus.length,
      cpuSpeed: cpus[0].speed,
      totalMemoryGB: (totalMemory / 1024 / 1024 / 1024).toFixed(2),
      freeMemoryGB: (freeMemory / 1024 / 1024 / 1024).toFixed(2),
      memoryUsagePercent: ((totalMemory - freeMemory) / totalMemory * 100).toFixed(1),
      loadAverage: loadAvg,
      platform: os.platform(),
      arch: os.arch(),
      uptime: os.uptime()
    };

    console.log(`  CPU: ${this.results.system.cpuModel}`);
    console.log(`  Cores: ${this.results.system.cpuCores} @ ${this.results.system.cpuSpeed} MHz`);
    console.log(`  Memory: ${this.results.system.freeMemoryGB}GB free / ${this.results.system.totalMemoryGB}GB total`);
    console.log(`  Load: ${loadAvg[0].toFixed(2)} (1min), ${loadAvg[1].toFixed(2)} (5min), ${loadAvg[2].toFixed(2)} (15min)`);
  }

  // VIPS configuration and capabilities analysis
  async analyzeVipsConfiguration() {
    console.log('\n🔍 Analyzing VIPS configuration...');
    
    return new Promise((resolve) => {
      exec('vips --version && vips --vips-config', (error, stdout, stderr) => {
        if (error) {
          this.results.vips = { error: 'VIPS not found or not accessible', details: error.message };
          console.log('  ❌ VIPS not found or not accessible');
          resolve();
          return;
        }

        const output = stdout.toLowerCase();
        this.results.vips = {
          version: this.extractVersion(stdout),
          threading: output.includes('g_thread') ? 'Available' : 'Not Available',
          openmp: output.includes('openmp') ? 'Available' : 'Not Available',
          opencl: output.includes('opencl') && output.includes('yes') ? 'Available' : 'Not Available',
          cuda: output.includes('cuda') && output.includes('yes') ? 'Available' : 'Not Available',
          simd: output.includes('vector') || output.includes('simd') ? 'Available' : 'Not Available',
          fullConfig: stdout
        };

        console.log(`  Version: ${this.results.vips.version}`);
        console.log(`  Threading: ${this.results.vips.threading}`);
        console.log(`  OpenMP: ${this.results.vips.openmp}`);
        console.log(`  OpenCL: ${this.results.vips.opencl}`);
        console.log(`  CUDA: ${this.results.vips.cuda}`);
        console.log(`  SIMD: ${this.results.vips.simd}`);

        resolve();
      });
    });
  }

  // Storage performance analysis
  async analyzeStoragePerformance() {
    console.log('\n🔍 Analyzing storage performance...');
    
    const testFile = path.join(__dirname, 'temp_perf_test.dat');
    const testSize = 100 * 1024 * 1024; // 100MB test file
    
    try {
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

      this.results.storage = {
        writeSpeedMBps: writeMBps.toFixed(1),
        readSpeedMBps: readMBps.toFixed(1),
        writeTimeMs: writeTime.toFixed(1),
        readTimeMs: readTime.toFixed(1)
      };

      console.log(`  Write Speed: ${writeMBps.toFixed(1)} MB/s`);
      console.log(`  Read Speed: ${readMBps.toFixed(1)} MB/s`);

    } catch (error) {
      this.results.storage = { error: 'Storage test failed', details: error.message };
      console.log('  ❌ Storage performance test failed');
    }
  }

  // Windows Defender and antimalware analysis
  async analyzeAntiMalware() {
    console.log('\n🔍 Analyzing Windows Defender status...');
    
    return new Promise((resolve) => {
      // Check Windows Defender real-time protection status
      exec('powershell "Get-MpPreference | Select-Object DisableRealtimeMonitoring, ExclusionPath, ExclusionProcess"', (error, stdout, stderr) => {
        if (error) {
          this.results.antimalware = { error: 'Could not check Windows Defender status', details: error.message };
          console.log('  ❌ Could not check Windows Defender status');
          resolve();
          return;
        }

        const realtimeDisabled = stdout.includes('DisableRealtimeMonitoring : True');
        const hasExclusions = stdout.includes('ExclusionPath') && stdout.length > 100;

        this.results.antimalware = {
          realtimeProtection: realtimeDisabled ? 'Disabled' : 'Enabled',
          exclusionsConfigured: hasExclusions ? 'Yes' : 'No',
          fullOutput: stdout
        };

        console.log(`  Real-time Protection: ${this.results.antimalware.realtimeProtection}`);
        console.log(`  Exclusions Configured: ${this.results.antimalware.exclusionsConfigured}`);

        resolve();
      });
    });
  }

  // Process analysis during conversion
  async analyzeRunningProcesses() {
    console.log('\n🔍 Analyzing running processes...');
    
    return new Promise((resolve) => {
      exec('powershell "Get-Process | Where-Object {$_.CPU -gt 1} | Sort-Object CPU -Descending | Select-Object -First 10 ProcessName, CPU, WorkingSet"', (error, stdout, stderr) => {
        if (error) {
          this.results.processes = { error: 'Could not analyze processes', details: error.message };
          resolve();
          return;
        }

        this.results.processes = {
          topProcesses: stdout,
          antiMalwareRunning: stdout.toLowerCase().includes('antimalware') || stdout.toLowerCase().includes('msmpeng')
        };

        console.log('  Top CPU processes:');
        console.log(stdout);
        
        if (this.results.processes.antiMalwareRunning) {
          console.log('  ⚠️  Antimalware Service Executable detected in top processes');
        }

        resolve();
      });
    });
  }

  // Generate recommendations based on findings
  generateRecommendations() {
    console.log('\n📋 Generating recommendations...');

    // Memory recommendations
    const memoryUsage = parseFloat(this.results.system.memoryUsagePercent);
    if (memoryUsage > 80) {
      this.results.recommendations.push({
        priority: 'HIGH',
        category: 'Memory',
        issue: `High memory usage: ${memoryUsage}%`,
        solution: 'Close unnecessary applications or increase system RAM'
      });
    }

    // CPU load recommendations
    const load = this.results.system.loadAverage[0];
    const cores = this.results.system.cpuCores;
    if (load > cores * 0.8) {
      this.results.recommendations.push({
        priority: 'HIGH',
        category: 'CPU',
        issue: `High CPU load: ${load.toFixed(2)} (${cores} cores)`,
        solution: 'Reduce concurrent processes or adjust VIPS thread count'
      });
    }

    // VIPS optimization recommendations
    if (this.results.vips.opencl === 'Not Available' && this.results.vips.cuda === 'Not Available') {
      this.results.recommendations.push({
        priority: 'MEDIUM',
        category: 'VIPS',
        issue: 'No GPU acceleration available',
        solution: 'Install VIPS with OpenCL/CUDA support or use CPU optimizations'
      });
    }

    if (this.results.vips.threading === 'Not Available') {
      this.results.recommendations.push({
        priority: 'HIGH',
        category: 'VIPS',
        issue: 'Threading not available in VIPS',
        solution: 'Reinstall VIPS with threading support (libvips with GLib)'
      });
    }

    // Storage recommendations
    if (this.results.storage.writeSpeedMBps && parseFloat(this.results.storage.writeSpeedMBps) < 100) {
      this.results.recommendations.push({
        priority: 'MEDIUM',
        category: 'Storage',
        issue: `Slow write speed: ${this.results.storage.writeSpeedMBps} MB/s`,
        solution: 'Consider using SSD storage or check disk health'
      });
    }

    // Antimalware recommendations
    if (this.results.antimalware.realtimeProtection === 'Enabled' && this.results.antimalware.exclusionsConfigured === 'No') {
      this.results.recommendations.push({
        priority: 'HIGH',
        category: 'Antimalware',
        issue: 'Windows Defender real-time protection enabled without exclusions',
        solution: 'Run defender-exclusions.ps1 script as Administrator'
      });
    }

    if (this.results.processes && this.results.processes.antiMalwareRunning) {
      this.results.recommendations.push({
        priority: 'HIGH',
        category: 'Antimalware',
        issue: 'Antimalware Service Executable consuming CPU during analysis',
        solution: 'Configure Windows Defender exclusions for slide processing directories'
      });
    }

    // Display recommendations
    this.results.recommendations.forEach((rec, index) => {
      console.log(`\n${index + 1}. [${rec.priority}] ${rec.category}: ${rec.issue}`);
      console.log(`   Solution: ${rec.solution}`);
    });
  }

  // Save results to file
  saveResults() {
    const filename = `performance-diagnostic-${Date.now()}.json`;
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

  // Extract version from VIPS output
  extractVersion(output) {
    const versionMatch = output.match(/vips-(\d+\.\d+\.\d+)/i);
    return versionMatch ? versionMatch[1] : 'Unknown';
  }

  // Run complete diagnostic
  async runDiagnostic() {
    console.log('🚀 Starting Performance Diagnostic for Pathology Slide Viewer\n');
    console.log('=' .repeat(60));

    this.analyzeSystemHardware();
    await this.analyzeVipsConfiguration();
    await this.analyzeStoragePerformance();
    await this.analyzeAntiMalware();
    await this.analyzeRunningProcesses();
    this.generateRecommendations();

    console.log('\n' + '='.repeat(60));
    console.log('🏁 Diagnostic Complete');
    
    const savedFile = this.saveResults();
    
    if (this.results.recommendations.length === 0) {
      console.log('\n✅ No major performance issues detected!');
    } else {
      console.log(`\n⚠️  Found ${this.results.recommendations.length} potential performance issues.`);
      console.log('Review the recommendations above to optimize conversion speed.');
    }

    return this.results;
  }
}

// Export for use in other modules
module.exports = PerformanceDiagnostic;

// Run diagnostic if called directly
if (require.main === module) {
  const diagnostic = new PerformanceDiagnostic();
  diagnostic.runDiagnostic().catch(console.error);
}
