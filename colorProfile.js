// Color Profile Management Module
// Handles ICC profile extraction, validation, and color space management for pathology slides

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

class ColorProfileManager {
  constructor(config) {
    this.config = config;
    this.profilesDir = path.join(config.dziDir, 'profiles');
    this.standardProfiles = {
      sRGB: 'sRGB IEC61966-2.1',
      adobeRGB: 'Adobe RGB (1998)',
      prophotoRGB: 'ProPhoto RGB',
      pathologyStandard: 'Pathology Standard RGB'
    };
    
    this.ensureProfilesDirectory();
  }

  ensureProfilesDirectory() {
    if (!fs.existsSync(this.profilesDir)) {
      fs.mkdirSync(this.profilesDir, { recursive: true });
      console.log(`Created color profiles directory: ${this.profilesDir}`);
    }
  }

  /**
   * Extract ICC color profile from a slide file
   * @param {string} inputPath - Path to the slide file
   * @param {string} baseName - Base name for output files
   * @returns {Promise<Object>} Profile information
   */
  async extractProfile(inputPath, baseName) {
    return new Promise(async (resolve, reject) => {
      const profilePath = path.join(this.profilesDir, `${baseName}.icc`);
      const metadataPath = path.join(this.profilesDir, `${baseName}_profile.json`);
      
      console.log(`\n=== COLOR PROFILE EXTRACTION ===`);
      console.log(`Input: ${path.basename(inputPath)}`);
      console.log(`Profile output: ${profilePath}`);
      console.log(`===============================\n`);

      // Try multiple methods to detect color profiles
      let profileDetected = false;
      let profileInfo = null;

      // Method 1: VIPS icc_export
      try {
        await this.tryVipsIccExtraction(inputPath, profilePath);
        profileDetected = true;
        console.log(`✓ VIPS icc_export successful for ${path.basename(inputPath)}`);
      } catch (error) {
        console.log(`✗ VIPS icc_export failed: ${error.message}`);
        
        // Check if the error indicates a profile exists but has issues
        if (error.message.includes('profile does not support') || 
            error.message.includes('no output profile') ||
            error.message.includes('fallback to suggested')) {
          console.log(`ℹ️  ICC profile detected but has compatibility issues`);
          profileInfo = {
            hasEmbeddedProfile: true,
            hasCompatibilityIssues: true,
            colorSpace: 'RGB', // Assume RGB for pathology slides
            description: 'ICC profile present but incompatible with VIPS export',
            detectionMethod: 'vips_warning_analysis',
            compatibilityIssue: 'Profile does not support relative output intent'
          };
        }
      }

      // Method 2: Check VIPS image properties for color space info
      if (!profileDetected) {
        try {
          const colorSpaceInfo = await this.getVipsColorSpaceInfo(inputPath);
          console.log(`VIPS color space info:`, colorSpaceInfo);
          
          // Even without extractable ICC profile, we can get useful color space information
          profileInfo = {
            hasEmbeddedProfile: false,
            hasColorSpaceInfo: true,
            colorSpace: colorSpaceInfo.interpretation || 'RGB',
            bands: colorSpaceInfo.bands,
            description: `${colorSpaceInfo.interpretation || 'RGB'} color space (${colorSpaceInfo.bands} bands)`,
            detectionMethod: 'vips_properties',
            vipsInfo: colorSpaceInfo
          };
        } catch (error) {
          console.log(`✗ VIPS color space detection failed: ${error.message}`);
        }
      }

      // Method 3: Use exiftool if available (common for medical imaging)
      if (!profileDetected) {
        try {
          const exifInfo = await this.tryExifToolExtraction(inputPath);
          if (exifInfo.colorProfile) {
            console.log(`✓ ExifTool detected color profile information`);
            profileInfo = {
              hasEmbeddedProfile: false,
              hasColorSpaceInfo: true,
              colorSpace: exifInfo.colorSpace || 'RGB',
              description: exifInfo.colorProfile,
              detectionMethod: 'exiftool',
              exifInfo: exifInfo
            };
          }
        } catch (error) {
          console.log(`✗ ExifTool detection failed: ${error.message}`);
        }
      }

      // Create final metadata
      const metadata = profileInfo ? {
        ...profileInfo,
        profilePath: profileDetected ? profilePath : null,
        recommendedProfile: this.standardProfiles.sRGB,
        extractedAt: new Date().toISOString(),
        fileInfo: {
          baseName,
          originalFile: inputPath
        }
      } : {
        hasEmbeddedProfile: false,
        hasColorSpaceInfo: false,
        profilePath: null,
        colorSpace: 'unknown',
        description: 'No color profile detected',
        detectionMethod: 'none',
        recommendedProfile: this.standardProfiles.sRGB,
        extractedAt: new Date().toISOString(),
        fileInfo: {
          baseName,
          originalFile: inputPath
        }
      };

      // Save metadata
      fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
      
      console.log(`Color profile analysis completed for ${baseName}`);
      console.log(`Detection method: ${metadata.detectionMethod}`);
      console.log(`Color space: ${metadata.colorSpace}`);
      
      resolve(metadata);
    });
  }

  /**
   * Try VIPS ICC extraction
   */
  async tryVipsIccExtraction(inputPath, profilePath) {
    return new Promise((resolve, reject) => {
      const extractCommand = `vips icc_export "${inputPath}" "${profilePath}"`;
      
      exec(extractCommand, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`VIPS icc_export failed: ${error.message}`));
          return;
        }
        
        // Check if profile file was actually created and has content
        if (fs.existsSync(profilePath)) {
          const stats = fs.statSync(profilePath);
          if (stats.size > 0) {
            resolve(true);
          } else {
            fs.unlinkSync(profilePath); // Remove empty file
            reject(new Error('Empty profile file created'));
          }
        } else {
          reject(new Error('Profile file not created'));
        }
      });
    });
  }

  /**
   * Get color space information from VIPS
   */
  async getVipsColorSpaceInfo(inputPath) {
    return new Promise((resolve, reject) => {
      // Try different VIPS command formats based on version
      const commands = [
        `vips copy "${inputPath}" /dev/null 2>&1 | head -10`,
        `vips --list | head -1 && vips copy "${inputPath}" /dev/null`,
        `vips dzsave --help | head -1`
      ];
      
      this.tryVipsCommands(commands, inputPath)
        .then(stdout => {
          // Parse VIPS header output
          const info = {};
          const lines = stdout.split('\n');
          
          lines.forEach(line => {
            if (line.includes('interpretation:') || line.includes('Interpretation:')) {
              info.interpretation = line.split(':')[1].trim();
            }
            if (line.includes('bands:') || line.includes('Bands:')) {
              info.bands = parseInt(line.split(':')[1].trim());
            }
            if (line.includes('coding:') || line.includes('Coding:')) {
              info.coding = line.split(':')[1].trim();
            }
            if (line.includes('width:') || line.includes('Width:')) {
              info.width = parseInt(line.split(':')[1].trim());
            }
            if (line.includes('height:') || line.includes('Height:')) {
              info.height = parseInt(line.split(':')[1].trim());
            }
          });
          
          resolve(info);
        })
        .catch(reject);
    });
  }

  /**
   * Try multiple VIPS commands until one works
   */
  async tryVipsCommands(commands, inputPath) {
    for (const command of commands) {
      try {
        const result = await this.execCommand(command);
        return result;
      } catch (error) {
        console.log(`Command failed: ${command.split(' ')[1]} - ${error.message}`);
        continue;
      }
    }
    throw new Error('All VIPS header commands failed');
  }

  /**
   * Execute a command and return stdout
   */
  async execCommand(command) {
    return new Promise((resolve, reject) => {
      exec(command, (error, stdout, stderr) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(stdout);
      });
    });
  }

  /**
   * Try ExifTool for color profile detection
   */
  async tryExifToolExtraction(inputPath) {
    return new Promise((resolve, reject) => {
      const exifCommand = `exiftool -ColorSpace -ICC_Profile -WhitePoint -ColorMode "${inputPath}"`;
      
      exec(exifCommand, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`ExifTool failed: ${error.message}`));
          return;
        }
        
        const info = {};
        const lines = stdout.split('\n');
        
        lines.forEach(line => {
          if (line.includes('Color Space')) {
            info.colorSpace = line.split(':')[1]?.trim();
          }
          if (line.includes('ICC Profile')) {
            info.colorProfile = line.split(':')[1]?.trim();
          }
          if (line.includes('White Point')) {
            info.whitePoint = line.split(':')[1]?.trim();
          }
        });
        
        resolve(info);
      });
    });
  }

  /**
   * Analyze an ICC profile to extract metadata
   * @param {string} profilePath - Path to the ICC profile file
   * @param {string} baseName - Base name for the slide
   * @returns {Promise<Object>} Profile analysis
   */
  async analyzeProfile(profilePath, baseName) {
    return new Promise((resolve, reject) => {
      // Use VIPS to get profile information
      const infoCommand = `vips icc_import "${profilePath}" temp_analysis.tif`;
      
      exec(infoCommand, (error, stdout, stderr) => {
        // Clean up temp file if created
        const tempFile = 'temp_analysis.tif';
        if (fs.existsSync(tempFile)) {
          fs.unlinkSync(tempFile);
        }

        if (error) {
          console.warn(`Could not analyze ICC profile for ${baseName}: ${error.message}`);
          resolve({
            colorSpace: 'RGB',
            description: 'Unknown ICC Profile',
            isValid: false,
            analysisError: error.message
          });
          return;
        }

        // Get profile stats
        const stats = fs.statSync(profilePath);
        
        resolve({
          colorSpace: 'RGB', // Default assumption for pathology slides
          description: 'Extracted ICC Profile',
          isValid: true,
          fileSize: stats.size,
          profileType: 'display', // Most pathology slides use display profiles
          recommendedFor: 'pathology_viewing'
        });
      });
    });
  }

  /**
   * Apply color profile correction during DZI conversion
   * @param {string} inputPath - Input slide path
   * @param {string} outputPath - Output DZI path
   * @param {Object} options - Conversion options
   * @returns {string} Modified VIPS command with color management
   */
  getColorManagedCommand(inputPath, outputPath, options = {}) {
    const {
      tileSize = 256,
      overlap = 1,
      quality = 90,
      targetProfile = 'sRGB',
      preserveProfile = true
    } = options;

    // For slides with problematic ICC profiles, we need to apply color correction
    // Use a two-step process: convert to sRGB first, then create DZI
    const tempPath = `${outputPath}_temp_srgb.tif`;
    
    // Step 1: Convert to sRGB color space to normalize colors
    const colorConvertCommand = `vips icc_transform "${inputPath}" "${tempPath}" sRGB.icc`;
    
    // Step 2: Create DZI from color-corrected image
    const dziCommand = `vips dzsave "${tempPath}" "${outputPath}"`;
    dziCommand += ` --layout dz`;
    dziCommand += ` --suffix .jpg[Q=${quality}]`;
    dziCommand += ` --overlap ${overlap}`;
    dziCommand += ` --tile-size ${tileSize}`;
    
    // Return combined command with cleanup
    return `${colorConvertCommand} && ${dziCommand} && del "${tempPath}"`;
  }

  /**
   * Get fallback command when color management fails
   */
  getFallbackCommand(inputPath, outputPath, options = {}) {
    const {
      tileSize = 256,
      overlap = 1,
      quality = 90
    } = options;

    // Standard VIPS command without color management
    let command = `vips dzsave "${inputPath}" "${outputPath}"`;
    command += ` --layout dz`;
    command += ` --suffix .jpg[Q=${quality}]`;
    command += ` --overlap ${overlap}`;
    command += ` --tile-size ${tileSize}`;
    
    return command;
  }

  /**
   * Get color profile metadata for a slide
   * @param {string} baseName - Base name of the slide
   * @returns {Object|null} Profile metadata or null if not found
   */
  getProfileMetadata(baseName) {
    const metadataPath = path.join(this.profilesDir, `${baseName}_profile.json`);
    
    if (!fs.existsSync(metadataPath)) {
      return null;
    }
    
    try {
      const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
      return metadata;
    } catch (error) {
      console.error(`Error reading profile metadata for ${baseName}:`, error);
      return null;
    }
  }

  /**
   * List all available color profiles
   * @returns {Array} List of profile metadata
   */
  listProfiles() {
    if (!fs.existsSync(this.profilesDir)) {
      return [];
    }

    const profiles = [];
    const files = fs.readdirSync(this.profilesDir);
    
    files
      .filter(file => file.endsWith('_profile.json'))
      .forEach(file => {
        try {
          const metadata = JSON.parse(fs.readFileSync(path.join(this.profilesDir, file), 'utf8'));
          profiles.push(metadata);
        } catch (error) {
          console.error(`Error reading profile metadata from ${file}:`, error);
        }
      });
    
    return profiles;
  }

  /**
   * Get standard pathology color profiles
   * @returns {Object} Standard profiles configuration
   */
  getStandardProfiles() {
    return {
      profiles: this.standardProfiles,
      recommendations: {
        brightfield: this.standardProfiles.sRGB,
        fluorescence: this.standardProfiles.adobeRGB,
        darkfield: this.standardProfiles.prophotoRGB,
        general: this.standardProfiles.sRGB
      },
      description: 'Standard color profiles recommended for pathology slide viewing'
    };
  }

  /**
   * Validate color profile consistency across slides
   * @param {Array} slideNames - Array of slide base names to check
   * @returns {Object} Validation report
   */
  validateProfileConsistency(slideNames) {
    const profiles = slideNames.map(name => this.getProfileMetadata(name)).filter(Boolean);
    
    if (profiles.length === 0) {
      return { consistent: true, message: 'No profiles to validate' };
    }

    const colorSpaces = [...new Set(profiles.map(p => p.colorSpace))];
    const hasEmbedded = profiles.filter(p => p.hasEmbeddedProfile).length;
    const noEmbedded = profiles.length - hasEmbedded;

    return {
      consistent: colorSpaces.length === 1,
      colorSpaces,
      profileStats: {
        total: profiles.length,
        withEmbedded: hasEmbedded,
        withoutEmbedded: noEmbedded,
        percentage: Math.round((hasEmbedded / profiles.length) * 100)
      },
      recommendations: this.generateRecommendations(profiles)
    };
  }

  /**
   * Generate color management recommendations
   * @param {Array} profiles - Array of profile metadata
   * @returns {Array} Recommendations
   */
  generateRecommendations(profiles) {
    const recommendations = [];
    
    const withoutProfiles = profiles.filter(p => !p.hasEmbeddedProfile).length;
    if (withoutProfiles > 0) {
      recommendations.push({
        type: 'warning',
        message: `${withoutProfiles} slides lack embedded color profiles`,
        action: 'Consider applying standard pathology color profile'
      });
    }

    const colorSpaces = [...new Set(profiles.map(p => p.colorSpace))];
    if (colorSpaces.length > 1) {
      recommendations.push({
        type: 'info',
        message: 'Multiple color spaces detected',
        action: 'Ensure consistent viewing conditions across slides'
      });
    }

    return recommendations;
  }

  /**
   * Clean up old profile files
   * @param {number} maxAge - Maximum age in days
   * @returns {number} Number of files cleaned up
   */
  cleanupOldProfiles(maxAge = 30) {
    if (!fs.existsSync(this.profilesDir)) {
      return 0;
    }

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - maxAge);
    
    let cleanedCount = 0;
    const files = fs.readdirSync(this.profilesDir);
    
    files.forEach(file => {
      const filePath = path.join(this.profilesDir, file);
      const stats = fs.statSync(filePath);
      
      if (stats.mtime < cutoffDate) {
        fs.unlinkSync(filePath);
        cleanedCount++;
        console.log(`Cleaned up old profile file: ${file}`);
      }
    });
    
    return cleanedCount;
  }
}

module.exports = ColorProfileManager;
