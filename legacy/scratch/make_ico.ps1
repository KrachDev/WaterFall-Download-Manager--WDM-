Add-Type -AssemblyName System.Drawing
$pngPath = "c:\Users\Kracher.Krach\Documents\Jdownloader rebirth\assets\icon.png"
$icoPath = "c:\Users\Kracher.Krach\Documents\Jdownloader rebirth\assets\icon.ico"
$bmp = [System.Drawing.Bitmap]::FromFile($pngPath)
$thumb = New-Object System.Drawing.Bitmap($bmp, (New-Object System.Drawing.Size(256, 256)))
$hIcon = $thumb.GetHicon()
$icon = [System.Drawing.Icon]::FromHandle($hIcon)
$fs = New-Object System.IO.FileStream($icoPath, [System.IO.FileMode]::Create)
$icon.Save($fs)
$fs.Close()
$icon.Dispose()
$thumb.Dispose()
$bmp.Dispose()
Write-Output "ICO successfully saved to $icoPath"
