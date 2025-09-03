# Install VIPS with OpenMP threading support via MSYS2
# Alternative method for Windows Server 2016

Write-Host "🚀 Installing VIPS with Threading Support via MSYS2" -ForegroundColor Green
Write-Host "============================================================"

# Download and install MSYS2
$msys2Url = "https://github.com/msys2/msys2-installer/releases/download/2023-05-26/msys2-x86_64-20230526.exe"
$installerPath = "$env:TEMP\msys2-installer.exe"

try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Write-Host "📥 Downloading MSYS2..." -ForegroundColor Cyan
    Invoke-WebRequest -Uri $msys2Url -OutFile $installerPath -UseBasicParsing
    
    Write-Host "🔧 Installing MSYS2..." -ForegroundColor Cyan
    Start-Process -FilePath $installerPath -ArgumentList "install", "--root", "C:\msys64", "--confirm-command" -Wait
    
    # Add MSYS2 to PATH
    $msys2BinPath = "C:\msys64\usr\bin"
    $currentPath = [Environment]::GetEnvironmentVariable("PATH", "Machine")
    if ($currentPath -notlike "*$msys2BinPath*") {
        [Environment]::SetEnvironmentVariable("PATH", "$currentPath;$msys2BinPath", "Machine")
        $env:PATH += ";$msys2BinPath"
    }
    
    Write-Host "✅ MSYS2 installed successfully" -ForegroundColor Green
}
catch {
    Write-Host "❌ Failed to install MSYS2: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "💡 Please install MSYS2 manually from https://www.msys2.org/" -ForegroundColor Yellow
    exit 1
}

# Install VIPS with threading
Write-Host "📦 Installing VIPS with OpenMP support..." -ForegroundColor Cyan

try {
    # Update MSYS2 packages
    & C:\msys64\usr\bin\bash.exe -lc "pacman -Syu --noconfirm"
    
    # Install VIPS with threading support
    & C:\msys64\usr\bin\bash.exe -lc "pacman -S mingw-w64-x86_64-vips --noconfirm"
    
    # Add MSYS2 mingw64 bin to PATH for VIPS
    $mingwBinPath = "C:\msys64\mingw64\bin"
    $currentPath = [Environment]::GetEnvironmentVariable("PATH", "Machine")
    if ($currentPath -notlike "*$mingwBinPath*") {
        [Environment]::SetEnvironmentVariable("PATH", "$mingwBinPath;$currentPath", "Machine")
        $env:PATH = "$mingwBinPath;$env:PATH"
    }
    
    Write-Host "🧪 Testing VIPS installation..." -ForegroundColor Cyan
    & C:\msys64\mingw64\bin\vips.exe --version
    & C:\msys64\mingw64\bin\vips.exe --vips-config
    
    Write-Host "✅ VIPS with threading support installed!" -ForegroundColor Green
    Write-Host "🔄 Please restart PowerShell and test with multithreading-diagnostic.js" -ForegroundColor Yellow
}
catch {
    Write-Host "❌ Failed to install VIPS via MSYS2: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "💡 Manual steps:" -ForegroundColor Yellow
    Write-Host "   1. Open MSYS2 terminal" -ForegroundColor White
    Write-Host "   2. Run: pacman -Syu" -ForegroundColor White
    Write-Host "   3. Run: pacman -S mingw-w64-x86_64-vips" -ForegroundColor White
}

Write-Host "============================================================"
Write-Host "🏁 Installation Complete"
