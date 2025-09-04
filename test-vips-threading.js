// VIPS Threading Diagnostic Tool
// Tests whether VIPS is actually using multithreading

const VipsConfig = require('./vips-config');
const { exec } = require('child_process');
const os = require('os');

async function runVipsThreadingDiagnostic() {
    console.log('\n=== VIPS THREADING DIAGNOSTIC ===');
    console.log(`System: ${os.cpus().length} cores, ${(os.totalmem() / 1024 / 1024 / 1024).toFixed(1)} GB RAM`);
    console.log('==================================\n');

    const vipsConfig = new VipsConfig();
    
    // Step 1: Check VIPS configuration
    console.log('1. Checking VIPS configuration...');
    try {
        const threadingSupport = await vipsConfig.checkThreadingSupport();
        console.log('Threading Support:', threadingSupport);
        
        if (!threadingSupport.configured) {
            console.log('❌ VIPS does not appear to have threading support compiled in');
            console.log('Raw VIPS config output:');
            console.log(threadingSupport.rawConfig);
        } else {
            console.log('✅ VIPS has threading libraries:', threadingSupport.libraries.join(', '));
        }
    } catch (error) {
        console.log('❌ Error checking VIPS config:', error.message);
    }

    // Step 2: Test environment variables
    console.log('\n2. Testing VIPS environment variables...');
    const envVars = vipsConfig.getEnvironmentVars();
    console.log('Environment variables being set:');
    Object.entries(envVars).forEach(([key, value]) => {
        console.log(`  ${key}=${value}`);
    });

    // Step 3: Run actual threading test
    console.log('\n3. Running threading performance test...');
    try {
        const testResult = await vipsConfig.testActualThreadUsage();
        console.log('Test Result:', testResult);
        
        if (testResult.success) {
            console.log(`✅ Test completed in ${testResult.duration}ms`);
        } else {
            console.log(`❌ Test failed: ${testResult.error}`);
        }
    } catch (error) {
        console.log('❌ Error running test:', error.message);
    }

    // Step 4: Compare single vs multi-threaded performance
    console.log('\n4. Comparing single vs multi-threaded performance...');
    
    // Test with 1 thread
    console.log('Testing with 1 thread...');
    const singleThreadTime = await runTimedVipsCommand(1);
    
    // Test with configured threads
    console.log(`Testing with ${vipsConfig.optimalThreads} threads...`);
    const multiThreadTime = await runTimedVipsCommand(vipsConfig.optimalThreads);
    
    console.log('\n=== PERFORMANCE COMPARISON ===');
    console.log(`Single thread (1): ${singleThreadTime}ms`);
    console.log(`Multi thread (${vipsConfig.optimalThreads}): ${multiThreadTime}ms`);
    
    if (multiThreadTime < singleThreadTime) {
        const improvement = ((singleThreadTime - multiThreadTime) / singleThreadTime * 100).toFixed(1);
        console.log(`✅ Multithreading is working! ${improvement}% faster`);
    } else {
        console.log('❌ Multithreading may not be working - no performance improvement detected');
    }
    
    console.log('\n=== DIAGNOSTIC COMPLETE ===\n');
}

async function runTimedVipsCommand(threadCount) {
    return new Promise((resolve) => {
        const env = {
            ...process.env,
            VIPS_CONCURRENCY: threadCount.toString(),
            VIPS_NTHR: threadCount.toString()
        };
        
        // Create a moderately complex operation that should benefit from threading
        const command = `vips black temp_test.tiff 2000 2000 --bands 3 && vips dzsave temp_test.tiff temp_test_dz --tile-size 256 --overlap 1 && del temp_test.tiff && rmdir /s /q temp_test_dz_files && del temp_test_dz.dzi`;
        
        const startTime = Date.now();
        exec(command, { env }, (error, stdout, stderr) => {
            const duration = Date.now() - startTime;
            if (error) {
                console.log(`Error with ${threadCount} threads:`, error.message);
                resolve(999999); // Return high value for failed tests
            } else {
                resolve(duration);
            }
        });
    });
}

// Run the diagnostic
if (require.main === module) {
    runVipsThreadingDiagnostic().catch(console.error);
}

module.exports = { runVipsThreadingDiagnostic };
