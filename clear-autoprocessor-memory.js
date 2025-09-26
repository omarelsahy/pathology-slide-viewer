// Clear Autoprocessor Memory to Force Reprocessing
const fs = require('fs');
const path = require('path');

console.log('🧠 Clearing Autoprocessor Memory\n');

// The autoprocessor memory is in-memory only, so we need to restart the server
// But we can check what files it would skip and provide workarounds

function analyzeSkippedFiles() {
    console.log('📁 Analyzing why files might be skipped:\n');
    
    const slidesDir = 'E:\\OG';
    const dziDir = 'E:\\dzi';
    
    if (!fs.existsSync(slidesDir)) {
        console.log('❌ Slides directory not found:', slidesDir);
        return;
    }
    
    const slideFiles = fs.readdirSync(slidesDir, { recursive: true })
        .filter(file => {
            const ext = path.extname(file).toLowerCase();
            return ['.svs', '.ndpi', '.tif', '.tiff', '.jp2', '.vms', '.vmu', '.scn'].includes(ext);
        });
    
    console.log(`Found ${slideFiles.length} slide files in ${slidesDir}`);
    
    slideFiles.forEach(file => {
        const filePath = path.join(slidesDir, file);
        const baseName = path.basename(file, path.extname(file));
        const dziPath = path.join(dziDir, `${baseName}.dzi`);
        
        const stats = fs.statSync(filePath);
        const fileAge = Date.now() - stats.mtime.getTime();
        const hasExistingDzi = fs.existsSync(dziPath);
        
        console.log(`\n📄 ${file}:`);
        console.log(`   File age: ${Math.round(fileAge/1000)}s`);
        console.log(`   Has DZI: ${hasExistingDzi ? '✅ YES (will be skipped)' : '❌ NO'}`);
        console.log(`   Too recent: ${fileAge < 5000 ? '⚠️ YES (< 5s)' : '✅ NO'}`);
        
        if (hasExistingDzi) {
            console.log(`   🔄 To reprocess: Delete ${dziPath}`);
        }
    });
}

function provideSolutions() {
    console.log('\n💡 Solutions to Force Autoprocessing:\n');
    
    console.log('1. **RESTART THE SERVER** (clears in-memory processedFiles set)');
    console.log('   - Stop the backend server');
    console.log('   - Start it again');
    console.log('   - Memory will be cleared');
    
    console.log('\n2. **DELETE EXISTING DZI FILES** (if you want to reconvert)');
    console.log('   - Delete the .dzi file and _files folder');
    console.log('   - Autoprocessor will detect the slide as "new"');
    
    console.log('\n3. **TOUCH THE FILE** (update modification time)');
    console.log('   - Copy the file to a temp location');
    console.log('   - Delete the original');
    console.log('   - Copy it back (gets new timestamp)');
    
    console.log('\n4. **USE MANUAL CONVERSION** (bypass autoprocessor)');
    console.log('   - Use the GUI "Convert" button');
    console.log('   - Or use the /api/touch-file endpoint');
    
    console.log('\n5. **WAIT FOR FILE STABILITY** (if file is too recent)');
    console.log('   - Files modified < 5 seconds ago are skipped');
    console.log('   - Wait a few seconds and it should auto-process');
}

function checkCurrentMemoryState() {
    console.log('\n🔍 Current Memory State Check:\n');
    
    // Check if there are any .cancelled files (another form of memory)
    const slidesDir = 'E:\\OG';
    if (fs.existsSync(slidesDir)) {
        const cancelledFiles = fs.readdirSync(slidesDir)
            .filter(file => file.startsWith('.') && file.includes('.cancelled'));
        
        if (cancelledFiles.length > 0) {
            console.log('⚠️ Found cancellation flag files:');
            cancelledFiles.forEach(file => {
                console.log(`   - ${file}`);
                console.log(`     🔄 Delete this to allow reprocessing`);
            });
        } else {
            console.log('✅ No cancellation flag files found');
        }
    }
    
    // Check for temp files that might indicate stuck processing
    const tempDir = 'E:\\temp';
    if (fs.existsSync(tempDir)) {
        const tempFiles = fs.readdirSync(tempDir)
            .filter(file => file.includes('icc_temp') || file.includes('vips'));
        
        if (tempFiles.length > 0) {
            console.log('\n⚠️ Found temp files (may indicate stuck processing):');
            tempFiles.forEach(file => {
                console.log(`   - ${file}`);
            });
            console.log('   🔄 Consider deleting these if processing is stuck');
        } else {
            console.log('✅ No stuck temp files found');
        }
    }
}

// Run analysis
analyzeSkippedFiles();
provideSolutions();
checkCurrentMemoryState();

console.log('\n🎯 Most Common Issue: Autoprocessor remembers processed files');
console.log('🔧 Quick Fix: Restart the backend server to clear memory');
console.log('📝 Alternative: Delete existing DZI files to force reconversion');
