const { ipcRenderer } = require('electron');

// State management
let currentTerminalTab = 'all';
let serverLogs = {
    all: [],
    backend: [],
    frontend: [],
    conversion: []
};

// DOM elements
let terminalContent;
let slideViewer;
let managementConsole;
let loadingOverlay;
let currentView = 'slide-viewer';

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    terminalContent = document.getElementById('terminal-content');
    slideViewer = document.getElementById('slide-viewer');
    managementConsole = document.getElementById('management-console');
    loadingOverlay = document.getElementById('loading-overlay');
    
    // Start initialization
    initializeApp();
    
    // Set up IPC listeners
    setupIpcListeners();
    
    // Start server status monitoring
    monitorServerStatus();
});

// Initialize the application
function initializeApp() {
    addLogEntry('Initializing Pathology Slide Viewer Desktop...', 'all');
    addLogEntry('Starting backend servers...', 'all');
    
    // Wait for servers to start, then load both interfaces
    setTimeout(() => {
        loadSlideViewer();
        loadManagementConsole();
    }, 3000);
}

// Set up IPC listeners for communication with main process
function setupIpcListeners() {
    // Server log messages
    ipcRenderer.on('server-log', (event, data) => {
        addLogEntry(data.message, data.server);
    });
    
    // Server error messages
    ipcRenderer.on('server-error', (event, data) => {
        addLogEntry(`ERROR: ${data.error}`, data.server, true);
    });
    
    // Server restart requests from menu
    ipcRenderer.on('restart-server', (event, serverName) => {
        restartServer(serverName);
    });
}

// Monitor server status
async function monitorServerStatus() {
    try {
        const status = await ipcRenderer.invoke('get-server-status');
        updateServerStatusIndicators(status);
    } catch (error) {
        console.error('Failed to get server status:', error);
    }
    
    // Check again in 2 seconds
    setTimeout(monitorServerStatus, 2000);
}

// Update server status indicators in header
function updateServerStatusIndicators(status) {
    const backendDot = document.getElementById('backend-status');
    const frontendDot = document.getElementById('frontend-status');
    const conversionDot = document.getElementById('conversion-status');
    
    backendDot.className = `status-dot ${status.backend ? 'online' : ''}`;
    frontendDot.className = `status-dot ${status.frontend ? 'online' : ''}`;
    conversionDot.className = `status-dot ${status.conversion ? 'online' : ''}`;
    
    // Hide loading overlay when GUI server is ready
    if (status.frontend && loadingOverlay.style.display !== 'none') {
        setTimeout(() => {
            loadingOverlay.style.display = 'none';
            slideViewer.style.display = 'block';
        }, 1000);
    }
}

// Load the slide viewer iframe
function loadSlideViewer() {
    addLogEntry('Loading slide viewer interface...', 'all');
    
    // Wait a bit for frontend server to be ready
    setTimeout(() => {
        slideViewer.src = 'http://localhost:3102';
        
        slideViewer.onload = () => {
            addLogEntry('Slide viewer loaded successfully', 'all');
        };
        
        slideViewer.onerror = () => {
            addLogEntry('Failed to load slide viewer - checking server status...', 'all', true);
        };
    }, 2000);
}

// Load the management console iframe
function loadManagementConsole() {
    addLogEntry('Loading management console interface...', 'all');
    
    // Wait a bit for GUI server to be ready
    setTimeout(() => {
        managementConsole.src = 'http://localhost:3003';
        
        managementConsole.onload = () => {
            addLogEntry('Management console loaded successfully', 'all');
        };
        
        managementConsole.onerror = () => {
            addLogEntry('Failed to load management console - checking server status...', 'all', true);
        };
    }, 2500);
}

// Add log entry to terminal
function addLogEntry(message, server = 'all', isError = false) {
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = document.createElement('div');
    logEntry.className = `log-entry ${server} ${isError ? 'error' : ''}`;
    logEntry.textContent = `[${timestamp}] ${message}`;
    
    // Add to appropriate log arrays
    serverLogs.all.push(logEntry.cloneNode(true));
    if (server !== 'all') {
        serverLogs[server].push(logEntry.cloneNode(true));
    }
    
    // Update display if current tab matches
    if (currentTerminalTab === 'all' || currentTerminalTab === server) {
        terminalContent.appendChild(logEntry);
        terminalContent.scrollTop = terminalContent.scrollHeight;
    }
    
    // Limit log entries to prevent memory issues
    Object.keys(serverLogs).forEach(key => {
        if (serverLogs[key].length > 1000) {
            serverLogs[key] = serverLogs[key].slice(-500);
        }
    });
}

// Switch terminal tab
function switchTerminalTab(tab) {
    currentTerminalTab = tab;
    
    // Update tab appearance
    document.querySelectorAll('.terminal-tab').forEach(tabEl => {
        tabEl.classList.remove('active');
    });
    document.querySelector(`[data-tab="${tab}"]`).classList.add('active');
    
    // Clear and repopulate terminal content
    terminalContent.innerHTML = '';
    serverLogs[tab].forEach(logEntry => {
        terminalContent.appendChild(logEntry.cloneNode(true));
    });
    terminalContent.scrollTop = terminalContent.scrollHeight;
}

// Clear logs
function clearLogs() {
    serverLogs[currentTerminalTab] = [];
    terminalContent.innerHTML = '';
    addLogEntry(`Cleared ${currentTerminalTab} logs`, 'all');
}

// Switch between slide viewer and management console
function switchView(viewName) {
    const slideViewerPanel = document.getElementById('slide-viewer-panel');
    const managementConsolePanel = document.getElementById('management-console-panel');
    const viewTabs = document.querySelectorAll('.view-tab');
    
    // Update active states
    viewTabs.forEach(tab => tab.classList.remove('active'));
    
    if (viewName === 'slide-viewer') {
        slideViewerPanel.classList.add('active');
        managementConsolePanel.classList.remove('active');
        document.querySelector('[onclick="switchView(\'slide-viewer\')"]').classList.add('active');
        currentView = 'slide-viewer';
        addLogEntry('Switched to Slide Viewer', 'all');
    } else if (viewName === 'management-console') {
        slideViewerPanel.classList.remove('active');
        managementConsolePanel.classList.add('active');
        document.querySelector('[onclick="switchView(\'management-console\')"]').classList.add('active');
        currentView = 'management-console';
        addLogEntry('Switched to Management Console', 'all');
    }
}

// Server management functions
async function restartServer(serverName) {
    addLogEntry(`Restarting ${serverName} server...`, serverName);
    
    try {
        await ipcRenderer.invoke('restart-server', serverName);
        addLogEntry(`${serverName} server restart initiated`, serverName);
        
        // If restarting frontend, reload the iframe after a delay
        if (serverName === 'frontend') {
            setTimeout(() => {
                slideViewer.src = slideViewer.src; // Reload iframe
            }, 3000);
        }
    } catch (error) {
        addLogEntry(`Failed to restart ${serverName} server: ${error.message}`, serverName, true);
    }
}

async function restartAllServers() {
    addLogEntry('Restarting all servers...', 'all');
    
    await restartServer('backend');
    await restartServer('frontend');
    await restartServer('conversion');
    
    // Reload slide viewer after all servers restart
    setTimeout(() => {
        loadSlideViewer();
    }, 5000);
}

// File management functions
async function openSlidesFolder() {
    try {
        const path = require('path');
        const slidesPath = path.join(__dirname, 'public', 'slides');
        await ipcRenderer.invoke('open-file-explorer', slidesPath);
        addLogEntry('Opened slides folder', 'all');
    } catch (error) {
        addLogEntry(`Failed to open slides folder: ${error.message}`, 'all', true);
    }
}

async function openDziFolder() {
    try {
        const path = require('path');
        const dziPath = path.join(__dirname, 'public', 'dzi');
        await ipcRenderer.invoke('open-file-explorer', dziPath);
        addLogEntry('Opened DZI folder', 'all');
    } catch (error) {
        addLogEntry(`Failed to open DZI folder: ${error.message}`, 'all', true);
    }
}

async function loadRecentSlides() {
    try {
        const fs = require('fs');
        const path = require('path');
        const slidesPath = path.join(__dirname, 'public', 'slides');
        
        if (!fs.existsSync(slidesPath)) {
            document.getElementById('recent-slides').innerHTML = '<div class="file-item">No slides folder found</div>';
            return;
        }
        
        const files = fs.readdirSync(slidesPath)
            .filter(file => /\.(svs|ndpi|tif|tiff|jp2|vms|vmu|scn)$/i.test(file))
            .sort((a, b) => {
                const statA = fs.statSync(path.join(slidesPath, a));
                const statB = fs.statSync(path.join(slidesPath, b));
                return statB.mtime - statA.mtime;
            })
            .slice(0, 10); // Show only 10 most recent
        
        const recentSlidesContainer = document.getElementById('recent-slides');
        
        if (files.length === 0) {
            recentSlidesContainer.innerHTML = '<div class="file-item">No slide files found</div>';
            return;
        }
        
        recentSlidesContainer.innerHTML = files.map(file => 
            `<div class="file-item" onclick="openSlide('${file}')" title="${file}">${file}</div>`
        ).join('');
        
    } catch (error) {
        addLogEntry(`Failed to load recent slides: ${error.message}`, 'all', true);
        document.getElementById('recent-slides').innerHTML = '<div class="file-item">Error loading files</div>';
    }
}

function refreshFileList() {
    addLogEntry('Refreshing file list...', 'all');
    loadRecentSlides();
}

function openSlide(filename) {
    addLogEntry(`Opening slide: ${filename}`, 'all');
    
    // Send message to slide viewer iframe to open specific slide
    if (slideViewer.contentWindow) {
        slideViewer.contentWindow.postMessage({
            action: 'openSlide',
            filename: filename
        }, '*');
    }
}

// Configuration functions
function openConfigPage() {
    // Open config in a new window or navigate iframe to config page
    if (slideViewer.contentWindow) {
        slideViewer.src = 'http://localhost:3102/config.html';
        addLogEntry('Opened configuration page', 'all');
    }
}

function viewLogs() {
    // Switch to 'all' tab to show all logs
    switchTerminalTab('all');
    addLogEntry('Viewing all server logs', 'all');
}

// Handle iframe messages
window.addEventListener('message', (event) => {
    if (event.origin !== 'http://localhost:3102') return;
    
    // Handle messages from the slide viewer iframe
    if (event.data.action === 'slideOpened') {
        addLogEntry(`Slide opened: ${event.data.filename}`, 'frontend');
    } else if (event.data.action === 'conversionStarted') {
        addLogEntry(`Conversion started: ${event.data.filename}`, 'conversion');
    } else if (event.data.action === 'conversionCompleted') {
        addLogEntry(`Conversion completed: ${event.data.filename}`, 'conversion');
        refreshFileList(); // Refresh the file list when conversion completes
    }
});

// Keyboard shortcuts
document.addEventListener('keydown', (event) => {
    // Ctrl+R or F5 - Reload slide viewer
    if ((event.ctrlKey && event.key === 'r') || event.key === 'F5') {
        event.preventDefault();
        slideViewer.src = slideViewer.src;
        addLogEntry('Reloaded slide viewer', 'all');
    }
    
    // Ctrl+Shift+R - Restart all servers
    if (event.ctrlKey && event.shiftKey && event.key === 'R') {
        event.preventDefault();
        restartAllServers();
    }
    
    // Ctrl+` - Focus terminal
    if (event.ctrlKey && event.key === '`') {
        event.preventDefault();
        terminalContent.focus();
    }
});

// Export functions for global access
window.switchView = switchView;
window.restartServer = restartServer;
window.restartAllServers = restartAllServers;
window.openSlidesFolder = openSlidesFolder;
window.openDziFolder = openDziFolder;
window.refreshFileList = refreshFileList;
window.openConfigPage = openConfigPage;
window.viewLogs = viewLogs;
window.switchTerminalTab = switchTerminalTab;
window.clearLogs = clearLogs;
