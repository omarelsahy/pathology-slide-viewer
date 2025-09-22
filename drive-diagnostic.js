// Drive Performance Diagnostic
// Run this to check if your drives are SSD or HDD

const fs = require('fs');
const path = require('path');
const os = require('os');

async function testDrivePerformance(testPath, testName) {
  console.log(`\n=== Testing ${testName}: ${testPath} ===`);
  
  try {
    // Ensure directory exists
    if (!fs.existsSync(testPath)) {
      fs.mkdirSync(testPath, { recursive: true });
    }
    
    const testFile = path.join(testPath, 'speed_test.tmp');
    const testSize = 100 * 1024 * 1024; // 100MB test file
    const testData = Buffer.alloc(testSize, 1);
    
    // Test write speed
    console.log(`Writing ${testSize / 1024 / 1024}MB test file...`);
    const writeStart = Date.now();
    fs.writeFileSync(testFile, testData);
    const writeTime = Date.now() - writeStart;
    const writeMBps = (testSize / 1024 / 1024) / (writeTime / 1000);
    
    // Test read speed
    console.log(`Reading ${testSize / 1024 / 1024}MB test file...`);
    const readStart = Date.now();
    fs.readFileSync(testFile);
    const readTime = Date.now() - readStart;
    const readMBps = (testSize / 1024 / 1024) / (readTime / 1000);
    
    // Test small file operations (like DZI tiles)
    console.log('Testing small file operations (like DZI tiles)...');
    const smallFileDir = path.join(testPath, 'small_files_test');
    if (!fs.existsSync(smallFileDir)) {
      fs.mkdirSync(smallFileDir);
    }
    
    const smallFileCount = 1000;
    const smallFileData = Buffer.alloc(4096, 1); // 4KB files
    
    const smallWriteStart = Date.now();
    for (let i = 0; i < smallFileCount; i++) {
      fs.writeFileSync(path.join(smallFileDir, `tile_${i}.jpg`), smallFileData);
    }
    const smallWriteTime = Date.now() - smallWriteStart;
    const iops = smallFileCount / (smallWriteTime / 1000);
    
    // Cleanup
    fs.rmSync(smallFileDir, { recursive: true, force: true });
    fs.unlinkSync(testFile);
    
    console.log(`📊 Results for ${testName}:`);
    console.log(`   Write Speed: ${writeMBps.toFixed(1)} MB/s`);
    console.log(`   Read Speed: ${readMBps.toFixed(1)} MB/s`);
    console.log(`   Small File IOPS: ${iops.toFixed(0)} operations/sec`);
    
    // Determine drive type based on performance
    let driveType = 'Unknown';
    if (writeMBps < 100 && iops < 500) {
      driveType = '🐌 HDD (5400 RPM)';
    } else if (writeMBps < 200 && iops < 1000) {
      driveType = '🐌 HDD (7200 RPM)';
    } else if (writeMBps < 600 && iops < 50000) {
      driveType = '⚡ SATA SSD';
    } else if (writeMBps > 1000 && iops > 100000) {
      driveType = '🚀 NVMe SSD';
    } else {
      driveType = '⚡ SSD (type unclear)';
    }
    
    console.log(`   Drive Type: ${driveType}`);
    
    return { writeMBps, readMBps, iops, driveType };
    
  } catch (error) {
    console.error(`❌ Error testing ${testName}:`, error.message);
    return null;
  }
}

async function runDiagnostic() {
  console.log('🔍 Drive Performance Diagnostic');
  console.log('This will test the speed of your drives to identify bottlenecks\n');
  
  // Test all your configured paths
  const tests = [
    { path: 'C:\\OG', name: 'Slides Directory' },
    { path: 'C:\\dzi', name: 'DZI Output Directory' },
    { path: 'C:\\temp', name: 'Temp Directory' },
    { path: os.tmpdir(), name: 'System Temp Directory' }
  ];
  
  const results = [];
  
  for (const test of tests) {
    const result = await testDrivePerformance(test.path, test.name);
    if (result) {
      results.push({ ...test, ...result });
    }
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('📋 SUMMARY & RECOMMENDATIONS');
  console.log('='.repeat(60));
  
  results.forEach(result => {
    console.log(`${result.name}: ${result.driveType}`);
    if (result.writeMBps < 200 || result.iops < 10000) {
      console.log(`   ⚠️  BOTTLENECK: This drive is too slow for pathology slides!`);
      console.log(`   💡 Recommendation: Move to SSD/NVMe for major performance gain`);
    }
  });
  
  console.log('\n🎯 Performance Expectations:');
  console.log('   HDD (5400 RPM): 20+ minutes per slide (what you\'re seeing)');
  console.log('   SATA SSD: 2-5 minutes per slide');
  console.log('   NVMe SSD: 30-60 seconds per slide');
}

// Run the diagnostic
runDiagnostic().catch(console.error);
