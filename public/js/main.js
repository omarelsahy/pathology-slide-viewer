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

    const slideSelector = document.getElementById('slide-selector');
    const convertBtn = document.getElementById('convert-btn');
    const slideList = document.getElementById('slide-list');
    const sortSelect = document.getElementById('sort-select');
    let slides = [];
    let ws = null;
    let currentSlide = null;
    let currentSortBy = 'name';

    // WebSocket connection for real-time updates
    function connectWebSocket() {
        ws = new WebSocket(`ws://${window.location.host}`);
        
        ws.onmessage = function(event) {
            const data = JSON.parse(event.data);
            if (data.type === 'conversion_complete') {
                alert(`Conversion completed for ${data.filename}! Refreshing slide list...`);
                loadSlides();
            } else if (data.type === 'conversion_error') {
                alert(`Conversion failed for ${data.filename}: ${data.error}`);
            }
        };
        
        ws.onclose = function() {
            setTimeout(connectWebSocket, 3000); // Reconnect after 3 seconds
        };
    }
    
    connectWebSocket();

    // Load available slides
    async function loadSlides() {
        try {
            const response = await fetch('/api/slides');
            slides = await response.json();
            
            updateSlideSelector();
            updateSlideList();
        } catch (error) {
            console.error('Error loading slides:', error);
            slideSelector.innerHTML = '<option value="">Error loading slides</option>';
            slideList.innerHTML = '<div style="padding: 15px; color: #dc3545;">Error loading slides</div>';
        }
    }

    // Update the dropdown selector (keep for backward compatibility)
    function updateSlideSelector() {
        slideSelector.innerHTML = '';
        const defaultOption = document.createElement('option');
        defaultOption.value = '';
        defaultOption.textContent = 'Select a slide...';
        slideSelector.appendChild(defaultOption);
        
        slides.forEach(slide => {
            const option = document.createElement('option');
            option.value = JSON.stringify(slide);
            const status = slide.converted ? '✓' : '⚠️';
            const size = slide.size ? `(${(slide.size / 1024 / 1024 / 1024).toFixed(1)}GB)` : '';
            option.textContent = `${status} ${slide.name} ${size}`;
            slideSelector.appendChild(option);
        });
    }

    // Update the sidebar slide list
    function updateSlideList() {
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
        
        // Delete button
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'delete-btn';
        deleteBtn.textContent = 'Delete';
        deleteBtn.onclick = (e) => {
            e.stopPropagation();
            deleteSlide(slide);
        };
        slideActions.appendChild(deleteBtn);
        
        item.appendChild(slideInfo);
        item.appendChild(slideActions);
        
        // Click to select slide
        item.onclick = () => selectSlideFromSidebar(slide);
        
        return item;
    }

    // Handle slide selection
    slideSelector.addEventListener('change', function() {
        const selectedValue = this.value;
        if (!selectedValue) return;
        
        try {
            console.log('Selected value:', selectedValue);
            const slide = JSON.parse(selectedValue);
            console.log('Parsed slide:', slide);
            
            if (slide.converted && slide.dziFile) {
                // Load the DZI file
                console.log('Loading DZI file:', slide.dziFile);
                viewer.open({
                    type: 'image',
                    tileSource: slide.dziFile
                });
            } else {
                // Show convert button instead of dialog
                currentSlide = slide;
                convertBtn.style.display = 'block';
                convertBtn.textContent = `Convert ${slide.name} (${slide.size ? (slide.size / 1024 / 1024 / 1024).toFixed(1) + 'GB' : 'Unknown size'})`;
                viewer.open([]);
            }
        } catch (error) {
            console.error('Error handling slide selection:', error);
            alert('Error loading slide data. Please check the console for details.');
        }
    });

    // Convert slide to DZI format
    async function convertSlide(slide) {
        try {
            console.log('Starting conversion for slide:', slide);
            const filename = slide.originalFile.split('/').pop();
            console.log('Filename to convert:', filename);
            
            convertBtn.textContent = 'Converting...';
            
            const response = await fetch(`/api/convert/${filename}`, {
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
        
        // Update dropdown selector
        slideSelector.value = JSON.stringify(slide);
        
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
            const response = await fetch(`/api/convert/${filename}`, {
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
            console.error('Conversion error:', error);
            alert(`Conversion failed: ${error.message}`);
        }
    }

    // Delete slide
    async function deleteSlide(slide) {
        if (!confirm(`Are you sure you want to delete "${slide.name}"? This will remove both the original file and any converted DZI files.`)) {
            return;
        }
        
        try {
            const filename = slide.originalFile ? slide.originalFile.split('/').pop() : `${slide.name}.dzi`;
            const response = await fetch(`/api/slides/${filename}`, {
                method: 'DELETE'
            });
            
            const result = await response.json();
            
            if (response.ok) {
                console.log(`Deleted slide: ${slide.name}`);
                // Remove from local slides array
                slides = slides.filter(s => s.name !== slide.name);
                updateSlideList();
                updateSlideSelector();
                
                // Clear viewer if this was the active slide
                if (currentSlide && currentSlide.name === slide.name) {
                    viewer.open([]);
                    currentSlide = null;
                    convertBtn.style.display = 'none';
                }
            } else {
                alert(`Delete failed: ${result.error}`);
            }
        } catch (error) {
            console.error('Delete error:', error);
            alert(`Delete failed: ${error.message}`);
        }
    }

    // Enhanced WebSocket message handling
    function connectWebSocket() {
        ws = new WebSocket(`ws://${window.location.host}`);
        
        ws.onmessage = function(event) {
            const data = JSON.parse(event.data);
            if (data.type === 'conversion_complete') {
                alert(`Conversion completed for ${data.filename}! Refreshing slide list...`);
                loadSlides();
            } else if (data.type === 'conversion_error') {
                alert(`Conversion failed for ${data.filename}: ${data.error}`);
                loadSlides();
            } else if (data.type === 'slide_deleted') {
                // Handle slide deletion from other clients
                slides = slides.filter(s => s.name !== data.filename);
                updateSlideList();
                updateSlideSelector();
                
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
