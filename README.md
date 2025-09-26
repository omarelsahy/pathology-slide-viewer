# Pathology Slide Viewer

A professional web-based pathology slide viewer with automated conversion, multi-service architecture, and high-performance slide processing. Built for medical professionals and researchers who need reliable, high-resolution slide examination capabilities.

## ✨ Features

- 🔬 **High-Resolution Viewing**: Supports gigapixel pathology slides with smooth zoom and pan
- 🌐 **Web-Based Interface**: Access slides remotely through any modern web browser
- 📁 **Multiple Formats**: SVS, NDPI, TIF, TIFF, JP2, VMS, VMU, SCN, and DZI formats
- ⚡ **Automated Conversion**: Real-time slide conversion using optimized VIPS pipeline
- 🎯 **Professional Tools**: Advanced navigation, zoom controls, and full-screen viewing
- 📊 **Real-Time Progress**: Live conversion monitoring with detailed progress tracking
- 🔧 **Management Console**: Web-based configuration and slide management interface
- 🚀 **High Performance**: Multi-threaded processing with ICC color correction

## 🏗️ Architecture

The system uses a modern multi-service architecture:

- **Backend Server** (port 3102): Main API, slide metadata, and file operations
- **GUI Management** (port 3003): Web-based configuration and slide management
- **Conversion Server** (port 3001): Dedicated slide processing with queue management
- **Auto-processor**: File watcher for automatic slide conversion

## 🚀 Quick Start

### Prerequisites

- **Node.js** v18+ 
- **VIPS** image processing library

### Installation

1. **Clone and setup**
   ```bash
   git clone <repository-url>
   cd pathology-slide-viewer
   npm install
   ```

2. **Install VIPS** 
   ```bash
   # Windows
   winget install libvips.libvips
   # OR run: .\install-vips.ps1
   
   # Linux
   sudo apt-get install libvips-dev
   
   # macOS
   brew install vips
   ```

3. **Configure environment**
   ```bash
   cp .env.example .env
   # Edit .env with your settings
   ```

4. **Start all services**
   ```bash
   npm run all
   ```

5. **Access the application**
   - **Management Console**: http://localhost:3003
   - **Backend API**: http://localhost:3102
   - **Conversion Status**: http://localhost:3001/status

## 📖 Usage

### Adding Slides

1. **Place slides** in your configured slides directory (default: `public/slides/`)
2. **Access Management Console** at http://localhost:3003
3. **Monitor auto-conversion** or manually trigger conversions
4. **View converted slides** through the interface

### Configuration

The system uses a unified configuration system:

- **app-config.json**: Main configuration file
- **.env**: Environment-specific overrides
- **Automatic detection**: Optimized defaults based on your system

### Supported Formats

- **SVS** (Aperio ScanScope)
- **NDPI** (Hamamatsu NanoZoomer) 
- **TIF/TIFF** (Generic TIFF)
- **JP2** (JPEG 2000)
- **VMS/VMU** (Hamamatsu)
- **SCN** (Leica)
- **DZI** (Deep Zoom Images)

## 🔧 Configuration

### Environment Variables

```bash
# Core settings
NODE_MODE=server
PORT=3102
GUI_PORT=3003
CONVERSION_PORT=3001

# Storage paths
SLIDES_DIR=./public/slides
DZI_DIR=./public/dzi
TEMP_DIR=./temp

# Performance
MAX_CONCURRENT=8
VIPS_CONCURRENCY=8
```

### Scripts

```bash
npm start           # Start backend server only
npm run gui         # Start GUI management console
npm run conversion  # Start conversion server
npm run all         # Start all services
npm run dev:all     # Start all services in development mode
npm run config      # Show current configuration
npm run validate    # Validate configuration
```

## 🏗️ Project Structure

```
pathology-slide-viewer/
├── app-config.json        # Unified configuration
├── config.js              # Configuration loader
├── server.js              # Backend API server
├── gui-server.js          # Management console
├── conversion-server.js   # Conversion processing
├── autoProcessor.js       # File watcher
├── gui-web/              # Management interface
│   ├── index.html
│   ├── app.js
│   └── config.html
├── public/               # Static assets and slides
├── scripts/              # Service management scripts
└── install-vips.ps1      # VIPS installation
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
