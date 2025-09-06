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

    // Backend base configuration (supports full URL like https://path2.slidelis.com)
    function getDefaultBackendBase() {
        const host = window.location.hostname || 'localhost';
        return `http://${host}:3101`;
    }
    function getBackendBase() {
        return (localStorage.getItem('backendBase') || getDefaultBackendBase()).replace(/\/$/, '');
    }
    function setBackendBase(url) {
        try {
            const cleaned = (url || '').trim().replace(/\/$/, '');
            // Basic validation
            const _ = new URL(cleaned.startsWith('http') ? cleaned : `https://${cleaned}`);
            localStorage.setItem('backendBase', _.origin);
        } catch (_) {
            alert('Please enter a valid URL, e.g. https://path2.slidelis.com');
        }
    }
    function getApiBase() { return getBackendBase(); }
    function getWsUrl() {
        try {
            const u = new URL(getBackendBase());
            const wsProto = (u.protocol === 'https:') ? 'wss:' : 'ws:';
            return `${wsProto}//${u.host}`;
        } catch (_) {
            // Fallback to previous behavior
            const host = window.location.hostname || 'localhost';
            return `ws://${host}:3101`;
        }
    }
    let API_BASE = getApiBase();

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
            const currentBase = getBackendBase();
            slideList.innerHTML = `
                <div style="padding: 15px; color: #dc3545;">
                    Error loading slides from <b>${currentBase}</b>.<br/>
                    Ensure the backend is reachable.
                </div>
            `;
            ensureBackendHostControls(currentBase);
        }
    }

    function ensureBackendHostControls(currentBase) {
        if (!slideControls) return;
        if (document.getElementById('backend-host-controls')) return;
        const wrap = document.createElement('div');
        wrap.id = 'backend-host-controls';
        wrap.style.cssText = 'margin-top:8px; display:flex; gap:6px;';
        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = 'Backend base (e.g. https://path2.slidelis.com)';
        input.value = currentBase || '';
        input.style.cssText = 'flex:1; padding:4px;';
        const btn = document.createElement('button');
        btn.textContent = 'Save & Retry';
        btn.style.cssText = 'padding:4px 8px;';
        btn.onclick = () => {
            const base = input.value.trim();
            if (!base) return;
            setBackendBase(base);
            API_BASE = getApiBase();
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

        // Thumbnail (from macro/label if available)
        const thumb = document.createElement('img');
        thumb.className = 'slide-thumb';
        const resolvedThumb = slide.thumbnailUrl ? `${API_BASE}${slide.thumbnailUrl}` : null;
        if (resolvedThumb) {
            thumb.src = resolvedThumb;
            thumb.alt = `${slide.name} thumb`;
        } else {
            // simple placeholder
            thumb.src = 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56"><rect width="56" height="56" fill="#f1f3f5"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-size="10" fill="#adb5bd">No Img</text></svg>`);
            thumb.alt = 'No thumbnail';
        }

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
        
        // Assemble grid columns: [checkbox] [thumb] [info (+progress)] [actions]
        selectWrap.appendChild(checkbox);
        item.appendChild(selectWrap);
        item.appendChild(thumb);
        item.appendChild(slideInfo);
        item.appendChild(slideActions);
        
        // Click to select slide
        item.onclick = () => selectSlideFromSidebar(slide);
        
        return item;
    }

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
        // Update associated images panel
        const assoc = document.getElementById('assoc-images');
        const labelImg = document.getElementById('label-img');
        const macroImg = document.getElementById('macro-img');
        if (assoc && labelImg && macroImg) {
            const labelSrc = slide.labelUrl ? `${API_BASE}${slide.labelUrl}` : '';
            const macroSrc = slide.macroUrl ? `${API_BASE}${slide.macroUrl}` : '';
            labelImg.src = labelSrc || '';
            macroImg.src = macroSrc || '';
            assoc.style.display = (labelSrc || macroSrc) ? 'block' : 'none';
        }

        if (slide.converted && slide.dziFile) {
            const dziUrl = `${API_BASE}${slide.dziFile}`; // prefix with backend base so tiles resolve correctly via CF
            console.log('Loading DZI file:', dziUrl);
            viewer.open({
                type: 'image',
                tileSource: dziUrl
            });
            convertBtn.style.display = 'none';
        } else {
            convertBtn.style.display = 'block';
            convertBtn.textContent = `Convert ${slide.name}`;
            viewer.open([]);
            // No dzi yet, but still show assoc images if any
            const assoc2 = document.getElementById('assoc-images');
            if (assoc2) assoc2.style.display = (slide.labelUrl || slide.macroUrl) ? 'block' : 'none';
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
                    item.classList.add('converting');
                    const prog = getOrCreateProgressBar(name);
                    const bar = item.querySelector('.convert-progress-bar');
                    const label = item.querySelector('.convert-progress-label');
                    if (bar) {
                        const current = parseFloat(bar.style.width) || 0;
                        const next = Math.min(90, current + 5);
                        bar.style.width = (data.done ? 100 : next) + '%';
                    }
                    if (label) {
                        label.textContent = data.done ? `Finalizing...` : `Converting...`;
                    }
                    if (data.done) {
                        setTimeout(() => loadSlides(), 1000);
                    }
                }
            } else if (data.type === 'slide_deleted') {
                slides = slides.filter(s => s.name !== data.filename);
                updateSlideList();
                
                if (currentSlide && currentSlide.name === data.filename) {
                    viewer.open([]);
                    currentSlide = null;
                    convertBtn.style.display = 'none';
                }
            } else if (data.type === 'auto_conversion_complete') {
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
