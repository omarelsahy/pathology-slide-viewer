# Pathology Slide Viewer - Containerization Guide

This guide covers containerizing the Pathology Slide Viewer for cross-platform deployment on Windows and Linux systems.

## 🚀 Quick Start

### Prerequisites
- Docker Desktop (Windows/Mac) or Docker Engine (Linux)
- Docker Compose v2.0+
- 4GB+ RAM available for containers
- 10GB+ disk space for images and data

### Basic Deployment
```bash
# Clone and navigate to project
git clone <repository-url>
cd pathology-slide-viewer

# Create data directories
mkdir -p data/{slides,dzi,temp}

# Start all services
docker-compose up -d

# View logs
docker-compose logs -f backend
```

## 📋 Container Architecture

### Service Overview
- **Backend** (Port 3102): Main API, conversion coordination
- **Frontend** (Port 3104): Static file serving, web UI
- **Conversion Worker** (Port 3001): Dedicated slide processing
- **Redis** (Port 6379): Job queue and caching

### Resource Allocation
- **Backend**: 2GB RAM, 2 CPU cores
- **Worker**: 4GB RAM, 4 CPU cores (VIPS processing)
- **Frontend**: 512MB RAM, 1 CPU core
- **Redis**: 256MB RAM, 1 CPU core

## 🔧 Configuration

### Environment Variables
```bash
# Core settings
NODE_ENV=production
NODE_MODE=server
PORT=3102

# VIPS Performance (automatically optimized)
VIPS_CONCURRENCY=8          # Number of threads
VIPS_CACHE_MAX_MEMORY=1GB   # Memory limit
VIPS_NOVECTOR=0             # Enable vectorization

# Storage paths
SLIDES_DIR=/app/data/slides
DZI_DIR=/app/data/dzi
TEMP_DIR=/app/data/temp
```

### Volume Mounting
```yaml
volumes:
  # Data persistence
  - ./data/slides:/app/data/slides:ro  # Read-only slides
  - ./data/dzi:/app/data/dzi           # DZI output
  - ./data/temp:/app/data/temp         # Temporary files
  
  # Configuration
  - ./.env:/app/.env:ro
  - ./app-config.json:/app/app-config.json:ro
```

## 🏗️ Build Options

### 1. Standard Build
```bash
# Build all services
docker-compose build

# Build specific service
docker-compose build backend
```

### 2. Development Build
```bash
# Use development configuration
docker-compose -f docker-compose.yml -f docker-compose.dev.yml up

# Features:
# - Live code reload
# - Development dependencies
# - Verbose logging
# - Debug ports exposed
```

### 3. Production Build
```bash
# Optimized for production
docker-compose -f docker-compose.yml up -d

# Features:
# - Minimal image size
# - Security hardening
# - Health checks
# - Restart policies
```

## 🖥️ Platform-Specific Instructions

### Windows Deployment

#### Docker Desktop Setup
1. Install Docker Desktop for Windows
2. Enable WSL2 backend (recommended)
3. Allocate sufficient resources:
   - Memory: 8GB minimum
   - CPUs: 4+ cores
   - Disk: 20GB+

#### Windows-Specific Configuration
```bash
# Use Windows paths for volume mounting
volumes:
  - C:\PathologySlides:/app/data/slides:ro
  - C:\PathologyDZI:/app/data/dzi
```

#### PowerShell Commands
```powershell
# Create directories
New-Item -ItemType Directory -Force -Path "C:\PathologySlides"
New-Item -ItemType Directory -Force -Path "C:\PathologyDZI"

# Start services
docker-compose up -d

# Check status
docker-compose ps
```

### Linux Deployment

#### System Requirements
```bash
# Ubuntu/Debian
sudo apt update
sudo apt install docker.io docker-compose-plugin

# CentOS/RHEL
sudo yum install docker docker-compose

# Start Docker service
sudo systemctl start docker
sudo systemctl enable docker
```

#### Linux-Specific Configuration
```bash
# Set proper permissions
sudo chown -R 1000:1000 ./data
chmod -R 755 ./data

# Use absolute paths
volumes:
  - /opt/pathology/slides:/app/data/slides:ro
  - /opt/pathology/dzi:/app/data/dzi
```

## 🔍 Monitoring and Troubleshooting

### Health Checks
```bash
# Check service health
docker-compose ps

# View detailed health status
docker inspect pathology-backend --format='{{.State.Health.Status}}'

# Manual health check
curl http://localhost:3102/api/health
```

### Performance Monitoring
```bash
# Container resource usage
docker stats

# VIPS performance logs
docker-compose logs backend | grep "VIPS"

# Conversion progress
docker-compose logs conversion-worker-1
```

### Common Issues

#### VIPS Not Found
```bash
# Check VIPS installation in container
docker-compose exec backend vips --version

# Rebuild with VIPS debug
docker-compose build --no-cache backend
```

#### Permission Errors
```bash
# Fix file permissions
sudo chown -R 1000:1000 ./data
chmod -R 755 ./data

# Check container user
docker-compose exec backend id
```

#### Memory Issues
```bash
# Increase container memory limits
# Edit docker-compose.yml:
deploy:
  resources:
    limits:
      memory: 8G
```

## 🚀 Scaling and Production

### Horizontal Scaling
```bash
# Scale conversion workers
docker-compose up -d --scale conversion-worker=3

# Load balancer configuration
# Add nginx or traefik for load balancing
```

### Production Optimizations
```yaml
# docker-compose.prod.yml
services:
  backend:
    deploy:
      replicas: 2
      resources:
        limits:
          memory: 4G
          cpus: '2.0'
        reservations:
          memory: 2G
          cpus: '1.0'
    restart: unless-stopped
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
```

### Security Hardening
```dockerfile
# Use non-root user
USER appuser

# Read-only filesystem
read_only: true
tmpfs:
  - /tmp
  - /app/data/temp

# Security options
security_opt:
  - no-new-privileges:true
cap_drop:
  - ALL
cap_add:
  - CHOWN
  - SETGID
  - SETUID
```

## 📊 Performance Benchmarks

### Expected Performance
- **Small slides** (< 100MB): 30-60 seconds
- **Medium slides** (100MB-1GB): 1-5 minutes  
- **Large slides** (1GB+): 5-15 minutes

### Optimization Tips
1. **Use SSD storage** for data volumes
2. **Allocate sufficient RAM** (8GB+ recommended)
3. **Enable VIPS vectorization** (VIPS_NOVECTOR=0)
4. **Scale workers** based on CPU cores
5. **Use Redis** for job queuing in multi-worker setups

## 🔄 Backup and Migration

### Data Backup
```bash
# Backup DZI files
docker run --rm -v pathology_dzi:/data -v $(pwd):/backup alpine tar czf /backup/dzi-backup.tar.gz /data

# Backup configuration
cp .env app-config.json docker-compose.yml backup/
```

### Migration Between Systems
```bash
# Export images
docker save pathology-slide-viewer:latest | gzip > pathology-app.tar.gz

# Import on new system
gunzip -c pathology-app.tar.gz | docker load

# Restore data
docker run --rm -v pathology_dzi:/data -v $(pwd):/backup alpine tar xzf /backup/dzi-backup.tar.gz -C /
```

## 📝 Alternative Containerization Options

### 1. Podman (Docker alternative)
```bash
# Install Podman
sudo apt install podman

# Use podman-compose
pip install podman-compose
podman-compose up -d
```

### 2. Singularity/Apptainer (HPC environments)
```bash
# Convert Docker image to Singularity
singularity build pathology.sif docker://pathology-slide-viewer:latest

# Run container
singularity run pathology.sif
```

### 3. LXC/LXD (System containers)
```bash
# Create LXD container
lxc launch ubuntu:22.04 pathology-viewer
lxc exec pathology-viewer -- bash

# Install application inside container
# ... (manual installation steps)
```

This containerization approach provides a robust, scalable, and cross-platform solution for deploying your pathology slide viewer while maintaining the performance optimizations you've achieved.
