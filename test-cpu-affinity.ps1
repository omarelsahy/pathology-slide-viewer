# Test CPU Affinity for I/O Performance
# Tests if switching to different CPU improves I/O performance

Write-Host "=== CPU AFFINITY I/O TEST ===" -ForegroundColor Cyan
Write-Host "Testing I/O performance on different CPUs" -ForegroundColor Yellow
Write-Host ""

# Get system info
$cpuInfo = Get-WmiObject -Class Win32_Processor
Write-Host "System Configuration:" -ForegroundColor Green
Write-Host "  CPUs: $($cpuInfo.Count)" -ForegroundColor White
Write-Host "  Cores per CPU: $($cpuInfo[0].NumberOfCores)" -ForegroundColor White
Write-Host "  Logical Processors: $($cpuInfo[0].NumberOfLogicalProcessors * $cpuInfo.Count)" -ForegroundColor White
Write-Host ""

# Simple CPU affinity test for conversion server
Write-Host "=== CONVERSION SERVER CPU AFFINITY TEST ===" -ForegroundColor Green
Write-Host ""

Write-Host "Current Node.js processes:" -ForegroundColor Yellow
$nodeProcesses = Get-Process -Name "node" -ErrorAction SilentlyContinue
if ($nodeProcesses) {
    foreach ($proc in $nodeProcesses) {
        Write-Host "  PID $($proc.Id): Affinity = 0x$($proc.ProcessorAffinity.ToString('X'))" -ForegroundColor White
    }
} else {
    Write-Host "  No Node.js processes found" -ForegroundColor Red
}

Write-Host ""
Write-Host "=== CPU SOCKET RECOMMENDATIONS ===" -ForegroundColor Cyan
Write-Host ""

Write-Host "Your dual CPU system options:" -ForegroundColor Yellow
Write-Host "  Option 1: Use CPU Socket 0 (cores 0-27)" -ForegroundColor White
Write-Host "    Affinity Mask: 0x0FFFFFFF" -ForegroundColor Gray
Write-Host ""
Write-Host "  Option 2: Use CPU Socket 1 (cores 28-55)" -ForegroundColor White  
Write-Host "    Affinity Mask: 0xF0000000" -ForegroundColor Gray
Write-Host ""

Write-Host "To test CPU Socket 0 for conversion server:" -ForegroundColor Green
Write-Host "  1. Stop current conversion server" -ForegroundColor White
Write-Host "  2. Run: Start-Process -FilePath 'node' -ArgumentList 'conversion-server.js' -PassThru | % { `$_.ProcessorAffinity = [System.IntPtr]0x0FFFFFFF }" -ForegroundColor Gray
Write-Host ""

Write-Host "To test CPU Socket 1 for conversion server:" -ForegroundColor Green
Write-Host "  1. Stop current conversion server" -ForegroundColor White
Write-Host "  2. Run: Start-Process -FilePath 'node' -ArgumentList 'conversion-server.js' -PassThru | % { `$_.ProcessorAffinity = [System.IntPtr]0xF0000000 }" -ForegroundColor Gray
Write-Host ""

Write-Host "=== WHY THIS MIGHT HELP ===" -ForegroundColor Cyan
Write-Host "• Different CPU sockets may have different I/O paths" -ForegroundColor Yellow
Write-Host "• NUMA topology: Each CPU closer to certain PCIe slots" -ForegroundColor Yellow
Write-Host "• One CPU might have better SATA controller connection" -ForegroundColor Yellow
Write-Host "• Reduce contention if other processes use different CPU" -ForegroundColor Yellow
Write-Host ""

Write-Host "Test both configurations and monitor:" -ForegroundColor Green
Write-Host "  • Conversion time improvement" -ForegroundColor White
Write-Host "  • CPU usage distribution" -ForegroundColor White
Write-Host "  • Thread wait states" -ForegroundColor White
