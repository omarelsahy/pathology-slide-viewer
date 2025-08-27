@echo off
echo Starting Pathology Slide Viewer in LAB SERVER mode...
echo.

REM Set environment variables for lab server
set NODE_MODE=server
set NODE_ENV=production
set PORT=3000

REM Check if .env file exists, create from example if not
if not exist ".env" (
    echo Creating .env file from .env.example...
    copy ".env.example" ".env"
    echo.
    echo IMPORTANT: Please edit .env file with your specific configuration!
    echo Press any key to continue after editing .env...
    pause
)

echo Configuration:
echo - Mode: LAB SERVER
echo - Port: %PORT%
echo - Auto-processor: ENABLED
echo - VIPS optimization: ENABLED
echo.

node server.js
