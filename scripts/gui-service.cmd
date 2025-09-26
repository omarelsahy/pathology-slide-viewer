@echo off
rem Pathology GUI Service wrapper

set "NODE_ENV=production"
set "PORT=3003"

rem Resolve node.exe absolute path
set "NODE_EXE=C:\Program Files\nodejs\node.exe"
if not exist "%NODE_EXE%" (
  set "NODE_EXE="
  for %%I in (node.exe) do set "NODE_EXE=%%~$PATH:I"
  if not exist "%NODE_EXE%" set "NODE_EXE=node"
)

cd /d "C:\Slide Viewer\pathology-slide-viewer"
echo %date% %time% starting gui-service.cmd >> "C:\Slide Viewer\pathology-slide-viewer\logs\gui.wrapper.log"
echo Using NODE_EXE=%NODE_EXE% >> "C:\Slide Viewer\pathology-slide-viewer\logs\gui.wrapper.log"
"%NODE_EXE%" gui-server.js >> "C:\Slide Viewer\pathology-slide-viewer\logs\gui.wrapper.log" 2>&1
