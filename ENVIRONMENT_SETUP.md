# Environment Configuration Guide

This project supports separate configurations for **development (laptop)** and **production (server)** environments.

## 📁 Environment Files

| File | Purpose | Tracked in Git |
|------|---------|----------------|
| `.env` | **Active configuration** used by the app | ❌ No (local only) |
| `.env.development.example` | Template for laptop development | ✅ Yes |
| `.env.production.example` | Template for production server | ✅ Yes |
| `.env.example` | Legacy example file | ✅ Yes |

---

## 🚀 Quick Start

### **For Development (Laptop)**

1. **Copy the development template:**
   ```bash
   npm run env:dev
   ```
   Or manually:
   ```bash
   copy .env.development.example .env
   ```

2. **Customize paths** in `.env` for your laptop:
   ```env
   SLIDES_DIR=C:\Users\YourUsername\Documents\Pathology Slides\SVS
   DZI_DIR=C:\Users\YourUsername\Documents\Pathology Slides\DZI
   TEMP_DIR=C:\Users\YourUsername\Documents\Pathology Slides\Temp
   ```

3. **Start the app:**
   ```bash
   npm run electron:dev
   ```

### **For Production (Server)**

1. **Copy the production template:**
   ```bash
   npm run env:prod
   ```
   Or manually:
   ```bash
   copy .env.production.example .env
   ```

2. **Customize paths** in `.env` for your server:
   ```env
   SLIDES_DIR=/mnt/pathology/slides
   DZI_DIR=/mnt/pathology/dzi
   TEMP_DIR=/tmp/pathology
   ```

3. **Start the services:**
   ```bash
   npm run all
   ```

---

## ⚙️ Configuration Differences

### **Development Settings (32GB RAM Laptop)**
- **VIPS Threads**: 12 (safe for 8-thread CPU)
- **VIPS Memory**: 12GB
- **VIPS Cache**: 2GB
- **Node Heap**: 3GB per process
- **Max Concurrent**: 4 conversions
- **Total Memory**: ~23GB / 32GB

**Performance**: 20-30 minutes for 2GB+ SVS files

### **Production Settings (64GB+ RAM Server)**
- **VIPS Threads**: 36 (optimized for 16+ cores)
- **VIPS Memory**: 45GB
- **VIPS Cache**: 10GB
- **Node Heap**: 4GB per process
- **Max Concurrent**: 8 conversions
- **Total Memory**: ~67GB / 64GB+

**Performance**: 8-11 minutes for 2GB+ SVS files

---

## 🔧 NPM Scripts

| Command | Description |
|---------|-------------|
| `npm run env:dev` | Switch to development environment |
| `npm run env:prod` | Switch to production environment |
| `npm run env:status` | Check current environment |
| `npm run config` | Show full configuration summary |

---

## 📝 Best Practices

### **On Your Laptop (Development)**
1. Always use `.env.development.example` as your base
2. Keep `.env` in `.gitignore` (already configured)
3. Never commit your local `.env` file

### **On Production Server**
1. Copy `.env.production.example` to `.env` on the server
2. Customize paths for server storage locations
3. Verify hardware specs match the aggressive settings

### **When Deploying Updates**
1. **Push code changes** to git (without `.env`)
2. **On server**: Pull latest code
3. **On server**: `.env` remains unchanged (server settings preserved)
4. **On laptop**: Your `.env` remains unchanged (laptop settings preserved)

---

## 🎯 Deployment Workflow

```bash
# On Laptop (Development)
git add .
git commit -m "feat: add new feature"
git push origin main

# On Server (Production)
git pull origin main
npm install  # if dependencies changed
npm run all  # restart services (uses existing .env with production settings)
```

Your `.env` files are **never overwritten** during git pull because they're gitignored!

---

## ⚠️ Troubleshooting

### **"Out of memory" errors on laptop**
- You're using production settings on a laptop
- Run: `npm run env:dev` to switch to laptop settings

### **Slow conversions on server**
- You might be using development settings on the server
- Run: `npm run env:prod` to switch to server settings

### **Check current environment**
```bash
npm run env:status
npm run config
```

---

## 📊 Hardware Requirements

### **Minimum (Development)**
- 16GB RAM
- 4 cores / 8 threads
- SSD storage

### **Recommended (Production)**
- 64GB+ RAM
- 16+ cores / 32+ threads
- NVMe SSD or RAID array
- Dedicated pathology server

---

**Questions?** Check the main README.md or CONFIGURATION_GUIDE.md
