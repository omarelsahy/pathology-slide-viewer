# Lab Deployment Guide

## Quick Setup for Lab Computer

### 1. Copy Files to Lab Computer
Copy the entire project folder to the lab computer.

### 2. Install Dependencies
```bash
cd pathology-slide-viewer
npm install
```

### 3. Configure Environment
1. Copy `.env.example` to `.env`
2. Edit `.env` file:
```
NODE_MODE=server
NODE_ENV=production
PORT=3000
LAB_API_KEY=your-secure-api-key-here
HOME_CLIENT_URL=http://your-home-ip:3000
```

### 4. Add Slides
Place your pathology slides in the `public/slides/` directory.
Supported formats: .svs, .ndpi, .tif, .tiff, .jp2, .vms, .vmu, .scn

### 5. Configure Windows Firewall
```powershell
# Run as Administrator
New-NetFirewallRule -DisplayName "Pathology Viewer" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow
```

### 6. Start Lab Server
```bash
# Option 1: Use the batch script
scripts\start-lab-server.bat

# Option 2: Manual start
set NODE_MODE=server
node server.js
```

### 7. Test Lab Server
Open browser to `http://localhost:3000` and verify:
- Slides are listed
- Auto-processor is running
- Conversion works

### 8. Network Access (if needed)
For remote access from home computer:
1. Configure router port forwarding (port 3000)
2. Update home computer's `.env` with lab's external IP
3. Test connection from home

## Troubleshooting

### Common Issues:
1. **Port 3000 already in use**: Change PORT in `.env`
2. **VIPS not found**: Run `install-vips.ps1` as Administrator
3. **Permission denied**: Run `defender-exclusions.ps1` as Administrator
4. **Network connection failed**: Check firewall and router settings

### Log Files:
- Server logs appear in console
- Check Windows Event Viewer for system errors
- Monitor CPU/memory usage during conversions
