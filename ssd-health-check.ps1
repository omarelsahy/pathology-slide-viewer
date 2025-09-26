# Quick SSD Health Check
Write-Host "SSD Health Check" -ForegroundColor Cyan

# Check drive health
Get-PhysicalDisk | ForEach-Object {
    Write-Host "Drive: $($_.Model)" -ForegroundColor White
    Write-Host "  Health: $($_.HealthStatus)" -ForegroundColor $(if ($_.HealthStatus -eq "Healthy") { "Green" } else { "Red" })
    Write-Host "  Media Type: $($_.MediaType)"
    Write-Host "  Bus Type: $($_.BusType)"
}

# Check for RAID
Write-Host "`nRAID Status:" -ForegroundColor Yellow
$raidVolumes = Get-WmiObject -Class Win32_Volume | Where-Object {$_.DriveLetter -eq "C:"}
Write-Host "Block Size: $($raidVolumes.BlockSize) bytes"

# Performance test
Write-Host "`nQuick Performance:" -ForegroundColor Yellow
$perfCounters = Get-Counter "\PhysicalDisk(C:)\Current Disk Queue Length" -SampleInterval 1 -MaxSamples 3
$avgQueue = ($perfCounters.CounterSamples | Measure-Object CookedValue -Average).Average
Write-Host "Disk Queue Length: $([math]::Round($avgQueue, 2))"

if ($avgQueue -gt 2) {
    Write-Host "High queue length - disk bottleneck confirmed" -ForegroundColor Red
} else {
    Write-Host "Queue length normal" -ForegroundColor Green
}
