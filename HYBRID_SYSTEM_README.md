# 🏗️ Hybrid Centralized Configuration System

## Overview

The hybrid system provides centralized configuration management while maintaining distributed conversion processing capabilities. This allows you to run conversion servers on multiple physical machines while managing all configuration from a single source.

## 🎯 Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Main Server   │    │ Conversion       │    │ Conversion      │
│   (Port 3102)   │◄──►│ Server #1        │    │ Server #2       │
│                 │    │ (Port 3001)      │    │ (Port 3001)     │
│ • Configuration │    │                  │    │                 │
│ • Load Balancer │    │ • Config Fetch   │    │ • Config Fetch  │
│ • Service       │    │ • Registration   │    │ • Registration  │
│   Registry      │    │ • Heartbeat      │    │ • Heartbeat     │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         │                       │                       │
         └───────────────────────┼───────────────────────┘
                                 │
                    ┌─────────────────┐
                    │ Centralized     │
                    │ Configuration   │
                    │ (JSON File)     │
                    └─────────────────┘
```

## 📋 Configuration File

The system uses `pathology-config.json` as the single source of truth:

```json
{
  "deployment": {
    "mode": "distributed",
    "mainServer": {
      "port": 3102,
      "host": "0.0.0.0"
    }
  },
  "storage": {
    "slidesDir": "C:\\OG",
    "dziDir": "C:\\dzi",
    "tempDir": "C:\\temp"
  },
  "conversion": {
    "defaultConcurrency": 8,
    "vips": {
      "concurrency": 32,
      "cacheMemoryGB": 64,
      "quality": 95,
      "compression": "lzw"
    }
  },
  "conversionServers": {
    "autoDiscovery": true,
    "healthCheckInterval": 10000,
    "servers": [
      {
        "id": "local",
        "host": "localhost",
        "port": 3001,
        "autoStart": true
      }
    ]
  }
}
```

## 🚀 Getting Started

### 1. Start Main Server
```bash
npm run backend
```

### 2. Start Conversion Server(s)
```bash
# Local conversion server
npm run start:conversion-server

# Or start manually with custom config
node conversion-server.js --id=server1 --port=3001 --mainServerUrl=http://localhost:3102
```

### 3. Test the System
```bash
npm run test:hybrid
```

## 🔧 Key Features

### ✅ Centralized Configuration
- **Single source of truth** - All settings in `pathology-config.json`
- **Dynamic updates** - Configuration changes propagate to all servers
- **Environment-aware** - Adapts to system resources automatically

### ✅ Service Discovery
- **Auto-registration** - Conversion servers register themselves on startup
- **Health monitoring** - Continuous heartbeat and status tracking
- **Load balancing** - Intelligent work distribution based on server load

### ✅ Distributed Processing
- **Multiple servers** - Run conversion servers on different machines
- **Horizontal scaling** - Add more servers as needed
- **Fault tolerance** - System continues if servers go offline

### ✅ Smart Load Balancing
- **Least loaded first** - Routes work to servers with lowest utilization
- **Capacity aware** - Respects each server's maximum concurrent limit
- **Health checking** - Only routes to healthy, responsive servers

## 📊 API Endpoints

### Configuration Management
- `GET /api/conversion-config` - Get centralized configuration
- `GET /api/conversion-servers` - List registered conversion servers

### Server Registration
- `POST /api/conversion-servers/register` - Register a conversion server
- `POST /api/conversion-servers/:id/heartbeat` - Send heartbeat

### Example Registration:
```javascript
POST /api/conversion-servers/register
{
  "id": "conversion-server-1",
  "host": "192.168.1.100",
  "port": 3001,
  "maxConcurrent": 8,
  "capabilities": ["icc-transform", "dzi-generation", "bigtiff"]
}
```

## 🔍 Monitoring

### Server Status
```bash
curl http://localhost:3102/api/conversion-servers
```

Response:
```json
{
  "servers": [
    {
      "id": "local",
      "host": "localhost",
      "port": 3001,
      "maxConcurrent": 8,
      "activeConversions": 2,
      "totalConversions": 45,
      "status": "active",
      "isHealthy": true
    }
  ],
  "totalServers": 1,
  "activeServers": 1,
  "totalCapacity": 8,
  "activeConversions": 2
}
```

### Health Check
```bash
curl http://localhost:3001/health
```

## 🛠️ Configuration Options

### Deployment Modes
- **`single`** - All processing on main server
- **`distributed`** - Separate conversion servers

### VIPS Optimization
- **`concurrency`** - Number of threads for VIPS operations
- **`cacheMemoryGB`** - Memory allocated for VIPS cache
- **`quality`** - JPEG quality for tile generation
- **`compression`** - TIFF compression method

### Server Discovery
- **`autoDiscovery`** - Enable automatic server registration
- **`healthCheckInterval`** - Heartbeat frequency (ms)
- **`registrationTimeout`** - Server timeout threshold (ms)

## 🔧 Troubleshooting

### Conversion Server Won't Register
1. Check main server is running on correct port
2. Verify network connectivity between servers
3. Check firewall settings
4. Review server logs for connection errors

### Load Balancing Not Working
1. Ensure `deployment.mode` is set to `"distributed"`
2. Check multiple servers are registered and healthy
3. Verify servers have available capacity
4. Monitor server heartbeats

### Configuration Not Applied
1. Restart conversion servers to fetch new config
2. Check JSON syntax in `pathology-config.json`
3. Verify main server has read access to config file
4. Check server logs for configuration errors

## 📈 Performance Benefits

### Before (Single Server)
- ❌ Single point of failure
- ❌ Limited by one machine's resources
- ❌ Configuration scattered across files
- ❌ Manual server management

### After (Hybrid System)
- ✅ Distributed processing across multiple machines
- ✅ Centralized configuration management
- ✅ Automatic service discovery and load balancing
- ✅ Health monitoring and fault tolerance
- ✅ Horizontal scaling capabilities

## 🎉 Summary

The hybrid system provides the best of both worlds:
- **Centralized management** for easy configuration and monitoring
- **Distributed processing** for scalability and performance
- **Automatic discovery** for operational simplicity
- **Load balancing** for optimal resource utilization

This architecture supports your requirement for running conversion servers on separate physical machines while maintaining unified configuration and management through the main server.
