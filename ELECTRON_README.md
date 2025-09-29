# Pathology Slide Viewer - Desktop Application

## Overview
This Electron desktop application consolidates the pathology slide viewer, server management, and terminal output into a single, unified interface. No more juggling multiple browser tabs!

## Features

### 🖥️ **Unified Interface**
- **Main Panel**: Embedded slide viewer (web interface)
- **Sidebar**: Server management and file controls
- **Terminal**: Real-time server logs with filtering

### 🔧 **Server Management**
- Start/stop/restart backend, frontend, and conversion servers
- Real-time server status indicators
- Automatic server startup when app launches

### 📁 **File Management**
- Quick access to slides and DZI folders
- Recent slides list with click-to-open
- File system integration

### 📊 **Terminal & Logging**
- Tabbed terminal output (All, Backend, Frontend, Conversion)
- Real-time log streaming
- Error highlighting and filtering

## Getting Started

### Prerequisites
- Node.js installed
- All project dependencies installed (`npm install`)

### Running the Application

1. **Start the desktop app:**
   ```bash
   npm run electron
   ```

2. **Development mode** (auto-restart servers):
   ```bash
   npm run electron:dev
   ```

### Available Scripts

- `npm run electron` - Start the desktop application
- `npm run electron:dev` - Development mode with auto-restart
- `npm run electron:build` - Build distributable packages (requires setup)

## Application Layout

```
┌─────────────────────────────────────────────────────────────┐
│ Pathology Slide Viewer        [Backend] [Frontend] [Conv]   │
├─────────────┬───────────────────────────────────────────────┤
│ Server Mgmt │                                               │
│ ┌─────────┐ │                                               │
│ │Restart  │ │           Slide Viewer                        │
│ │Backend  │ │         (Embedded Web)                        │
│ └─────────┘ │                                               │
│             │                                               │
│ File Mgmt   │                                               │
│ ┌─────────┐ │                                               │
│ │Open     │ │                                               │
│ │Slides   │ │                                               │
│ └─────────┘ │                                               │
│             │                                               │
│ Recent      │                                               │
│ Files       │                                               │
├─────────────┴───────────────────────────────────────────────┤
│ Terminal: [All] [Backend] [Frontend] [Conversion]    [Clear]│
│ [10:30:15] Backend: Server started on port 3101            │
│ [10:30:16] Frontend: Server started on port 3102           │
│ [10:30:17] Conversion: Ready to process slides             │
└─────────────────────────────────────────────────────────────┘
```

## Server Architecture

The desktop app manages three separate Node.js processes:

1. **Backend Server** (Port 3101)
   - API endpoints
   - Slide conversion logic
   - WebSocket connections
   - File management

2. **Frontend Server** (Port 3102)
   - Static file serving
   - Web UI hosting
   - Embedded in Electron iframe

3. **Conversion Server** (Port 3001)
   - Dedicated slide processing
   - VIPS integration
   - Queue management

## Keyboard Shortcuts

- `Ctrl+R` / `F5` - Reload slide viewer
- `Ctrl+Shift+R` - Restart all servers
- `Ctrl+`` - Focus terminal
- `F12` - Toggle developer tools (development mode)

## Menu Options

### File Menu
- **Open Slides Folder** - Opens the slides directory in File Explorer
- **Open DZI Folder** - Opens the converted DZI directory
- **Exit** - Close the application

### Servers Menu
- **Restart Backend** - Restart the backend API server
- **Restart Frontend** - Restart the frontend web server
- **Restart Conversion** - Restart the conversion processing server

### View Menu
- Standard Electron view options (zoom, reload, dev tools)

## Troubleshooting

### Port Conflicts
If you see "EADDRINUSE" errors:
1. Close any existing Node.js processes
2. Restart the Electron app
3. Check that ports 3101, 3102, and 3001 are available

### Server Not Starting
1. Check the terminal output for specific error messages
2. Ensure all dependencies are installed (`npm install`)
3. Verify VIPS is properly installed on your system

### Slide Viewer Not Loading
1. Wait for all servers to start (green status indicators)
2. Check that the frontend server is running on port 3102
3. Try reloading the slide viewer (`Ctrl+R`)

## Development

### Adding Features
- **Main Process**: Edit `electron-main.js` for app-level functionality
- **Renderer Process**: Edit `electron-renderer.js` and `electron-renderer.html` for UI
- **Styling**: CSS is embedded in the HTML file

### IPC Communication
The app uses Electron's IPC (Inter-Process Communication) for:
- Server status monitoring
- Server restart commands
- File system operations
- Log message streaming

## Building for Distribution

To create distributable packages:

```bash
npm run electron:build
```

This requires additional configuration in `package.json` for electron-builder.

## Benefits Over Web Interface

1. **No Browser Tab Management** - Everything in one window
2. **Integrated Server Management** - Start/stop servers without terminal
3. **Real-time Monitoring** - Live server logs and status
4. **File System Integration** - Direct folder access
5. **Desktop Integration** - Native menus and shortcuts
6. **Always Available** - No need to remember URLs or ports

## Next Steps

- Add slide thumbnail previews in sidebar
- Implement conversion progress bars
- Add system tray integration
- Create auto-updater functionality
- Add slide annotation tools
- Implement batch processing interface
