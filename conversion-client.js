/**
 * Conversion Client - Interface to the dedicated conversion server
 * Handles communication between main server and conversion server
 */

const axios = require('axios');
const EventEmitter = require('events');

class ConversionClient extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.conversionServerUrl = options.url || 'http://localhost:3001';
    this.pollInterval = options.pollInterval || 1000; // Poll every second
    this.activePolling = new Map(); // Track active polling for conversions
    this.activeConversions = new Map(); // Track conversion metadata
    this.timeout = options.timeout || 30000; // 30 second timeout for requests
    
    // Create axios instance with timeout
    this.client = axios.create({
      baseURL: this.conversionServerUrl,
      timeout: this.timeout,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }

  /**
   * Check if conversion server is available
   */
  async isAvailable() {
    try {
      const response = await this.client.get('/health');
      return response.status === 200;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get conversion server health status
   */
  async getHealth() {
    try {
      const response = await this.client.get('/health');
      return response.data;
    } catch (error) {
      throw new Error(`Conversion server unavailable: ${error.message}`);
    }
  }

  /**
   * Start a new conversion
   */
  async startConversion(inputPath, outputBaseName, slidesDir, dziDir) {
    try {
      const response = await this.client.post('/convert', {
        inputPath,
        outputBaseName,
        slidesDir,
        dziDir
      });
      
      if (response.data.success) {
        // Store conversion info for completion callback
        this.activeConversions.set(outputBaseName, {
          inputPath,
          outputBaseName,
          slidesDir,
          dziDir,
          filePath: inputPath
        });
        
        // Start polling for progress
        this.startProgressPolling(outputBaseName);
        
        return {
          success: true,
          conversionId: response.data.conversionId,
          queuePosition: response.data.queuePosition
        };
      } else {
        throw new Error(response.data.error || 'Conversion failed to start');
      }
    } catch (error) {
      if (error.response) {
        throw new Error(error.response.data.error || 'Conversion server error');
      } else {
        throw new Error(`Failed to start conversion: ${error.message}`);
      }
    }
  }

  /**
   * Get conversion status
   */
  async getConversionStatus(basename) {
    try {
      const response = await this.client.get(`/status/${basename}`);
      return response.data;
    } catch (error) {
      if (error.response && error.response.status === 404) {
        return { status: 'not_found' };
      }
      throw new Error(`Failed to get status: ${error.message}`);
    }
  }

  /**
   * Cancel a conversion
   */
  async cancelConversion(basename) {
    try {
      const response = await this.client.delete(`/convert/${basename}`);
      
      // Stop polling if active
      this.stopProgressPolling(basename);
      
      return response.data;
    } catch (error) {
      if (error.response) {
        throw new Error(error.response.data.error || 'Failed to cancel conversion');
      } else {
        throw new Error(`Failed to cancel conversion: ${error.message}`);
      }
    }
  }

  /**
   * Start polling for conversion progress
   */
  startProgressPolling(basename) {
    if (this.activePolling.has(basename)) {
      return; // Already polling
    }

    console.log(`Starting progress polling for: ${basename}`);
    
    const pollFunction = async () => {
      try {
        const status = await this.getConversionStatus(basename);
        
        // Emit progress event
        this.emit('conversionProgress', {
          fileName: basename,
          filename: basename,
          baseName: basename,
          phase: status.phase,
          percent: status.progress,
          ...status
        });

        // Check if conversion is complete
        if (status.status === 'completed') {
          console.log(`Conversion completed: ${basename}`);
          this.emit('conversionCompleted', {
            filename: basename,
            fileName: basename,
            baseName: basename,
            filePath: this.activeConversions.get(basename)?.filePath,
            success: true
          });
          this.stopProgressPolling(basename);
          // Clean up conversion tracking
          this.activeConversions.delete(basename);
          return;
        }
        
        if (status.status === 'failed' || status.status === 'cancelled') {
          console.log(`Conversion ${status.status}: ${basename}`);
          this.emit('conversionError', {
            filename: basename,
            error: status.error || `Conversion ${status.status}`
          });
          this.stopProgressPolling(basename);
          // Clean up conversion tracking
          this.activeConversions.delete(basename);
          return;
        }
        
        // Continue polling if still processing or queued
        if (status.status === 'processing' || status.status === 'queued') {
          const timeoutId = setTimeout(pollFunction, this.pollInterval);
          this.activePolling.set(basename, timeoutId);
        }
        
      } catch (error) {
        console.error(`Error polling conversion status for ${basename}:`, error.message);
        
        // Emit error and stop polling
        this.emit('conversionError', {
          filename: basename,
          error: error.message
        });
        this.stopProgressPolling(basename);
      }
    };

    // Start initial poll
    const timeoutId = setTimeout(pollFunction, 100); // Start almost immediately
    this.activePolling.set(basename, timeoutId);
  }

  /**
   * Stop polling for conversion progress
   */
  stopProgressPolling(basename) {
    const timeoutId = this.activePolling.get(basename);
    if (timeoutId) {
      clearTimeout(timeoutId);
      this.activePolling.delete(basename);
      console.log(`Stopped progress polling for: ${basename}`);
    }
  }

  /**
   * Stop all active polling
   */
  stopAllPolling() {
    console.log(`Stopping ${this.activePolling.size} active polling operations`);
    for (const [basename, timeoutId] of this.activePolling) {
      clearTimeout(timeoutId);
    }
    this.activePolling.clear();
  }

  /**
   * Get list of currently polling conversions
   */
  getActivePolling() {
    return Array.from(this.activePolling.keys());
  }

  /**
   * Batch conversion status check
   */
  async getBatchStatus(basenames) {
    const results = {};
    
    // Use Promise.allSettled to get all results even if some fail
    const promises = basenames.map(async (basename) => {
      try {
        const status = await this.getConversionStatus(basename);
        return { basename, status };
      } catch (error) {
        return { basename, status: { status: 'error', error: error.message } };
      }
    });
    
    const settled = await Promise.allSettled(promises);
    
    settled.forEach((result) => {
      if (result.status === 'fulfilled') {
        results[result.value.basename] = result.value.status;
      }
    });
    
    return results;
  }

  /**
   * Wait for conversion to complete (with timeout)
   */
  async waitForCompletion(basename, maxWaitTime = 300000) { // 5 minutes default
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      
      const checkStatus = async () => {
        try {
          const status = await this.getConversionStatus(basename);
          
          if (status.status === 'completed') {
            resolve(status);
            return;
          }
          
          if (status.status === 'failed' || status.status === 'cancelled') {
            reject(new Error(status.error || `Conversion ${status.status}`));
            return;
          }
          
          // Check timeout
          if (Date.now() - startTime > maxWaitTime) {
            reject(new Error('Conversion timeout'));
            return;
          }
          
          // Continue waiting
          setTimeout(checkStatus, this.pollInterval);
          
        } catch (error) {
          reject(error);
        }
      };
      
      checkStatus();
    });
  }
}

module.exports = ConversionClient;
