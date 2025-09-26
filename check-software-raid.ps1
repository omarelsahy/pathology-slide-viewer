# Check for Software RAID/Storage Spaces
# Since BIOS is AHCI, the mirroring must be software-based

Write-Host "Checking Software RAID Configuration" -ForegroundColor Cyan
Write-Host "BIOS is AHCI mode, so checking Windows-level mirroring..." -ForegroundColor White
Write-Host ("=" * 60) -ForegroundColor Gray

# Check Windows Storage Spaces
Write-Host "`nWindows Storage Spaces:" -ForegroundColor Yellow
try {
    $storagePools = Get-StoragePool
    foreach ($pool in $storagePools) {
        if ($pool.FriendlyName -ne "Primordial") {
            Write-Host "  Pool: $($pool.FriendlyName)" -ForegroundColor White
            Write-Host "    Health: $($pool.HealthStatus)" -ForegroundColor $(if ($pool.HealthStatus -eq "Healthy") { "Green" } else { "Red" })
            Write-Host "    Operational Status: $($pool.OperationalStatus)" -ForegroundColor White
            Write-Host "    Size: $([math]::Round($pool.Size / 1GB, 2)) GB" -ForegroundColor White
            
            # Get virtual disks in this pool
            $virtualDisks = Get-VirtualDisk -StoragePool $pool -ErrorAction SilentlyContinue
            foreach ($vdisk in $virtualDisks) {
                Write-Host "    Virtual Disk: $($vdisk.FriendlyName)" -ForegroundColor Cyan
                Write-Host "      Resiliency: $($vdisk.ResiliencySettingName)" -ForegroundColor White
                Write-Host "      Size: $([math]::Round($vdisk.Size / 1GB, 2)) GB" -ForegroundColor White
                
                if ($vdisk.ResiliencySettingName -eq "Mirror") {
                    Write-Host "      FOUND: This is your mirror causing 50% capacity loss!" -ForegroundColor Red
                }
            }
        }
    }
} catch {
    Write-Host "  No Storage Spaces found or error: $($_.Exception.Message)" -ForegroundColor Yellow
}

# Check for Dynamic Disks (Windows Software RAID)
Write-Host "`nDynamic Disk Configuration:" -ForegroundColor Yellow
try {
    $volumes = Get-WmiObject -Class Win32_Volume | Where-Object {$_.DriveLetter -eq "C:"}
    foreach ($vol in $volumes) {
        Write-Host "  C: Drive Details:" -ForegroundColor White
        Write-Host "    Capacity: $([math]::Round($vol.Capacity / 1GB, 2)) GB" -ForegroundColor White
        Write-Host "    File System: $($vol.FileSystem)" -ForegroundColor White
        Write-Host "    Boot Volume: $($vol.BootVolume)" -ForegroundColor White
    }
    
    # Check disk management info
    $disks = Get-Disk
    foreach ($disk in $disks) {
        Write-Host "`n  Disk $($disk.Number): $($disk.FriendlyName)" -ForegroundColor White
        Write-Host "    Partition Style: $($disk.PartitionStyle)" -ForegroundColor White
        Write-Host "    Operational Status: $($disk.OperationalStatus)" -ForegroundColor White
        Write-Host "    Size: $([math]::Round($disk.Size / 1GB, 2)) GB" -ForegroundColor White
        
        if ($disk.PartitionStyle -eq "MBR") {
            Write-Host "    Note: MBR disks can use Windows Software RAID" -ForegroundColor Yellow
        }
    }
} catch {
    Write-Host "  Error checking dynamic disks: $($_.Exception.Message)" -ForegroundColor Red
}

# Check for third-party RAID software
Write-Host "`nThird-Party RAID Software:" -ForegroundColor Yellow
$raidSoftware = @(
    "Intel Rapid Storage Technology",
    "AMD RAIDXpert",
    "NVIDIA RAID",
    "Adaptec RAID",
    "LSI MegaRAID"
)

foreach ($software in $raidSoftware) {
    $service = Get-Service -DisplayName "*$($software.Split(' ')[0])*" -ErrorAction SilentlyContinue
    if ($service) {
        Write-Host "  Found: $($service.DisplayName) - Status: $($service.Status)" -ForegroundColor White
    }
}

# Show how to disable software RAID
Write-Host "`nHow to Disable Software RAID:" -ForegroundColor Cyan
Write-Host "If Storage Spaces Mirror found:" -ForegroundColor White
Write-Host "  1. Open 'Manage Storage Spaces' in Control Panel" -ForegroundColor White
Write-Host "  2. Delete the mirrored virtual disk" -ForegroundColor White
Write-Host "  3. Remove drives from storage pool" -ForegroundColor White
Write-Host "  4. Use drives as separate volumes" -ForegroundColor White
Write-Host ""
Write-Host "If Dynamic Disk Mirror found:" -ForegroundColor White
Write-Host "  1. Open Disk Management (diskmgmt.msc)" -ForegroundColor White
Write-Host "  2. Break the mirror volume" -ForegroundColor White
Write-Host "  3. Convert back to basic disks" -ForegroundColor White
Write-Host ""
Write-Host "Expected Performance After Disable:" -ForegroundColor Green
Write-Host "  Current: 794 IOPS" -ForegroundColor Red
Write-Host "  Single SSD: 5,000-20,000 IOPS" -ForegroundColor Green
Write-Host "  Conversion time: 20+ min -> 2-5 min" -ForegroundColor Green
