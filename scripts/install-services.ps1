<#
Pathology Slide Viewer - Windows Services Installer

This script installs Windows Services for:
- PathologyBackend (Node backend API on port 3101)
- PathologyGui (Web GUI on port 3003)

It uses NSSM (Non-Sucking Service Manager) to wrap Node processes as services.
Run as Administrator.
#>
param(
  [string]$NodeExePath = $null,
  # Primary URL; will try mirrors if this fails
  [string]$NssmUrl = "https://nssm.cc/release/nssm-2.24.zip",
  [string]$ServiceUser = $env:USERNAME,
  [string]$ServicePassword = $null,
  [int]$BackendPort = 3101,
  [int]$GuiPort = 3003
)

# Region: Preconditions
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Error "Please run this script as Administrator."; exit 1
}

if (-not $NodeExePath) {
  $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
  if ($nodeCmd) {
    $NodeExePath = $nodeCmd.Source
  }
}
if (-not $NodeExePath) { Write-Error "Node.js (node.exe) not found on PATH. Please install Node.js and retry."; exit 1 }

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path | Split-Path -Parent
$WorkDir = $Root
$NssmDir = Join-Path $Root "bin\nssm"
$NssmExe = Join-Path $NssmDir "nssm.exe"
$LogsDir = Join-Path $Root "logs"
New-Item -ItemType Directory -Path $NssmDir -Force | Out-Null
New-Item -ItemType Directory -Path $LogsDir -Force | Out-Null

# Region: Download/Extract NSSM if needed
if (-not (Test-Path $NssmExe)) {
  $zipPath = Join-Path $env:TEMP "nssm.zip"
  $extractDir = Join-Path $env:TEMP "nssm_extract"

  # Ensure modern TLS
  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls11 -bor [Net.SecurityProtocolType]::Tls
  } catch {}

  $urls = @(
    $NssmUrl,
    # Mirror on GitHub
    "https://github.com/kohsuke/nssm-mirror/releases/download/v2.24-101-g897c7ad/nssm-2.24-101-g897c7ad.zip",
    # Alternate archived source
    "https://raw.githubusercontent.com/azawawi/nssm-mirror/master/dist/nssm-2.24.zip"
  )

  $downloaded = $false
  foreach ($u in $urls) {
    try {
      Write-Host "Attempting to download NSSM from $u ..."
      Invoke-WebRequest -Uri $u -OutFile $zipPath -UseBasicParsing -TimeoutSec 60
      if (Test-Path $zipPath) {
        $downloaded = $true; break
      }
    } catch {
      Write-Warning ("Download failed from {0}: {1}" -f $u, $_.Exception.Message)
    }
  }

  if (-not $downloaded) {
    Write-Error "Failed to download NSSM from all known sources. Please download nssm.zip manually and place it at $zipPath, then re-run this script."; exit 1
  }

  if (Test-Path $extractDir) { Remove-Item $extractDir -Recurse -Force }
  try {
    Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force
  } catch {
    Write-Error "Failed to extract NSSM archive: $($_.Exception.Message)"; exit 1
  }

  # Try to pick 64-bit binary first
  $cand = Get-ChildItem -Path $extractDir -Recurse -Filter nssm.exe | Where-Object { $_.FullName -match "win64" } | Select-Object -First 1
  if (-not $cand) { $cand = Get-ChildItem -Path $extractDir -Recurse -Filter nssm.exe | Select-Object -First 1 }
  if (-not $cand) { Write-Error "Failed to locate nssm.exe in archive."; exit 1 }
  Copy-Item $cand.FullName $NssmExe -Force
}

# Region: Service definitions
$BackendService = "PathologyBackend"
$GuiService = "PathologyGui"

$BackendCmd = $NodeExePath
$BackendArgs = "server.js"
$BackendEnv = @{
  "NODE_MODE" = "server";
  "PORT" = "$BackendPort";
}

$GuiCmd = $NodeExePath
$GuiArgs = "gui-server.js"
$GuiEnv = @{
  "PORT" = "$GuiPort";
}

Function Set-NssmService {
  param(
    [string]$Name,
    [string]$Exe,
    [string]$Args,
    [hashtable]$Env,
    [string]$AppDir,
    [string]$StdOut,
    [string]$StdErr
  )
  & $NssmExe install $Name $Exe $Args | Out-Null
  & $NssmExe set $Name AppDirectory $AppDir | Out-Null
  & $NssmExe set $Name Start SERVICE_AUTO_START | Out-Null
  & $NssmExe set $Name AppStdout $StdOut | Out-Null
  & $NssmExe set $Name AppStderr $StdErr | Out-Null
  & $NssmExe set $Name AppStdoutCreationDisposition 2 | Out-Null # append
  & $NssmExe set $Name AppStderrCreationDisposition 2 | Out-Null # append
  & $NssmExe set $Name AppRotateFiles 1 | Out-Null
  & $NssmExe set $Name AppRotateOnline 1 | Out-Null
  & $NssmExe set $Name AppRotateBytes 10485760 | Out-Null # 10MB
  & $NssmExe set $Name AppExit Default Restart | Out-Null
  & $NssmExe set $Name AppNoConsole 1 | Out-Null
  # Environment
  if ($Env) {
    $envPairs = $Env.GetEnumerator() | ForEach-Object { "{0}={1}" -f $_.Key, $_.Value }
    & $NssmExe set $Name AppEnvironmentExtra ($envPairs -join " ") | Out-Null
  }
}

Write-Host "Installing services..."
Set-NssmService -Name $BackendService -Exe $BackendCmd -Args $BackendArgs -Env $BackendEnv -AppDir $WorkDir -StdOut (Join-Path $LogsDir "backend.out.log") -StdErr (Join-Path $LogsDir "backend.err.log")
Set-NssmService -Name $GuiService -Exe $GuiCmd -Args $GuiArgs -Env $GuiEnv -AppDir $WorkDir -StdOut (Join-Path $LogsDir "gui.out.log") -StdErr (Join-Path $LogsDir "gui.err.log")

if ($ServicePassword) {
  & $NssmExe set $BackendService ObjectName ".\$ServiceUser" "$ServicePassword" | Out-Null
  & $NssmExe set $GuiService ObjectName ".\$ServiceUser" "$ServicePassword" | Out-Null
}

Write-Host "Creating Windows Firewall rules (if missing)..."
$fw1 = "Pathology Backend $BackendPort"
$fw2 = "Pathology GUI $GuiPort"
if (-not (Get-NetFirewallRule -DisplayName $fw1 -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -DisplayName $fw1 -Direction Inbound -LocalPort $BackendPort -Protocol TCP -Action Allow | Out-Null
}
if (-not (Get-NetFirewallRule -DisplayName $fw2 -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -DisplayName $fw2 -Direction Inbound -LocalPort $GuiPort -Protocol TCP -Action Allow | Out-Null
}

Write-Host "Starting services..."
Start-Service $BackendService
Start-Service $GuiService

Get-Service $BackendService, $GuiService | Format-Table -AutoSize
Write-Host "Done. You can manage services via Services.msc or the tray app."
