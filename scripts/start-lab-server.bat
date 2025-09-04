@echo off
echo Starting Pathology Slide Viewer in LAB SERVER mode...
echo.

REM Set environment variables for lab server
set NODE_MODE=server
set NODE_ENV=production
REM Force backend port to 3101
set PORT=3101

REM Check if .env file exists, create from example if not
if not exist ".env" (
    echo Creating .env file from .env.example...
    copy ".env.example" ".env"
    echo.
    echo NOTE: Update .env later if needed. Continuing with defaults...
)

echo Configuration:
echo - Mode: LAB SERVER
echo - Port: %PORT%
echo - Auto-processor: ENABLED
echo - VIPS optimization: ENABLED
echo.

node server.js
