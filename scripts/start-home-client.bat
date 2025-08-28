@echo off
echo Starting Pathology Slide Viewer in HOME CLIENT mode...
echo.

REM Set environment variables for home client
set NODE_MODE=client
set NODE_ENV=development
REM PORT will be read from .env file or use config.js default

REM Check if .env file exists, create from example if not
if not exist ".env" (
    echo Creating .env file from .env.example...
    copy ".env.example" ".env"
    echo.
    echo IMPORTANT: Please edit .env file with your lab server URL and API key!
    echo Press any key to continue after editing .env...
    pause
)

echo Configuration:
echo - Mode: HOME CLIENT
echo - Port: %PORT%
echo - Connects to lab server for slides and processing
echo.

node server.js
