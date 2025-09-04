// VIPS Upgrade Verification Script
// Compares performance before and after MSYS2 VIPS installation

const { runVipsThreadingDiagnostic } = require('./test-vips-threading');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

// Store baseline results for comparison
const BASELINE_FILE = 'vips-performance-baseline.json';

async function saveBaseline() {
    console.log('\n=== SAVING PERFORMANCE BASELINE ===');
    
    const baseline = {
        timestamp: new Date().toISOString(),
        singleThreadTime: await runTimedTest(1),
        multiThreadTime: await runTimedTest(8),
        vipsVersion: await getVipsVersion(),
        vipsConfig: await getVipsConfig()
    };
    
    baseline.improvement = ((baseline.singleThreadTime - baseline.multiThreadTime) / baseline.singleThreadTime * 100).toFixed(1);
    
    fs.writeFileSync(BASELINE_FILE, JSON.stringify(baseline, null, 2));
    console.log('✅ Baseline saved to', BASELINE_FILE);
    console.log(`Baseline performance: ${baseline.improvement}% improvement with threading`);
    
    return baseline;
}

async function compareWithBaseline() {
    console.log('\n=== COMPARING WITH BASELINE ===');
    
    if (!fs.existsSync(BASELINE_FILE)) {
        console.log('❌ No baseline file found. Run with --save-baseline first');
        return null;
    }
    
    const baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));
    
    const current = {
        timestamp: new Date().toISOString(),
        singleThreadTime: await runTimedTest(1),
        multiThreadTime: await runTimedTest(8),
        vipsVersion: await getVipsVersion(),
        vipsConfig: await getVipsConfig()
    };
    
    current.improvement = ((current.singleThreadTime - current.multiThreadTime) / current.singleThreadTime * 100).toFixed(1);
    
    console.log('\n=== PERFORMANCE COMPARISON ===');
    console.log('BASELINE (Old VIPS):');
    console.log(`  Version: ${baseline.vipsVersion}`);
    console.log(`  Single thread: ${baseline.singleThreadTime}ms`);
    console.log(`  Multi thread: ${baseline.multiThreadTime}ms`);
    console.log(`  Improvement: ${baseline.improvement}%`);
    
    console.log('\nCURRENT (New VIPS):');
    console.log(`  Version: ${current.vipsVersion}`);
    console.log(`  Single thread: ${current.singleThreadTime}ms`);
    console.log(`  Multi thread: ${current.multiThreadTime}ms`);
    console.log(`  Improvement: ${current.improvement}%`);
    
    console.log('\n=== UPGRADE IMPACT ===');
    const singleThreadGain = ((baseline.singleThreadTime - current.singleThreadTime) / baseline.singleThreadTime * 100).toFixed(1);
    const multiThreadGain = ((baseline.multiThreadTime - current.multiThreadTime) / baseline.multiThreadTime * 100).toFixed(1);
    const improvementGain = (parseFloat(current.improvement) - parseFloat(baseline.improvement)).toFixed(1);
    
    console.log(`Single-thread performance: ${singleThreadGain}% ${singleThreadGain > 0 ? 'faster' : 'slower'}`);
    console.log(`Multi-thread performance: ${multiThreadGain}% ${multiThreadGain > 0 ? 'faster' : 'slower'}`);
    console.log(`Threading effectiveness: ${improvementGain}% ${improvementGain > 0 ? 'better' : 'worse'}`);
    
    if (parseFloat(multiThreadGain) > 30) {
        console.log('🎉 EXCELLENT UPGRADE! Significant performance improvement detected');
    } else if (parseFloat(multiThreadGain) > 10) {
        console.log('✅ Good upgrade - noticeable performance improvement');
    } else if (parseFloat(multiThreadGain) > 0) {
        console.log('✅ Minor improvement - upgrade successful');
    } else {
        console.log('⚠️ No improvement detected - may need to check installation');
    }
    
    return { baseline, current };
}

async function runTimedTest(threadCount) {
    return new Promise((resolve) => {
        const env = {
            ...process.env,
            VIPS_CONCURRENCY: threadCount.toString(),
            VIPS_NTHR: threadCount.toString()
        };
        
        // Use a larger test for more accurate timing
        const command = `vips black temp_perf_test.tiff 3000 3000 --bands 3 && vips dzsave temp_perf_test.tiff temp_perf_test_dz --tile-size 256 --overlap 1 && del temp_perf_test.tiff && rmdir /s /q temp_perf_test_dz_files && del temp_perf_test_dz.dzi`;
        
        const startTime = Date.now();
        exec(command, { env }, (error, stdout, stderr) => {
            const duration = Date.now() - startTime;
            if (error) {
                console.log(`Error with ${threadCount} threads:`, error.message);
                resolve(999999);
            } else {
                resolve(duration);
            }
        });
    });
}

async function getVipsVersion() {
    return new Promise((resolve) => {
        exec('vips --version', (error, stdout, stderr) => {
            if (error) {
                resolve('unknown');
            } else {
                resolve(stdout.trim());
            }
        });
    });
}

async function getVipsConfig() {
    return new Promise((resolve) => {
        exec('vips --vips-config', (error, stdout, stderr) => {
            if (error) {
                resolve('unknown');
            } else {
                resolve(stdout.trim());
            }
        });
    });
}

async function runFullVerification() {
    console.log('\n=== VIPS UPGRADE VERIFICATION ===');
    console.log('Testing new VIPS installation performance');
    console.log('=====================================');
    
    // Run the full threading diagnostic
    await runVipsThreadingDiagnostic();
    
    // Compare with baseline if available
    await compareWithBaseline();
    
    console.log('\n=== VERIFICATION COMPLETE ===');
}

// Command line interface
if (require.main === module) {
    const args = process.argv.slice(2);
    
    if (args.includes('--save-baseline')) {
        saveBaseline().catch(console.error);
    } else if (args.includes('--compare')) {
        compareWithBaseline().catch(console.error);
    } else {
        runFullVerification().catch(console.error);
    }
}

module.exports = { saveBaseline, compareWithBaseline, runFullVerification };
