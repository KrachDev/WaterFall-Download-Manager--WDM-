param(
    [Parameter(Mandatory=$true)][string]$targetPath,
    [Parameter(Mandatory=$true)][string]$outputPath
)

Add-Type -AssemblyName System.Drawing

try {
    if (-not (Test-Path $targetPath)) {
        exit 1
    }
    $icon = [System.Drawing.Icon]::ExtractAssociatedIcon($targetPath)
    if ($icon) {
        $bitmap = $icon.ToBitmap()
        $bitmap.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)
        $bitmap.Dispose()
        $icon.Dispose()
        exit 0
    }
} catch {
    exit 2
}
exit 1
