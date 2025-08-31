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
    const colorProfilePanel = document.getElementById('color-profile-panel');
    const profileSelector = document.getElementById('profile-selector');
    const profileInfo = document.getElementById('profile-info');
    let slides = [];
    let ws = null;
    let currentSlide = null;
    let colorProfiles = [];

    // WebSocket connection for real-time updates
    function connectWebSocket() {
        ws = new WebSocket(`ws://${window.location.host}`);
        
        ws.onmessage = function(event) {
            const data = JSON.parse(event.data);
            if (data.type === 'conversion_complete' || data.type === 'auto_conversion_complete') {
                alert(`Conversion completed for ${data.filename || data.fileName}! Refreshing slide list...`);
                loadSlides();
                
                // If color profile was extracted, show notification
                if (data.colorProfile) {
                    const hasProfile = data.colorProfile.hasEmbeddedProfile;
                    const profileMsg = hasProfile ? 
                        `Color profile extracted: ${data.colorProfile.description}` :
                        'No embedded color profile found - using default settings';
                    console.log(profileMsg);
                }
            } else if (data.type === 'conversion_error' || data.type === 'auto_conversion_error') {
                alert(`Conversion failed for ${data.filename || data.fileName}: ${data.error}`);
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

    // Load color profiles
    async function loadColorProfiles() {
        try {
            const response = await fetch('/api/color-profiles/list');
            if (response.ok) {
                const data = await response.json();
                colorProfiles = data.profiles;
            }
        } catch (error) {
            console.error('Error loading color profiles:', error);
        }
    }

    // Load standard color profiles
    async function loadStandardProfiles() {
        try {
            const response = await fetch('/api/color-profiles/standards');
            if (response.ok) {
                const standards = await response.json();
                populateProfileSelector(standards);
            }
        } catch (error) {
            console.error('Error loading standard profiles:', error);
        }
    }

    // Populate profile selector
    function populateProfileSelector(standards) {
        if (!profileSelector) return;
        
        profileSelector.innerHTML = '';
        const defaultOption = document.createElement('option');
        defaultOption.value = '';
        defaultOption.textContent = 'Auto (Preserve Original)';
        profileSelector.appendChild(defaultOption);
        
        Object.entries(standards.profiles).forEach(([key, name]) => {
            const option = document.createElement('option');
            option.value = key;
            option.textContent = name;
            profileSelector.appendChild(option);
        });
    }

    // Load slide color profile
    async function loadSlideColorProfile(slideName) {
        if (!profileInfo) return;
        
        try {
            const response = await fetch(`/api/slides/${slideName}/color-profile`);
            if (response.ok) {
                const profile = await response.json();
                displayProfileInfo(profile);
            } else {
                profileInfo.innerHTML = '<p class="text-muted">No color profile information available</p>';
            }
        } catch (error) {
            console.error('Error loading slide color profile:', error);
            profileInfo.innerHTML = '<p class="text-danger">Error loading color profile</p>';
        }
    }

    // Display profile information
    function displayProfileInfo(profile) {
        if (!profileInfo) return;
        
        const hasProfile = profile.hasEmbeddedProfile;
        const statusClass = hasProfile ? 'text-success' : 'text-warning';
        const statusIcon = hasProfile ? '✓' : '⚠️';
        
        profileInfo.innerHTML = `
            <div class="profile-status ${statusClass}">
                <strong>${statusIcon} ${hasProfile ? 'Embedded Profile Found' : 'No Embedded Profile'}</strong>
            </div>
            <div class="profile-details mt-2">
                <p><strong>Color Space:</strong> ${profile.colorSpace || 'Unknown'}</p>
                <p><strong>Description:</strong> ${profile.description || 'N/A'}</p>
                ${hasProfile ? `<p><strong>Profile Type:</strong> ${profile.profileType || 'Unknown'}</p>` : ''}
                ${profile.recommendedProfile ? `<p><strong>Recommended:</strong> ${profile.recommendedProfile}</p>` : ''}
                <p class="text-muted small">Extracted: ${new Date(profile.extractedAt).toLocaleString()}</p>
            </div>
        `;
    }

    // Handle slide selection
    slideSelector.addEventListener('change', function() {
        const selectedValue = this.value;
        if (!selectedValue) return;
        
        try {
            console.log('Selected value:', selectedValue);
            const slide = JSON.parse(selectedValue);
            console.log('Parsed slide:', slide);
            
            currentSlide = slide;
            
            if (slide.converted && slide.dziFile) {
                // Load the DZI file
                console.log('Loading DZI file:', slide.dziFile);
                viewer.open({
                    type: 'image',
                    tileSource: slide.dziFile
                });
                
                // Show color profile panel and load profile info
                if (colorProfilePanel) {
                    colorProfilePanel.style.display = 'block';
                    loadSlideColorProfile(slide.name);
                }
                convertBtn.style.display = 'none';
            } else {
                // Show convert button instead of dialog
                convertBtn.style.display = 'block';
                convertBtn.textContent = `Convert ${slide.name} (${slide.size ? (slide.size / 1024 / 1024 / 1024).toFixed(1) + 'GB' : 'Unknown size'})`;
                viewer.open([]);
                
                // Hide color profile panel for unconverted slides
                if (colorProfilePanel) {
                    colorProfilePanel.style.display = 'none';
                }
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
    loadColorProfiles();
    loadStandardProfiles();
});
