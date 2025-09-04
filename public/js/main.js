document.addEventListener('DOMContentLoaded', function() {
    let viewer = OpenSeadragon({
        id: "viewer",
        prefixUrl: "https://cdnjs.cloudflare.com/ajax/libs/openseadragon/3.1.0/images/",
        showNavigator: true,
        sequenceMode: true,
        showRotationControl: true,
        showZoomControl: true,
        showHomeControl: true,
        showFullPageControl: true,
        showReferenceStrip: true
    });

    const convertBtn = document.getElementById('convert-btn');
    const slideList = document.getElementById('slide-list');
    const sortSelect = document.getElementById('sort-select');
    const bulkActions = document.getElementById('bulk-actions');
    const bulkDeleteBtn = document.getElementById('bulk-delete-btn');
    // Create a small backend host settings UI inside slide controls
    const slideControls = document.getElementById('slide-controls');
    let slides = [];
    let ws = null;
    let currentSlide = null;
    let currentSortBy = 'name';
    const selectedSlides = new Set();

    // Backend host configuration
    function getBackendHost() {
        return localStorage.getItem('backendHost') || window.location.hostname || 'localhost';
    }

    // Show/hide bulk actions based on current selection
    function updateBulkActions() {
        if (!bulkActions) return;
        const count = selectedSlides.size;
        if (count > 0) {
            bulkActions.classList.add('visible');
            if (bulkDeleteBtn) bulkDeleteBtn.textContent = `Delete selected (${count})`;
        } else {
            bulkActions.classList.remove('visible');
            if (bulkDeleteBtn) bulkDeleteBtn.textContent = 'Delete selected';
        }
    }

    // Bulk delete handler
    if (bulkDeleteBtn) {
        bulkDeleteBtn.onclick = async () => {
            const names = Array.from(selectedSlides);
            if (names.length === 0) return;
            if (!confirm(`Delete ${names.length} slide(s)? This cannot be undone.`)) return;

            for (const name of names) {
                try {
                    const resp = await fetch(`${API_BASE}/api/slides/${encodeURIComponent(name)}`, { method: 'DELETE' });
                    if (!resp.ok) {
                        const err = await resp.text();
                        console.error('Delete failed:', name, err);
                        alert(`Failed to delete ${name}: ${resp.status}`);
                        continue;
                    }
                    // Remove from local state and UI
                    slides = slides.filter(s => s.name !== name);
                    const item = document.querySelector(`[data-slide-name="${name}"]`);
                    if (item && item.parentElement) item.parentElement.removeChild(item);
                    selectedSlides.delete(name);
                } catch (e) {
                    console.error('Delete error:', name, e);
                    alert(`Error deleting ${name}: ${e.message}`);
                }
            }
            updateBulkActions();
            // Reload to resync state
            loadSlides();
        };
    }
    function setBackendHost(host) {
        localStorage.setItem('backendHost', host);
    }
    function getApiBase() { return `http://${getBackendHost()}:3101`; }
    function getWsUrl() { return `ws://${getBackendHost()}:3101`; }
    let API_BASE = getApiBase();

    // Simple helper to get or create a progress bar inside a slide item
    function getOrCreateProgressBar(slideName) {
        const item = document.querySelector(`[data-slide-name="${slideName}"]`);
        if (!item) return null;
        let prog = item.querySelector('.convert-progress');
        if (!prog) {
            prog = document.createElement('div');
            prog.className = 'convert-progress';
            prog.style.cssText = 'margin-top:8px;background:#eee;border-radius:4px;height:8px;position:relative;overflow:hidden;';
            const bar = document.createElement('div');
            bar.className = 'convert-progress-bar';
            bar.style.cssText = 'position:absolute;left:0;top:0;height:100%;width:0%;background:#28a745;transition:width 0.3s;';
            const label = document.createElement('div');
            label.className = 'convert-progress-label';
            label.style.cssText = 'margin-top:4px;font-size:12px;color:#555;';
            prog.appendChild(bar);
            item.appendChild(prog);
            item.appendChild(label);
        }
        return prog;
    }

    // Load available slides
    async function loadSlides() {
        try {
            const url = `${API_BASE}/api/slides`;
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status} at ${url}`);
            }
            slides = await response.json();
            
            updateSlideList();
        } catch (error) {
            console.error('Error loading slides:', error);
            const currentHost = getBackendHost();
            slideList.innerHTML = `
                <div style="padding: 15px; color: #dc3545;">
                    Error loading slides from <b>${API_BASE}</b>.<br/>
                    Ensure the backend is reachable at port 3101.
                </div>
            `;
            ensureBackendHostControls(currentHost);
        }
    }

    function ensureBackendHostControls(currentHost) {
        if (!slideControls) return;
        if (document.getElementById('backend-host-controls')) return;
        const wrap = document.createElement('div');
        wrap.id = 'backend-host-controls';
        wrap.style.cssText = 'margin-top:8px; display:flex; gap:6px;';
        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = 'Backend host e.g. 192.168.1.100';
        input.value = currentHost || '';
        input.style.cssText = 'flex:1; padding:4px;';
        const btn = document.createElement('button');
        btn.textContent = 'Save & Retry';
        btn.style.cssText = 'padding:4px 8px;';
        btn.onclick = () => {
            const host = input.value.trim();
            if (!host) return;
            setBackendHost(host);
            API_BASE = getApiBase();
            // Reconnect WS
            try { if (ws) ws.close(); } catch(_) {}
            connectWebSocket();
            loadSlides();
        };
        wrap.appendChild(input);
        wrap.appendChild(btn);
        slideControls.insertBefore(wrap, slideControls.firstChild);
    }

    // Update the sidebar slide list
    function updateSlideList() {
        selectedSlides.clear();
        updateBulkActions();
        const sortedSlides = [...slides].sort((a, b) => {
            switch (currentSortBy) {
                case 'name':
                    return a.name.localeCompare(b.name);
                case 'date':
                    // Use file modification time if available, otherwise name
                    return a.name.localeCompare(b.name);
                case 'size':
                    return (b.size || 0) - (a.size || 0);
                case 'format':
                    return a.format.localeCompare(b.format);
                case 'status':
                    return (b.converted ? 1 : 0) - (a.converted ? 1 : 0);
                default:
                    return 0;
            }
        });

        slideList.innerHTML = '';
        
        if (sortedSlides.length === 0) {
            slideList.innerHTML = '<div style="padding: 15px; color: #6c757d; text-align: center;">No slides found</div>';
            return;
        }

        sortedSlides.forEach(slide => {
            const slideItem = createSlideListItem(slide);
            slideList.appendChild(slideItem);
        });
    }

    // Create individual slide list item
    function createSlideListItem(slide) {
        const item = document.createElement('div');
        item.className = 'slide-item';
        item.dataset.slideName = slide.name;
        
        // Selection checkbox
        const selectWrap = document.createElement('div');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'slide-select';
        checkbox.addEventListener('click', (e) => {
            e.stopPropagation();
            if (checkbox.checked) selectedSlides.add(slide.name); else selectedSlides.delete(slide.name);
            updateBulkActions();
        });

        const slideInfo = document.createElement('div');
        slideInfo.className = 'slide-info';
        
        const slideName = document.createElement('div');
        slideName.className = 'slide-name';
        slideName.textContent = slide.name;
        
        const slideDetails = document.createElement('div');
        slideDetails.className = 'slide-details';
        const status = slide.converted ? '✓ Converted' : '⚠️ Not converted';
        const size = slide.size ? `${(slide.size / 1024 / 1024 / 1024).toFixed(1)}GB` : 'Unknown size';
        slideDetails.textContent = `${status} • ${slide.format} • ${size}`;
        
        slideInfo.appendChild(slideName);
        slideInfo.appendChild(slideDetails);
        
        const slideActions = document.createElement('div');
        slideActions.className = 'slide-actions';
        
        // Convert button (if not converted)
        if (!slide.converted) {
            const convertBtn = document.createElement('button');
            convertBtn.className = 'convert-btn';
            convertBtn.textContent = 'Convert';
            convertBtn.onclick = (e) => {
                e.stopPropagation();
                convertSlideFromSidebar(slide);
            };
            slideActions.appendChild(convertBtn);
        }
        
        // Assemble grid columns: [checkbox] [info (+progress)] [actions]
        selectWrap.appendChild(checkbox);
        item.appendChild(selectWrap);
        item.appendChild(slideInfo);
        item.appendChild(slideActions);
        
        // Click to select slide
        item.onclick = () => selectSlideFromSidebar(slide);
        
        return item;
    }

    // Removed old selector UI and handler

    // Convert slide to DZI format
    async function convertSlide(slide) {
        try {
            console.log('Starting conversion for slide:', slide);
            const filename = slide.originalFile.split('/').pop();
            console.log('Filename to convert:', filename);
            
            convertBtn.textContent = 'Converting...';
            
            const response = await fetch(`${API_BASE}/api/convert/${filename}`, {
                method: 'POST'
            });
            
            console.log('Conversion response status:', response.status);
            const result = await response.json();
            console.log('Conversion response:', result);
            
            if (response.ok) {
                convertBtn.textContent = 'Conversion in progress...';
                convertBtn.style.background = '#28a745';
                alert(`Conversion started for ${slide.name}. Check the server console for progress.`);
            } else {
                convertBtn.textContent = 'Conversion failed';
                convertBtn.style.background = '#dc3545';
                convertBtn.disabled = false;
                alert(`Conversion failed: ${result.error}`);
            }
        } catch (error) {
            console.error('Conversion error:', error);
            convertBtn.textContent = 'Conversion failed';
            convertBtn.style.background = '#dc3545';
            convertBtn.disabled = false;
            alert(`Conversion failed: ${error.message}`);
        }
    }

    // Convert button click handler
    convertBtn.addEventListener('click', function() {
        if (currentSlide) {
            console.log('Convert button clicked for:', currentSlide);
            
            // Skip confirmation for now and start conversion directly
            convertBtn.textContent = 'Starting conversion...';
            convertBtn.disabled = true;
            convertSlide(currentSlide);
        }
    });

    // Sort selection handler
    sortSelect.addEventListener('change', function() {
        currentSortBy = this.value;
        updateSlideList();
    });

    // Select slide from sidebar
    function selectSlideFromSidebar(slide) {
        // Update active state in sidebar
        document.querySelectorAll('.slide-item').forEach(item => {
            item.classList.remove('active');
        });
        document.querySelector(`[data-slide-name="${slide.name}"]`).classList.add('active');
        
        // Load the slide
        currentSlide = slide;
        if (slide.converted && slide.dziFile) {
            console.log('Loading DZI file:', slide.dziFile);
            viewer.open({
                type: 'image',
                tileSource: slide.dziFile
            });
            convertBtn.style.display = 'none';
        } else {
            convertBtn.style.display = 'block';
            convertBtn.textContent = `Convert ${slide.name}`;
            viewer.open([]);
        }
    }

    // Convert slide from sidebar
    async function convertSlideFromSidebar(slide) {
        try {
            const filename = slide.originalFile.split('/').pop();
            const response = await fetch(`${API_BASE}/api/convert/${filename}`, {
                method: 'POST'
            });
            
            const result = await response.json();
            
            if (response.ok) {
                console.log(`Conversion started for ${slide.name}`);
                // Update button state
                const slideItem = document.querySelector(`[data-slide-name="${slide.name}"]`);
                const convertBtn = slideItem.querySelector('.convert-btn');
                if (convertBtn) {
                    convertBtn.textContent = 'Converting...';
                    convertBtn.disabled = true;
                }
            } else {
                alert(`Conversion failed: ${result.error}`);
            }
        } catch (error) {
            console.error('Conversion start error:', error);
            alert(`Conversion failed to start: ${error.message}`);
        }
    }

    // Enhanced WebSocket message handling (backend is on 3101)
    function connectWebSocket() {
        ws = new WebSocket(getWsUrl());
        
        ws.onmessage = function(event) {
            const data = JSON.parse(event.data);
            if (data.type === 'conversion_complete') {
                alert(`Conversion completed for ${data.filename}! Refreshing slide list...`);
                loadSlides();
            } else if (data.type === 'conversion_error') {
                alert(`Conversion failed for ${data.filename}: ${data.error}`);
                loadSlides();
            } else if (data.type === 'conversion_progress') {
                // Update per-slide progress display
                const name = data.filename;
                const item = document.querySelector(`[data-slide-name="${name}"]`);
                if (item) {
                    // Grey out converting card
                    item.classList.add('converting');
                    const prog = getOrCreateProgressBar(name);
                    const bar = item.querySelector('.convert-progress-bar');
                    const label = item.querySelector('.convert-progress-label');
                    // Indeterminate smooth progress up to 90%, finalize on done
                    if (bar) {
                        const current = parseFloat(bar.style.width) || 0;
                        const next = Math.min(90, current + 5); // gently advance
                        bar.style.width = (data.done ? 100 : next) + '%';
                    }
                    if (label) {
                        label.textContent = data.done ? `Finalizing...` : `Converting...`;
                    }
                    if (data.done) {
                        // Give a moment for file system settle, then refresh
                        setTimeout(() => loadSlides(), 1000);
                    }
                }
            } else if (data.type === 'slide_deleted') {
                // Handle slide deletion from other clients
                slides = slides.filter(s => s.name !== data.filename);
                updateSlideList();
                
                if (currentSlide && currentSlide.name === data.filename) {
                    viewer.open([]);
                    currentSlide = null;
                    convertBtn.style.display = 'none';
                }
            } else if (data.type === 'auto_conversion_complete') {
                // Handle auto-processor conversions
                loadSlides();
            }
        };
        
        ws.onclose = function() {
            setTimeout(connectWebSocket, 3000); // Reconnect after 3 seconds
        };
    }

    // Initialize
    connectWebSocket();
    loadSlides();
});
