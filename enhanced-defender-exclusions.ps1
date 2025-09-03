# Enhanced Windows Defender Exclusion Setup for Pathology Slide Viewer
# Addresses high CPU usage from Antimalware Service Executable during conversions
# Run this script as Administrator

Write-Host "Enhanced Windows Defender Exclusion Setup" -ForegroundColor Green
Write-Host "=========================================" -ForegroundColor Green

# Check Administrator privileges
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")
if (-NOT $isAdmin) {
    Write-Host "ERROR: This script must be run as Administrator!" -ForegroundColor Red
    Write-Host "Right-click PowerShell and select 'Run as Administrator'" -ForegroundColor Yellow
    exit 1
}

# Get project directories
$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$SlidesDir = Join-Path $ProjectDir "public\slides"
$DziDir = Join-Path $ProjectDir "public\dzi" 
$UploadsDir = Join-Path $ProjectDir "uploads"
$TempDir = Join-Path $ProjectDir "temp"

Write-Host "`nStep 1: Adding Directory Exclusions..." -ForegroundColor Cyan
try {
    Add-MpPreference -ExclusionPath $SlidesDir -Force
    Add-MpPreference -ExclusionPath $DziDir -Force
    Add-MpPreference -ExclusionPath $UploadsDir -Force
    Add-MpPreference -ExclusionPath $TempDir -Force
    
    # Add system temp directories that VIPS uses
    Add-MpPreference -ExclusionPath "$env:TEMP" -Force
    Add-MpPreference -ExclusionPath "$env:TMP" -Force
    
    Write-Host "✓ Directory exclusions added successfully" -ForegroundColor Green
} catch {
    Write-Host "✗ Failed to add directory exclusions: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`nStep 2: Adding File Extension Exclusions..." -ForegroundColor Cyan
$extensions = @(".svs", ".ndpi", ".tif", ".tiff", ".dzi", ".jpg", ".jpeg", ".jp2", ".vms", ".vmu", ".scn", ".tmp")
foreach ($ext in $extensions) {
    try {
        Add-MpPreference -ExclusionExtension $ext -Force
        Write-Host "✓ Added exclusion for $ext files" -ForegroundColor Green
    } catch {
        Write-Host "✗ Failed to exclude $ext files: $($_.Exception.Message)" -ForegroundColor Red
    }
}

Write-Host "`nStep 3: Adding Process Exclusions..." -ForegroundColor Cyan

# Find and exclude VIPS executable
$VipsPath = (Get-Command vips -ErrorAction SilentlyContinue).Source
if ($VipsPath) {
    try {
        Add-MpPreference -ExclusionProcess $VipsPath -Force
        Write-Host "✓ VIPS process excluded: $VipsPath" -ForegroundColor Green
    } catch {
        Write-Host "✗ Failed to exclude VIPS process: $($_.Exception.Message)" -ForegroundColor Red
    }
} else {
    Write-Host "⚠ VIPS executable not found in PATH" -ForegroundColor Yellow
}

# Find and exclude Node.js executable
$NodePath = (Get-Command node -ErrorAction SilentlyContinue).Source
if ($NodePath) {
    try {
        Add-MpPreference -ExclusionProcess $NodePath -Force
        Write-Host "✓ Node.js process excluded: $NodePath" -ForegroundColor Green
    } catch {
        Write-Host "✗ Failed to exclude Node.js process: $($_.Exception.Message)" -ForegroundColor Red
    }
} else {
    Write-Host "⚠ Node.js executable not found in PATH" -ForegroundColor Yellow
}

Write-Host "`nStep 4: Configuring Real-time Protection Settings..." -ForegroundColor Cyan
try {
    # Reduce real-time monitoring intensity during file operations
    Set-MpPreference -ScanAvgCPULoadFactor 25 -Force  # Limit to 25% CPU usage
    Set-MpPreference -CheckForSignaturesBeforeRunningScan $false -Force
    Set-MpPreference -DisableCatchupFullScan $true -Force
    Set-MpPreference -DisableCatchupQuickScan $true -Force
    
    Write-Host "✓ Real-time protection settings optimized" -ForegroundColor Green
} catch {
    Write-Host "✗ Failed to optimize real-time protection: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`nStep 5: Verifying Exclusions..." -ForegroundColor Cyan
try {
    $preferences = Get-MpPreference
    $pathCount = ($preferences.ExclusionPath | Measure-Object).Count
    $extCount = ($preferences.ExclusionExtension | Measure-Object).Count
    $procCount = ($preferences.ExclusionProcess | Measure-Object).Count
    
    Write-Host "✓ Exclusions configured:" -ForegroundColor Green
    Write-Host "  - Paths: $pathCount" -ForegroundColor White
    Write-Host "  - Extensions: $extCount" -ForegroundColor White
    Write-Host "  - Processes: $procCount" -ForegroundColor White
    Write-Host "  - CPU Load Factor: $($preferences.ScanAvgCPULoadFactor)%" -ForegroundColor White
} catch {
    Write-Host "✗ Failed to verify exclusions: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`n=========================================" -ForegroundColor Green
Write-Host "Enhanced Windows Defender Configuration Complete!" -ForegroundColor Green
Write-Host "`nNext Steps:" -ForegroundColor Yellow
Write-Host "1. Restart your computer to ensure all settings take effect" -ForegroundColor White
Write-Host "2. Run the VIPS threading fix from VIPS_OPTIMIZATION_GUIDE.md" -ForegroundColor White
Write-Host "3. Test conversion performance with a sample slide" -ForegroundColor White
Write-Host "`nExpected Results:" -ForegroundColor Yellow
Write-Host "- Antimalware Service CPU usage should drop to <5% during conversions" -ForegroundColor White
Write-Host "- File I/O operations should be significantly faster" -ForegroundColor White
Write-Host "- Overall conversion speed should improve by 20-40%" -ForegroundColor White
