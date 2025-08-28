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
    let slides = [];
    let ws = null;
    let currentSlide = null;

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
        } catch (error) {
            console.error('Error loading slides:', error);
            slideSelector.innerHTML = '<option value="">Error loading slides</option>';
        }
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

    // Initialize
    loadSlides();
});
