Add-Type -AssemblyName System.Drawing
$srcPath = "c:\Users\Kracher.Krach\Documents\Jdownloader rebirth\assets\icon.png"
$srcBmp = [System.Drawing.Bitmap]::FromFile($srcPath)
$sizes = @(16, 32, 48, 128)

foreach ($s in $sizes) {
    $dest = New-Object System.Drawing.Bitmap $s, $s
    $g = [System.Drawing.Graphics]::FromImage($dest)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.DrawImage($srcBmp, 0, 0, $s, $s)
    $g.Dispose()
    $outPath = "c:\Users\Kracher.Krach\Documents\Jdownloader rebirth\extension\icons\icon$s.png"
    $dest.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $dest.Dispose()
    Write-Host "Generated $outPath successfully ($s x $s)"
}

$srcBmp.Dispose()
Write-Host "All extension icons updated successfully!"
