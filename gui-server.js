// Pathology Slide Viewer - Web-based GUI Server
// Provides a web interface for managing the slide viewer backend

const express = require('express');
const path = require('path');
const fs = require('fs');
const { spawn, exec, execSync } = require('child_process');
const WebSocket = require('ws');
const fetch = require('node-fetch');
const multer = require('multer');

const app = express();
const PORT = 3003; // Different port from main server

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
  serverPort: 3101,
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
app.use(express.json());
app.use(express.static(path.join(__dirname, 'gui-web')));

// Load/Save configuration
function loadConfig() {
  const configPath = path.join(__dirname, 'gui-config.json');
  try {
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf8');
      const loaded = JSON.parse(data);
      guiConfig = { ...guiConfig, ...loaded };
    }
  } catch (error) {
    console.error('Failed to load GUI config:', error);
  }
}

function saveConfig() {
  const configPath = path.join(__dirname, 'gui-config.json');
  try {
    fs.writeFileSync(configPath, JSON.stringify(guiConfig, null, 2));
  } catch (error) {
    console.error('Failed to save GUI config:', error);
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

// Save configuration
app.post('/api/config', (req, res) => {
  guiConfig = { ...guiConfig, ...req.body };
  saveConfig();
  res.json({ success: true });
});

// Proxy helpers to backend API
function getBackendBaseUrl() {
  const port = Number(guiConfig.serverPort) || 3101;
  return `http://localhost:${port}`;
}

function getBackendWsUrl() {
  const port = Number(guiConfig.serverPort) || 3101;
  return `ws://localhost:${port}`;
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
    const port = Number(guiConfig.serverPort) || 3101;
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
      const url = `http://localhost:${Number(guiConfig.serverPort) || 3101}/api/performance/status`;
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

// WebSocket server for real-time updates
const server = app.listen(PORT, () => {
  console.log(`\n=== PATHOLOGY SLIDE VIEWER GUI ===`);
  console.log(`GUI Server: http://localhost:${PORT}`);
  console.log(`Config file: ${path.join(__dirname, 'gui-config.json')}`);
  // If a Windows service is already running, begin streaming logs so the console is not empty
  if (controlMode === 'service') {
    try {
      const out = execSync('sc query PathologyBackend', { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
      if (/STATE\s*:\s*4\s+RUNNING/i.test(out)) startServiceLogStreaming();
    } catch (_) { /* noop */ }
  }
  // Start the backend WS bridge when server starts
  ensureBackendWs();

  // Ensure backend WS is running every 5 seconds
  setInterval(() => {
    if (!backendWs || backendWs.readyState !== WebSocket.OPEN) {
      console.log('Backend WS not connected, attempting to reconnect...');
      ensureBackendWs();
    }
  }, 5000);
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
function ensureBackendWs() {
  try {
    if (backendWs && backendWs.readyState === WebSocket.OPEN) return;
    const url = getBackendWsUrl();
    if (backendWs && backendWs.readyState === WebSocket.CONNECTING) return;
    backendWs = new WebSocket(url);
    backendWs.on('open', () => {
      console.log('Connected to backend WS:', url);
    });
    backendWs.on('message', (msg) => {
      try {
        const data = JSON.parse(msg.toString());
        console.log('Backend WS message received:', data.type, data.filename || data.fileName);
        if (data && (data.type === 'conversion_progress' || data.type === 'conversion_complete' || data.type === 'conversion_cancelled' || data.type === 'conversion_error' || data.type === 'auto_processing_started' || data.type === 'conversion_started')) {
          console.log('Forwarding backend message to GUI clients:', data.type, data.filename || data.fileName);
          broadcastToClients(data);
        } else {
          console.log('Ignoring backend message type:', data.type);
        }
      } catch (e) { 
        console.log('Failed to parse backend WS message:', e.message, msg.toString().substring(0, 100));
      }
    });
    backendWs.on('close', () => {
      console.log('Backend WS closed, will retry...');
      setTimeout(ensureBackendWs, 2000);
    });
    backendWs.on('error', (err) => {
      console.log('Backend WS error:', err.message);
      try { backendWs.close(); } catch (_) {}
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

// Load config on startup
loadConfig();

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
