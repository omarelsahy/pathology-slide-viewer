<#
Pathology Slide Viewer - System Tray Controller

A lightweight PowerShell tray app to monitor and control services:
- PathologyBackend
- PathologyGui

Run this script (no admin required for status; start/stop may require elevation depending on service config).
#>
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# Auto-elevate to control Windows Services, and hide the console window
# Elevation check
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo "powershell"
  $psi.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
  $psi.Verb = "runas"
  try { [System.Diagnostics.Process]::Start($psi) | Out-Null } catch {
    [System.Windows.Forms.MessageBox]::Show("Administrative privileges are required to control services.", "Pathology Slide Viewer") | Out-Null
  }
  exit
}

# Hide the current console window
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class Win32Hide {
  [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
'@
$hwnd = [Win32Hide]::GetConsoleWindow()
if ($hwnd -ne [IntPtr]::Zero) { [Win32Hide]::ShowWindow($hwnd, 0) | Out-Null }

$services = @(
  @{ Name = 'PathologyBackend'; Display = 'Backend (API)'; Port = 3102 },
  @{ Name = 'PathologyGui'; Display = 'GUI (Web)'; Port = 3003 },
  @{ Name = 'PathologyConversion'; Display = 'Conversion Server'; Port = 3001 }
)

function Get-ServiceState($name) {
  try {
    $s = Get-Service -Name $name -ErrorAction Stop
    return $s.Status
  } catch {
    return 'NotInstalled'
  }
}

function Refresh-Statuses {
  foreach ($svc in $services) {
    $svc.Status = Get-ServiceState $svc.Name
  }
}

function Test-HttpHealth($port, $path) {
  try {
    $url = "http://localhost:$port$path"
    $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
    if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 300) { return $true }
    return $false
  } catch { return $false }
}

function Start-Svc($name) {
  try { Start-Service -Name $name -ErrorAction Stop; return $true } catch { return $false }
}
function Stop-Svc($name) {
  try { Stop-Service -Name $name -ErrorAction Stop; return $true } catch { return $false }
}
function Restart-Svc($name) {
  try { Restart-Service -Name $name -ErrorAction Stop; return $true } catch { return $false }
}

# Notify icon setup
$icon = New-Object System.Windows.Forms.NotifyIcon
$icon.Icon = [System.Drawing.SystemIcons]::Information
$icon.Visible = $true
$icon.Text = 'Pathology Slide Viewer'

# Context menu builder
function Build-Menu {
  $menu = New-Object System.Windows.Forms.ContextMenuStrip

  Refresh-Statuses

  foreach ($svc in $services) {
    $svcItem = New-Object System.Windows.Forms.ToolStripMenuItem
    $state = $svc.Status
    # Health probe per service
    $healthSuffix = ''
    if ($svc.Name -eq 'PathologyBackend' -and $state -eq 'Running') {
      $ok = Test-HttpHealth -port 3102 -path '/api/performance/status'
      $healthSuffix = if ($ok) { ' (API OK)' } else { ' (API DOWN)' }
    } elseif ($svc.Name -eq 'PathologyGui' -and $state -eq 'Running') {
      $ok = Test-HttpHealth -port 3003 -path '/api/config'
      $healthSuffix = if ($ok) { ' (GUI OK)' } else { ' (GUI DOWN)' }
    } elseif ($svc.Name -eq 'PathologyConversion' -and $state -eq 'Running') {
      $ok = Test-HttpHealth -port 3001 -path '/health'
      $healthSuffix = if ($ok) { ' (CONV OK)' } else { ' (CONV DOWN)' }
    }
    $svcItem.Text = ("{0} - {1}{2}" -f $svc.Display, $state, $healthSuffix)
    $svcItem.Enabled = $true

    # Capture values for use inside event handlers via Tag
    $name = $svc.Name
    $display = $svc.Display
    $port = $svc.Port

    $startItem = New-Object System.Windows.Forms.ToolStripMenuItem
    $startItem.Text = 'Start'
    $startItem.Tag = @{ Name = $name; Display = $display }
    $startItem.Add_Click({ param($sender, $e)
        try {
            $meta = $sender.Tag
            Start-Service -Name $meta.Name -ErrorAction Stop
            $icon.ShowBalloonTip(1200, 'Service', ("Started {0}" -f $meta.Display), [System.Windows.Forms.ToolTipIcon]::Info)
        } catch {
            $icon.ShowBalloonTip(1500, 'Service', ("Failed to start {0}: {1}" -f $sender.Tag.Display, $_.Exception.Message), [System.Windows.Forms.ToolTipIcon]::Error)
        }
        Build-Menu
    })

    $stopItem = New-Object System.Windows.Forms.ToolStripMenuItem
    $stopItem.Text = 'Stop'
    $stopItem.Tag = @{ Name = $name; Display = $display }
    $stopItem.Add_Click({ param($sender, $e)
        try {
            $meta = $sender.Tag
            Stop-Service -Name $meta.Name -ErrorAction Stop
            $icon.ShowBalloonTip(1200, 'Service', ("Stopped {0}" -f $meta.Display), [System.Windows.Forms.ToolTipIcon]::Info)
        } catch {
            $icon.ShowBalloonTip(1500, 'Service', ("Failed to stop {0}: {1}" -f $sender.Tag.Display, $_.Exception.Message), [System.Windows.Forms.ToolTipIcon]::Error)
        }
        Build-Menu
    })

    $restartItem = New-Object System.Windows.Forms.ToolStripMenuItem
    $restartItem.Text = 'Restart'
    $restartItem.Tag = @{ Name = $name; Display = $display }
    $restartItem.Add_Click({ param($sender, $e)
        try {
            $meta = $sender.Tag
            Restart-Service -Name $meta.Name -ErrorAction Stop
            $icon.ShowBalloonTip(1200, 'Service', ("Restarted {0}" -f $meta.Display), [System.Windows.Forms.ToolTipIcon]::Info)
        } catch {
            $icon.ShowBalloonTip(1500, 'Service', ("Failed to restart {0}: {1}" -f $sender.Tag.Display, $_.Exception.Message), [System.Windows.Forms.ToolTipIcon]::Error)
        }
        Build-Menu
    })

    $openItem = New-Object System.Windows.Forms.ToolStripMenuItem
    $openItem.Text = ("Open http://localhost:{0}" -f $port)
    $openItem.Tag = @{ Port = $port }
    $openItem.Add_Click({ param($sender, $e) Start-Process ("http://localhost:{0}" -f $sender.Tag.Port) })

    $svcItem.DropDownItems.Add($startItem) | Out-Null
    $svcItem.DropDownItems.Add($stopItem) | Out-Null
    $svcItem.DropDownItems.Add($restartItem) | Out-Null
    $sep = New-Object System.Windows.Forms.ToolStripSeparator
    $svcItem.DropDownItems.Add($sep) | Out-Null
    $svcItem.DropDownItems.Add($openItem) | Out-Null

    $menu.Items.Add($svcItem) | Out-Null
  }

  $menuSep = New-Object System.Windows.Forms.ToolStripSeparator
  $menu.Items.Add($menuSep) | Out-Null

  # Restart All Servers option
  $restartAllItem = New-Object System.Windows.Forms.ToolStripMenuItem
  $restartAllItem.Text = 'Restart All Servers'
  $restartAllItem.Add_Click({
    $icon.ShowBalloonTip(2000, 'Restarting', 'Restarting all pathology servers...', [System.Windows.Forms.ToolTipIcon]::Info)
    
    $successCount = 0
    $totalCount = $services.Count
    
    foreach ($svc in $services) {
      try {
        $currentState = Get-ServiceState $svc.Name
        if ($currentState -eq 'Running') {
          Restart-Service -Name $svc.Name -ErrorAction Stop
          $successCount++
        } elseif ($currentState -eq 'Stopped') {
          Start-Service -Name $svc.Name -ErrorAction Stop
          $successCount++
        }
      } catch {
        # Continue with other services even if one fails
      }
    }
    
    if ($successCount -eq $totalCount) {
      $icon.ShowBalloonTip(3000, 'Success', 'All servers restarted successfully!', [System.Windows.Forms.ToolTipIcon]::Info)
    } else {
      $icon.ShowBalloonTip(3000, 'Partial Success', "Restarted $successCount of $totalCount servers", [System.Windows.Forms.ToolTipIcon]::Warning)
    }
    
    # Wait a moment then refresh the menu
    Start-Sleep -Seconds 2
    Build-Menu
  })
  $menu.Items.Add($restartAllItem) | Out-Null

  $refreshItem = New-Object System.Windows.Forms.ToolStripMenuItem
  $refreshItem.Text = 'Refresh Status'
  $refreshItem.Add_Click({ Build-Menu })
  $menu.Items.Add($refreshItem) | Out-Null

  $exitItem = New-Object System.Windows.Forms.ToolStripMenuItem
  $exitItem.Text = 'Exit'
  $exitItem.Add_Click({ $icon.Visible = $false; [System.Windows.Forms.Application]::Exit() })
  $menu.Items.Add($exitItem) | Out-Null

  $icon.ContextMenuStrip = $menu
}

Build-Menu
$icon.ShowBalloonTip(1500, 'Pathology Viewer', 'Tray controller started', [System.Windows.Forms.ToolTipIcon]::Info)

[System.Windows.Forms.Application]::EnableVisualStyles()

# Periodic auto-refresh every 5 seconds to keep status in sync
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 5000
$timer.Add_Tick({ Build-Menu })
$timer.Start()

[System.Windows.Forms.Application]::Run()
