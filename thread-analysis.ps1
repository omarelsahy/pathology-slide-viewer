# Thread Analysis - Check what's blocking VIPS threads
Write-Host "=== THREAD ANALYSIS ===" -ForegroundColor Cyan
Write-Host "Analyzing why threads aren't using CPU" -ForegroundColor Yellow
Write-Host ""

# Get Node.js processes (likely VIPS/conversion server)
$nodeProcesses = Get-Process -Name "node" -ErrorAction SilentlyContinue

if ($nodeProcesses) {
    foreach ($proc in $nodeProcesses) {
        Write-Host "Node.js Process: $($proc.ProcessName) (PID: $($proc.Id))" -ForegroundColor Green
        Write-Host "  CPU Time: $($proc.TotalProcessorTime)"
        Write-Host "  Threads: $($proc.Threads.Count)"
        Write-Host "  Working Set: $([math]::Round($proc.WorkingSet64 / 1MB, 2)) MB"
        Write-Host "  Virtual Memory: $([math]::Round($proc.VirtualMemorySize64 / 1MB, 2)) MB"
        Write-Host ""
        
        # Check thread states
        $threadStates = $proc.Threads | Group-Object ThreadState | Sort-Object Count -Descending
        Write-Host "  Thread States:" -ForegroundColor Yellow
        foreach ($state in $threadStates) {
            Write-Host "    $($state.Name): $($state.Count) threads" -ForegroundColor White
        }
        Write-Host ""
    }
} else {
    Write-Host "No Node.js processes found" -ForegroundColor Red
}

# Check disk activity
Write-Host "=== DISK ACTIVITY ANALYSIS ===" -ForegroundColor Green
Write-Host "Checking if threads are waiting for I/O..." -ForegroundColor Yellow

try {
    $diskCounters = Get-Counter "\PhysicalDisk(*)\% Disk Time", "\PhysicalDisk(*)\Avg. Disk Queue Length" -SampleInterval 1 -MaxSamples 3 -ErrorAction SilentlyContinue
    
    foreach ($sample in $diskCounters) {
        foreach ($counter in $sample.CounterSamples) {
            $instanceName = ($counter.Path -split "\\")[2]
            $counterName = ($counter.Path -split "\\")[3]
            
            if ($instanceName -ne "_Total" -and $instanceName -notlike "*:*") {
                $value = [math]::Round($counter.CookedValue, 2)
                
                if ($counterName -eq "% Disk Time" -and $value -gt 50) {
                    Write-Host "  ⚠️  High disk usage on $instanceName`: $value%" -ForegroundColor Red
                    Write-Host "     Threads likely waiting for I/O operations" -ForegroundColor Yellow
                }
                
                if ($counterName -eq "Avg. Disk Queue Length" -and $value -gt 2) {
                    Write-Host "  ⚠️  High disk queue on $instanceName`: $value" -ForegroundColor Red
                    Write-Host "     I/O bottleneck detected - threads queued waiting for disk" -ForegroundColor Yellow
                }
            }
        }
    }
} catch {
    Write-Host "  Unable to get disk performance counters" -ForegroundColor Yellow
}

# Check memory usage
Write-Host ""
Write-Host "=== MEMORY ANALYSIS ===" -ForegroundColor Green
$memory = Get-WmiObject -Class Win32_OperatingSystem
$totalMemory = [math]::Round($memory.TotalVisibleMemorySize / 1MB, 2)
$freeMemory = [math]::Round($memory.FreePhysicalMemory / 1MB, 2)
$usedMemory = $totalMemory - $freeMemory
$memoryPercent = [math]::Round(($usedMemory / $totalMemory) * 100, 2)

Write-Host "Total Memory: $totalMemory GB" -ForegroundColor White
Write-Host "Used Memory: $usedMemory GB ($memoryPercent%)" -ForegroundColor $(if($memoryPercent -gt 80) {"Red"} else {"Green"})
Write-Host "Free Memory: $freeMemory GB" -ForegroundColor White

if ($memoryPercent -gt 90) {
    Write-Host "⚠️  High memory usage - threads may be waiting for memory" -ForegroundColor Red
}

Write-Host ""
Write-Host "=== BOTTLENECK ANALYSIS ===" -ForegroundColor Cyan
Write-Host ""

# Analyze the situation
Write-Host "Symptoms Analysis:" -ForegroundColor Yellow
Write-Host "  • 30+ threads created: ✅ Threading configuration working" -ForegroundColor Green
Write-Host "  • Only 8% CPU usage: ❌ Threads not doing CPU work" -ForegroundColor Red
Write-Host "  • This indicates: Threads are WAITING, not WORKING" -ForegroundColor Yellow

Write-Host ""
Write-Host "Most Likely Causes:" -ForegroundColor Yellow
Write-Host "  1. I/O Bottleneck: Threads waiting for slow SATA disk operations" -ForegroundColor White
Write-Host "  2. Memory Bandwidth: Threads waiting for memory access" -ForegroundColor White
Write-Host "  3. Sequential Operations: Some parts of VIPS can't be parallelized" -ForegroundColor White
Write-Host "  4. Lock Contention: Threads waiting for shared resources" -ForegroundColor White

Write-Host ""
Write-Host "=== RECOMMENDATIONS ===" -ForegroundColor Cyan
Write-Host "1. Monitor disk queue length during conversion" -ForegroundColor White
Write-Host "2. Try .v format (no compression) to reduce I/O overhead" -ForegroundColor White
Write-Host "3. Move temp directory to fastest available storage" -ForegroundColor White
Write-Host "4. Consider that some improvement is still happening (8 → 30+ threads)" -ForegroundColor White
