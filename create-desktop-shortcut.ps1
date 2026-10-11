$WScriptShell = New-Object -ComObject WScript.Shell
$DesktopPath = [System.Environment]::GetFolderPath([System.Environment+SpecialFolder]::Desktop)
$ShortcutPath = Join-Path $DesktopPath "Waterfall.lnk"

$ElectronExe = Join-Path $PSScriptRoot "node_modules\electron\dist\electron.exe"
$IconPath = Join-Path $PSScriptRoot "assets\icon.ico"

$Shortcut = $WScriptShell.CreateShortcut($ShortcutPath)
if (Test-Path $ElectronExe) {
    $Shortcut.TargetPath = $ElectronExe
    $Shortcut.Arguments = "."
} else {
    $Shortcut.TargetPath = Join-Path $PSScriptRoot "start.bat"
}
$Shortcut.WorkingDirectory = $PSScriptRoot
$Shortcut.Description = 'Waterfall - Modern IDM & JDownloader Suite'
if (Test-Path $IconPath) {
    $Shortcut.IconLocation = $IconPath
}
$Shortcut.Save()

Write-Host "Desktop shortcut created successfully at: $ShortcutPath" -ForegroundColor Green
