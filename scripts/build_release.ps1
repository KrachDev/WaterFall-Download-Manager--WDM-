# ==============================================================================
# 🌊 Waterfall Download Accelerator (WDM) v2.0 - Production Release Builder
# ==============================================================================
param (
    [string]$Version = "v2.0.1",
    [int]$BuildNumber = 0,
    [switch]$NoIncrement = $false,
    [switch]$SkipBuild = $false,
    [switch]$IncludeMediaBinaries = $true
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path "$PSScriptRoot\.."
Set-Location $root

if (Test-Path "C:\Program Files\Git\cmd") {
    $env:Path = "C:\Program Files\Git\cmd;$env:Path"
}

# 1. Resolve & Increment Build Number and Date
$buildNumFile = "$root\build_number.txt"
$currentBuild = 100
if (Test-Path $buildNumFile) {
    try {
        $fileVal = (Get-Content $buildNumFile -Raw).Trim()
        if ($fileVal -match '^\d+$') {
            $currentBuild = [int]$fileVal
        }
    } catch {}
}

if ($BuildNumber -gt 0) {
    $resolvedBuildNumber = $BuildNumber
} elseif (-not $NoIncrement) {
    $resolvedBuildNumber = $currentBuild + 1
    Set-Content -Path $buildNumFile -Value $resolvedBuildNumber -Encoding utf8
} else {
    $resolvedBuildNumber = $currentBuild
}

$buildDate = Get-Date -Format "yyyyMMdd"
$buildTimestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
$buildTag = "b$resolvedBuildNumber-$buildDate"
$fullVersionTag = "$Version-$buildTag"

Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "  🌊 WATERFALL DOWNLOAD ACCELERATOR - RELEASE PACKAGER           " -ForegroundColor Cyan
Write-Host "  Version:       $Version                                        " -ForegroundColor White
Write-Host "  Build Number:  $resolvedBuildNumber                            " -ForegroundColor White
Write-Host "  Build Date:    $buildDate ($buildTimestamp)                    " -ForegroundColor White
Write-Host "  Full Tag:      $fullVersionTag                                 " -ForegroundColor Green
Write-Host "=================================================================" -ForegroundColor Cyan

# 2. Environment Detection: Locate MSVC & Ninja
$vcvarsCandidates = @(
    "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat",
    "C:\Program Files\Microsoft Visual Studio\2022\Professional\VC\Auxiliary\Build\vcvars64.bat",
    "C:\Program Files\Microsoft Visual Studio\2022\Enterprise\VC\Auxiliary\Build\vcvars64.bat",
    "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat",
    "C:\Program Files (x86)\Microsoft Visual Studio\2019\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
)

$vcvarsPath = $null
foreach ($cand in $vcvarsCandidates) {
    if (Test-Path $cand) {
        $vcvarsPath = $cand
        break
    }
}

if (-not $vcvarsPath) {
    Write-Warning "Could not find standard vcvars64.bat path. Attempting to use ambient environment..."
} else {
    Write-Host "[Env] Visual Studio compiler found: $vcvarsPath" -ForegroundColor Green
}

# 3. Release Compilation
$buildDir = "$root\build-release"
$distDir = "$root\dist"
$stageDir = "$distDir\Waterfall-$fullVersionTag-windows-x64"

if (-not (Test-Path $distDir)) {
    New-Item -ItemType Directory -Path $distDir | Out-Null
}

$setupCmd = if ($vcvarsPath) { "call `"$vcvarsPath`" && " } else { "" }

if (-not $SkipBuild) {
    Write-Host "`n[Build] Configuring CMake in Release mode..." -ForegroundColor Yellow
    if (-not (Test-Path $buildDir)) {
        New-Item -ItemType Directory -Path $buildDir | Out-Null
    }

    $sourceOverrides = ""
    $buildDepsDir = "$root\build\_deps"
    if (Test-Path "$buildDepsDir\nlohmann_json-src") {
        $cleanPath = ($buildDepsDir + "\nlohmann_json-src").Replace('\', '/')
        $sourceOverrides += " -DFETCHCONTENT_SOURCE_DIR_NLOHMANN_JSON=`"$cleanPath`""
    }
    if (Test-Path "$buildDepsDir\httplib-src") {
        $cleanPath = ($buildDepsDir + "\httplib-src").Replace('\', '/')
        $sourceOverrides += " -DFETCHCONTENT_SOURCE_DIR_HTTPLIB=`"$cleanPath`""
    }
    if (Test-Path "$buildDepsDir\freetype-src") {
        $cleanPath = ($buildDepsDir + "\freetype-src").Replace('\', '/')
        $sourceOverrides += " -DFETCHCONTENT_SOURCE_DIR_FREETYPE=`"$cleanPath`""
    }
    if (Test-Path "$buildDepsDir\rmlui-src") {
        $cleanPath = ($buildDepsDir + "\rmlui-src").Replace('\', '/')
        $sourceOverrides += " -DFETCHCONTENT_SOURCE_DIR_RMLUI=`"$cleanPath`""
    }

    $cmakeCmd = "cmake -B `"$buildDir`" -G Ninja -DCMAKE_BUILD_TYPE=Release -DWATERFALL_BUILD_NUMBER=`"$resolvedBuildNumber`"$sourceOverrides"
    $ninjaCmd = "ninja -C `"$buildDir`" waterfall"

    Write-Host "[Build] Running: $cmakeCmd" -ForegroundColor Gray
    cmd /c "$setupCmd $cmakeCmd"
    if ($LASTEXITCODE -ne 0) {
        Write-Error "CMake configuration failed with exit code $LASTEXITCODE"
    }

    Write-Host "[Build] Compiling optimized release binary with Ninja..." -ForegroundColor Yellow
    cmd /c "$setupCmd $ninjaCmd"
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Compilation failed with exit code $LASTEXITCODE"
    }
}

$exeSource = "$buildDir\waterfall.exe"
if (-not (Test-Path $exeSource)) {
    # Fallback to standard build folder if build-release wasn't used
    if (Test-Path "$root\build\waterfall.exe") {
        $exeSource = "$root\build\waterfall.exe"
    } else {
        Write-Error "Cannot locate compiled waterfall.exe binary at: $exeSource"
    }
}

# 4. Assemble Release Staging Directory
Write-Host "`n[Package] Assembling release distribution structure: $stageDir" -ForegroundColor Yellow
if (Test-Path $stageDir) {
    Remove-Item -Recurse -Force $stageDir
}
New-Item -ItemType Directory -Path $stageDir | Out-Null

# Copy Primary Binary & WebView2 Loader
Copy-Item $exeSource "$stageDir\Waterfall.exe" -Force
$loaderDll = "$root\vendor\webview2\build\native\x64\WebView2Loader.dll"
if (Test-Path $loaderDll) {
    Copy-Item $loaderDll "$stageDir\WebView2Loader.dll" -Force
} elseif (Test-Path "$root\build\WebView2Loader.dll") {
    Copy-Item "$root\build\WebView2Loader.dll" "$stageDir\WebView2Loader.dll" -Force
}

# Copy Frontend Web Assets
Copy-Item -Recurse "$root\src\frontend" "$stageDir\frontend" -Force
Copy-Item -Recurse "$root\src\frontend" "$stageDir\src\frontend" -Force

# Copy Assets (UI icons, fonts, themes)
Copy-Item -Recurse "$root\assets" "$stageDir\assets" -Force

# Compile Application Resource for Installer/Uninstaller
$installerRc = "$root\src\installer\installer.rc"
$installerRes = "$distDir\installer.res"
if (Test-Path $installerRc) {
    cmd /c "$setupCmd rc.exe /fo `"$installerRes`" `"$installerRc`"" | Out-Null
}
$resArg = if (Test-Path $installerRes) { "`"$installerRes`"" } else { "" }

# Compile & Embed Standalone Uninstaller
Write-Host "[Installer] Compiling native Uninstaller binary..." -ForegroundColor Gray
$uninstallerSrc = "$root\src\installer\UninstallerMain.cpp"
if (Test-Path $uninstallerSrc) {
    cmd /c "$setupCmd cl.exe /std:c++20 /EHsc /O2 /MD /utf-8 `"$uninstallerSrc`" $resArg /Fe:`"$stageDir\Uninstall.exe`" /link user32.lib shell32.lib advapi32.lib ole32.lib dwmapi.lib /SUBSYSTEM:WINDOWS" | Out-Null
    if (Test-Path "$stageDir\Uninstall.exe") {
        Copy-Item "$stageDir\Uninstall.exe" "$distDir\Uninstall.exe" -Force
        # Clean up obj file
        Remove-Item "$root\UninstallerMain.obj" -Force -ErrorAction SilentlyContinue
    }
}

# Copy Optional Media Tools (yt-dlp, ffmpeg)
if ($IncludeMediaBinaries -and (Test-Path "$root\bin")) {
    Write-Host "[Package] Including media studio binaries (yt-dlp, ffmpeg)..." -ForegroundColor Gray
    New-Item -ItemType Directory -Path "$stageDir\bin" -Force | Out-Null
    Get-ChildItem "$root\bin" -Filter "*.exe" | ForEach-Object {
        Copy-Item $_.FullName "$stageDir\bin\$($_.Name)" -Force
    }
}

# Copy Docs & Licenses
if (Test-Path "$root\LICENSE") { Copy-Item "$root\LICENSE" "$stageDir\LICENSE" -Force }
if (Test-Path "$root\README.md") { Copy-Item "$root\README.md" "$stageDir\README.md" -Force }

# Generate Embedded BUILD_INFO.txt
$buildInfoContent = @"
=================================================================
  🌊 WATERFALL DOWNLOAD ACCELERATOR (WDM)
=================================================================
Application:      Waterfall Accelerator v2.0 (Native C++20 / WebView2)
Version:          $Version
Build Number:     $resolvedBuildNumber
Build Date:       $buildDate ($buildTimestamp)
Release Tag:      $fullVersionTag
Architecture:     Windows x64
Repository:       KrachDev/WaterFall-Download-Manager--WDM-
Distribution:     Waterfall-$fullVersionTag-windows-x64.zip
Installer:        Waterfall-Setup-$fullVersionTag.exe
Companion Ext:    Waterfall-Companion-Extension-$fullVersionTag.zip
=================================================================
"@
$buildInfoContent | Out-File -FilePath "$stageDir\BUILD_INFO.txt" -Encoding utf8

# Sanitize release bundle: Ensure zero user database, history, cache, or private logs are ever packaged
Get-ChildItem -Path $stageDir -Include "*.db*", "*.wal*", "*.shm*", "*.log", "downloads.json*", "config.json*" -Recurse -Force | Remove-Item -Force

# 5. Generate Production Release ZIP Archive
Write-Host "`n[Archive] Compressing production release bundle..." -ForegroundColor Yellow
$releaseZip = "$distDir\Waterfall-$fullVersionTag-windows-x64.zip"
if (Test-Path $releaseZip) { Remove-Item -Force $releaseZip }

# Use 7z if available for best compression, otherwise Compress-Archive
$sevenZip = "C:\Program Files\7-Zip\7z.exe"
if (Test-Path $sevenZip) {
    & "$sevenZip" a -tzip -mx=9 "$releaseZip" "$stageDir\*" | Out-Null
} else {
    Compress-Archive -Path "$stageDir\*" -DestinationPath $releaseZip -CompressionLevel Optimal
}

# Also create convenient latest aliases
$latestZip = "$distDir\Waterfall-latest-windows-x64.zip"
Copy-Item $releaseZip $latestZip -Force

# 6. Package Browser Companion Extension
$extZip = "$distDir\Waterfall-Companion-Extension-$fullVersionTag.zip"
if (Test-Path "$root\extension") {
    Write-Host "[Archive] Compressing Browser Companion Extension..." -ForegroundColor Yellow
    if (Test-Path $extZip) { Remove-Item -Force $extZip }
    if (Test-Path $sevenZip) {
        & "$sevenZip" a -tzip -mx=9 "$extZip" "$root\extension\*" | Out-Null
    } else {
        Compress-Archive -Path "$root\extension\*" -DestinationPath $extZip -CompressionLevel Optimal
    }
    Copy-Item $extZip "$distDir\Waterfall-Companion-Extension-latest.zip" -Force
}

# 7. Build Native Windows Setup Installer EXE
Write-Host "`n[Installer] Building standalone Windows Setup Installer (.exe)..." -ForegroundColor Yellow
$installerSrc = "$root\src\installer\InstallerMain.cpp"
$installerExe = "$distDir\Waterfall-Setup-$fullVersionTag.exe"
if (Test-Path $installerSrc) {
    cmd /c "$setupCmd cl.exe /std:c++20 /EHsc /O2 /MD /utf-8 `"$installerSrc`" $resArg /Fe:`"$installerExe`" /link user32.lib shell32.lib advapi32.lib ole32.lib comctl32.lib dwmapi.lib gdi32.lib /SUBSYSTEM:WINDOWS" | Out-Null
    if (Test-Path $installerExe) {
        $latestInstaller = "$distDir\Waterfall-Setup.exe"
        Copy-Item $installerExe $latestInstaller -Force
        Remove-Item "$root\InstallerMain.obj" -Force -ErrorAction SilentlyContinue
        Remove-Item $installerRes -Force -ErrorAction SilentlyContinue
        Write-Host "  [Installer] Built: $installerExe" -ForegroundColor Green
    }
}

# 8. Compile Inno Setup Script if ISCC compiler is installed
$isccCandidates = @(
    "C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
    "C:\Program Files\Inno Setup 6\ISCC.exe"
)
foreach ($iscc in $isccCandidates) {
    if (Test-Path $iscc) {
        Write-Host "[Installer] Compiling Inno Setup installer..." -ForegroundColor Yellow
        & $iscc "$root\installer\waterfall.iss" | Out-Null
        break
    }
}

# 9. Generate Hardware SHA-256 Checksums
Write-Host "`n[Integrity] Calculating hardware SHA-256 checksums..." -ForegroundColor Yellow
$checksumFile = "$distDir\SHA256SUMS.txt"
$hashes = @()
Get-ChildItem $distDir -Include "*.zip", "*.exe" -Recurse | ForEach-Object {
    if ($_.DirectoryName -eq $distDir) {
        $h = Get-FileHash -Path $_.FullName -Algorithm SHA256
        $line = "$($h.Hash.ToLower())  $($_.Name)"
        $hashes += $line
    }
}
$hashes | Out-File -FilePath $checksumFile -Encoding utf8

# 10. Release Summary
$zipSizeMb = [math]::Round((Get-Item $releaseZip).Length / 1MB, 2)
Write-Host "`n=================================================================" -ForegroundColor Green
Write-Host "  ✨ PRODUCTION RELEASE PACKAGE READY FOR GITHUB PUBLISH!        " -ForegroundColor Green
Write-Host "=================================================================" -ForegroundColor Green
Write-Host "  Release Tag:      $fullVersionTag" -ForegroundColor White
Write-Host "  Build Number:     $resolvedBuildNumber (Auto-Incremented)" -ForegroundColor White
Write-Host "  Build Date:       $buildDate" -ForegroundColor White
Write-Host "  Installer EXE:    $installerExe" -ForegroundColor Cyan
Write-Host "  Distribution ZIP: $releaseZip ($zipSizeMb MB)" -ForegroundColor White
if (Test-Path $extZip) {
    $extSizeKb = [math]::Round((Get-Item $extZip).Length / 1KB, 1)
    Write-Host "  Extension ZIP:    $extZip ($extSizeKb KB)" -ForegroundColor White
}
Write-Host "  Latest Aliases:   Waterfall-latest-windows-x64.zip, Waterfall-Setup.exe" -ForegroundColor White
Write-Host "  Checksums File:   $checksumFile" -ForegroundColor White
Write-Host "`nSHA-256 Hashes:" -ForegroundColor Cyan
Get-Content $checksumFile | ForEach-Object { Write-Host "  $_" -ForegroundColor Gray }
Write-Host "=================================================================" -ForegroundColor Green
