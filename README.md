# Pathology Slide Viewer

A web-based pathology slide viewer that supports remote access and high-resolution slide examination. Built with Node.js, Express, and OpenSeadragon for smooth navigation of large pathology slides.

## Features

- 🔬 **High-Resolution Viewing**: Supports gigapixel pathology slides with smooth zoom and pan
- 🌐 **Web-Based**: Access slides remotely through any modern web browser
- 📁 **Multiple Formats**: Supports SVS, NDPI, TIF, TIFF, DZI, and other pathology slide formats
- ⚡ **Automatic Conversion**: Converts slides to web-optimized DZI format using VIPS
- 🎯 **Professional Tools**: Navigator, zoom controls, rotation, and full-screen viewing
- 📊 **Real-Time Updates**: WebSocket notifications for conversion progress

## Screenshots

![Pathology Slide Viewer Interface](docs/screenshot.png)

## Quick Start

### Prerequisites

- Node.js (v18+ recommended)
- VIPS image processing library

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/pathology-slide-viewer.git
   cd pathology-slide-viewer
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Install VIPS** (for slide conversion)
   ```bash
   # Windows (using winget)
   winget install libvips.libvips
   
   # Or run the provided script
   .\install-vips.ps1
   ```

4. **Start the server**
   ```bash
   npm start
   ```

5. **Open your browser**
   Navigate to `http://localhost:3000`

## Usage

### Adding Slides

1. Place your pathology slide files (`.svs`, `.ndpi`, `.tif`, etc.) in the `public/slides/` directory
2. Refresh the web interface
3. Select a slide from the dropdown menu
4. If the slide needs conversion, click the "Convert" button
5. Wait for conversion to complete (may take several minutes for large files)
6. View your slide with full zoom and pan capabilities

### Supported Formats

- **SVS** (Aperio ScanScope)
- **NDPI** (Hamamatsu NanoZoomer)
- **TIF/TIFF** (Generic TIFF)
- **DZI** (Deep Zoom Images)
- **JP2** (JPEG 2000)
- **VMS/VMU** (Hamamatsu)
- **SCN** (Leica)

## Architecture

```
pathology-slide-viewer/
├── server.js              # Express server with conversion API
├── public/
│   ├── index.html         # Main viewer interface
│   ├── js/main.js         # Frontend JavaScript
│   ├── slides/            # Original slide files
│   └── dzi/               # Converted DZI files
├── uploads/               # File upload directory
└── install-vips.ps1       # VIPS installation script
```

## API Endpoints

- `GET /` - Main viewer interface
- `GET /api/slides` - List available slides
- `POST /api/convert/:filename` - Convert slide to DZI format
- `GET /slides/:filename` - Serve original slide files
- `GET /dzi/*` - Serve converted DZI tiles

## Configuration

The server runs on port 3000 by default. You can change this by setting the `PORT` environment variable:

```bash
PORT=8080 npm start
```

## Performance

### Conversion Metrics
- **2GB SVS file** → **2.87GB DZI** (286,285 tiles)
- **Resolution**: Up to 173,720 × 80,762 pixels (14 gigapixels)
- **Tile Size**: 256×256 pixels with 1px overlap
- **Format**: JPEG at 90% quality

### System Requirements
- **RAM**: 4GB+ recommended for large slide conversion
- **Storage**: 1.5-2x original file size for converted tiles
- **CPU**: Multi-core recommended for faster conversion

## Development

### Running in Development Mode
```bash
npm run dev  # Uses nodemon for auto-restart
```

### Project Structure
- **Backend**: Node.js/Express server with VIPS integration
- **Frontend**: Vanilla JavaScript with OpenSeadragon viewer
- **Conversion**: VIPS library for high-performance image processing
- **Communication**: WebSocket for real-time conversion updates

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- [OpenSeadragon](https://openseadragon.github.io/) - High-performance web-based viewer
- [VIPS](https://libvips.github.io/libvips/) - Fast image processing library
- [Express.js](https://expressjs.com/) - Web application framework

## Support

If you encounter issues:

1. Check the [troubleshooting guide](SETUP.md)
2. Review server logs for conversion errors
3. Ensure VIPS is properly installed
4. Open an issue on GitHub

---

**Built for pathologists, researchers, and medical professionals who need reliable, high-performance slide viewing capabilities.**
