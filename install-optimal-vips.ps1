# Install Optimal VIPS 8.16.1 Official Binary
# Downloads and installs the best performing VIPS version for pathology processing

param(
    [switch]$CleanInstall = $false,
    [string]$InstallPath = "C:\vips-optimal"
)

Write-Host "=== Installing Optimal VIPS 8.16.1 ===" -ForegroundColor Green
Write-Host "Official MXE build for maximum performance" -ForegroundColor Green
Write-Host "=======================================" -ForegroundColor Green

# Function to check if running as administrator
function Test-Administrator {
    $currentUser = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($currentUser)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-Administrator)) {
    Write-Host "❌ This script requires administrator privileges for PATH modification" -ForegroundColor Red
    Write-Host "Please run PowerShell as Administrator" -ForegroundColor Yellow
    exit 1
}

# Step 1: Show current VIPS installations
Write-Host "`n1. Current VIPS installations:" -ForegroundColor Cyan
$existingVips = Get-Command vips -All -ErrorAction SilentlyContinue
if ($existingVips) {
    $existingVips | ForEach-Object {
        $version = & $_.Source --version 2>$null
        Write-Host "  $($_.Source) - $version" -ForegroundColor White
    }
} else {
    Write-Host "  No VIPS installations found in PATH" -ForegroundColor Yellow
}

# Step 2: Clean existing installations if requested
if ($CleanInstall) {
    Write-Host "`n2. Cleaning existing installations..." -ForegroundColor Cyan
    
    # Remove MSYS2 from PATH
    $currentPath = [Environment]::GetEnvironmentVariable("PATH", "Machine")
    $pathsToRemove = @(
        "C:\msys64\mingw64\bin",
        "C:\Users\$env:USERNAME\AppData\Local\Microsoft\WinGet\Packages\libvips.libvips_Microsoft.Winget.Source_8wekyb3d8bbwe\vips-dev-8.16\bin"
    )
    
    foreach ($pathToRemove in $pathsToRemove) {
        if ($currentPath -like "*$pathToRemove*") {
            $currentPath = $currentPath -replace [regex]::Escape("$pathToRemove;"), ""
            $currentPath = $currentPath -replace [regex]::Escape(";$pathToRemove"), ""
            Write-Host "  Removed: $pathToRemove" -ForegroundColor Yellow
        }
    }
    
    [Environment]::SetEnvironmentVariable("PATH", $currentPath, "Machine")
    Write-Host "✅ Cleaned existing VIPS from PATH" -ForegroundColor Green
} else {
    Write-Host "`n2. Keeping existing installations (recommended)" -ForegroundColor Cyan
    Write-Host "  Will prioritize new installation via PATH ordering" -ForegroundColor White
}

# Step 3: Download optimal VIPS 8.16.1
Write-Host "`n3. Downloading VIPS 8.16.1 official binary..." -ForegroundColor Cyan

$vipsUrl = "https://github.com/libvips/build-win64-mxe/releases/download/v8.16.1/vips-dev-w64-all-8.16.1.zip"
$downloadPath = "$env:TEMP\vips-optimal-8.16.1.zip"

try {
    Write-Host "  Downloading from: $vipsUrl" -ForegroundColor White
    Invoke-WebRequest -Uri $vipsUrl -OutFile $downloadPath -UseBasicParsing
    Write-Host "✅ Download completed" -ForegroundColor Green
} catch {
    Write-Host "❌ Download failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# Step 4: Extract and install
Write-Host "`n4. Installing VIPS..." -ForegroundColor Cyan

if (Test-Path $InstallPath) {
    Write-Host "  Removing existing installation at $InstallPath" -ForegroundColor Yellow
    Remove-Item $InstallPath -Recurse -Force -ErrorAction SilentlyContinue
}

try {
    Write-Host "  Extracting to: $InstallPath" -ForegroundColor White
    Expand-Archive -Path $downloadPath -DestinationPath $InstallPath -Force
    
    # Find the actual VIPS directory (usually vips-dev-8.16.1)
    $vipsSubDir = Get-ChildItem $InstallPath -Directory | Where-Object { $_.Name -like "vips-dev-*" } | Select-Object -First 1
    if ($vipsSubDir) {
        $vipsBinPath = Join-Path $vipsSubDir.FullName "bin"
    } else {
        throw "VIPS directory not found in extracted files"
    }
    
    Write-Host "✅ Extraction completed" -ForegroundColor Green
    Write-Host "  VIPS binaries at: $vipsBinPath" -ForegroundColor White
} catch {
    Write-Host "❌ Installation failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# Step 5: Update PATH to prioritize new installation
Write-Host "`n5. Updating system PATH..." -ForegroundColor Cyan

$currentPath = [Environment]::GetEnvironmentVariable("PATH", "Machine")

# Remove if already exists
if ($currentPath -like "*$vipsBinPath*") {
    $currentPath = $currentPath -replace [regex]::Escape("$vipsBinPath;"), ""
    $currentPath = $currentPath -replace [regex]::Escape(";$vipsBinPath"), ""
}

# Add to beginning of PATH for priority
$newPath = "$vipsBinPath;$currentPath"
[Environment]::SetEnvironmentVariable("PATH", $newPath, "Machine")

Write-Host "✅ PATH updated - new VIPS has priority" -ForegroundColor Green

# Step 6: Verify installation
Write-Host "`n6. Verifying installation..." -ForegroundColor Cyan

# Refresh PATH for current session
$env:PATH = "$vipsBinPath;$env:PATH"

try {
    $newVipsVersion = & "$vipsBinPath\vips.exe" --version 2>$null
    Write-Host "✅ VIPS Version: $newVipsVersion" -ForegroundColor Green
    
    $vipsConfig = & "$vipsBinPath\vips.exe" --vips-config 2>$null
    if ($vipsConfig -match "openslide.*true") {
        Write-Host "✅ OpenSlide support confirmed" -ForegroundColor Green
    }
    
    # Quick performance test
    Write-Host "  Running quick performance test..." -ForegroundColor White
    $testStart = Get-Date
    & "$vipsBinPath\vips.exe" black temp_verify.tiff 1000 1000 --bands 3 2>$null | Out-Null
    & "$vipsBinPath\vips.exe" dzsave temp_verify.tiff temp_verify_dz --tile-size 256 2>$null | Out-Null
    $testDuration = (Get-Date) - $testStart
    
    # Cleanup
    Remove-Item temp_verify.tiff -Force -ErrorAction SilentlyContinue
    Remove-Item temp_verify_dz_files -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item temp_verify_dz.dzi -Force -ErrorAction SilentlyContinue
    
    Write-Host "✅ Performance test: $([math]::Round($testDuration.TotalMilliseconds))ms" -ForegroundColor Green
    
} catch {
    Write-Host "❌ Verification failed: $($_.Exception.Message)" -ForegroundColor Red
}

# Cleanup
Remove-Item $downloadPath -Force -ErrorAction SilentlyContinue

Write-Host "`n=== Installation Complete ===" -ForegroundColor Green
Write-Host "Installation path: $vipsBinPath" -ForegroundColor White
Write-Host "PATH priority: Highest (first in PATH)" -ForegroundColor White
Write-Host "" -ForegroundColor White
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "1. Restart your terminal/IDE" -ForegroundColor White
Write-Host "2. Run: vips --version" -ForegroundColor White
Write-Host "3. Test: node test-vips-threading.js" -ForegroundColor White
Write-Host "4. Compare with baseline performance" -ForegroundColor White
Write-Host "" -ForegroundColor White
Write-Host "Expected: Superior performance with optimized MXE build!" -ForegroundColor Green
Write-Host "=========================================" -ForegroundColor Green
