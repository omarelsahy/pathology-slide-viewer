// Quick test after write cache BIOS fix
const fs = require('fs');
const path = require('path');

console.log('🚀 Testing Write Cache Performance Fix\n');

// Quick IOPS test on slides directory
const testPath = 'C:\\OG';
if (fs.existsSync(testPath)) {
    console.log('Testing C:\\OG performance...');
    
    const start = Date.now();
    for (let i = 0; i < 100; i++) {
        const file = path.join(testPath, `test_${i}.tmp`);
        fs.writeFileSync(file, Buffer.alloc(4096, 1));
        fs.unlinkSync(file);
    }
    const time = Date.now() - start;
    const newIOPS = 100 / (time / 1000);
    
    console.log(`New IOPS: ${newIOPS.toFixed(0)}`);
    console.log(`Previous: 763 IOPS`);
    console.log(`Improvement: ${((newIOPS - 763) / 763 * 100).toFixed(1)}%`);
    
    if (newIOPS > 2000) {
        console.log('🎉 MAJOR IMPROVEMENT! Write cache fix worked!');
    } else {
        console.log('📈 Some improvement, may need additional fixes');
    }
} else {
    console.log('❌ C:\\OG not found');
}

console.log('\n🔍 Checking port 3003 conflict...');
// Check what's using port 3003
require('child_process').exec('netstat -ano | findstr :3003', (err, stdout) => {
    if (stdout) {
        console.log('🚨 Port 3003 is in use:');
        console.log(stdout);
        console.log('\n💡 Solutions:');
        console.log('1. Stop PathologyGui service in Services.msc');
        console.log('2. Or change dev server to port 3004');
    } else {
        console.log('✅ Port 3003 is free');
    }
});
