// Pathology Slide Viewer - Web GUI Client
// Handles UI interactions and communication with GUI server

let currentConfig = {};
let slides = [];
let ws = null;
let backendHealthy = false;

// DOM Elements
const elements = {
    // Server controls
    guiIndicator: document.getElementById('guiIndicator'),
    backendIndicator: document.getElementById('backendIndicator'),
    conversionIndicator: document.getElementById('conversionIndicator'),
    guiUrl: document.getElementById('guiUrl'),
    backendUrl: document.getElementById('backendUrl'),
    conversionUrl: document.getElementById('conversionUrl'),
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
    colorTransform: document.getElementById('colorTransform'),
    
    // VIPS Logging
    vipsProgress: document.getElementById('vipsProgress'),
    vipsInfo: document.getElementById('vipsInfo'),
    vipsWarning: document.getElementById('vipsWarning'),
    
    // Conversion Options
    autoDeleteOriginal: document.getElementById('autoDeleteOriginal'),
    
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
    importSlidesBtn: document.getElementById('importSlidesBtn'),
    importSlidesInput: document.getElementById('importSlidesInput'),
    
    // VIPS Info
    getVipsInfoBtn: document.getElementById('getVipsInfoBtn'),
    vipsInfoDisplay: document.getElementById('vipsInfoDisplay'),
    
    // Console
    consoleOutput: document.getElementById('consoleOutput'),
    clearConsoleBtn: document.getElementById('clearConsoleBtn'),
    autoScroll: document.getElementById('autoScroll')
};

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
    await loadConfig();
    setupEventListeners();
    setupWebSocket();
    await updateServerStatus();
    startBackendHealthPolling();
    await scanSlides();
    
    // Add event listener for rename buttons
    document.addEventListener('click', function(e) {
        if (e.target.classList.contains('rename-btn')) {
            const slideName = e.target.getAttribute('data-slide-name');
            const filename = e.target.getAttribute('data-filename');
            renameSlide(slideName, filename);
        }
    });
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

// Load configuration from server
async function loadConfig() {
    try {
        const response = await fetch('/api/config');
        currentConfig = await response.json();
        updateUIFromConfig();
    } catch (error) {
        console.error('Failed to load config:', error);
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
        const response = await fetch('/api/config', {
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
    // Server controls
    elements.startServerBtn.addEventListener('click', startServer);
    elements.stopServerBtn.addEventListener('click', stopServer);
    
    // Folder selection (simplified for web - just show current paths)
    elements.selectSourceBtn.addEventListener('click', () => {
        const newPath = prompt('Enter source folder path:', currentConfig.sourceDir || '');
        if (newPath) {
            currentConfig.sourceDir = newPath;
            elements.sourcePath.textContent = newPath;
            saveConfig();
            scanSlides();
        }
    });
    
    elements.selectDestBtn.addEventListener('click', () => {
        const newPath = prompt('Enter destination folder path:', currentConfig.destinationDir || '');
        if (newPath) {
            currentConfig.destinationDir = newPath;
            elements.destPath.textContent = newPath;
            saveConfig();
        }
    });
    
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
    
    // Tab switching
    elements.tabs.forEach(tab => {
        tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });
    
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

async function updateServerStatus() {
    try {
        const response = await fetch('/api/server/status');
        const status = await response.json();
        updateServerStatusUI(status.running, status.pid);
    } catch (error) {
        console.error('Failed to get server status:', error);
    }
}

function updateServerStatusUI(running, pid) {
    if (running) {
        elements.serverIndicator.classList.add('running');
        elements.serverStatusText.textContent = `Server Running (PID: ${pid})${backendHealthy ? ' • API OK' : ' • API DOWN'}`;
        elements.startServerBtn.disabled = true;
        elements.stopServerBtn.disabled = false;
    } else {
        elements.serverIndicator.classList.remove('running');
        elements.serverStatusText.textContent = 'Server Stopped';
        elements.startServerBtn.disabled = false;
        elements.stopServerBtn.disabled = true;
    }
}

// Backend health polling
function startBackendHealthPolling() {
    const poll = async () => {
        try {
            const res = await fetch('/api/backend/health');
            const json = await res.json();
            const ok = json && json.ok === true;
            if (ok !== backendHealthy) {
                backendHealthy = ok;
                updateServerStatus(); // refresh header line with API state
                appendToConsole(`Backend API ${ok ? 'is reachable' : 'is not reachable'}\n`, ok ? 'info' : 'warning');
            }
        } catch (e) {
            if (backendHealthy) {
                backendHealthy = false;
                updateServerStatus();
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
    try {
        const response = await fetch('/api/slides');
        
        if (!response.ok) {
            if (response.status === 502) {
                appendToConsole(`Backend API is not reachable\n`, 'error');
            } else {
                appendToConsole(`API error: ${response.status} ${response.statusText}\n`, 'error');
            }
            return;
        }
        
        const result = await response.json();
        
        // Debug: Log the API response to see what data we're getting
        console.log('API Response:', result);
        if (Array.isArray(result) && result.length > 0) {
            console.log('First slide data:', result[0]);
        }
        
        // Backend returns an array of slide objects; support both array and {slides: []}
        if (Array.isArray(result)) {
            slides = result;
            renderSlides();
        } else if (result && Array.isArray(result.slides)) {
            slides = result.slides;
            renderSlides();
        } else {
            console.log('Unexpected response format:', result);
            appendToConsole(`Failed to scan slides: unexpected response format\n`, 'error');
        }
    } catch (error) {
        console.error('Scan slides error:', error);
        appendToConsole(`Error scanning slides: ${error.message}\n`, 'error');
        appendToConsole(`Backend API is not reachable\n`, 'error');
    }
}

function renderSlides() {
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
            ${slide.thumbnailUrl || slide.labelUrl || slide.macroUrl ? `<div class="slide-thumbnail" style="margin-top: 4px;"><img src="${slide.thumbnailUrl || slide.labelUrl || slide.macroUrl}" alt="Slide thumbnail" style="max-width: 100%; max-height: 80px; border-radius: 4px; border: 1px solid #ddd;" onerror="this.style.display='none'"></div>` : ''}
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
        const backendUrl = `http://localhost:3102/api/touch-file/${encodeURIComponent(filename)}`;
        const response = await fetch(backendUrl, { method: 'POST' });
        
        if (!response.ok) {
            const txt = await response.text();
            appendToConsole(`Failed to trigger conversion: ${txt}\n`, 'error');
            return;
        }
        const result = await response.json();
        appendToConsole(`File touched, autoprocessor will detect and convert: ${result.status || 'triggered'}\n`, 'info');
        
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
        const response = await fetch(backendUrl, { method: 'POST' });
        
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
        const backendUrl = `http://localhost:3102/api/slides/${encodeURIComponent(filename)}`;
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

// Server status monitoring
async function updateServerStatus() {
    try {
        const response = await fetch('/api/servers/status');
        const status = await response.json();
        
        // Update GUI status (always running since we're here)
        elements.guiIndicator.className = 'status-indicator running';
        elements.guiUrl.textContent = status.gui.url;
        
        // Update backend status
        if (status.backend.connected) {
            elements.backendIndicator.className = 'status-indicator running';
            elements.backendUrl.textContent = status.backend.url;
        } else {
            elements.backendIndicator.className = 'status-indicator';
            elements.backendUrl.textContent = `${status.backend.url} (${status.backend.status})`;
        }
        
        // Update conversion server status
        if (status.conversion.connected) {
            elements.conversionIndicator.className = 'status-indicator running';
            elements.conversionUrl.textContent = status.conversion.url;
            if (status.conversion.health) {
                const health = status.conversion.health;
                elements.conversionUrl.textContent += ` (${health.activeConversions}/${health.maxConcurrent})`;
            }
        } else {
            elements.conversionIndicator.className = 'status-indicator';
            elements.conversionUrl.textContent = `${status.conversion.url} (${status.conversion.status})`;
        }
        
    } catch (error) {
        console.error('Failed to update server status:', error);
        // Mark all as disconnected on error
        elements.backendIndicator.className = 'status-indicator';
        elements.conversionIndicator.className = 'status-indicator';
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    init();
    
    // Update server status immediately and then every 5 seconds
    updateServerStatus();
    setInterval(updateServerStatus, 5000);
});
