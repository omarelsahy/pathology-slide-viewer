// Pathology Slide Viewer - GUI Renderer Process
// Handles UI interactions and communication with main process

const { ipcRenderer } = require('electron');

let currentConfig = {};
let slides = [];

// DOM Elements
const elements = {
    // Server controls
    serverIndicator: document.getElementById('serverIndicator'),
    serverStatusText: document.getElementById('serverStatusText'),
    startServerBtn: document.getElementById('startServerBtn'),
    stopServerBtn: document.getElementById('stopServerBtn'),
    
    // Folder selection
    sourcePath: document.getElementById('sourcePath'),
    destPath: document.getElementById('destPath'),
    selectSourceBtn: document.getElementById('selectSourceBtn'),
    selectDestBtn: document.getElementById('selectDestBtn'),
    
    // VIPS Configuration
    concurrency: document.getElementById('concurrency'),
    maxMemory: document.getElementById('maxMemory'),
    bufferSize: document.getElementById('bufferSize'),
    tileSize: document.getElementById('tileSize'),
    quality: document.getElementById('quality'),
    qualityValue: document.getElementById('qualityValue'),
    
    // ICC Profile
    autoDetectSrgb: document.getElementById('autoDetectSrgb'),
    iccPath: document.getElementById('iccPath'),
    selectIccBtn: document.getElementById('selectIccBtn'),
    colorTransform: document.getElementById('colorTransform'),
    
    // VIPS Logging
    vipsProgress: document.getElementById('vipsProgress'),
    vipsInfo: document.getElementById('vipsInfo'),
    vipsWarning: document.getElementById('vipsWarning'),
    
    // Advanced Settings
    serverPort: document.getElementById('serverPort'),
    overlap: document.getElementById('overlap'),
    layout: document.getElementById('layout'),
    embedIcc: document.getElementById('embedIcc'),
    sequential: document.getElementById('sequential'),
    novector: document.getElementById('novector'),
    
    // Tabs and content
    tabs: document.querySelectorAll('.tab'),
    tabContents: document.querySelectorAll('.tab-content'),
    
    // Slides
    scanSlidesBtn: document.getElementById('scanSlidesBtn'),
    refreshSlidesBtn: document.getElementById('refreshSlidesBtn'),
    slidesGrid: document.getElementById('slidesGrid'),
    
    // VIPS Info
    getVipsInfoBtn: document.getElementById('getVipsInfoBtn'),
    vipsInfoDisplay: document.getElementById('vipsInfoDisplay'),
    
    // Console
    consoleOutput: document.getElementById('consoleOutput'),
    clearConsoleBtn: document.getElementById('clearConsoleBtn'),
    autoScroll: document.getElementById('autoScroll')
};

// Initialize the application
async function init() {
    await loadConfig();
    setupEventListeners();
    updateServerStatus();
    await scanSlides();
}

// Load configuration from main process
async function loadConfig() {
    try {
        currentConfig = await ipcRenderer.invoke('get-config');
        updateUIFromConfig();
    } catch (error) {
        console.error('Failed to load config:', error);
    }
}

// Update UI elements from configuration
function updateUIFromConfig() {
    // Folder paths
    elements.sourcePath.textContent = currentConfig.sourceDir || 'Select folder...';
    elements.destPath.textContent = currentConfig.destinationDir || 'Select folder...';
    
    // VIPS settings
    const vips = currentConfig.vipsSettings || {};
    elements.concurrency.value = vips.concurrency || 8;
    elements.maxMemory.value = vips.maxMemoryMB || 4096;
    elements.bufferSize.value = vips.bufferSizeMB || 512;
    elements.tileSize.value = vips.tileSize || 256;
    elements.quality.value = vips.quality || 90;
    elements.qualityValue.textContent = vips.quality || 90;
    
    // ICC Profile
    elements.autoDetectSrgb.checked = vips.autoDetectSrgb !== false;
    elements.iccPath.textContent = vips.srgbProfilePath || 'Auto-detect';
    elements.colorTransform.value = vips.colorTransform || 'auto';
    
    // VIPS Logging
    elements.vipsProgress.checked = vips.progress !== false;
    elements.vipsInfo.checked = vips.info !== false;
    elements.vipsWarning.checked = vips.warning !== false;
    
    // Advanced settings
    elements.serverPort.value = currentConfig.serverPort || 3000;
    elements.overlap.value = vips.overlap || 1;
    elements.layout.value = vips.layout || 'dz';
    elements.embedIcc.checked = vips.embedIcc === true;
    elements.sequential.checked = vips.sequential !== false;
    elements.novector.checked = vips.novector === true;
}

// Save configuration to main process
async function saveConfig() {
    const newConfig = {
        sourceDir: currentConfig.sourceDir,
        destinationDir: currentConfig.destinationDir,
        serverPort: parseInt(elements.serverPort.value),
        vipsSettings: {
            concurrency: parseInt(elements.concurrency.value),
            maxMemoryMB: parseInt(elements.maxMemory.value),
            bufferSizeMB: parseInt(elements.bufferSize.value),
            tileSize: parseInt(elements.tileSize.value),
            quality: parseInt(elements.quality.value),
            
            autoDetectSrgb: elements.autoDetectSrgb.checked,
            srgbProfilePath: currentConfig.vipsSettings?.srgbProfilePath || '',
            colorTransform: elements.colorTransform.value,
            
            progress: elements.vipsProgress.checked,
            info: elements.vipsInfo.checked,
            warning: elements.vipsWarning.checked,
            
            overlap: parseInt(elements.overlap.value),
            layout: elements.layout.value,
            embedIcc: elements.embedIcc.checked,
            sequential: elements.sequential.checked,
            novector: elements.novector.checked
        }
    };
    
    try {
        await ipcRenderer.invoke('save-config', newConfig);
        currentConfig = { ...currentConfig, ...newConfig };
    } catch (error) {
        console.error('Failed to save config:', error);
    }
}

// Setup event listeners
function setupEventListeners() {
    // Server controls
    elements.startServerBtn.addEventListener('click', startServer);
    elements.stopServerBtn.addEventListener('click', stopServer);
    
    // Folder selection
    elements.selectSourceBtn.addEventListener('click', () => selectFolder('source'));
    elements.selectDestBtn.addEventListener('click', () => selectFolder('destination'));
    elements.selectIccBtn.addEventListener('click', selectIccProfile);
    
    // Configuration changes - auto-save
    const configInputs = [
        elements.concurrency, elements.maxMemory, elements.bufferSize,
        elements.tileSize, elements.quality, elements.colorTransform,
        elements.vipsProgress, elements.vipsInfo, elements.vipsWarning,
        elements.serverPort, elements.overlap, elements.layout,
        elements.embedIcc, elements.sequential, elements.novector,
        elements.autoDetectSrgb
    ];
    
    configInputs.forEach(input => {
        input.addEventListener('change', saveConfig);
    });
    
    // Quality slider real-time update
    elements.quality.addEventListener('input', () => {
        elements.qualityValue.textContent = elements.quality.value;
    });
    
    // Tab switching
    elements.tabs.forEach(tab => {
        tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });
    
    // Slides management
    elements.scanSlidesBtn.addEventListener('click', scanSlides);
    elements.refreshSlidesBtn.addEventListener('click', scanSlides);
    
    // VIPS Info
    elements.getVipsInfoBtn.addEventListener('click', getVipsInfo);
    
    // Console controls
    elements.clearConsoleBtn.addEventListener('click', clearConsole);
    
    // Menu actions from main process
    ipcRenderer.on('menu-action', (event, action) => {
        switch (action) {
            case 'select-source-folder':
                selectFolder('source');
                break;
            case 'select-dest-folder':
                selectFolder('destination');
                break;
            case 'start-server':
                startServer();
                break;
            case 'stop-server':
                stopServer();
                break;
        }
    });
    
    // Server output
    ipcRenderer.on('server-output', (event, data) => {
        appendToConsole(data.data, data.type);
    });
    
    // Server status updates
    ipcRenderer.on('server-status', (event, status) => {
        updateServerStatusUI(status.running, status.pid);
    });
}

// Server management
async function startServer() {
    try {
        await saveConfig(); // Ensure config is saved before starting
        const result = await ipcRenderer.invoke('start-server');
        if (result.success) {
            appendToConsole(`Server starting... (PID: ${result.pid})\n`, 'info');
        } else {
            appendToConsole(`Failed to start server: ${result.message}\n`, 'error');
        }
    } catch (error) {
        appendToConsole(`Error starting server: ${error.message}\n`, 'error');
    }
}

async function stopServer() {
    try {
        const result = await ipcRenderer.invoke('stop-server');
        if (result.success) {
            appendToConsole('Server stopped.\n', 'info');
        } else {
            appendToConsole(`Failed to stop server: ${result.message}\n`, 'error');
        }
    } catch (error) {
        appendToConsole(`Error stopping server: ${error.message}\n`, 'error');
    }
}

async function updateServerStatus() {
    try {
        const status = await ipcRenderer.invoke('get-server-status');
        updateServerStatusUI(status.running, status.pid);
    } catch (error) {
        console.error('Failed to get server status:', error);
    }
}

function updateServerStatusUI(running, pid) {
    if (running) {
        elements.serverIndicator.classList.add('running');
        elements.serverStatusText.textContent = `Server Running (PID: ${pid})`;
        elements.startServerBtn.disabled = true;
        elements.stopServerBtn.disabled = false;
    } else {
        elements.serverIndicator.classList.remove('running');
        elements.serverStatusText.textContent = 'Server Stopped';
        elements.startServerBtn.disabled = false;
        elements.stopServerBtn.disabled = true;
    }
}

// Folder selection
async function selectFolder(type) {
    try {
        const result = await ipcRenderer.invoke('select-folder', type);
        if (result.success) {
            if (type === 'source') {
                currentConfig.sourceDir = result.path;
                elements.sourcePath.textContent = result.path;
            } else {
                currentConfig.destinationDir = result.path;
                elements.destPath.textContent = result.path;
            }
            await saveConfig();
            await scanSlides(); // Refresh slides when folders change
        }
    } catch (error) {
        console.error(`Failed to select ${type} folder:`, error);
    }
}

async function selectIccProfile() {
    try {
        const result = await ipcRenderer.invoke('select-icc-profile');
        if (result.success) {
            currentConfig.vipsSettings.srgbProfilePath = result.path;
            elements.iccPath.textContent = result.path;
            await saveConfig();
        }
    } catch (error) {
        console.error('Failed to select ICC profile:', error);
    }
}

// Slides management
async function scanSlides() {
    try {
        const result = await ipcRenderer.invoke('scan-slides');
        if (result.success) {
            slides = result.slides;
            renderSlides();
        } else {
            appendToConsole(`Failed to scan slides: ${result.error}\n`, 'error');
        }
    } catch (error) {
        appendToConsole(`Error scanning slides: ${error.message}\n`, 'error');
    }
}

function renderSlides() {
    elements.slidesGrid.innerHTML = '';
    
    if (slides.length === 0) {
        elements.slidesGrid.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; color: #888; padding: 40px;">No slides found. Check your source folder path.</div>';
        return;
    }
    
    slides.forEach(slide => {
        const card = document.createElement('div');
        card.className = 'slide-card';
        
        const sizeGB = (slide.size / (1024 * 1024 * 1024)).toFixed(2);
        const modifiedDate = new Date(slide.modified).toLocaleDateString();
        
        card.innerHTML = `
            <div class="slide-name">${slide.name}</div>
            <div class="slide-info">
                Format: ${slide.format.toUpperCase()}<br>
                Size: ${sizeGB} GB<br>
                Modified: ${modifiedDate}<br>
                Status: <span class="converted-badge ${slide.converted ? 'yes' : 'no'}">
                    ${slide.converted ? 'Converted' : 'Not Converted'}
                </span>
            </div>
            <div class="slide-actions">
                <button class="btn btn-small" onclick="convertSlide('${slide.filename}')" 
                        ${slide.converted ? '' : ''}>
                    ${slide.converted ? 'Re-convert' : 'Convert'}
                </button>
                <button class="btn btn-small" onclick="viewSlide('${slide.name}')" 
                        ${slide.converted ? '' : 'disabled'}>
                    View
                </button>
            </div>
        `;
        
        elements.slidesGrid.appendChild(card);
    });
}

// Slide actions
async function convertSlide(filename) {
    try {
        appendToConsole(`Starting conversion of ${filename}...\n`, 'info');
        // This would trigger the conversion via the server API
        // For now, just log the action
        appendToConsole(`Conversion request sent for ${filename}\n`, 'info');
    } catch (error) {
        appendToConsole(`Error converting slide: ${error.message}\n`, 'error');
    }
}

function viewSlide(slideName) {
    const url = `http://localhost:${currentConfig.serverPort || 3000}/?slide=${encodeURIComponent(slideName)}`;
    require('electron').shell.openExternal(url);
}

// Make functions available globally for onclick handlers
window.convertSlide = convertSlide;
window.viewSlide = viewSlide;

// VIPS Info
async function getVipsInfo() {
    try {
        elements.getVipsInfoBtn.disabled = true;
        elements.getVipsInfoBtn.textContent = 'Loading...';
        
        const result = await ipcRenderer.invoke('get-vips-info');
        
        if (result.error) {
            elements.vipsInfoDisplay.textContent = `Error: ${result.error}`;
        } else {
            let info = '';
            if (result.version) {
                info += `VIPS Version: ${result.version}\n\n`;
            }
            if (result.config) {
                info += `VIPS Configuration:\n${result.config}\n\n`;
            }
            if (result.help) {
                info += `VIPS Help:\n${result.help}`;
            }
            elements.vipsInfoDisplay.textContent = info;
        }
    } catch (error) {
        elements.vipsInfoDisplay.textContent = `Error getting VIPS info: ${error.message}`;
    } finally {
        elements.getVipsInfoBtn.disabled = false;
        elements.getVipsInfoBtn.textContent = 'Get VIPS Info';
    }
}

// Tab management
function switchTab(tabName) {
    // Update tab buttons
    elements.tabs.forEach(tab => {
        tab.classList.toggle('active', tab.dataset.tab === tabName);
    });
    
    // Update tab content
    elements.tabContents.forEach(content => {
        content.classList.toggle('active', content.id === `${tabName}-tab`);
    });
}

// Console management
function appendToConsole(text, type = 'stdout') {
    const timestamp = new Date().toLocaleTimeString();
    const line = document.createElement('div');
    line.className = `log-${type}`;
    line.textContent = `[${timestamp}] ${text}`;
    
    elements.consoleOutput.appendChild(line);
    
    // Auto-scroll if enabled
    if (elements.autoScroll.checked) {
        elements.consoleOutput.scrollTop = elements.consoleOutput.scrollHeight;
    }
    
    // Limit console lines to prevent memory issues
    const maxLines = 1000;
    const lines = elements.consoleOutput.children;
    if (lines.length > maxLines) {
        for (let i = 0; i < lines.length - maxLines; i++) {
            elements.consoleOutput.removeChild(lines[0]);
        }
    }
}

function clearConsole() {
    elements.consoleOutput.innerHTML = '';
    appendToConsole('Console cleared.\n', 'info');
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', init);

// Handle window close
window.addEventListener('beforeunload', () => {
    saveConfig();
});
