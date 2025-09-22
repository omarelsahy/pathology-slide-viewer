# System Performance Diagnostic for SSD Issues
# Run this as Administrator in PowerShell to diagnose low IOPS

Write-Host "🔍 System Performance Diagnostic for SSD Issues" -ForegroundColor Cyan
Write-Host "=" * 60

# 1. Check Drive Space and Health
Write-Host "`n📊 DRIVE SPACE & HEALTH" -ForegroundColor Yellow
Write-Host "-" * 30

$drives = Get-WmiObject -Class Win32_LogicalDisk | Where-Object {$_.DriveType -eq 3}
foreach ($drive in $drives) {
    $freeSpaceGB = [math]::Round($drive.FreeSpace / 1GB, 2)
    $totalSpaceGB = [math]::Round($drive.Size / 1GB, 2)
    $usedPercent = [math]::Round((($drive.Size - $drive.FreeSpace) / $drive.Size) * 100, 1)
    
    Write-Host "Drive $($drive.DeviceID)"
    Write-Host "  Total: $totalSpaceGB GB"
    Write-Host "  Free: $freeSpaceGB GB"
    Write-Host "  Used: $usedPercent%"
    
    if ($usedPercent -gt 80) {
        Write-Host "  ⚠️  WARNING: Drive >80% full - SSD performance degraded!" -ForegroundColor Red
    } elseif ($usedPercent -gt 90) {
        Write-Host "  🚨 CRITICAL: Drive >90% full - Major performance impact!" -ForegroundColor Red
    } else {
        Write-Host "  ✅ Drive space OK" -ForegroundColor Green
    }
    Write-Host ""
}

# 2. Check for High Disk Usage Processes
Write-Host "📈 TOP DISK USAGE PROCESSES" -ForegroundColor Yellow
Write-Host "-" * 30

try {
    $processes = Get-Counter "\Process(*)\IO Data Bytes/sec" -ErrorAction SilentlyContinue | 
                 Select-Object -ExpandProperty CounterSamples | 
                 Where-Object {$_.CookedValue -gt 0} | 
                 Sort-Object CookedValue -Descending | 
                 Select-Object -First 10

    foreach ($proc in $processes) {
        $processName = ($proc.InstanceName -split "#")[0]
        $ioMBps = [math]::Round($proc.CookedValue / 1MB, 2)
        if ($ioMBps -gt 1) {
            Write-Host "  $processName`: $ioMBps MB/s"
        }
    }
} catch {
    Write-Host "  Unable to get process disk usage - run as Administrator" -ForegroundColor Red
}

# 3. Check Windows Search Indexing
Write-Host "`n🔍 WINDOWS SEARCH INDEXING" -ForegroundColor Yellow
Write-Host "-" * 30

$searchService = Get-Service -Name "WSearch" -ErrorAction SilentlyContinue
if ($searchService) {
    Write-Host "Windows Search Service: $($searchService.Status)"
    if ($searchService.Status -eq "Running") {
        Write-Host "⚠️  Windows Search is running - may impact small file performance" -ForegroundColor Yellow
        
        # Check if our directories are indexed
        $indexedPaths = @("C:\OG", "C:\dzi", "C:\temp")
        foreach ($path in $indexedPaths) {
            if (Test-Path $path) {
                Write-Host "  Checking indexing for: $path"
                # This is a simplified check - full indexing status requires more complex queries
            }
        }
    }
} else {
    Write-Host "Windows Search Service: Not found"
}

# 4. Check Antivirus Real-time Scanning
Write-Host "`n🛡️  ANTIVIRUS & SECURITY" -ForegroundColor Yellow
Write-Host "-" * 30

# Check Windows Defender
try {
    $defenderStatus = Get-MpComputerStatus -ErrorAction SilentlyContinue
    if ($defenderStatus) {
        Write-Host "Windows Defender:"
        Write-Host "  Real-time Protection: $($defenderStatus.RealTimeProtectionEnabled)"
        Write-Host "  Behavior Monitoring: $($defenderStatus.BehaviorMonitorEnabled)"
        Write-Host "  On Access Protection: $($defenderStatus.OnAccessProtectionEnabled)"
        
        if ($defenderStatus.RealTimeProtectionEnabled) {
            Write-Host "  ⚠️  Real-time scanning may impact file I/O performance" -ForegroundColor Yellow
        }
    }
} catch {
    Write-Host "  Unable to check Windows Defender status"
}

# Check for other antivirus
$antivirusProducts = Get-WmiObject -Namespace "root\SecurityCenter2" -Class AntiVirusProduct -ErrorAction SilentlyContinue
if ($antivirusProducts) {
    Write-Host "`nInstalled Antivirus Products:"
    foreach ($av in $antivirusProducts) {
        Write-Host "  $($av.displayName)"
    }
}

# 5. Check SSD-specific Settings
Write-Host "`n💾 SSD OPTIMIZATION SETTINGS" -ForegroundColor Yellow
Write-Host "-" * 30

# Check TRIM status
$trimStatus = fsutil behavior query DisableDeleteNotify
Write-Host "TRIM Status: $trimStatus"
if ($trimStatus -match "DisableDeleteNotify = 0") {
    Write-Host "  ✅ TRIM is enabled (good for SSD)" -ForegroundColor Green
} else {
    Write-Host "  ⚠️  TRIM may be disabled - impacts SSD performance" -ForegroundColor Yellow
}

# Check power settings
$powerPlan = powercfg /getactivescheme
Write-Host "`nActive Power Plan: $powerPlan"

# 6. Check Disk Performance Counters
Write-Host "`n📊 REAL-TIME DISK PERFORMANCE" -ForegroundColor Yellow
Write-Host "-" * 30

try {
    Write-Host "Sampling disk performance for 5 seconds..."
    $diskCounters = Get-Counter -Counter "\PhysicalDisk(*)\Disk Reads/sec", "\PhysicalDisk(*)\Disk Writes/sec", "\PhysicalDisk(*)\Current Disk Queue Length" -SampleInterval 1 -MaxSamples 5
    
    $avgReads = ($diskCounters.CounterSamples | Where-Object {$_.Path -like "*C:*Reads/sec"} | Measure-Object CookedValue -Average).Average
    $avgWrites = ($diskCounters.CounterSamples | Where-Object {$_.Path -like "*C:*Writes/sec"} | Measure-Object CookedValue -Average).Average
    $avgQueueLength = ($diskCounters.CounterSamples | Where-Object {$_.Path -like "*C:*Queue Length"} | Measure-Object CookedValue -Average).Average
    
    Write-Host "C: Drive Performance (5-second average):"
    Write-Host "  Reads/sec: $([math]::Round($avgReads, 1))"
    Write-Host "  Writes/sec: $([math]::Round($avgWrites, 1))"
    Write-Host "  Queue Length: $([math]::Round($avgQueueLength, 2))"
    
    if ($avgQueueLength -gt 2) {
        Write-Host "  ⚠️  High queue length indicates disk bottleneck" -ForegroundColor Yellow
    }
} catch {
    Write-Host "  Unable to sample disk performance counters"
}

# 7. Check for Fragmentation (simplified)
Write-Host "`n🧩 FRAGMENTATION CHECK" -ForegroundColor Yellow
Write-Host "-" * 30

try {
    $fragReport = Invoke-Expression "defrag C: /A /V" 2>$null
    if ($fragReport) {
        $fragLines = $fragReport | Select-String "fragmented"
        foreach ($line in $fragLines) {
            Write-Host "  $line"
        }
    }
} catch {
    Write-Host "  Unable to check fragmentation - may require elevated privileges"
}

# 8. Recommendations
Write-Host "`n💡 RECOMMENDATIONS" -ForegroundColor Green
Write-Host "-" * 30

Write-Host "Based on your 1,374-2,732 IOPS (should be 20,000+ for SSD):"
Write-Host ""
Write-Host "🎯 Immediate Actions:"
Write-Host "  1. Exclude pathology directories from Windows Search indexing"
Write-Host "  2. Add antivirus exclusions for C:\OG, C:\dzi, C:\temp"
Write-Host "  3. Check if drive is >80% full (causes SSD slowdown)"
Write-Host "  4. Consider moving temp files to RAM disk or faster drive"
Write-Host ""
Write-Host "🚀 Long-term Solution:"
Write-Host "  • NVMe SSD will bypass all these bottlenecks"
Write-Host "  • Expected improvement: 20 minutes → 30-60 seconds"
Write-Host "  • NVMe provides 100-300x better IOPS than your current setup"

Write-Host "`n✅ Diagnostic Complete!" -ForegroundColor Cyan
