/**
 * Client-Side ICC Color Transform for OpenSeadragon
 * Applies color correction using WebGL shaders for real-time performance
 */

class ICCColorFilter {
  constructor(viewer, options = {}) {
    this.viewer = viewer;
    this.enabled = true;
    this.iccProfile = null;
    this.colorMatrix = null;
    this.canvas = null;
    this.gl = null;
    this.program = null;
    this.originalDrawer = null;
    
    // Configuration
    this.options = {
      fallbackToCSS: true,
      debugMode: false,
      ...options
    };
    
    this.init();
  }
  
  async init() {
    try {
      // Check WebGL support
      if (!this.checkWebGLSupport()) {
        console.warn('WebGL not supported, falling back to CSS filters');
        if (this.options.fallbackToCSS) {
          this.initCSSFallback();
        }
        return;
      }
      
      console.log('✅ WebGL supported - initializing ICC color filter');
      await this.initWebGL();
      
    } catch (error) {
      console.error('ICC Color Filter initialization failed:', error);
      if (this.options.fallbackToCSS) {
        this.initCSSFallback();
      }
    }
  }
  
  checkWebGLSupport() {
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      return !!gl;
    } catch (e) {
      return false;
    }
  }
  
  async initWebGL() {
    console.log('🎨 Initializing WebGL ICC color filter');
    
    try {
      // Find the OpenSeadragon canvas for reference
      let osdCanvas = null;
      if (this.viewer.canvas && this.viewer.canvas.getContext) {
        osdCanvas = this.viewer.canvas;
      } else if (this.viewer.container) {
        osdCanvas = this.viewer.container.querySelector('canvas');
      } else if (this.viewer.drawer && this.viewer.drawer.canvas) {
        osdCanvas = this.viewer.drawer.canvas;
      }
      
      if (!osdCanvas) {
        console.warn('OpenSeadragon canvas not found, falling back to CSS');
        this.initCSSFallback();
        return;
      }
      
      console.log('✅ Found OpenSeadragon canvas, creating WebGL overlay');
      
      // Create a separate WebGL canvas overlay (don't interfere with OSD)
      this.webglCanvas = document.createElement('canvas');
      this.webglCanvas.style.position = 'absolute';
      this.webglCanvas.style.top = '0';
      this.webglCanvas.style.left = '0';
      this.webglCanvas.style.width = '100%';
      this.webglCanvas.style.height = '100%';
      this.webglCanvas.style.pointerEvents = 'none'; // Critical: don't block mouse events
      this.webglCanvas.style.zIndex = '1'; // Low z-index to stay below UI controls
      this.webglCanvas.style.userSelect = 'none';
      this.webglCanvas.style.touchAction = 'none';
      this.webglCanvas.style.display = this.enabled ? 'block' : 'none';
      
      // Add overlay to viewer container
      this.viewer.container.appendChild(this.webglCanvas);
      
      // Get WebGL context on our overlay canvas
      this.gl = this.webglCanvas.getContext('webgl', { 
        alpha: true, 
        premultipliedAlpha: false,
        preserveDrawingBuffer: true 
      }) || this.webglCanvas.getContext('experimental-webgl', { 
        alpha: true, 
        premultipliedAlpha: false,
        preserveDrawingBuffer: true 
      });
      
      if (!this.gl) {
        console.warn('Failed to get WebGL context, falling back to CSS');
        this.initCSSFallback();
        return;
      }
      
      // Store reference to OSD canvas for reading pixels
      this.osdCanvas = osdCanvas;
      
      // Initialize WebGL program for ICC processing
      await this.createShaderProgram();
      
      // Hook into OpenSeadragon's rendering pipeline
      this.hookRenderingPipeline();
      
      console.log('✅ WebGL ICC color filter initialized with overlay');
      
    } catch (error) {
      console.error('WebGL initialization failed:', error);
      this.initCSSFallback();
    }
  }
  
  applyCanvasFilter() {
    // Find the actual canvas element
    let canvas = null;
    if (this.viewer.canvas && this.viewer.canvas.style) {
      canvas = this.viewer.canvas;
    } else if (this.viewer.container) {
      canvas = this.viewer.container.querySelector('canvas');
    } else if (this.viewer.drawer && this.viewer.drawer.canvas) {
      canvas = this.viewer.drawer.canvas;
    }
    
    if (canvas && canvas.style) {
      // CSS filters to match Aperio ImageScope ICC correction
      // Balanced approach: boost vibrancy while maintaining natural tones
      canvas.style.filter = this.enabled ? 
        'brightness(1.02) contrast(1.12) saturate(1.08) hue-rotate(2deg)' : 
        'none';
    }
  }
  
  async createShaderProgram() {
    const gl = this.gl;
    
    // Vertex shader (simple pass-through)
    const vertexShaderSource = `
      attribute vec2 a_position;
      attribute vec2 a_texCoord;
      varying vec2 v_texCoord;
      
      void main() {
        gl_Position = vec4(a_position, 0.0, 1.0);
        v_texCoord = a_texCoord;
      }
    `;
    
    // Fragment shader (color transformation)
    const fragmentShaderSource = `
      precision mediump float;
      
      uniform sampler2D u_image;
      uniform mat3 u_colorMatrix;
      uniform vec3 u_gamma;
      uniform bool u_enabled;
      varying vec2 v_texCoord;
      
      void main() {
        vec4 color = texture2D(u_image, v_texCoord);
        
        if (u_enabled) {
          // Apply ICC color matrix transformation
          vec3 transformed = u_colorMatrix * color.rgb;
          
          // Apply gamma correction
          transformed = pow(max(transformed, vec3(0.0)), u_gamma);
          
          gl_FragColor = vec4(transformed, color.a);
        } else {
          // Pass through unchanged
          gl_FragColor = color;
        }
      }
    `;
    
    // Compile shaders
    const vertexShader = this.compileShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
    const fragmentShader = this.compileShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
    
    // Create and link program
    this.program = gl.createProgram();
    gl.attachShader(this.program, vertexShader);
    gl.attachShader(this.program, fragmentShader);
    gl.linkProgram(this.program);
    
    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
      throw new Error('Failed to link shader program: ' + gl.getProgramInfoLog(this.program));
    }
    
    // Get uniform and attribute locations
    this.locations = {
      position: gl.getAttribLocation(this.program, 'a_position'),
      texCoord: gl.getAttribLocation(this.program, 'a_texCoord'),
      image: gl.getUniformLocation(this.program, 'u_image'),
      colorMatrix: gl.getUniformLocation(this.program, 'u_colorMatrix'),
      gamma: gl.getUniformLocation(this.program, 'u_gamma'),
      enabled: gl.getUniformLocation(this.program, 'u_enabled')
    };
    
    // Create buffers
    this.createBuffers();
  }
  
  compileShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const error = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(`Shader compilation failed: ${error}`);
    }
    
    return shader;
  }
  
  createBuffers() {
    const gl = this.gl;
    
    // Create vertex buffer (full screen quad)
    // Fix texture coordinates - flip Y axis to prevent upside-down image
    const positions = new Float32Array([
      -1, -1,  0, 1,  // bottom-left: flip Y from 0 to 1
       1, -1,  1, 1,  // bottom-right: flip Y from 0 to 1
      -1,  1,  0, 0,  // top-left: flip Y from 1 to 0
       1,  1,  1, 0   // top-right: flip Y from 1 to 0
    ]);
    
    this.positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
  }
  
  hookRenderingPipeline() {
    // Hook into OpenSeadragon's animation events
    this.viewer.addHandler('animation', () => {
      if (this.enabled && this.gl && this.colorMatrix) {
        this.processFrame();
      }
    });
    
    // Also hook into viewport change events
    this.viewer.addHandler('viewport-change', () => {
      if (this.enabled && this.gl && this.colorMatrix) {
        this.processFrame();
      }
    });
    
    // Initial render
    if (this.enabled && this.gl && this.colorMatrix) {
      this.processFrame();
    }
  }
  
  processFrame() {
    if (!this.gl || !this.osdCanvas || !this.webglCanvas) return;
    
    const gl = this.gl;
    
    // Resize WebGL canvas to match OpenSeadragon canvas
    const rect = this.osdCanvas.getBoundingClientRect();
    if (this.webglCanvas.width !== rect.width || this.webglCanvas.height !== rect.height) {
      this.webglCanvas.width = rect.width;
      this.webglCanvas.height = rect.height;
      gl.viewport(0, 0, rect.width, rect.height);
    }
    
    // Create texture from OpenSeadragon canvas
    if (!this.sourceTexture) {
      this.sourceTexture = gl.createTexture();
    }
    
    gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.osdCanvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    
    // Apply ICC color transformation
    this.applyColorTransform();
  }
  
  applyColorTransform() {
    if (!this.gl || !this.program || !this.colorMatrix || !this.sourceTexture) return;
    
    const gl = this.gl;
    
    // Clear the WebGL canvas
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    
    // Use shader program
    gl.useProgram(this.program);
    
    // Bind the source texture (from OpenSeadragon canvas)
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
    gl.uniform1i(this.locations.image, 0);
    
    // Set up vertex attributes
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.enableVertexAttribArray(this.locations.position);
    gl.vertexAttribPointer(this.locations.position, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(this.locations.texCoord);
    gl.vertexAttribPointer(this.locations.texCoord, 2, gl.FLOAT, false, 16, 8);
    
    // Set ICC transformation uniforms
    gl.uniformMatrix3fv(this.locations.colorMatrix, false, this.colorMatrix);
    gl.uniform3fv(this.locations.gamma, this.gamma || [1.0, 1.0, 1.0]);
    gl.uniform1i(this.locations.enabled, this.enabled ? 1 : 0);
    
    // Enable blending for overlay
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    
    // Draw the transformed image
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  
  initCSSFallback() {
    console.log('🎨 Initializing CSS filter fallback');
    this.useCSS = true;
    
    // Apply the canvas filter using the robust method
    this.applyCanvasFilter();
  }
  
  async loadICCProfile(profileData) {
    if (!profileData) {
      console.warn('No ICC profile data provided');
      return;
    }
    
    try {
      console.log('📊 Parsing ICC profile data...');
      
      // Parse the real ICC profile using our parser
      const parser = new window.ICCParser(profileData);
      const result = parser.parse();
      
      if (result && result.matrix) {
        // Use the REAL transformation matrix from the ICC profile
        this.colorMatrix = parser.getTransformationMatrix();
        this.gamma = parser.getGammaValues();
        
        console.log('✅ ICC profile parsed successfully');
        console.log('🎨 Transformation matrix:', this.colorMatrix);
        console.log('📈 Gamma curves:', this.gamma);
        
        // Store for reference
        this.iccProfile = result;
        
        // If using WebGL, process a frame to apply the transformation
        if (this.gl && this.colorMatrix && this.enabled) {
          this.processFrame();
        }
        
      } else {
        console.warn('⚠️ Failed to extract ICC transformation data, using fallback');
        this.useFallbackMatrix();
      }
      
    } catch (error) {
      console.error('❌ Failed to parse ICC profile:', error);
      console.warn('Using fallback color transformation');
      this.useFallbackMatrix();
    }
  }
  
  /**
   * Fallback to generic Aperio transformation if ICC parsing fails
   */
  useFallbackMatrix() {
    // Generic Aperio transformation as backup
    this.colorMatrix = new Float32Array([
      1.02, -0.02, 0.03,
      -0.01, 1.08, 0.02,
      0.03, 0.02, 1.12
    ]);
    this.gamma = [1.0, 1.0, 1.0];
    console.warn('⚠️ Using generic fallback transformation matrix');
  }
  
  toggle() {
    this.enabled = !this.enabled;
    
    if (this.gl && this.colorMatrix && this.webglCanvas) {
      // Show/hide WebGL overlay and process frame
      this.webglCanvas.style.display = this.enabled ? 'block' : 'none';
      if (this.enabled) {
        this.processFrame();
      }
    } else if (this.useCSS) {
      // Fall back to CSS filters
      this.applyCanvasFilter();
    }
    
    console.log(`ICC color filter ${this.enabled ? 'enabled' : 'disabled'} (${this.gl ? 'WebGL' : 'CSS'})`);
    return this.enabled;
  }
  
  setEnabled(enabled) {
    this.enabled = enabled;
    this.toggle();
  }
  
  destroy() {
    // Clean up WebGL overlay
    if (this.webglCanvas && this.webglCanvas.parentNode) {
      this.webglCanvas.parentNode.removeChild(this.webglCanvas);
    }
    
    // Clean up old canvas (if any)
    if (this.canvas && this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas);
    }
    
    // Clean up WebGL resources
    if (this.gl) {
      if (this.program) this.gl.deleteProgram(this.program);
      if (this.positionBuffer) this.gl.deleteBuffer(this.positionBuffer);
      if (this.sourceTexture) this.gl.deleteTexture(this.sourceTexture);
    }
    
    // Clean up CSS filters
    if (this.useCSS && this.osdCanvas) {
      this.osdCanvas.style.filter = 'none';
    }
    
    console.log('ICC color filter destroyed');
  }
}

// Export for use in main.js
window.ICCColorFilter = ICCColorFilter;
