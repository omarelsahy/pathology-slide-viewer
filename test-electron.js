const { app, BrowserWindow } = require('electron');

console.log('Electron app:', typeof app);
console.log('BrowserWindow:', typeof BrowserWindow);

if (app) {
  app.whenReady().then(() => {
    console.log('Electron is ready!');
    const win = new BrowserWindow({
      width: 800,
      height: 600,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      }
    });
    
    win.loadURL('data:text/html,<h1>Electron Test</h1><p>If you see this, Electron is working!</p>');
    
    setTimeout(() => {
      app.quit();
    }, 3000);
  });
  
  app.on('window-all-closed', () => {
    app.quit();
  });
} else {
  console.error('App is undefined');
  process.exit(1);
}
