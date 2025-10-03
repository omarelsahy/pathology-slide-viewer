# Large File Support (>2GB SVS Files)

## Root Cause Identified ✅

**The actual issue**: VIPS has a default **50MB memory limit** for TIFF file operations:
```
Cumulated memory allocation of 52379650 + 2406400 bytes is beyond the 52428800 cumulated byte limit
```

This occurs during the DZI generation phase when reading the intermediate TIFF file created by ICC transformation.

## Summary of Fixes Applied

This document outlines all fixes implemented to support SVS files larger than 2GB.

## Changes Made

### 1. VIPS TIFF Memory Limit (CRITICAL FIX) ✅
**Problem**: VIPS defaulted to 50MB memory limit for TIFF operations, causing failures during DZI generation.

**Error Message**: `tiff2vips: Cumulated memory allocation... is beyond the 52428800 cumulated byte limit`

**Fixed in**:
- `conversion-server.js` - line 523: Added `[access=sequential,memory=true]` to input path
- `conversionWorker.js` - line 257: Added `[access=sequential,memory=true]` to input path  
- `vips-config.js` - line 38: Set `VIPS_DISC_THRESHOLD: '0'` to disable memory limits

**Impact**: This was the PRIMARY cause of >2GB file failures during DZI tile generation.

### 2. Express.js Body Parser Limits ✅
**Problem**: Default JSON body limit of 100kb prevented large metadata payloads.

**Fixed in**:
- `server.js` - line 95: `express.json({ limit: '100mb' })`
- `conversion-server.js` - line 194: `express.json({ limit: '100mb' })`
- `gui-server.js` - line 94: `express.json({ limit: '100mb' })`

### 3. Node.js Heap Memory Limits ✅
**Problem**: Default heap size (~1.4GB) insufficient for processing large files.

**Fixed in**:
- `package.json` - Added `--max-old-space-size=4096` flags to all server scripts
  - Main server: 4GB heap
  - Conversion server: 4GB heap
  - GUI server: 2GB heap

**Environment Variable**: Added `NODE_OPTIONS=--max-old-space-size=4096` to `.env`

### 4. Child Process Buffer Limits ✅
**Problem**: Metadata extraction commands had small buffer limits (8-64MB).

**Fixed in `slideMetadataExtractor.js`**:
- Line 153: `vipsheader -a` buffer: 16MB → 128MB, timeout: 60s → 120s
- Line 202: ICC profile extraction buffer: 64MB → 128MB
- Line 430: `openslide-show-properties` buffer: 8MB → 128MB, timeout: 60s → 120s

### 5. Existing Good Configurations ✅
The following were already properly configured:
- **Multer file upload limit**: 20GB (gui-server.js:90)
- **BigTIFF support**: `bigtiff=true` flag enabled (conversionWorker.js:199)
- **Sequential access**: Memory-efficient file reading enabled
- **VIPS buffer optimization**: Dynamic buffer sizing based on system RAM

## Testing After Restart

After applying these fixes, restart all services:

```powershell
# Stop all running services (Ctrl+C if running)
# Then restart:
npm run all
```

## Verification Checklist

### 1. Check Node.js Version
```powershell
node --version
```
Should be v18 or higher.

### 2. Verify VIPS Installation (64-bit)
```powershell
vips --version
```
Look for "x64" or "64-bit" in the output.

### 3. Check System Architecture
```powershell
systeminfo | findstr /C:"System Type"
```
Should show "x64-based PC".

### 4. Verify Available Memory
```powershell
systeminfo | findstr /C:"Total Physical Memory"
```
Recommended: 8GB+ for files >2GB.

### 5. Check Disk Space
Ensure you have at least 2x the original file size available:
- For a 3GB SVS file, you need ~6GB free space
- Output DZI is typically 1.4-1.5x the original file size

## Common Issues and Solutions

### Issue: "JavaScript heap out of memory"
**Solution**: The NODE_OPTIONS setting should fix this. If it persists:
1. Increase the value: `NODE_OPTIONS=--max-old-space-size=8192` (8GB)
2. Restart services

### Issue: "ENOMEM: not enough memory"
**Solution**: 
1. Close other applications to free RAM
2. Reduce MAX_CONCURRENT in .env: `MAX_CONCURRENT=4`
3. Reduce VIPS_CONCURRENCY: `VIPS_CONCURRENCY=8`

### Issue: "EBUSY: resource busy or locked"
**Solution**: Windows file locking issue
1. Wait a few seconds and retry
2. Check if antivirus is scanning the file
3. Ensure file is not open in another application

### Issue: "maxBuffer exceeded"
**Solution**: Already fixed with 128MB buffers. If it still occurs:
1. The file might have extremely large metadata
2. Check the file integrity with: `vips copy "file.svs" null:`

### Issue: Conversion hangs or is very slow
**Solution**:
1. Check system resources: Task Manager → Performance
2. Verify VIPS is using multiple threads: Environment should show `VIPS_CONCURRENCY=16`
3. Check if ICC transformation is failing (look for temp_srgb_*.v files)

## Performance Expectations

For large files, expect:
- **2GB SVS**: ~5-15 minutes (depends on system)
- **3-4GB SVS**: ~10-30 minutes
- **5GB+ SVS**: ~20-60 minutes

Factors affecting speed:
- CPU cores (more is better)
- RAM available (8GB+ recommended)
- SSD vs HDD (SSD significantly faster)
- VIPS_CONCURRENCY setting

## 2GB Barrier Explained

The 2GB limit is historically significant because:
- **2GB = 2^31 bytes** (2,147,483,648 bytes)
- This is the maximum value for a signed 32-bit integer
- Older systems, libraries, and file formats hit this limit

Our fixes ensure:
- 64-bit Node.js operations throughout
- BigTIFF format support (no 4GB TIFF limit)
- Large buffer allocations for metadata
- Sufficient heap memory for processing

## Monitoring Large Conversions

### Via Web Interface
Access the GUI at `http://localhost:3003` to see:
- Real-time conversion progress
- Current phase (ICC transform, tile generation, etc.)
- Estimated time remaining

### Via Console Logs
Look for these key messages:
```
✅ ICC Transform completed
✅ DZI conversion completed
✅ Metadata extraction completed
```

### Check Memory Usage
```powershell
# While conversion is running:
tasklist /FI "IMAGENAME eq node.exe" /FO TABLE
```

## Troubleshooting Commands

```powershell
# Test VIPS with a large file
vips dzsave "C:\SVS\large-file.svs" "C:\DZI\test" --layout dz --suffix .jpg[Q=80] --tile-size 256 --overlap 1

# Check file properties
vipsheader -a "C:\SVS\large-file.svs"

# Test ICC profile extraction
vipsheader -f icc-profile-data "C:\SVS\large-file.svs" > test.b64

# Check available memory
wmic OS get FreePhysicalMemory,TotalVisibleMemorySize /Value
```

## Additional Recommendations

1. **Use SSD storage** for both input (SLIDES_DIR) and output (DZI_DIR)
2. **Disable Windows indexing** on the DZI directory for better performance
3. **Exclude directories from antivirus** scans during conversion
4. **Close resource-intensive applications** during large conversions
5. **Use production mode** (`NODE_ENV=production`) for better performance

## Configuration Examples

### For systems with 16GB+ RAM and 8+ cores:
```env
MAX_CONCURRENT=8
VIPS_CONCURRENCY=16
NODE_OPTIONS=--max-old-space-size=8192
```

### For systems with 8GB RAM and 4 cores:
```env
MAX_CONCURRENT=4
VIPS_CONCURRENCY=8
NODE_OPTIONS=--max-old-space-size=4096
```

### For systems with <8GB RAM:
```env
MAX_CONCURRENT=2
VIPS_CONCURRENCY=4
NODE_OPTIONS=--max-old-space-size=2048
```

## Support

If you continue to experience issues with files >2GB after applying these fixes:

1. Check the conversion-server logs for specific error messages
2. Test with a known-good large SVS file
3. Verify all prerequisites are met (Node.js v18+, 64-bit VIPS, sufficient RAM)
4. Create a GitHub issue with:
   - File size
   - Error messages
   - System specifications
   - Node.js and VIPS versions

---

**Last Updated**: 2025-10-01
**Applied Fixes**: Express limits, Node.js heap size, buffer limits, documentation
