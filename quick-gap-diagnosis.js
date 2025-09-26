// Quick diagnosis of E: drive usage and tile gaps
const fs = require('fs');

console.log('🔍 Quick Diagnosis: E: Drive & Tile Gaps\n');

// 1. Check if E: drive is actually different from C:
console.log('💾 Drive Analysis:');
try {
    const cStats = fs.statSync('C:\\');
    const eStats = fs.statSync('E:\\');
    console.log('C: drive exists:', fs.existsSync('C:\\'));
    console.log('E: drive exists:', fs.existsSync('E:\\'));
    
    // Simple test: Create files on both drives and compare performance
    const testData = Buffer.alloc(50 * 1024 * 1024, 1); // 50MB
    
    const cStart = Date.now();
    fs.writeFileSync('C:\\temp_test.tmp', testData);
    const cTime = Date.now() - cStart;
    fs.unlinkSync('C:\\temp_test.tmp');
    
    const eStart = Date.now();
    fs.writeFileSync('E:\\temp_test.tmp', testData);
    const eTime = Date.now() - eStart;
    fs.unlinkSync('E:\\temp_test.tmp');
    
    console.log(`C: drive write: ${cTime}ms`);
    console.log(`E: drive write: ${eTime}ms`);
    console.log(`Performance difference: ${((cTime-eTime)/cTime*100).toFixed(1)}%`);
    
    if (Math.abs(cTime - eTime) < 50) {
        console.log('⚠️  SAME PERFORMANCE: E: and C: may be the same physical drive!');
    }
    
} catch (error) {
    console.log('❌ Drive test failed:', error.message);
}

// 2. Check current config
console.log('\n⚙️ Current Configuration:');
try {
    const config = JSON.parse(fs.readFileSync('./pathology-config.json', 'utf8'));
    console.log('Temp directory:', config.storage?.tempDir);
    console.log('VIPS concurrency:', config.conversion?.vips?.concurrency);
    console.log('DZI overlap:', config.conversion?.dzi?.overlap);
    console.log('Cache memory:', config.conversion?.vips?.cacheMemoryGB, 'GB');
} catch (error) {
    console.log('❌ Config read failed');
}

// 3. Check for recent temp files
console.log('\n📁 Recent Temp File Activity:');
const tempDirs = ['E:\\temp', 'C:\\Users\\aperio\\AppData\\Local\\Temp\\1'];
tempDirs.forEach(dir => {
    if (fs.existsSync(dir)) {
        try {
            const files = fs.readdirSync(dir)
                .filter(f => f.includes('icc_temp') || f.includes('vips'))
                .slice(0, 5);
            console.log(`${dir}: ${files.length} temp files`);
            files.forEach(f => console.log(`  - ${f}`));
        } catch (error) {
            console.log(`${dir}: Access denied`);
        }
    }
});

console.log('\n💡 Key Changes Made:');
console.log('✅ Increased DZI overlap from 1 to 3 pixels (fixes gaps)');
console.log('✅ Reduced VIPS concurrency from 32 to 8 (prevents memory issues)');
console.log('✅ Reduced cache memory from 64GB to 32GB (less memory pressure)');

console.log('\n🎯 Expected Results:');
console.log('- No more horizontal gaps in tiles');
console.log('- More stable processing with lower concurrency');
console.log('- Better memory management');
console.log('- E: drive temp files (if drives are actually different)');

console.log('\n⚠️  If E: and C: drives show same performance:');
console.log('- They may be the same physical drive or in RAID');
console.log('- The "E: drive optimization" won\'t help performance');
console.log('- Focus on VIPS settings optimization instead');
