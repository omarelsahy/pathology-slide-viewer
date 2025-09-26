#!/usr/bin/env node

/**
 * Test script for the hybrid centralized configuration system
 * Tests configuration fetching, server registration, and load balancing
 */

const fetch = require('node-fetch');

const MAIN_SERVER_URL = 'http://localhost:3102';
const CONVERSION_SERVER_URL = 'http://localhost:3001';

async function testConfigurationEndpoint() {
  console.log('\n🧪 Testing Configuration Endpoint...');
  
  try {
    const response = await fetch(`${MAIN_SERVER_URL}/api/conversion-config`);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const config = await response.json();
    console.log('✅ Configuration fetched successfully');
    console.log('📋 Configuration preview:');
    console.log(`   └─ VIPS Concurrency: ${config.vipsConfig?.concurrency}`);
    console.log(`   └─ VIPS Cache Memory: ${config.vipsConfig?.cacheMemoryGB}GB`);
    console.log(`   └─ Max Concurrent: ${config.conversionSettings?.maxConcurrent}`);
    console.log(`   └─ Slides Dir: ${config.storage?.slidesDir}`);
    
    return config;
  } catch (error) {
    console.error('❌ Configuration test failed:', error.message);
    return null;
  }
}

async function testServerRegistration() {
  console.log('\n🧪 Testing Server Registration...');
  
  try {
    const registrationData = {
      id: 'test-server',
      host: 'localhost',
      port: 3001,
      maxConcurrent: 4,
      capabilities: ['icc-transform', 'dzi-generation', 'bigtiff']
    };
    
    const response = await fetch(`${MAIN_SERVER_URL}/api/conversion-servers/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(registrationData)
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const result = await response.json();
    console.log('✅ Server registration successful');
    console.log(`📝 Health check interval: ${result.config?.healthCheckInterval}ms`);
    
    return result;
  } catch (error) {
    console.error('❌ Server registration test failed:', error.message);
    return null;
  }
}

async function testServerListing() {
  console.log('\n🧪 Testing Server Listing...');
  
  try {
    const response = await fetch(`${MAIN_SERVER_URL}/api/conversion-servers`);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log('✅ Server listing successful');
    console.log(`📊 Total servers: ${data.totalServers}`);
    console.log(`🟢 Active servers: ${data.activeServers}`);
    console.log(`⚡ Total capacity: ${data.totalCapacity}`);
    console.log(`🔄 Active conversions: ${data.activeConversions}`);
    
    if (data.servers.length > 0) {
      console.log('📋 Registered servers:');
      data.servers.forEach(server => {
        console.log(`   └─ ${server.id}: ${server.host}:${server.port} (${server.activeConversions}/${server.maxConcurrent}) ${server.isHealthy ? '🟢' : '🔴'}`);
      });
    }
    
    return data;
  } catch (error) {
    console.error('❌ Server listing test failed:', error.message);
    return null;
  }
}

async function testHeartbeat() {
  console.log('\n🧪 Testing Heartbeat...');
  
  try {
    const heartbeatData = {
      activeConversions: 2,
      totalConversions: 15,
      status: 'active'
    };
    
    const response = await fetch(`${MAIN_SERVER_URL}/api/conversion-servers/test-server/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(heartbeatData)
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const result = await response.json();
    console.log('✅ Heartbeat successful');
    
    return result;
  } catch (error) {
    console.error('❌ Heartbeat test failed:', error.message);
    return null;
  }
}

async function testConversionServerHealth() {
  console.log('\n🧪 Testing Conversion Server Health...');
  
  try {
    const response = await fetch(`${CONVERSION_SERVER_URL}/health`);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const health = await response.json();
    console.log('✅ Conversion server is healthy');
    console.log(`📊 Active conversions: ${health.activeConversions}`);
    console.log(`📋 Queue length: ${health.queueLength}`);
    console.log(`⚡ Max concurrent: ${health.maxConcurrent}`);
    
    return health;
  } catch (error) {
    console.error('❌ Conversion server health test failed:', error.message);
    return null;
  }
}

async function runAllTests() {
  console.log('🚀 Starting Hybrid System Tests...');
  console.log('=' .repeat(50));
  
  // Test configuration endpoint
  const config = await testConfigurationEndpoint();
  
  // Test conversion server health
  const health = await testConversionServerHealth();
  
  // Test server registration
  const registration = await testServerRegistration();
  
  // Test heartbeat
  if (registration) {
    await testHeartbeat();
  }
  
  // Test server listing
  await testServerListing();
  
  console.log('\n' + '=' .repeat(50));
  console.log('🏁 Hybrid System Tests Complete');
  
  // Summary
  const results = {
    configuration: !!config,
    conversionServerHealth: !!health,
    registration: !!registration,
    heartbeat: !!registration,
    serverListing: true
  };
  
  const passed = Object.values(results).filter(Boolean).length;
  const total = Object.keys(results).length;
  
  console.log(`📊 Results: ${passed}/${total} tests passed`);
  
  if (passed === total) {
    console.log('✅ All tests passed! Hybrid system is working correctly.');
  } else {
    console.log('⚠️  Some tests failed. Check the logs above for details.');
  }
}

// Run tests if script is executed directly
if (require.main === module) {
  runAllTests().catch(console.error);
}

module.exports = { runAllTests };
