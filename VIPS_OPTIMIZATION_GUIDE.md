# VIPS Performance Optimization Guide

## Critical Issues Identified

Based on the performance diagnostic, your lab computer has these performance bottlenecks:

### 1. **VIPS Threading Not Available** (CRITICAL)
- **Issue**: VIPS is running single-threaded on a 16-core system
- **Impact**: ~90% performance loss on multi-core systems
- **Priority**: IMMEDIATE FIX REQUIRED

### 2. **Antimalware Service CPU Usage** (HIGH)
- **Issue**: MsMpEng.exe consuming CPU during conversions
- **Impact**: 20-40% performance reduction
- **Priority**: HIGH

### 3. **No GPU Acceleration** (MEDIUM)
- **Issue**: Missing OpenCL/CUDA support
- **Impact**: 2-5x potential speedup unavailable
- **Priority**: MEDIUM

## Immediate Fixes

### Fix 1: Install VIPS with Threading Support

**Current VIPS Version**: 8.16.1 (without threading)

#### Option A: Install Pre-built VIPS with Threading
```powershell
# Uninstall current VIPS
winget uninstall libvips

# Install VIPS with full threading support
winget install --id=lovell.libvips-dev
```

#### Option B: Manual Installation
1. Download VIPS from: https://github.com/libvips/libvips/releases
2. Choose the "vips-dev-w64-all" package (includes threading)
3. Extract to `C:\vips`
4. Add `C:\vips\bin` to PATH

#### Verify Threading Support
```powershell
vips --vips-config | findstr -i thread
```
Should show: `enable-threads: yes`

### Fix 2: Enhanced Windows Defender Exclusions

Run the enhanced exclusion script:

```powershell
# Run as Administrator
.\enhanced-defender-exclusions.ps1
```

### Fix 3: Optimize VIPS Environment Variables

The system will automatically use optimized settings, but you can manually set:

```powershell
# Set environment variables for current session
$env:VIPS_CONCURRENCY = "8"          # Half of your 16 cores
$env:VIPS_NTHR = "8"                 # Threading count
$env:VIPS_DISC_THRESHOLD = "13421772800"  # 12.5GB (40% of 32GB RAM)
$env:VIPS_CACHE_MAX = "12800"        # 12.8GB cache
$env:VIPS_NOVECTOR = "0"             # Enable SIMD
```

## Performance Expectations

### Before Optimization
- **Single-threaded VIPS**: ~1 core utilization
- **Antimalware interference**: High CPU usage
- **Expected speed**: 10-20 MB/s processing

### After Optimization
- **Multi-threaded VIPS**: ~8 core utilization
- **Reduced antimalware impact**: Minimal CPU usage
- **Expected speed**: 100-200 MB/s processing
- **Performance gain**: **5-10x faster conversions**

## Testing the Fixes

### 1. Run Performance Diagnostic Again
```bash
node performance-diagnostic.js
```

### 2. Test Conversion Speed
```bash
# Time a test conversion
node -e "
const { performance } = require('perf_hooks');
const { exec } = require('child_process');
const start = performance.now();
exec('vips dzsave test.svs test_output', (err, stdout, stderr) => {
  console.log(\`Conversion took: \${((performance.now() - start) / 1000).toFixed(1)} seconds\`);
});
"
```

### 3. Monitor CPU Usage
- Open Task Manager during conversion
- VIPS should use 50-70% of total CPU (8+ cores)
- MsMpEng should use <5% CPU

## Advanced Optimizations (Optional)

### GPU Acceleration Setup
If you have a dedicated GPU:

1. **Install VIPS with OpenCL**:
   ```powershell
   # Check GPU support
   vips --vips-config | findstr -i opencl
   ```

2. **Enable GPU processing**:
   ```bash
   export VIPS_OPENCL=1
   ```

### Memory Optimization
For very large slides (>10GB):

```bash
export VIPS_DISC_THRESHOLD=1073741824  # 1GB - force disk usage sooner
export VIPS_CACHE_MAX_MEMORY=4294967296  # 4GB max memory cache
```

## Troubleshooting

### If Threading Still Not Working
1. Check VIPS installation: `vips --version`
2. Verify GLib dependency: `vips --vips-config | findstr glib`
3. Reinstall with dependencies: `winget install libvips.libvips --force`

### If Antimalware Still Interfering
1. Temporarily disable real-time protection during conversions
2. Add process exclusions for `vips.exe` and `node.exe`
3. Consider using Windows Defender Application Control (WDAC)

### If Performance Still Poor
1. Check disk I/O: Use CrystalDiskMark to test storage speed
2. Monitor memory usage: Ensure sufficient RAM available
3. Check thermal throttling: Monitor CPU temperatures

## Expected Results

After implementing these fixes, your lab computer should:
- **Utilize 8+ CPU cores** during conversion
- **Process slides 5-10x faster** than current speed
- **Match or exceed** your personal computer's performance
- **Reduce conversion time** from hours to minutes for large slides

The key is fixing the threading issue - this single change should provide the most dramatic performance improvement.
