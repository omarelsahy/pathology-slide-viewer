@echo off
echo Starting Pathology Slide Conversion Server...
echo.

cd /d "%~dp0\.."

REM Set environment variables for optimal performance
set CONVERSION_PORT=3001
set MAX_CONCURRENT=8
set NODE_ENV=production

REM Start the conversion server
echo Starting conversion server on port %CONVERSION_PORT%...
node conversion-server.js

pause
