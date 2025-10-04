# Windows Defender Exclusions Setup for Pathology Slide Viewer
# Run as Administrator

param(
    [switch]$Remove,
    [switch]$List
)

# Configuration
$SlideDirectories = @(
    "C:\Users\OmarElsahy\Documents\Pathology Slides\SVS",
    "C:\Users\OmarElsahy\Documents\Pathology Slides\DZI", 
    "C:\Users\OmarElsahy\Documents\Pathology Slides\Temp"
)

$ProcessExclusions = @(
    "node.exe",
    "vips.exe",
    "electron.exe"
)

$FileExtensionExclusions = @(
    ".svs",
    ".ndpi", 
    ".tif",
    ".tiff",
    ".dzi",
    ".jpg",
    ".jpeg",
    ".v"
)

function Test-AdminRights {
    $currentUser = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($currentUser)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Add-DefenderExclusions {
    Write-Host ""
    Write-Host "Adding Windows Defender Exclusions for Pathology Slide Viewer" -ForegroundColor Cyan
    Write-Host "================================================================" -ForegroundColor Cyan
    
    Write-Host ""
    Write-Host "Adding Directory Exclusions:" -ForegroundColor Yellow
    foreach ($dir in $SlideDirectories) {
        if (Test-Path $dir) {
            try {
                Add-MpPreference -ExclusionPath $dir -ErrorAction Stop
                Write-Host "   SUCCESS: Added $dir" -ForegroundColor Green
            }
            catch {
                Write-Host "   WARNING: Already exists or error: $dir" -ForegroundColor Yellow
            }
        }
        else {
            Write-Host "   INFO: Directory not found (will create when needed): $dir" -ForegroundColor Yellow
        }
    }
    
    Write-Host ""
    Write-Host "Adding Process Exclusions:" -ForegroundColor Yellow
    foreach ($process in $ProcessExclusions) {
        try {
            Add-MpPreference -ExclusionProcess $process -ErrorAction Stop
            Write-Host "   SUCCESS: Added $process" -ForegroundColor Green
        }
        catch {
            Write-Host "   WARNING: Already exists or error: $process" -ForegroundColor Yellow
        }
    }
    
    Write-Host ""
    Write-Host "Adding File Extension Exclusions:" -ForegroundColor Yellow
    foreach ($ext in $FileExtensionExclusions) {
        try {
            Add-MpPreference -ExclusionExtension $ext -ErrorAction Stop
            Write-Host "   SUCCESS: Added $ext" -ForegroundColor Green
        }
        catch {
            Write-Host "   WARNING: Already exists or error: $ext" -ForegroundColor Yellow
        }
    }
    
    Write-Host ""
    Write-Host "Windows Defender exclusions have been configured!" -ForegroundColor Green
    Write-Host "This should significantly improve conversion performance." -ForegroundColor Green
}

function Remove-DefenderExclusions {
    Write-Host ""
    Write-Host "Removing Windows Defender Exclusions" -ForegroundColor Red
    Write-Host "====================================" -ForegroundColor Red
    
    Write-Host ""
    Write-Host "Removing Directory Exclusions:" -ForegroundColor Yellow
    foreach ($dir in $SlideDirectories) {
        try {
            Remove-MpPreference -ExclusionPath $dir -ErrorAction Stop
            Write-Host "   SUCCESS: Removed $dir" -ForegroundColor Green
        }
        catch {
            Write-Host "   WARNING: Not found or error: $dir" -ForegroundColor Yellow
        }
    }
    
    Write-Host ""
    Write-Host "Removing Process Exclusions:" -ForegroundColor Yellow
    foreach ($process in $ProcessExclusions) {
        try {
            Remove-MpPreference -ExclusionProcess $process -ErrorAction Stop
            Write-Host "   SUCCESS: Removed $process" -ForegroundColor Green
        }
        catch {
            Write-Host "   WARNING: Not found or error: $process" -ForegroundColor Yellow
        }
    }
    
    Write-Host ""
    Write-Host "Removing File Extension Exclusions:" -ForegroundColor Yellow
    foreach ($ext in $FileExtensionExclusions) {
        try {
            Remove-MpPreference -ExclusionExtension $ext -ErrorAction Stop
            Write-Host "   SUCCESS: Removed $ext" -ForegroundColor Green
        }
        catch {
            Write-Host "   WARNING: Not found or error: $ext" -ForegroundColor Yellow
        }
    }
    
    Write-Host ""
    Write-Host "Windows Defender exclusions have been removed!" -ForegroundColor Green
}

function List-DefenderExclusions {
    Write-Host ""
    Write-Host "Current Windows Defender Exclusions" -ForegroundColor Cyan
    Write-Host "===================================" -ForegroundColor Cyan
    
    $preferences = Get-MpPreference
    
    Write-Host ""
    Write-Host "Path Exclusions:" -ForegroundColor Yellow
    if ($preferences.ExclusionPath) {
        foreach ($path in $preferences.ExclusionPath) {
            $isOurs = $SlideDirectories -contains $path
            $marker = if ($isOurs) { "[OURS]" } else { "      " }
            Write-Host "   $marker $path" -ForegroundColor $(if ($isOurs) { "Green" } else { "White" })
        }
    } else {
        Write-Host "   (None configured)" -ForegroundColor Yellow
    }
    
    Write-Host ""
    Write-Host "Process Exclusions:" -ForegroundColor Yellow
    if ($preferences.ExclusionProcess) {
        foreach ($process in $preferences.ExclusionProcess) {
            $isOurs = $ProcessExclusions -contains $process
            $marker = if ($isOurs) { "[OURS]" } else { "      " }
            Write-Host "   $marker $process" -ForegroundColor $(if ($isOurs) { "Green" } else { "White" })
        }
    } else {
        Write-Host "   (None configured)" -ForegroundColor Yellow
    }
    
    Write-Host ""
    Write-Host "Extension Exclusions:" -ForegroundColor Yellow
    if ($preferences.ExclusionExtension) {
        foreach ($ext in $preferences.ExclusionExtension) {
            $isOurs = $FileExtensionExclusions -contains $ext
            $marker = if ($isOurs) { "[OURS]" } else { "      " }
            Write-Host "   $marker $ext" -ForegroundColor $(if ($isOurs) { "Green" } else { "White" })
        }
    } else {
        Write-Host "   (None configured)" -ForegroundColor Yellow
    }
    
    Write-Host ""
    Write-Host "[OURS] = Configured by this script" -ForegroundColor Green
}

# Main execution
Write-Host "Windows Defender Exclusions Manager for Pathology Slide Viewer" -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan

# Check admin rights
if (-not (Test-AdminRights)) {
    Write-Host ""
    Write-Host "ERROR: This script must be run as Administrator!" -ForegroundColor Red
    Write-Host "Right-click PowerShell and select 'Run as Administrator'" -ForegroundColor Yellow
    Write-Host "Then run this script again." -ForegroundColor Yellow
    exit 1
}

# Execute based on parameters
if ($List) {
    List-DefenderExclusions
}
elseif ($Remove) {
    Remove-DefenderExclusions
}
else {
    Add-DefenderExclusions
}

Write-Host ""
Write-Host "Performance Tip:" -ForegroundColor Cyan
Write-Host "Monitor CPU usage during conversions. If Antimalware Service Executable" -ForegroundColor Yellow
Write-Host "is still using high CPU, you may need to temporarily disable real-time" -ForegroundColor Yellow
Write-Host "protection during large batch conversions." -ForegroundColor Yellow

Write-Host ""
Write-Host "Done!" -ForegroundColor Green
