/**
 * ICC Profile Parser for Client-Side Color Transformation
 * Parses ICC v2/v4 profiles and extracts transformation data
 * Critical for medical imaging color accuracy
 */

class ICCParser {
  constructor(profileData) {
    this.profileData = profileData;
    this.profile = null;
    this.matrix = null;
    this.curves = null;
  }

  /**
   * Parse the ICC profile binary data
   */
  parse() {
    try {
      console.log('🔍 Profile data type:', typeof this.profileData);
      console.log('🔍 Profile data length:', this.profileData?.length);
      
      // Decode base64 if needed
      let binaryData;
      if (typeof this.profileData === 'string') {
        console.log('🔍 Decoding base64 ICC profile...');
        // Remove any whitespace and decode base64
        const cleaned = this.profileData.replace(/\s/g, '');
        console.log('🔍 Cleaned string length:', cleaned.length);
        binaryData = this.base64ToArrayBuffer(cleaned);
        console.log('✅ Decoded to', binaryData.byteLength, 'bytes');
      } else {
        console.log('🔍 Using binary ICC profile data');
        binaryData = this.profileData;
      }

      const view = new DataView(binaryData);
      
      // Parse ICC header
      const header = this.parseHeader(view);
      console.log('📊 ICC Profile Header:', header);
      
      // Validate ICC signature
      if (header.signature !== 'acsp') {
        console.error('❌ Invalid ICC profile signature:', header.signature);
        return null;
      }
      
      // Parse tag table
      const tags = this.parseTagTable(view);
      console.log('📊 ICC Profile Tags:', Object.keys(tags).length, 'tags found');
      
      // Extract transformation data
      this.extractTransformationData(view, tags);
      
      return {
        matrix: this.matrix,
        curves: this.curves,
        header: header
      };
      
    } catch (error) {
      console.error('❌ Failed to parse ICC profile:', error);
      console.error('Error stack:', error.stack);
      return null;
    }
  }

  /**
   * Parse ICC profile header (first 128 bytes)
   */
  parseHeader(view) {
    return {
      size: view.getUint32(0),
      preferredCMMType: this.readString(view, 4, 4),
      version: {
        major: view.getUint8(8),
        minor: view.getUint8(9) >> 4,
        bugfix: view.getUint8(9) & 0x0F
      },
      deviceClass: this.readString(view, 12, 4),
      colorSpace: this.readString(view, 16, 4),
      pcs: this.readString(view, 20, 4), // Profile Connection Space
      creationDate: this.parseDateTime(view, 24),
      signature: this.readString(view, 36, 4),
      platform: this.readString(view, 40, 4),
      flags: view.getUint32(44),
      manufacturer: this.readString(view, 48, 4),
      model: this.readString(view, 52, 4),
      renderingIntent: view.getUint32(64)
    };
  }

  /**
   * Parse tag table
   */
  parseTagTable(view) {
    const tagCount = view.getUint32(128);
    const tags = {};
    
    for (let i = 0; i < tagCount; i++) {
      const offset = 132 + (i * 12);
      const signature = this.readString(view, offset, 4);
      const dataOffset = view.getUint32(offset + 4);
      const dataSize = view.getUint32(offset + 8);
      
      tags[signature] = {
        offset: dataOffset,
        size: dataSize
      };
    }
    
    return tags;
  }

  /**
   * Extract transformation matrices and curves
   */
  extractTransformationData(view, tags) {
    console.log('🔍 Available tags:', Object.keys(tags));
    
    // Extract RGB colorant tags (matrix columns)
    console.log('🔍 Looking for colorant tags: rXYZ, gXYZ, bXYZ');
    const rXYZ = this.parseXYZTag(view, tags.rXYZ);
    const gXYZ = this.parseXYZTag(view, tags.gXYZ);
    const bXYZ = this.parseXYZTag(view, tags.bXYZ);
    
    console.log('🔍 Colorants extracted:', { rXYZ, gXYZ, bXYZ });
    
    if (rXYZ && gXYZ && bXYZ) {
      // Build transformation matrix from colorants
      // This is the ICC → XYZ matrix
      this.matrix = new Float32Array([
        rXYZ.X, gXYZ.X, bXYZ.X,
        rXYZ.Y, gXYZ.Y, bXYZ.Y,
        rXYZ.Z, gXYZ.Z, bXYZ.Z
      ]);
      
      console.log('✅ Extracted ICC transformation matrix:', this.matrix);
    } else {
      console.warn('⚠️ Missing colorant tags - rXYZ:', !!rXYZ, 'gXYZ:', !!gXYZ, 'bXYZ:', !!bXYZ);
    }
    
    // Extract tone reproduction curves (gamma)
    console.log('🔍 Looking for TRC tags: rTRC, gTRC, bTRC');
    const rTRC = this.parseCurveTag(view, tags.rTRC);
    const gTRC = this.parseCurveTag(view, tags.gTRC);
    const bTRC = this.parseCurveTag(view, tags.bTRC);
    
    console.log('🔍 Curves extracted:', { rTRC, gTRC, bTRC });
    
    if (rTRC && gTRC && bTRC) {
      this.curves = {
        red: rTRC,
        green: gTRC,
        blue: bTRC
      };
      
      console.log('✅ Extracted ICC tone curves');
    } else {
      console.warn('⚠️ Missing TRC tags - rTRC:', !!rTRC, 'gTRC:', !!gTRC, 'bTRC:', !!bTRC);
    }
    
    // Extract white point
    if (tags.wtpt) {
      const whitePoint = this.parseXYZTag(view, tags.wtpt);
      console.log('✅ White Point:', whitePoint);
    }
  }

  /**
   * Parse XYZ tag (used for colorants and white point)
   */
  parseXYZTag(view, tag) {
    if (!tag) return null;
    
    const type = this.readString(view, tag.offset, 4);
    if (type !== 'XYZ ') return null;
    
    // XYZ values are stored as s15Fixed16Number (32-bit)
    const X = view.getInt32(tag.offset + 8) / 65536;
    const Y = view.getInt32(tag.offset + 12) / 65536;
    const Z = view.getInt32(tag.offset + 16) / 65536;
    
    return { X, Y, Z };
  }

  /**
   * Parse curve tag (tone reproduction curve)
   */
  parseCurveTag(view, tag) {
    if (!tag) return null;
    
    const type = this.readString(view, tag.offset, 4);
    
    if (type === 'curv') {
      // Curve type
      const count = view.getUint32(tag.offset + 8);
      
      if (count === 0) {
        // Linear curve (gamma = 1.0)
        return { type: 'linear', gamma: 1.0 };
      } else if (count === 1) {
        // Single gamma value
        const gamma = view.getUint16(tag.offset + 12) / 256;
        return { type: 'gamma', gamma: gamma };
      } else {
        // Full curve with LUT
        const curve = new Float32Array(count);
        for (let i = 0; i < count; i++) {
          curve[i] = view.getUint16(tag.offset + 12 + (i * 2)) / 65535;
        }
        return { type: 'lut', curve: curve };
      }
    } else if (type === 'para') {
      // Parametric curve
      const funcType = view.getUint16(tag.offset + 8);
      const gamma = view.getInt32(tag.offset + 12) / 65536;
      return { type: 'parametric', gamma: gamma, funcType: funcType };
    }
    
    return null;
  }

  /**
   * Helper: Read string from DataView
   */
  readString(view, offset, length) {
    let str = '';
    for (let i = 0; i < length; i++) {
      const char = view.getUint8(offset + i);
      if (char === 0) break;
      str += String.fromCharCode(char);
    }
    return str;
  }

  /**
   * Helper: Parse ICC date/time
   */
  parseDateTime(view, offset) {
    return {
      year: view.getUint16(offset),
      month: view.getUint16(offset + 2),
      day: view.getUint16(offset + 4),
      hours: view.getUint16(offset + 6),
      minutes: view.getUint16(offset + 8),
      seconds: view.getUint16(offset + 10)
    };
  }

  /**
   * Helper: Convert base64 to ArrayBuffer
   */
  base64ToArrayBuffer(base64) {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }

  /**
   * Convert ICC matrix to sRGB
   * This handles the full color space conversion
   */
  getTransformationMatrix() {
    if (!this.matrix) return null;
    
    // ICC matrix is typically device → XYZ
    // We need to convert XYZ → sRGB
    // sRGB inverse matrix (XYZ to linear RGB)
    const xyzToSrgb = new Float32Array([
       3.2406, -1.5372, -0.4986,
      -0.9689,  1.8758,  0.0415,
       0.0557, -0.2040,  1.0570
    ]);
    
    // Multiply ICC matrix with XYZ→sRGB matrix
    return this.multiplyMatrices(this.matrix, xyzToSrgb);
  }

  /**
   * Matrix multiplication helper
   */
  multiplyMatrices(a, b) {
    const result = new Float32Array(9);
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        result[i * 3 + j] = 
          a[i * 3 + 0] * b[0 * 3 + j] +
          a[i * 3 + 1] * b[1 * 3 + j] +
          a[i * 3 + 2] * b[2 * 3 + j];
      }
    }
    return result;
  }

  /**
   * Get gamma values from curves
   */
  getGammaValues() {
    if (!this.curves) return [1.0, 1.0, 1.0];
    
    return [
      this.curves.red.gamma || 1.0,
      this.curves.green.gamma || 1.0,
      this.curves.blue.gamma || 1.0
    ];
  }
}

// Export for use in other modules
window.ICCParser = ICCParser;
