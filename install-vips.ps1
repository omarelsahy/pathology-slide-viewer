# PowerShell script to install VIPS for SVS to DZI conversion

Write-Host "Installing VIPS for pathology slide conversion..." -ForegroundColor Green

# Method 1: Skip winget on Windows Server 2016 (not available)
Write-Host "Windows Server detected - skipping winget (not available)..." -ForegroundColor Yellow
$vipsInstalled = $false

# Method 2: Direct download if winget fails
if (-not $vipsInstalled) {
    Write-Host "Downloading VIPS directly from GitHub..." -ForegroundColor Yellow
    
    $vipsUrl = "https://github.com/libvips/libvips/releases/download/v8.15.1/vips-dev-w64-all-8.15.1.zip"
    $downloadPath = "$env:TEMP\vips.zip"
    $extractPath = "C:\vips"
    
    try {
        # Fix SSL/TLS for Windows Server 2016
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        
        # Download VIPS
        Invoke-WebRequest -Uri $vipsUrl -OutFile $downloadPath
        
        # Extract to C:\vips
        Expand-Archive -Path $downloadPath -DestinationPath $extractPath -Force
        
        # Add to PATH
        $vipsBinPath = "$extractPath\vips-dev-8.15\bin"
        $currentPath = [Environment]::GetEnvironmentVariable("PATH", "User")
        if ($currentPath -notlike "*$vipsBinPath*") {
            [Environment]::SetEnvironmentVariable("PATH", "$currentPath;$vipsBinPath", "User")
            Write-Host "Added VIPS to PATH. Please restart your terminal." -ForegroundColor Green
        }
        
        Write-Host "VIPS installed to: $extractPath" -ForegroundColor Green
        $vipsInstalled = $true
        
    } catch {
        Write-Host "Direct download failed: $($_.Exception.Message)" -ForegroundColor Red
    }
}

# Verify installation
Write-Host "Verifying VIPS installation..." -ForegroundColor Yellow
try {
    # Refresh environment variables
    $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("PATH","User")
    
    $vipsVersion = & "C:\vips\vips-dev-8.15\bin\vips.exe" --version 2>$null
    if ($vipsVersion) {
        Write-Host "VIPS installed successfully: $vipsVersion" -ForegroundColor Green
    } else {
        throw "VIPS not found in PATH"
    }
} catch {
    Write-Host "VIPS verification failed. Manual installation may be required." -ForegroundColor Red
    Write-Host "Please download VIPS from: https://github.com/libvips/libvips/releases" -ForegroundColor Cyan
}

Write-Host "`nInstallation complete! Please restart your terminal and run 'npm start' to use the slide viewer." -ForegroundColor Green
Write-Host "If VIPS is not working, you can still use the viewer - it will fall back to Sharp for basic conversion." -ForegroundColor Cyan
