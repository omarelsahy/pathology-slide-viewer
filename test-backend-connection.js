#!/usr/bin/env node

/**
 * Quick test to check if backend server is accessible and what endpoints are available
 */

const fetch = require('node-fetch');

const BACKEND_URL = 'http://localhost:3102';

async function testBackendConnection() {
    console.log('🧪 Testing Backend Server Connection...');
    console.log(`Backend URL: ${BACKEND_URL}`);
    
    try {
        // Test basic connectivity
        console.log('\n1. Testing basic connectivity...');
        const healthResponse = await fetch(`${BACKEND_URL}/health`);
        console.log(`   Health endpoint: ${healthResponse.status} ${healthResponse.statusText}`);
        
        // Test slides endpoint
        console.log('\n2. Testing slides endpoint...');
        const slidesResponse = await fetch(`${BACKEND_URL}/api/slides`);
        console.log(`   Slides endpoint: ${slidesResponse.status} ${slidesResponse.statusText}`);
        
        if (slidesResponse.ok) {
            const slidesData = await slidesResponse.json();
            console.log(`   Slides found: ${Array.isArray(slidesData) ? slidesData.length : 'Unknown format'}`);
            if (Array.isArray(slidesData) && slidesData.length > 0) {
                console.log(`   First slide: ${slidesData[0].name || 'Unknown'}`);
            }
        }
        
        // Test pathology config endpoint
        console.log('\n3. Testing pathology configuration endpoint...');
        const configResponse = await fetch(`${BACKEND_URL}/api/pathology-config`);
        console.log(`   Pathology config endpoint: ${configResponse.status} ${configResponse.statusText}`);
        
        if (configResponse.ok) {
            const configData = await configResponse.json();
            console.log(`   Config loaded: ${configData.config ? 'Yes' : 'No'}`);
            console.log(`   Deployment mode: ${configData.config?.deployment?.mode || 'Unknown'}`);
        }
        
        // Test conversion servers endpoint
        console.log('\n4. Testing conversion servers endpoint...');
        const serversResponse = await fetch(`${BACKEND_URL}/api/conversion-servers`);
        console.log(`   Conversion servers endpoint: ${serversResponse.status} ${serversResponse.statusText}`);
        
        if (serversResponse.ok) {
            const serversData = await serversResponse.json();
            console.log(`   Registered servers: ${serversData.totalServers || 0}`);
        }
        
        console.log('\n✅ Backend connection test completed!');
        
    } catch (error) {
        console.error('\n❌ Backend connection test failed:', error.message);
        console.log('\n💡 Make sure the backend server is running with: npm run backend');
    }
}

// Run the test
testBackendConnection();
