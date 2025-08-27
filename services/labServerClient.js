const fetch = require('node-fetch');
const path = require('path');

class LabServerClient {
  constructor(config) {
    this.baseUrl = config.labServer.url;
    this.apiKey = config.labServer.apiKey;
    this.timeout = config.labServer.timeout;
    this.retryAttempts = config.labServer.retryAttempts;
    this.apiVersion = config.apiVersion;
  }

  // Helper method to build API URLs
  getApiUrl(endpoint) {
    return `${this.baseUrl}/api/${this.apiVersion}${endpoint}`;
  }

  // Helper method to make authenticated requests
  async makeRequest(endpoint, options = {}) {
    const url = this.getApiUrl(endpoint);
    const headers = {
      'Content-Type': 'application/json',
      'X-API-Key': this.apiKey,
      ...options.headers
    };

    const requestOptions = {
      timeout: this.timeout,
      headers,
      ...options
    };

    let lastError;
    for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
      try {
        const response = await fetch(url, requestOptions);
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        return response;
      } catch (error) {
        lastError = error;
        console.warn(`Lab server request attempt ${attempt}/${this.retryAttempts} failed:`, error.message);
        
        if (attempt < this.retryAttempts) {
          // Wait before retry (exponential backoff)
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
      }
    }
    
    throw new Error(`Lab server unavailable after ${this.retryAttempts} attempts: ${lastError.message}`);
  }

  // Get list of slides from lab server
  async getSlides() {
    try {
      const response = await this.makeRequest('/slides');
      return await response.json();
    } catch (error) {
      console.error('Failed to fetch slides from lab server:', error.message);
      throw error;
    }
  }

  // Trigger slide conversion on lab server
  async convertSlide(filename) {
    try {
      const response = await this.makeRequest(`/slides/convert/${encodeURIComponent(filename)}`, {
        method: 'POST'
      });
      return await response.json();
    } catch (error) {
      console.error(`Failed to trigger conversion for ${filename}:`, error.message);
      throw error;
    }
  }

  // Get conversion status
  async getConversionStatus(filename) {
    try {
      const response = await this.makeRequest(`/slides/${encodeURIComponent(filename)}/status`);
      return await response.json();
    } catch (error) {
      console.error(`Failed to get status for ${filename}:`, error.message);
      throw error;
    }
  }

  // Stream DZI tile from lab server
  async streamDziTile(tilePath) {
    try {
      const response = await this.makeRequest(`/dzi/${tilePath}`, {
        headers: {
          'Accept': 'image/jpeg,image/png,*/*'
        }
      });
      return response.body; // Return readable stream
    } catch (error) {
      console.error(`Failed to stream DZI tile ${tilePath}:`, error.message);
      throw error;
    }
  }

  // Get lab server status and health
  async getServerStatus() {
    try {
      const response = await this.makeRequest('/system/status');
      return await response.json();
    } catch (error) {
      console.error('Failed to get lab server status:', error.message);
      throw error;
    }
  }

  // Control auto-processor on lab server
  async enableAutoProcessor() {
    try {
      const response = await this.makeRequest('/auto-processor/enable', {
        method: 'POST'
      });
      return await response.json();
    } catch (error) {
      console.error('Failed to enable auto-processor:', error.message);
      throw error;
    }
  }

  async disableAutoProcessor() {
    try {
      const response = await this.makeRequest('/auto-processor/disable', {
        method: 'POST'
      });
      return await response.json();
    } catch (error) {
      console.error('Failed to disable auto-processor:', error.message);
      throw error;
    }
  }

  async getAutoProcessorStatus() {
    try {
      const response = await this.makeRequest('/auto-processor/status');
      return await response.json();
    } catch (error) {
      console.error('Failed to get auto-processor status:', error.message);
      throw error;
    }
  }

  // Test connection to lab server
  async testConnection() {
    try {
      const startTime = Date.now();
      await this.getServerStatus();
      const responseTime = Date.now() - startTime;
      
      return {
        connected: true,
        responseTime,
        url: this.baseUrl
      };
    } catch (error) {
      return {
        connected: false,
        error: error.message,
        url: this.baseUrl
      };
    }
  }
}

module.exports = LabServerClient;
