Add-Type -AssemblyName System.Drawing

$srcPath = "C:\Users\Kracher.Krach\.gemini\antigravity-ide\brain\62d53ce7-7da1-4c92-99ea-183108aa2196\waterfall_round_icon_1791973407256.jpg"
$img = [System.Drawing.Bitmap]::FromFile($srcPath)
Write-Host "Width: $($img.Width) Height: $($img.Height)"
Write-Host "Corner (0,0): $($img.GetPixel(0,0))"
Write-Host "Center (512,512): $($img.GetPixel(512,512))"

# Sample along axes
Write-Host "Horizontal line (x from 0 to 40, y=512):"
for ($x = 0; $x -le 40; $x += 4) {
    Write-Host "  x=$x : $($img.GetPixel($x, 512))"
}
Write-Host "Diagonal line (x=y from 0 to 200):"
for ($d = 145; $d -le 155; $d++) {
    Write-Host "d=$d : $($img.GetPixel($d, $d))"
}
$img.Dispose()


