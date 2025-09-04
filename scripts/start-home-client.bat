@echo off
echo Starting Pathology Slide Viewer in HOME CLIENT mode...
echo.

REM Set environment variables for home client
set NODE_MODE=client
set NODE_ENV=development
REM Force frontend port to 3102
set PORT=3102

REM Check if .env file exists, create from example if not
if not exist ".env" (
    echo Creating .env file from .env.example...
    copy ".env.example" ".env"
    echo.
    echo NOTE: Update .env later with lab server URL and API key if needed. Continuing...
)

echo Configuration:
echo - Mode: HOME CLIENT
echo - Port: %PORT%
echo - Connects to lab server for slides and processing
echo.

node frontend-server.js
