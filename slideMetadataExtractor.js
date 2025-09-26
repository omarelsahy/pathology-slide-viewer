// Slide Metadata Extraction Module
// Extracts ICC profiles, labels, and macro images from pathology slides

const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');

class SlideMetadataExtractor {
  constructor(config) {
    this.config = config;
    this.metadataDir = path.join(config.dziDir, 'metadata');
    
    // Ensure metadata directory exists
    if (!fs.existsSync(this.metadataDir)) {
      fs.mkdirSync(this.metadataDir, { recursive: true });
    }
  }

  /**
   * Extract all metadata from a slide file
   * @param {string} slidePath - Path to the slide file
   * @param {string} baseName - Base name for output files
   * @returns {Promise<Object>} Metadata object with paths to extracted files
   */
  async extractMetadata(slidePath, baseName) {
    console.log(`\n=== METADATA EXTRACTION STARTED ===`);
    console.log(`File: ${path.basename(slidePath)}`);
    console.log(`Base name: ${baseName}`);
    const t0 = Date.now();
    const mem0 = process.memoryUsage();
    console.log(`Process RSS: ${(mem0.rss/1024/1024).toFixed(1)} MB | HeapUsed: ${(mem0.heapUsed/1024/1024).toFixed(1)} MB | OS free: ${(os.freemem()/1024/1024/1024).toFixed(1)} GB`);
    
    const metadata = {
      slidePath,
      baseName,
      extractedAt: new Date().toISOString(),
      iccProfile: null,
      label: null,
      macro: null,
      properties: {},
      errors: []
    };

    try {
      // Extract slide properties quickly using vipsheader
      const properties = await this.extractSlideProperties(slidePath);
      metadata.properties = properties;
      console.log(`Properties extracted in ${((Date.now() - t0)/1000).toFixed(2)}s (openslideSupported=${!!properties.openslideSupported}, assoc=[${(properties.associatedImages||[]).join(', ')}])`);

      // Extract ICC profile (skip if already present on disk)
      const iccPathCandidate = path.join(this.metadataDir, `${baseName}.icc`);
      if (fs.existsSync(iccPathCandidate) && fs.statSync(iccPathCandidate).size > 0) {
        console.log(`ICC profile already exists, skipping extraction: ${iccPathCandidate}`);
        metadata.iccProfile = iccPathCandidate;
      } else {
        const tIcc0 = Date.now();
        const iccPath = await this.extractICCProfile(slidePath, baseName);
        const tIcc1 = Date.now();
        console.log(`ICC extraction ${iccPath ? 'succeeded' : 'skipped/failed'} in ${((tIcc1 - tIcc0)/1000).toFixed(2)}s`);
        metadata.iccProfile = iccPath;
      }

      // Discover associated images more robustly (vipsheader -> openslide-show-properties -> probing)
      let assoc = (properties.associatedImages || []).map(s => s.toLowerCase());
      if (assoc.length === 0) {
        try {
          const discovered = await this.discoverAssociatedImages(slidePath);
          if (discovered && discovered.length) {
            assoc = discovered.map(s => s.toLowerCase());
            metadata.properties.associatedImages = discovered; // persist
            console.log(`Associated images discovered: ${discovered.join(', ')}`);
          }
        } catch (_) { /* noop */ }
      }
      const assocUnknown = assoc.length === 0;

      // Conditionally extract label and macro only if present
      const labelPathCandidate = path.join(this.metadataDir, `${baseName}_label.jpg`);
      const macroPathCandidate = path.join(this.metadataDir, `${baseName}_macro.jpg`);

      if (assoc.includes('label')) {
        if (fs.existsSync(labelPathCandidate) && fs.statSync(labelPathCandidate).size > 0) {
          console.log(`Label image already exists, skipping extraction: ${labelPathCandidate}`);
          metadata.label = labelPathCandidate;
        } else {
          const labelPath = await this.extractLabelImage(slidePath, baseName);
          metadata.label = labelPath;
        }
      } else if (assocUnknown) {
        console.log(`Associated images not advertised; attempting best-effort label extraction (aliases).`);
        metadata.label = await this.extractAssociatedWithAliases(slidePath, baseName, 'label', ['label', 'slide label', 'label image', 'thumbnail']);
      } else {
        console.log(`No 'label' associated image advertised by OpenSlide; skipping extraction.`);
      }

      if (assoc.includes('macro')) {
        if (fs.existsSync(macroPathCandidate) && fs.statSync(macroPathCandidate).size > 0) {
          const existingSize = fs.statSync(macroPathCandidate).size;
          const existingSizeKB = Math.round(existingSize / 1024);
          
          // Re-extract if existing file is too large (old unoptimized extraction)
          if (existingSize > 100 * 1024) { // 100KB threshold
            console.log(`Macro image exists but is large (${existingSizeKB} KB), re-extracting with optimization...`);
            const macroPath = await this.extractMacroImage(slidePath, baseName);
            metadata.macro = macroPath;
          } else {
            console.log(`Macro image already exists and optimized, skipping extraction: ${macroPathCandidate} (${existingSizeKB} KB)`);
            metadata.macro = macroPathCandidate;
          }
        } else {
          const macroPath = await this.extractMacroImage(slidePath, baseName);
          metadata.macro = macroPath;
        }
      } else if (assocUnknown) {
        console.log(`Associated images not advertised; attempting best-effort macro extraction (aliases).`);
        metadata.macro = await this.extractAssociatedWithAliases(slidePath, baseName, 'macro', ['macro', 'overview', 'macro image', 'thumbnail']);
      } else {
        console.log(`No 'macro' associated image advertised by OpenSlide; skipping extraction.`);
      }

      // Save metadata to JSON file
      const metadataPath = path.join(this.metadataDir, `${baseName}_metadata.json`);
      fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
      
      const dt = Date.now() - t0;
      const mem1 = process.memoryUsage();
      console.log(`Memory after metadata: RSS ${(mem1.rss/1024/1024).toFixed(1)} MB | HeapUsed ${(mem1.heapUsed/1024/1024).toFixed(1)} MB | OS free ${(os.freemem()/1024/1024/1024).toFixed(1)} GB`);
      console.log(`=== METADATA EXTRACTION COMPLETED (${(dt/1000).toFixed(1)}s) ===`);
      console.log(`ICC Profile: ${metadata.iccProfile ? 'Extracted' : 'Not found'}`);
      console.log(`Label: ${metadata.label ? 'Extracted' : 'Not found'}`);
      console.log(`Macro: ${metadata.macro ? 'Extracted' : 'Not found'}`);
      console.log(`Metadata saved: ${metadataPath}`);
      console.log(`=====================================\n`);

      return metadata;
    } catch (error) {
      console.error(`Metadata extraction failed: ${error.message}`);
      metadata.errors.push(error.message);
      return metadata;
    }
  }

  /**
   * Extract slide properties using VIPS
   */
  async extractSlideProperties(slidePath) {
    return new Promise((resolve) => {
      const basicInfo = this.getBasicFileInfo(slidePath);

      // Use vipsheader -a to list all available header/properties quickly (no temp files)
      const command = `vipsheader -a "${slidePath}"`;
      exec(command, { maxBuffer: 1024 * 1024 * 16, timeout: 60_000 }, (error, stdout, stderr) => {
        if (error) {
          console.warn(`vipsheader failed (${error.message}); returning basic info`);
          if (stderr) console.warn(`vipsheader stderr: ${stderr.substring(0, 2000)}`);
          resolve(basicInfo);
          return;
        }

        const props = this.parseVipsHeader(stdout);
        if (!stdout || !stdout.trim()) {
          console.warn(`vipsheader produced empty output; proceeding with basic info`);
        }
        // Derive associated images list if present in known keys
        const assocStr = props['openslide.associated-images']
          || props['openslide.associated_images']
          || props['openslide.associatedimages']
          || '';
        const associatedImages = String(assocStr)
          .split(',')
          .map(s => s.trim())
          .filter(Boolean);

        resolve({
          ...basicInfo,
          openslideSupported: Boolean(Object.keys(props).some(k => k.startsWith('openslide.'))),
          associatedImages,
          raw: props
        });
      });
    });
  }

  /**
   * Extract ICC profile from slide using multiple strategies.
   * Primary: use `vipsheader -f icc-profile-data` which returns base64 of the ICC blob.
   * Fallbacks: try libvips copy/raw methods and external tools if available.
   */
  async extractICCProfile(slidePath, baseName) {
    return new Promise((resolve) => {
      const iccOutputPath = path.join(this.metadataDir, `${baseName}.icc`);
      const tmpBase64Path = path.join(this.metadataDir, `${baseName}.icc.b64`);
      
      // Strategy 1: Use vipsheader to fetch base64 of the ICC blob, then decode in Node
      const strategies = [
        {
          name: 'vipsheader base64 -> decode',
          run: (next) => {
            const cmd = `vipsheader -f icc-profile-data "${slidePath}"`;
            // Increase buffer in case of large profiles (~13MB -> base64 ~17MB)
            exec(cmd, { maxBuffer: 1024 * 1024 * 64 }, (err, stdout) => {
              if (err || !stdout || !stdout.trim()) {
                console.log(`ICC extraction (vipsheader) failed or empty output`);
                next();
                return;
              }
              try {
                // vipsheader prints blob as base64 text
                const base64 = stdout.replace(/\s+/g, '');
                const buf = Buffer.from(base64, 'base64');
                if (!buf.length) {
                  console.log(`ICC extraction (vipsheader) produced zero-length buffer`);
                  next();
                  return;
                }
                fs.writeFileSync(iccOutputPath, buf);
                console.log(`ICC profile extracted via vipsheader: ${iccOutputPath} (${buf.length} bytes)`);
                resolve(iccOutputPath);
              } catch (e) {
                console.log(`ICC extraction (vipsheader decode) error: ${e.message}`);
                next();
              }
            });
          }
        },
        {
          name: 'vips copy icc-profile-data',
          run: (next) => {
            const cmd = `vips copy "${slidePath}[icc-profile-data]" "${iccOutputPath}"`;
            exec(cmd, (error) => {
              if (error || !fs.existsSync(iccOutputPath) || fs.statSync(iccOutputPath).size === 0) {
                if (fs.existsSync(iccOutputPath)) fs.unlinkSync(iccOutputPath);
                next();
                return;
              }
              console.log(`ICC profile extracted via vips copy: ${iccOutputPath}`);
              resolve(iccOutputPath);
            });
          }
        },
        {
          name: 'vips icc_export',
          run: (next) => {
            const cmd = `vips icc_export "${slidePath}" "${iccOutputPath}"`;
            exec(cmd, (error) => {
              if (error || !fs.existsSync(iccOutputPath) || fs.statSync(iccOutputPath).size === 0) {
                if (fs.existsSync(iccOutputPath)) fs.unlinkSync(iccOutputPath);
                next();
                return;
              }
              console.log(`ICC profile extracted via vips icc_export: ${iccOutputPath}`);
              resolve(iccOutputPath);
            });
          }
        },
        {
          name: 'exiftool -icc_profile -b',
          run: (next) => {
            const cmd = `exiftool -icc_profile -b "${slidePath}" > "${iccOutputPath}"`;
            exec(cmd, (error) => {
              if (error || !fs.existsSync(iccOutputPath) || fs.statSync(iccOutputPath).size === 0) {
                if (fs.existsSync(iccOutputPath)) fs.unlinkSync(iccOutputPath);
                next();
                return;
              }
              console.log(`ICC profile extracted via exiftool: ${iccOutputPath}`);
              resolve(iccOutputPath);
            });
          }
        },
        {
          name: 'magick identify icc:*',
          run: (next) => {
            const cmd = `magick identify -format "%[icc:*]" "${slidePath}" > "${iccOutputPath}"`;
            exec(cmd, (error) => {
              if (error || !fs.existsSync(iccOutputPath) || fs.statSync(iccOutputPath).size === 0) {
                if (fs.existsSync(iccOutputPath)) fs.unlinkSync(iccOutputPath);
                next();
                return;
              }
              console.log(`ICC profile extracted via ImageMagick: ${iccOutputPath}`);
              resolve(iccOutputPath);
            });
          }
        }
      ];

      const tryNextCommand = (index) => {
        if (index >= strategies.length) {
          console.log(`No ICC profile found or extractable from ${path.basename(slidePath)}`);
          resolve(null);
          return;
        }

        console.log(`Trying ICC extraction strategy ${index + 1}: ${strategies[index].name}`);
        strategies[index].run(() => tryNextCommand(index + 1));
      };

      tryNextCommand(0);
    });
  }

  /**
   * Extract label image from slide using VIPS
   */
  async extractLabelImage(slidePath, baseName) {
    return new Promise((resolve) => {
      const labelOutputPath = path.join(this.metadataDir, `${baseName}_label.jpg`);
      const tempPath = path.join(os.tmpdir(), `temp_label_${Date.now()}.tiff`);
      
      // Extract label and resize to small thumbnail with high compression
      // This creates images of just a few KB instead of 12MB
      const extractCommand = `vips openslideload "${slidePath}" "${tempPath}" --associated=label`;
      
      exec(extractCommand, { timeout: 120_000 }, (extractError, stdout, stderr) => {
        if (extractError || !fs.existsSync(tempPath)) {
          console.log(`No label image found in ${path.basename(slidePath)}`);
          if (extractError && stderr) console.log(`label stderr: ${stderr.substring(0, 1000)}`);
          resolve(null);
          return;
        }
        
        // Resize to 50% with moderate compression (creates ~50-150KB files)
        const resizeCommand = `vips resize "${tempPath}" "${labelOutputPath}[Q=85,optimize_coding,strip]" 0.5`;
        
        exec(resizeCommand, { timeout: 60_000 }, (resizeError) => {
          // Clean up temp file
          try {
            if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
          } catch (e) {}
          
          if (resizeError || !fs.existsSync(labelOutputPath)) {
            console.log(`Failed to resize label image for ${path.basename(slidePath)}`);
            resolve(null);
          } else {
            const stats = fs.statSync(labelOutputPath);
            const sizeKB = Math.round(stats.size / 1024);
            console.log(`Label image extracted: ${labelOutputPath} (${sizeKB} KB)`);
            resolve(labelOutputPath);
          }
        });
      });
    });
  }

  /**
   * Extract macro image from slide using VIPS
   */
  async extractMacroImage(slidePath, baseName) {
    return new Promise((resolve) => {
      const macroOutputPath = path.join(this.metadataDir, `${baseName}_macro.jpg`);
      const tempPath = path.join(os.tmpdir(), `temp_macro_${Date.now()}.tiff`);
      
      // Extract macro and resize to small thumbnail with high compression
      // This creates images of just a few KB instead of 12MB
      const extractCommand = `vips openslideload "${slidePath}" "${tempPath}" --associated=macro`;
      
      exec(extractCommand, { timeout: 120_000 }, (extractError, stdout, stderr) => {
        if (extractError || !fs.existsSync(tempPath)) {
          console.log(`No macro image found in ${path.basename(slidePath)}`);
          if (extractError && stderr) console.log(`macro stderr: ${stderr.substring(0, 1000)}`);
          resolve(null);
          return;
        }
        
        // Resize to 50% with moderate compression (creates ~50-150KB files)
        const resizeCommand = `vips resize "${tempPath}" "${macroOutputPath}[Q=85,optimize_coding,strip]" 0.5`;
        
        exec(resizeCommand, { timeout: 60_000 }, (resizeError) => {
          // Clean up temp file
          try {
            if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
          } catch (e) {}
          
          if (resizeError || !fs.existsSync(macroOutputPath)) {
            console.log(`Failed to resize macro image for ${path.basename(slidePath)}`);
            resolve(null);
          } else {
            const stats = fs.statSync(macroOutputPath);
            const sizeKB = Math.round(stats.size / 1024);
            console.log(`Macro image extracted: ${macroOutputPath} (${sizeKB} KB)`);
            resolve(macroOutputPath);
          }
        });
      });
    });
  }

  /**
   * Extract associated image with aliases
   */
  async extractAssociatedWithAliases(slidePath, baseName, kind, aliases) {
    for (const alias of aliases) {
      const safeSuffix = kind.toLowerCase();
      const outPath = path.join(this.metadataDir, `${baseName}_${safeSuffix}.jpg`);
      const cmd = `vips openslideload "${slidePath}" "${outPath}" --associated=${JSON.stringify(alias).slice(1, -1)}`;
      const ok = await new Promise((resolve) => {
        exec(cmd, { timeout: 90_000 }, (err) => {
          if (!err && fs.existsSync(outPath) && fs.statSync(outPath).size > 0) {
            resolve(true);
          } else {
            // cleanup failed attempt
            if (fs.existsSync(outPath)) {
              try { fs.unlinkSync(outPath); } catch(_) {}
            }
            resolve(false);
          }
        });
      });
      if (ok) {
        console.log(`Associated image '${kind}' extracted via alias '${alias}': ${outPath}`);
        return outPath;
      }
    }
    return null;
  }

  /**
   * Discover associated image names using multiple strategies:
   * 1) vipsheader -a (already parsed in extractSlideProperties)
   * 2) openslide-show-properties (if available on PATH)
   * 3) Probe a broader alias list and record which exist
   */
  async discoverAssociatedImages(slidePath) {
    // Strategy 2: openslide-show-properties
    const candidates = new Set();
    const tryShowProps = () => new Promise((resolve) => {
      const cmd = `openslide-show-properties "${slidePath}"`;
      exec(cmd, { timeout: 60_000, maxBuffer: 1024 * 1024 * 8 }, (err, stdout) => {
        if (err || !stdout) return resolve([]);
        const lines = stdout.split(/\r?\n/);
        for (const line of lines) {
          // Example: openslide.associated-images: label,macro
          const idx = line.indexOf('openslide.associated');
          if (idx >= 0 && line.includes(':')) {
            const parts = line.split(':');
            const v = (parts.slice(1).join(':') || '').trim();
            v.split(',').map(s => s.trim()).filter(Boolean).forEach(x => candidates.add(x));
          }
        }
        resolve(Array.from(candidates));
      });
    });

    const fromShowProps = await tryShowProps();
    if (fromShowProps.length) return fromShowProps;

    // Strategy 3: probe a broad alias set
    const aliasGroups = [
      ['label', 'slide label', 'label image', 'thumbnail', 'labelimage'],
      ['macro', 'overview', 'macro image', 'thumbnail', 'overview image'],
    ];

    const discovered = new Set();
    for (const group of aliasGroups) {
      for (const name of group) {
        const tmp = path.join(this.metadataDir, `__probe_${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`);
        const cmd = `vips openslideload "${slidePath}" "${tmp}" --associated=${JSON.stringify(name).slice(1, -1)}`;
        const ok = await new Promise((resolve) => {
          exec(cmd, { timeout: 30_000 }, (err) => {
            if (!err && fs.existsSync(tmp) && fs.statSync(tmp).size > 0) {
              resolve(true);
            } else {
              resolve(false);
            }
          });
        });
        try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch(_) {}
        if (ok) discovered.add(name);
      }
    }
    return Array.from(discovered);
  }

  /**
   * Parse VIPS header output to extract properties
   */
  parseVipsHeader(output) {
    const properties = {};
    const lines = output.split('\n');
    
    for (const line of lines) {
      if (line.includes(':')) {
        const [key, value] = line.split(':', 2);
        // keep original key casing; trim whitespace
        properties[key.trim()] = (value ?? '').trim();
      }
    }
    
    return properties;
  }

  /**
   * Get basic file information as fallback
   */
  getBasicFileInfo(slidePath) {
    const stats = fs.statSync(slidePath);
    return {
      filename: path.basename(slidePath),
      size: stats.size,
      modified: stats.mtime.toISOString(),
      extension: path.extname(slidePath)
    };
  }

  /**
   * Load existing metadata for a slide
   */
  loadMetadata(baseName) {
    const metadataPath = path.join(this.metadataDir, `${baseName}_metadata.json`);
    
    if (fs.existsSync(metadataPath)) {
      try {
        const content = fs.readFileSync(metadataPath, 'utf8');
        return JSON.parse(content);
      } catch (error) {
        console.error(`Error loading metadata for ${baseName}: ${error.message}`);
        return null;
      }
    }
    
    return null;
  }

  /**
   * Check if metadata exists for a slide
   */
  hasMetadata(baseName) {
    const metadataPath = path.join(this.metadataDir, `${baseName}_metadata.json`);
    return fs.existsSync(metadataPath);
  }

  /**
   * Clean up metadata files for a slide
   */
  cleanupMetadata(baseName) {
    const files = [
      `${baseName}_metadata.json`,
      `${baseName}.icc`,
      `${baseName}_label.jpg`,
      `${baseName}_macro.jpg`
    ];

    files.forEach(filename => {
      const filePath = path.join(this.metadataDir, filename);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`Cleaned up: ${filePath}`);
      }
    });
  }
}

module.exports = SlideMetadataExtractor;
