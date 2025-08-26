# Windows Defender Exclusion Setup for Pathology Slide Viewer
# Run this script as Administrator

Write-Host "Setting up Windows Defender exclusions..." -ForegroundColor Green

# Check Administrator privileges
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")
if (-NOT $isAdmin) {
    Write-Host "ERROR: Run as Administrator!" -ForegroundColor Red
    exit 1
}

# Get directories
$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$SlidesDir = Join-Path $ProjectDir "public\slides"
$DziDir = Join-Path $ProjectDir "public\dzi" 
$UploadsDir = Join-Path $ProjectDir "uploads"

Write-Host "Adding directory exclusions..." -ForegroundColor Cyan
Add-MpPreference -ExclusionPath $SlidesDir
Add-MpPreference -ExclusionPath $DziDir
Add-MpPreference -ExclusionPath $UploadsDir
Write-Host "Directory exclusions added" -ForegroundColor Green

Write-Host "Adding file type exclusions..." -ForegroundColor Cyan
Add-MpPreference -ExclusionExtension ".svs"
Add-MpPreference -ExclusionExtension ".ndpi"
Add-MpPreference -ExclusionExtension ".tif"
Add-MpPreference -ExclusionExtension ".tiff"
Add-MpPreference -ExclusionExtension ".dzi"
Add-MpPreference -ExclusionExtension ".jpg"
Add-MpPreference -ExclusionExtension ".jpeg"
Write-Host "File type exclusions added" -ForegroundColor Green

Write-Host "Adding process exclusions..." -ForegroundColor Cyan
$VipsPath = (Get-Command vips -ErrorAction SilentlyContinue).Source
if ($VipsPath) {
    Add-MpPreference -ExclusionProcess $VipsPath
    Write-Host "VIPS process excluded: $VipsPath" -ForegroundColor Green
}

$NodePath = (Get-Command node -ErrorAction SilentlyContinue).Source
if ($NodePath) {
    Add-MpPreference -ExclusionProcess $NodePath
    Write-Host "Node.js process excluded: $NodePath" -ForegroundColor Green
}

Write-Host "`nWindows Defender exclusions configured successfully!" -ForegroundColor Green
Write-Host "Antimalware CPU usage should be significantly reduced during conversions." -ForegroundColor Green
