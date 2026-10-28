param (
    [string]$Tag = "v2.0.1-b104-20261028",
    [string]$Repo = "KrachDev/WaterFall-Download-Manager--WDM-"
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path "$PSScriptRoot\.."
$distDir = "$root\dist"

# 1. Retrieve GitHub Token
Write-Host "[Auth] Querying Git Credential Manager for GitHub OAuth token..." -ForegroundColor Yellow
$token = @"
protocol=https
host=github.com
"@ | & "C:\Program Files\Git\cmd\git.exe" credential fill | ForEach-Object {
    if ($_ -match '^password=(.*)$') { $matches[1] }
}

if (-not $token) {
    Write-Error "Could not retrieve GitHub authentication token."
}

$headers = @{
    "Authorization" = "Bearer $token"
    "Accept" = "application/vnd.github+json"
    "User-Agent" = "Waterfall-Release-Publisher"
}

# 2. Read Release Notes Body
$notesFile = "$distDir\RELEASE_NOTES.md"
$checksumFile = "$distDir\SHA256SUMS.txt"
$bodyText = if (Test-Path $notesFile) { Get-Content $notesFile -Raw -Encoding utf8 } else { "# Waterfall $Tag`n" }
if (Test-Path $checksumFile) {
    $cText = Get-Content $checksumFile -Raw -Encoding utf8
    $bodyText += "`n``````text`n" + $cText.Trim() + "`n```````n"
}

# 3. Create or Get GitHub Release
Write-Host "[Release] Creating GitHub release for tag '$Tag' on $Repo..." -ForegroundColor Yellow

$releaseData = @{
    tag_name = $Tag
    target_commitish = "cpp-rebuild"
    name = "Waterfall Accelerator v2.0.1 (Build 104)"
    body = $bodyText
    draft = $false
    prerelease = $false
} | ConvertTo-Json -Depth 5

$release = $null
try {
    $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases" -Method Post -Headers $headers -Body $releaseData -ContentType "application/json; charset=utf-8"
    Write-Host "[Release] Created release ID: $($release.id)" -ForegroundColor Green
} catch {
    Write-Warning "Direct release creation returned: $_. Attempting to fetch existing release by tag..."
    try {
        $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/tags/$Tag" -Method Get -Headers $headers
        Write-Host "[Release] Found existing release ID: $($release.id)" -ForegroundColor Green
    } catch {
        Write-Error "Failed to create or find release: $_"
    }
}

$releaseId = $release.id
$uploadBase = "https://uploads.github.com/repos/$Repo/releases/$releaseId/assets"

# 4. Upload Assets
$assetsToUpload = @(
    "$distDir\Waterfall-Setup-v2.0.1-b104-20261028.exe",
    "$distDir\Waterfall-Setup.exe",
    "$distDir\Waterfall-v2.0.1-b104-20261028-windows-x64.zip",
    "$distDir\Waterfall-latest-windows-x64.zip",
    "$distDir\Waterfall-Companion-Extension-v2.0.1-b104-20261028.zip",
    "$distDir\Waterfall-Companion-Extension-latest.zip",
    "$distDir\Uninstall.exe",
    "$distDir\SHA256SUMS.txt"
)

# Fetch existing assets to avoid duplicates
$existingAssets = @{}
try {
    $curAssets = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/$releaseId/assets" -Method Get -Headers $headers
    foreach ($a in $curAssets) {
        $existingAssets[$a.name] = $a.id
    }
} catch {}

foreach ($assetPath in $assetsToUpload) {
    if (-not (Test-Path $assetPath)) {
        Write-Warning "Asset not found: $assetPath"
        continue
    }

    $fileName = Split-Path $assetPath -Leaf
    $fileSizeMb = [math]::Round((Get-Item $assetPath).Length / 1MB, 2)
    Write-Host "`n[Upload] Uploading $fileName ($fileSizeMb MB)..." -ForegroundColor Cyan

    # If already exists, delete existing asset first
    if ($existingAssets.ContainsKey($fileName)) {
        $assetId = $existingAssets[$fileName]
        Write-Host "  [Upload] Deleting old asset ($assetId) for re-upload..." -ForegroundColor Gray
        try {
            Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/assets/$assetId" -Method Delete -Headers $headers | Out-Null
        } catch {}
    }

    $uploadUrl = "$uploadBase`?name=$fileName"
    $contentType = if ($fileName.EndsWith(".exe")) { "application/vnd.microsoft.portable-executable" }
                   elseif ($fileName.EndsWith(".zip")) { "application/zip" }
                   else { "text/plain" }

    $uploadHeaders = @{
        "Authorization" = "Bearer $token"
        "Accept" = "application/vnd.github+json"
        "Content-Type" = $contentType
        "User-Agent" = "Waterfall-Release-Publisher"
    }

    $uploadResponse = Invoke-RestMethod -Uri $uploadUrl -Method Post -Headers $uploadHeaders -InFile $assetPath
    Write-Host "  [Upload] Uploaded successfully: $($uploadResponse.browser_download_url)" -ForegroundColor Green
}

Write-Host "`n=================================================================" -ForegroundColor Green
Write-Host "  🎉 GITHUB RELEASE PUBLISHED SUCCESSFULLY!                      " -ForegroundColor Green
Write-Host "=================================================================" -ForegroundColor Green
Write-Host "  Release URL: $($release.html_url)" -ForegroundColor White
Write-Host "  Tag:         $Tag" -ForegroundColor White
Write-Host "=================================================================" -ForegroundColor Green
