@echo off
REM Pathology Slide Viewer - Windows Container Deployment Script
REM Provides easy deployment on Windows systems

setlocal EnableDelayedExpansion

REM Configuration
set PROJECT_NAME=pathology-slide-viewer
set COMPOSE_FILE=docker-compose.yml
set ENV_FILE=.env

REM Colors (if supported)
set GREEN=[92m
set RED=[91m
set YELLOW=[93m
set BLUE=[94m
set NC=[0m

echo %BLUE%[%date% %time%]%NC% Starting Pathology Slide Viewer deployment...

REM Check if Docker is installed
docker --version >nul 2>&1
if errorlevel 1 (
    echo %RED%Error: Docker is not installed or not in PATH%NC%
    echo Please install Docker Desktop for Windows
    pause
    exit /b 1
)

REM Check if Docker Compose is available
docker compose version >nul 2>&1
if errorlevel 1 (
    echo %RED%Error: Docker Compose is not available%NC%
    echo Please update Docker Desktop to a newer version
    pause
    exit /b 1
)

echo %GREEN%✅ Docker prerequisites check passed%NC%

REM Create data directories
echo %BLUE%Creating data directories...%NC%
if not exist "data" mkdir data
if not exist "data\slides" mkdir data\slides
if not exist "data\dzi" mkdir data\dzi
if not exist "data\temp" mkdir data\temp
echo %GREEN%✅ Data directories created%NC%

REM Create environment file if it doesn't exist
if not exist "%ENV_FILE%" (
    echo %BLUE%Creating environment file...%NC%
    (
        echo # Pathology Slide Viewer - Container Configuration
        echo NODE_MODE=server
        echo NODE_ENV=production
        echo PORT=3102
        echo GUI_PORT=3003
        echo CONVERSION_PORT=3001
        echo.
        echo # Storage paths
        echo SLIDES_DIR=/app/data/slides
        echo DZI_DIR=/app/data/dzi
        echo TEMP_DIR=/app/data/temp
        echo.
        echo # Performance optimizations
        echo MAX_CONCURRENT=8
        echo VIPS_CONCURRENCY=8
        echo VIPS_CACHE_MAX_MEMORY=1073741824
    ) > "%ENV_FILE%"
    echo %GREEN%✅ Environment file created%NC%
) else (
    echo %GREEN%✅ Environment file already exists%NC%
)

REM Handle command line arguments
set COMMAND=%1
if "%COMMAND%"=="" set COMMAND=deploy

if "%COMMAND%"=="deploy" goto :deploy
if "%COMMAND%"=="build" goto :build
if "%COMMAND%"=="start" goto :start
if "%COMMAND%"=="stop" goto :stop
if "%COMMAND%"=="restart" goto :restart
if "%COMMAND%"=="logs" goto :logs
if "%COMMAND%"=="status" goto :status
if "%COMMAND%"=="clean" goto :clean
if "%COMMAND%"=="help" goto :help

echo %RED%Unknown command: %COMMAND%%NC%
goto :help

:deploy
echo %BLUE%Building and deploying containers...%NC%

REM Pull base images
echo %BLUE%Pulling base images...%NC%
docker pull ubuntu:22.04
docker pull node:18-alpine

REM Build containers
echo %BLUE%Building application containers...%NC%
docker compose build --no-cache
if errorlevel 1 (
    echo %RED%Build failed%NC%
    pause
    exit /b 1
)

REM Start services
echo %BLUE%Starting services...%NC%
docker compose up -d
if errorlevel 1 (
    echo %RED%Failed to start services%NC%
    pause
    exit /b 1
)

REM Wait for services
echo %BLUE%Waiting for services to initialize...%NC%
timeout /t 10 /nobreak >nul

REM Check service status
docker compose ps
echo.
echo %GREEN%✅ Deployment completed successfully!%NC%
echo.
echo %BLUE%Access URLs:%NC%
echo   🌐 Web Interface: http://localhost:3102
echo   🔧 GUI Interface: http://localhost:3003
echo   📊 API Health: http://localhost:3102/api/health
echo.
echo %BLUE%Next steps:%NC%
echo   1. Place slide files in: %cd%\data\slides\
echo   2. Access web interface at: http://localhost:3102
echo   3. Monitor logs with: docker compose logs -f
echo   4. Stop services with: docker compose down
goto :end

:build
echo %BLUE%Building containers...%NC%
docker compose build --no-cache
echo %GREEN%✅ Build completed%NC%
goto :end

:start
echo %BLUE%Starting services...%NC%
docker compose up -d
echo %GREEN%✅ Services started%NC%
goto :end

:stop
echo %BLUE%Stopping services...%NC%
docker compose down
echo %GREEN%✅ Services stopped%NC%
goto :end

:restart
echo %BLUE%Restarting services...%NC%
docker compose restart
echo %GREEN%✅ Services restarted%NC%
goto :end

:logs
echo %BLUE%Showing service logs...%NC%
docker compose logs -f
goto :end

:status
echo %BLUE%Service status:%NC%
docker compose ps
goto :end

:clean
echo %BLUE%Cleaning up containers and images...%NC%
docker compose down --rmi all --volumes
echo %GREEN%✅ Cleanup completed%NC%
goto :end

:help
echo Pathology Slide Viewer - Container Deployment
echo.
echo Usage: %0 [COMMAND]
echo.
echo Commands:
echo   deploy    Deploy all services (default)
echo   build     Build containers only
echo   start     Start existing containers
echo   stop      Stop running containers
echo   restart   Restart all services
echo   logs      Show service logs
echo   status    Show service status
echo   clean     Remove containers and images
echo   help      Show this help message
goto :end

:end
if not "%COMMAND%"=="logs" pause
