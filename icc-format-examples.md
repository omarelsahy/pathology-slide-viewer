# ICC Intermediate Format Configuration Examples

The pathology slide viewer now supports configurable intermediate formats for ICC color transforms. This allows you to optimize for either speed or disk space based on your system's characteristics.

## Configuration Location

Edit the `icc` section in `pathology-config.json`:

```json
{
  "conversion": {
    "icc": {
      "intermediateFormat": "tif",
      "compression": "lzw", 
      "quality": 95,
      "useVipsNative": false
    }
  }
}
```

## Format Options

### Option 1: VIPS Native Format (.v) - Maximum Speed
**Best for: Systems with fast storage (NVMe) but limited by I/O bandwidth**

```json
"icc": {
  "intermediateFormat": "v",
  "useVipsNative": true
}
```

**Characteristics:**
- ✅ Fastest I/O performance (no compression/decompression)
- ✅ Native VIPS format - optimal for VIPS processing
- ✅ Best for systems with fast storage (NVMe, high-end SSDs)
- ❌ Largest temporary files (can be 5-10x larger than compressed)
- ❌ Requires more temporary disk space

**Use when:**
- You have NVMe or high-performance SSD storage
- Temporary disk space is not a concern
- I/O speed is the primary bottleneck
- Converting large pathology slides (>1GB)

### Option 2: Compressed TIFF (.tif) - Balanced (Default)
**Best for: Most systems, especially those with limited storage**

```json
"icc": {
  "intermediateFormat": "tif",
  "compression": "lzw",
  "quality": 95,
  "useVipsNative": false
}
```

**Characteristics:**
- ✅ Much smaller temporary files (5-10x smaller than .v)
- ✅ Good compatibility and debugging
- ✅ Reasonable performance on most systems
- ❌ Slight compression/decompression overhead
- ❌ Not as fast as native VIPS format

**Compression Options:**
- `"lzw"` - Lossless, good compression ratio (recommended)
- `"deflate"` - Lossless, better compression, slightly slower
- `"jpeg"` - Lossy, smallest files, fastest compression
- `"none"` - No compression, larger files, faster I/O

### Option 3: High-Quality TIFF
**Best for: When image quality is critical**

```json
"icc": {
  "intermediateFormat": "tif",
  "compression": "lzw",
  "quality": 100,
  "useVipsNative": false
}
```

### Option 4: Fast JPEG Intermediate
**Best for: Quick previews or when disk space is extremely limited**

```json
"icc": {
  "intermediateFormat": "tif",
  "compression": "jpeg",
  "quality": 85,
  "useVipsNative": false
}
```

## Performance Comparison

Based on your system's characteristics:

| Storage Type | Recommended Format | Expected Improvement |
|--------------|-------------------|---------------------|
| SATA SSD (your current) | `.tif` with LZW | Baseline |
| NVMe SSD | `.v` native | 20-40% faster |
| SATA HDD | `.tif` with JPEG | 10-20% faster |
| Network storage | `.tif` with deflate | Varies |

## Testing Different Formats

To test performance with different formats:

1. **Test with .v format:**
   ```json
   "icc": {
     "intermediateFormat": "v",
     "useVipsNative": true
   }
   ```

2. **Test with compressed TIFF:**
   ```json
   "icc": {
     "intermediateFormat": "tif", 
     "compression": "lzw",
     "quality": 95
   }
   ```

3. **Monitor conversion times and temp file sizes**
4. **Check available disk space in temp directory**

## Troubleshooting

### Large .v Files Filling Disk
- Switch to compressed TIFF format
- Increase temp directory disk space
- Use different temp directory on larger drive

### Slow Conversions with Compressed TIFF
- Try .v format if you have fast storage
- Reduce compression (use "jpeg" or "none")
- Check if temp directory is on slow storage

### Memory Issues
- Reduce VIPS cache memory in config
- Use sequential access (already enabled)
- Monitor system memory usage during conversion

## Current System Recommendations

Based on your dual SATA SSD setup with 1,374-2,732 IOPS:

1. **Start with compressed TIFF** (current default)
2. **Test .v format** to see if I/O speed improves
3. **Monitor temp directory space** (E:\temp)
4. **Consider NVMe upgrade** for maximum performance gains

The .v format may help with your I/O-bound system, but monitor disk space carefully as pathology slides can create very large intermediate files.
