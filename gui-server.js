// Pathology Slide Viewer - Web-based GUI Server
// Provides a web interface for managing the slide viewer backend

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const os = require('os');
const fetch = require('node-fetch');
const { execSync } = require('child_process');
const multer = require('multer');

const app = express();

// Setup timestamped logging
function setupTimestampedLogging() {
  // Store original console methods
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  
  // Helper function to get timestamp
  const getTimestamp = () => {
    const now = new Date();
    return now.toLocaleTimeString('en-US', { 
      hour12: false, 
      hour: '2-digit', 
      minute: '2-digit', 
      second: '2-digit'
    });
  };
  
  // Override console methods with timestamps
  console.log = (...args) => {
    originalLog(`[${getTimestamp()}]`, ...args);
  };
  
  console.warn = (...args) => {
    originalWarn(`[${getTimestamp()}]`, ...args);
  };
  
  console.error = (...args) => {
    originalError(`[${getTimestamp()}]`, ...args);
  };
}

// Initialize timestamped logging
setupTimestampedLogging();

let serverProcess = null; // used only in process mode
let controlMode = 'process'; // 'service' | 'process'
let serviceLogWatchers = { out: null, err: null };
let serviceLogPositions = { out: 0, err: 0 };
let backendWs = null;

function detectServiceMode() {
  try {
    const out = execSync('sc query PathologyBackend', { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
    if (/SERVICE_NAME:\s*PathologyBackend/i.test(out)) {
      controlMode = 'service';
    }
  } catch (e) {
    controlMode = 'process';
  }
}

detectServiceMode();
let guiConfig = {
  // Folder paths - default to E: drive for better performance
  sourceDir: 'E:\\OG',
  destinationDir: 'E:\\dzi',
  tempDir: 'E:\\temp',
  
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
  serverPort: 3102,
  autoStart: false
};

// Multer storage to write directly into sourceDir with sanitized filenames
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      try {
        const destDir = guiConfig.sourceDir;
        if (!destDir) return cb(new Error('Source folder not set in GUI config'));
        fs.mkdirSync(destDir, { recursive: true });
        cb(null, destDir);
      } catch (e) { cb(e); }
    },
    filename: (req, file, cb) => {
      const safeName = String(file.originalname || 'upload')
        .replace(/[\/\\:*?"<>|]/g, '_');
      cb(null, safeName);
    }
  }),
  limits: { fileSize: 1024 * 1024 * 1024 * 20 } // up to 20GB per file
});

// Middleware
app.use(express.json({ limit: '100mb' })); // Increased limit for large file operations
app.use(express.static(path.join(__dirname, 'gui-web')));

// Load/Save configuration - Prioritizes .env as single source of truth
function loadConfig() {
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
      
      console.log('✅ GUI configuration loaded from .env (single source of truth)');
      console.log(`   Source: ${guiConfig.sourceDir}`);
      console.log(`   Destination: ${guiConfig.destinationDir}`);
      console.log(`   Temp: ${guiConfig.tempDir}`);
      return;
    }
    
    // PRIORITY 2: Load from saved GUI config file (fallback)
    const configPath = path.join(__dirname, 'gui-config.json');
    if (fs.existsSync(configPath)) {
      const savedConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      guiConfig = { ...guiConfig, ...savedConfig };
      console.log('⚠️  GUI configuration loaded from gui-config.json (fallback)');
      console.log('   Consider setting paths in .env for centralized configuration');
      return;
    }
    
    // PRIORITY 3: Load from unified config system (final fallback)
    const config = require('./config.js');
    const summary = config.getSummary();
    
    guiConfig = {
      ...guiConfig,
      sourceDir: summary.slidesDir || guiConfig.sourceDir,
      destinationDir: summary.dziDir || guiConfig.destinationDir,
      tempDir: summary.tempDir || guiConfig.tempDir,
      serverPort: summary.services?.backend || guiConfig.serverPort,
      vipsSettings: {
        ...guiConfig.vipsSettings,
        concurrency: config.guiConfig?.vipsSettings?.concurrency || guiConfig.vipsSettings.concurrency,
        maxMemoryMB: config.guiConfig?.vipsSettings?.maxMemoryMB || guiConfig.vipsSettings.maxMemoryMB
      }
    };
    console.log('GUI configuration loaded from unified config system');
  } catch (error) {
    console.warn('Could not load configuration, using defaults:', error.message);
  }
}

function saveConfig() {
  try {
    const configPath = path.join(__dirname, 'gui-config.json');
    fs.writeFileSync(configPath, JSON.stringify(guiConfig, null, 2));
    console.log('GUI configuration saved to gui-config.json');
  } catch (error) {
    console.error('Failed to save GUI configuration:', error);
  }
}

// API Routes

// Get configuration
app.get('/api/config', (req, res) => {
  res.json(guiConfig);
});

// Import slides: accepts multipart form-data with field name 'slides'
app.post('/api/import', upload.array('slides'), async (req, res) => {
  try {
    const allowed = new Set(['.svs', '.ndpi', '.tif', '.tiff', '.jp2', '.vms', '.vmu', '.scn']);
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: 'No files uploaded' });
    // Remove any files with unsupported extensions
    for (const f of files) {
      const ext = (path.extname(f.originalname || f.filename) || '').toLowerCase();
      if (!allowed.has(ext)) {
        try { fs.unlinkSync(f.path); } catch (_) {}
      }
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Browse directories
app.get('/api/browse', (req, res) => {
  const { path: dirPath } = req.query;
  try {
    const startPath = dirPath || 'C:\\';
    
    if (!fs.existsSync(startPath)) {
      return res.status(400).json({ error: 'Path does not exist' });
    }
    
    const stats = fs.statSync(startPath);
    if (!stats.isDirectory()) {
      return res.status(400).json({ error: 'Path is not a directory' });
    }
    
    const items = fs.readdirSync(startPath, { withFileTypes: true })
      .filter(item => item.isDirectory())
      .map(item => ({
        name: item.name,
        path: path.join(startPath, item.name),
        type: 'directory'
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    
    // Add parent directory if not at root
    const parentPath = path.dirname(startPath);
    if (parentPath !== startPath) {
      items.unshift({
        name: '..',
        path: parentPath,
        type: 'parent'
      });
    }
    
    res.json({
      currentPath: startPath,
      items: items
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Save configuration
app.post('/api/config', (req, res) => {
  guiConfig = { ...guiConfig, ...req.body };
  saveConfig();
  res.json({ success: true });
});

// Proxy helpers to backend API
function getBackendBaseUrl() {
  // Backend server runs on port 3101, not the GUI server port
  return `http://localhost:3101`;
}

function getBackendWsUrl() {
  // Backend WebSocket runs on port 3101, not the GUI server port
  return `ws://localhost:3101`;
}

// Proxy: scan slides
app.get('/api/slides', async (req, res) => {
  try {
    const r = await fetch(`${getBackendBaseUrl()}/api/slides`);
    const text = await r.text();
    res.status(r.status).type(r.headers.get('content-type') || 'application/json').send(text);
  } catch (e) {
    res.status(502).json({ error: 'Backend unavailable', details: e.message });
  }
});

// Proxy: start conversion
app.post('/api/convert/:filename', async (req, res) => {
  try {
    const r = await fetch(`${getBackendBaseUrl()}/api/convert/${encodeURIComponent(req.params.filename)}`, { method: 'POST' });
    const text = await r.text();
    res.status(r.status).type(r.headers.get('content-type') || 'application/json').send(text);
  } catch (e) {
    res.status(502).json({ error: 'Backend unavailable', details: e.message });
  }
});

// Proxy: delete slide
app.delete('/api/slides/:filename', async (req, res) => {
  try {
    const r = await fetch(`${getBackendBaseUrl()}/api/slides/${encodeURIComponent(req.params.filename)}`, { method: 'DELETE' });
    const text = await r.text();
    res.status(r.status).type(r.headers.get('content-type') || 'application/json').send(text);
  } catch (e) {
    console.error('Proxy error (delete slide):', e);
    res.status(500).json({ error: 'Proxy error' });
  }
});

// Proxy: rename slide
app.put('/api/slides/:filename/rename', async (req, res) => {
  try {
    const r = await fetch(`${getBackendBaseUrl()}/api/slides/${encodeURIComponent(req.params.filename)}/rename`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(req.body)
    });
    const text = await r.text();
    res.status(r.status).type(r.headers.get('content-type') || 'application/json').send(text);
  } catch (e) {
    console.error('Proxy error (rename slide):', e);
    res.status(500).json({ error: 'Proxy error' });
  }
});

// Proxy: generate thumbnail
app.post('/api/slides/:filename/generate-thumbnail', async (req, res) => {
  try {
    const r = await fetch(`${getBackendBaseUrl()}/api/slides/${encodeURIComponent(req.params.filename)}/generate-thumbnail`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    const text = await r.text();
    res.status(r.status).type(r.headers.get('content-type') || 'application/json').send(text);
  } catch (e) {
    console.error('Proxy error (generate thumbnail):', e);
    res.status(500).json({ error: 'Proxy error' });
  }
});

// Server management
app.post('/api/server/start', (req, res) => {
  detectServiceMode();
  if (controlMode === 'service') {
    try {
      // Optionally set env via service config (NSSM) outside this call
      execSync('sc start PathologyBackend');
      broadcastToClients({ type: 'server-status', running: true });
      // Begin streaming service logs to clients
      startServiceLogStreaming();
      return res.json({ success: true, mode: 'service' });
    } catch (e) {
      return res.json({ success: false, mode: 'service', message: e.message });
    }
  }
  if (serverProcess) {
    return res.json({ success: false, message: 'Server already running', mode: 'process' });
  }
  try {
    const port = Number(guiConfig.serverPort) || 3102;
    const env = {
      ...process.env,
      ...buildVipsEnvironment(),
      NODE_MODE: 'server',
      PORT: String(port),
      SLIDES_DIR: guiConfig.sourceDir,
      DZI_DIR: guiConfig.destinationDir
    };
    serverProcess = spawn('node', ['server.js'], { cwd: __dirname, env, stdio: ['pipe', 'pipe', 'pipe'] });
    serverProcess.stdout.on('data', (data) => {
      broadcastToClients({ type: 'server-output', data: data.toString(), stream: 'stdout' });
    });
    serverProcess.stderr.on('data', (data) => {
      broadcastToClients({ type: 'server-output', data: data.toString(), stream: 'stderr' });
    });
    serverProcess.on('close', (code) => {
      serverProcess = null;
      broadcastToClients({ type: 'server-status', running: false, exitCode: code });
    });
    broadcastToClients({ type: 'server-status', running: true, pid: serverProcess.pid });
    return res.json({ success: true, pid: serverProcess.pid, mode: 'process' });
  } catch (error) {
    return res.json({ success: false, mode: 'process', message: error.message });
  }
});

app.post('/api/server/stop', (req, res) => {
  detectServiceMode();
  if (controlMode === 'service') {
    try {
      execSync('sc stop PathologyBackend');
      broadcastToClients({ type: 'server-status', running: false });
      stopServiceLogStreaming();
      return res.json({ success: true, mode: 'service' });
    } catch (e) {
      return res.json({ success: false, mode: 'service', message: e.message });
    }
  }
  if (!serverProcess) {
    return res.json({ success: false, message: 'Server not running', mode: 'process' });
  }
  serverProcess.kill();
  serverProcess = null;
  return res.json({ success: true, mode: 'process' });
});

app.get('/api/server/status', async (req, res) => {
  detectServiceMode();
  if (controlMode === 'service') {
    try {
      const out = execSync('sc query PathologyBackend', { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
      const running = /STATE\s*:\s*4\s+RUNNING/i.test(out);
      if (running) startServiceLogStreaming(); else stopServiceLogStreaming();
      return res.json({ running, mode: 'service' });
    } catch (e) {
      return res.json({ running: false, mode: 'service', error: e.message });
    }
  }
  // Process mode: if we don't track a child, still report running if API is reachable
  let running = serverProcess !== null;
  if (!running) {
    try {
      const url = `http://localhost:${Number(guiConfig.serverPort) || 3102}/api/performance/status`;
      const r = await fetch(url, { timeout: 2000 });
      running = r && r.ok;
    } catch (_) { /* ignore */ }
  }
  return res.json({ running, pid: serverProcess ? serverProcess.pid : null, mode: 'process' });
});

// Service log streaming helpers
function startServiceLogStreaming() {
  try {
    const outPath = path.join(__dirname, 'logs', 'backend.out.log');
    const errPath = path.join(__dirname, 'logs', 'backend.err.log');
    // Initialize positions at EOF
    initLogWatcher('out', outPath);
    initLogWatcher('err', errPath);
  } catch (_) { /* noop */ }
}

function stopServiceLogStreaming() {
  for (const key of ['out', 'err']) {
    if (serviceLogWatchers[key]) {
      serviceLogWatchers[key].close();
      serviceLogWatchers[key] = null;
    }
    serviceLogPositions[key] = 0;
  }
}

function initLogWatcher(kind, filePath) {
  try {
    if (!fs.existsSync(filePath)) return;
    const stat = fs.statSync(filePath);
    serviceLogPositions[kind] = stat.size; // start tailing from end
    if (serviceLogWatchers[kind]) return; // already watching
    serviceLogWatchers[kind] = fs.watch(filePath, { persistent: true }, (eventType) => {
      try {
        if (!fs.existsSync(filePath)) return;
        const st = fs.statSync(filePath);
        const prev = serviceLogPositions[kind] || 0;
        if (st.size > prev) {
          const stream = fs.createReadStream(filePath, { start: prev, end: st.size - 1, encoding: 'utf8' });
          let chunk = '';
          stream.on('data', d => { chunk += d; });
          stream.on('end', () => {
            serviceLogPositions[kind] = st.size;
            if (chunk) {
              broadcastToClients({ type: 'server-output', data: chunk, stream: kind === 'out' ? 'stdout' : 'stderr' });
            }
          });
        } else if (st.size < prev) {
          // file rotated/truncated
          serviceLogPositions[kind] = st.size;
        }
      } catch (_) { /* noop */ }
    });
  } catch (_) { /* noop */ }
}

// Backend health check - verifies the GUI can reach the backend API
app.get('/api/backend/health', async (req, res) => {
  try {
    const url = `http://localhost:${guiConfig.serverPort}/api/performance/status`;
    const r = await fetch(url, { timeout: 5000 });
    if (!r.ok) {
      return res.status(503).json({ ok: false, status: r.status, message: 'Backend responded with error' });
    }
    const data = await r.json();
    // Ensure backend WS bridge is connected when backend is healthy
    ensureBackendWs();
    res.json({ ok: true, data });
  } catch (error) {
    res.status(503).json({ ok: false, error: error.message });
  }
});

// Server connection status endpoint - provides status of all servers
app.get('/api/servers/status', async (req, res) => {
  const status = {
    gui: {
      url: `http://localhost:${PORT}`,
      status: 'running',
      connected: true
    },
    backend: {
      url: `http://localhost:${guiConfig.serverPort}`,
      status: 'unknown',
      connected: false
    },
    conversion: {
      url: 'http://localhost:3001',
      status: 'unknown',
      connected: false
    }
  };

  // Check backend server
  try {
    const backendUrl = `http://localhost:${guiConfig.serverPort}/api/performance/status`;
    const backendResponse = await fetch(backendUrl, { timeout: 3000 });
    if (backendResponse.ok) {
      status.backend.status = 'running';
      status.backend.connected = true;
    }
  } catch (error) {
    status.backend.status = 'disconnected';
    status.backend.error = error.message;
  }

  // Check conversion server
  try {
    const conversionResponse = await fetch('http://localhost:3001/health', { timeout: 3000 });
    if (conversionResponse.ok) {
      const healthData = await conversionResponse.json();
      status.conversion.status = 'running';
      status.conversion.connected = true;
      status.conversion.health = healthData;
    }
  } catch (error) {
    status.conversion.status = 'disconnected';
    status.conversion.error = error.message;
  }

  res.json(status);
});

// Slide management - removed duplicate endpoint to use proxy instead

// VIPS info
app.get('/api/vips-info', (req, res) => {
  exec('vips --help', (error, stdout, stderr) => {
    if (error) {
      res.json({ error: error.message });
      return;
    }
    
    exec('vips --vips-config', (configError, configStdout) => {
      res.json({
        help: stdout,
        config: configError ? 'Config not available' : configStdout,
        version: extractVipsVersion(stdout)
      });
    });
  });
});

// Utility functions
function buildVipsEnvironment() {
  const s = guiConfig.vipsSettings || {};
  const cpuCount = require('os').cpus().length;
  const totalMemMB = Math.floor(require('os').totalmem() / (1024 * 1024));

  const concurrency = Number(s.concurrency) || Math.max(1, Math.floor(cpuCount * 0.5));
  const maxMemoryMB = Number(s.maxMemoryMB) || Math.floor(totalMemMB * 0.4);
  const bufferSizeMB = Number(s.bufferSizeMB) || 512;
  const discThresholdMB = Number(s.discThresholdMB) || 1024;
  const cacheMaxMB = Number(s.cacheMaxMB) || Math.min(maxMemoryMB, 1024);

  const env = {
    VIPS_CONCURRENCY: String(concurrency),
    VIPS_NTHR: String(concurrency),
    VIPS_CACHE_MAX_MEMORY: String(maxMemoryMB * 1024 * 1024),
    VIPS_CACHE_MAX: String(cacheMaxMB),
    VIPS_DISC_THRESHOLD: String(discThresholdMB * 1024 * 1024),
    VIPS_BUFFER_SIZE: String(bufferSizeMB * 1024 * 1024),
    VIPS_PROGRESS: s.progress === false ? '0' : '1',
    VIPS_INFO: s.info === false ? '0' : '1',
    VIPS_WARNING: s.warning === false ? '0' : '1',
    VIPS_NOVECTOR: s.novector ? '1' : '0'
  };
  return env;
}

function extractVipsVersion(helpOutput) {
  const match = helpOutput.match(/vips-(\d+\.\d+\.\d+)/);
  return match ? match[1] : 'Unknown';
}

// Touch file endpoint to trigger autoprocessor
app.post('/api/touch-file/:filename', async (req, res) => {
  try {
    const filename = decodeURIComponent(req.params.filename);
    const filePath = path.join(guiConfig.sourceDir, filename);
    
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found', filename });
    }
    
    // Update file modification time to trigger autoprocessor
    const now = new Date();
    fs.utimesSync(filePath, now, now);
    
    // Notify backend to clear processed status for this file
    try {
      const backendUrl = `http://localhost:${guiConfig.serverPort || 3102}`;
      await fetch(`${backendUrl}/api/clear-processed/${encodeURIComponent(filename)}`, { 
        method: 'POST' 
      });
    } catch (backendError) {
      console.warn('Could not notify backend to clear processed status:', backendError.message);
    }
    
    res.json({ 
      success: true, 
      status: 'triggered',
      filename,
      message: 'File touched, autoprocessor will detect and process'
    });
    
  } catch (error) {
    console.error('Touch file error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Cancel conversion endpoint
app.post('/api/cancel-conversion/:filename', async (req, res) => {
  try {
    const filename = decodeURIComponent(req.params.filename);
    
    // Forward cancel request to backend server
    const backendUrl = `http://localhost:${guiConfig.serverPort || 3102}`;
    const response = await fetch(`${backendUrl}/api/cancel-conversion/${encodeURIComponent(filename)}`, { 
      method: 'POST' 
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({ error: errorText });
    }
    
    const result = await response.json();
    res.json(result);
    
  } catch (error) {
    console.error('Cancel conversion proxy error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Load config on startup
loadConfig();

// Static file middleware (after API routes to avoid conflicts)
app.use(express.static(path.join(__dirname, 'gui-web')));

// WebSocket server for real-time updates
const server = app.listen(guiConfig.serverPort, () => {
  console.log(`\n=== PATHOLOGY SLIDE VIEWER GUI ===`);
  console.log(`GUI Server: http://localhost:${guiConfig.serverPort}`);
  console.log(`Config Source: ${process.env.SLIDES_DIR ? '.env (✅ centralized)' : 'gui-config.json (fallback)'}`);
  console.log(`Backend Server: http://localhost:${guiConfig.serverPort}`);
  if (controlMode === 'service') {
    try {
      const out = execSync('sc query PathologyBackend', { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
      if (/STATE\s*:\s*4\s+RUNNING/i.test(out)) startServiceLogStreaming();
    } catch (_) { /* noop */ }
  }
  // Start the backend WS bridge when server starts
  ensureBackendWs();

  // Ensure backend WS is running every 3 seconds (more frequent checks)
  setInterval(() => {
    if (!backendWs || backendWs.readyState !== WebSocket.OPEN) {
      console.log('Backend WS not connected, attempting to reconnect...');
      ensureBackendWs();
    }
  }, 3000);
});

const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  console.log('GUI client connected');
  
  // Send current server status
  ws.send(JSON.stringify({
    type: 'server-status',
    running: serverProcess !== null,
    pid: serverProcess ? serverProcess.pid : null
  }));
  
  ws.on('close', () => {
    console.log('GUI client disconnected');
  });
});

// Backend WS bridge: forward backend conversion_* messages to GUI clients
let reconnectAttempts = 0;

function ensureBackendWs() {
  try {
    if (backendWs && backendWs.readyState === WebSocket.OPEN) return;
    const url = getBackendWsUrl();
    if (backendWs && backendWs.readyState === WebSocket.CONNECTING) return;
    backendWs = new WebSocket(url);
    backendWs.on('open', () => {
      console.log('Connected to backend WS:', url);
      reconnectAttempts = 0; // Reset counter on successful connection
    });
    backendWs.on('message', (msg) => {
      try {
        const data = JSON.parse(msg.toString());
        console.log('Backend WS message received:', data.type, data.filename || data.fileName);
        if (data && (data.type === 'conversion_progress' || data.type === 'conversion_complete' || data.type === 'conversion_cancelled' || data.type === 'conversion_error' || data.type === 'auto_processing_started' || data.type === 'conversion_started')) {
          console.log('Forwarding backend message to GUI clients:', data.type, data.filename || data.fileName);
          broadcastToClients(data);
        }
      } catch (e) {
        console.log('Failed to parse backend WS message:', e.message, msg.toString().substring(0, 100));
      }
    });
    backendWs.on('close', (code, reason) => {
      console.log(`Backend WS closed (code: ${code}, reason: ${reason}), will retry...`);
      backendWs = null; // Clear reference to allow new connection
      // Add exponential backoff for reconnection
      const retryDelay = Math.min(2000 * Math.pow(1.5, reconnectAttempts), 30000);
      reconnectAttempts++;
      setTimeout(() => {
        console.log(`Attempting backend WS reconnection (attempt ${reconnectAttempts})...`);
        ensureBackendWs();
      }, retryDelay);
    });
    backendWs.on('error', (err) => {
      console.log('Backend WS error:', err.message, '- URL:', url);
      try { backendWs.close(); } catch (_) {}
      backendWs = null; // Clear reference to allow new connection
    });
  } catch (e) { 
    console.log('Failed to create backend WS connection:', e.message);
  }
}

function broadcastToClients(message) {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(message));
    }
  });
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down GUI server...');
  if (serverProcess) {
    serverProcess.kill();
  }
  server.close(() => {
    console.log('GUI server closed');
    process.exit(0);
  });
});
