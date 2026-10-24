# Waterfall C++20 Backend Comprehensive Test Suite
Write-Host "=================================================" -ForegroundColor Cyan
Write-Host "  WATERFALL C++20 BACKEND VERIFICATION SUITE    " -ForegroundColor Cyan
Write-Host "=================================================" -ForegroundColor Cyan

$baseUrl = "http://127.0.0.1:4567"

# 1. Health check
Write-Host "`n[1/7] Testing Health Probe (/jdcheck.js)..." -ForegroundColor Yellow
try {
    $res = Invoke-RestMethod -Uri "$baseUrl/jdcheck.js" -Method GET
    Write-Host "  Response: $res" -ForegroundColor Green
} catch {
    Write-Host "  FAILED to connect to backend: $_" -ForegroundColor Red
    exit 1
}

# 2. Settings Test (GET & POST)
Write-Host "`n[2/7] Testing Settings API (/api/settings)..." -ForegroundColor Yellow
$cfg = Invoke-RestMethod -Uri "$baseUrl/api/settings" -Method GET
Write-Host "  Current config: MaxConcurrent=$($cfg.max_concurrent_downloads), SpeedLimiter=$($cfg.speed_limit_enabled)" -ForegroundColor Green

$updatePayload = @{
    max_concurrent_downloads = 4
    speed_limit_enabled = $false
    speed_limit_bps = 10485760
} | ConvertTo-Json

$resUpdate = Invoke-RestMethod -Uri "$baseUrl/api/settings" -Method POST -Body $updatePayload -ContentType "application/json"
Write-Host "  Updated settings: $($resUpdate.success)" -ForegroundColor Green

$cfgNew = Invoke-RestMethod -Uri "$baseUrl/api/settings" -Method GET
Write-Host "  Verified new config: MaxConcurrent=$($cfgNew.max_concurrent_downloads), LimiterBps=$($cfgNew.speed_limit_bps)" -ForegroundColor Green

# 3. Crawler Engine Test (/api/crawler/crawl)
Write-Host "`n[3/7] Testing Crawler Engine (/api/crawler/crawl)..." -ForegroundColor Yellow
$crawlPayload = @{
    text = @"
Check out these files:
[Ubuntu 22.04 ISO](https://releases.ubuntu.com/jammy/ubuntu-22.04.5-desktop-amd64.iso)
[url=https://speed.hetzner.de/100MB.bin]Hetzner 100MB[/url]
https://pixeldrain.com/u/sample123
"@
} | ConvertTo-Json

$crawlRes = Invoke-RestMethod -Uri "$baseUrl/api/crawler/crawl" -Method POST -Body $crawlPayload -ContentType "application/json"
Write-Host "  Discovered packages: $($crawlRes.packages.Count)" -ForegroundColor Green
foreach ($pkg in $crawlRes.packages) {
    Write-Host "    - Package '$($pkg.name)' (Hoster: $($pkg.hoster), Items: $($pkg.items.Count))" -ForegroundColor Gray
}

# 4. Download Execution & In-Place Write (10MB payload)
Write-Host "`n[4/7] Testing Multi-Segment Download (/api/downloads)..." -ForegroundColor Yellow
$dlPayload = @{
    url = "https://proof.ovh.net/files/10Mb.dat"
    filename = "test_backend_suite_10mb.dat"
} | ConvertTo-Json

$addRes = Invoke-RestMethod -Uri "$baseUrl/api/downloads" -Method POST -Body $dlPayload -ContentType "application/json"
$taskId = $addRes.id
Write-Host "  Added Task ID: $taskId" -ForegroundColor Green

# Monitor progress until completed
$maxWait = 30
$elapsed = 0
$done = $false
while ($elapsed -lt $maxWait) {
    Start-Sleep -Seconds 1
    $elapsed++
    $tasks = Invoke-RestMethod -Uri "$baseUrl/api/downloads" -Method GET
    $cur = $tasks | Where-Object { $_.id -eq $taskId }
    if ($cur) {
        Write-Host "  Progress: $($cur.progress_percent)% | Speed: $($cur.speed_formatted) | Status: $($cur.status)" -ForegroundColor Gray
        if ($cur.status -eq "Completed") {
            $done = $true
            Write-Host "  Download completed in $elapsed seconds!" -ForegroundColor Green
            break
        }
    }
}

if (-not $done) {
    Write-Host "  Task did not complete within $maxWait seconds." -ForegroundColor Red
} else {
    $outPath = "$([Environment]::GetFolderPath('UserProfile'))\Downloads\test_backend_suite_10mb.dat"
    if (Test-Path $outPath) {
        $len = (Get-Item $outPath).Length
        Write-Host "  Verified file on disk: $outPath ($len bytes)" -ForegroundColor Green
    }
}

# 5. FlashGot Batch Ingestion Test (/flashgot)
Write-Host "`n[5/7] Testing FlashGot Batch Ingestion (/flashgot)..." -ForegroundColor Yellow
$flashUrls = "https://speed.hetzner.de/100MB.bin`nhttps://proof.ovh.net/files/1Mb.dat"
$flashRes = Invoke-RestMethod -Uri "$baseUrl/flashgot" -Method POST -Body $flashUrls -ContentType "text/plain"
Write-Host "  FlashGot added: $($flashRes.added) tasks" -ForegroundColor Green

# 6. Pause All & Resume All & Queue Reordering
Write-Host "`n[6/7] Testing Queue Control (Pause-All, Resume-All, Clear-Completed)..." -ForegroundColor Yellow
$pauseRes = Invoke-RestMethod -Uri "$baseUrl/api/downloads/pause-all" -Method POST
Write-Host "  Pause-All: $($pauseRes.success)" -ForegroundColor Green

Start-Sleep -Milliseconds 500

$resumeRes = Invoke-RestMethod -Uri "$baseUrl/api/downloads/resume-all" -Method POST
Write-Host "  Resume-All: $($resumeRes.success)" -ForegroundColor Green

Start-Sleep -Milliseconds 500

$clearRes = Invoke-RestMethod -Uri "$baseUrl/api/downloads/clear-completed" -Method POST
Write-Host "  Clear-Completed: $($clearRes.success)" -ForegroundColor Green

# 7. Media Probe Test (/api/media/probe)
Write-Host "`n[7/7] Testing Media Probe (yt-dlp integration)..." -ForegroundColor Yellow
$mediaPayload = @{
    url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
} | ConvertTo-Json

try {
    $mediaRes = Invoke-RestMethod -Uri "$baseUrl/api/media/probe" -Method POST -Body $mediaPayload -ContentType "application/json"
    if ($mediaRes.success) {
        Write-Host "  Media Title: '$($mediaRes.title)'" -ForegroundColor Green
        Write-Host "  Author/Artist: '$($mediaRes.uploader)'" -ForegroundColor Green
        Write-Host "  Duration: '$($mediaRes.duration)'" -ForegroundColor Green
        Write-Host "  Available Formats: $($mediaRes.formats.Count)" -ForegroundColor Green
    } else {
        Write-Host "  Media probe returned success=false (network or yt-dlp warning)" -ForegroundColor Yellow
    }
} catch {
    Write-Host "  Media probe request failed: $_" -ForegroundColor Yellow
}

Write-Host "`n=================================================" -ForegroundColor Cyan
Write-Host "  BACKEND VERIFICATION SUITE COMPLETE!           " -ForegroundColor Cyan
Write-Host "=================================================" -ForegroundColor Cyan
