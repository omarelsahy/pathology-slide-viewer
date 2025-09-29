const { app, BrowserWindow, ipcMain, Menu, shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

// Keep a global reference of the window object
let mainWindow;
let backendProcess = null;
let frontendProcess = null;
let guiProcess = null;
let conversionProcess = null;

// Development mode check
const isDev = process.env.NODE_ENV === 'development';

function createWindow() {
  // Create the browser window
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true,
      webSecurity: false // Allow loading local content
    },
    icon: path.join(__dirname, 'assets', 'icon.png'), // Add icon later
    title: 'Pathology Slide Viewer - Desktop'
  });

  // Load the app
  mainWindow.loadFile('electron-renderer.html');

  // Open DevTools in development
  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  // Handle window closed
  mainWindow.on('closed', () => {
    mainWindow = null;
    stopAllServers();
  });

  // Handle external links
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

// Start backend servers
function startServers() {
  console.log('Starting backend servers...');
  
  // Start main server (backend API + tile serving)
  backendProcess = spawn('node', ['server.js'], {
    cwd: __dirname,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  // Start frontend server (slide viewer)
  frontendProcess = spawn('node', ['frontend-server.js'], {
    cwd: __dirname,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  // Start GUI server (management console)
  guiProcess = spawn('node', ['gui-server.js'], {
    cwd: __dirname,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  // Start conversion server
  conversionProcess = spawn('node', ['conversion-server.js'], {
    cwd: __dirname,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  // Handle server output
  if (backendProcess.stdout) {
    backendProcess.stdout.on('data', (data) => {
      console.log(`Backend: ${data}`);
      if (mainWindow) {
        mainWindow.webContents.send('server-log', { 
          server: 'backend', 
          message: data.toString() 
        });
      }
    });
  }

  if (frontendProcess.stdout) {
    frontendProcess.stdout.on('data', (data) => {
      console.log(`Frontend: ${data}`);
      if (mainWindow) {
        mainWindow.webContents.send('server-log', { 
          server: 'frontend', 
          message: data.toString() 
        });
      }
    });
  }

  if (guiProcess.stdout) {
    guiProcess.stdout.on('data', (data) => {
      console.log(`GUI: ${data}`);
      if (mainWindow) {
        mainWindow.webContents.send('server-log', { 
          server: 'gui', 
          message: data.toString() 
        });
      }
    });
  }

  if (conversionProcess.stdout) {
    conversionProcess.stdout.on('data', (data) => {
      console.log(`Conversion: ${data}`);
      if (mainWindow) {
        mainWindow.webContents.send('server-log', { 
          server: 'conversion', 
          message: data.toString() 
        });
      }
    });
  }

  // Handle server errors
  [backendProcess, frontendProcess, guiProcess, conversionProcess].forEach((process, index) => {
    const names = ['backend', 'frontend', 'gui', 'conversion'];
    if (process.stderr) {
      process.stderr.on('data', (data) => {
        console.error(`${names[index]} Error: ${data}`);
        if (mainWindow) {
          mainWindow.webContents.send('server-error', { 
            server: names[index], 
            error: data.toString() 
          });
        }
      });
    }
  });
}

// Stop all servers
function stopAllServers() {
  console.log('Stopping all servers...');
  
  if (backendProcess) {
    backendProcess.kill();
    backendProcess = null;
  }
  
  if (frontendProcess) {
    frontendProcess.kill();
    frontendProcess = null;
  }
  
  if (guiProcess) {
    guiProcess.kill();
    guiProcess = null;
  }
  
  if (conversionProcess) {
    conversionProcess.kill();
    conversionProcess = null;
  }
}

// App event handlers
app.whenReady().then(() => {
  createWindow();
  
  // Start servers after window is created
  setTimeout(startServers, 1000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  stopAllServers();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  stopAllServers();
});

// IPC handlers for renderer process communication
ipcMain.handle('get-server-status', () => {
  return {
    backend: backendProcess !== null,
    frontend: frontendProcess !== null,
    gui: guiProcess !== null,
    conversion: conversionProcess !== null
  };
});

ipcMain.handle('restart-server', (event, serverName) => {
  console.log(`Restarting ${serverName} server...`);
  
  switch (serverName) {
    case 'backend':
      if (backendProcess) backendProcess.kill();
      backendProcess = spawn('node', ['server.js'], {
        cwd: __dirname,
        stdio: ['pipe', 'pipe', 'pipe']
      });
      break;
    case 'frontend':
      if (frontendProcess) frontendProcess.kill();
      frontendProcess = spawn('node', ['frontend-server.js'], {
        cwd: __dirname,
        stdio: ['pipe', 'pipe', 'pipe']
      });
      break;
    case 'gui':
      if (guiProcess) guiProcess.kill();
      guiProcess = spawn('node', ['gui-server.js'], {
        cwd: __dirname,
        stdio: ['pipe', 'pipe', 'pipe']
      });
      break;
    case 'conversion':
      if (conversionProcess) conversionProcess.kill();
      conversionProcess = spawn('node', ['conversion-server.js'], {
        cwd: __dirname,
        stdio: ['pipe', 'pipe', 'pipe']
      });
      break;
  }
  
  return true;
});

ipcMain.handle('open-file-explorer', (event, path) => {
  shell.showItemInFolder(path);
});

// Create application menu
function createMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Slides Folder',
          click: () => {
            shell.openPath(path.join(__dirname, 'public', 'slides'));
          }
        },
        {
          label: 'Open DZI Folder',
          click: () => {
            shell.openPath(path.join(__dirname, 'public', 'dzi'));
          }
        },
        { type: 'separator' },
        {
          label: 'Exit',
          accelerator: 'CmdOrCtrl+Q',
          click: () => {
            app.quit();
          }
        }
      ]
    },
    {
      label: 'Servers',
      submenu: [
        {
          label: 'Restart Backend',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send('restart-server', 'backend');
            }
          }
        },
        {
          label: 'Restart Frontend',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send('restart-server', 'frontend');
            }
          }
        },
        {
          label: 'Restart Conversion',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send('restart-server', 'conversion');
            }
          }
        }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About',
          click: () => {
            shell.openExternal('https://github.com/your-repo/pathology-slide-viewer');
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

app.whenReady().then(() => {
  createMenu();
});
