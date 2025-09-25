// Diagnose ICC Transform Performance Issues
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

console.log('🔍 Diagnosing ICC Transform Performance Issues\n');

// Test 1: Verify E: drive is actually being used
function checkTempFiles() {
    console.log('📁 Checking temp file locations:');
    
    const eTempDir = 'E:\\temp';
    const cTempDir = require('os').tmpdir();
    
    console.log(`E: temp dir: ${eTempDir}`);
    console.log(`C: temp dir: ${cTempDir}`);
    
    if (fs.existsSync(eTempDir)) {
        const eFiles = fs.readdirSync(eTempDir).filter(f => f.includes('icc_temp'));
        console.log(`E: temp ICC files: ${eFiles.length} files`);
        eFiles.forEach(f => console.log(`  - ${f}`));
    }
    
    if (fs.existsSync(cTempDir)) {
        const cFiles = fs.readdirSync(cTempDir).filter(f => f.includes('icc_temp'));
        console.log(`C: temp ICC files: ${cFiles.length} files`);
        cFiles.forEach(f => console.log(`  - ${f}`));
    }
}

// Test 2: Compare actual I/O performance between drives
async function compareIOPerformance() {
    console.log('\n⚡ Comparing I/O Performance:');
    
    const testSize = 100 * 1024 * 1024; // 100MB test file
    const testData = Buffer.alloc(testSize, 1);
    
    // Test C: drive
    const cTestPath = path.join(require('os').tmpdir(), 'icc_perf_test.tmp');
    const cStart = Date.now();
    fs.writeFileSync(cTestPath, testData);
    const cWrite = Date.now() - cStart;
    
    const cReadStart = Date.now();
    fs.readFileSync(cTestPath);
    const cRead = Date.now() - cReadStart;
    
    fs.unlinkSync(cTestPath);
    
    // Test E: drive
    const eTestPath = 'E:\\temp\\icc_perf_test.tmp';
    const eStart = Date.now();
    fs.writeFileSync(eTestPath, testData);
    const eWrite = Date.now() - eStart;
    
    const eReadStart = Date.now();
    fs.readFileSync(eTestPath);
    const eRead = Date.now() - eReadStart;
    
    fs.unlinkSync(eTestPath);
    
    console.log(`C: drive - Write: ${cWrite}ms, Read: ${cRead}ms`);
    console.log(`E: drive - Write: ${eWrite}ms, Read: ${eRead}ms`);
    console.log(`E: drive improvement - Write: ${((cWrite-eWrite)/cWrite*100).toFixed(1)}%, Read: ${((cRead-eRead)/cRead*100).toFixed(1)}%`);
}

// Test 3: Check VIPS ICC transform bottlenecks
function analyzeVipsBottlenecks() {
    console.log('\n🔬 Analyzing VIPS ICC Transform Bottlenecks:');
    
    console.log('Potential bottlenecks:');
    console.log('1. CPU-bound ICC color space conversion (not I/O limited)');
    console.log('2. Memory bandwidth limitations');
    console.log('3. VIPS concurrency settings');
    console.log('4. Large file size causing memory pressure');
    console.log('5. ICC profile complexity');
    console.log('6. Sequential access vs random access patterns');
}

// Test 4: Check current VIPS configuration
async function checkVipsConfig() {
    console.log('\n⚙️ Current VIPS Configuration:');
    
    try {
        const config = JSON.parse(fs.readFileSync('./pathology-config.json', 'utf8'));
        const vips = config.conversion?.vips || {};
        
        console.log(`Concurrency: ${vips.concurrency || 'default'}`);
        console.log(`Cache Memory: ${vips.cacheMemoryGB || 'default'} GB`);
        console.log(`Quality: ${vips.quality || 'default'}`);
        console.log(`Compression: ${vips.compression || 'default'}`);
        
        // Check system resources
        const os = require('os');
        console.log(`\nSystem Resources:`);
        console.log(`CPU Cores: ${os.cpus().length}`);
        console.log(`Total RAM: ${(os.totalmem() / (1024**3)).toFixed(1)} GB`);
        console.log(`Free RAM: ${(os.freemem() / (1024**3)).toFixed(1)} GB`);
        
    } catch (error) {
        console.log('❌ Could not read VIPS config:', error.message);
    }
}

// Test 5: Suggest optimizations
function suggestOptimizations() {
    console.log('\n💡 Potential ICC Transform Optimizations:');
    
    console.log('1. REDUCE CONCURRENCY: High concurrency can cause memory thrashing');
    console.log('   - Try concurrency=8 instead of 32 for large files');
    console.log('   - Memory bandwidth may be the bottleneck, not CPU');
    
    console.log('2. SKIP ICC TRANSFORM: If color accuracy is not critical');
    console.log('   - Use --no-icc flag to bypass ICC transform entirely');
    console.log('   - Can reduce conversion time by 50-80%');
    
    console.log('3. OPTIMIZE VIPS CACHE: Reduce memory pressure');
    console.log('   - Lower cache memory to prevent swapping');
    console.log('   - Use strip-based processing for large files');
    
    console.log('4. USE DIFFERENT ICC PROFILES: Simpler profiles are faster');
    console.log('   - Skip embedded profile, use simple sRGB');
    console.log('   - Avoid complex LAB color space conversions');
    
    console.log('5. PROCESS IN CHUNKS: For very large slides');
    console.log('   - Process regions instead of entire slide');
    console.log('   - Reduces peak memory usage');
}

async function runDiagnosis() {
    checkTempFiles();
    await compareIOPerformance();
    analyzeVipsBottlenecks();
    await checkVipsConfig();
    suggestOptimizations();
    
    console.log('\n🎯 Key Insight: ICC transforms are often CPU/memory bound, not I/O bound!');
    console.log('The E: drive helps with temp file I/O, but the main bottleneck is likely:');
    console.log('- Color space conversion calculations (CPU intensive)');
    console.log('- Memory bandwidth limitations with high concurrency');
    console.log('- Large file sizes causing memory pressure');
}

runDiagnosis().catch(console.error);
