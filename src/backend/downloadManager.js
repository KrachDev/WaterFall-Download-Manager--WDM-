const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { exec } = require('child_process');
const ChunkDownloader = require('./chunkDownloader');
const { MediaDownloader, isMediaUrl, isGenericTitle, probeMedia } = require('./mediaDownloader');
const { getConfig } = require('./config');
const { getCategoryFromFilename } = require('./linkGrabber');
const { resolveDestinationPath, preserveMetadata } = require('./folderManager');
const { isArchiveFile, unpackArchive } = require('./archiveUnpacker');
const { executePostDownloadScript } = require('./scriptRunner');

const STATE_FILE = path.join(__dirname, '..', '..', 'downloads.json');

function normalizeFileTitle(str) {
  if (!str || typeof str !== 'string') return '';
  try { str = decodeURIComponent(str); } catch (_) {}
  return str
    .replace(/[\\/]/g, '/')
    .split('/')
    .pop()
    .replace(/\.part\d*$/i, '')
    .replace(/\.pkg$|\.rar$|\.zip$|\.7z$|\.bin$|\.iso$/i, '')
    .replace(/[_\s\-\.\(\)\[\]\+]+/g, ' ')
    .trim()
    .toLowerCase();
}

function getUrlResourceKey(rawUrl) {
  if (!rawUrl) return '';
  try {
    const u = new URL(rawUrl);
    // Mocha.my share
    const mochaMatch = u.pathname.match(/\/api\/shares\/([^\/]+)/i);
    if (mochaMatch) return `mocha:${mochaMatch[1]}`;
    
    // 1fichier
    const unFichierMatch = (u.search || '').match(/\?([a-zA-Z0-9]+)/) || u.pathname.match(/\/([a-zA-Z0-9]{8,})/);
    if (u.hostname.includes('1fichier.com') && unFichierMatch) return `1fichier:${unFichierMatch[1]}`;
    
    // Nexus mods CDN
    const nexusMatch = u.pathname.match(/\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
    if (nexusMatch) return `nexus:${nexusMatch[1]}`;

    // Google drive
    const gdriveMatch = u.pathname.match(/\/d\/([^\/]+)/) || (u.search || '').match(/id=([^&]+)/);
    if (u.hostname.includes('drive.google.com') && gdriveMatch) return `gdrive:${gdriveMatch[1]}`;

    // Generic clean resource path
    const cleanPath = path.basename(u.pathname).toLowerCase();
    if (cleanPath && cleanPath !== 'download' && cleanPath !== 'download.php' && cleanPath.length > 3) {
      return `${u.hostname}:${cleanPath}`;
    }
  } catch (_) {}
  return '';
}

function findExistingMatchingTask(tasks, options, filename, savePath) {
  const normName = normalizeFileTitle(filename);
  const optUrl = (options.url || '').trim();
  const optDirect = (options.directUrl || '').trim();
  const newResourceKey = getUrlResourceKey(optDirect || optUrl);

  const candidates = [];

  for (const t of tasks.values()) {
    if (t.status === 'completed') {
      if (t.savePath && fs.existsSync(t.savePath)) {
        const tNorm = normalizeFileTitle(t.name);
        if (normName && tNorm && normName === tNorm) {
          return { targetTask: t, isCompletedOnDisk: true };
        }
      }
      continue;
    }

    let score = 0;

    // 1. Exact URL match
    if (t.url === optUrl || t.directUrl === optUrl || (optDirect && (t.url === optDirect || t.directUrl === optDirect))) {
      score += 100;
    }

    // 2. URL Resource key match (e.g. mocha share ID, 1fichier token, nexus UUID)
    if (newResourceKey) {
      const existingKey = getUrlResourceKey(t.directUrl || t.url);
      if (existingKey && existingKey === newResourceKey) {
        score += 80;
      }
    }

    // 3. Name matching
    const tNorm = normalizeFileTitle(t.name);
    const tBaseNorm = normalizeFileTitle(path.basename(t.savePath || ''));
    const saveBaseNorm = normalizeFileTitle(path.basename(savePath || ''));
    const pkgNorm = normalizeFileTitle(options.packageName || '');
    const tPkgNorm = normalizeFileTitle(t.packageName || '');

    if (normName && tNorm) {
      if (normName === tNorm) {
        score += 70;
      } else if (normName.includes(tNorm) || tNorm.includes(normName)) {
        score += 50;
      }
    }

    if (saveBaseNorm && tBaseNorm && saveBaseNorm === tBaseNorm) {
      score += 60;
    }

    if (pkgNorm && tPkgNorm && pkgNorm === tPkgNorm) {
      score += 40;
    }

    let rawDecodedMatch = false;
    try {
      const d1 = decodeURIComponent(t.name || '').toLowerCase().trim();
      const d2 = decodeURIComponent(filename || '').toLowerCase().trim();
      if (d1 && d2 && d1 === d2) rawDecodedMatch = true;
    } catch (_) {}
    if (rawDecodedMatch) score += 65;

    if (t.savePath && savePath) {
      const clean1 = t.savePath.replace(/Hydra/gi, 'Waterfall').toLowerCase();
      const clean2 = savePath.replace(/Hydra/gi, 'Waterfall').toLowerCase();
      if (clean1 === clean2) score += 75;
    }

    if (score >= 50) {
      candidates.push({ task: t, score });
    }
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return (b.task.downloadedBytes || 0) - (a.task.downloadedBytes || 0);
  });

  return { targetTask: candidates[0].task, isCompletedOnDisk: false };
}

function recoverPartialBytes(task, config) {
  const tempDir = config.tempDir || path.dirname(task.savePath);
  let recoveredBytes = 0;

  // 1. If multi-segment parts exist:
  if (Array.isArray(task.segments) && task.segments.length > 0) {
    if (task.totalBytes === 0) {
      task.segments = [];
    } else {
      for (const seg of task.segments) {
        const partFile = path.join(tempDir, `${task.id}_seg_${seg.id}.part`);
        if (fs.existsSync(partFile)) {
          try {
            const sz = fs.statSync(partFile).size;
            seg.downloadedBytes = sz;
            if (seg.totalBytes > 0 && sz >= seg.totalBytes) {
              seg.status = 'completed';
            } else {
              seg.status = 'pending';
            }
          } catch (_) {
            if (seg.status !== 'completed') seg.status = 'pending';
          }
        } else {
          if (seg.status !== 'completed') {
            seg.downloadedBytes = 0;
            seg.status = 'pending';
          }
        }
        recoveredBytes += (seg.downloadedBytes || 0);
      }
    }
  }

  // 2. Single part file:
  const part0 = path.join(tempDir, `${task.id}_seg_0.part`);
  if (fs.existsSync(part0)) {
    try {
      const sz = fs.statSync(part0).size;
      recoveredBytes = Math.max(recoveredBytes, sz);
    } catch (_) {}
  }

  // 3. Check savePath + '.part' or target folder partial file
  const savePathPart = `${task.savePath}.part`;
  if (fs.existsSync(savePathPart)) {
    try {
      const sz = fs.statSync(savePathPart).size;
      if (sz > recoveredBytes) {
        recoveredBytes = sz;
        if (!fs.existsSync(part0) || fs.statSync(part0).size < sz) {
          fs.copyFileSync(savePathPart, part0);
        }
      }
    } catch (_) {}
  }

  const targetDirPart = path.join(path.dirname(task.savePath), `${task.name}.part`);
  if (fs.existsSync(targetDirPart)) {
    try {
      const sz = fs.statSync(targetDirPart).size;
      if (sz > recoveredBytes) {
        recoveredBytes = sz;
        if (!fs.existsSync(part0) || fs.statSync(part0).size < sz) {
          fs.copyFileSync(targetDirPart, part0);
        }
      }
    } catch (_) {}
  }

  // 4. Orphaned part file adoption in tempDir:
  // If task has 0 recovered bytes, inspect tempDir for orphaned .part files matching this task
  if (recoveredBytes === 0) {
    try {
      if (fs.existsSync(tempDir)) {
        const tempFiles = fs.readdirSync(tempDir);
        for (const tf of tempFiles) {
          if (tf.endsWith('.part') && !tf.startsWith(task.id)) {
            const pPath = path.join(tempDir, tf);
            const pStat = fs.statSync(pPath);
            if (pStat.size > 10 * 1024 * 1024) { // > 10MB
              let isMatch = false;
              const fd = fs.openSync(pPath, 'r');
              const buf = Buffer.alloc(128);
              fs.readSync(fd, buf, 0, 128, 0);
              fs.closeSync(fd);
              if (buf[0] === 0x7F && buf[1] === 0x43 && buf[2] === 0x4E && buf[3] === 0x44 && task.name.toLowerCase().includes('.pkg')) {
                const contentId = buf.slice(0x40, 0x70).toString('ascii').replace(/[^\x20-\x7E]/g, '');
                const titleId = contentId.split('-')[1] || '';
                if (titleId && task.name.toLowerCase().includes(titleId.toLowerCase())) {
                  isMatch = true;
                }
              }
              if (isMatch) {
                console.log(`[Waterfall] Adopting ${pStat.size} bytes from orphaned part file ${tf} into task ${task.id}`);
                fs.copyFileSync(pPath, part0);
                recoveredBytes = pStat.size;
                break;
              }
            }
          }
        }
      }
    } catch (_) {}
  }

  task.downloadedBytes = Math.max(task.downloadedBytes || 0, recoveredBytes);
  return recoveredBytes;
}

class DownloadManager extends EventEmitter {
  constructor() {
    super();
    this.tasks = new Map(); // id -> task
    this.activeDownloaders = new Map(); // id -> ChunkDownloader
    this.globalSpeed = 0;
    this.lastBytesCheck = new Map();
    this.lastSpeedCheckTime = Date.now();

    this._saveTimeout = null;
    this.loadState();
    this.startSpeedMonitor();
    this.powerActionOnComplete = 'none'; // 'none' | 'sleep' | 'shutdown'

    // Synchronously flush state on process termination
    process.on('exit', () => this.saveState(true));
    process.on('SIGINT', () => { this.saveState(true); process.exit(0); });
    process.on('SIGTERM', () => { this.saveState(true); process.exit(0); });
  }

  loadState() {
    try {
      if (fs.existsSync(STATE_FILE)) {
        const raw = fs.readFileSync(STATE_FILE, 'utf-8');
        const list = JSON.parse(raw);
        for (const t of list) {
          // If was downloading before shutdown, set to paused
          if (t.status === 'downloading' || t.status === 'assembling') {
            t.status = 'paused';
            t.speed = 0;
            t.eta = 0;
          }

          // Check if file is already complete on disk
          if (t.savePath && fs.existsSync(t.savePath)) {
            try {
              const sz = fs.statSync(t.savePath).size;
              if (t.totalBytes > 0 && sz >= t.totalBytes) {
                t.status = 'completed';
                t.downloadedBytes = t.totalBytes;
                t.speed = 0;
                t.eta = 0;
              } else if (t.status === 'completed' && t.totalBytes === 0 && sz > 0) {
                t.totalBytes = sz;
                t.downloadedBytes = sz;
              }
            } catch (_) {}
          }

          this.tasks.set(t.id, t);
        }
      }
    } catch (e) {
      console.warn('Failed to load downloads state:', e.message);
    }
  }

  saveState(immediate = false) {
    if (this._saveTimeout) {
      clearTimeout(this._saveTimeout);
      this._saveTimeout = null;
    }

    const doSave = (sync = false) => {
      try {
        const list = Array.from(this.tasks.values()).map(t => ({
          ...t,
          speed: 0,
          eta: 0
        }));
        const data = JSON.stringify(list, null, 2);
        if (sync) {
          fs.writeFileSync(STATE_FILE, data, 'utf-8');
        } else {
          fs.promises.writeFile(STATE_FILE, data, 'utf-8').catch(err => {
            console.warn('Failed to save downloads state:', err.message);
          });
        }
      } catch (e) {
        console.warn('Failed to save downloads state:', e.message);
      }
    };

    if (immediate) {
      doSave(true);
    } else {
      this._saveTimeout = setTimeout(() => doSave(false), 350);
    }
  }

  startSpeedMonitor() {
    setInterval(() => {
      const now = Date.now();
      const timeElapsed = (now - this.lastSpeedCheckTime) / 1000;
      if (timeElapsed <= 0) return;

      let totalSpeed = 0;

      for (const [id, task] of this.tasks.entries()) {
        if (task.status === 'downloading') {
          const prevBytes = this.lastBytesCheck.get(id) || task.downloadedBytes;
          const delta = Math.max(0, task.downloadedBytes - prevBytes);
          const currentSpeed = Math.floor(delta / timeElapsed);
          task.speed = currentSpeed;
          totalSpeed += currentSpeed;

          // Compute ETA
          if (task.totalBytes > 0 && currentSpeed > 0) {
            const remaining = task.totalBytes - task.downloadedBytes;
            task.eta = Math.max(0, Math.ceil(remaining / currentSpeed));
          } else {
            task.eta = 0;
          }

          this.lastBytesCheck.set(id, task.downloadedBytes);
        } else {
          task.speed = 0;
          task.eta = 0;
          this.lastBytesCheck.delete(id);
        }
      }

      this.globalSpeed = totalSpeed;
      this.lastSpeedCheckTime = now;

      this.emit('stats', {
        globalSpeed: this.globalSpeed,
        activeTasks: this.getActiveCount()
      });
    }, 500);
  }

  getActiveCount() {
    let count = 0;
    for (const t of this.tasks.values()) {
      if (t.status === 'downloading') count++;
    }
    return count;
  }

  processQueue() {
    const config = getConfig();
    const maxActive = config.maxConcurrentDownloads || 3;
    let active = this.getActiveCount();

    if (active < maxActive) {
      for (const task of this.tasks.values()) {
        if (active >= maxActive) break;
        if (task.status === 'queued') {
          this.startDownload(task.id);
          active++;
        }
      }
    }

    this.checkQueueFinished();
  }

  checkQueueFinished() {
    if (this.tasks.size === 0) return;
    const hasPending = Array.from(this.tasks.values()).some(
      t => t.status === 'queued' || t.status === 'downloading' || t.status === 'assembling'
    );

    if (!hasPending && this.getActiveCount() === 0) {
      this.emit('queueCompleted');
      if (this.powerActionOnComplete === 'shutdown') {
        this.executePowerAction('shutdown');
      } else if (this.powerActionOnComplete === 'sleep') {
        this.executePowerAction('sleep');
      }
    }
  }

  executePowerAction(action) {
    console.log(`[Hydra Power] Queue finished. Executing power action: ${action}`);
    if (action === 'shutdown') {
      exec('shutdown /s /t 60 /c "Hydra download queue completed. Shutting down system in 60 seconds (run shutdown /a in PowerShell to cancel)."');
    } else if (action === 'sleep') {
      exec('rundll32.exe powrprof.dll,SetSuspendState 0,1,0');
    }
  }

  cancelPowerAction() {
    exec('shutdown /a');
  }

  createTask(options) {
    const config = getConfig();
    const id = crypto.randomUUID();
    const isMedia = options.isMedia || isMediaUrl(options.url);
    const mediaOptions = options.mediaOptions || (isMedia ? { mediaType: 'audio', audioFormat: 'mp3', audioQuality: '0' } : null);

    let filename = options.filename;
    // Derive filename from packageName or URL if filename is missing or generic
    if (isGenericTitle(filename)) {
      if (options.packageName && !isGenericTitle(options.packageName)) {
        const cleanPkg = options.packageName.trim().replace(/[<>:"/\\|?*]/g, '_');
        const mediaExt = (mediaOptions && mediaOptions.mediaType === 'video') ? '.mp4' : '.mp3';
        const hasExt = path.extname(cleanPkg).length > 1;
        filename = hasExt ? cleanPkg : `${cleanPkg}${isMedia ? mediaExt : ''}`;
      } else if (!isMedia && options.url) {
        try {
          const parsed = new URL(options.url);
          const base = path.basename(parsed.pathname);
          if (base && !isGenericTitle(base)) {
            filename = decodeURIComponent(base);
          }
        } catch (_) {}
      }
    }

    if (!filename || isGenericTitle(filename)) {
      filename = isMedia ? 'Media Download' : ('file_' + Date.now());
    }

    let saveFolder = options.saveDir;
    let savePath = '';
    let category = '';

    if (!saveFolder && config.useOsMediaFolders !== false) {
      const dest = resolveDestinationPath(filename, {
        packageName: options.packageName,
        isMedia,
        mediaType: mediaOptions ? mediaOptions.mediaType : null
      });
      saveFolder = dest.folder;
      savePath = dest.savePath;
      category = dest.category;
    } else {
      saveFolder = saveFolder || config.downloadDir;
      savePath = path.join(saveFolder, filename);
      category = isMedia
        ? (mediaOptions && mediaOptions.mediaType === 'video' ? 'Video' : 'Audio')
        : getCategoryFromFilename(filename);
    }

    // Check if an existing task for the exact same file already exists in queue/history
    const matchResult = findExistingMatchingTask(this.tasks, options, filename, savePath);

    if (matchResult) {
      if (matchResult.isCompletedOnDisk) {
        console.log(`[Waterfall] Task "${matchResult.targetTask.name}" (${matchResult.targetTask.id}) is already completed on disk. Returning existing completed task.`);
        return matchResult.targetTask;
      }

      const targetTask = matchResult.targetTask;

      console.log(`[Waterfall] Auto-updating URL for existing incomplete task "${targetTask.name}" (${targetTask.id}). Retaining ${targetTask.downloadedBytes} bytes and resuming...`);

      // Update the target task's URL and resume
      targetTask.url = options.url;
      targetTask.directUrl = options.directUrl || options.url;
      targetTask.error = null;
      if (options.packageName && !targetTask.packageName) targetTask.packageName = options.packageName;
      if (options.size && (!targetTask.totalBytes || targetTask.totalBytes === 0)) targetTask.totalBytes = options.size;
      if (filename && !isGenericTitle(filename) && isGenericTitle(targetTask.name)) {
        targetTask.name = filename;
      }
      if (options.downloadEngineMode) targetTask.downloadEngineMode = options.downloadEngineMode;
      if (options.singleStream !== undefined) targetTask.singleStream = Boolean(options.singleStream);
      if (options.segmentsCount) targetTask.segmentsCount = options.segmentsCount;
      if (options.customScript) targetTask.customScript = options.customScript;

      // Stop active downloader if running
      const downloader = this.activeDownloaders.get(targetTask.id);
      if (downloader) {
        if (typeof downloader.pause === 'function') downloader.pause();
        this.activeDownloaders.delete(targetTask.id);
      }

      // Recover physical bytes from disk
      recoverPartialBytes(targetTask, config);

      targetTask.status = options.autoStart !== false ? 'queued' : 'paused';
      this.saveState(true);
      this.emit('taskUpdated', targetTask);

      if (options.autoStart !== false) {
        this.processQueue();
      }

      return targetTask;
    }

    const downloadEngineMode = options.downloadEngineMode || config.downloadEngineMode || 'inPlace';
    const isSingleStream = Boolean(options.singleStream || downloadEngineMode === 'singleStream' || (options.segmentsCount === 1));
    const segmentsCount = isSingleStream ? 1 : (options.segmentsCount || options.segments || config.segmentsPerFile || 8);

    const task = {
      id,
      name: filename,
      category,
      packageName: options.packageName || '',
      url: options.url,
      directUrl: options.directUrl || options.url,
      hoster: isMedia ? 'YouTube / Media' : (options.hoster || 'Direct Web'),
      status: options.autoStart ? 'queued' : 'paused',
      totalBytes: options.size || 0,
      downloadedBytes: 0,
      speed: 0,
      eta: 0,
      savePath,
      acceptRanges: options.acceptRanges !== false,
      isMedia,
      mediaOptions,
      addedAt: Date.now(),
      startedAt: null,
      completedAt: null,
      averageSpeed: 0,
      customScript: options.customScript || null,
      error: null,
      downloadEngineMode,
      singleStream: isSingleStream,
      segmentsCount,
      segments: []
    };

    this.tasks.set(id, task);
    this.saveState();
    this.emit('taskCreated', task);

    if (options.autoStart) {
      this.processQueue();
    }

    return task;
  }

  startDownload(id) {
    const task = this.tasks.get(id);
    if (!task) return;

    if (this.activeDownloaders.has(id)) {
      return;
    }

    const config = getConfig();

    if (!task.startedAt) task.startedAt = Date.now();

    // Check if this is a YouTube / stream media download
    if (task.isMedia || isMediaUrl(task.url)) {
      const mediaDownloader = new MediaDownloader(task, task.mediaOptions || {});
      this.activeDownloaders.set(id, mediaDownloader);

      mediaDownloader.start(
        (t) => {
          this.emit('taskUpdated', t);
        },
        async (t) => {
          this.activeDownloaders.delete(id);
          const durationSec = Math.max(0.1, (Date.now() - (t.startedAt || t.addedAt)) / 1000);
          if (t.totalBytes > 0) t.averageSpeed = Math.round(t.totalBytes / durationSec);
          await this.handleCompletion(t);
        },
        (err) => {
          this.activeDownloaders.delete(id);
          this.saveState();
          this.emit('taskUpdated', task);
          this.emit('taskFailed', { task, error: task.error || err.message });
          this.processQueue();
        }
      );
      this.saveState();
      return;
    }

    const speedLimitBytesPerSec = (config.speedLimitEnabled && config.speedLimitBytesPerSec > 0)
      ? config.speedLimitBytesPerSec
      : 0;

    const engineMode = task.downloadEngineMode || config.downloadEngineMode || 'inPlace';
    const isSingleStream = Boolean(task.singleStream || engineMode === 'singleStream');
    const segments = isSingleStream ? 1 : (task.segmentsCount || config.segmentsPerFile || 8);

    const downloader = new ChunkDownloader(task, {
      engineMode,
      singleStream: isSingleStream,
      segments,
      tempDir: config.tempDir,
      bufferSize: config.bufferSizeBytes || (1024 * 1024),
      speedLimitBytesPerSec
    });

    this.activeDownloaders.set(id, downloader);

    downloader.on('update', (t) => {
      this.emit('taskUpdated', t);
    });

    downloader.on('complete', async (t) => {
      this.activeDownloaders.delete(id);
      t.status = 'completed';
      t.completedAt = Date.now();
      t.speed = 0;
      t.eta = 0;
      const durationSec = Math.max(0.1, (t.completedAt - (t.startedAt || t.addedAt)) / 1000);
      if (t.totalBytes > 0) t.averageSpeed = Math.round(t.totalBytes / durationSec);
      await this.handleCompletion(t);
    });

    downloader.on('error', (err) => {
      this.activeDownloaders.delete(id);
      task.status = 'error';
      task.error = err.message;
      this.saveState();
      this.emit('taskUpdated', task);
      this.emit('taskFailed', { task, error: task.error || err.message });
      this.processQueue();
    });

    downloader.start();
    this.saveState();
  }

  async handleCompletion(t) {
    const config = getConfig();
    if (config.preserveMetadata !== false) {
      try {
        preserveMetadata(t.savePath, t);
      } catch (errMeta) {
        console.warn('Metadata preservation error:', errMeta.message);
      }
    }

    if (config.autoExtractArchives !== false && isArchiveFile(t.savePath)) {
      t.extractStatus = 'extracting';
      this.emit('taskUpdated', t);
      try {
        const result = await unpackArchive(t.savePath);
        if (result.success) {
          t.extractStatus = 'extracted';
          t.extractedPath = result.outDir;
        } else {
          t.extractStatus = 'extract_failed';
          t.extractError = result.error;
        }
      } catch (errUnpack) {
        t.extractStatus = 'extract_failed';
        t.extractError = errUnpack.message;
      }
      this.emit('taskUpdated', t);
    }

    // Trigger custom post-download script if enabled (non-blocking)
    if (config.postDownloadScriptEnabled) {
      executePostDownloadScript(t, config).then(res => {
        if (res && !res.success && res.error) {
          console.warn(`[Hydra] Post-download script warning for ${t.name}:`, res.stderr || res.error);
        } else if (res && res.success) {
          console.log(`[Hydra] Post-download script succeeded for ${t.name}`);
        }
      }).catch(err => {
        console.error(`[Hydra] Post-download script execution failed for ${t.name}:`, err.message);
      });
    }

    this.saveState(true);
    this.emit('taskCompleted', t);
    this.processQueue();
  }

  pauseDownload(id) {
    const task = this.tasks.get(id);
    if (!task) return;

    const downloader = this.activeDownloaders.get(id);
    if (downloader) {
      downloader.pause();
      this.activeDownloaders.delete(id);
    }

    task.status = 'paused';
    task.speed = 0;
    task.eta = 0;
    this.saveState();
    this.emit('taskUpdated', task);
    this.processQueue();
  }

  resumeDownload(id) {
    const task = this.tasks.get(id);
    if (!task) return;

    if (task.status === 'completed') return;

    task.status = 'queued';
    this.saveState();
    this.emit('taskUpdated', task);
    this.processQueue();
  }

  updateTaskUrl(id, newUrl) {
    const task = this.tasks.get(id);
    if (!task) return null;
    const cleanUrl = (newUrl || '').trim();
    if (!cleanUrl || !cleanUrl.startsWith('http')) {
      throw new Error('Please provide a valid HTTP or HTTPS download URL.');
    }

    // Stop active downloader if running
    const downloader = this.activeDownloaders.get(id);
    if (downloader) {
      if (typeof downloader.pause === 'function') downloader.pause();
      this.activeDownloaders.delete(id);
    }

    task.url = cleanUrl;
    task.directUrl = cleanUrl;
    task.error = null;
    task.status = 'queued';

    const config = getConfig();
    recoverPartialBytes(task, config);

    this.saveState(true);
    this.emit('taskUpdated', task);
    this.processQueue();
    return task;
  }

  pauseAll() {
    for (const id of Array.from(this.activeDownloaders.keys())) {
      this.pauseDownload(id);
    }
    for (const task of this.tasks.values()) {
      if (task.status === 'queued') {
        task.status = 'paused';
      }
    }
    this.saveState();
  }

  resumeAll() {
    for (const task of this.tasks.values()) {
      if (task.status === 'paused' || task.status === 'error') {
        task.status = 'queued';
      }
    }
    this.saveState();
    this.processQueue();
  }

  deleteTask(id, deleteFile = false) {
    const task = this.tasks.get(id);
    if (!task) return false;

    const downloader = this.activeDownloaders.get(id);
    if (downloader) {
      try { downloader.cancel(); } catch (_) {}
      this.activeDownloaders.delete(id);
    }

    if (deleteFile) {
      const unlinkSafely = (targetPath) => {
        if (!targetPath) return;
        try {
          if (fs.existsSync(targetPath)) {
            const stat = fs.statSync(targetPath);
            if (stat.isDirectory()) {
              fs.rmSync(targetPath, { recursive: true, force: true });
            } else {
              fs.unlinkSync(targetPath);
            }
          }
        } catch (_) {
          // If Windows locked file momentarily while closing descriptor, retry after short delay
          setTimeout(() => {
            try {
              if (fs.existsSync(targetPath)) {
                const stat = fs.statSync(targetPath);
                if (stat.isDirectory()) {
                  fs.rmSync(targetPath, { recursive: true, force: true });
                } else {
                  fs.unlinkSync(targetPath);
                }
              }
            } catch (_) {}
          }, 300);
        }
      };

      // 1. Delete main downloaded file
      if (task.savePath) unlinkSafely(task.savePath);

      // 2. Delete partial download file (.part)
      if (task.savePath) unlinkSafely(`${task.savePath}.part`);

      // 3. Delete temporary chunk files
      try {
        const config = this.getConfig();
        const tempDir = config.tempDir || (task.savePath ? path.dirname(task.savePath) : null);
        if (tempDir) {
          const taskTempDir = path.join(tempDir, task.id);
          unlinkSafely(taskTempDir);
        }
      } catch (_) {}
    }

    this.tasks.delete(id);
    this.saveState();
    this.emit('taskDeleted', id);
    this.processQueue();
    return true;
  }

  clearCompleted() {
    for (const [id, task] of this.tasks.entries()) {
      if (task.status === 'completed') {
        this.tasks.delete(id);
      }
    }
    this.saveState();
  }

  async extractTask(id) {
    const task = this.tasks.get(id);
    if (!task || !task.savePath) return { success: false, error: 'Task or file not found' };
    if (!isArchiveFile(task.savePath)) return { success: false, error: 'Not an archive file' };

    task.extractStatus = 'extracting';
    this.emit('taskUpdated', task);

    const result = await unpackArchive(task.savePath);
    if (result.success) {
      task.extractStatus = 'extracted';
      task.extractedPath = result.outDir;
    } else {
      task.extractStatus = 'extract_failed';
      task.extractError = result.error;
    }
    this.saveState();
    this.emit('taskUpdated', task);
    return result;
  }

  async verifyChecksum(id) {
    const task = this.tasks.get(id);
    if (!task || !task.savePath || !fs.existsSync(task.savePath)) {
      return { success: false, error: 'File does not exist on disk' };
    }

    return new Promise((resolve) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(task.savePath);
      stream.on('data', chunk => hash.update(chunk));
      stream.on('end', () => {
        const sha256 = hash.digest('hex');
        task.verifiedSha256 = sha256;
        this.saveState();
        this.emit('taskUpdated', task);
        resolve({ success: true, sha256, verified: true });
      });
      stream.on('error', err => {
        resolve({ success: false, error: err.message });
      });
    });
  }

  batchPause(ids = []) {
    for (const id of ids) this.pauseDownload(id);
  }

  batchResume(ids = []) {
    for (const id of ids) this.resumeDownload(id);
  }

  batchDelete(ids = [], deleteFiles = false) {
    for (const id of ids) this.deleteTask(id, deleteFiles);
  }

  setPowerAction(action) {
    if (['none', 'sleep', 'shutdown'].includes(action)) {
      this.powerActionOnComplete = action;
      return true;
    }
    return false;
  }

  getPowerAction() {
    return this.powerActionOnComplete;
  }

  getAllTasks() {
    return Array.from(this.tasks.values());
  }

  getRecentAverageSpeed(count = 10) {
    const completed = Array.from(this.tasks.values())
      .filter(t => t.status === 'completed' && t.totalBytes > 0)
      .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));

    const samples = completed.slice(0, count);
    if (samples.length === 0) {
      return { avgSpeed: 10 * 1024 * 1024, count: 0, formattedAvg: '10.0 MB/s (Default)' };
    }

    const validSpeeds = [];
    for (const t of samples) {
      if (t.averageSpeed && t.averageSpeed > 1024) {
        validSpeeds.push(t.averageSpeed);
      } else if (t.completedAt && t.addedAt && (t.completedAt - t.addedAt) > 200) {
        const sec = (t.completedAt - t.addedAt) / 1000;
        const spd = Math.round(t.totalBytes / sec);
        if (spd > 1024) validSpeeds.push(spd);
      }
    }

    if (validSpeeds.length === 0) {
      return { avgSpeed: 10 * 1024 * 1024, count: samples.length, formattedAvg: '10.0 MB/s (Default)' };
    }

    const sum = validSpeeds.reduce((acc, v) => acc + v, 0);
    const avg = Math.round(sum / validSpeeds.length);
    return {
      avgSpeed: avg,
      count: validSpeeds.length,
      formattedAvg: this.formatSpeed(avg)
    };
  }

  isMediaFile(filename, contentType = '') {
    if (contentType.startsWith('video/') || contentType.startsWith('audio/')) return true;
    const ext = path.extname(filename || '').toLowerCase();
    const mediaExts = ['.mp4', '.mkv', '.webm', '.avi', '.mov', '.wmv', '.flv', '.m4v', '.ts', '.mp3', '.flac', '.m4a', '.wav', '.aac', '.ogg', '.opus'];
    return mediaExts.includes(ext);
  }

  formatSpeed(bytes) {
    if (!bytes || bytes === 0) return '0.0 KB/s';
    if (bytes >= 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB/s';
    if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB/s';
    return (bytes / 1024).toFixed(1) + ' KB/s';
  }

  formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  async probeUrl(rawUrl, options = {}) {
    const cleanUrl = (rawUrl || '').trim();
    if (!cleanUrl || !cleanUrl.startsWith('http')) {
      throw new Error('Please provide a valid HTTP or HTTPS download URL.');
    }

    const config = getConfig();
    const speedStats = this.getRecentAverageSpeed(10);
    const avgSpeed = speedStats.avgSpeed;

    // Check if YouTube / stream media
    if (isMediaUrl(cleanUrl)) {
      try {
        const info = await probeMedia(cleanUrl);
        const title = info.title || 'Video Download';
        const safeTitle = title.replace(/[<>:"/\\|?*]/g, '_');
        const filename = `${safeTitle}.mp4`;
        const totalBytes = info.filesize || 0;
        const dest = resolveDestinationPath(filename, { isMedia: true, mediaType: 'video' });
        const estimatedTimeSec = (totalBytes > 0 && avgSpeed > 0) ? Math.ceil(totalBytes / avgSpeed) : 0;

        return {
          url: cleanUrl,
          filename,
          totalBytes,
          formattedSize: totalBytes > 0 ? this.formatBytes(totalBytes) : 'Dynamic Stream',
          acceptRanges: true,
          contentType: 'video/mp4',
          isMedia: true,
          mediaTitle: title,
          mediaAuthor: info.author || '',
          mediaDuration: info.duration || 0,
          mediaThumbnail: info.thumbnail || '',
          category: 'Video',
          defaultSaveDir: dest.folder,
          savePath: dest.savePath,
          avgSpeed,
          historyCount: speedStats.count,
          formattedAvgSpeed: speedStats.formattedAvg,
          estimatedTimeSec,
          server: 'YouTube / Media Stream'
        };
      } catch (errMedia) {
        console.warn('[Waterfall Probe] probeMedia fallback:', errMedia.message);
      }
    }

    let filename = '';
    let totalBytes = 0;
    let acceptRanges = false;
    let contentType = '';
    let server = '';

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6500);

      // Try HEAD first
      let res = await fetch(cleanUrl, {
        method: 'HEAD',
        signal: controller.signal,
        headers: {
          'User-Agent': config.customUserAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) WaterfallDL/2.0'
        }
      }).catch(() => null);

      if (!res || !res.ok) {
        // Fallback to GET range 0-0
        res = await fetch(cleanUrl, {
          method: 'GET',
          signal: controller.signal,
          headers: {
            'User-Agent': config.customUserAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) WaterfallDL/2.0',
            'Range': 'bytes=0-0'
          }
        });
      }

      clearTimeout(timeout);

      contentType = (res.headers.get('content-type') || '').toLowerCase();
      server = res.headers.get('server') || '';

      const cr = res.headers.get('content-range');
      if (cr) {
        acceptRanges = true;
        const m = cr.match(/\/(\d+)$/);
        if (m) totalBytes = parseInt(m[1], 10);
      }

      if (!totalBytes && res.headers.has('content-length')) {
        totalBytes = parseInt(res.headers.get('content-length'), 10) || 0;
      }

      if (res.headers.get('accept-ranges') === 'bytes') {
        acceptRanges = true;
      }

      const cd = res.headers.get('content-disposition');
      if (cd) {
        const matchStar = cd.match(/filename\*=UTF-8''([^;\r\n]+)/i);
        const matchNorm = cd.match(/filename="?([^";\r\n]+)"?/i);
        if (matchStar && matchStar[1]) {
          try { filename = decodeURIComponent(matchStar[1].trim()); } catch (_) { filename = matchStar[1].trim(); }
        } else if (matchNorm && matchNorm[1]) {
          filename = matchNorm[1].trim();
        }
      }
    } catch (err) {
      console.warn('[Waterfall Probe] Direct fetch probe note:', err.message);
    }

    if (!filename) {
      try {
        const u = new URL(cleanUrl);
        const base = path.basename(u.pathname);
        if (base && base !== 'download' && base !== 'download.php') {
          filename = decodeURIComponent(base);
        }
      } catch (_) {}
    }

    if (!filename || isGenericTitle(filename)) {
      filename = 'download_' + Date.now();
    }

    const isMedia = this.isMediaFile(filename, contentType);
    const dest = resolveDestinationPath(filename, {
      isMedia,
      mediaType: isMedia ? (contentType.startsWith('audio') ? 'audio' : 'video') : null
    });
    const estimatedTimeSec = (totalBytes > 0 && avgSpeed > 0) ? Math.ceil(totalBytes / avgSpeed) : 0;

    return {
      url: cleanUrl,
      filename,
      totalBytes,
      formattedSize: totalBytes > 0 ? this.formatBytes(totalBytes) : 'Unknown / Stream',
      acceptRanges,
      contentType,
      server,
      isMedia,
      category: dest.category,
      defaultSaveDir: dest.folder,
      savePath: dest.savePath,
      avgSpeed,
      historyCount: speedStats.count,
      formattedAvgSpeed: speedStats.formattedAvg,
      estimatedTimeSec
    };
  }

  getTask(id) {
    return this.tasks.get(id);
  }
}

const downloadManager = new DownloadManager();
module.exports = downloadManager;
