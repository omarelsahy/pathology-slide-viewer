# Hardware Bus & SATA Controller Diagnostic
# Identifies potential motherboard, SATA controller, and bus issues

Write-Host "=== HARDWARE BUS & SATA CONTROLLER DIAGNOSTIC ===" -ForegroundColor Cyan
Write-Host "Analyzing potential motherboard/SATA controller hardware issues" -ForegroundColor Yellow
Write-Host ""

# Test 1: SATA Controller Information
Write-Host "=== SATA CONTROLLER ANALYSIS ===" -ForegroundColor Green
Write-Host ""

Write-Host "SATA Controllers:" -ForegroundColor Yellow
Get-WmiObject -Class Win32_SCSIController | Where-Object {$_.Name -like "*SATA*" -or $_.Name -like "*AHCI*" -or $_.Name -like "*IDE*"} | ForEach-Object {
    Write-Host "  Controller: $($_.Name)" -ForegroundColor White
    Write-Host "  Status: $($_.Status)" -ForegroundColor $(if($_.Status -eq "OK") {"Green"} else {"Red"})
    Write-Host "  Driver Date: $($_.DriverDate)" -ForegroundColor Gray
    Write-Host "  Hardware ID: $($_.PNPDeviceID)" -ForegroundColor Gray
    Write-Host ""
}

# Test 2: Disk Drive Details with Bus Information
Write-Host "=== DISK DRIVE BUS ANALYSIS ===" -ForegroundColor Green
Write-Host ""

$disks = Get-WmiObject -Class Win32_DiskDrive
foreach ($disk in $disks) {
    Write-Host "Drive: $($disk.Model)" -ForegroundColor Yellow
    Write-Host "  Size: $([math]::Round($disk.Size / 1GB, 2)) GB"
    Write-Host "  Interface: $($disk.InterfaceType)"
    Write-Host "  Bus Type: $($disk.MediaType)"
    Write-Host "  Status: $($disk.Status)" -ForegroundColor $(if($disk.Status -eq "OK") {"Green"} else {"Red"})
    Write-Host "  Partitions: $($disk.Partitions)"
    Write-Host "  Bytes per Sector: $($disk.BytesPerSector)"
    Write-Host "  Sectors per Track: $($disk.SectorsPerTrack)"
    Write-Host "  Tracks per Cylinder: $($disk.TracksPerCylinder)"
    Write-Host "  Total Cylinders: $($disk.TotalCylinders)"
    
    # Check for SATA-specific issues
    if ($disk.InterfaceType -eq "SCSI" -and $disk.MediaType -eq "Fixed hard disk media") {
        Write-Host "  ⚠️  SATA drive detected as SCSI - potential controller issue" -ForegroundColor Yellow
    }
    Write-Host ""
}

# Test 3: PCI/PCIe Bus Analysis
Write-Host "=== PCI/PCIe BUS ANALYSIS ===" -ForegroundColor Green
Write-Host ""

Write-Host "Storage-Related PCI Devices:" -ForegroundColor Yellow
Get-WmiObject -Class Win32_PnPEntity | Where-Object {
    $_.Name -like "*SATA*" -or 
    $_.Name -like "*AHCI*" -or 
    $_.Name -like "*IDE*" -or
    $_.Name -like "*Storage*" -or
    $_.Name -like "*Disk*"
} | ForEach-Object {
    Write-Host "  Device: $($_.Name)" -ForegroundColor White
    Write-Host "  Status: $($_.Status)" -ForegroundColor $(if($_.Status -eq "OK") {"Green"} else {"Red"})
    Write-Host "  Problem Code: $($_.ConfigManagerErrorCode)" -ForegroundColor $(if($_.ConfigManagerErrorCode -eq 0) {"Green"} else {"Red"})
    if ($_.ConfigManagerErrorCode -ne 0) {
        Write-Host "    ❌ Hardware Problem Detected!" -ForegroundColor Red
    }
    Write-Host ""
}

# Test 4: System Event Log Analysis
Write-Host "=== SYSTEM EVENT LOG ANALYSIS ===" -ForegroundColor Green
Write-Host ""

Write-Host "Recent Disk/Storage Errors (last 7 days):" -ForegroundColor Yellow
$startDate = (Get-Date).AddDays(-7)
$diskErrors = Get-WinEvent -FilterHashtable @{LogName='System'; StartTime=$startDate; Level=1,2,3} -ErrorAction SilentlyContinue | 
    Where-Object {$_.ProviderName -like "*disk*" -or $_.ProviderName -like "*storage*" -or $_.ProviderName -like "*ata*" -or $_.Message -like "*SATA*"}

if ($diskErrors) {
    $diskErrors | Select-Object -First 10 | ForEach-Object {
        Write-Host "  ❌ $($_.TimeCreated): $($_.LevelDisplayName)" -ForegroundColor Red
        Write-Host "     Provider: $($_.ProviderName)"
        Write-Host "     Message: $($_.Message.Substring(0, [Math]::Min(100, $_.Message.Length)))..."
        Write-Host ""
    }
} else {
    Write-Host "  ✅ No recent disk/storage errors found" -ForegroundColor Green
}

# Test 5: Temperature and Power Analysis
Write-Host "=== THERMAL & POWER ANALYSIS ===" -ForegroundColor Green
Write-Host ""

Write-Host "System Temperatures (if available):" -ForegroundColor Yellow
try {
    $temps = Get-WmiObject -Namespace "root\wmi" -Class MSAcpi_ThermalZoneTemperature -ErrorAction SilentlyContinue
    if ($temps) {
        foreach ($temp in $temps) {
            $celsius = [math]::Round(($temp.CurrentTemperature / 10) - 273.15, 2)
            Write-Host "  Zone $($temp.InstanceName): ${celsius}°C" -ForegroundColor $(if($celsius -gt 70) {"Red"} elseif($celsius -gt 50) {"Yellow"} else {"Green"})
        }
    } else {
        Write-Host "  ⚠️  Temperature sensors not accessible via WMI" -ForegroundColor Yellow
    }
} catch {
    Write-Host "  ⚠️  Unable to read temperature data" -ForegroundColor Yellow
}

# Test 6: SMART Data Analysis
Write-Host ""
Write-Host "=== SMART DATA ANALYSIS ===" -ForegroundColor Green
Write-Host ""

Write-Host "Drive Health (SMART Status):" -ForegroundColor Yellow
$drives = Get-WmiObject -Namespace root\wmi -Class MSStorageDriver_FailurePredictStatus -ErrorAction SilentlyContinue
if ($drives) {
    foreach ($drive in $drives) {
        $driveNumber = $drive.InstanceName
        Write-Host "  Drive $driveNumber: " -NoNewline
        if ($drive.PredictFailure) {
            Write-Host "❌ FAILING" -ForegroundColor Red
        } else {
            Write-Host "✅ Healthy" -ForegroundColor Green
        }
    }
} else {
    Write-Host "  ⚠️  SMART data not accessible" -ForegroundColor Yellow
}

# Test 7: Performance Counter Analysis
Write-Host ""
Write-Host "=== REAL-TIME PERFORMANCE ANALYSIS ===" -ForegroundColor Green
Write-Host ""

Write-Host "Current Disk Performance Metrics:" -ForegroundColor Yellow
Write-Host "Collecting 10 seconds of performance data..." -ForegroundColor Gray

$counters = @(
    "\PhysicalDisk(*)\Disk Reads/sec",
    "\PhysicalDisk(*)\Disk Writes/sec", 
    "\PhysicalDisk(*)\Avg. Disk Queue Length",
    "\PhysicalDisk(*)\% Disk Time"
)

try {
    $perfData = Get-Counter -Counter $counters -SampleInterval 2 -MaxSamples 5 -ErrorAction SilentlyContinue
    
    # Analyze the performance data
    $avgData = @{}
    foreach ($sample in $perfData) {
        foreach ($counter in $sample.CounterSamples) {
            $path = $counter.Path
            if (-not $avgData.ContainsKey($path)) {
                $avgData[$path] = @()
            }
            $avgData[$path] += $counter.CookedValue
        }
    }
    
    foreach ($path in $avgData.Keys) {
        $avg = ($avgData[$path] | Measure-Object -Average).Average
        $instanceName = ($path -split "\\")[2]
        $counterName = ($path -split "\\")[3]
        
        if ($instanceName -ne "_Total" -and $instanceName -ne "*") {
            Write-Host "  $instanceName - $counterName`: $([math]::Round($avg, 2))" -ForegroundColor White
            
            # Flag potential issues
            if ($counterName -eq "% Disk Time" -and $avg -gt 80) {
                Write-Host "    ⚠️  High disk utilization detected" -ForegroundColor Yellow
            }
            if ($counterName -eq "Avg. Disk Queue Length" -and $avg -gt 2) {
                Write-Host "    ⚠️  High disk queue length - potential bottleneck" -ForegroundColor Yellow
            }
        }
    }
} catch {
    Write-Host "  ⚠️  Unable to collect performance counter data" -ForegroundColor Yellow
}

# Test 8: Hardware Diagnostic Summary
Write-Host ""
Write-Host "=== DIAGNOSTIC SUMMARY ===" -ForegroundColor Cyan
Write-Host ""

Write-Host "Hardware Issue Indicators:" -ForegroundColor Yellow

# Check for common hardware problem patterns
$hardwareIssues = @()

# Check SATA controller status
$sataControllers = Get-WmiObject -Class Win32_SCSIController | Where-Object {$_.Name -like "*SATA*" -or $_.Name -like "*AHCI*"}
foreach ($controller in $sataControllers) {
    if ($controller.Status -ne "OK") {
        $hardwareIssues += "SATA Controller Status: $($controller.Status)"
    }
}

# Check for device manager errors
$problemDevices = Get-WmiObject -Class Win32_PnPEntity | Where-Object {$_.ConfigManagerErrorCode -ne 0 -and ($_.Name -like "*SATA*" -or $_.Name -like "*disk*" -or $_.Name -like "*storage*")}
if ($problemDevices) {
    $hardwareIssues += "Device Manager Errors: $($problemDevices.Count) storage-related devices with problems"
}

# Display results
if ($hardwareIssues.Count -gt 0) {
    Write-Host "❌ POTENTIAL HARDWARE ISSUES DETECTED:" -ForegroundColor Red
    foreach ($issue in $hardwareIssues) {
        Write-Host "  • $issue" -ForegroundColor Red
    }
} else {
    Write-Host "✅ No obvious hardware issues detected in system reports" -ForegroundColor Green
    Write-Host "   However, performance issues may still indicate:" -ForegroundColor Yellow
    Write-Host "   • Aging SATA controller (thermal degradation)" -ForegroundColor Yellow
    Write-Host "   • SATA cable degradation" -ForegroundColor Yellow
    Write-Host "   • Power delivery issues" -ForegroundColor Yellow
    Write-Host "   • Motherboard capacitor aging" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "=== RECOMMENDATIONS ===" -ForegroundColor Cyan
Write-Host "1. Replace SATA cables (cheap, often fixes issues)" -ForegroundColor White
Write-Host "2. Test drives in different SATA ports" -ForegroundColor White
Write-Host "3. Check motherboard capacitors for bulging/leaking" -ForegroundColor White
Write-Host "4. Update SATA controller drivers" -ForegroundColor White
Write-Host "5. Consider PCIe SATA expansion card as bypass test" -ForegroundColor White
Write-Host "6. Monitor system temperatures during heavy I/O" -ForegroundColor White
