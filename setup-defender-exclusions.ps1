# Windows Defender Exclusion Setup for Pathology Slide Viewer
# Run this script as Administrator to optimize performance during slide conversions

Write-Host "Setting up Windows Defender exclusions for Pathology Slide Viewer..." -ForegroundColor Green

# Get the current project directory
$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$SlidesDir = Join-Path $ProjectDir "public\slides"
$DziDir = Join-Path $ProjectDir "public\dzi"
$UploadsDir = Join-Path $ProjectDir "uploads"

Write-Host "Project Directory: $ProjectDir" -ForegroundColor Yellow
Write-Host "Slides Directory: $SlidesDir" -ForegroundColor Yellow
Write-Host "DZI Directory: $DziDir" -ForegroundColor Yellow

# Check if running as Administrator
if (-NOT ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")) {
    Write-Host "ERROR: This script must be run as Administrator!" -ForegroundColor Red
    Write-Host "Right-click PowerShell and select 'Run as Administrator', then run this script again." -ForegroundColor Red
    pause
    exit 1
}

try {
    # Add directory exclusions
    Write-Host "`nAdding directory exclusions..." -ForegroundColor Cyan
    
    Add-MpPreference -ExclusionPath $SlidesDir
    Write-Host "✓ Excluded: $SlidesDir" -ForegroundColor Green
    
    Add-MpPreference -ExclusionPath $DziDir
    Write-Host "✓ Excluded: $DziDir" -ForegroundColor Green
    
    Add-MpPreference -ExclusionPath $UploadsDir
    Write-Host "✓ Excluded: $UploadsDir" -ForegroundColor Green

    # Add file type exclusions for common slide formats
    Write-Host "`nAdding file type exclusions..." -ForegroundColor Cyan
    
    $FileExtensions = @(".svs", ".ndpi", ".tif", ".tiff", ".jp2", ".vms", ".vmu", ".scn", ".dzi", ".jpg", ".jpeg")
    foreach ($ext in $FileExtensions) {
        Add-MpPreference -ExclusionExtension $ext
        Write-Host "✓ Excluded extension: $ext" -ForegroundColor Green
    }

    # Add process exclusions for VIPS and Node.js
    Write-Host "`nAdding process exclusions..." -ForegroundColor Cyan
    
    # Try to find VIPS executable
    $VipsPath = (Get-Command vips -ErrorAction SilentlyContinue).Source
    if ($VipsPath) {
        Add-MpPreference -ExclusionProcess $VipsPath
        Write-Host "✓ Excluded process: $VipsPath" -ForegroundColor Green
    } else {
        Write-Host "⚠ VIPS executable not found in PATH. You may need to add it manually." -ForegroundColor Yellow
    }
    
    # Node.js process exclusion
    $NodePath = (Get-Command node -ErrorAction SilentlyContinue).Source
    if ($NodePath) {
        Add-MpPreference -ExclusionProcess $NodePath
        Write-Host "✓ Excluded process: $NodePath" -ForegroundColor Green
    }

    Write-Host "`n✅ Windows Defender exclusions configured successfully!" -ForegroundColor Green
    Write-Host "This should significantly reduce CPU usage during slide conversions." -ForegroundColor Green
    
    # Display current exclusions
    Write-Host "`nCurrent exclusions:" -ForegroundColor Cyan
    $Preferences = Get-MpPreference
    Write-Host "Excluded Paths:" -ForegroundColor Yellow
    $Preferences.ExclusionPath | Where-Object { $_ -like "*$($ProjectDir.Split('\')[-1])*" } | ForEach-Object { Write-Host "  $_" }
    Write-Host "Excluded Extensions:" -ForegroundColor Yellow
    $Preferences.ExclusionExtension | Where-Object { $FileExtensions -contains $_ } | ForEach-Object { Write-Host "  $_" }

} catch {
    Write-Host "ERROR: Failed to configure Windows Defender exclusions." -ForegroundColor Red
    Write-Host "Error details: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "You may need to configure these manually in Windows Security settings." -ForegroundColor Yellow
}

Write-Host "`nPress any key to continue..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
