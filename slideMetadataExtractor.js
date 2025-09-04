// Slide Metadata Extraction Module
// Extracts ICC profiles, labels, and macro images from pathology slides

const fs = require('fs');
const path = require('path');
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
      // Extract slide properties using OpenSlide
      const properties = await this.extractSlideProperties(slidePath);
      metadata.properties = properties;

      // Extract ICC profile
      const iccPath = await this.extractICCProfile(slidePath, baseName);
      metadata.iccProfile = iccPath;

      // Extract label image
      const labelPath = await this.extractLabelImage(slidePath, baseName);
      metadata.label = labelPath;

      // Extract macro image
      const macroPath = await this.extractMacroImage(slidePath, baseName);
      metadata.macro = macroPath;

      // Save metadata to JSON file
      const metadataPath = path.join(this.metadataDir, `${baseName}_metadata.json`);
      fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
      
      console.log(`=== METADATA EXTRACTION COMPLETED ===`);
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
    return new Promise((resolve, reject) => {
      // Use VIPS to get basic slide info - just load and get basic properties
      const basicInfo = this.getBasicFileInfo(slidePath);
      
      // Try to get additional OpenSlide properties if available
      const command = `vips openslideload "${slidePath}" temp_props.tiff && del temp_props.tiff`;
      
      exec(command, (error, stdout, stderr) => {
        if (error) {
          console.warn(`Could not load slide with OpenSlide: ${error.message}`);
          resolve(basicInfo);
          return;
        }

        // If successful, we know it's a valid OpenSlide file
        basicInfo.openslideSupported = true;
        resolve(basicInfo);
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
      
      // Try to extract label using VIPS with correct syntax
      const extractCommand = `vips openslideload "${slidePath}" "${labelOutputPath}" --associated=label`;
      
      exec(extractCommand, (extractError) => {
        if (extractError || !fs.existsSync(labelOutputPath)) {
          console.log(`No label image found in ${path.basename(slidePath)}`);
          resolve(null);
        } else {
          console.log(`Label image extracted: ${labelOutputPath}`);
          resolve(labelOutputPath);
        }
      });
    });
  }

  /**
   * Extract macro image from slide using VIPS
   */
  async extractMacroImage(slidePath, baseName) {
    return new Promise((resolve) => {
      const macroOutputPath = path.join(this.metadataDir, `${baseName}_macro.jpg`);
      
      // Try to extract macro using VIPS with correct syntax
      const extractCommand = `vips openslideload "${slidePath}" "${macroOutputPath}" --associated=macro`;
      
      exec(extractCommand, (extractError) => {
        if (extractError || !fs.existsSync(macroOutputPath)) {
          console.log(`No macro image found in ${path.basename(slidePath)}`);
          resolve(null);
        } else {
          console.log(`Macro image extracted: ${macroOutputPath}`);
          resolve(macroOutputPath);
        }
      });
    });
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
        properties[key.trim()] = value.trim();
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
