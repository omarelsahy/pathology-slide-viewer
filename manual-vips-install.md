# Manual VIPS Installation for Windows Server 2016

## Download VIPS with Threading Support

1. **Download Link**: https://github.com/libvips/libvips/releases/download/v8.15.1/vips-dev-w64-all-8.15.1.zip

2. **Save to**: `C:\temp\vips.zip`

3. **Extract**:
   ```powershell
   Expand-Archive -Path "C:\temp\vips.zip" -DestinationPath "C:\vips" -Force
   ```

4. **Add to PATH**:
   ```powershell
   $vipsBinPath = "C:\vips\vips-dev-8.15\bin"
   $currentPath = [Environment]::GetEnvironmentVariable("PATH", "User")
   [Environment]::SetEnvironmentVariable("PATH", "$currentPath;$vipsBinPath", "User")
   ```

5. **Restart Terminal** and verify:
   ```powershell
   vips --version
   vips --vips-config | findstr -i thread
   ```

## Expected Output After Installation

```
enable-threads: yes
openmp: yes
```

This will enable all 56 cores for VIPS processing, providing massive performance improvements.

## Alternative: Use Chocolatey

If manual download fails:

```powershell
# Install Chocolatey first
Set-ExecutionPolicy Bypass -Scope Process -Force
iex ((New-Object System.Net.WebClient).DownloadString('https://chocolatey.org/install.ps1'))

# Install VIPS via Chocolatey
choco install vips
```
