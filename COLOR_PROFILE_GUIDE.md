# Color Profile Integration Guide

## Overview

The Pathology Slide Viewer now includes comprehensive color profile management to ensure accurate color reproduction across different pathology slides and viewing environments. This feature automatically extracts ICC color profiles from slide files and provides tools for color management during the conversion process.

## Features

### Automatic Color Profile Extraction
- Extracts embedded ICC profiles from SVS, NDPI, TIF, and other supported slide formats
- Stores profile metadata alongside DZI files for future reference
- Handles slides without embedded profiles gracefully

### Color Management During Conversion
- Preserves original color profiles in converted DZI tiles
- Applies perceptual rendering intent optimized for pathology viewing
- Supports color space transformations when needed

### Web Interface Controls
- Real-time color profile information display
- Profile override selector for standardization
- Visual indicators for profile status

## API Endpoints

### List All Color Profiles
```
GET /api/color-profiles/list
```
Returns all extracted color profiles with metadata.

### Get Standard Profiles
```
GET /api/color-profiles/standards
```
Returns standard pathology color profiles and recommendations.

### Get Slide Color Profile
```
GET /api/slides/{baseName}/color-profile
```
Returns color profile information for a specific slide.

### Validate Profile Consistency
```
POST /api/color-profiles/validate
Content-Type: application/json

{
  "slideNames": ["slide1", "slide2", "slide3"]
}
```
Validates color profile consistency across multiple slides.

### Cleanup Old Profiles
```
POST /api/color-profiles/cleanup
Content-Type: application/json

{
  "maxAge": 30
}
```
Removes color profile files older than specified days.

## File Structure

### Profile Storage
```
public/dzi/profiles/
├── slide1.icc                    # Extracted ICC profile
├── slide1_profile.json           # Profile metadata
├── slide2.icc
├── slide2_profile.json
└── ...
```

### Profile Metadata Format
```json
{
  "hasEmbeddedProfile": true,
  "profilePath": "/path/to/profile.icc",
  "colorSpace": "RGB",
  "description": "sRGB IEC61966-2.1",
  "profileType": "display",
  "isValid": true,
  "fileSize": 3144,
  "recommendedProfile": "sRGB IEC61966-2.1",
  "extractedAt": "2025-08-29T20:00:00.000Z",
  "fileInfo": {
    "baseName": "slide1",
    "originalFile": "/path/to/slide1.svs"
  }
}
```

## Standard Color Profiles

### Supported Profiles
- **sRGB IEC61966-2.1**: Standard for most pathology slides
- **Adobe RGB (1998)**: Extended gamut for specialized imaging
- **ProPhoto RGB**: Wide gamut for research applications
- **Pathology Standard RGB**: Custom profile for pathology workflows

### Recommendations by Slide Type
- **Brightfield microscopy**: sRGB (default)
- **Fluorescence imaging**: Adobe RGB
- **Darkfield imaging**: ProPhoto RGB
- **General pathology**: sRGB

## Integration Points

### VIPS Configuration
The color profile system integrates with VIPS through enhanced command generation:

```javascript
// Color-managed conversion
const command = colorProfileManager.getColorManagedCommand(inputPath, outputPath, {
  tileSize: 256,
  overlap: 1,
  quality: 90,
  preserveProfile: true,
  targetProfile: 'sRGB'
});
```

### Auto Processor Integration
The auto processor automatically extracts color profiles during batch conversion:

```javascript
// Profile extraction during auto processing
const colorProfile = await colorProfileManager.extractProfile(svsPath, baseName);
```

### WebSocket Notifications
Real-time updates include color profile information:

```javascript
{
  "type": "conversion_complete",
  "filename": "slide1",
  "dziPath": "/dzi/slide1.dzi",
  "colorProfile": {
    "hasEmbeddedProfile": true,
    "description": "sRGB IEC61966-2.1"
  }
}
```

## Frontend Implementation

### Color Profile Panel
The viewer displays color profile information when a slide is loaded:

```html
<div id="color-profile-panel">
  <h4>Color Profile</h4>
  <div id="profile-info">
    <!-- Profile status and details -->
  </div>
  <select id="profile-selector">
    <!-- Profile override options -->
  </select>
</div>
```

### JavaScript Integration
```javascript
// Load slide color profile
async function loadSlideColorProfile(slideName) {
  const response = await fetch(`/api/slides/${slideName}/color-profile`);
  const profile = await response.json();
  displayProfileInfo(profile);
}
```

## Configuration

### Environment Variables
No additional environment variables are required. The color profile system uses existing VIPS configuration.

### VIPS Requirements
- VIPS must be compiled with ICC profile support
- `vips icc_export` and `vips icc_import` commands must be available

### Directory Permissions
Ensure the profiles directory has write permissions:
```bash
chmod 755 public/dzi/profiles/
```

## Troubleshooting

### Common Issues

#### Profile Extraction Fails
- **Cause**: Slide file has no embedded ICC profile
- **Solution**: This is normal; the system will use default settings

#### VIPS ICC Commands Not Found
- **Cause**: VIPS not compiled with ICC support
- **Solution**: Reinstall VIPS with ICC libraries

#### Profile Directory Not Created
- **Cause**: Insufficient permissions
- **Solution**: Check directory permissions and ownership

### Validation Commands
```bash
# Check VIPS ICC support
vips --vips-config | grep -i icc

# Test profile extraction
vips icc_export input.svs test_profile.icc

# Validate profile directory
ls -la public/dzi/profiles/
```

## Performance Considerations

### Profile Extraction Impact
- Minimal overhead during conversion (~1-2% additional time)
- Profile files are small (typically 1-5KB)
- Extraction runs in parallel with DZI conversion

### Storage Requirements
- Each profile requires ~3KB for ICC file + 1KB for metadata
- Profiles are automatically cleaned up after 30 days
- No significant impact on storage requirements

### Memory Usage
- Profile extraction uses minimal additional memory
- ICC profiles are processed separately from image data
- No impact on VIPS memory configuration

## Best Practices

### Color Management Workflow
1. Always preserve original profiles when available
2. Use sRGB as default for general pathology viewing
3. Validate profile consistency across slide sets
4. Monitor profile extraction success rates

### Quality Assurance
1. Regularly validate color profile consistency
2. Check for slides without embedded profiles
3. Monitor conversion logs for profile-related warnings
4. Test color accuracy with reference slides

### Maintenance
1. Run profile cleanup monthly
2. Monitor profile directory size
3. Update standard profiles as needed
4. Document any custom color workflows

## Future Enhancements

### Planned Features
- Color temperature adjustment controls
- Batch profile application
- Custom profile upload
- Color matching between slides
- Profile-based image enhancement

### Integration Opportunities
- DICOM color space support
- Laboratory-specific profile standards
- Automated color calibration
- Multi-monitor color management
