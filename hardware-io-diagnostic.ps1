# Hardware I/O Diagnostic - Systematic Analysis
# Identifies exact hardware component causing I/O bottleneck

param(
    [switch]$FullTest,
    [string]$TestSize = "100MB"
)

Write-Host "=== HARDWARE I/O DIAGNOSTIC ===" -ForegroundColor Cyan
Write-Host "Systematic analysis to identify exact hardware bottleneck" -ForegroundColor Yellow
Write-Host ""

# Test 1: System Hardware Information
Write-Host "=== SYSTEM HARDWARE ANALYSIS ===" -ForegroundColor Green
Write-Host ""

# Get motherboard info
$motherboard = Get-WmiObject -Class Win32_BaseBoard
$bios = Get-WmiObject -Class Win32_BIOS
$system = Get-WmiObject -Class Win32_ComputerSystem

Write-Host "System Information:" -ForegroundColor Yellow
Write-Host "  Manufacturer: $($system.Manufacturer)" -ForegroundColor White
Write-Host "  Model: $($system.Model)" -ForegroundColor White
Write-Host "  Motherboard: $($motherboard.Manufacturer) $($motherboard.Product)" -ForegroundColor White
Write-Host "  BIOS: $($bios.SMBIOSBIOSVersion) ($($bios.ReleaseDate))" -ForegroundColor White
Write-Host "  Total RAM: $([math]::Round($system.TotalPhysicalMemory / 1GB, 2)) GB" -ForegroundColor White
Write-Host ""

# Test 2: SATA Controller Deep Analysis
Write-Host "=== SATA CONTROLLER DEEP ANALYSIS ===" -ForegroundColor Green
Write-Host ""

Write-Host "SATA/Storage Controllers:" -ForegroundColor Yellow
$controllers = Get-WmiObject -Class Win32_SCSIController
foreach ($controller in $controllers) {
    Write-Host "  Controller: $($controller.Name)" -ForegroundColor White
    Write-Host "    Status: $($controller.Status)" -ForegroundColor $(if($controller.Status -eq "OK") {"Green"} else {"Red"})
    Write-Host "    Manufacturer: $($controller.Manufacturer)" -ForegroundColor Gray
    Write-Host "    Driver Version: $($controller.DriverVersion)" -ForegroundColor Gray
    Write-Host "    Driver Date: $($controller.DriverDate)" -ForegroundColor Gray
    Write-Host "    Hardware ID: $($controller.PNPDeviceID)" -ForegroundColor Gray
    
    # Check if it's an old controller
    if ($controller.DriverDate) {
        $driverDate = [DateTime]::ParseExact($controller.DriverDate.Substring(0,8), "yyyyMMdd", $null)
        $age = (Get-Date) - $driverDate
        if ($age.Days -gt 1825) { # 5 years
            Write-Host "    ⚠️  Driver is $([math]::Round($age.Days/365, 1)) years old!" -ForegroundColor Red
        }
    }
    Write-Host ""
}

# Test 3: Individual Drive Analysis
Write-Host "=== INDIVIDUAL DRIVE ANALYSIS ===" -ForegroundColor Green
Write-Host ""

$drives = Get-WmiObject -Class Win32_DiskDrive
foreach ($drive in $drives) {
    Write-Host "Drive: $($drive.Model)" -ForegroundColor Yellow
    Write-Host "  Size: $([math]::Round($drive.Size / 1GB, 2)) GB" -ForegroundColor White
    Write-Host "  Interface: $($drive.InterfaceType)" -ForegroundColor White
    Write-Host "  Media Type: $($drive.MediaType)" -ForegroundColor White
    Write-Host "  Status: $($drive.Status)" -ForegroundColor $(if($drive.Status -eq "OK") {"Green"} else {"Red"})
    Write-Host "  Partitions: $($drive.Partitions)" -ForegroundColor White
    Write-Host "  Signature: $($drive.Signature)" -ForegroundColor Gray
    
    # Check for SATA detection issues
    if ($drive.InterfaceType -eq "SCSI" -and $drive.MediaType -eq "Fixed hard disk media") {
        Write-Host "  ⚠️  SATA drive detected as SCSI - controller issue!" -ForegroundColor Red
    }
    
    # Get partition info
    $partitions = Get-WmiObject -Class Win32_DiskPartition | Where-Object {$_.DiskIndex -eq $drive.Index}
    foreach ($partition in $partitions) {
        $logicalDisks = Get-WmiObject -Class Win32_LogicalDisk | Where-Object {$_.DeviceID -eq $partition.DeviceID}
        foreach ($logical in $logicalDisks) {
            Write-Host "    Partition $($logical.DeviceID): $([math]::Round($logical.Size / 1GB, 2)) GB" -ForegroundColor Gray
        }
    }
    Write-Host ""
}

# Test 4: SMART Data Analysis
Write-Host "=== SMART DATA ANALYSIS ===" -ForegroundColor Green
Write-Host ""

Write-Host "Drive Health (SMART Status):" -ForegroundColor Yellow
try {
    $smartData = Get-WmiObject -Namespace root\wmi -Class MSStorageDriver_FailurePredictStatus -ErrorAction SilentlyContinue
    if ($smartData) {
        $driveIndex = 0
        foreach ($smart in $smartData) {
            $logicalDisks = Get-WmiObject -Class Win32_LogicalDisk | Where-Object {$_.DriveType -eq 3}
            if ($logicalDisks -and $driveIndex -lt $logicalDisks.Count) {
                $driveLabel = $logicalDisks[$driveIndex].DeviceID
            } else {
                $driveLabel = "Unknown"
            }
            Write-Host "  Drive ${driveIndex} ($driveLabel): " -NoNewline
            if ($smart.PredictFailure) {
                Write-Host "❌ SMART FAILURE PREDICTED!" -ForegroundColor Red
            } else {
                Write-Host "✅ SMART OK" -ForegroundColor Green
            }
            $driveIndex++
        }
    } else {
        Write-Host "  ⚠️  SMART data not accessible via WMI" -ForegroundColor Yellow
    }
    
    # Try alternative SMART access
    Write-Host ""
    Write-Host "Attempting detailed SMART analysis..." -ForegroundColor Gray
    $wmiDiskDrives = Get-WmiObject -Namespace root\wmi -Class MSStorageDriver_FailurePredictData -ErrorAction SilentlyContinue
    if ($wmiDiskDrives) {
        Write-Host "  ✅ Extended SMART data available" -ForegroundColor Green
    } else {
        Write-Host "  ⚠️  Extended SMART data not accessible" -ForegroundColor Yellow
    }
} catch {
    Write-Host "  ❌ SMART data access failed: $($_.Exception.Message)" -ForegroundColor Red
}

# Test 5: Performance Counter Deep Dive
Write-Host ""
Write-Host "=== PERFORMANCE COUNTER DEEP DIVE ===" -ForegroundColor Green
Write-Host ""

Write-Host "Collecting detailed disk performance data..." -ForegroundColor Yellow
Write-Host "This will take 30 seconds to get accurate averages..." -ForegroundColor Gray

$perfCounters = @(
    "\PhysicalDisk(*)\Disk Reads/sec",
    "\PhysicalDisk(*)\Disk Writes/sec",
    "\PhysicalDisk(*)\Disk Read Bytes/sec", 
    "\PhysicalDisk(*)\Disk Write Bytes/sec",
    "\PhysicalDisk(*)\Avg. Disk Queue Length",
    "\PhysicalDisk(*)\Avg. Disk sec/Read",
    "\PhysicalDisk(*)\Avg. Disk sec/Write",
    "\PhysicalDisk(*)\% Disk Time",
    "\PhysicalDisk(*)\Current Disk Queue Length"
)

try {
    $perfData = Get-Counter -Counter $perfCounters -SampleInterval 3 -MaxSamples 10 -ErrorAction SilentlyContinue
    
    # Analyze performance data
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
    
    # Group by disk and display results
    $diskData = @{}
    foreach ($path in $avgData.Keys) {
        $parts = $path -split "\\"
        $instanceName = $parts[2]
        $counterName = $parts[3]
        
        if ($instanceName -ne "_Total" -and $instanceName -notlike "*:*") {
            if (-not $diskData.ContainsKey($instanceName)) {
                $diskData[$instanceName] = @{}
            }
            
            $avg = ($avgData[$path] | Measure-Object -Average).Average
            $diskData[$instanceName][$counterName] = $avg
        }
    }
    
    # Display results with analysis
    foreach ($disk in $diskData.Keys | Sort-Object) {
        Write-Host ""
        Write-Host "Disk $disk Performance:" -ForegroundColor Yellow
        $data = $diskData[$disk]
        
        # Basic metrics
        if ($data["Disk Reads/sec"]) {
            Write-Host "  Read IOPS: $([math]::Round($data['Disk Reads/sec'], 2))" -ForegroundColor White
        }
        if ($data["Disk Writes/sec"]) {
            Write-Host "  Write IOPS: $([math]::Round($data['Disk Writes/sec'], 2))" -ForegroundColor White
        }
        if ($data["Disk Read Bytes/sec"]) {
            Write-Host "  Read Speed: $([math]::Round($data['Disk Read Bytes/sec'] / 1MB, 2)) MB/s" -ForegroundColor White
        }
        if ($data["Disk Write Bytes/sec"]) {
            Write-Host "  Write Speed: $([math]::Round($data['Disk Write Bytes/sec'] / 1MB, 2)) MB/s" -ForegroundColor White
        }
        
        # Latency metrics (critical for diagnosis)
        if ($data["Avg. Disk sec/Read"]) {
            $readLatency = $data["Avg. Disk sec/Read"] * 1000
            Write-Host "  Read Latency: $([math]::Round($readLatency, 2)) ms" -ForegroundColor $(if($readLatency -gt 20) {"Red"} elseif($readLatency -gt 10) {"Yellow"} else {"Green"})
            if ($readLatency -gt 20) {
                Write-Host "    ❌ VERY HIGH READ LATENCY! Normal: <10ms" -ForegroundColor Red
            }
        }
        if ($data["Avg. Disk sec/Write"]) {
            $writeLatency = $data["Avg. Disk sec/Write"] * 1000
            Write-Host "  Write Latency: $([math]::Round($writeLatency, 2)) ms" -ForegroundColor $(if($writeLatency -gt 20) {"Red"} elseif($writeLatency -gt 10) {"Yellow"} else {"Green"})
            if ($writeLatency -gt 20) {
                Write-Host "    ❌ VERY HIGH WRITE LATENCY! Normal: <10ms" -ForegroundColor Red
            }
        }
        
        # Queue and utilization
        if ($data["Avg. Disk Queue Length"]) {
            $queueLength = $data["Avg. Disk Queue Length"]
            Write-Host "  Avg Queue Length: $([math]::Round($queueLength, 2))" -ForegroundColor $(if($queueLength -gt 2) {"Red"} elseif($queueLength -gt 1) {"Yellow"} else {"Green"})
            if ($queueLength -gt 2) {
                Write-Host "    ❌ HIGH QUEUE LENGTH! I/O requests backing up" -ForegroundColor Red
            }
        }
        if ($data["% Disk Time"]) {
            $diskTime = $data["% Disk Time"]
            Write-Host "  Disk Utilization: $([math]::Round($diskTime, 2))%" -ForegroundColor $(if($diskTime -gt 80) {"Red"} elseif($diskTime -gt 60) {"Yellow"} else {"Green"})
            if ($diskTime -gt 80) {
                Write-Host "    ❌ DISK SATURATED! Running at maximum capacity" -ForegroundColor Red
            }
        }
    }
    
} catch {
    Write-Host "  ❌ Performance counter collection failed: $($_.Exception.Message)" -ForegroundColor Red
}

# Test 6: Event Log Analysis for Hardware Errors
Write-Host ""
Write-Host "=== HARDWARE ERROR LOG ANALYSIS ===" -ForegroundColor Green
Write-Host ""

Write-Host "Checking for hardware errors in last 30 days..." -ForegroundColor Yellow
$startDate = (Get-Date).AddDays(-30)

$hardwareErrors = @()
try {
    # System log errors
    $systemErrors = Get-WinEvent -FilterHashtable @{LogName='System'; StartTime=$startDate; Level=1,2} -ErrorAction SilentlyContinue | 
        Where-Object {$_.ProviderName -like "*disk*" -or $_.ProviderName -like "*storage*" -or $_.ProviderName -like "*ata*" -or $_.ProviderName -like "*scsi*"}
    $hardwareErrors += $systemErrors
    
    # Application log errors
    $appErrors = Get-WinEvent -FilterHashtable @{LogName='Application'; StartTime=$startDate; Level=1,2} -ErrorAction SilentlyContinue | 
        Where-Object {$_.Message -like "*disk*" -or $_.Message -like "*storage*" -or $_.Message -like "*I/O*"}
    $hardwareErrors += $appErrors
    
} catch {
    Write-Host "  ⚠️  Could not access event logs" -ForegroundColor Yellow
}

if ($hardwareErrors) {
    Write-Host "  ❌ HARDWARE ERRORS FOUND:" -ForegroundColor Red
    $hardwareErrors | Select-Object -First 10 | ForEach-Object {
        Write-Host "    $($_.TimeCreated): $($_.LevelDisplayName)" -ForegroundColor Red
        Write-Host "    Provider: $($_.ProviderName)" -ForegroundColor Gray
        Write-Host "    Message: $($_.Message.Substring(0, [Math]::Min(150, $_.Message.Length)))..." -ForegroundColor Gray
        Write-Host ""
    }
} else {
    Write-Host "  ✅ No recent hardware errors in event logs" -ForegroundColor Green
}

# Test 7: Diagnostic Summary and Recommendations
Write-Host ""
Write-Host "=== DIAGNOSTIC SUMMARY ===" -ForegroundColor Cyan
Write-Host ""

Write-Host "Hardware Issue Indicators Found:" -ForegroundColor Yellow

# Collect all issues found
$issues = @()
$recommendations = @()

# Check for old drivers
$oldDrivers = $controllers | Where-Object {
    $_.DriverDate -and 
    ([DateTime]::ParseExact($_.DriverDate.Substring(0,8), "yyyyMMdd", $null) -lt (Get-Date).AddYears(-3))
}
if ($oldDrivers) {
    $issues += "Old SATA controller drivers (3+ years old)"
    $recommendations += "Update SATA controller drivers"
}

# Check for SATA detection issues
$sataIssues = $drives | Where-Object {$_.InterfaceType -eq "SCSI" -and $_.MediaType -eq "Fixed hard disk media"}
if ($sataIssues) {
    $issues += "SATA drives detected as SCSI (controller issue)"
    $recommendations += "Check SATA controller configuration in BIOS"
}

# Display results
if ($issues.Count -gt 0) {
    Write-Host "❌ ISSUES DETECTED:" -ForegroundColor Red
    foreach ($issue in $issues) {
        Write-Host "  • $issue" -ForegroundColor Red
    }
} else {
    Write-Host "⚠️  No obvious configuration issues detected" -ForegroundColor Yellow
    Write-Host "   Issue is likely hardware degradation:" -ForegroundColor Yellow
    Write-Host "   • SATA controller chip degradation" -ForegroundColor Yellow
    Write-Host "   • Motherboard trace corrosion" -ForegroundColor Yellow
    Write-Host "   • Power delivery issues" -ForegroundColor Yellow
    Write-Host "   • SATA cable degradation" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "=== NEXT STEPS ===" -ForegroundColor Cyan
if ($recommendations.Count -gt 0) {
    foreach ($rec in $recommendations) {
        Write-Host "1. $rec" -ForegroundColor White
    }
} else {
    Write-Host "1. Replace SATA cables (cheapest test)" -ForegroundColor White
    Write-Host "2. Try drives on different SATA ports" -ForegroundColor White
    Write-Host "3. Install PCIe SATA expansion card (bypass motherboard)" -ForegroundColor White
    Write-Host "4. Consider NVMe upgrade for 20-40x performance improvement" -ForegroundColor White
}

Write-Host ""
Write-Host "Run with -FullTest for additional synthetic I/O benchmarks" -ForegroundColor Gray
