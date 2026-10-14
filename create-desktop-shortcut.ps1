$WScriptShell = New-Object -ComObject WScript.Shell
$DesktopPath = [System.Environment]::GetFolderPath([System.Environment+SpecialFolder]::Desktop)
$ShortcutPath = Join-Path $DesktopPath "Waterfall.lnk"

$DistExe = Join-Path $PSScriptRoot "dist\Waterfall-win32-x64\Waterfall.exe"
$ElectronExe = Join-Path $PSScriptRoot "node_modules\electron\dist\electron.exe"
$IconPath = Join-Path $PSScriptRoot "assets\icon.ico"

$Shortcut = $WScriptShell.CreateShortcut($ShortcutPath)
if (Test-Path $DistExe) {
    $Shortcut.TargetPath = $DistExe
    $Shortcut.WorkingDirectory = Join-Path $PSScriptRoot "dist\Waterfall-win32-x64"
    $Shortcut.Arguments = ""
    if (Test-Path $IconPath) {
        $Shortcut.IconLocation = "$IconPath,0"
    } else {
        $Shortcut.IconLocation = "$DistExe,0"
    }
} elseif (Test-Path $ElectronExe) {
    $Shortcut.TargetPath = $ElectronExe
    $Shortcut.Arguments = "."
    $Shortcut.WorkingDirectory = $PSScriptRoot
    if (Test-Path $IconPath) {
        $Shortcut.IconLocation = "$IconPath,0"
    }
} else {
    $Shortcut.TargetPath = Join-Path $PSScriptRoot "start.bat"
    $Shortcut.WorkingDirectory = $PSScriptRoot
    if (Test-Path $IconPath) {
        $Shortcut.IconLocation = "$IconPath,0"
    }
}

$Shortcut.Description = 'Waterfall - Modern IDM & JDownloader Suite'
$Shortcut.Save()

Write-Host "Desktop shortcut created successfully at: $ShortcutPath" -ForegroundColor Green
