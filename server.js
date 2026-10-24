process.on('uncaughtException', (err) => {
  console.error('[Waterfall Core] Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[Waterfall Core] Unhandled Rejection:', reason);
});

const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');
const path = require('path');
const { exec, execFile } = require('child_process');
const fs = require('fs');

const { getConfig, saveConfig } = require('./src/backend/config');
const downloadManager = require('./src/backend/downloadManager');
const { linkGrabber } = require('./src/backend/linkGrabber');
const { probeMedia, isMediaUrl } = require('./src/backend/mediaDownloader');
const { testRunScript } = require('./src/backend/scriptRunner');
const binaryResolver = require('./src/backend/binaryResolver');
const { createDummyFileBuffer, parseSizeString } = require('./src/backend/dummyFileGenerator');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ error: 'Invalid JSON payload' });
  }
  next(err);
});

function isLocalRequest(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // Direct non-browser request (Electron, desktop app, curl)
  try {
    const u = new URL(origin);
    const host = u.hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true;
    if (u.protocol === 'chrome-extension:' || u.protocol === 'moz-extension:') return true;
  } catch (_) {}
  return false;
}

function requireLocalOrigin(req, res, next) {
  if (!isLocalRequest(req)) {
    return res.status(403).json({ error: 'Access denied: local origin required' });
  }
  next();
}

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && isLocalRequest(req)) {
    res.header('Access-Control-Allow-Origin', origin);
  } else if (!origin) {
    res.header('Access-Control-Allow-Origin', '*');
  } else if (req.path === '/flashgot' || req.path === '/flash/add' || req.path === '/jdcheck.js' || req.path === '/crossdomain.xml') {
    // FlashGot / Click'n'Load compatibility allows cross-origin link addition from web download pages
    res.header('Access-Control-Allow-Origin', '*');
  }
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});
app.use(express.static(path.join(__dirname, 'src', 'frontend')));

// --- WebSocket Broadcast System ---
function broadcast(data) {
  const msg = JSON.stringify(data);
  for (const client of wss.clients) {
    if (client.readyState === 1) { // OPEN
      client.send(msg);
    }
  }
}

wss.on('connection', (ws) => {
  // Send initial snapshot
  ws.send(JSON.stringify({
    type: 'init',
    tasks: downloadManager.getAllTasks(),
    staged: linkGrabber.getStagedItems(),
    config: getConfig(),
    binaries: binaryResolver.getSystemBinariesStatus(),
    globalSpeed: downloadManager.globalSpeed,
    activeTasks: downloadManager.getActiveCount()
  }));
});

let wasIdle = false;

// Periodic tick broadcast (250ms) for high-framerate transfer speeds and segment bars
// PERFORMANCE & MEMORY OPTIMIZATION: Suppress redundant JSON serialization and WebSocket frames when idle
setInterval(() => {
  const activeCount = downloadManager.getActiveCount();
  const globalSpeed = downloadManager.globalSpeed || 0;

  if (activeCount === 0 && globalSpeed === 0) {
    if (!wasIdle) {
      wasIdle = true;
      broadcast({
        type: 'tick',
        globalSpeed: 0,
        activeTasks: 0,
        tasks: []
      });
    }
    return;
  }

  wasIdle = false;
  const activeList = downloadManager.getAllTasks().filter(t =>
    t.status === 'downloading' || t.status === 'assembling' || t.status === 'retrying' ||
    t.extractStatus === 'extracting' || t.extractStatus === 'extract_queued' || t.extractStatus === 'extract_password_required' || t.status === 'extracting'
  );
  const tasks = activeList.map(t => ({
    id: t.id,
    name: t.name,
    filename: t.filename,
    status: t.status,
    downloadedBytes: t.downloadedBytes,
    totalBytes: t.totalBytes,
    speed: t.speed,
    eta: t.eta,
    segments: t.segments || [],
    extractStatus: t.extractStatus || null,
    extractProgress: t.extractProgress !== undefined ? t.extractProgress : (t.extractStatus === 'extracted' ? 100 : 0),
    extractedPath: t.extractedPath || null,
    extractError: t.extractError || null,
    extractPasswordRequired: Boolean(t.extractPasswordRequired)
  }));

  broadcast({
    type: 'tick',
    globalSpeed,
    activeTasks: activeCount,
    tasks
  });
}, 250);

// Forward downloadManager events
downloadManager.on('taskCreated', task => broadcast({ type: 'taskCreated', task }));
downloadManager.on('taskUpdated', task => broadcast({ type: 'taskUpdated', task }));
downloadManager.on('taskCompleted', task => broadcast({ type: 'taskCompleted', task }));
downloadManager.on('taskFailed', data => broadcast({ type: 'taskFailed', task: data.task, error: data.error }));
downloadManager.on('taskDeleted', id => broadcast({ type: 'taskDeleted', id }));
downloadManager.on('extractPasswordRequired', data => broadcast({ type: 'extractPasswordRequired', data }));
downloadManager.on('queueReordered', queueOrder => broadcast({ type: 'queueReordered', queueOrder }));

// --- REST Endpoints ---

// Downloads
app.get('/api/downloads', (req, res) => {
  res.json(downloadManager.getAllTasks());
});

app.post('/api/save', (req, res) => {
  try {
    downloadManager.saveState(true);
    res.json({ success: true, count: downloadManager.getAllTasks().length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

let latestPendingConfirm = null;

app.get('/api/downloads/pending-confirm', (req, res) => {
  res.json(latestPendingConfirm || {});
});

app.post('/api/downloads/pending-confirm', (req, res) => {
  latestPendingConfirm = req.body;
  res.json({ ok: true });
});

app.post('/api/downloads', async (req, res) => {
  const {
    url, filename, size, saveDir, autoStart, packageName, isMedia, mediaOptions,
    downloadEngineMode, segments, singleStream, customScript, confirmed,
    archivePassword, autoExtract, deleteAfterExtract, priority,
    allowDuplicate, updateExistingId
  } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  // Explicit URL update request for existing task
  if (updateExistingId) {
    try {
      const task = downloadManager.updateTaskUrl(updateExistingId, url);
      if (task) {
        broadcast({ type: 'taskUpdated', task });
        return res.json({ updated: true, task });
      }
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  const config = getConfig();
  const shouldConfirm = !config.autoDownloadWithoutConfirmation && config.showDownloadConfirmation !== false;
  if (shouldConfirm && !confirmed) {
    try {
      const probeData = await downloadManager.probeUrl(url, { filename, packageName });
      if (filename) probeData.filename = filename;
      if (packageName) probeData.packageName = packageName;
      if (isMedia !== undefined) probeData.isMedia = isMedia;
      if (mediaOptions) probeData.mediaOptions = mediaOptions;

      latestPendingConfirm = probeData;

      // Broadcast event so UI brings window to front & opens IDM Download Confirmation
      broadcast({ type: 'showDownloadConfirmation', probeData });
      return res.json({ confirmationRequired: true, probeData });
    } catch (err) {
      console.warn('[Waterfall] Probe for confirmation failed, continuing with direct task creation:', err.message);
    }
  }

  latestPendingConfirm = null;

  const task = downloadManager.createTask({
    url,
    filename,
    size: size || 0,
    saveDir,
    packageName,
    isMedia,
    mediaOptions,
    downloadEngineMode,
    segments,
    singleStream,
    customScript,
    archivePassword,
    autoExtract,
    deleteAfterExtract,
    priority: priority || 'normal',
    allowDuplicate: Boolean(allowDuplicate),
    updateExistingId,
    autoStart: autoStart !== false
  });
  res.json(task);
});

// Import Completed Download (for client-side blob/data downloads or browser-finished items)
app.post('/api/downloads/import-completed', (req, res) => {
  try {
    const task = downloadManager.importCompletedDownload(req.body);
    broadcast({ type: 'taskCompleted', task });
    res.json({ success: true, task });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Stream exact dummy files with full HTTP Range resume support
app.get('/api/dummy-generator', (req, res) => {
  const format = (req.query.format || 'bin').toLowerCase().replace('.', '');
  const size = parseSizeString(req.query.size || '10mb');
  const filename = req.query.filename || `dummy_${req.query.size || '10mb'}.${format}`;

  let mimeType = 'application/octet-stream';
  if (format === 'zip') mimeType = 'application/zip';
  else if (format === 'pdf') mimeType = 'application/pdf';
  else if (format === 'csv') mimeType = 'text/csv';
  else if (format === 'json') mimeType = 'application/json';
  else if (format === 'txt') mimeType = 'text/plain';

  const range = req.headers.range;
  const fullBuf = createDummyFileBuffer(format, size);

  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : (size - 1);
    const chunksize = (end - start) + 1;

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': mimeType,
      'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`
    });

    res.end(fullBuf.subarray(start, end + 1));
  } else {
    res.writeHead(200, {
      'Content-Length': size,
      'Content-Type': mimeType,
      'Accept-Ranges': 'bytes',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`
    });
    res.end(fullBuf);
  }
});

// URL Probe & ETA Metadata for IDM Confirmation Window
app.post('/api/downloads/probe', async (req, res) => {
  const { url, filename, packageName } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  try {
    const info = await downloadManager.probeUrl(url, { filename, packageName });
    res.json(info);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Average speed of last 10 downloads
app.get('/api/downloads/avg-speed', (req, res) => {
  const stats = downloadManager.getRecentAverageSpeed(10);
  res.json(stats);
});

// Native folder browse fallback (for Web UI)
app.post('/api/browse-folder', requireLocalOrigin, (req, res) => {
  const cleanDefault = (req.body && typeof req.body.defaultPath === 'string') ? req.body.defaultPath : '';
  const psScript = `
    Add-Type -AssemblyName System.Windows.Forms;
    $f = New-Object System.Windows.Forms.FolderBrowserDialog;
    $f.Description = 'Select Download Location';
    $p = $env:WATERFALL_BROWSE_INIT;
    if ($p -and (Test-Path -LiteralPath $p)) { $f.SelectedPath = $p };
    if ($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $f.SelectedPath }
  `;
  execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psScript], {
    windowsHide: true,
    env: { ...process.env, WATERFALL_BROWSE_INIT: cleanDefault }
  }, (err, stdout) => {
    const folder = (stdout || '').trim();
    if (folder && fs.existsSync(folder)) {
      res.json({ success: true, folder });
    } else {
      res.json({ success: false });
    }
  });
});

// Watch as we download - HTTP 206 Partial Content Media Streamer
app.get('/api/downloads/:id/stream', (req, res) => {
  const task = downloadManager.getTask(req.params.id);
  if (!task) return res.status(404).send('Download task not found');

  const completedPath = task.savePath;
  const partPath = task.savePath + '.part';
  const targetFile = (fs.existsSync(completedPath)) ? completedPath : (fs.existsSync(partPath) ? partPath : null);

  if (!targetFile) {
    return res.status(404).send('File not yet created on disk. Please wait a moment for the stream to initialize.');
  }

  let stat;
  try {
    stat = fs.statSync(targetFile);
  } catch (err) {
    return res.status(404).send('Cannot access media file: ' + err.message);
  }

  const currentSize = stat.size;
  if (currentSize === 0) {
    return res.status(404).send('File has not buffered any data yet.');
  }

  const totalSize = (task.totalBytes && task.totalBytes > 0) ? task.totalBytes : currentSize;

  let mimeType = 'video/mp4';
  const ext = path.extname(task.name || task.savePath || '').toLowerCase();
  if (ext === '.mp3') mimeType = 'audio/mpeg';
  else if (ext === '.m4a' || ext === '.aac') mimeType = 'audio/mp4';
  else if (ext === '.flac') mimeType = 'audio/flac';
  else if (ext === '.wav') mimeType = 'audio/wav';
  else if (ext === '.ogg' || ext === '.opus') mimeType = 'audio/ogg';
  else if (ext === '.webm') mimeType = 'video/webm';
  else if (ext === '.mkv') mimeType = 'video/x-matroska';
  else if (ext === '.avi') mimeType = 'video/x-msvideo';

  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    let end = parts[1] ? parseInt(parts[1], 10) : (currentSize - 1);

    if (start >= currentSize) {
      res.status(416).set('Content-Range', `bytes */${totalSize}`).end();
      return;
    }

    if (end >= currentSize) {
      end = currentSize - 1;
    }

    const chunksize = (end - start) + 1;
    const stream = fs.createReadStream(targetFile, { start, end });

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${totalSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': mimeType,
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    });

    stream.pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': currentSize,
      'Content-Type': mimeType,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    });
    fs.createReadStream(targetFile).pipe(res);
  }
});

// Media / YouTube Probe & Formats Extractor
app.post('/api/media/probe', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  try {
    const info = await probeMedia(url);
    res.json(info);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/downloads/:id/pause', (req, res) => {
  downloadManager.pauseDownload(req.params.id);
  res.json({ ok: true });
});

app.post('/api/downloads/:id/resume', (req, res) => {
  downloadManager.resumeDownload(req.params.id);
  res.json({ ok: true });
});

app.post('/api/downloads/:id/update-url', (req, res) => {
  const { id } = req.params;
  const { url } = req.body;
  try {
    const task = downloadManager.updateTaskUrl(id, url);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    broadcast({ type: 'taskUpdated', task });
    res.json({ success: true, task });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/downloads/:id', (req, res) => {
  const deleteFile = req.query.deleteFile === 'true';
  const success = downloadManager.deleteTask(req.params.id, deleteFile);
  broadcast({ type: 'taskDeleted', id: req.params.id });
  res.json({ ok: success });
});

// Manual Archive Unpack & Password Submission
app.post('/api/downloads/:id/extract', async (req, res) => {
  try {
    const password = (req.body && req.body.password) ? req.body.password : '';
    const result = await downloadManager.extractTask(req.params.id, password);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/downloads/:id/set-password', (req, res) => {
  const { password, remember } = req.body;
  const result = downloadManager.submitExtractionPassword(req.params.id, password, remember);
  res.json(result);
});

// Update live task options (Speed limit, post actions, scripts, extraction)
app.post('/api/downloads/:id/options', (req, res) => {
  const updatedTask = downloadManager.updateTaskOptions(req.params.id, req.body || {});
  if (!updatedTask) return res.status(404).json({ error: 'Task not found' });
  broadcast({ type: 'taskUpdated', task: updatedTask });
  res.json({ success: true, task: updatedTask });
});

app.post('/api/downloads/:id/speed-limit', (req, res) => {
  const { speedLimitBytesPerSec } = req.body;
  const updatedTask = downloadManager.updateTaskOptions(req.params.id, {
    speedLimitEnabled: Boolean(speedLimitBytesPerSec > 0),
    speedLimitBytesPerSec: parseInt(speedLimitBytesPerSec, 10) || 0
  });
  if (!updatedTask) return res.status(404).json({ error: 'Task not found' });
  broadcast({ type: 'taskUpdated', task: updatedTask });
  res.json({ success: true, task: updatedTask });
});

app.get('/api/extractions', (req, res) => {
  const extractionQueue = require('./src/backend/extractionQueue');
  res.json(extractionQueue.getAllJobs());
});

// Queue Priority and Reordering (supports both taskId and id params)
app.post('/api/queue/move-up', (req, res) => {
  const taskId = req.body.taskId || req.body.id;
  const ok = downloadManager.moveTaskUp(taskId);
  broadcast({ type: 'queueReordered', queueOrder: downloadManager.queueOrder });
  res.json({ success: ok, queueOrder: downloadManager.queueOrder });
});

app.post('/api/queue/move-down', (req, res) => {
  const taskId = req.body.taskId || req.body.id;
  const ok = downloadManager.moveTaskDown(taskId);
  broadcast({ type: 'queueReordered', queueOrder: downloadManager.queueOrder });
  res.json({ success: ok, queueOrder: downloadManager.queueOrder });
});

app.post('/api/queue/move-top', (req, res) => {
  const taskId = req.body.taskId || req.body.id;
  const ok = downloadManager.moveTaskToTop(taskId);
  broadcast({ type: 'queueReordered', queueOrder: downloadManager.queueOrder });
  res.json({ success: ok, queueOrder: downloadManager.queueOrder });
});

app.post('/api/queue/move-bottom', (req, res) => {
  const taskId = req.body.taskId || req.body.id;
  const ok = downloadManager.moveTaskToBottom(taskId);
  broadcast({ type: 'queueReordered', queueOrder: downloadManager.queueOrder });
  res.json({ success: ok, queueOrder: downloadManager.queueOrder });
});

app.post('/api/queue/priority', (req, res) => {
  const taskId = req.body.taskId || req.body.id;
  const { priority } = req.body;
  const task = downloadManager.setTaskPriority(taskId, priority);
  res.json({ success: Boolean(task), task });
});

app.post('/api/queue/reorder', (req, res) => {
  const taskId = req.body.taskId || req.body.id;
  const { targetIndex } = req.body;
  downloadManager.reorderTask(taskId, targetIndex);
  broadcast({ type: 'queueReordered', queueOrder: downloadManager.queueOrder });
  res.json({ success: true, queueOrder: downloadManager.queueOrder });
});

// SHA-256 Checksum Verification
app.get('/api/downloads/:id/verify', async (req, res) => {
  try {
    const result = await downloadManager.verifyChecksum(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Batch Operations (Multi-Selection Actions)
app.post('/api/downloads/batch', (req, res) => {
  const { action, ids = [], deleteFiles = false } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'ids array required' });
  }

  if (action === 'pause') {
    downloadManager.batchPause(ids);
  } else if (action === 'resume') {
    downloadManager.batchResume(ids);
  } else if (action === 'delete') {
    downloadManager.batchDelete(ids, deleteFiles);
  } else {
    return res.status(400).json({ error: 'Invalid batch action' });
  }

  broadcast({ type: 'batchUpdated' });
  res.json({ ok: true, count: ids.length });
});

// Force Download & Extract Multipart Group (bypasses missing part gaps or forces immediate extraction)
app.post('/api/downloads/group/:groupKey/force-download', (req, res) => {
  const { groupKey } = req.params;
  downloadManager.forceDownloadGroup(groupKey);
  broadcast({ type: 'batchUpdated' });
  res.json({ ok: true, groupKey });
});

// Power Actions ("Turn off PC when queue finishes")
app.get('/api/power', (req, res) => {
  res.json({ action: downloadManager.getPowerAction() });
});

app.post('/api/power', requireLocalOrigin, (req, res) => {
  const { action } = req.body;
  const ok = downloadManager.setPowerAction(action);
  if (!ok) return res.status(400).json({ error: 'Action must be none, sleep, or shutdown' });
  broadcast({ type: 'powerUpdated', action: downloadManager.getPowerAction() });
  res.json({ ok: true, action: downloadManager.getPowerAction() });
});

app.post('/api/power/cancel', requireLocalOrigin, (req, res) => {
  downloadManager.cancelPowerAction();
  downloadManager.setPowerAction('none');
  broadcast({ type: 'powerUpdated', action: 'none' });
  res.json({ ok: true, message: 'Shutdown/Sleep canceled' });
});

// Batch add YouTube Playlist / Album entries
app.post('/api/media/batch-add', (req, res) => {
  const { entries, format, packageName, autoStart = true, allowDuplicate = false } = req.body;
  if (!Array.isArray(entries) || entries.length === 0) {
    return res.status(400).json({ error: 'entries array required' });
  }

  const selectedFormat = (format && typeof format === 'string') ? format : 'mp3-320';
  const isAudio = !selectedFormat.startsWith('mp4');
  let mediaType = isAudio ? 'audio' : 'video';
  let audioFormat = 'mp3';
  let audioQuality = '0';
  let videoQuality = '1080';

  if (selectedFormat === 'mp3-320') { audioFormat = 'mp3'; audioQuality = '0'; }
  else if (selectedFormat === 'mp3-192') { audioFormat = 'mp3'; audioQuality = '192k'; }
  else if (selectedFormat === 'm4a-best') { audioFormat = 'm4a'; audioQuality = 'best'; }
  else if (selectedFormat === 'flac-lossless') { audioFormat = 'flac'; audioQuality = '0'; }
  else if (selectedFormat === 'wav-lossless') { audioFormat = 'wav'; audioQuality = '0'; }
  else if (selectedFormat === 'mp4-1080') { videoQuality = '1080'; }
  else if (selectedFormat === 'mp4-720') { videoQuality = '720'; }

  const playlistTitle = (packageName && packageName.trim()) || 'YouTube Playlist';
  const playlistId = 'pl_' + playlistTitle.replace(/[^\w]/g, '_') + '_' + Date.now();

  const taskList = entries.map((entry, idx) => ({
    url: entry.url,
    filename: `${entry.title || 'Untitled Track'}.${isAudio ? audioFormat : 'mp4'}`,
    isMedia: true,
    isPlaylist: true,
    packageName: playlistTitle,
    playlistId,
    playlistGroup: {
      id: playlistId,
      name: playlistTitle,
      totalTracks: entries.length,
      index: idx + 1
    },
    mediaOptions: {
      mediaType,
      audioFormat,
      audioQuality,
      videoQuality
    },
    autoStart,
    allowDuplicate
  }));

  const result = downloadManager.createBatchTasks(taskList, {
    autoStart,
    packageName: playlistTitle,
    isPlaylist: true,
    playlistId
  });

  broadcast({ type: 'batchUpdated' });
  res.json({
    count: result.count,
    tasks: result.created,
    duplicates: result.duplicateCount,
    playlistId
  });
});

app.post('/api/downloads/pause-all', (req, res) => {
  downloadManager.pauseAll();
  broadcast({ type: 'batchUpdated' });
  res.json({ ok: true });
});

app.post('/api/downloads/resume-all', (req, res) => {
  downloadManager.resumeAll();
  broadcast({ type: 'batchUpdated' });
  res.json({ ok: true });
});

app.post('/api/downloads/clear-completed', (req, res) => {
  downloadManager.clearCompleted();
  broadcast({ type: 'batchUpdated' });
  res.json({ ok: true });
});

// LinkGrabber (JDownloader feature)
app.get('/api/linkgrabber', (req, res) => {
  res.json(linkGrabber.getStagedItems());
});

app.post('/api/linkgrabber/crawl', async (req, res) => {
  const { text, packageName } = req.body;
  if (!text) return res.status(400).json({ error: 'Text/URLs required' });

  try {
    let lastBroadcast = 0;
    const results = await linkGrabber.crawlText(text, packageName, (progress) => {
      const now = Date.now();
      if (now - lastBroadcast > 200 || progress.processed === progress.total) {
        lastBroadcast = now;
        broadcast({
          type: 'crawler_progress',
          progress,
          staged: linkGrabber.getStagedItems()
        });
      }
    });

    broadcast({ type: 'linkgrabberUpdated', staged: linkGrabber.getStagedItems() });
    res.json({ count: results.length, items: results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/linkgrabber/transfer', (req, res) => {
  const { itemIds, autoStart = true } = req.body;
  const staged = linkGrabber.getStagedItems();
  const createdTasks = [];

  const targets = (itemIds && itemIds.length > 0)
    ? staged.filter(item => itemIds.includes(item.id))
    : staged.filter(item => item.selected);

  for (const item of targets) {
    const task = downloadManager.createTask({
      url: item.originalUrl,
      directUrl: item.directUrl,
      filename: item.filename,
      size: item.size,
      hoster: item.hoster,
      packageName: item.packageName,
      acceptRanges: item.acceptRanges,
      downloadHeaders: item.downloadHeaders,
      isMedia: item.isMedia,
      mediaOptions: item.mediaOptions,
      autoStart
    });
    createdTasks.push(task);
    linkGrabber.removeStagedItem(item.id);
  }

  broadcast({ type: 'linkgrabberUpdated', staged: linkGrabber.getStagedItems() });
  broadcast({ type: 'batchUpdated' });
  res.json({ added: createdTasks.length, tasks: createdTasks });
});

app.delete('/api/linkgrabber/:id', (req, res) => {
  linkGrabber.removeStagedItem(req.params.id);
  broadcast({ type: 'linkgrabberUpdated', staged: linkGrabber.getStagedItems() });
  res.json({ ok: true });
});

app.post('/api/linkgrabber/clear', (req, res) => {
  linkGrabber.clear();
  broadcast({ type: 'linkgrabberUpdated', staged: [] });
  res.json({ ok: true });
});

// --- FlashGot & JDownloader Click'n'Load Compatibility ---
async function handleFlashGot(req, res) {
  const urlsRaw = req.body.urls || req.query.urls || '';
  const packageName = req.body.package || req.query.package || 'Browser Download';
  const autoStart = req.body.autostart === '1' || req.query.autostart === '1';

  if (!urlsRaw) return res.send('success\r\n');

  const urls = String(urlsRaw).split(/\r?\n/).map(u => u.trim()).filter(Boolean);
  for (const url of urls) {
    if (autoStart) {
      downloadManager.createTask({
        url,
        packageName,
        autoStart: true
      });
    } else {
      await linkGrabber.crawlText(url, packageName);
    }
  }

  broadcast({ type: 'linkgrabberUpdated', staged: linkGrabber.getStagedItems() });
  broadcast({ type: 'batchUpdated' });
  res.send('success\r\n');
}

app.all('/flashgot', handleFlashGot);
app.all('/flash/add', handleFlashGot);
app.get('/jdcheck.js', (req, res) => {
  res.type('application/javascript').send('jdownloader=true; var version="Waterfall 1.0.0";');
});
app.get('/crossdomain.xml', (req, res) => {
  res.type('text/xml').send('<?xml version="1.0"?><cross-domain-policy><allow-access-from domain="*" /></cross-domain-policy>');
});

function syncWindowsStartupRegistry(startWithWindows, startWithWindow) {
  if (process.platform !== 'win32') return;
  try {
    const candidateExe = path.resolve(__dirname, 'dist', 'Waterfall-win32-x64', 'Waterfall.exe');
    const targetExe = fs.existsSync(candidateExe) ? candidateExe : process.execPath;
    const argStr = (startWithWindow !== true) ? ' --hidden' : '';
    if (startWithWindows) {
      const regValue = `"${targetExe}"${argStr}`;
      execFile('reg', ['add', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', '/v', 'Waterfall', '/t', 'REG_SZ', '/d', regValue, '/f'], { windowsHide: true }, () => {});
    } else {
      execFile('reg', ['delete', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', '/v', 'Waterfall', '/f'], { windowsHide: true }, () => {});
    }
  } catch (_) {}
}

// Settings
app.get('/api/settings', (req, res) => {
  res.json(getConfig());
});

app.post('/api/settings', (req, res) => {
  const updated = saveConfig(req.body);
  syncWindowsStartupRegistry(updated.startWithWindows !== false, updated.startWithWindow === true);
  broadcast({ type: 'configUpdated', config: updated });
  res.json(updated);
});

app.post('/api/settings/reset', (req, res) => {
  const { DEFAULT_CONFIG } = require('./src/backend/config');
  const reset = saveConfig(DEFAULT_CONFIG);
  syncWindowsStartupRegistry(reset.startWithWindows !== false, reset.startWithWindow === true);
  broadcast({ type: 'configUpdated', config: reset });
  res.json(reset);
});

// Test Run Post-Download Script with simulated context
app.post('/api/settings/test-script', requireLocalOrigin, async (req, res) => {
  try {
    const result = await testRunScript(req.body);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Crawler & Universal Extractor Engine API
const { getCrawlerInfo, updateCrawlerEngine } = require('./src/backend/crawlerEngine');

app.get('/api/crawler/info', async (req, res) => {
  try {
    const info = await getCrawlerInfo();
    res.json(info);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/crawler/update', requireLocalOrigin, async (req, res) => {
  try {
    const result = await updateCrawlerEngine();
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Open File with default system application
app.post('/api/open-file', requireLocalOrigin, (req, res) => {
  const { filePath } = req.body;
  if (!filePath) return res.status(400).json({ error: 'filePath is required' });

  const resolved = path.resolve(filePath);
  if (fs.existsSync(resolved)) {
    execFile('cmd.exe', ['/c', 'start', '', resolved], { windowsHide: true }, (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ ok: true });
    });
    return;
  }

  res.status(404).json({ error: 'File not found' });
});

// Open File / Folder in Windows Explorer
app.post('/api/open-folder', requireLocalOrigin, (req, res) => {
  const { filePath } = req.body;
  if (!filePath) return res.status(400).json({ error: 'filePath is required' });

  const resolved = path.resolve(filePath);
  if (fs.existsSync(resolved)) {
    const stat = fs.statSync(resolved);
    if (stat.isDirectory()) {
      execFile('explorer.exe', [resolved]);
    } else {
      execFile('explorer.exe', [`/select,${resolved}`]);
    }
    return res.json({ ok: true });
  } else {
    // Open parent folder if file doesn't exist yet
    const parent = path.dirname(resolved);
    if (fs.existsSync(parent)) {
      execFile('explorer.exe', [parent]);
      return res.json({ ok: true });
    }
  }

  res.status(404).json({ error: 'Path not found' });
});

// Default Application Icon & Metadata Provider (with In-Flight Promise Coalescing)
const appIconCache = new Map();
const appIconInFlight = new Map();

function fetchIconData(filePath, ext, cacheKey) {
  if (cacheKey && appIconCache.has(cacheKey)) {
    return Promise.resolve(appIconCache.get(cacheKey));
  }
  if (cacheKey && appIconInFlight.has(cacheKey)) {
    return appIconInFlight.get(cacheKey);
  }

  const promise = new Promise((resolve) => {
    const psScript = path.join(__dirname, 'src', 'backend', 'get_app_icon.ps1');
    const args = ['-ExecutionPolicy', 'Bypass', '-File', psScript];
    if (filePath && fs.existsSync(filePath)) {
      args.push('-filePath', filePath);
    }
    if (ext) {
      args.push('-extension', ext);
    }

    execFile('powershell', args, { timeout: 4000 }, (error, stdout) => {
      if (error || !stdout || !stdout.trim()) {
        const fallback = {
          extension: ext,
          appName: 'Default Application',
          appExe: null,
          icon: null
        };
        return resolve(fallback);
      }

      try {
        const data = JSON.parse(stdout.trim());
        if (cacheKey && data && data.icon) {
          appIconCache.set(cacheKey, data);
        }
        resolve(data);
      } catch (e) {
        resolve({
          extension: ext,
          appName: 'Default Application',
          appExe: null,
          icon: null
        });
      }
    });
  }).finally(() => {
    if (cacheKey) appIconInFlight.delete(cacheKey);
  });

  if (cacheKey) appIconInFlight.set(cacheKey, promise);
  return promise;
}

app.get('/api/app-icon', async (req, res) => {
  const filePath = req.query.path || '';
  const ext = req.query.ext || (filePath ? path.extname(filePath) : '');
  const cacheKey = (ext ? ext.toLowerCase() : filePath.toLowerCase()).trim();

  try {
    const data = await fetchIconData(filePath, ext, cacheKey);
    res.json(data);
  } catch (_) {
    res.json({
      extension: ext,
      appName: 'Default Application',
      appExe: null,
      icon: null
    });
  }
});

app.get('/api/system/binaries', (req, res) => {
  try {
    const status = binaryResolver.getSystemBinariesStatus();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/system/download-ytdl', async (req, res) => {
  try {
    const forceUpdate = req.body && req.body.forceUpdate === true;
    const result = await binaryResolver.ensureYtDlpInstalled({
      forceUpdate,
      onProgress: (dl, total) => {
        broadcast({ type: 'ytdl_download_progress', downloaded: dl, total });
      }
    });
    const status = binaryResolver.getSystemBinariesStatus();
    broadcast({ type: 'system_binaries', binaries: status });
    res.json({ success: true, result, status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const config = getConfig();
const PORT = process.env.PORT || config.listenPort || 4567;
syncWindowsStartupRegistry(config.startWithWindows !== false, config.startWithWindow === true);

function startServer(port = PORT) {
  return new Promise((resolve, reject) => {
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.warn(`[Waterfall Server] Port ${port} is already in use by an active daemon. Connecting to existing instance.`);
        resolve(server);
      } else {
        console.error('[Waterfall Server] Fatal server error:', err);
        reject(err);
      }
    });

    server.listen(port, () => {
      console.log(`=======================================================`);
      console.log(` WATERFALL - IDM + JDownloader Hybrid Core Running     `);
      console.log(` Web & Desktop UI: http://localhost:${port}             `);
      console.log(`=======================================================`);

      // Asynchronously ensure yt-dlp is available or auto-download from official GitHub release
      binaryResolver.ensureYtDlpInstalled({
        onProgress: (dl, total) => {
          broadcast({ type: 'ytdl_download_progress', downloaded: dl, total });
        }
      }).then((res) => {
        const status = binaryResolver.getSystemBinariesStatus();
        broadcast({ type: 'system_binaries', binaries: status });
      }).catch((err) => {
        console.warn('[Waterfall Server] Background yt-dlp check warning:', err.message);
      });

      resolve(server);
    });
  });
}

if (require.main === module) {
  startServer();
}

module.exports = { app, server, startServer, downloadManager };
