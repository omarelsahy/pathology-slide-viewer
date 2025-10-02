# Configuration Guide - Centralized Directory Management

## Overview

The Pathology Slide Viewer now uses **`.env` as the single source of truth** for all directory paths and configuration settings. This eliminates the need to update paths in multiple locations.

## Quick Start

### Changing SVS and DZI Directories

**Edit only one file:** `.env`

```bash
# Storage paths (using F: drive for performance)
SLIDES_DIR=F:\slides
DZI_DIR=F:\dzi
TEMP_DIR=F:\temp
```

**That's it!** All components (server, GUI, Electron app) will automatically use these paths.

---

## Configuration Priority

The system loads configuration in this order:

1. **`.env` file** (HIGHEST PRIORITY - single source of truth)
2. **`gui-config.json`** (fallback for GUI-specific settings)
3. **`app-config.json`** (fallback for server defaults)

### Why This Matters

- ✅ Change paths in **one place** (`.env`)
- ✅ All components stay synchronized
- ✅ Easy to manage and version control
- ✅ Environment-specific configurations (dev/prod)

---

## Complete .env Configuration

```bash
# Pathology Slide Viewer - Environment Configuration

# Application Mode
NODE_MODE=server
NODE_ENV=production

# Server Ports
PORT=3102              # Backend server port
GUI_PORT=3003          # GUI web interface port
CONVERSION_PORT=3001   # Conversion service port

# Storage Paths (SINGLE SOURCE OF TRUTH)
SLIDES_DIR=F:\slides   # Source directory for SVS/NDPI files
DZI_DIR=F:\dzi         # Destination directory for converted DZI files
TEMP_DIR=F:\temp       # Temporary processing directory

# Performance Settings
MAX_CONCURRENT=8       # Maximum parallel slide conversions
VIPS_CONCURRENCY=16    # VIPS processing threads
```

---

## Path Format Guidelines

### Windows Paths

**Option 1: Single backslash** (recommended for .env)
```bash
SLIDES_DIR=F:\slides
DZI_DIR=F:\dzi
```

**Option 2: Forward slashes**
```bash
SLIDES_DIR=F:/slides
DZI_DIR=F:/dzi
```

**Option 3: Double backslashes** (for JSON files)
```json
"sourceDir": "F:\\slides"
```

### Network Paths

```bash
SLIDES_DIR=\\server\share\slides
DZI_DIR=\\server\share\dzi
```

### Relative Paths

Relative to project root:
```bash
SLIDES_DIR=public/slides
DZI_DIR=public/dzi
```

---

## Components Using Centralized Config

### 1. Backend Server (`server.js`)
- Reads from `.env` via `config.js`
- Uses `SLIDES_DIR`, `DZI_DIR`, `TEMP_DIR`
- Auto-processor monitors these directories

### 2. GUI Web Server (`gui-server.js`)
- Loads `.env` on startup
- Falls back to `gui-config.json` if `.env` not set
- Displays config source in console

### 3. Electron GUI (`gui-main.js`)
- Loads `.env` on startup
- Falls back to `gui-config.json` if `.env` not set
- Passes paths to spawned server processes

### 4. Conversion Service
- Inherits environment variables from parent process
- Uses same `SLIDES_DIR` and `DZI_DIR`

---

## Verification

### Check Current Configuration

**Start any component and look for:**

```
✅ GUI configuration loaded from .env (single source of truth)
   Source: F:\slides
   Destination: F:\dzi
   Temp: F:\temp
```

**Or (if using fallback):**

```
⚠️  GUI configuration loaded from gui-config.json (fallback)
   Consider setting paths in .env for centralized configuration
```

### Test Configuration

1. **Edit `.env`** - Change `SLIDES_DIR` to a new path
2. **Restart the application**
3. **Verify** - Check console output shows new path
4. **Confirm** - Upload a slide and verify it goes to new location

---

## Migration from Old System

### Before (Multiple Files)

You had to change paths in:
- ❌ `gui-config.json` (GUI application)
- ❌ `app-config.json` (Server)
- ❌ Environment variables (Manual setup)

### After (Single File)

You only change:
- ✅ `.env` (Everything)

### Migration Steps

1. **Copy your current paths** from `gui-config.json`:
   ```json
   "sourceDir": "F:\\slides\\SVS",
   "destinationDir": "F:\\slides\\DZI"
   ```

2. **Add to `.env`**:
   ```bash
   SLIDES_DIR=F:\slides\SVS
   DZI_DIR=F:\slides\DZI
   ```

3. **Restart all services**

4. **Verify** - Check console shows "loaded from .env"

5. **Optional** - Keep `gui-config.json` as backup or delete it

---

## Advanced Configuration

### Environment-Specific Settings

**Development (.env.development)**
```bash
SLIDES_DIR=./test-slides
DZI_DIR=./test-dzi
NODE_ENV=development
```

**Production (.env.production)**
```bash
SLIDES_DIR=F:\production\slides
DZI_DIR=F:\production\dzi
NODE_ENV=production
```

### Docker/Container Deployment

```bash
# Use mounted volumes
SLIDES_DIR=/data/slides
DZI_DIR=/data/dzi
TEMP_DIR=/tmp/slide-processing
```

### Multiple Instances

Run multiple instances with different configs:

```bash
# Instance 1
PORT=3102
SLIDES_DIR=F:\lab1\slides
DZI_DIR=F:\lab1\dzi

# Instance 2 (separate .env file)
PORT=3202
SLIDES_DIR=F:\lab2\slides
DZI_DIR=F:\lab2\dzi
```

---

## Troubleshooting

### Issue: Paths not updating

**Solution:**
1. Verify `.env` file is in project root
2. Restart all services (server, GUI, Electron)
3. Check console for "loaded from .env" message

### Issue: Using wrong directories

**Solution:**
1. Check console output shows correct source
2. If shows "gui-config.json (fallback)", add paths to `.env`
3. Ensure no typos in `.env` variable names

### Issue: Permission denied

**Solution:**
1. Verify application has read/write access to directories
2. Check Windows Defender exclusions
3. Run as administrator if needed

### Issue: Network paths not working

**Solution:**
1. Use UNC format: `\\server\share\path`
2. Ensure network drive is accessible
3. Map network drive to letter if needed

---

## Best Practices

1. **Always use `.env`** for directory paths
2. **Keep `.env` out of version control** (use `.env.example` as template)
3. **Use absolute paths** for production
4. **Use relative paths** for development/testing
5. **Document custom settings** in comments
6. **Backup `.env`** before major changes
7. **Test changes** in development first

---

## Summary

### To Change Directories:

1. **Edit `.env`**
2. **Update these lines:**
   ```bash
   SLIDES_DIR=YOUR_NEW_PATH
   DZI_DIR=YOUR_NEW_PATH
   TEMP_DIR=YOUR_NEW_PATH
   ```
3. **Restart application**
4. **Done!** ✅

No need to touch any other configuration files!
