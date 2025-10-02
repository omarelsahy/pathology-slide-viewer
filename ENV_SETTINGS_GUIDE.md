# Environment Configuration Guide for Large Files

## Quick Settings for Different System Specifications

### High-Performance System (16GB+ RAM, 8+ CPU cores)
```env
# Pathology Slide Viewer - Environment Configuration
NODE_MODE=server
NODE_ENV=production
PORT=3102
GUI_PORT=3003
CONVERSION_PORT=3001

# Storage paths
SLIDES_DIR=C:\SVS
DZI_DIR=C:\DZI
TEMP_DIR=./temp

# Performance optimizations - AGGRESSIVE
MAX_CONCURRENT=8
VIPS_CONCURRENCY=16
NODE_OPTIONS=--max-old-space-size=8192
VIPS_CACHE_MAX_MEMORY=8589934592
```

### Standard System (8-16GB RAM, 4-8 CPU cores) - **RECOMMENDED**
```env
# Pathology Slide Viewer - Environment Configuration
NODE_MODE=server
NODE_ENV=production
PORT=3102
GUI_PORT=3003
CONVERSION_PORT=3001

# Storage paths
SLIDES_DIR=C:\SVS
DZI_DIR=C:\DZI
TEMP_DIR=./temp

# Performance optimizations - BALANCED
MAX_CONCURRENT=6
VIPS_CONCURRENCY=12
NODE_OPTIONS=--max-old-space-size=4096
VIPS_CACHE_MAX_MEMORY=4294967296
```

### Low-Memory System (<8GB RAM, 2-4 CPU cores)
```env
# Pathology Slide Viewer - Environment Configuration
NODE_MODE=server
NODE_ENV=production
PORT=3102
GUI_PORT=3003
CONVERSION_PORT=3001

# Storage paths
SLIDES_DIR=C:\SVS
DZI_DIR=C:\DZI
TEMP_DIR=./temp

# Performance optimizations - CONSERVATIVE
MAX_CONCURRENT=2
VIPS_CONCURRENCY=4
NODE_OPTIONS=--max-old-space-size=2048
VIPS_CACHE_MAX_MEMORY=2147483648
```

## Key Parameters Explained

### NODE_OPTIONS
- **Purpose**: Sets Node.js heap memory limit
- **Value**: Memory in MB (e.g., 4096 = 4GB)
- **Impact**: Higher = can process larger files without out-of-memory errors
- **Recommendation**: 
  - Minimum 2048 (2GB) for files up to 2GB
  - 4096 (4GB) for files up to 4GB
  - 8192 (8GB) for files >4GB

### MAX_CONCURRENT
- **Purpose**: Maximum number of slides converted simultaneously
- **Value**: Number of parallel conversions
- **Impact**: Higher = faster batch processing but more RAM usage
- **Recommendation**: 
  - Set to 25-50% of your CPU core count
  - Reduce if system becomes unresponsive
  - For large files (>2GB), consider setting to 2-4 even on powerful systems

### VIPS_CONCURRENCY
- **Purpose**: Number of threads VIPS uses per conversion
- **Value**: Number of threads
- **Impact**: Higher = faster single file conversion but more CPU usage
- **Recommendation**: 
  - Set to 1-2x your CPU core count
  - Default: 8-16 for most systems
  - Max useful value: ~32 (diminishing returns beyond this)

### VIPS_CACHE_MAX_MEMORY
- **Purpose**: Maximum memory VIPS can use for caching
- **Value**: Bytes (1GB = 1073741824)
- **Impact**: Higher = faster processing but more RAM usage
- **Recommendation**: 
  - 30-40% of total system RAM
  - 2GB (2147483648) minimum for large files
  - 4GB (4294967296) recommended
  - 8GB (8589934592) for high-performance systems

## Calculating Your Optimal Settings

### Step 1: Check Your System
```powershell
# Check CPU cores
echo $env:NUMBER_OF_PROCESSORS

# Check total RAM (in KB)
wmic computersystem get totalphysicalmemory

# Convert to GB: divide by 1073741824
```

### Step 2: Set MAX_CONCURRENT
```
MAX_CONCURRENT = (CPU_CORES / 2) rounded down
Minimum: 1
Maximum: 8
```

### Step 3: Set VIPS_CONCURRENCY  
```
VIPS_CONCURRENCY = CPU_CORES * 1.5 rounded to nearest even number
Minimum: 4
Maximum: 32
```

### Step 4: Set NODE_OPTIONS
```
NODE_OPTIONS = min((TOTAL_RAM_GB / 2), 8) * 1024
Example: For 16GB RAM = min(8, 8) * 1024 = 8192
```

### Step 5: Set VIPS_CACHE_MAX_MEMORY
```
VIPS_CACHE_MAX_MEMORY = (TOTAL_RAM_GB * 0.35) * 1073741824
Example: For 16GB RAM = (16 * 0.35) * 1073741824 = 6039797760
```

## Example Calculations

### System: 16GB RAM, 8 CPU cores
```
MAX_CONCURRENT = 8 / 2 = 4
VIPS_CONCURRENCY = 8 * 1.5 = 12
NODE_OPTIONS = min(16/2, 8) * 1024 = 8192
VIPS_CACHE_MAX_MEMORY = 16 * 0.35 * 1073741824 = 6039797760
```

### System: 8GB RAM, 4 CPU cores
```
MAX_CONCURRENT = 4 / 2 = 2
VIPS_CONCURRENCY = 4 * 1.5 = 6 (round to 6)
NODE_OPTIONS = min(8/2, 8) * 1024 = 4096
VIPS_CACHE_MAX_MEMORY = 8 * 0.35 * 1073741824 = 3019898880
```

## Quick Reference Table

| System RAM | CPU Cores | NODE_OPTIONS | MAX_CONCURRENT | VIPS_CONCURRENCY | VIPS_CACHE_MAX |
|------------|-----------|--------------|----------------|-------------------|-----------------|
| 4GB        | 2         | 2048         | 1              | 4                 | 1610612736      |
| 8GB        | 4         | 4096         | 2              | 6                 | 3019898880      |
| 16GB       | 8         | 8192         | 4              | 12                | 6039797760      |
| 32GB       | 16        | 8192         | 8              | 24                | 12079595520     |

## Troubleshooting Performance Issues

### Conversion is slow
1. **Increase VIPS_CONCURRENCY** by 25%
2. **Ensure SSD storage** (not HDD)
3. **Check Task Manager** - ensure CPU is being utilized

### System becomes unresponsive
1. **Decrease MAX_CONCURRENT** to 1-2
2. **Decrease VIPS_CONCURRENCY** by 25%
3. **Close other applications**

### Out of memory errors
1. **Increase NODE_OPTIONS** by 1024-2048
2. **Decrease MAX_CONCURRENT** to process files sequentially
3. **Decrease VIPS_CACHE_MAX_MEMORY** to free system RAM

### Files >2GB still failing
1. **Verify NODE_OPTIONS is set** and services restarted
2. **Check Node.js is 64-bit**: `node -p "process.arch"` should show "x64"
3. **Verify VIPS is 64-bit**: `vips --version` should show 64-bit support
4. **Ensure sufficient disk space** (2x file size available)

## Testing Your Configuration

After changing .env settings:

```powershell
# 1. Restart all services
# Stop current services (Ctrl+C)
npm run all

# 2. Monitor the first conversion
# Watch for "JavaScript heap out of memory" errors
# Check Task Manager for memory usage

# 3. If successful, test with progressively larger files
# Start with 2GB, then 3GB, then 4GB+
```

## Advanced: Dynamic Memory Management

For systems that process both small and large files, consider creating separate configurations:

**For large files (>2GB)**:
```powershell
$env:NODE_OPTIONS="--max-old-space-size=8192"
npm run all
```

**For normal operation**:
```powershell
$env:NODE_OPTIONS="--max-old-space-size=4096"
npm run all
```

Or use the environment variable in PowerShell profile for persistence.

---

**Note**: After changing .env settings, always restart all services for changes to take effect.
