# Install VIPS with OpenMP threading support via Conda
# For Windows Server 2016

Write-Host "🚀 Installing VIPS with Threading Support via Conda" -ForegroundColor Green
Write-Host "============================================================"

# Check if Conda is installed
$condaPath = Get-Command conda -ErrorAction SilentlyContinue
if (-not $condaPath) {
    Write-Host "❌ Conda not found. Installing Miniconda..." -ForegroundColor Yellow
    
    # Download Miniconda
    $minicondaUrl = "https://repo.anaconda.com/miniconda/Miniconda3-latest-Windows-x86_64.exe"
    $installerPath = "$env:TEMP\Miniconda3-latest-Windows-x86_64.exe"
    
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Write-Host "📥 Downloading Miniconda..." -ForegroundColor Cyan
        Invoke-WebRequest -Uri $minicondaUrl -OutFile $installerPath -UseBasicParsing
        
        Write-Host "🔧 Installing Miniconda (silent install)..." -ForegroundColor Cyan
        Start-Process -FilePath $installerPath -ArgumentList "/InstallationType=JustMe", "/RegisterPython=0", "/S", "/D=C:\Miniconda3" -Wait
        
        # Add to PATH
        $condaBinPath = "C:\Miniconda3\Scripts"
        $currentPath = [Environment]::GetEnvironmentVariable("PATH", "Machine")
        if ($currentPath -notlike "*$condaBinPath*") {
            [Environment]::SetEnvironmentVariable("PATH", "$currentPath;$condaBinPath", "Machine")
            $env:PATH += ";$condaBinPath"
        }
        
        Write-Host "✅ Miniconda installed successfully" -ForegroundColor Green
    }
    catch {
        Write-Host "❌ Failed to install Miniconda: $($_.Exception.Message)" -ForegroundColor Red
        exit 1
    }
}

# Install VIPS with threading support
Write-Host "📦 Installing VIPS with OpenMP support..." -ForegroundColor Cyan

try {
    # Create conda environment for VIPS
    & conda create -n vips-env python=3.9 -y
    & conda activate vips-env
    
    # Install VIPS from conda-forge (includes OpenMP)
    & conda install -c conda-forge libvips -y
    
    # Get VIPS installation path
    $vipsPath = & conda info --envs | Select-String "vips-env" | ForEach-Object { ($_ -split '\s+')[2] }
    $vipsBinPath = Join-Path $vipsPath "Library\bin"
    
    Write-Host "🔍 VIPS installed at: $vipsBinPath" -ForegroundColor Cyan
    
    # Add VIPS to PATH
    $currentPath = [Environment]::GetEnvironmentVariable("PATH", "Machine")
    if ($currentPath -notlike "*$vipsBinPath*") {
        [Environment]::SetEnvironmentVariable("PATH", "$vipsBinPath;$currentPath", "Machine")
        $env:PATH = "$vipsBinPath;$env:PATH"
    }
    
    # Test VIPS installation
    Write-Host "🧪 Testing VIPS installation..." -ForegroundColor Cyan
    & vips --version
    & vips --vips-config
    
    Write-Host "✅ VIPS with threading support installed successfully!" -ForegroundColor Green
    Write-Host "🔄 Please restart PowerShell to use the new VIPS installation" -ForegroundColor Yellow
}
catch {
    Write-Host "❌ Failed to install VIPS: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "💡 Try manual installation from MSYS2 instead" -ForegroundColor Yellow
}

Write-Host "============================================================"
Write-Host "🏁 Installation Complete"
