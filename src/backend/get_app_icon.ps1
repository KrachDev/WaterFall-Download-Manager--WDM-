param(
    [string]$filePath,
    [string]$extension
)

Add-Type -AssemblyName System.Drawing

function Clean-ExePath([string]$raw) {
    if (-not $raw) { return $null }
    $expanded = [System.Environment]::ExpandEnvironmentVariables($raw.Trim())
    if ($expanded -match '"([^"]+\.exe)"') { return $matches[1] }
    if ($expanded -match '^([^\s,"]+\.exe)') { return $matches[1] }
    if ($expanded -match '([A-Za-z]:\\[^",\s]+\.exe)') { return $matches[1] }
    return $null
}

function Get-ExtensionInfo([string]$targetPath, [string]$ext) {
    if (-not $ext -and $targetPath) {
        $ext = [System.IO.Path]::GetExtension($targetPath)
    }
    if ($ext -and -not $ext.StartsWith('.')) {
        $ext = '.' + $ext
    }
    $ext = if ($ext) { $ext.ToLowerInvariant() } else { '' }

    $appName = ""
    $appExe = ""
    $iconBitmap = $null

    # 1. Check HKCU UserChoice
    if ($ext) {
        try {
            $progId = $null
            $ucPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\$ext\UserChoice"
            if (Test-Path $ucPath) {
                $progId = (Get-ItemProperty $ucPath -ErrorAction SilentlyContinue).ProgId
            }

            if (-not $progId) {
                $hkcrExt = "Registry::HKEY_CLASSES_ROOT\$ext"
                if (Test-Path $hkcrExt) {
                    $progId = (Get-ItemProperty $hkcrExt -ErrorAction SilentlyContinue).'(default)'
                }
            }

            # Fallback to assoc command
            if (-not $progId) {
                $assocOut = cmd /c "assoc $ext" 2>$null
                if ($assocOut -match '=(.+)$') {
                    $progId = $matches[1].Trim()
                }
            }

            if ($progId) {
                # Get friendly name from ProgId
                $progFriendly = (Get-ItemProperty "Registry::HKEY_CLASSES_ROOT\$progId" -ErrorAction SilentlyContinue).'(default)'
                if ($progFriendly) { $appName = $progFriendly }

                $cmdPath = "Registry::HKEY_CLASSES_ROOT\$progId\shell\open\command"
                if (Test-Path $cmdPath) {
                    $raw = (Get-ItemProperty $cmdPath -ErrorAction SilentlyContinue).'(default)'
                    $appExe = Clean-ExePath $raw
                }

                if (-not $appExe) {
                    $ftypeOut = cmd /c "ftype $progId" 2>$null
                    if ($ftypeOut -match '=(.+)$') {
                        $appExe = Clean-ExePath $matches[1]
                    }
                }
            }
        } catch {}
    }

    # 2. Extract icon from handler executable if valid
    if ($appExe -and (Test-Path $appExe)) {
        try {
            $desc = (Get-Item $appExe).VersionInfo.FileDescription
            if ($desc) { $appName = $desc }
            elseif (-not $appName) { $appName = [System.IO.Path]::GetFileNameWithoutExtension($appExe) }

            $icon = [System.Drawing.Icon]::ExtractAssociatedIcon($appExe)
            if ($icon) {
                $iconBitmap = $icon.ToBitmap()
                $icon.Dispose()
            }
        } catch {}
    }

    # 3. Fallback: extract icon from targetPath or a temp dummy file with that extension
    if (-not $iconBitmap) {
        $pathToProbe = $targetPath
        $tempFile = $null

        if (-not $pathToProbe -or -not (Test-Path $pathToProbe)) {
            if ($ext) {
                $tempFile = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), "waterfall_probe_$([Guid]::NewGuid().ToString('N'))$ext")
                [System.IO.File]::WriteAllBytes($tempFile, @())
                $pathToProbe = $tempFile
            }
        }

        if ($pathToProbe -and (Test-Path $pathToProbe)) {
            try {
                $icon = [System.Drawing.Icon]::ExtractAssociatedIcon($pathToProbe)
                if ($icon) {
                    $iconBitmap = $icon.ToBitmap()
                    $icon.Dispose()
                }
            } catch {}
        }

        if ($tempFile -and (Test-Path $tempFile)) {
            Remove-Item $tempFile -Force -ErrorAction SilentlyContinue
        }
    }

    # Friendly application name fallback
    if (-not $appName -or $appName -eq $ext) {
        switch ($ext) {
            { $_ -in '.mp3','.flac','.wav','.m4a','.aac','.ogg' } { $appName = "Windows Media Player" }
            { $_ -in '.mp4','.mkv','.avi','.webm','.mov' }       { $appName = "Windows Media Player" }
            { $_ -in '.zip','.rar','.7z','.tar','.gz' }          { $appName = "Windows Explorer" }
            { $_ -in '.pdf' }                                   { $appName = "PDF Reader" }
            { $_ -in '.jpg','.jpeg','.png','.webp','.gif' }      { $appName = "Photos" }
            { $_ -in '.exe','.msi' }                            { $appName = "Windows Application" }
            { $_ -in '.txt','.log' }                            { $appName = "Notepad" }
            default                                             { $appName = "Default Application" }
        }
    }

    $iconBase64 = ""
    if ($iconBitmap) {
        $ms = New-Object System.IO.MemoryStream
        $iconBitmap.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
        $iconBase64 = "data:image/png;base64," + [System.Convert]::ToBase64String($ms.ToArray())
        $ms.Dispose()
        $iconBitmap.Dispose()
    }

    $result = [PSCustomObject]@{
        extension = $ext
        appName   = $appName
        appExe    = $appExe
        icon      = $iconBase64
    }

    return ($result | ConvertTo-Json -Compress)
}

Get-ExtensionInfo $filePath $extension
