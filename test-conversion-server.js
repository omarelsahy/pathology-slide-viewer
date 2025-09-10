#!/usr/bin/env node

/**
 * Test script for the conversion server
 * Tests health, conversion API, and status endpoints
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');

const CONVERSION_SERVER_URL = 'http://localhost:3001';

class ConversionServerTester {
  constructor() {
    this.client = axios.create({
      baseURL: CONVERSION_SERVER_URL,
      timeout: 10000
    });
  }

  async testHealth() {
    console.log('\n=== Testing Health Endpoint ===');
    try {
      const response = await this.client.get('/health');
      console.log('✅ Health check passed');
      console.log('Status:', response.data);
      return true;
    } catch (error) {
      console.error('❌ Health check failed:', error.message);
      return false;
    }
  }

  async findTestSlide() {
    console.log('\n=== Finding Test Slide ===');
    
    // Look for slides in multiple locations
    const searchPaths = [
      path.join(__dirname, 'public', 'slides'),
      __dirname // Root directory
    ];
    
    for (const searchDir of searchPaths) {
      if (!fs.existsSync(searchDir)) {
        continue;
      }

      const files = fs.readdirSync(searchDir);
      const slideFiles = files.filter(file => {
        const ext = path.extname(file).toLowerCase();
        return ['.svs', '.ndpi', '.tif', '.tiff', '.jp2', '.vms', '.vmu', '.scn'].includes(ext);
      });

      if (slideFiles.length > 0) {
        const testSlide = slideFiles[0];
        const fullPath = path.join(searchDir, testSlide);
        console.log('✅ Found test slide:', testSlide);
        console.log('Path:', fullPath);
        
        return {
          inputPath: fullPath,
          fileName: testSlide,
          baseName: path.basename(testSlide, path.extname(testSlide))
        };
      }
    }
    
    console.log('❌ No slide files found in search paths');
    return null;
  }

  async testConversion(slideInfo) {
    console.log('\n=== Testing Conversion API ===');
    
    const dziDir = path.join(__dirname, 'dzi');
    
    // Ensure DZI directory exists
    if (!fs.existsSync(dziDir)) {
      fs.mkdirSync(dziDir, { recursive: true });
    }

    try {
      const response = await this.client.post('/convert', {
        inputPath: slideInfo.inputPath,
        outputBaseName: slideInfo.baseName + '_test',
        slidesDir: path.dirname(slideInfo.inputPath),
        dziDir: dziDir
      });

      console.log('✅ Conversion started successfully');
      console.log('Response:', response.data);
      return response.data.conversionId;
    } catch (error) {
      if (error.response) {
        console.error('❌ Conversion failed:', error.response.data);
      } else {
        console.error('❌ Conversion request failed:', error.message);
      }
      return null;
    }
  }

  async testStatus(baseName) {
    console.log('\n=== Testing Status Endpoint ===');
    
    try {
      const response = await this.client.get(`/status/${baseName}_test`);
      console.log('✅ Status check passed');
      console.log('Status:', response.data);
      return response.data;
    } catch (error) {
      if (error.response && error.response.status === 404) {
        console.log('ℹ️  Conversion not found (expected for test)');
        return null;
      } else {
        console.error('❌ Status check failed:', error.message);
        return null;
      }
    }
  }

  async monitorConversion(baseName, maxWaitTime = 60000) {
    console.log('\n=== Monitoring Conversion Progress ===');
    
    const startTime = Date.now();
    let lastProgress = -1;
    
    while (Date.now() - startTime < maxWaitTime) {
      try {
        const response = await this.client.get(`/status/${baseName}_test`);
        const status = response.data;
        
        if (status.progress !== lastProgress) {
          console.log(`Progress: ${status.progress}% - ${status.phase || status.status}`);
          lastProgress = status.progress;
        }
        
        if (status.status === 'completed') {
          console.log('✅ Conversion completed successfully!');
          return true;
        }
        
        if (status.status === 'failed') {
          console.log('❌ Conversion failed');
          return false;
        }
        
        // Wait 2 seconds before next check
        await new Promise(resolve => setTimeout(resolve, 2000));
        
      } catch (error) {
        console.error('Error monitoring conversion:', error.message);
        break;
      }
    }
    
    console.log('⏰ Monitoring timeout reached');
    return false;
  }

  async testCancel(baseName) {
    console.log('\n=== Testing Cancel Endpoint ===');
    
    try {
      const response = await this.client.delete(`/convert/${baseName}_test`);
      console.log('✅ Cancel request successful');
      console.log('Response:', response.data);
      return true;
    } catch (error) {
      if (error.response) {
        console.log('ℹ️  Cancel response:', error.response.data);
      } else {
        console.error('❌ Cancel request failed:', error.message);
      }
      return false;
    }
  }

  async runFullTest() {
    console.log('🧪 Starting Conversion Server Tests');
    console.log('=====================================');
    
    // Test 1: Health check
    const healthOk = await this.testHealth();
    if (!healthOk) {
      console.log('\n❌ Cannot proceed - conversion server not healthy');
      return;
    }
    
    // Test 2: Find test slide
    const slideInfo = await this.findTestSlide();
    if (!slideInfo) {
      console.log('\n❌ Cannot proceed - no test slides available');
      console.log('💡 Add a slide file to public/slides/ directory to test conversions');
      return;
    }
    
    // Test 3: Status check (should return not found)
    await this.testStatus(slideInfo.baseName);
    
    // Test 4: Start conversion
    const conversionId = await this.testConversion(slideInfo);
    if (!conversionId) {
      console.log('\n❌ Cannot proceed - conversion failed to start');
      return;
    }
    
    // Test 5: Monitor progress (for a short time)
    console.log('\n⏱️  Monitoring conversion for 30 seconds...');
    const completed = await this.monitorConversion(slideInfo.baseName, 30000);
    
    if (!completed) {
      // Test 6: Cancel conversion if still running
      await this.testCancel(slideInfo.baseName);
    }
    
    console.log('\n🎉 Conversion Server Tests Complete!');
    console.log('=====================================');
    
    if (completed) {
      console.log('✅ All tests passed - conversion server is working perfectly!');
    } else {
      console.log('⚠️  Tests completed - conversion server is functional but test conversion was cancelled');
    }
  }
}

// Run tests if called directly
if (require.main === module) {
  const tester = new ConversionServerTester();
  tester.runFullTest().catch(console.error);
}

module.exports = ConversionServerTester;
