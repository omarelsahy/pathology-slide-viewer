// Pathology Slide Viewer - GUI Main Process
// Electron main process for desktop GUI management interface

const path = require('path');
const fs = require('fs');
const { spawn, exec } = require('child_process');
require('dotenv').config(); // Load .env file

const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');

let mainWindow;
let serverProcess = null;
let guiConfig = {
  // Folder paths
  sourceDir: path.join(__dirname, 'public', 'slides'),
  destinationDir: path.join(__dirname, 'public', 'dzi'),
  
  // VIPS Configuration
  vipsSettings: {
    concurrency: require('os').cpus().length,
    maxMemoryMB: Math.floor(require('os').totalmem() / (1024 * 1024) * 0.4),
    bufferSizeMB: 512,
    discThresholdMB: 1024,
    cacheMaxMB: 512,
    
    // ICC Profile settings
    srgbProfilePath: '',
    autoDetectSrgb: true,
    colorTransform: 'auto',
    embedIcc: false,
    
    // VIPS Logging
    progress: true,
    info: true,
    warning: true,
    
    // Advanced VIPS options
    novector: false,
    sequential: true,
    tileSize: 256,
    overlap: 1,
    quality: 90,
    layout: 'dz',
    suffix: '.jpg'
  },
  
  // Server settings
  serverPort: 3000,
  autoStart: false
};

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true
    },
    icon: path.join(__dirname, 'assets', 'icon.png'), // Add icon if available
    title: 'Pathology Slide Viewer - Management Console'
  });

  mainWindow.loadFile('gui-renderer.html');
  
  // Open DevTools in development
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (serverProcess) {
      serverProcess.kill();
    }
  });
}

// App event handlers
app.whenReady().then(() => {
  createWindow();
  createMenu();
  // Configuration logging moved to separate ready handler below
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// IPC Handlers for GUI communication

// Configuration management
ipcMain.handle('get-config', () => {
  return guiConfig;
});

ipcMain.handle('save-config', (event, newConfig) => {
  guiConfig = { ...guiConfig, ...newConfig };
  saveConfigToFile();
  return { success: true };
});

// Folder selection
ipcMain.handle('select-folder', async (event, type) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: type === 'source' ? 'Select Source Folder (SVS, NDPI files)' : 'Select Destination Folder (DZI output)'
  });
  
  if (!result.canceled && result.filePaths.length > 0) {
    const selectedPath = result.filePaths[0];
    if (type === 'source') {
      guiConfig.sourceDir = selectedPath;
    } else {
      guiConfig.destinationDir = selectedPath;
    }
    saveConfigToFile();
    return { success: true, path: selectedPath };
  }
  
  return { success: false };
});

// ICC Profile selection
ipcMain.handle('select-icc-profile', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'ICC Profiles', extensions: ['icc', 'icm'] },
      { name: 'All Files', extensions: ['*'] }
    ],
    title: 'Select sRGB ICC Profile'
  });
  
  if (!result.canceled && result.filePaths.length > 0) {
    const selectedPath = result.filePaths[0];
    guiConfig.vipsSettings.srgbProfilePath = selectedPath;
    saveConfigToFile();
    return { success: true, path: selectedPath };
  }
  
  return { success: false };
});

// VIPS options discovery
ipcMain.handle('get-vips-info', async () => {
  return new Promise((resolve) => {
    exec('vips --help', (error, stdout, stderr) => {
      if (error) {
        resolve({ error: error.message });
        return;
      }
      
      exec('vips --vips-config', (configError, configStdout) => {
        resolve({
          help: stdout,
          config: configError ? 'Config not available' : configStdout,
          version: extractVipsVersion(stdout)
        });
      });
    });
  });
});

// Server management
ipcMain.handle('start-server', async () => {
  if (serverProcess) {
    return { success: false, message: 'Server already running' };
  }
  
  try {
    // Update environment with GUI settings
    // Note: .env values are already loaded, just pass through with overrides
    const env = {
      ...process.env,
      ...buildVipsEnvironment(),
      NODE_MODE: 'server',
      PORT: guiConfig.serverPort.toString(),
      SLIDES_DIR: guiConfig.sourceDir,
      DZI_DIR: guiConfig.destinationDir,
      TEMP_DIR: guiConfig.tempDir || process.env.TEMP_DIR
    };
    
    serverProcess = spawn('node', ['server.js'], {
      cwd: __dirname,
      env: env,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    // Forward server output to renderer
    serverProcess.stdout.on('data', (data) => {
      if (mainWindow) {
        mainWindow.webContents.send('server-output', {
          type: 'stdout',
          data: data.toString()
        });
      }
    });
    
    serverProcess.stderr.on('data', (data) => {
      if (mainWindow) {
        mainWindow.webContents.send('server-output', {
          type: 'stderr',
          data: data.toString()
        });
      }
    });
    
    serverProcess.on('close', (code) => {
      serverProcess = null;
      if (mainWindow) {
        mainWindow.webContents.send('server-status', {
          running: false,
          exitCode: code
        });
      }
    });
    
    // Send initial status
    if (mainWindow) {
      mainWindow.webContents.send('server-status', {
        running: true,
        pid: serverProcess.pid
      });
    }
    
    return { success: true, pid: serverProcess.pid };
  } catch (error) {
    return { success: false, message: error.message };
  }
});

ipcMain.handle('stop-server', async () => {
  if (!serverProcess) {
    return { success: false, message: 'Server not running' };
  }
  
  serverProcess.kill();
  serverProcess = null;
  return { success: true };
});

ipcMain.handle('get-server-status', () => {
  return {
    running: serverProcess !== null,
    pid: serverProcess ? serverProcess.pid : null
  };
});

// Slide management
ipcMain.handle('scan-slides', async () => {
  try {
    const slides = [];
    const supportedFormats = ['.svs', '.ndpi', '.tif', '.tiff', '.jp2', '.vms', '.vmu', '.scn'];
    
    if (fs.existsSync(guiConfig.sourceDir)) {
      const files = fs.readdirSync(guiConfig.sourceDir);
      
      for (const file of files) {
        const ext = path.extname(file).toLowerCase();
        if (supportedFormats.includes(ext)) {
          const filePath = path.join(guiConfig.sourceDir, file);
          const stats = fs.statSync(filePath);
          const baseName = path.basename(file, ext);
          const dziPath = path.join(guiConfig.destinationDir, `${baseName}.dzi`);
          
          slides.push({
            name: baseName,
            filename: file,
            format: ext,
            size: stats.size,
            modified: stats.mtime,
            converted: fs.existsSync(dziPath),
            path: filePath
          });
        }
      }
    }
    
    return { success: true, slides };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Utility functions
function buildVipsEnvironment() {
  const settings = guiConfig.vipsSettings;
  
  return {
    VIPS_CONCURRENCY: settings.concurrency.toString(),
    VIPS_NTHR: settings.concurrency.toString(),
    VIPS_CACHE_MAX_MEMORY: (settings.maxMemoryMB * 1024 * 1024).toString(),
    VIPS_CACHE_MAX: settings.cacheMaxMB.toString(),
    VIPS_DISC_THRESHOLD: (settings.discThresholdMB * 1024 * 1024).toString(),
    VIPS_BUFFER_SIZE: (settings.bufferSizeMB * 1024 * 1024).toString(),
    VIPS_PROGRESS: settings.progress ? '1' : '0',
    VIPS_INFO: settings.info ? '1' : '0',
    VIPS_WARNING: settings.warning ? '1' : '0',
    VIPS_NOVECTOR: settings.novector ? '1' : '0'
  };
}

function extractVipsVersion(helpOutput) {
  const match = helpOutput.match(/vips-(\d+\.\d+\.\d+)/);
  return match ? match[1] : 'Unknown';
}

function saveConfigToFile() {
  const configPath = path.join(__dirname, 'gui-config.json');
  try {
    fs.writeFileSync(configPath, JSON.stringify(guiConfig, null, 2));
  } catch (error) {
    console.error('Failed to save GUI config:', error);
  }
}

function loadConfigFromFile() {
  try {
    // PRIORITY 1: Environment variables from .env (single source of truth)
    if (process.env.SLIDES_DIR || process.env.DZI_DIR || process.env.TEMP_DIR) {
      guiConfig.sourceDir = process.env.SLIDES_DIR || guiConfig.sourceDir;
      guiConfig.destinationDir = process.env.DZI_DIR || guiConfig.destinationDir;
      guiConfig.tempDir = process.env.TEMP_DIR || guiConfig.tempDir;
      guiConfig.serverPort = Number(process.env.PORT) || guiConfig.serverPort;
      
      // Load VIPS settings from .env if available
      if (process.env.VIPS_CONCURRENCY) {
        guiConfig.vipsSettings.concurrency = Number(process.env.VIPS_CONCURRENCY);
      }
      if (process.env.MAX_CONCURRENT) {
        guiConfig.maxParallelSlides = Number(process.env.MAX_CONCURRENT);
      }
      
      console.log('✅ Electron GUI configuration loaded from .env (single source of truth)');
      console.log(`   Source: ${guiConfig.sourceDir}`);
      console.log(`   Destination: ${guiConfig.destinationDir}`);
      console.log(`   Temp: ${guiConfig.tempDir || 'not set'}`);
      return;
    }
    
    // PRIORITY 2: Load from saved GUI config file (fallback)
    const configPath = path.join(__dirname, 'gui-config.json');
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf8');
      const loaded = JSON.parse(data);
      guiConfig = { ...guiConfig, ...loaded };
      console.log('⚠️  Electron GUI configuration loaded from gui-config.json (fallback)');
      console.log('   Consider setting paths in .env for centralized configuration');
      return;
    }
    
    console.log('Using default Electron GUI configuration');
  } catch (error) {
    console.error('Failed to load GUI config:', error);
  }
}

// Load config on startup
loadConfigFromFile();

// Log configuration source on startup
app.on('ready', () => {
  console.log('\n=== PATHOLOGY SLIDE VIEWER - ELECTRON GUI ===');
  console.log(`Config Source: ${process.env.SLIDES_DIR ? '.env (✅ centralized)' : 'gui-config.json (fallback)'}`);
  console.log(`Source Directory: ${guiConfig.sourceDir}`);
  console.log(`Destination Directory: ${guiConfig.destinationDir}`);
});

// Create menu
function createMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Source Folder',
          accelerator: 'CmdOrCtrl+O',
          click: () => {
            mainWindow.webContents.send('menu-action', 'select-source-folder');
          }
        },
        {
          label: 'Open Destination Folder',
          accelerator: 'CmdOrCtrl+D',
          click: () => {
            mainWindow.webContents.send('menu-action', 'select-dest-folder');
          }
        },
        { type: 'separator' },
        {
          label: 'Exit',
          accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q',
          click: () => {
            app.quit();
          }
        }
      ]
    },
    {
      label: 'Server',
      submenu: [
        {
          label: 'Start Server',
          accelerator: 'F5',
          click: () => {
            mainWindow.webContents.send('menu-action', 'start-server');
          }
        },
        {
          label: 'Stop Server',
          accelerator: 'Shift+F5',
          click: () => {
            mainWindow.webContents.send('menu-action', 'stop-server');
          }
        }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Reload',
          accelerator: 'CmdOrCtrl+R',
          click: () => {
            mainWindow.reload();
          }
        },
        {
          label: 'Toggle Developer Tools',
          accelerator: process.platform === 'darwin' ? 'Alt+Cmd+I' : 'Ctrl+Shift+I',
          click: () => {
            mainWindow.webContents.toggleDevTools();
          }
        }
      ]
    }
  ];
  
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}
