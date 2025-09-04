// Test script to extract metadata from existing slide
const config = require('./config');
const SlideMetadataExtractor = require('./slideMetadataExtractor');

async function testMetadataExtraction() {
  const extractor = new SlideMetadataExtractor(config);
  
  // Test with slide 9705
  const slidePath = 'c:\\Slide Viewer\\pathology-slide-viewer\\public\\slides\\FWD25_9705_A_1_Schermerhorn, Roger_HE_115107.svs';
  const baseName = 'FWD25_9705_A_1_Schermerhorn, Roger_HE_115107';
  
  console.log('Testing metadata extraction...');
  console.log(`Slide: ${slidePath}`);
  console.log(`Base name: ${baseName}`);
  console.log(`Metadata directory: ${extractor.metadataDir}`);
  
  try {
    const metadata = await extractor.extractMetadata(slidePath, baseName);
    console.log('\n=== EXTRACTION RESULTS ===');
    console.log('Metadata:', JSON.stringify(metadata, null, 2));
    
    if (metadata.iccProfile) {
      console.log(`\nICC Profile saved at: ${metadata.iccProfile}`);
    } else {
      console.log('\nNo ICC profile found or extracted');
    }
    
    if (metadata.label) {
      console.log(`Label image saved at: ${metadata.label}`);
    }
    
    if (metadata.macro) {
      console.log(`Macro image saved at: ${metadata.macro}`);
    }
    
  } catch (error) {
    console.error('Test failed:', error);
  }
}

testMetadataExtraction();
