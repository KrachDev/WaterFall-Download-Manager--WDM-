# ==============================================================================
# 🌊 Waterfall Download Accelerator — PowerShell One-Click Installer
# ==============================================================================
param (
    [string]$InstallPath = "$env:LOCALAPPDATA\Programs\Waterfall",
    [switch]$NoDesktopShortcut = $false,
    [switch]$NoStartMenuShortcut = $false,
    [switch]$Launch = $true
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path "$PSScriptRoot\.."

Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "  🌊 WATERFALL DOWNLOAD ACCELERATOR — INSTALLER                  " -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "Target Directory: $InstallPath" -ForegroundColor White

# 1. Stop any running instances
Get-Process "waterfall" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

# 2. Locate release zip or build folder
$sourceZip = Get-ChildItem "$root\dist" -Filter "Waterfall-*.zip" | Where-Object { $_.Name -notlike "*Extension*" -and $_.Name -like "*b*-*" } | Select-Object -First 1
if (-not $sourceZip) {
    $sourceZip = Get-ChildItem "$root\dist" -Filter "Waterfall-*.zip" | Where-Object { $_.Name -notlike "*Extension*" } | Select-Object -First 1
}

# 3. Create install dir
if (-not (Test-Path $InstallPath)) {
    New-Item -ItemType Directory -Path $InstallPath -Force | Out-Null
}

if ($sourceZip) {
    Write-Host "[Install] Extracting package: $($sourceZip.Name)..." -ForegroundColor Yellow
    Expand-Archive -Path $sourceZip.FullName -DestinationPath $InstallPath -Force
} else {
    Write-Host "[Install] Copying files from build directory..." -ForegroundColor Yellow
    Copy-Item "$root\build\Waterfall.exe" "$InstallPath\Waterfall.exe" -Force
    if (Test-Path "$root\build\WebView2Loader.dll") {
        Copy-Item "$root\build\WebView2Loader.dll" "$InstallPath\WebView2Loader.dll" -Force
    }
    Copy-Item -Recurse "$root\src\frontend" "$InstallPath\frontend" -Force
    Copy-Item -Recurse "$root\assets" "$InstallPath\assets" -Force
}

# Handle nested directory if any
$nested = Get-ChildItem -Path $InstallPath -Directory | Where-Object { Test-Path "$($_.FullName)\Waterfall.exe" } | Select-Object -First 1
if ($nested) {
    Get-ChildItem -Path $nested.FullName | ForEach-Object {
        Move-Item $_.FullName $InstallPath -Force
    }
    Remove-Item $nested.FullName -Force -Recurse
}

# 4. Copy Uninstaller if present
if (Test-Path "$root\dist\Uninstall.exe") {
    Copy-Item "$root\dist\Uninstall.exe" "$InstallPath\Uninstall.exe" -Force
}

# 5. Create Shortcuts
$wsh = New-Object -ComObject WScript.Shell
$mainExe = "$InstallPath\Waterfall.exe"

if (-not $NoDesktopShortcut) {
    $desktopPath = [Environment]::GetFolderPath("Desktop")
    $shortcut = $wsh.CreateShortcut("$desktopPath\Waterfall Accelerator.lnk")
    $shortcut.TargetPath = $mainExe
    $shortcut.Description = "Waterfall High-Speed Download Accelerator"
    $shortcut.IconLocation = "$mainExe,0"
    $shortcut.Save()
    Write-Host "[Install] Created Desktop shortcut." -ForegroundColor Green
}

if (-not $NoStartMenuShortcut) {
    $programsPath = [Environment]::GetFolderPath("Programs")
    $shortcut = $wsh.CreateShortcut("$programsPath\Waterfall Accelerator.lnk")
    $shortcut.TargetPath = $mainExe
    $shortcut.Description = "Waterfall High-Speed Download Accelerator"
    $shortcut.IconLocation = "$mainExe,0"
    $shortcut.Save()
    Write-Host "[Install] Created Start Menu shortcut." -ForegroundColor Green
}

# 6. Register in Windows Add/Remove Programs
$uninstallKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\WaterfallAccelerator"
if (-not (Test-Path $uninstallKey)) {
    New-Item -Path $uninstallKey -Force | Out-Null
}
Set-ItemProperty -Path $uninstallKey -Name "DisplayName" -Value "Waterfall Download Accelerator"
Set-ItemProperty -Path $uninstallKey -Name "DisplayVersion" -Value "2.0.1"
Set-ItemProperty -Path $uninstallKey -Name "Publisher" -Value "KrachDev"
Set-ItemProperty -Path $uninstallKey -Name "DisplayIcon" -Value "$mainExe,0"
Set-ItemProperty -Path $uninstallKey -Name "InstallLocation" -Value $InstallPath
Set-ItemProperty -Path $uninstallKey -Name "UninstallString" -Value "`"$InstallPath\Uninstall.exe`""
Set-ItemProperty -Path $uninstallKey -Name "URLInfoAbout" -Value "https://github.com/KrachDev/WaterFall-Download-Manager--WDM-"
Set-ItemProperty -Path $uninstallKey -Name "EstimatedSize" -Value 200000

Write-Host "`n[Success] Waterfall Accelerator has been installed successfully!" -ForegroundColor Green
Write-Host "Location: $InstallPath" -ForegroundColor White

if ($Launch -and (Test-Path $mainExe)) {
    Write-Host "[Launch] Starting Waterfall Accelerator..." -ForegroundColor Yellow
    Start-Process -FilePath $mainExe
}

