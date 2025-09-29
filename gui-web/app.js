// Pathology Slide Viewer - Web GUI Client
// Handles UI interactions and communication with GUI server

let currentConfig = {};
let slides = [];
let ws = null;
// DOM Elements - will be initialized after DOM loads
let elements = {};

// ===== API BASE (GUI on 3003 -> Main server on 3102) =====
function getApiBase() {
    // When served from backend /config route, API calls are direct
    return '';
}
function setApiBase(newBase) {
    // No-op when using direct backend access
}

// Initialize DOM elements after DOM is loaded
function initializeElements() {
    console.log('Initializing DOM elements...');
    elements = {
        // Server controls
        guiIndicator: document.getElementById('guiIndicator'),
        backendIndicator: document.getElementById('backendIndicator'),
        conversionIndicator: document.getElementById('conversionIndicator'),
        guiUrl: document.getElementById('guiUrl'),
        backendUrl: document.getElementById('backendUrl'),
        conversionUrl: document.getElementById('conversionUrl'),
        startServerBtn: document.getElementById('startServerBtn'),
        stopServerBtn: document.getElementById('stopServerBtn'),
        
        // Configuration Tabs
        tabBtns: document.querySelectorAll('.tab-btn'),
        tabPanels: document.querySelectorAll('.tab-panel'),
        
        // System Configuration
        deploymentMode: document.getElementById('deploymentMode'),
        mainServerPort: document.getElementById('mainServerPort'),
        slidesDir: document.getElementById('slidesDir'),
        dziDir: document.getElementById('dziDir'),
        tempDir: document.getElementById('tempDir'),
        autoProcessorEnabled: document.getElementById('autoProcessorEnabled'),
        fileStabilityThreshold: document.getElementById('fileStabilityThreshold'),
        retryDelay: document.getElementById('retryDelay'),
        
        // VIPS Configuration
        vipsConcurrency: document.getElementById('vipsConcurrency'),
        vipsCacheMemory: document.getElementById('vipsCacheMemory'),
        vipsCacheMaxFiles: document.getElementById('vipsCacheMaxFiles'),
        defaultConcurrency: document.getElementById('defaultConcurrency'),
        vipsQuality: document.getElementById('vipsQuality'),
        vipsQualityValue: document.getElementById('vipsQualityValue'),
        vipsCompression: document.getElementById('vipsCompression'),
        vipsBigtiff: document.getElementById('vipsBigtiff'),
        vipsVector: document.getElementById('vipsVector'),
        vipsWarning: document.getElementById('vipsWarning'),
        conversionTimeout: document.getElementById('conversionTimeout'),
        pollInterval: document.getElementById('pollInterval'),
        
        // Server Management
        totalServersMetric: document.getElementById('totalServersMetric'),
        activeServersMetric: document.getElementById('activeServersMetric'),
        totalConversionsMetric: document.getElementById('totalConversionsMetric'),
        serversList: document.getElementById('serversList'),
        addServerBtn: document.getElementById('addServerBtn'),
        addServerForm: document.getElementById('addServerForm'),
        cancelAddServerBtn: document.getElementById('cancelAddServerBtn'),
        refreshServersBtn: document.getElementById('refreshServersBtn'),
        
        // Configuration Actions
        saveConfigBtn: document.getElementById('saveConfigBtn'),
        reloadConfigBtn: document.getElementById('reloadConfigBtn'),
        validateConfigBtn: document.getElementById('validateConfigBtn'),
        
        // Messages
        validationErrors: document.getElementById('validationErrors'),
        successMessage: document.getElementById('successMessage'),
        
        // Legacy elements for backward compatibility (removed main tabs)
        // tabs: document.querySelectorAll('.tab'),
        // tabContents: document.querySelectorAll('.tab-content'),
        
        // Slides
        scanSlidesBtn: document.getElementById('scanSlidesBtn'),
        refreshSlidesBtn: document.getElementById('refreshSlidesBtn'),
        slidesGrid: document.getElementById('slidesGrid'),
        importSlidesBtn: document.getElementById('importSlidesBtn'),
        importSlidesInput: document.getElementById('importSlidesInput'),
        
        // VIPS Info
        getVipsInfoBtn: document.getElementById('getVipsInfoBtn'),
        vipsInfoOutput: document.getElementById('vipsInfoOutput'),
        
        // Console
        consoleOutput: document.getElementById('consoleOutput'),
        clearConsoleBtn: document.getElementById('clearConsoleBtn'),
        autoScroll: document.getElementById('autoScroll'),
        
        // Additional form elements
        serverPort: document.getElementById('serverPort'),
        overlap: document.getElementById('overlap'),
        layout: document.getElementById('layout'),
        embedIcc: document.getElementById('embedIcc'),
        sequential: document.getElementById('sequential'),
        novector: document.getElementById('novector'),
        
        // Legacy configuration elements
        sourcePath: document.getElementById('sourcePath'),
        destPath: document.getElementById('destPath'),
        selectSourceBtn: document.getElementById('selectSourceBtn'),
        selectDestBtn: document.getElementById('selectDestBtn'),
        
        // Legacy VIPS settings
        concurrency: document.getElementById('concurrency'),
        maxMemory: document.getElementById('maxMemory'),
        bufferSize: document.getElementById('bufferSize'),
        tileSize: document.getElementById('tileSize'),
        quality: document.getElementById('quality'),
        qualityValue: document.getElementById('qualityValue'),
        colorTransform: document.getElementById('colorTransform'),
        autoDetectSrgb: document.getElementById('autoDetectSrgb'),
        vipsProgress: document.getElementById('vipsProgress'),
        vipsInfo: document.getElementById('vipsInfo'),
        autoDeleteOriginal: document.getElementById('autoDeleteOriginal'),
        serverPort: document.getElementById('serverPort'),
        overlap: document.getElementById('overlap'),
        layout: document.getElementById('layout'),
        embedIcc: document.getElementById('embedIcc'),
        sequential: document.getElementById('sequential'),
        novector: document.getElementById('novector'),
        
        // Server status elements
        serverIndicator: document.getElementById('serverIndicator'),
        serverStatusText: document.getElementById('serverStatusText')
    };
    
    console.log('🎯 DOM elements initialized. slidesGrid found:', !!elements.slidesGrid);
    console.log('🎯 Configuration tabs found:', {
        tabBtns: elements.tabBtns ? elements.tabBtns.length : 0,
        tabPanels: elements.tabPanels ? elements.tabPanels.length : 0
    });
}

// Dynamically inject the ICC intermediate format toggle into the VIPS tab
function ensureIccFormatTogglePresent() {
    try {
        // Find the compression select and insert after its parent .form-group
        const compressionSelect = document.getElementById('vipsCompression');
        if (!compressionSelect) {
            console.log('🔧 Debug - vipsCompression not found, retrying in 1s...');
            setTimeout(ensureIccFormatTogglePresent, 1000);
            return;
        }
        const formGroup = compressionSelect.closest('.form-group');
        if (!formGroup) return;

        // Avoid duplicate insertion
        if (document.getElementById('useVipsFormat')) {
            console.log('🔧 Debug - useVipsFormat checkbox already exists');
            return;
        }

        const container = document.createElement('div');
        container.className = 'form-group';
        container.innerHTML = `
            <label style="display:flex; align-items:center; gap:8px;">
                <input type="checkbox" id="useVipsFormat">
                Use VIPS .v as intermediate format (faster I/O, larger temp files)
            </label>
            <div class="help-text" style="font-size:11px; color:#bbb; margin-top:6px;">
                When enabled, ICC intermediates are written as .v (no compression). When disabled, compressed TIFF (.tif) is used.
            </div>
        `;

        // Insert after compression form-group
        formGroup.parentNode.insertBefore(container, formGroup.nextSibling);
        console.log('🔧 Debug - ICC format toggle injected successfully');

        // Hook change to preview update
        const chk = container.querySelector('#useVipsFormat');
        if (chk) {
            chk.addEventListener('change', () => {
                console.log('🔧 Debug - useVipsFormat changed to:', chk.checked);
            });
        }
        
        // Load current state from config
        updateConfigurationUI();
    } catch (e) {
        console.warn('Failed to inject ICC format toggle:', e.message);
    }
}

// Rename slide function
async function renameSlide(currentName, filename) {
    const newName = prompt(`Rename slide "${currentName}":`, currentName);
    if (!newName || newName.trim() === '' || newName.trim() === currentName) {
        return; // User cancelled or no change
    }

    try {
        const response = await fetch(`/api/slides/${encodeURIComponent(currentName)}/rename`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ newName: newName.trim() })
        });

        const result = await response.json();

        if (response.ok) {
            appendToConsole(`Slide renamed successfully: ${currentName} → ${newName.trim()}\n`, 'info');
            // Refresh the slide list to show the new name
            await scanSlides();
        } else {
            appendToConsole(`Failed to rename slide: ${result.error}\n`, 'error');
            alert(`Failed to rename slide: ${result.error}`);
        }
    } catch (error) {
        console.error('Error renaming slide:', error);
        appendToConsole(`Error renaming slide: ${error.message}\n`, 'error');
        alert('Failed to rename slide. Please try again.');
    }
}


// Initialize the application
async function init() {
    console.log('🚀 Starting GUI initialization...');
    
    try {
        console.log('🎯 Initializing DOM elements...');
        initializeElements();
        
        console.log('📋 Loading configuration...');
        await loadConfig();
        
        console.log('🔧 Loading pathology configuration...');
        await loadPathologyConfig();
        
        console.log('🎨 Updating configuration UI...');
        updateConfigurationUI();
        // Ensure the ICC toggle exists in the VIPS tab
        ensureIccFormatTogglePresent();
        
        console.log('🎛️ Setting up event listeners...');
        setupEventListeners();
        
        console.log('📑 Setting up configuration tabs...');
        setupConfigurationTabs();
        
        console.log('🔌 Setting up WebSocket...');
        setupWebSocket();
        
        console.log('📊 Updating server status...');
        await updateServerStatus();
        
        console.log('🖥️ Refreshing servers list...');
        await refreshServersList();
        
        console.log('💓 Starting backend health polling...');
        startBackendHealthPolling();
        
        console.log('📈 Starting server monitoring...');
        startServerMonitoring();
        
        console.log('🔍 Scanning for slides...');
        await scanSlides();
        
        console.log('✅ GUI initialization completed successfully!');
        
        // Add event listener for rename buttons
        document.addEventListener('click', function(e) {
            if (e.target.classList.contains('rename-btn')) {
                const slideName = e.target.getAttribute('data-slide-name');
                const filename = e.target.getAttribute('data-filename');
                renameSlide(slideName, filename);
            }
        });
        
    } catch (error) {
        console.error('❌ GUI initialization failed:', error);
    }
}

// Start periodic server monitoring
function startServerMonitoring() {
    // Refresh server list every 10 seconds
    setInterval(async () => {
        try {
            await refreshServersList();
        } catch (error) {
            console.error('Error during periodic server refresh:', error);
        }
    }, 10000);
    
    // Update server status every 5 seconds
    setInterval(async () => {
        try {
            await updateServerStatus();
        } catch (error) {
            console.error('Error during periodic status update:', error);
        }
    }, 5000);
}

// WebSocket connection
function setupWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    
    ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
        appendToConsole('Connected to GUI server\n', 'info');
    };
    
    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            handleWebSocketMessage(data);
        } catch (error) {
            console.error('Failed to parse WebSocket message:', error);
        }
    };
    
    ws.onclose = () => {
        appendToConsole('Disconnected from GUI server\n', 'warning');
        // Attempt to reconnect after 3 seconds
        setTimeout(setupWebSocket, 3000);
    };
    
    ws.onerror = (error) => {
        appendToConsole(`WebSocket error: ${error}\n`, 'error');
    };
}

function handleWebSocketMessage(data) {
    switch (data.type) {
        case 'server-status':
            updateServerStatusUI(data.running, data.pid);
            break;
        case 'server-output':
            appendToConsole(data.data, data.stream);
            break;
        case 'config_updated':
            // Configuration was updated, refresh UI
            pathologyConfig = data.config;
            updateConfigurationUI();
            showMessage('Configuration updated from server', 'success');
            break;
        case 'config_reloaded':
            // Configuration was reloaded, refresh UI
            pathologyConfig = data.config;
            updateConfigurationUI();
            showMessage('Configuration reloaded from server', 'success');
            break;
        case 'conversion_server_added':
            // New conversion server was added
            showMessage(`Conversion server "${data.server.id}" added`, 'success');
            refreshServersList();
            break;
        case 'conversion_server_removed':
            // Conversion server was removed
            showMessage(`Conversion server "${data.serverId}" removed`, 'success');
            refreshServersList();
            break;
        case 'conversion_progress':
            updateProgressPanel(data);
            updateInTileProgress(data);
            console.log('Progress update received:', data); // Debug log
            // Ensure progress UI is visible when progress updates are received
            if (data.filename) {
                ensureCancelButtonVisible(data.filename);
                // Respawn/show progress UI if it's not visible
                showAutoConversionUI(data.filename);
                // Start timer if not already running
                startConversionTimer(data.filename);
            }
            // Check if conversion is complete (100%) and refresh status
            if (data.percent >= 100) {
                setTimeout(() => {
                    scanSlides();
                }, 1000); // Wait 1 second before refreshing to ensure completion
            }
            break;
        case 'conversion_complete':
            finalizeProgressPanel(data);
            // Reset button states on completion
            resetConversionButtons(data.filename);
            // Stop timer for this conversion
            stopConversionTimer(data.filename);
            // Refresh slide list to show converted status
            setTimeout(() => {
                scanSlides();
            }, 1000);
            break;
        case 'conversion_cancelled':
            appendToConsole(`Conversion cancelled for ${data.filename}\n`, 'info');
            resetConversionButtons(data.filename);
            // Stop timer for cancelled conversion
            stopConversionTimer(data.filename);
            // Hide progress panel immediately on cancellation
            hideProgressPanel(data.filename);
            // Also hide the main progress panel
            hideMainProgressPanel();
            // Force reset all stuck buttons as fallback
            setTimeout(() => forceResetAllCancelButtons(), 1000);
            // Refresh the slide card after cancellation is complete
            setTimeout(() => refreshSlideCard(data.filename), 1500);
            break;
        case 'conversion_error':
            appendToConsole(`Conversion failed for ${data.filename}: ${data.error}\n`, 'error');
            resetConversionButtons(data.filename);
            // Stop timer for failed conversion
            stopConversionTimer(data.filename);
            break;
        case 'conversion_auto_delete':
            appendToConsole(`Auto-deleted original SVS: ${data.originalFile} after converting ${data.filename}\n`, 'info');
            break;
        case 'auto_processing_started':
            // Show cancel button and progress for automatic conversions
            console.log('Auto processing started event received:', data);
            showAutoConversionUI(data.filename || data.fileName);
            // Start timer for this conversion
            startConversionTimer(data.filename || data.fileName);
            break;
        case 'conversion_started':
            // Handle manual conversion started - should also show progress UI
            console.log('Manual conversion started event received:', data);
            showAutoConversionUI(data.filename);
            // Start timer for this conversion
            startConversionTimer(data.filename);
            break;
        case 'auto_conversion_complete':
            // Reset UI after auto conversion completes
            resetConversionButtons(data.fileName);
            // Stop timer for completed auto conversion
            stopConversionTimer(data.fileName);
            // Refresh slide list to show converted status
            setTimeout(() => {
                scanSlides();
            }, 1000);
            break;
        case 'auto_conversion_error':
            // Reset UI after auto conversion fails
            resetConversionButtons(data.fileName);
            // Stop timer for failed auto conversion
            stopConversionTimer(data.fileName);
            break;
    }
}

// Refresh slide card after cancellation
function refreshSlideCard(filename) {
    console.log(`Refreshing slide card for: ${filename}`);
    
    // Try multiple filename formats
    const originalFilename = filename;
    const baseFilename = originalFilename.replace(/\.svs$/i, '');
    const fullFilename = originalFilename.endsWith('.svs') ? originalFilename : originalFilename + '.svs';
    
    const safeOriginal = originalFilename.replace(/[^a-zA-Z0-9]/g, '_');
    const safeBase = baseFilename.replace(/[^a-zA-Z0-9]/g, '_');
    const safeFull = fullFilename.replace(/[^a-zA-Z0-9]/g, '_');
    
    // Find the slide card element
    let slideCard = document.querySelector(`[data-filename="${originalFilename}"]`) ||
                   document.querySelector(`[data-filename="${baseFilename}"]`) ||
                   document.querySelector(`[data-filename="${fullFilename}"]`);
    
    if (!slideCard) {
        // Try by ID or class patterns
        slideCard = document.getElementById(`slide-${safeOriginal}`) ||
                   document.getElementById(`slide-${safeBase}`) ||
                   document.getElementById(`slide-${safeFull}`) ||
                   document.querySelector(`.slide-item[id*="${safeBase}"]`);
    }
    
    if (slideCard) {
        console.log(`Found slide card, refreshing UI elements for: ${filename}`);
        
        // Reset all UI elements to clean state
        const convertBtn = slideCard.querySelector('[class*="convert-btn"]');
        const cancelBtn = slideCard.querySelector('[class*="cancel-btn"]');
        const progressDiv = slideCard.querySelector('[id*="progress"]');
        
        if (convertBtn) {
            convertBtn.textContent = 'Convert';
            convertBtn.disabled = false;
            convertBtn.style.display = 'inline-block';
            console.log('Reset convert button');
        }
        
        if (cancelBtn) {
            cancelBtn.style.display = 'none';
            cancelBtn.disabled = false;
            console.log('Hidden cancel button');
        }
        
        if (progressDiv) {
            progressDiv.style.display = 'none';
            // Clear any progress content
            const progressBar = progressDiv.querySelector('.progress-bar');
            const progressText = progressDiv.querySelector('.progress-text');
            if (progressBar) progressBar.style.width = '0%';
            if (progressText) progressText.textContent = '';
            console.log('Reset progress div');
        }
        
        // Add a visual refresh indicator
        slideCard.style.transition = 'opacity 0.3s ease';
        slideCard.style.opacity = '0.7';
        setTimeout(() => {
            slideCard.style.opacity = '1';
            setTimeout(() => {
                slideCard.style.transition = '';
            }, 300);
        }, 150);
        
        console.log(`Slide card refresh completed for: ${filename}`);
    } else {
        console.warn(`Could not find slide card to refresh for: ${filename}`);
        // List available slide cards for debugging
        const allSlideCards = document.querySelectorAll('.slide-item, [data-filename], [id*="slide-"]');
        console.log('Available slide cards:', Array.from(allSlideCards).map(card => ({
            id: card.id,
            dataFilename: card.getAttribute('data-filename'),
            className: card.className
        })));
    }
}

// Reset conversion button states
function resetConversionButtons(filename) {
    // Handle undefined filename
    if (!filename) {
        console.warn('resetConversionButtons called with undefined filename');
        return;
    }
    
    // Try multiple filename formats
    const originalFilename = filename;
    const baseFilename = originalFilename.replace(/\.svs$/i, '');
    const fullFilename = originalFilename.endsWith('.svs') ? originalFilename : originalFilename + '.svs';
    
    const safeOriginal = originalFilename.replace(/[^a-zA-Z0-9]/g, '_');
    const safeBase = baseFilename.replace(/[^a-zA-Z0-9]/g, '_');
    const safeFull = fullFilename.replace(/[^a-zA-Z0-9]/g, '_');
    
    console.log('Resetting buttons for:', filename, { safeOriginal, safeBase, safeFull });
    
    let convertBtn = document.querySelector(`.convert-btn-${safeOriginal}`) || 
                    document.querySelector(`.convert-btn-${safeBase}`) || 
                    document.querySelector(`.convert-btn-${safeFull}`);
    let cancelBtn = document.querySelector(`.cancel-btn-${safeOriginal}`) || 
                   document.querySelector(`.cancel-btn-${safeBase}`) || 
                   document.querySelector(`.cancel-btn-${safeFull}`);
    
    console.log('Found buttons for reset:', { convertBtn, cancelBtn });
    
    if (convertBtn) {
        convertBtn.textContent = 'Convert';
        convertBtn.disabled = false;
        convertBtn.style.display = 'inline-block';
        console.log('Convert button reset');
    }
    
    if (cancelBtn) {
        cancelBtn.textContent = 'Cancel';
        cancelBtn.disabled = false;
        cancelBtn.style.display = 'none';
        console.log('Cancel button reset and hidden');
    }
    
    if (!convertBtn || !cancelBtn) {
        console.error('Could not find buttons to reset for:', filename);
        // List all available buttons for debugging
        const allConvertBtns = document.querySelectorAll('[class*="convert-btn"]');
        const allCancelBtns = document.querySelectorAll('[class*="cancel-btn"]');
        console.log('Available convert buttons:', Array.from(allConvertBtns).map(btn => btn.className));
        console.log('Available cancel buttons:', Array.from(allCancelBtns).map(btn => btn.className));
    }
}

// Show cancel button and progress for automatic conversions
function showAutoConversionUI(filename) {
    // Check if filename exists to prevent undefined errors
    if (!filename) {
        console.warn('showAutoConversionUI called without filename');
        return;
    }
    
    // Try multiple filename formats like manual conversions
    const originalFilename = filename;
    const baseFilename = originalFilename.replace(/\.svs$/i, '');
    const fullFilename = originalFilename.endsWith('.svs') ? originalFilename : originalFilename + '.svs';
    
    const safeOriginal = originalFilename.replace(/[^a-zA-Z0-9]/g, '_');
    const safeBase = baseFilename.replace(/[^a-zA-Z0-9]/g, '_');
    const safeFull = fullFilename.replace(/[^a-zA-Z0-9]/g, '_');
    
    console.log('Showing auto-conversion UI for:', filename, {
        originalFilename,
        baseFilename,
        fullFilename,
        safeOriginal,
        safeBase,
        safeFull
    });
    
    // Try to find elements with all filename formats (same as manual conversions)
    let convertBtn = document.querySelector(`.convert-btn-${safeOriginal}`) || 
                    document.querySelector(`.convert-btn-${safeBase}`) || 
                    document.querySelector(`.convert-btn-${safeFull}`);
    let cancelBtn = document.querySelector(`.cancel-btn-${safeOriginal}`) || 
                   document.querySelector(`.cancel-btn-${safeBase}`) || 
                   document.querySelector(`.cancel-btn-${safeFull}`);
    let progressDiv = document.getElementById(`progress-${safeOriginal}`) || 
                     document.getElementById(`progress-${safeBase}`) || 
                     document.getElementById(`progress-${safeFull}`);
    
    console.log('Found elements for auto-conversion:', { convertBtn, cancelBtn, progressDiv });
    
    if (convertBtn) {
        convertBtn.textContent = 'Auto-Converting...';
        convertBtn.disabled = true;
        convertBtn.style.display = 'none';
        console.log('Convert button hidden for auto-conversion');
    }
    if (cancelBtn) {
        cancelBtn.textContent = 'Cancel';
        cancelBtn.disabled = false;
        cancelBtn.style.display = 'inline-block';
        cancelBtn.style.visibility = 'visible';
        console.log('Auto-conversion cancel button made visible:', cancelBtn.className);
    } else {
        console.error('Auto-conversion cancel button not found for any format:', safeOriginal, safeBase, safeFull);
        // List all available cancel buttons for debugging
        const allCancelBtns = document.querySelectorAll('[class*="cancel-btn"]');
        console.log('Available cancel buttons:', Array.from(allCancelBtns).map(btn => btn.className));
    }
    if (progressDiv) {
        progressDiv.style.display = 'block';
        console.log('Progress div shown for auto-conversion:', progressDiv.id);
    } else {
        console.error('Progress div not found for auto-conversion:', safeOriginal, safeBase, safeFull);
        // Try to create progress div if it doesn't exist
        createProgressDiv(filename);
        // List all available progress divs for debugging
        const allProgressDivs = document.querySelectorAll('[id*="progress-"]');
        console.log('Available progress divs:', Array.from(allProgressDivs).map(div => div.id));
    }
}

// Create progress div dynamically if it doesn't exist
function createProgressDiv(filename) {
    if (!filename) return;
    
    const safeFilename = filename.replace(/[^a-zA-Z0-9]/g, '_');
    const progressId = `progress-${safeFilename}`;
    
    // Check if progress div already exists
    if (document.getElementById(progressId)) {
        return;
    }
    
    // Find the slide card to attach progress to
    const slideCard = document.querySelector(`[data-filename="${filename}"]`) || 
                     document.querySelector(`[data-filename="${filename.replace(/\.svs$/i, '')}"]`) ||
                     document.querySelector(`[data-filename="${filename}.svs"]`);
    
    if (!slideCard) {
        console.warn('Could not find slide card to attach progress div for:', filename);
        return;
    }
    
    // Create progress div HTML
    const progressDiv = document.createElement('div');
    progressDiv.id = progressId;
    progressDiv.className = 'progress-container';
    progressDiv.style.display = 'block';
    progressDiv.innerHTML = `
        <div class="progress-bar">
            <div class="progress-fill" style="width: 0%;"></div>
        </div>
        <div class="progress-info">
            <span class="progress-phase">Starting...</span>
            <span class="progress-percent">0%</span>
            <span class="progress-time">0s</span>
        </div>
    `;
    
    // Insert progress div into slide card
    slideCard.appendChild(progressDiv);
    console.log('Created progress div:', progressId);
}

// Ensure cancel button is visible during conversions
function ensureCancelButtonVisible(filename) {
    // Check if filename exists to prevent undefined errors
    if (!filename) {
        console.warn('ensureCancelButtonVisible called without filename');
        return;
    }
    
    // Try multiple filename formats
    const originalFilename = filename;
    const baseFilename = originalFilename.replace(/\.svs$/i, '');
    const fullFilename = originalFilename.endsWith('.svs') ? originalFilename : originalFilename + '.svs';
    
    const safeOriginal = originalFilename.replace(/[^a-zA-Z0-9]/g, '_');
    const safeBase = baseFilename.replace(/[^a-zA-Z0-9]/g, '_');
    const safeFull = fullFilename.replace(/[^a-zA-Z0-9]/g, '_');
    
    console.log('Ensuring cancel button visible for:', filename, {
        originalFilename,
        baseFilename,
        fullFilename,
        safeOriginal,
        safeBase,
        safeFull
    });
    
    let convertBtn = document.querySelector(`.convert-btn-${safeOriginal}`) || 
                    document.querySelector(`.convert-btn-${safeBase}`) || 
                    document.querySelector(`.convert-btn-${safeFull}`);
    let cancelBtn = document.querySelector(`.cancel-btn-${safeOriginal}`) || 
                   document.querySelector(`.cancel-btn-${safeBase}`) || 
                   document.querySelector(`.cancel-btn-${safeFull}`);
    
    console.log('Found buttons:', { convertBtn, cancelBtn });
    
    if (convertBtn && convertBtn.style.display !== 'none') {
        convertBtn.textContent = 'Converting...';
        convertBtn.disabled = true;
        convertBtn.style.display = 'none';
        console.log('Convert button hidden');
    }
    
    if (cancelBtn) {
        cancelBtn.textContent = 'Cancel';
        cancelBtn.style.display = 'inline-block';
        cancelBtn.style.visibility = 'visible';
        console.log('Cancel button made visible during progress update for:', filename);
    } else {
        console.error('Cancel button not found for any format:', safeOriginal, safeBase, safeFull);
        // List all available cancel buttons for debugging
        const allCancelBtns = document.querySelectorAll('[class*="cancel-btn"]');
        console.log('Available cancel buttons:', Array.from(allCancelBtns).map(btn => btn.className));
    }
}

// Update in-tile progress display
function updateInTileProgress(data) {
    // Check if filename exists to prevent undefined errors
    if (!data.filename) {
        console.warn('Progress update received without filename:', data);
        return;
    }
    
    // Try multiple filename formats to find the correct progress div
    const originalFilename = data.filename;
    const baseFilename = originalFilename.replace(/\.svs$/i, '');
    const fullFilename = originalFilename.endsWith('.svs') ? originalFilename : originalFilename + '.svs';
    
    const safeOriginal = originalFilename.replace(/[^a-zA-Z0-9]/g, '_');
    const safeBase = baseFilename.replace(/[^a-zA-Z0-9]/g, '_');
    const safeFull = fullFilename.replace(/[^a-zA-Z0-9]/g, '_');
    
    console.log('Progress update - Original filename:', originalFilename);
    console.log('Trying filename formats:', { safeOriginal, safeBase, safeFull });
    
    // Try to find progress div with different formats
    let progressDiv = document.getElementById(`progress-${safeOriginal}`) ||
                     document.getElementById(`progress-${safeBase}`) ||
                     document.getElementById(`progress-${safeFull}`);
    
    console.log('Looking for progress div, found:', progressDiv);
    console.log('Progress data received:', data);
    
    if (!progressDiv) {
        console.error('Progress div not found for:', data.filename);
        // List all available progress divs for debugging
        const allProgressDivs = document.querySelectorAll('[id*="progress-"]');
        console.log('Available progress divs:', Array.from(allProgressDivs).map(div => div.id));
        return;
    }
    
    const progressFill = progressDiv.querySelector('.progress-fill');
    const progressPhase = progressDiv.querySelector('.progress-phase');
    const progressPercent = progressDiv.querySelector('.progress-percent');
    const progressTime = progressDiv.querySelector('.progress-time');
    
    console.log('Progress elements found:', { progressFill, progressPhase, progressPercent, progressTime });
    
    if (progressFill && progressPhase && progressPercent && progressTime) {
        // Calculate progress percentage
        let percent = 0;
        let phase = 'Preparing...';
        
        console.log('Analyzing progress data:', {
            percent: data.percent,
            vipsPercent: data.vipsPercent,
            tilesCreated: data.tilesCreated,
            expectedTiles: data.expectedTiles,
            phase: data.phase
        });
        
        if (data.percent !== undefined && data.percent >= 0) {
            percent = Math.round(data.percent);
            phase = data.phase || 'Processing';
            console.log('Using percent:', percent);
        } else if (data.vipsPercent !== undefined && data.vipsPercent > 0) {
            percent = Math.round(data.vipsPercent);
            phase = data.phase || 'ICC Transform';
            console.log('Using VIPS percent:', percent);
        } else if (data.tilesCreated !== undefined && data.expectedTiles !== undefined && data.expectedTiles > 0) {
            percent = Math.round((data.tilesCreated / data.expectedTiles) * 100);
            phase = `Tiling (${data.tilesCreated}/${data.expectedTiles})`;
            console.log('Using tile progress:', percent);
        } else if (data.phase && (data.phase.toLowerCase().includes('tiling') || data.phase.toLowerCase().includes('tile'))) {
            phase = 'Tiling...';
            percent = 50; // Show some progress during tiling
            console.log('Detected tiling phase without counts');
        } else if (data.phase) {
            phase = data.phase;
            percent = 25; // Show some progress for any phase
            console.log('Using generic phase:', phase);
        }
        
        // Update progress elements
        progressFill.style.width = `${percent}%`;
        progressPhase.textContent = phase;
        progressPercent.textContent = `${percent}%`;
        
        // Elapsed time is now handled by independent timer
        // progressTime will be updated by the timer function
        
        console.log('Progress UI updated:', { percent, phase });
    } else {
        console.error('Missing progress elements in div:', progressDiv);
    }
}

// Timer management for conversions
const conversionTimers = new Map();

function startConversionTimer(filename) {
    if (!filename) return;
    
    // Clear any existing timer for this filename
    stopConversionTimer(filename);
    
    const startTime = Date.now();
    const timerId = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const seconds = Math.floor(elapsed / 1000);
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        
        const timeString = minutes > 0 ? 
            `${minutes}m ${remainingSeconds}s` : 
            `${remainingSeconds}s`;
        
        // Update the progress time display
        updateProgressTime(filename, timeString);
    }, 1000);
    
    conversionTimers.set(filename, { timerId, startTime });
    console.log('Started timer for:', filename);
}

function stopConversionTimer(filename) {
    if (!filename) return;
    
    const timer = conversionTimers.get(filename);
    if (timer) {
        clearInterval(timer.timerId);
        conversionTimers.delete(filename);
        console.log('Stopped timer for:', filename);
    }
}

function updateProgressTime(filename, timeString) {
    // Try multiple filename formats to find the correct progress div
    const originalFilename = filename;
    const baseFilename = originalFilename.replace(/\.svs$/i, '');
    const fullFilename = originalFilename.endsWith('.svs') ? originalFilename : originalFilename + '.svs';
    
    const safeOriginal = originalFilename.replace(/[^a-zA-Z0-9]/g, '_');
    const safeBase = baseFilename.replace(/[^a-zA-Z0-9]/g, '_');
    const safeFull = fullFilename.replace(/[^a-zA-Z0-9]/g, '_');
    
    const progressIds = [
        `progress-${safeOriginal}`,
        `progress-${safeBase}`,
        `progress-${safeFull}`
    ];
    
    for (const progressId of progressIds) {
        const progressDiv = document.getElementById(progressId);
        if (progressDiv) {
            const progressTime = progressDiv.querySelector('.progress-time');
            if (progressTime) {
                progressTime.textContent = timeString;
                break;
            }
        }
    }
}

// Hide progress panel for cancelled conversions
function hideProgressPanel(filename) {
    // Try multiple filename formats
    const originalFilename = filename;
    const baseFilename = originalFilename.replace(/\.svs$/i, '');
    const fullFilename = originalFilename.endsWith('.svs') ? originalFilename : originalFilename + '.svs';
    
    const safeOriginal = originalFilename.replace(/[^a-zA-Z0-9]/g, '_');
    const safeBase = baseFilename.replace(/[^a-zA-Z0-9]/g, '_');
    const safeFull = fullFilename.replace(/[^a-zA-Z0-9]/g, '_');
    
    let progressDiv = document.getElementById(`progress-${safeOriginal}`) ||
                     document.getElementById(`progress-${safeBase}`) ||
                     document.getElementById(`progress-${safeFull}`);
    
    if (progressDiv) {
        progressDiv.style.display = 'none';
        console.log('Progress panel hidden for cancelled conversion:', filename);
    }
}

// Hide main progress panel
function hideMainProgressPanel() {
    const mainProgressPanel = document.getElementById('progressPanel');
    if (mainProgressPanel) {
        mainProgressPanel.style.display = 'none';
        console.log('Main progress panel hidden');
    } else {
        console.error('Main progress panel not found with ID progressPanel');
    }
}

// Force reset all cancel buttons that might be stuck
function forceResetAllCancelButtons() {
    const allCancelBtns = document.querySelectorAll('[class*="cancel-btn"]');
    console.log(`Force resetting ${allCancelBtns.length} cancel buttons`);
    
    allCancelBtns.forEach(btn => {
        if (btn.textContent === 'Cancelling...' || btn.disabled) {
            btn.textContent = 'Cancel';
            btn.disabled = false;
            btn.style.display = 'none';
            console.log('Force reset stuck cancel button:', btn.className);
        }
    });
    
    // Also reset any convert buttons that might be stuck
    const allConvertBtns = document.querySelectorAll('[class*="convert-btn"]');
    allConvertBtns.forEach(btn => {
        if (btn.textContent === 'Converting...' || btn.disabled) {
            btn.textContent = 'Convert';
            btn.disabled = false;
            btn.style.display = 'inline-block';
            console.log('Force reset stuck convert button:', btn.className);
        }
    });
}

// Load configuration from server (legacy config for compatibility)
async function loadConfig() {
    try {
        // Try to load legacy config first, but don't fail if it doesn't exist
        const response = await fetch('/api/config');
        if (response.ok) {
            currentConfig = await response.json();
            updateUIFromConfig();
        } else {
            // Use default config if legacy endpoint doesn't exist
            currentConfig = {
                sourceDir: 'C:\\OG',
                destinationDir: 'C:\\dzi',
                serverPort: 3102,
                vipsSettings: {
                    concurrency: 8,
                    maxMemoryMB: 4096,
                    bufferSizeMB: 512,
                    tileSize: 256,
                    quality: 90
                }
            };
            updateUIFromConfig();
        }
    } catch (error) {
        console.error('Failed to load config:', error);
        // Use default config on error
        currentConfig = {
            sourceDir: 'C:\\OG',
            destinationDir: 'C:\\dzi',
            serverPort: 3102,
            vipsSettings: {
                concurrency: 8,
                maxMemoryMB: 4096,
                bufferSizeMB: 512,
                tileSize: 256,
                quality: 90
            }
        };
        updateUIFromConfig();
    }
}

// Update UI elements from configuration
function updateUIFromConfig() {
    // Folder paths
    if (elements.sourcePath) elements.sourcePath.textContent = currentConfig.sourceDir || 'Select folder...';
    if (elements.destPath) elements.destPath.textContent = currentConfig.destinationDir || 'Select folder...';
    
    // VIPS settings
    const vips = currentConfig.vipsSettings || {};
    if (elements.concurrency) elements.concurrency.value = vips.concurrency || 8;
    if (elements.maxMemory) elements.maxMemory.value = vips.maxMemoryMB || 4096;
    if (elements.bufferSize) elements.bufferSize.value = vips.bufferSizeMB || 512;
    if (elements.tileSize) elements.tileSize.value = vips.tileSize || 256;
    if (elements.quality) elements.quality.value = vips.quality || 90;
    if (elements.qualityValue) elements.qualityValue.textContent = vips.quality || 90;
    
    // ICC Profile
    if (elements.autoDetectSrgb) elements.autoDetectSrgb.checked = vips.autoDetectSrgb !== false;
    if (elements.colorTransform) elements.colorTransform.value = vips.colorTransform || 'auto';
    
    // VIPS Logging
    if (elements.vipsProgress) elements.vipsProgress.checked = vips.progress !== false;
    if (elements.vipsInfo) elements.vipsInfo.checked = vips.info !== false;
    if (elements.vipsWarning) elements.vipsWarning.checked = vips.warning !== false;
    
    // Conversion Options
    if (elements.autoDeleteOriginal) elements.autoDeleteOriginal.checked = currentConfig.autoDeleteOriginal === true;
    
    // Advanced settings
    if (elements.serverPort) elements.serverPort.value = currentConfig.serverPort || 3000;
    if (elements.overlap) elements.overlap.value = vips.overlap || 1;
    if (elements.layout) elements.layout.value = vips.layout || 'dz';
    if (elements.embedIcc) elements.embedIcc.checked = vips.embedIcc === true;
    if (elements.sequential) elements.sequential.checked = vips.sequential !== false;
    if (elements.novector) elements.novector.checked = vips.novector === true;
}

// Save configuration to server
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
            colorTransform: elements.colorTransform.value,
            
            progress: elements.vipsProgress.checked,
            info: elements.vipsInfo.checked,
            warning: elements.vipsWarning.checked,
            
            overlap: parseInt(elements.overlap.value),
            layout: elements.layout.value,
            embedIcc: elements.embedIcc.checked,
            sequential: elements.sequential.checked,
            novector: elements.novector.checked
        },
        autoDeleteOriginal: elements.autoDeleteOriginal.checked
    };
    
    try {
        const response = await fetch('http://localhost:3102/api/config', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(newConfig)
        });
        
        if (response.ok) {
            currentConfig = { ...currentConfig, ...newConfig };
        }
    } catch (error) {
        console.error('Failed to save config:', error);
    }
}

// Setup event listeners
function setupEventListeners() {
    console.log('🎛️ Setting up event listeners...');
    
    // Server controls
    if (elements.startServerBtn) {
        elements.startServerBtn.addEventListener('click', startServer);
    }
    if (elements.stopServerBtn) {
        elements.stopServerBtn.addEventListener('click', stopServer);
    }
    
    // Folder selection (simplified for web - just show current paths)
    if (elements.selectSourceBtn) {
        elements.selectSourceBtn.addEventListener('click', () => {
            const newPath = prompt('Enter source folder path:', currentConfig.sourceDir || '');
            if (newPath) {
                currentConfig.sourceDir = newPath;
                if (elements.sourcePath) elements.sourcePath.textContent = newPath;
                saveConfig();
                scanSlides();
            }
        });
    }
    
    if (elements.selectDestBtn) {
        elements.selectDestBtn.addEventListener('click', () => {
            const newPath = prompt('Enter destination folder path:', currentConfig.destinationDir || '');
            if (newPath) {
                currentConfig.destinationDir = newPath;
                if (elements.destPath) elements.destPath.textContent = newPath;
                saveConfig();
            }
        });
    }
    
    // Configuration changes - auto-save
    const configInputs = [
        elements.concurrency, elements.maxMemory, elements.bufferSize,
        elements.tileSize, elements.quality, elements.colorTransform,
        elements.vipsProgress, elements.vipsInfo, elements.vipsWarning,
        elements.serverPort, elements.overlap, elements.layout,
        elements.embedIcc, elements.sequential, elements.novector,
        elements.autoDetectSrgb, elements.autoDeleteOriginal
    ];
    
    configInputs.forEach(input => {
        if (input) {
            input.addEventListener('change', saveConfig);
        }
    });
    
    // Quality slider real-time update
    if (elements.quality && elements.qualityValue) {
        elements.quality.addEventListener('input', () => {
            elements.qualityValue.textContent = elements.quality.value;
        });
    }
    
    // Main tab switching removed - now using sidebar configuration tabs only
    
    // Slides management
    if (elements.scanSlidesBtn) elements.scanSlidesBtn.addEventListener('click', scanSlides);
    if (elements.refreshSlidesBtn) elements.refreshSlidesBtn.addEventListener('click', scanSlides);
    if (elements.importSlidesBtn && elements.importSlidesInput) {
        elements.importSlidesBtn.addEventListener('click', () => elements.importSlidesInput.click());
    }
    if (elements.importSlidesInput) elements.importSlidesInput.addEventListener('change', handleImportSlides);
    
    // VIPS Info
    if (elements.getVipsInfoBtn) elements.getVipsInfoBtn.addEventListener('click', getVipsInfo);
    
    // Console controls
    if (elements.clearConsoleBtn) elements.clearConsoleBtn.addEventListener('click', clearConsole);
}

// Server management
async function startServer() {
    try {
        await saveConfig(); // Ensure config is saved before starting
        const response = await fetch('/api/server/start', { method: 'POST' });
        const result = await response.json();
        
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
        const response = await fetch('/api/server/stop', { method: 'POST' });
        const result = await response.json();
        
        if (result.success) {
            appendToConsole('Server stopped.\n', 'info');
        } else {
            appendToConsole(`Failed to stop server: ${result.message}\n`, 'error');
        }
    } catch (error) {
        appendToConsole(`Error stopping server: ${error.message}\n`, 'error');
    }
}

// This function is now handled by the second updateServerStatus function below

// Backend health polling
function startBackendHealthPolling() {
    const poll = async () => {
        try {
            const res = await fetch('/api/slides');
            const ok = res.ok;
            if (ok !== backendHealthy) {
                backendHealthy = ok;
                console.log(`Backend API ${ok ? 'is reachable' : 'is not reachable'}`);
                if (!ok) {
                    appendToConsole('Backend API is not reachable\n', 'warning');
                }
            }
        } catch (e) {
            if (backendHealthy) {
                backendHealthy = false;
                console.log('Backend API is not reachable');
                appendToConsole('Backend API is not reachable\n', 'warning');
            }
        } finally {
            setTimeout(poll, 4000);
        }
    };
    poll();
}

// Slides management
async function scanSlides() {
    console.log('🔍 scanSlides() called');
    try {
        console.log('📡 Fetching slides from backend...');
        const response = await fetch('/api/slides');
        console.log('📡 Response received:', response.status, response.statusText);
        
        if (!response.ok) {
            if (response.status === 502) {
                console.error('❌ Backend API is not reachable (502)');
                appendToConsole(`Backend API is not reachable\n`, 'error');
            } else {
                console.error(`❌ API error: ${response.status} ${response.statusText}`);
                appendToConsole(`API error: ${response.status} ${response.statusText}\n`, 'error');
            }
            return;
        }
        
        const result = await response.json();
        console.log('📊 API Response received:', result);
        console.log('📊 Response type:', typeof result, 'Is array:', Array.isArray(result));
        
        if (Array.isArray(result) && result.length > 0) {
            console.log('📊 First slide data:', result[0]);
        }
        
        // Backend returns an array of slide objects; support both array and {slides: []}
        if (Array.isArray(result)) {
            slides = result;
            console.log(`✅ Loaded ${slides.length} slides, calling renderSlides()`);
            renderSlides();
        } else if (result && Array.isArray(result.slides)) {
            slides = result.slides;
            console.log(`✅ Loaded ${slides.length} slides from .slides property, calling renderSlides()`);
            renderSlides();
        } else {
            console.error('❌ Unexpected response format:', result);
            appendToConsole(`Failed to scan slides: unexpected response format\n`, 'error');
        }
    } catch (error) {
        console.error('❌ Scan slides error:', error);
        appendToConsole(`Error scanning slides: ${error.message}\n`, 'error');
        appendToConsole(`Backend API is not reachable\n`, 'error');
    }
}

function renderSlides() {
    console.log('🎨 renderSlides() called with', slides.length, 'slides');
    console.log('🎨 Checking slidesGrid element:', elements.slidesGrid);
    
    if (!elements.slidesGrid) {
        console.error('❌ slidesGrid element not found!');
        return;
    }
    
    // Store current progress states before clearing
    const currentProgressStates = new Map();
    const currentButtonStates = new Map();
    
    // Capture existing progress and button states
    slides.forEach(slide => {
        const filename = `${slide.name}${slide.format || ''}`;
        const safeFilename = filename.replace(/[^a-zA-Z0-9]/g, '_');
        
        const progressDiv = document.getElementById(`progress-${safeFilename}`);
        const convertBtn = document.querySelector(`.convert-btn-${safeFilename}`);
        const cancelBtn = document.querySelector(`.cancel-btn-${safeFilename}`);
        
        if (progressDiv && progressDiv.style.display !== 'none') {
            const progressFill = progressDiv.querySelector('.progress-fill');
            const progressPhase = progressDiv.querySelector('.progress-phase');
            const progressPercent = progressDiv.querySelector('.progress-percent');
            const progressTime = progressDiv.querySelector('.progress-time');
            
            currentProgressStates.set(safeFilename, {
                display: progressDiv.style.display,
                width: progressFill ? progressFill.style.width : '0%',
                phase: progressPhase ? progressPhase.textContent : 'Preparing...',
                percent: progressPercent ? progressPercent.textContent : '0%',
                time: progressTime ? progressTime.textContent : '0s'
            });
        }
        
        if (convertBtn || cancelBtn) {
            currentButtonStates.set(safeFilename, {
                convertText: convertBtn ? convertBtn.textContent : null,
                convertDisabled: convertBtn ? convertBtn.disabled : false,
                convertDisplay: convertBtn ? convertBtn.style.display : 'inline-block',
                cancelDisplay: cancelBtn ? cancelBtn.style.display : 'none',
                cancelDisabled: cancelBtn ? cancelBtn.disabled : false,
                cancelText: cancelBtn ? cancelBtn.textContent : 'Cancel'
            });
        }
    });
    
    elements.slidesGrid.innerHTML = '';
    
    if (slides.length === 0) {
        elements.slidesGrid.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; color: #888; padding: 40px;">No slides found. Check your source folder path.</div>';
        return;
    }
    
    slides.forEach(slide => {
        const card = document.createElement('div');
        card.className = 'slide-card';
        
        // Debug: Log slide data to see what properties are available
        console.log('Rendering slide:', slide);
        
        const sizeGB = slide.size ? (slide.size / (1024 * 1024 * 1024)).toFixed(2) : '0.00';
        const filename = `${slide.name}${slide.format || ''}`;
        
        card.innerHTML = `
            <div class="slide-name">${slide.name}</div>
            ${slide.labelUrl || slide.thumbnailUrl || slide.macroUrl ? `<div class="slide-thumbnail" style="margin-top: 4px;"><img src="${slide.labelUrl || slide.thumbnailUrl || slide.macroUrl}" alt="Slide thumbnail" style="max-width: 100%; max-height: 150px; border-radius: 4px; border: 1px solid #ddd;" onerror="this.style.display='none'"></div>` : ''}
            ${slide.label ? `<div class="slide-label" style="font-size: 11px; color: #6c757d; font-style: italic; margin-top: 2px;">${slide.label}</div>` : ''}
            <div class="slide-info">
                Format: ${slide.format.toUpperCase()}<br>
                Size: ${sizeGB} GB<br>
                Status: <span class="converted-badge ${slide.converted ? 'yes' : 'no'}">
                    ${slide.converted ? 'Converted' : 'Not Converted'}
                </span>
                <div class="conversion-progress" id="progress-${filename.replace(/[^a-zA-Z0-9]/g, '_')}" style="display: none; margin-top: 8px;">
                    <div class="progress-bar" style="width: 100%; height: 4px; background: #e0e0e0; border-radius: 2px; overflow: hidden;">
                        <div class="progress-fill" style="height: 100%; background: #007bff; width: 0%; transition: width 0.3s;"></div>
                    </div>
                    <div class="progress-text" style="font-size: 11px; color: #666; margin-top: 2px;">
                        <span class="progress-phase">Preparing...</span> • 
                        <span class="progress-percent">0%</span> • 
                        <span class="progress-time">0s</span>
                    </div>
                </div>
            </div>
            <div class="slide-actions">
                <button class="btn btn-small rename-btn" data-slide-name="${slide.name}" data-filename="${filename}" style="background: #6c757d; color: white; margin-right: 4px;" title="Rename slide">
                    ✏️
                </button>
                <button class="btn btn-small convert-btn-${filename.replace(/[^a-zA-Z0-9]/g, '_')}" onclick="convertSlide('${filename}')">
                    ${slide.converted ? 'Re-convert' : 'Convert'}
                </button>
                <button class="btn btn-small cancel-btn-${filename.replace(/[^a-zA-Z0-9]/g, '_')}" onclick="cancelConversion('${filename}')" style="display: none; background: #dc3545; color: white; border: none; padding: 4px 8px; border-radius: 3px; cursor: pointer; margin-left: 4px;">
                    Cancel
                </button>
                <button class="btn btn-small" onclick="viewSlide('${slide.name}')" 
                        ${slide.converted ? '' : 'disabled'}>
                    View
                </button>
                <button class="btn btn-danger btn-small" onclick="deleteSlide('${slide.name}')">
                    Delete
                </button>
            </div>
        `;
        
        elements.slidesGrid.appendChild(card);
        
        // Restore progress and button states after rendering
        const safeFilename = filename.replace(/[^a-zA-Z0-9]/g, '_');
        
        // Restore progress state
        if (currentProgressStates.has(safeFilename)) {
            const progressState = currentProgressStates.get(safeFilename);
            const progressDiv = document.getElementById(`progress-${safeFilename}`);
            
            if (progressDiv) {
                progressDiv.style.display = progressState.display;
                const progressFill = progressDiv.querySelector('.progress-fill');
                const progressPhase = progressDiv.querySelector('.progress-phase');
                const progressPercent = progressDiv.querySelector('.progress-percent');
                const progressTime = progressDiv.querySelector('.progress-time');
                
                if (progressFill) progressFill.style.width = progressState.width;
                if (progressPhase) progressPhase.textContent = progressState.phase;
                if (progressPercent) progressPercent.textContent = progressState.percent;
                if (progressTime) progressTime.textContent = progressState.time;
                
                console.log(`Restored progress state for ${filename}:`, progressState);
            }
        }
        
        // Restore button states
        if (currentButtonStates.has(safeFilename)) {
            const buttonState = currentButtonStates.get(safeFilename);
            const convertBtn = document.querySelector(`.convert-btn-${safeFilename}`);
            const cancelBtn = document.querySelector(`.cancel-btn-${safeFilename}`);
            
            if (convertBtn && buttonState.convertText) {
                convertBtn.textContent = buttonState.convertText;
                convertBtn.disabled = buttonState.convertDisabled;
                convertBtn.style.display = buttonState.convertDisplay;
            }
            
            if (cancelBtn) {
                cancelBtn.style.display = buttonState.cancelDisplay;
                cancelBtn.disabled = buttonState.cancelDisabled;
                cancelBtn.textContent = buttonState.cancelText;
            }
            
            console.log(`Restored button state for ${filename}:`, buttonState);
        }
    });
}

// Slide actions
async function convertSlide(filename) {
    try {
        appendToConsole(`Starting conversion of ${filename}...\n`, 'info');
        
        // Send convert request directly to backend server instead of using GUI-server proxy
        const response = await fetch(`/api/touch-file/${encodeURIComponent(filename)}`, { method: 'POST' });
        
        if (!response.ok) {
            const txt = await response.text();
            appendToConsole(`Failed to trigger conversion: ${txt}\n`, 'error');
            return;
        }
        const result = await response.json();
        appendToConsole(`File touched, autoprocessor will detect and convert: ${result.status || 'triggered'}\n`, 'info');
        
        // Track this conversion for enhanced monitoring
        const basename = filename.replace(/\.[^/.]+$/, ''); // Remove extension
        trackConversion(basename);
        
        // Update button states and show progress
        const safeFilename = filename.replace(/[^a-zA-Z0-9]/g, '_');
        const convertBtn = document.querySelector(`.convert-btn-${safeFilename}`);
        const cancelBtn = document.querySelector(`.cancel-btn-${safeFilename}`);
        const progressDiv = document.getElementById(`progress-${safeFilename}`);
        
        console.log('Updating UI for conversion start:', {
            filename,
            safeFilename,
            convertBtn,
            cancelBtn,
            progressDiv
        });
        
        if (convertBtn) {
            convertBtn.textContent = 'Converting...';
            convertBtn.disabled = true;
            convertBtn.style.display = 'none';
        }
        if (cancelBtn) {
            cancelBtn.style.display = 'inline-block';
            cancelBtn.style.visibility = 'visible';
            console.log('Cancel button should now be visible:', cancelBtn);
        } else {
            console.error('Cancel button not found for:', safeFilename);
        }
        if (progressDiv) {
            progressDiv.style.display = 'block';
        }
    } catch (error) {
        appendToConsole(`Error converting slide: ${error.message}\n`, 'error');
    }
}

async function cancelConversion(filename) {
    try {
        appendToConsole(`Cancelling conversion of ${filename}...\n`, 'info');
        
        // Send cancel request directly to backend server instead of using GUI-server proxy
        const backendUrl = `http://localhost:3102/api/cancel-conversion/${encodeURIComponent(filename)}`;
        const response = await fetch(/api/touch-file/\$\{encodeURIComponent(filename)\}, { method: 'POST' });
        
        if (!response.ok) {
            const txt = await response.text();
            appendToConsole(`Failed to cancel conversion: ${txt}\n`, 'error');
            return;
        }
        const result = await response.json();
        appendToConsole(`Cancellation request accepted: ${result.status || 'cancelling'}\n`, 'info');
        
        // Update button states
        const safeFilename = filename.replace(/[^a-zA-Z0-9]/g, '_');
        const cancelBtn = document.querySelector(`.cancel-btn-${safeFilename}`);
        
        if (cancelBtn) {
            cancelBtn.textContent = 'Cancelling...';
            cancelBtn.disabled = true;
        }
    } catch (error) {
        appendToConsole(`Error cancelling conversion: ${error.message}\n`, 'error');
    }
}

function viewSlide(slideName) {
    const url = `http://localhost:${currentConfig.serverPort || 3000}/?slide=${encodeURIComponent(slideName)}`;
    window.open(url, '_blank');
}

// Slide deletion
async function deleteSlide(filename) {
    const slideName = filename.replace(/\.[^/.]+$/, ""); // Remove extension for display
    
    // Confirmation dialog
    const confirmed = confirm(
        `Are you sure you want to delete "${slideName}"?\n\n` +
        `This will permanently remove:\n` +
        `• Original slide file\n` +
        `• DZI file\n` +
        `• All tile files\n\n` +
        `This action cannot be undone.`
    );
    
    if (!confirmed) {
        return;
    }
    
    try {
        appendToConsole(`Deleting slide: ${filename}...\n`, 'info');
        
        // Send delete request directly to backend server instead of using GUI-server proxy
        const backendUrl = `/api/slides/${encodeURIComponent(filename)}`;
        const response = await fetch(backendUrl, {
            method: 'DELETE'
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            appendToConsole(`Failed to delete slide: ${errorText}\n`, 'error');
            return;
        }
        
        const result = await response.json();
        appendToConsole(`Successfully deleted: ${result.filename} (${result.deletedComponents.join(', ')})\n`, 'info');
        
        // Small delay to ensure backend has processed the deletion
        setTimeout(async () => {
            await scanSlides();
        }, 500);
        
    } catch (error) {
        appendToConsole(`Error deleting slide: ${error.message}\n`, 'error');
    }
}

// Make functions available globally for onclick handlers
window.convertSlide = convertSlide;
window.cancelConversion = cancelConversion;
window.viewSlide = viewSlide;
window.deleteSlide = deleteSlide;

// Debug function to manually test slides loading
window.debugScanSlides = async function() {
    console.log('🔍 Manual debug scan slides...');
    await scanSlides();
};

// Debug function to test backend connection
window.debugBackend = async function() {
    try {
        const response = await fetch('/api/slides');
        console.log('Backend response:', response.status, response.statusText);
        if (response.ok) {
            const data = await response.json();
            console.log('Slides data:', data.length, 'slides found');
            console.log('First slide:', data[0]);
        }
    } catch (error) {
        console.error('Backend error:', error);
    }
};

// Debug function to test configuration tabs
window.debugTabs = function() {
    console.log('🔍 Debugging configuration tabs...');
    console.log('Tab buttons found:', document.querySelectorAll('.tab-btn').length);
    console.log('Tab panels found:', document.querySelectorAll('.tab-panel').length);
    
    const tabBtns = document.querySelectorAll('.tab-btn');
    tabBtns.forEach((btn, i) => {
        console.log(`Tab ${i}:`, btn.getAttribute('data-tab'), btn.textContent);
    });
    
    const tabPanels = document.querySelectorAll('.tab-panel');
    tabPanels.forEach((panel, i) => {
        console.log(`Panel ${i}:`, panel.id, panel.classList.contains('active') ? 'ACTIVE' : 'inactive');
    });
};

// Debug function to manually switch tabs
window.debugSwitchTab = function(tabName) {
    console.log('🔄 Manually switching to tab:', tabName);
    switchConfigTab(tabName);
};

// Debug function to check configuration loading
window.debugConfig = function() {
    console.log('🔧 Debugging configuration...');
    console.log('Current config:', currentConfig);
    console.log('Pathology config:', pathologyConfig);
    console.log('Sample form elements:');
    console.log('- deploymentMode element:', elements.deploymentMode);
    console.log('- deploymentMode value:', elements.deploymentMode?.value);
    
    // Debug ICC checkbox
    const useVipsCheckbox = document.getElementById('useVipsFormat');
    console.log('- useVipsFormat checkbox:', useVipsCheckbox);
    console.log('- useVipsFormat checked:', useVipsCheckbox?.checked);
    console.log('- API base:', getApiBase());
    console.log('- slidesDir element:', elements.slidesDir);
    console.log('- slidesDir textContent:', elements.slidesDir?.textContent);
    console.log('- vipsConcurrency element:', elements.vipsConcurrency);
    console.log('- vipsConcurrency value:', elements.vipsConcurrency?.value);
    
    // Check if elements exist in DOM
    console.log('DOM element check:');
    console.log('- deploymentMode in DOM:', !!document.getElementById('deploymentMode'));
    console.log('- slidesDir in DOM:', !!document.getElementById('slidesDir'));
    console.log('- vipsConcurrency in DOM:', !!document.getElementById('vipsConcurrency'));
};

// Debug function to manually load config
window.debugLoadConfig = async function() {
    console.log('📋 Manually loading configuration...');
    await loadPathologyConfig();
    updateConfigurationUI();
    console.log('Configuration loaded and UI updated');
};

// Debug function to manually set test values
window.debugSetTestValues = function() {
    console.log('🧪 Setting test values...');
    
    // Test setting values directly
    const deploymentMode = document.getElementById('deploymentMode');
    const slidesDir = document.getElementById('slidesDir');
    const vipsConcurrency = document.getElementById('vipsConcurrency');
    
    if (deploymentMode) {
        deploymentMode.value = 'distributed';
        console.log('✅ Set deploymentMode to distributed');
    } else {
        console.log('❌ deploymentMode element not found');
    }
    
    if (slidesDir) {
        slidesDir.textContent = 'TEST: C:\\OG';
        console.log('✅ Set slidesDir text');
    } else {
        console.log('❌ slidesDir element not found');
    }
    
    if (vipsConcurrency) {
        vipsConcurrency.value = '99';
        console.log('✅ Set vipsConcurrency to 99');
    } else {
        console.log('❌ vipsConcurrency element not found');
    }
};

// Debug function to check tab visibility
window.debugTabVisibility = function() {
    console.log('👁️ Checking tab visibility...');
    const panels = document.querySelectorAll('.tab-panel');
    panels.forEach((panel, i) => {
        const computedStyle = window.getComputedStyle(panel);
        console.log(`Panel ${i} (${panel.id}):`, {
            hasActiveClass: panel.classList.contains('active'),
            display: computedStyle.display,
            visibility: computedStyle.visibility,
            height: computedStyle.height,
            innerHTML: panel.innerHTML.length + ' chars'
        });
    });
};

// Debug function to check sidebar layout
window.debugLayout = function() {
    console.log('📐 Checking layout...');
    const sidebar = document.querySelector('.sidebar');
    const tabContent = document.querySelector('.tab-content');
    const systemTab = document.getElementById('system-tab');
    
    if (sidebar) {
        const sidebarStyle = window.getComputedStyle(sidebar);
        console.log('Sidebar:', {
            display: sidebarStyle.display,
            width: sidebarStyle.width,
            height: sidebarStyle.height,
            overflow: sidebarStyle.overflow
        });
    }
    
    if (tabContent) {
        const tabContentStyle = window.getComputedStyle(tabContent);
        console.log('Tab Content:', {
            display: tabContentStyle.display,
            width: tabContentStyle.width,
            height: tabContentStyle.height,
            overflow: tabContentStyle.overflow
        });
    }
    
    if (systemTab) {
        const rect = systemTab.getBoundingClientRect();
        console.log('System Tab Position:', {
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
            visible: rect.width > 0 && rect.height > 0
        });
    }
};

// VIPS Info
async function getVipsInfo() {
    try {
        elements.getVipsInfoBtn.disabled = true;
        elements.getVipsInfoBtn.textContent = 'Loading...';
        
        const response = await fetch('/api/vips-info');
        const result = await response.json();
        
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

// Main tab management removed - now using sidebar configuration tabs only

// Kill hanging VIPS processes
async function killVipsProcesses() {
    try {
        const response = await fetch('/api/kill-vips-processes', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        const result = await response.json();
        
        if (response.ok) {
            appendToConsole('VIPS processes terminated successfully', 'info');
            showNotification('VIPS processes killed', 'success');
        } else {
            appendToConsole(`Failed to kill VIPS processes: ${result.error}`, 'error');
            showNotification('Failed to kill VIPS processes', 'error');
        }
    } catch (error) {
        console.error('Error killing VIPS processes:', error);
        appendToConsole(`Error killing VIPS processes: ${error.message}`, 'error');
        showNotification('Error killing VIPS processes', 'error');
    }
}

// Console management
function appendToConsole(text, type = 'stdout') {
    if (!elements.consoleOutput) {
        console.log(`[Console] ${text}`);
        return;
    }
    
    const timestamp = new Date().toLocaleTimeString();
    const line = document.createElement('div');
    line.className = `log-${type}`;
    line.textContent = `[${timestamp}] ${text}`;
    
    elements.consoleOutput.appendChild(line);
    
    // Auto-scroll if enabled
    if (elements.autoScroll && elements.autoScroll.checked) {
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
    if (elements.consoleOutput) {
        elements.consoleOutput.innerHTML = '';
        appendToConsole('Console cleared.\n', 'info');
    }
}

async function handleImportSlides(evt) {
    const files = Array.from(evt.target.files || []);
    if (!files.length) return;
    appendToConsole(`Importing ${files.length} slide(s)...\n`, 'info');
    try {
        const form = new FormData();
        for (const f of files) form.append('slides', f, f.name);
        const res = await fetch('/api/import', { method: 'POST', body: form });
        if (!res.ok) {
            const txt = await res.text();
            appendToConsole(`Import failed: ${txt}\n`, 'error');
        } else {
            appendToConsole('Import completed. Scanning...\n', 'info');
            await scanSlides();
        }
    } catch (e) {
        appendToConsole(`Import error: ${e.message}\n`, 'error');
    } finally {
        elements.importSlidesInput.value = '';
    }
}

// Conversion Progress Panel
function updateProgressPanel(msg) {
    const panel = document.getElementById('progressPanel');
    const f = document.getElementById('progressFile');
    const tiles = document.getElementById('progressTiles');
    const elapsed = document.getElementById('progressElapsed');
    const rate = document.getElementById('progressRate');
    const status = document.getElementById('progressStatus');
    
    panel.style.display = 'block';
    if (msg.filename) f.textContent = msg.filename;
    if (typeof msg.tilesCreated === 'number') tiles.textContent = msg.tilesCreated.toLocaleString();
    if (typeof msg.elapsedMs === 'number') elapsed.textContent = formatElapsed(msg.elapsedMs);
    if (typeof msg.tilesCreated === 'number' && typeof msg.elapsedMs === 'number' && msg.elapsedMs > 0) {
        const r = (msg.tilesCreated / (msg.elapsedMs / 1000)).toFixed(1);
        rate.textContent = r;
    }
    // Phase + percentage logic
    let phaseText = '';
    if (msg.phase === 'transform') {
        if (typeof msg.vipsPercent === 'number') {
            phaseText = `Transforming color: ${msg.vipsPercent}%`;
        } else {
            phaseText = 'Transforming color...';
        }
    } else if (msg.phase === 'tiling') {
        if (typeof msg.expectedTiles === 'number' && msg.expectedTiles > 0 && typeof msg.tilesCreated === 'number') {
            const pct = Math.min(100, Math.floor((msg.tilesCreated / msg.expectedTiles) * 100));
            phaseText = `Tiling: ${pct}%`;
        } else {
            phaseText = 'Tiling...';
        }
    }
    if (msg.done) phaseText = 'Done';
    status.textContent = phaseText;
}

function finalizeProgressPanel(msg) {
    updateProgressPanel({
        filename: msg.filename,
        tilesCreated: msg.tilesCreated || 0,
        elapsedMs: msg.elapsedMs || 0,
        done: true
    });
}

function formatElapsed(ms) {
    const total = Math.floor(ms / 1000);
    const m = Math.floor(total / 60).toString().padStart(2, '0');
    const s = (total % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
}

// Server status monitoring - simplified to just check backend connectivity
async function updateServerStatus() {
    try {
        // Test backend connectivity
        const response = await fetch('/api/slides');
        if (response.ok) {
            console.log('Backend server is accessible');
            // Update any status indicators if they exist
            const backendIndicator = document.querySelector('.backend-indicator');
            if (backendIndicator) {
                backendIndicator.className = 'status-indicator running';
            }
        } else {
            console.warn('Backend server returned error:', response.status);
        }
    } catch (error) {
        console.error('Backend server is not accessible:', error.message);
        // Update any status indicators if they exist
        const backendIndicator = document.querySelector('.backend-indicator');
        if (backendIndicator) {
            backendIndicator.className = 'status-indicator';
        }
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    init();
    
    // Update server status immediately and then every 5 seconds
    updateServerStatus();
    setInterval(updateServerStatus, 5000);
});

// Manual function to test saving ICC settings
window.testSaveICC = function() {
    console.log('🔧 Testing ICC save...');
    const useVipsCheckbox = document.getElementById('useVipsFormat');
    if (useVipsCheckbox) {
        useVipsCheckbox.checked = !useVipsCheckbox.checked;
        console.log('Toggled checkbox to:', useVipsCheckbox.checked);
        savePathologyConfig();
    } else {
        console.error('useVipsFormat checkbox not found!');
        ensureIccFormatTogglePresent();
    }
};

// Manual function to test tab switching
window.testTabSwitch = function(tabName = 'vips') {
    console.log('🔧 Testing tab switch to:', tabName);
    const tabBtn = document.querySelector(`[data-tab="${tabName}"]`);
    console.log('Tab button found:', tabBtn);
    if (tabBtn) {
        tabBtn.click();
    } else {
        console.error('Tab button not found for:', tabName);
        // List all available tab buttons
        const allTabs = document.querySelectorAll('[data-tab]');
        console.log('Available tabs:', Array.from(allTabs).map(t => t.getAttribute('data-tab')));
    }
};

// ===== CONFIGURATION MANAGEMENT =====

let pathologyConfig = {};

// Load pathology configuration from backend
async function loadPathologyConfig() {
    try {
        console.log('Loading pathology configuration from backend...');
        const response = await fetch(`${getApiBase()}/api/pathology-config`);
        if (response.ok) {
            const data = await response.json();
            pathologyConfig = data.config;
            console.log('Pathology configuration loaded successfully:', pathologyConfig);
            updateConfigurationUI();
            
            // Also update the legacy currentConfig for backward compatibility
            if (pathologyConfig.storage) {
                currentConfig.sourceDir = pathologyConfig.storage.slidesDir;
                currentConfig.destinationDir = pathologyConfig.storage.dziDir;
            }
            updateUIFromConfig();
        } else {
            console.warn('Failed to load pathology configuration:', response.status, response.statusText);
        }
    } catch (error) {
        console.error('Error loading pathology configuration:', error);
    }
}

// Update UI elements from pathology configuration
function updateConfigurationUI() {
    console.log('🎨 Updating configuration UI...');
    if (!pathologyConfig) {
        console.warn('🎨 No pathology config available');
        return;
    }
    console.log('🎨 Using pathology config:', pathologyConfig);
    
    // System Configuration
    if (elements.deploymentMode && pathologyConfig.deployment?.mode) {
        elements.deploymentMode.value = pathologyConfig.deployment.mode;
    }
    if (elements.mainServerPort && pathologyConfig.deployment?.mainServer?.port) {
        elements.mainServerPort.value = pathologyConfig.deployment.mainServer.port;
    }
    if (elements.slidesDir && pathologyConfig.storage?.slidesDir) {
        elements.slidesDir.textContent = pathologyConfig.storage.slidesDir;
        console.log('🎨 Set slidesDir to:', pathologyConfig.storage.slidesDir);
    }
    if (elements.dziDir && pathologyConfig.storage?.dziDir) {
        elements.dziDir.textContent = pathologyConfig.storage.dziDir;
        console.log('🎨 Set dziDir to:', pathologyConfig.storage.dziDir);
    }
    if (elements.tempDir && pathologyConfig.storage?.tempDir) {
        elements.tempDir.textContent = pathologyConfig.storage.tempDir;
        console.log('🎨 Set tempDir to:', pathologyConfig.storage.tempDir);
    }
    
    // Also update legacy config for backward compatibility
    if (pathologyConfig.storage) {
        currentConfig.sourceDir = pathologyConfig.storage.slidesDir;
        currentConfig.destinationDir = pathologyConfig.storage.dziDir;
        updateUIFromConfig();
    }
    if (elements.autoProcessorEnabled && pathologyConfig.autoProcessor?.enabled !== undefined) {
        elements.autoProcessorEnabled.checked = pathologyConfig.autoProcessor.enabled;
    }
    
    // VIPS Configuration
    if (elements.vipsConcurrency && pathologyConfig.conversion?.vips?.concurrency) {
        elements.vipsConcurrency.value = pathologyConfig.conversion.vips.concurrency;
    }
    if (elements.vipsCacheMemory && pathologyConfig.conversion?.vips?.cacheMemoryGB) {
        elements.vipsCacheMemory.value = pathologyConfig.conversion.vips.cacheMemoryGB;
    }
    if (elements.vipsQuality && pathologyConfig.conversion?.vips?.quality) {
        elements.vipsQuality.value = pathologyConfig.conversion.vips.quality;
        if (elements.vipsQualityValue) {
            elements.vipsQualityValue.textContent = pathologyConfig.conversion.vips.quality;
        }
    }
    if (elements.vipsCompression && pathologyConfig.conversion?.vips?.compression) {
        elements.vipsCompression.value = pathologyConfig.conversion.vips.compression;
    }
    // ICC Intermediate format toggle (injected)
    const useVipsToggle = document.getElementById('useVipsFormat');
    if (useVipsToggle) {
        const icc = pathologyConfig.conversion?.icc || {};
        const shouldCheck = !!icc.useVipsFormat || icc.intermediateFormat === 'v';
        useVipsToggle.checked = shouldCheck;
        console.log('🔧 Debug - Set useVipsFormat checkbox to:', shouldCheck, 'based on config:', icc);
    } else {
        console.log('🔧 Debug - useVipsFormat checkbox not found during config update');
    }
}

// Setup configuration tabs
function setupConfigurationTabs() {
    console.log('📑 Setting up configuration tabs...');
    console.log('📑 Found tab buttons:', elements.tabBtns ? elements.tabBtns.length : 0);
    console.log('📑 Found tab panels:', elements.tabPanels ? elements.tabPanels.length : 0);
    
    // Debug: Log all tab buttons and panels
    if (elements.tabBtns) {
        elements.tabBtns.forEach((btn, i) => {
            console.log(`📑 Tab button ${i}:`, btn.getAttribute('data-tab'), btn.className);
        });
    }
    if (elements.tabPanels) {
        elements.tabPanels.forEach((panel, i) => {
            console.log(`📑 Tab panel ${i}:`, panel.id, panel.className);
        });
    }
    
    if (elements.tabBtns) {
        elements.tabBtns.forEach((btn, index) => {
            console.log(`📑 Setting up tab button ${index}:`, btn.getAttribute('data-tab'));
            btn.addEventListener('click', () => {
                const tabName = btn.getAttribute('data-tab');
                console.log('📑 Tab clicked:', tabName);
                switchConfigTab(tabName);
            });
        });
    } else {
        console.warn('📑 No tab buttons found!');
    }
    
    // Setup VIPS quality slider
    if (elements.vipsQuality && elements.vipsQualityValue) {
        elements.vipsQuality.addEventListener('input', () => {
            elements.vipsQualityValue.textContent = elements.vipsQuality.value;
        });
    }
    
    // Setup configuration action buttons
    if (elements.saveConfigBtn) {
        elements.saveConfigBtn.addEventListener('click', savePathologyConfig);
    }
    if (elements.reloadConfigBtn) {
        elements.reloadConfigBtn.addEventListener('click', reloadPathologyConfig);
    }
    if (elements.validateConfigBtn) {
        elements.validateConfigBtn.addEventListener('click', validatePathologyConfig);
    }
    
    // Setup server management buttons
    if (elements.showAddServerBtn) {
        elements.showAddServerBtn.addEventListener('click', showAddServerForm);
    }
    if (elements.addServerBtn) {
        elements.addServerBtn.addEventListener('click', addConversionServer);
    }
    if (elements.cancelAddServerBtn) {
        elements.cancelAddServerBtn.addEventListener('click', hideAddServerForm);
    }
    if (elements.refreshServersBtn) {
        elements.refreshServersBtn.addEventListener('click', refreshServersList);
    }
    
    // Setup directory browse buttons
    setupBrowseButtons();
    
    // Load GUI configuration to show current paths
    loadGuiConfig();
    
    // Start enhanced conversion monitoring
    startConversionMonitoring();
}

// Enhanced conversion status monitoring with server-side timing
let conversionPollingInterval = null;
let activeConversions = new Set();

function startConversionMonitoring() {
    if (conversionPollingInterval) {
        clearInterval(conversionPollingInterval);
    }
    
    // Poll every 2 seconds for active conversions
    conversionPollingInterval = setInterval(async () => {
        if (activeConversions.size > 0) {
            for (const basename of activeConversions) {
                await pollConversionStatus(basename);
            }
        }
    }, 2000);
}

async function pollConversionStatus(basename) {
    try {
        const response = await fetch(`http://localhost:3001/status/${basename}`);
        if (response.ok) {
            const status = await response.json();
            updateConversionDisplay(basename, status);
            
            if (status.status === 'completed' || status.status === 'failed') {
                activeConversions.delete(basename);
            }
        }
    } catch (error) {
        console.error(`Failed to poll conversion status for ${basename}:`, error);
    }
}

function updateConversionDisplay(basename, status) {
    const progressPanel = document.getElementById('progressPanel');
    if (!progressPanel) return;
    
    if (status.status === 'processing') {
        progressPanel.style.display = 'block';
        
        // Update progress elements with server-side timing
        const fileEl = document.getElementById('progressFile');
        const tilesEl = document.getElementById('progressTiles');
        const elapsedEl = document.getElementById('progressElapsed');
        const rateEl = document.getElementById('progressRate');
        const statusEl = document.getElementById('progressStatus');
        
        if (fileEl) fileEl.textContent = basename;
        if (tilesEl) tilesEl.textContent = status.progress || 0;
        if (elapsedEl) elapsedEl.textContent = formatElapsedTime(status.totalElapsedSec || 0);
        if (rateEl) rateEl.textContent = calculateRate(status.progress, status.totalElapsedSec);
        if (statusEl) {
            let statusText = status.phase || 'Processing';
            if (status.phase === 'ICC Color Transform' && status.iccElapsedSec > 0) {
                statusText += ` (${status.iccElapsedSec}s)`;
            }
            statusEl.textContent = statusText;
        }
    } else if (status.status === 'completed') {
        setTimeout(() => {
            progressPanel.style.display = 'none';
            scanSlides(); // Refresh slides list
        }, 2000);
    }
}

function formatElapsedTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function calculateRate(progress, elapsedSec) {
    if (elapsedSec === 0) return '0';
    return (progress / elapsedSec).toFixed(1);
}

// Hook into existing conversion start to track active conversions
function trackConversion(basename) {
    activeConversions.add(basename);
}

// Switch configuration tab
function switchConfigTab(tabName) {
    console.log('🔄 Switching to config tab:', tabName);
    
    // Update tab buttons
    if (elements.tabBtns) {
        elements.tabBtns.forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('data-tab') === tabName);
        });
    }
    
    // Update tab panels
    if (elements.tabPanels) {
        elements.tabPanels.forEach(panel => {
            panel.classList.toggle('active', panel.id === `${tabName}-tab`);
        });
    }
}

// Save pathology configuration
async function savePathologyConfig() {
    try {
        showMessage('Saving configuration...', 'info');
        
        // Debug: Check if the checkbox exists and its state
        const useVipsCheckbox = document.getElementById('useVipsFormat');
        console.log('🔧 Debug - useVipsFormat checkbox:', useVipsCheckbox);
        console.log('🔧 Debug - useVipsFormat checked:', useVipsCheckbox?.checked);
        
        const updatedConfig = {
            deployment: {
                mode: elements.deploymentMode?.value || 'single',
                mainServer: {
                    port: parseInt(elements.mainServerPort?.value) || 3102,
                    host: '0.0.0.0'
                }
            },
            storage: {
                slidesDir: elements.slidesDir?.textContent || 'C:\\OG',
                dziDir: elements.dziDir?.textContent || 'C:\\dzi',
                tempDir: elements.tempDir?.textContent || 'C:\\temp'
            },
            autoProcessor: {
                enabled: elements.autoProcessorEnabled?.checked !== false
            },
            conversion: {
                defaultConcurrency: parseInt(elements.defaultConcurrency?.value) || 8,
                vips: {
                    concurrency: parseInt(elements.vipsConcurrency?.value) || 32,
                    cacheMemoryGB: parseInt(elements.vipsCacheMemory?.value) || 64,
                    quality: parseInt(elements.vipsQuality?.value) || 95,
                    compression: elements.vipsCompression?.value || 'lzw'
                },
                icc: {
                    // New ICC intermediate format settings controlled from VIPS tab
                    useVipsFormat: !!useVipsCheckbox?.checked,
                    useVipsNative: !!useVipsCheckbox?.checked,
                    intermediateFormat: (!!useVipsCheckbox?.checked) ? 'v' : 'tif',
                    compression: elements.vipsCompression?.value || 'lzw',
                    quality: parseInt(elements.vipsQuality?.value) || 95
                },
                dzi: {
                    overlap: parseInt(elements.overlap?.value) || 1,
                    layout: elements.layout?.value || 'dz',
                    embedIcc: elements.embedIcc?.checked || false,
                    sequential: elements.sequential?.checked || true,
                    novector: elements.novector?.checked || false
                }
            },
            server: {
                port: parseInt(elements.serverPort?.value) || 3000
            }
        };
        
        console.log('🔧 Debug - Saving config with ICC settings:', updatedConfig.conversion.icc);
        
        const response = await fetch(`${getApiBase()}/api/pathology-config`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updatedConfig)
        });
        
        if (response.ok) {
            const result = await response.json();
            pathologyConfig = result.config;
            showMessage(`Configuration saved successfully! ICC format: ${updatedConfig.conversion.icc.intermediateFormat}`, 'success');
        } else {
            const error = await response.json();
            showMessage(`Failed to save configuration: ${error.error}`, 'error');
        }
    } catch (error) {
        console.error('Error saving configuration:', error);
        showMessage(`Error saving configuration: ${error.message}`, 'error');
    }
}

// Reload pathology configuration
async function reloadPathologyConfig() {
    try {
        const response = await fetch(`${getApiBase()}/api/pathology-config/reload`, {
            method: 'POST'
        });
        
        if (response.ok) {
            const result = await response.json();
            pathologyConfig = result.config;
            updateConfigurationUI();
            showMessage('Configuration reloaded successfully!', 'success');
        } else {
            const error = await response.json();
            showMessage(`Failed to reload configuration: ${error.error}`, 'error');
        }
    } catch (error) {
        console.error('Error reloading configuration:', error);
        showMessage(`Error reloading configuration: ${error.message}`, 'error');
    }
}

// Validate pathology configuration
async function validatePathologyConfig() {
    try {
        const configToValidate = {
            deployment: {
                mode: elements.deploymentMode?.value || 'single',
                mainServer: {
                    port: parseInt(elements.mainServerPort?.value) || 3102
                }
            },
            storage: {
                slidesDir: elements.slidesDir?.textContent || 'C:\\OG',
                dziDir: elements.dziDir?.textContent || 'C:\\dzi'
            },
            conversion: {
                defaultConcurrency: parseInt(elements.defaultConcurrency?.value) || 8,
                vips: {
                    concurrency: parseInt(elements.vipsConcurrency?.value) || 32,
                    quality: parseInt(elements.vipsQuality?.value) || 95
                }
            }
        };
        
        const response = await fetch(`${getApiBase()}/api/pathology-config/validate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(configToValidate)
        });
        
        if (response.ok) {
            const result = await response.json();
            if (result.valid) {
                showMessage('Configuration is valid!', 'success');
            } else {
                showMessage(`Configuration errors: ${result.errors.join(', ')}`, 'error');
            }
        } else {
            const error = await response.json();
            showMessage(`Validation failed: ${error.error}`, 'error');
        }
    } catch (error) {
        console.error('Error validating configuration:', error);
        showMessage(`Error validating configuration: ${error.message}`, 'error');
    }
}

// Show/hide messages
function showMessage(message, type) {
    hideMessages();
    
    if (type === 'error' && elements.validationErrors) {
        elements.validationErrors.textContent = message;
        elements.validationErrors.classList.add('show');
        setTimeout(() => elements.validationErrors.classList.remove('show'), 5000);
    } else if (type === 'success' && elements.successMessage) {
        elements.successMessage.textContent = message;
        elements.successMessage.classList.add('show');
        setTimeout(() => elements.successMessage.classList.remove('show'), 3000);
    }
}

function hideMessages() {
    if (elements.validationErrors) elements.validationErrors.classList.remove('show');
    if (elements.successMessage) elements.successMessage.classList.remove('show');
}

// ===== SERVER MANAGEMENT =====

// Refresh servers list
async function refreshServersList() {
    try {
        const response = await fetch('http://localhost:3102/api/conversion-servers');
        if (response.ok) {
            const data = await response.json();
            updateServersList(data);
            updateServerMetrics(data);
        } else {
            console.warn('Failed to fetch servers list');
        }
    } catch (error) {
        console.error('Error fetching servers list:', error);
    }
}

// Update servers list UI
function updateServersList(data) {
    if (!elements.serversList) return;
    
    elements.serversList.innerHTML = '';
    
    if (data.servers && data.servers.length > 0) {
        data.servers.forEach(server => {
            const serverItem = createServerItem(server);
            elements.serversList.appendChild(serverItem);
        });
    } else {
        elements.serversList.innerHTML = '<div style="padding: 20px; text-align: center; color: #cccccc;">No conversion servers registered</div>';
    }
}

// Create server item element
function createServerItem(server) {
    const div = document.createElement('div');
    div.className = 'server-item';
    div.setAttribute('data-server-id', server.id);
    
    const loadPercentage = server.maxConcurrent > 0 ? (server.activeConversions / server.maxConcurrent) * 100 : 0;
    const statusClass = server.isHealthy ? 'online' : 'offline';
    
    div.innerHTML = `
        <div class="server-header">
            <div>
                <div class="server-name">🖥️ ${server.id}</div>
                <div class="server-address">${server.host}:${server.port}</div>
            </div>
            <div class="server-controls">
                <button class="btn btn-small" onclick="configureServer('${server.id}')">Configure</button>
                <button class="btn btn-danger btn-small" onclick="removeServer('${server.id}')">Remove</button>
            </div>
        </div>
        <div class="server-status">
            <span class="status-badge ${statusClass}">${server.isHealthy ? '🟢 Online' : '🔴 Offline'}</span>
            <div class="load-bar">
                <div class="load-fill" style="width: ${loadPercentage}%"></div>
            </div>
            <div class="load-info">${server.activeConversions}/${server.maxConcurrent}</div>
        </div>
    `;
    
    return div;
}

// Update server metrics
function updateServerMetrics(data) {
    if (elements.totalServersMetric) {
        elements.totalServersMetric.textContent = data.totalServers || 0;
    }
    if (elements.totalCapacityMetric) {
        elements.totalCapacityMetric.textContent = data.totalCapacity || 0;
    }
    if (elements.activeConversionsMetric) {
        elements.activeConversionsMetric.textContent = data.activeConversions || 0;
    }
}

// Show add server form
function showAddServerForm() {
    if (elements.addServerForm) {
        elements.addServerForm.classList.add('active');
    }
}

// Hide add server form
function hideAddServerForm() {
    if (elements.addServerForm) {
        elements.addServerForm.classList.remove('active');
        // Clear form
        if (elements.newServerHost) elements.newServerHost.value = '';
        if (elements.newServerPort) elements.newServerPort.value = '3001';
        if (elements.newServerConcurrency) elements.newServerConcurrency.value = '8';
        if (elements.newServerAutoStart) elements.newServerAutoStart.checked = false;
    }
}

// Add conversion server
async function addConversionServer() {
    try {
        const serverData = {
            host: elements.newServerHost?.value || 'localhost',
            port: parseInt(elements.newServerPort?.value) || 3001,
            maxConcurrent: parseInt(elements.newServerConcurrency?.value) || 8,
            autoStart: elements.newServerAutoStart?.checked || false
        };
        
        if (!serverData.host.trim()) {
            showMessage('Host is required', 'error');
            return;
        }
        
        const response = await fetch('http://localhost:3102/api/conversion-servers/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(serverData)
        });
        
        if (response.ok) {
            const result = await response.json();
            showMessage('Conversion server added successfully!', 'success');
            hideAddServerForm();
            await refreshServersList();
        } else {
            const error = await response.json();
            showMessage(`Failed to add server: ${error.error}`, 'error');
        }
    } catch (error) {
        console.error('Error adding conversion server:', error);
        showMessage(`Error adding server: ${error.message}`, 'error');
    }
}

// Remove conversion server
async function removeServer(serverId) {
    if (!confirm(`Are you sure you want to remove server "${serverId}"?`)) {
        return;
    }
    
    try {
        const response = await fetch(`http://localhost:3102/api/conversion-servers/${encodeURIComponent(serverId)}`, {
            method: 'DELETE'
        });
        
        if (response.ok) {
            showMessage('Conversion server removed successfully!', 'success');
            await refreshServersList();
        } else {
            const error = await response.json();
            showMessage(`Failed to remove server: ${error.error}`, 'error');
        }
    } catch (error) {
        console.error('Error removing conversion server:', error);
        showMessage(`Error removing server: ${error.message}`, 'error');
    }
}

// Configure server (placeholder)
function configureServer(serverId) {
    alert(`Server configuration for "${serverId}" - Feature coming soon!`);
}

// Directory browsing
function setupBrowseButtons() {
    document.getElementById('selectSlidesBtn').onclick = () => browseDirectory('slidesDir', 'sourceDir');
    document.getElementById('selectDziBtn').onclick = () => browseDirectory('dziDir', 'destinationDir');
    document.getElementById('selectTempBtn').onclick = () => browseDirectory('tempDir', 'tempDir');
}

function browseDirectory(displayElementId, configField) {
    // Check if we're running in Electron
    if (window.parent && window.parent !== window) {
        // We're in an iframe, use Electron IPC bridge
        const requestId = Date.now().toString();
        
        // Listen for the response
        const messageHandler = (event) => {
            if (event.data.action === 'directorySelected' && event.data.requestId === requestId) {
                window.removeEventListener('message', messageHandler);
                if (event.data.path) {
                    document.getElementById(displayElementId).textContent = event.data.path;
                    // Update the config
                    if (configField === 'sourceDir') {
                        currentConfig.sourceDir = event.data.path;
                    } else if (configField === 'destinationDir') {
                        currentConfig.destinationDir = event.data.path;
                    } else if (configField === 'tempDir') {
                        currentConfig.tempDir = event.data.path;
                    }
                    // Auto-save the configuration
                    saveGuiConfig();
                }
            }
        };
        
        window.addEventListener('message', messageHandler);
        
        // Send request to parent (Electron renderer)
        window.parent.postMessage({
            action: 'selectDirectory',
            requestId: requestId
        }, '*');
    } else {
        // Fallback to prompt for non-Electron environments
        const path = prompt('Enter directory path:', document.getElementById(displayElementId).textContent);
        if (path) {
            document.getElementById(displayElementId).textContent = path;
            // Update the config
            if (configField === 'sourceDir') {
                currentConfig.sourceDir = path;
            } else if (configField === 'destinationDir') {
                currentConfig.destinationDir = path;
            } else if (configField === 'tempDir') {
                currentConfig.tempDir = path;
            }
            // Auto-save the configuration
            saveGuiConfig();
        }
    }
}

async function loadGuiConfig() {
    try {
        const response = await fetch('/api/config');
        if (response.ok) {
            const config = await response.json();
            // Update directory displays
            if (config.sourceDir) document.getElementById('slidesDir').textContent = config.sourceDir;
            if (config.destinationDir) document.getElementById('dziDir').textContent = config.destinationDir;
            if (config.tempDir) document.getElementById('tempDir').textContent = config.tempDir;
            // Update currentConfig
            currentConfig = { ...currentConfig, ...config };
        }
    } catch (error) {
        console.error('Failed to load GUI config:', error);
    }
}

async function saveGuiConfig() {
    try {
        const response = await fetch('/api/config', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(currentConfig)
        });
        
        if (response.ok) {
            const result = await response.json();
            console.log('Configuration saved successfully:', result);
        } else {
            const errorText = await response.text();
            console.error('Failed to save configuration:', errorText);
            throw new Error(`HTTP ${response.status}: ${errorText}`);
        }
    } catch (error) {
        console.error('Error saving GUI config:', error);
        throw error;
    }
}
