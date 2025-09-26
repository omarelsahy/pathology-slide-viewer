// Quick script to check VIPS configuration
const os = require('os');

console.log('=== SYSTEM INFO ===');
console.log(`CPU Cores: ${os.cpus().length}`);
console.log(`Total Memory: ${Math.round(os.totalmem() / 1024 / 1024 / 1024)}GB`);

console.log('\n=== ENVIRONMENT VARIABLES ===');
console.log(`VIPS_CONCURRENCY: ${process.env.VIPS_CONCURRENCY || 'Not set'}`);
console.log(`VIPS_CACHE_MAX_MEMORY: ${process.env.VIPS_CACHE_MAX_MEMORY || 'Not set'}`);
console.log(`OMP_NUM_THREADS: ${process.env.OMP_NUM_THREADS || 'Not set'}`);
console.log(`MAGICK_THREAD_LIMIT: ${process.env.MAGICK_THREAD_LIMIT || 'Not set'}`);

console.log('\n=== LOADING CONFIG ===');
try {
    const config = require('./pathology-config.json');
    console.log(`Config VIPS Concurrency: ${config.conversion.vips.concurrency}`);
    console.log(`Config VIPS Cache: ${config.conversion.vips.cacheMemoryGB}GB`);
} catch (error) {
    console.error('Error loading config:', error.message);
}

// Test VIPS command
console.log('\n=== TESTING VIPS COMMAND ===');
const { spawn } = require('child_process');

const vipsTest = spawn('vips', ['--vips-concurrency=56', '--help'], { 
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
        ...process.env,
        VIPS_CONCURRENCY: '56',
        OMP_NUM_THREADS: '56'
    }
});

vipsTest.stdout.on('data', (data) => {
    console.log('VIPS stdout:', data.toString().substring(0, 200) + '...');
});

vipsTest.stderr.on('data', (data) => {
    console.log('VIPS stderr:', data.toString());
});

vipsTest.on('close', (code) => {
    console.log(`VIPS test completed with code: ${code}`);
});
