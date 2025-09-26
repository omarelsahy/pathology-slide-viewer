@echo off
echo %date% %time% starting backend-service.cmd >> "C:\Slide Viewer\pathology-slide-viewer\logs\backend.wrapper.log"
rem Pathology Backend Service wrapper

set "NODE_ENV=production"
set "NODE_MODE=server"
set "PORT=3101"

rem VIPS balanced performance (8 cores for conversion, preserve resources for tile serving)
set "VIPS_PROGRESS=1"
set "VIPS_INFO=1"
set "VIPS_WARNING=1"
set "VIPS_CONCURRENCY=8"
set "VIPS_CACHE_MAX_MEMORY=8GB"
set "VIPS_CACHE_MAX_FILES=0"
set "VIPS_DISC_THRESHOLD=2GB"
set "VIPS_MAX_MEM=4GB"

rem VIPS binary and color profile (override here if service PATH/env doesn't include them)
set "VIPS_EXE=C:\vips\vips-dev-8.17\bin\vips.exe"
set "SRGB_PROFILE=C:\Windows\System32\spool\drivers\color\sRGB Color Space Profile.icm"
set "CONVERT_MODE=libvips"

rem Fast SSD temp dir for VIPS operations
set "VIPS_TMPDIR=C:\Temp\VIPS"
if not exist "C:\Temp\VIPS" mkdir "C:\Temp\VIPS"

rem Balanced threading for multi-service environment
set "OMP_NUM_THREADS=8"
set "VIPS_VECTOR_SIZE=8"

rem Node.js thread pool optimization for tile serving priority
set "UV_THREADPOOL_SIZE=16"

rem Optional: pin input/output folders for the service (edit as needed)
rem set "SLIDES_DIR=C:\Path\To\Slides"
rem set "DZI_DIR=C:\Path\To\DZI"

rem Resolve node.exe absolute path (service accounts may not inherit PATH)
set "NODE_EXE=C:\Program Files\nodejs\node.exe"
if not exist "%NODE_EXE%" (
  set "NODE_EXE="
  for %%I in (node.exe) do set "NODE_EXE=%%~$PATH:I"
  if not exist "%NODE_EXE%" set "NODE_EXE=node"
)

rem Change to app root and start backend
cd /d "C:\Slide Viewer\pathology-slide-viewer"
echo Using NODE_EXE=%NODE_EXE% >> "C:\Slide Viewer\pathology-slide-viewer\logs\backend.wrapper.log"
"%NODE_EXE%" server.js >> "C:\Slide Viewer\pathology-slide-viewer\logs\backend.wrapper.log" 2>&1
