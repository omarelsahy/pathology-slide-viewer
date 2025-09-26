@echo off
echo INITIALIZE DISK 1 FOR PERFORMANCE TESTING
echo This will set up the unused SSD for testing
echo.

echo STEP 1: Initialize Disk 1 in Disk Management
echo 1. Right-click on "Disk 1" (the unallocated one)
echo 2. Select "Initialize Disk"
echo 3. Choose GPT partition style (recommended for modern systems)
echo 4. Click OK
echo.

echo STEP 2: Create New Volume
echo 1. Right-click on the unallocated space on Disk 1
echo 2. Select "New Simple Volume..."
echo 3. Follow wizard (use full capacity)
echo 4. Assign drive letter (e.g., E:)
echo 5. Format as NTFS
echo 6. Complete the wizard
echo.

echo STEP 3: Test Performance
echo After initialization, run:
echo   node test-disk1-performance.js
echo.

echo EXPECTED RESULTS:
echo - If Disk 1 is faster: Move pathology processing there
echo - If same speed: SATA controller is the bottleneck
echo - Target: Test if you can get better than 794 IOPS
echo.

echo ALTERNATIVE: Use PowerShell to initialize
echo Run as Administrator:
echo   Initialize-Disk -Number 1 -PartitionStyle GPT
echo   New-Partition -DiskNumber 1 -UseMaximumSize -AssignDriveLetter
echo   Format-Volume -DriveLetter E -FileSystem NTFS -NewFileSystemLabel "TestDisk"
echo.

pause
