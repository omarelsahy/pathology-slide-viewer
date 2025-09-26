@echo off
echo 🔧 Fixing GUI Service Conflict on Port 3003
echo.

echo 🔍 Identifying process 4360...
tasklist /FI "PID eq 4360" /FO TABLE
echo.

echo 🔍 Checking for PathologyGui service...
sc query | findstr /i pathology
echo.

echo 💡 SOLUTION OPTIONS:
echo.
echo 1. Stop PathologyGui service (if found):
echo    sc stop "PathologyGui"
echo.
echo 2. Kill process 4360 (temporary):
echo    taskkill /PID 4360 /F
echo.
echo 3. Change development server to port 3004
echo.

set /p choice="Choose option (1, 2, or 3): "

if "%choice%"=="1" (
    echo Stopping PathologyGui service...
    sc stop "PathologyGui"
    if %ERRORLEVEL% EQU 0 (
        echo ✅ Service stopped successfully
        echo Setting startup to Manual...
        sc config "PathologyGui" start= demand
    ) else (
        echo ❌ Failed to stop service or service not found
    )
) else if "%choice%"=="2" (
    echo Killing process 4360...
    taskkill /PID 4360 /F
    if %ERRORLEVEL% EQU 0 (
        echo ✅ Process terminated
    ) else (
        echo ❌ Failed to kill process
    )
) else if "%choice%"=="3" (
    echo 📝 To change development server port:
    echo 1. Edit gui-server.js - change port from 3003 to 3004
    echo 2. Edit gui-config.json - update serverPort to 3004
    echo 3. Restart your development server
) else (
    echo Invalid choice
)

echo.
echo 🔍 Checking port 3003 status after fix...
netstat -ano | findstr :3003
if %ERRORLEVEL% NEQ 0 (
    echo ✅ Port 3003 is now free
) else (
    echo ⚠️ Port 3003 still in use
)

pause
