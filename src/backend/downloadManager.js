const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { exec, execFile } = require('child_process');
const ChunkDownloader = require('./chunkDownloader');
const { MediaDownloader, isMediaUrl, isGenericTitle, probeMedia } = require('./mediaDownloader');
const { getConfig, saveConfig } = require('./config');
const { getCategoryFromFilename } = require('./linkGrabber');
const { resolveDestinationPath, preserveMetadata } = require('./folderManager');
const { isArchiveFile } = require('./archiveUnpacker');
const { executePostDownloadScript } = require('./scriptRunner');
const { resolveBestFilename, sanitizeFilename } = require('./namingEngine');
const extractionQueue = require('./extractionQueue');
const queueManager = require('./queueManager');
const { parseMultipartInfo, findRootArchivePart, isVideoFilename } = require('./multipartMatcher');
const mediaPrefetcher = require('./mediaPrefetcher');
const { getStorageFilePath, safeReadJson, safeWriteJsonSync } = require('./storagePaths');

const STATE_FILE = getStorageFilePath('downloads.json');

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

    // YouTube / YouTube Music
    if (u.hostname.includes('youtube.com') || u.hostname.includes('youtu.be')) {
      const vid = u.searchParams.get('v')
        || (u.hostname.includes('youtu.be') ? u.pathname.replace(/^\/+/, '').split('/')[0].split('?')[0] : null)
        || (u.pathname.match(/\/(?:shorts|embed|v)\/([a-zA-Z0-9_-]+)/) || [])[1];
      if (vid) return `youtube:${vid}`;
      const listId = u.searchParams.get('list');
      if (listId) return `youtube:playlist:${listId}`;
    }

    // Generic clean resource path
    const cleanPath = path.basename(u.pathname).toLowerCase();
    const genericPaths = new Set([
      'download', 'download.php', 'watch', 'view', 'video', 'play',
      'stream', 'media', 'index', 'index.php', 'get', 'file', 'content', 'load', 'blob'
    ]);
    if (cleanPath && !genericPaths.has(cleanPath) && cleanPath.length > 3) {
      return `${u.hostname}:${cleanPath}`;
    }
  } catch (_) {}
  return '';
}

function extractCanonicalYoutubeUrl(url, sourceUrl) {
  const testUrl = (u) => {
    if (!u || typeof u !== 'string') return null;
    if (u.includes('youtube.com') || u.includes('youtu.be')) {
      const m = u.match(/(?:watch\?.*v=|youtu\.be\/|shorts\/|embed\/)([a-zA-Z0-9_-]{11})/i);
      if (m && m[1]) return `https://www.youtube.com/watch?v=${m[1]}`;
    }
    return null;
  };
  return testUrl(url) || testUrl(sourceUrl) || null;
}

function makeUniqueFilename(folder, filename) {
  if (!folder || !filename) return filename || 'download';
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);
  let candidateName = filename;
  let counter = 1;
  while (fs.existsSync(path.join(folder, candidateName))) {
    candidateName = `${base} (${counter})${ext}`;
    counter++;
  }
  return candidateName;
}

function findExistingMatchingTask(tasks, options = {}, filename = '', savePath = '') {
  const normName = normalizeFileTitle(filename);
  const optUrl = (options.url || '').trim();
  const optDirect = (options.directUrl || '').trim();
  const newResourceKey = getUrlResourceKey(optDirect || optUrl);

  const candidates = [];

  for (const t of tasks.values()) {
    const isCompleted = t.status === 'completed';
    const diskExists = t.savePath ? fs.existsSync(t.savePath) : false;

    // 1. Check completed tasks: must exist on disk
    if (isCompleted && diskExists) {
      const tNorm = normalizeFileTitle(t.name);
      const isUrlMatch = Boolean(
        (optUrl && (t.url === optUrl || t.directUrl === optUrl)) ||
        (optDirect && (t.url === optDirect || t.directUrl === optDirect))
      );
      const isKeyMatch = Boolean(
        newResourceKey && getUrlResourceKey(t.directUrl || t.url) === newResourceKey
      );
      const isPathMatch = Boolean(
        savePath && t.savePath && path.resolve(savePath).toLowerCase() === path.resolve(t.savePath).toLowerCase()
      );
      const isNameMatch = Boolean(normName && tNorm && normName === tNorm && !isGenericTitle(normName));

      if (isUrlMatch || isKeyMatch || isPathMatch || isNameMatch) {
        return { targetTask: t, isCompletedOnDisk: true };
      }
      continue;
    }

    if (isCompleted && !diskExists) {
      continue;
    }

    let score = 0;

    // 1. Exact URL match
    if (t.url === optUrl || t.directUrl === optUrl || (optDirect && (t.url === optDirect || t.directUrl === optDirect))) {
      score += 100;
    }

    // 2. URL Resource key match
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
      const clean1 = path.resolve(t.savePath).toLowerCase();
      const clean2 = path.resolve(savePath).toLowerCase();
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
  const tempDir = config.tempDir || path.join(os.tmpdir(), 'Waterfall', 'temp');
  let recoveredBytes = 0;

  // 1. Check isolated Windows Temp metadata file, then fallback to legacy:
  const tempMetaPath = path.join(os.tmpdir(), 'Waterfall', 'metadata', `${task.id}.meta.json`);
  const savePathPart = `${task.savePath}.part`;
  const legacyMetaPath = `${savePathPart}.meta.json`;
  const metaPath = fs.existsSync(tempMetaPath) ? tempMetaPath : (fs.existsSync(legacyMetaPath) ? legacyMetaPath : null);

  if (metaPath) {
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      if (Array.isArray(meta.segments) && meta.segments.length > 0) {
        task.segments = meta.segments;
        recoveredBytes = meta.segments.reduce((acc, s) => acc + (s.downloadedBytes || 0), 0);
        task.downloadedBytes = recoveredBytes;
        if (meta.totalBytes > 0) task.totalBytes = meta.totalBytes;
        return recoveredBytes;
      }
    } catch (_) {}
  }

  // 2. Existing in-memory segments for inPlace mode (preserve them! Never reset to 0):
  if (Array.isArray(task.segments) && task.segments.length > 0 && (task.downloadEngineMode === 'inPlace' || !task.downloadEngineMode)) {
    recoveredBytes = task.segments.reduce((acc, s) => acc + (s.downloadedBytes || 0), 0);
    task.downloadedBytes = Math.max(task.downloadedBytes || 0, recoveredBytes);
    return task.downloadedBytes;
  }

  // 3. Multi-segment parts for legacyTemp mode:
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
        }
        recoveredBytes += (seg.downloadedBytes || 0);
      }
    }
  }

  // 4. Single part file in temp:
  const part0 = path.join(tempDir, `${task.id}_seg_0.part`);
  if (fs.existsSync(part0)) {
    try {
      const sz = fs.statSync(part0).size;
      recoveredBytes = Math.max(recoveredBytes, sz);
    } catch (_) {}
  }

  // 5. Target folder part file:
  if (fs.existsSync(savePathPart)) {
    try {
      const sz = fs.statSync(savePathPart).size;
      recoveredBytes = Math.max(recoveredBytes, sz);
    } catch (_) {}
  }

  task.downloadedBytes = Math.max(task.downloadedBytes || 0, recoveredBytes);
  return task.downloadedBytes;
}

class DownloadManager extends EventEmitter {
  constructor() {
    super();
    this.tasks = new Map(); // id -> task
    this.activeDownloaders = new Map(); // id -> Downloader instance
    this.queueOrder = []; // ordered list of task IDs
    this.globalSpeed = 0;
    this.lastBytesCheck = new Map();
    this.lastSpeedCheckTime = Date.now();
    this.groupWaitingTimers = new Map(); // groupKey -> setTimeout timer

    this._saveTimeout = null;
    this._hasLoaded = false;
    this._explicitlyEmptied = false;
    this.loadState();
    this.startSpeedMonitor();
    this.setupExtractionListener();
    this.powerActionOnComplete = 'none';

    // Hook media prefetcher to advance queue when prefetch finishes
    mediaPrefetcher.onCheckMore = () => {
      mediaPrefetcher.checkQueue(this.tasks, (t) => {
        this.saveState();
        this.emit('taskUpdated', t);
      });
    };

    // Synchronously flush state on process termination
    process.on('exit', () => this.saveState(true));
    process.on('SIGINT', () => { this.saveState(true); process.exit(0); });
    process.on('SIGTERM', () => { this.saveState(true); process.exit(0); });
  }

  setupExtractionListener() {
    extractionQueue.on('jobUpdated', (job) => {
      const affected = [];
      if (job.groupKey) {
        for (const t of this.tasks.values()) {
          if (t.multipart && t.multipart.groupKey === job.groupKey) {
            affected.push(t);
          }
        }
      } else if (job.taskId) {
        const t = this.tasks.get(job.taskId);
        if (t) affected.push(t);
      }

      for (const t of affected) {
        t.extractStatus = job.status;
        if (job.outDir) t.extractedPath = job.outDir;
        if (job.error) t.extractError = job.error;
        if (job.passwordRequired) t.extractPasswordRequired = true;
        else if (job.status === 'extracted') t.extractPasswordRequired = false;
        this.emit('taskUpdated', t);
      }
      this.saveState();
    });

    extractionQueue.on('passwordRequired', (job) => {
      this.emit('extractPasswordRequired', {
        jobId: job.id,
        taskId: job.taskId,
        groupKey: job.groupKey,
        name: job.name,
        archivePath: job.archivePath
      });
    });
  }

  loadState() {
    try {
      const list = safeReadJson(STATE_FILE, []);
      if (Array.isArray(list) && list.length > 0) {
        for (let i = 0; i < list.length; i++) {
          const t = list[i];
          if (t.status === 'downloading' || t.status === 'assembling' || t.status === 'retrying') {
            t.status = 'paused';
            t.retrying = false;
            t.retryInSec = 0;
            t.speed = 0;
            t.eta = 0;
          }

          if (!t.priority) t.priority = 'normal';
          if (t.queueOrder === undefined) t.queueOrder = i;

          // Multipart detection enrichment if missing
          if (!t.multipart) {
            t.multipart = parseMultipartInfo(t.name, t.packageName);
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
              } else if (t.isMedia && sz > 1024) {
                t.status = 'completed';
                t.totalBytes = sz;
                t.downloadedBytes = sz;
                t.speed = 0;
                t.eta = 0;
              }
            } catch (_) {}
          }

          this.tasks.set(t.id, t);
          this.queueOrder.push(t.id);
        }
      }
      this._hasLoaded = true;
      console.log(`[Waterfall Storage] Loaded ${this.tasks.size} download tasks from storage (${STATE_FILE})`);
    } catch (e) {
      console.warn('[Waterfall Storage] Failed to load downloads state:', e.message);
    }
  }

  saveState(immediate = false) {
    if (this._saveTimeout) {
      clearTimeout(this._saveTimeout);
      this._saveTimeout = null;
    }

    const doSave = () => {
      try {
        // Prevent saving if initial state has not loaded and task map is empty
        if (!this._hasLoaded && this.tasks.size === 0) {
          return;
        }

        const orderMap = new Map();
        this.queueOrder.forEach((id, idx) => orderMap.set(id, idx));

        const list = Array.from(this.tasks.values()).map(t => ({
          ...t,
          speed: 0,
          eta: 0,
          queueOrder: orderMap.has(t.id) ? orderMap.get(t.id) : (t.queueOrder || 0)
        }));

        safeWriteJsonSync(STATE_FILE, list, { allowEmpty: this._explicitlyEmptied });
      } catch (e) {
        console.warn('[Waterfall Storage] Failed to save downloads state:', e.message);
      }
    };

    if (immediate) {
      doSave();
    } else {
      this._saveTimeout = setTimeout(() => doSave(), 150);
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

          // Trigger custom script when target percentage is reached
          const triggerTarget = (task.triggerAtPercent !== undefined && task.triggerAtPercent !== 100)
            ? task.triggerAtPercent
            : (task.customScript && task.customScript.triggerAtPercent ? Number(task.customScript.triggerAtPercent) : 0);

          if (triggerTarget > 0 && triggerTarget < 100 && !task._triggerAtPercentFired) {
            const currentPct = (task.totalBytes > 0) ? (task.downloadedBytes / task.totalBytes) * 100 : 0;
            if (currentPct >= triggerTarget) {
              task._triggerAtPercentFired = true;
              if (task.customScript && task.customScript.enabled) {
                const config = getConfig();
                executePostDownloadScript(task, config).catch(() => {});
              }
            }
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
      if (t.status === 'downloading' || t.status === 'assembling') count++;
    }
    return count;
  }

  processQueue() {
    const toStart = queueManager.scheduleNext(this.tasks, this.activeDownloaders, this.queueOrder);
    for (const task of toStart) {
      this.startDownload(task.id);
    }
    // Pre-resolve stream URLs in background for queued tracks
    mediaPrefetcher.checkQueue(this.tasks, (updatedTask) => {
      this.saveState();
      this.emit('taskUpdated', updatedTask);
    });
    this.checkQueueFinished();
  }

  checkQueueFinished() {
    if (this.tasks.size === 0) return;
    const hasPending = Array.from(this.tasks.values()).some(
      t => t.status === 'queued' || t.status === 'downloading' || t.status === 'assembling' || t.status === 'retrying'
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
    console.log(`[Waterfall Power] Queue finished. Executing power action: ${action}`);
    if (action === 'shutdown') {
      exec('shutdown /s /t 60 /c "Waterfall download queue completed. Shutting down system in 60 seconds (run shutdown /a in PowerShell to cancel)."');
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

    // Canonicalize YouTube / googlevideo URLs
    let taskUrl = (options.url || '').trim();
    const ytCanonical = extractCanonicalYoutubeUrl(taskUrl, options.source);
    if (ytCanonical) {
      taskUrl = ytCanonical;
      options.isMedia = true;
    } else if (taskUrl.includes('googlevideo.com') || taskUrl.startsWith('blob:') || taskUrl.includes('/videoplayback')) {
      if (options.source && isMediaUrl(options.source)) {
        taskUrl = options.source;
        options.isMedia = true;
      }
    }
    options.url = taskUrl;

    const isMedia = Boolean(options.isMedia || isMediaUrl(taskUrl));
    let mediaOptions = options.mediaOptions;
    if (!mediaOptions && isMedia) {
      const isAudioHint = options.filename && /\.(mp3|m4a|flac|wav|ogg|opus)$/i.test(options.filename);
      if (isAudioHint) {
        mediaOptions = { mediaType: 'audio', audioFormat: 'mp3', audioQuality: '0' };
      } else {
        mediaOptions = { mediaType: 'video', videoQuality: config.defaultVideoQuality || '1080' };
      }
    }

    let filename = resolveBestFilename({
      explicitFilename: options.filename,
      contentDisposition: '',
      finalUrl: options.directUrl || '',
      initialUrl: options.url,
      packageName: options.packageName,
      isMedia
    });

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

    // User explicitly chose to update existing task link and resume
    if (options.updateExistingId) {
      const existing = this.tasks.get(options.updateExistingId);
      if (existing) {
        return this.updateTaskUrl(options.updateExistingId, options.url);
      }
    }

    // Check if an existing task for the exact same file already exists in queue/history
    const matchResult = !options.allowDuplicate ? findExistingMatchingTask(this.tasks, options, filename, savePath) : null;

    if (options.allowDuplicate) {
      filename = makeUniqueFilename(saveFolder, filename);
      savePath = path.join(saveFolder, filename);
    } else if (matchResult) {
      if (matchResult.isCompletedOnDisk) {
        console.log(`[Waterfall] Task "${matchResult.targetTask.name}" (${matchResult.targetTask.id}) is already completed on disk.`);
        return { ...matchResult.targetTask, isDuplicate: true };
      }

      const targetTask = matchResult.targetTask;
      console.log(`[Waterfall] Auto-updating URL for existing incomplete task "${targetTask.name}" (${targetTask.id}). Resuming...`);

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
      if (options.downloadHeaders) targetTask.downloadHeaders = options.downloadHeaders;
      if (options.archivePassword) targetTask.archivePassword = options.archivePassword;
      if (options.autoExtract !== undefined) targetTask.autoExtract = Boolean(options.autoExtract);
      if (options.deleteAfterExtract !== undefined) targetTask.deleteAfterExtract = Boolean(options.deleteAfterExtract);

      const downloader = this.activeDownloaders.get(targetTask.id);
      if (downloader) {
        if (typeof downloader.pause === 'function') downloader.pause();
        this.activeDownloaders.delete(targetTask.id);
      }

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

    // Multipart detection and grouping (guard: Videos are NEVER multipart archives!)
    let multipart = parseMultipartInfo(filename, options.packageName);
    if (category === 'Video' || isMedia || isVideoFilename(filename)) {
      multipart = {
        isMultipart: false,
        groupKey: null,
        baseName: filename,
        partNumber: 1,
        isRootPart: false,
        format: null
      };
    }

    const task = {
      id,
      name: filename,
      category,
      packageName: options.packageName || '',
      url: options.url,
      directUrl: options.directUrl || options.url,
      hoster: isMedia ? 'YouTube / Media' : (options.hoster || 'Direct Web'),
      status: options.autoStart ? 'queued' : 'paused',
      priority: options.priority || 'normal', // 'high' | 'normal' | 'low'
      queueOrder: this.queueOrder.length,
      retryCount: 0,
      maxRetries: config.maxRetries || 5,
      totalBytes: options.size || 0,
      downloadedBytes: 0,
      speed: 0,
      eta: 0,
      savePath,
      acceptRanges: options.acceptRanges !== false,
      downloadHeaders: options.downloadHeaders || null,
      isMedia,
      mediaOptions,
      isPlaylist: Boolean(options.isPlaylist),
      playlistId: options.playlistId || null,
      playlistGroup: options.playlistGroup || null,
      streamPreResolved: Boolean(options.streamPreResolved),
      addedAt: Date.now(),
      startedAt: null,
      completedAt: null,
      averageSpeed: 0,
      customScript: options.customScript || null,
      error: null,
      downloadEngineMode,
      singleStream: isSingleStream,
      segmentsCount,
      segments: [],
      // Multipart archive attributes
      multipart,
      // Decompression & password attributes
      archivePassword: options.archivePassword || '',
      autoExtract: options.autoExtract !== undefined ? Boolean(options.autoExtract) : (config.autoExtractArchives !== false),
      deleteAfterExtract: options.deleteAfterExtract !== undefined ? Boolean(options.deleteAfterExtract) : (config.deleteArchiveAfterExtract === true),
      extractStatus: 'none', // 'none' | 'extract_queued' | 'extracting' | 'extracted' | 'extract_failed' | 'extract_password_required' | 'waiting_all_parts'
      extractedPath: null,
      extractError: null,
      // Speed Limiter & Post-Actions
      speedLimitEnabled: Boolean(options.speedLimitEnabled),
      speedLimitBytesPerSec: options.speedLimitBytesPerSec ? Math.max(0, parseInt(options.speedLimitBytesPerSec, 10)) : 0,
      onCompleteAction: options.onCompleteAction || 'none', // 'none' | 'closeDialog' | 'openFile' | 'openFolder' | 'sleep' | 'shutdown'
      triggerAtPercent: options.triggerAtPercent ? Number(options.triggerAtPercent) : null
    };

    this.tasks.set(id, task);
    this.queueOrder.push(id);

    if (!options.skipSaveState) {
      this.saveState();
    }

    if (!options.skipEmitCreated) {
      this.emit('taskCreated', task);
    }

    if (options.autoStart && !options.skipProcessQueue) {
      this.processQueue();
    } else {
      mediaPrefetcher.checkQueue(this.tasks, (t) => {
        this.saveState();
        this.emit('taskUpdated', t);
      });
    }

    return task;
  }

  createBatchTasks(taskList = [], globalOptions = {}) {
    const createdTasks = [];
    let duplicateCount = 0;
    const pkgName = globalOptions.packageName || (taskList[0] && taskList[0].packageName) || 'YouTube Playlist';
    const isPlaylist = Boolean(globalOptions.isPlaylist || (taskList.length > 1 && taskList.some(t => t.isMedia)));
    const playlistId = globalOptions.playlistId || ('pl_' + pkgName.replace(/[^\w]/g, '_') + '_' + Date.now());

    let index = 0;
    for (const itemOptions of taskList) {
      index++;
      const mergedOptions = {
        ...globalOptions,
        ...itemOptions,
        packageName: itemOptions.packageName || pkgName,
        isPlaylist,
        playlistId,
        playlistGroup: isPlaylist ? {
          id: playlistId,
          name: pkgName,
          totalTracks: taskList.length,
          index
        } : null
      };

      const task = this.createTask({
        ...mergedOptions,
        skipSaveState: true,
        skipProcessQueue: true,
        skipEmitCreated: true
      });

      if (task) {
        if (task.isDuplicate) {
          duplicateCount++;
        } else {
          createdTasks.push(task);
          this.emit('taskCreated', task);
        }
      }
    }

    if (createdTasks.length > 0) {
      this.saveState(true);
      if (globalOptions.autoStart !== false) {
        this.processQueue();
      } else {
        mediaPrefetcher.checkQueue(this.tasks, (t) => {
          this.saveState();
          this.emit('taskUpdated', t);
        });
      }
    }

    return {
      created: createdTasks,
      duplicateCount,
      count: createdTasks.length,
      playlistId
    };
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
          const scheduled = queueManager.scheduleAutoRetry(task, err.message, () => this.processQueue());
          if (!scheduled) {
            task.status = 'error';
            task.error = task.error || err.message;
            this.emit('taskFailed', { task, error: task.error });
          }
          this.saveState();
          this.emit('taskUpdated', task);
          this.processQueue();
        }
      );
      this.saveState();
      return;
    }

    const speedLimitBytesPerSec = (task.speedLimitEnabled && task.speedLimitBytesPerSec > 0)
      ? task.speedLimitBytesPerSec
      : ((config.speedLimitEnabled && config.speedLimitBytesPerSec > 0) ? config.speedLimitBytesPerSec : 0);

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
      t.retryCount = 0;
      const durationSec = Math.max(0.1, (t.completedAt - (t.startedAt || t.addedAt)) / 1000);
      if (t.totalBytes > 0) t.averageSpeed = Math.round(t.totalBytes / durationSec);
      await this.handleCompletion(t);
    });

    downloader.on('linkExpired', async () => {
      this.activeDownloaders.delete(id);
      const refreshed = await this.autoRefreshAndResume(task);
      if (!refreshed) {
        task.status = 'paused';
        task.error = 'Download link expired. Click "Update URL" to refresh and resume.';
        this.saveState();
        this.emit('taskUpdated', task);
        this.processQueue();
      }
    });

    downloader.on('error', async (err) => {
      this.activeDownloaders.delete(id);
      const isExpired = /401|403|404|410|expired/i.test(err.message || '');
      if (isExpired && task.url && task.url.startsWith('http')) {
        const refreshed = await this.autoRefreshAndResume(task);
        if (refreshed) return;
      }

      const scheduled = queueManager.scheduleAutoRetry(task, err.message, () => this.processQueue());
      if (!scheduled) {
        task.status = 'error';
        task.error = task.error || err.message;
        this.emit('taskFailed', { task, error: task.error });
      }
      this.saveState();
      this.emit('taskUpdated', task);
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

    // Extraction & Multipart Grouping Handling
    const shouldExtract = (t.autoExtract !== undefined) ? t.autoExtract : (config.autoExtractArchives !== false);

    if (shouldExtract && isArchiveFile(t.savePath)) {
      // 1. Check if multipart
      if (t.multipart && t.multipart.isMultipart && t.multipart.groupKey) {
        const groupKey = t.multipart.groupKey;
        const siblingTasks = Array.from(this.tasks.values()).filter(sibling =>
          sibling.multipart && sibling.multipart.groupKey === groupKey
        );

        const allCompleted = siblingTasks.every(s => s.status === 'completed');

        if (!allCompleted) {
          const remaining = siblingTasks.filter(s => s.status !== 'completed');
          t.extractStatus = 'waiting_all_parts';
          console.log(`[Waterfall Multipart] Group "${groupKey}" part complete. Waiting for ${remaining.length} more part(s)...`);
          this.emit('taskUpdated', t);

          // Clear any existing group countdown timer
          if (this.groupWaitingTimers.has(groupKey)) {
            clearTimeout(this.groupWaitingTimers.get(groupKey));
          }

          // Auto-Force Timeout: If waiting for parts, after a configured timeout (default 20s),
          // auto-force download remaining parts so they don't sit idle, or force extract available parts!
          const timeoutSec = config.multipartAutoForceTimeoutSec || 20;
          const timer = setTimeout(() => {
            this.groupWaitingTimers.delete(groupKey);
            const currentSiblings = Array.from(this.tasks.values()).filter(sibling =>
              sibling.multipart && sibling.multipart.groupKey === groupKey
            );
            const pending = currentSiblings.filter(s => s.status !== 'completed');
            if (pending.length > 0) {
              console.log(`[Waterfall Multipart] Group "${groupKey}" waiting timeout reached (${timeoutSec}s). Auto-forcing download of remaining parts...`);
              for (const p of pending) {
                if (p.status === 'paused' || p.status === 'queued') {
                  p.status = 'queued';
                  p.priority = 'high';
                  this.startDownload(p.id);
                }
              }
              this.emit('batchUpdated');
            } else {
              console.log(`[Waterfall Multipart] Group "${groupKey}" waiting timeout reached. Auto-extracting available parts now.`);
              this.triggerGroupExtraction(groupKey, currentSiblings, true);
            }
          }, timeoutSec * 1000);

          this.groupWaitingTimers.set(groupKey, timer);
        } else {
          // All parts are completed!
          if (this.groupWaitingTimers.has(groupKey)) {
            clearTimeout(this.groupWaitingTimers.get(groupKey));
            this.groupWaitingTimers.delete(groupKey);
          }
          this.triggerGroupExtraction(groupKey, siblingTasks, false);
        }
      } else {
        // Single archive extraction
        t.extractStatus = 'extract_queued';
        this.emit('taskUpdated', t);

        extractionQueue.enqueue({
          id: t.id,
          taskId: t.id,
          archivePath: t.savePath,
          password: t.archivePassword || '',
          deleteArchiveAfter: t.deleteAfterExtract !== undefined ? t.deleteAfterExtract : config.deleteArchiveAfterExtract,
          allPartPaths: [t.savePath]
        });
      }
    }

    // Execute on-completion actions (e.g. shutdown, sleep, openFile, openFolder)
    if (t.onCompleteAction === 'shutdown') {
      exec('shutdown /s /t 60 /c "Waterfall download finished. Shutting down system in 60 seconds."');
    } else if (t.onCompleteAction === 'sleep') {
      exec('rundll32.exe powrprof.dll,SetSuspendState 0,1,0');
    } else if (t.onCompleteAction === 'openFile' && t.savePath && fs.existsSync(t.savePath)) {
      try {
        exec(`start "" "${t.savePath}"`, { shell: 'cmd.exe' });
      } catch (_) {}
    } else if (t.onCompleteAction === 'openFolder' && t.savePath) {
      try {
        execFile('explorer.exe', [`/select,${t.savePath}`]);
      } catch (_) {}
    }

    // Trigger custom post-download script if enabled (globally or per-task)
    if (config.postDownloadScriptEnabled || (t.customScript && t.customScript.enabled)) {
      executePostDownloadScript(t, config).then(res => {
        if (res && !res.success && res.error) {
          console.warn(`[Waterfall] Post-download script warning for ${t.name}:`, res.stderr || res.error);
        } else if (res && res.success) {
          console.log(`[Waterfall] Post-download script succeeded for ${t.name}`);
        }
      }).catch(err => {
        console.error(`[Waterfall] Post-download script execution failed for ${t.name}:`, err.message);
      });
    }

    this.saveState(true);
    this.emit('taskCompleted', t);
    this.processQueue();
  }

  triggerGroupExtraction(groupKey, siblingTasks, force = false) {
    const config = getConfig();
    const completedTasks = siblingTasks.filter(s => s.status === 'completed');
    if (completedTasks.length === 0) return;

    const allPartPaths = completedTasks.map(s => s.savePath).filter(Boolean);
    const rootPart = findRootArchivePart(allPartPaths) || completedTasks[0].savePath;

    const saveDir = path.dirname(rootPart);
    const baseName = siblingTasks[0]?.multipart?.baseName || siblingTasks[0]?.packageName || 'Extracted';
    const outDir = path.join(saveDir, baseName);
    const groupPassword = (siblingTasks.find(s => s.archivePassword)?.archivePassword) || '';

    for (const s of completedTasks) {
      s.extractStatus = 'extract_queued';
      this.emit('taskUpdated', s);
    }

    extractionQueue.enqueue({
      id: groupKey,
      taskId: completedTasks[0].id,
      groupKey,
      archivePath: rootPart,
      outDir,
      password: groupPassword,
      deleteArchiveAfter: siblingTasks[0]?.deleteAfterExtract !== undefined ? siblingTasks[0].deleteAfterExtract : config.deleteArchiveAfterExtract,
      allPartPaths,
      forcePartial: force
    });
  }

  forceDownloadGroup(groupKey) {
    if (!groupKey) return;
    const siblingTasks = Array.from(this.tasks.values()).filter(t =>
      t.multipart && t.multipart.groupKey === groupKey
    );
    if (siblingTasks.length === 0) return;

    console.log(`[Waterfall Multipart] Force downloading all parts for group "${groupKey}" (${siblingTasks.length} parts)`);

    // 1. Force start any remaining/unstarted parts in group
    for (const task of siblingTasks) {
      if (task.status !== 'completed' && task.status !== 'downloading' && task.status !== 'assembling') {
        task.status = 'queued';
        task.priority = 'high';
        queueManager.clearRetryTimer(task.id);
        this.startDownload(task.id);
      }
    }

    // 2. If all available parts are already completed (even with holes like parts 3, 5, 7), force extract immediately!
    const allCurrentlyDone = siblingTasks.every(s => s.status === 'completed');
    if (allCurrentlyDone && siblingTasks.length > 0) {
      console.log(`[Waterfall Multipart] All available parts of group "${groupKey}" are complete. Forcing extraction now.`);
      this.triggerGroupExtraction(groupKey, siblingTasks, true);
    }

    this.emit('batchUpdated');
    this.saveState();
  }

  async autoRefreshAndResume(task) {
    if (!task || !task.url) return false;
    const hosterManager = require('./hosters');
    try {
      console.log(`[Waterfall] Link expired for task ${task.id} (${task.name}). Auto-refreshing direct URL via crawler...`);
      const resolved = await hosterManager.resolve(task.url);
      if (resolved && resolved.directUrl && resolved.directUrl !== task.directUrl) {
        console.log(`[Waterfall] Fresh direct URL retrieved for ${task.name}! Resuming immediately...`);
        task.directUrl = resolved.directUrl;
        if (resolved.downloadHeaders) {
          task.downloadHeaders = { ...(task.downloadHeaders || {}), ...resolved.downloadHeaders };
        }
        task.error = null;
        task.retryCount = 0;
        this.saveState(true);
        this.emit('taskUpdated', task);
        this.startDownload(task.id);
        return true;
      }
    } catch (e) {
      console.warn(`[Waterfall] Auto link refresh failed:`, e.message);
    }
    return false;
  }

  async pauseDownload(id) {
    const task = this.tasks.get(id);
    if (!task) return;

    queueManager.clearRetryTimer(id);

    const downloader = this.activeDownloaders.get(id);
    if (downloader) {
      if (typeof downloader.pause === 'function') {
        try { await downloader.pause(); } catch (_) {}
      }
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

    queueManager.clearRetryTimer(id);
    task.status = 'queued';
    task.retryCount = 0;
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

    queueManager.clearRetryTimer(id);

    const downloader = this.activeDownloaders.get(id);
    if (downloader) {
      if (typeof downloader.pause === 'function') downloader.pause();
      this.activeDownloaders.delete(id);
    }

    task.url = cleanUrl;
    task.directUrl = cleanUrl;
    task.error = null;
    task.retryCount = 0;
    task.status = 'queued';

    const config = getConfig();
    recoverPartialBytes(task, config);

    this.saveState(true);
    this.emit('taskUpdated', task);
    this.processQueue();
    return task;
  }

  pauseAll() {
    queueManager.pauseQueue();
    for (const id of Array.from(this.activeDownloaders.keys())) {
      this.pauseDownload(id);
    }
    for (const task of this.tasks.values()) {
      if (task.status === 'queued' || task.status === 'retrying') {
        queueManager.clearRetryTimer(task.id);
        task.status = 'paused';
      }
    }
    this.saveState();
  }

  resumeAll() {
    queueManager.resumeQueue();
    for (const task of this.tasks.values()) {
      if (task.status === 'paused' || task.status === 'error') {
        task.status = 'queued';
        task.retryCount = 0;
      }
    }
    this.saveState();
    this.processQueue();
  }

  deleteTask(id, deleteFile = false) {
    if (!id) return false;

    // Robust ID matching (handles string, number, and key variations)
    let task = this.tasks.get(id);
    let targetKey = id;

    if (!task && typeof id === 'string') {
      task = this.tasks.get(id.trim());
      if (task) targetKey = id.trim();
    }

    if (!task) {
      for (const [k, t] of this.tasks.entries()) {
        if (t.id === id || String(t.id) === String(id)) {
          task = t;
          targetKey = k;
          break;
        }
      }
    }

    if (!task) return false;

    queueManager.clearRetryTimer(targetKey);
    extractionQueue.cancel(targetKey);

    const downloader = this.activeDownloaders.get(targetKey);
    if (downloader) {
      try { downloader.cancel(); } catch (_) {}
      this.activeDownloaders.delete(targetKey);
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
          }, 400);
        }
      };

      if (task.savePath) unlinkSafely(task.savePath);
      if (task.savePath) unlinkSafely(`${task.savePath}.part`);

      // If task was unpacked, clean extracted directory if user deleted from disk
      if (task.extractedPath) {
        unlinkSafely(task.extractedPath);
      }

      try {
        const config = getConfig();
        const tempDir = config.tempDir || path.join(os.tmpdir(), 'Waterfall', 'temp');
        if (tempDir) {
          unlinkSafely(path.join(tempDir, task.id));
        }
        unlinkSafely(path.join(os.tmpdir(), 'Waterfall', 'chunks', task.id));
      } catch (_) {}
    }

    // Always clean up isolated metadata files from Windows temp
    try {
      const tempMetaPath = path.join(os.tmpdir(), 'Waterfall', 'metadata', `${task.id}.meta.json`);
      if (fs.existsSync(tempMetaPath)) {
        try { fs.unlinkSync(tempMetaPath); } catch (_) {}
      }
      if (task.savePath) {
        const legacyMetaPath = `${task.savePath}.part.meta.json`;
        if (fs.existsSync(legacyMetaPath)) {
          try { fs.unlinkSync(legacyMetaPath); } catch (_) {}
        }
      }
    } catch (_) {}

    this.tasks.delete(targetKey);
    if (task.id) this.tasks.delete(task.id);
    this.queueOrder = this.queueOrder.filter(qid => qid !== targetKey && qid !== task.id && String(qid) !== String(id));

    if (this.tasks.size === 0) {
      this._explicitlyEmptied = true;
    }

    this.saveState(true);
    this.emit('taskDeleted', targetKey);
    if (task.id && task.id !== targetKey) {
      this.emit('taskDeleted', task.id);
    }
    this.processQueue();
    return true;
  }

  clearCompleted() {
    const toDelete = [];
    for (const [id, task] of this.tasks.entries()) {
      if (task.status === 'completed') {
        toDelete.push(id);
      }
    }
    for (const id of toDelete) {
      this.tasks.delete(id);
      const idx = this.queueOrder.indexOf(id);
      if (idx !== -1) this.queueOrder.splice(idx, 1);
      this.emit('taskDeleted', id);
    }
    if (this.tasks.size === 0) {
      this._explicitlyEmptied = true;
    }
    this.saveState(true);
  }

  // Manual extract or password submit
  async extractTask(id, password = '') {
    const task = this.tasks.get(id);
    if (!task || !task.savePath) return { success: false, error: 'Task or file not found' };
    if (!isArchiveFile(task.savePath)) return { success: false, error: 'Not an archive file' };

    const config = getConfig();

    // Check if multipart
    if (task.multipart && task.multipart.isMultipart && task.multipart.groupKey) {
      const groupKey = task.multipart.groupKey;
      const siblingTasks = Array.from(this.tasks.values()).filter(sibling =>
        sibling.multipart && sibling.multipart.groupKey === groupKey
      );
      const allPartPaths = siblingTasks.map(s => s.savePath).filter(Boolean);
      const rootPart = findRootArchivePart(allPartPaths) || task.savePath;

      const saveDir = path.dirname(rootPart);
      const outDir = path.join(saveDir, task.multipart.baseName || task.packageName || 'Extracted');

      const job = extractionQueue.enqueue({
        id: groupKey,
        taskId: task.id,
        groupKey,
        archivePath: rootPart,
        outDir,
        password: password || task.archivePassword || '',
        deleteArchiveAfter: task.deleteAfterExtract !== undefined ? task.deleteAfterExtract : config.deleteArchiveAfterExtract,
        allPartPaths
      });
      return { success: true, queued: true, job };
    } else {
      const job = extractionQueue.enqueue({
        id: task.id,
        taskId: task.id,
        archivePath: task.savePath,
        password: password || task.archivePassword || '',
        deleteArchiveAfter: task.deleteAfterExtract !== undefined ? task.deleteAfterExtract : config.deleteArchiveAfterExtract,
        allPartPaths: [task.savePath]
      });
      return { success: true, queued: true, job };
    }
  }

  submitExtractionPassword(taskIdOrGroupKey, password, remember = false) {
    const job = extractionQueue.submitPassword(taskIdOrGroupKey, password, remember);
    if (job) {
      // Also update task state if found
      const task = this.tasks.get(taskIdOrGroupKey);
      if (task) {
        task.archivePassword = password;
        task.extractPasswordRequired = false;
        task.extractStatus = 'extract_queued';
        this.emit('taskUpdated', task);
        this.saveState();
      }
      return { success: true, job };
    }
    return { success: false, error: 'Extraction job not found' };
  }

  updateTaskOptions(taskId, options = {}) {
    const task = this.tasks.get(taskId);
    if (!task) return null;

    if (options.speedLimitEnabled !== undefined) {
      task.speedLimitEnabled = Boolean(options.speedLimitEnabled);
    }
    if (options.speedLimitBytesPerSec !== undefined) {
      task.speedLimitBytesPerSec = Math.max(0, parseInt(options.speedLimitBytesPerSec, 10) || 0);
    }
    const downloader = this.activeDownloaders.get(taskId);
    if (downloader && typeof downloader.setSpeedLimit === 'function') {
      downloader.setSpeedLimit(task.speedLimitEnabled ? task.speedLimitBytesPerSec : 0);
    }

    if (options.onCompleteAction !== undefined) {
      task.onCompleteAction = options.onCompleteAction;
    }
    if (options.triggerAtPercent !== undefined) {
      task.triggerAtPercent = options.triggerAtPercent ? Number(options.triggerAtPercent) : null;
    }
    if (options.customScript !== undefined) {
      task.customScript = options.customScript;
    }
    if (options.autoExtract !== undefined) {
      task.autoExtract = Boolean(options.autoExtract);
    }
    if (options.archivePassword !== undefined) {
      task.archivePassword = String(options.archivePassword || '').trim();
    }
    if (options.deleteAfterExtract !== undefined) {
      task.deleteAfterExtract = Boolean(options.deleteAfterExtract);
    }

    this.saveState();
    this.emit('taskUpdated', task);
    return task;
  }

  // Queue Priority and Reordering
  moveTaskUp(id) {
    const idx = this.queueOrder.indexOf(id);
    if (idx > 0) {
      const prev = this.queueOrder[idx - 1];
      this.queueOrder[idx - 1] = id;
      this.queueOrder[idx] = prev;
      this.saveState();
      this.emit('queueReordered', this.queueOrder);
      this.processQueue();
      return true;
    }
    return false;
  }

  moveTaskDown(id) {
    const idx = this.queueOrder.indexOf(id);
    if (idx !== -1 && idx < this.queueOrder.length - 1) {
      const next = this.queueOrder[idx + 1];
      this.queueOrder[idx + 1] = id;
      this.queueOrder[idx] = next;
      this.saveState();
      this.emit('queueReordered', this.queueOrder);
      this.processQueue();
      return true;
    }
    return false;
  }

  moveTaskToTop(id) {
    const idx = this.queueOrder.indexOf(id);
    if (idx !== -1) {
      this.queueOrder.splice(idx, 1);
      this.queueOrder.unshift(id);
      this.saveState();
      this.emit('queueReordered', this.queueOrder);
      this.processQueue();
      return true;
    }
    return false;
  }

  moveTaskToBottom(id) {
    const idx = this.queueOrder.indexOf(id);
    if (idx !== -1) {
      this.queueOrder.splice(idx, 1);
      this.queueOrder.push(id);
      this.saveState();
      this.emit('queueReordered', this.queueOrder);
      this.processQueue();
      return true;
    }
    return false;
  }

  setTaskPriority(id, priority) {
    const task = this.tasks.get(id);
    if (!task) return null;
    if (['high', 'normal', 'low'].includes(priority)) {
      task.priority = priority;
      this.saveState();
      this.emit('taskUpdated', task);
      this.processQueue();
      return task;
    }
    return null;
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
    return Array.from(this.tasks.values()).sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
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

        let existingMatch = null;
        const match = findExistingMatchingTask(this.tasks, { url: cleanUrl, ...options }, filename, dest.savePath);
        if (match) {
          const t = match.targetTask;
          const isDone = Boolean(match.isCompletedOnDisk || t.status === 'completed');
          const percent = (t.totalBytes > 0) ? Math.min(100, Math.round(((t.downloadedBytes || 0) / t.totalBytes) * 100)) : 0;
          existingMatch = {
            id: t.id,
            name: t.name || filename,
            status: t.status,
            isDone,
            isCompletedOnDisk: Boolean(match.isCompletedOnDisk),
            downloadedBytes: t.downloadedBytes || 0,
            totalBytes: t.totalBytes || 0,
            formattedSize: t.totalBytes > 0 ? this.formatBytes(t.totalBytes) : 'Dynamic Stream',
            percent,
            savePath: t.savePath || dest.savePath,
            url: t.url || cleanUrl
          };
        } else if (dest.savePath && fs.existsSync(dest.savePath)) {
          try {
            const st = fs.statSync(dest.savePath);
            if (st.size > 0) {
              existingMatch = {
                id: null,
                name: filename,
                status: 'completed',
                isDone: true,
                isCompletedOnDisk: true,
                downloadedBytes: st.size,
                totalBytes: st.size,
                formattedSize: this.formatBytes(st.size),
                percent: 100,
                savePath: dest.savePath,
                url: cleanUrl
              };
            }
          } catch (_) {}
        }

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
          server: 'YouTube / Media Stream',
          existingMatch
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

      let res = await fetch(cleanUrl, {
        method: 'HEAD',
        signal: controller.signal,
        headers: {
          'User-Agent': config.customUserAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) WaterfallDL/2.0'
        }
      }).catch(() => null);

      if (!res || !res.ok) {
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

      let finalUrl = res && res.url ? res.url : cleanUrl;
      const cd = res && res.headers ? res.headers.get('content-disposition') : '';

      filename = resolveBestFilename({
        explicitFilename: options.filename,
        contentDisposition: cd,
        finalUrl,
        initialUrl: cleanUrl,
        contentType,
        packageName: options.packageName,
        isMedia: false
      });
    } catch (err) {
      console.warn('[Waterfall Probe] Direct fetch probe note:', err.message);
      if (!filename) {
        filename = resolveBestFilename({
          explicitFilename: options.filename,
          initialUrl: cleanUrl,
          packageName: options.packageName
        });
      }
    }

    const isMedia = this.isMediaFile(filename, contentType);
    const dest = resolveDestinationPath(filename, {
      isMedia,
      mediaType: isMedia ? (contentType.startsWith('audio') ? 'audio' : 'video') : null
    });
    const estimatedTimeSec = (totalBytes > 0 && avgSpeed > 0) ? Math.ceil(totalBytes / avgSpeed) : 0;

    let multipart = parseMultipartInfo(filename, options.packageName);
    if (isMedia || dest.category === 'Video' || isVideoFilename(filename)) {
      multipart = { isMultipart: false, groupKey: null, baseName: filename, partNumber: 1, isRootPart: false, format: null };
    }

    // Check for existing matching task or completed file on disk
    let existingMatch = null;
    const match = findExistingMatchingTask(this.tasks, { url: cleanUrl, ...options }, filename, dest.savePath);
    if (match) {
      const t = match.targetTask;
      const isDone = Boolean(match.isCompletedOnDisk || t.status === 'completed');
      const percent = (t.totalBytes > 0) ? Math.min(100, Math.round(((t.downloadedBytes || 0) / t.totalBytes) * 100)) : 0;
      existingMatch = {
        id: t.id,
        name: t.name || filename,
        status: t.status,
        isDone,
        isCompletedOnDisk: Boolean(match.isCompletedOnDisk),
        downloadedBytes: t.downloadedBytes || 0,
        totalBytes: t.totalBytes || 0,
        formattedSize: t.totalBytes > 0 ? this.formatBytes(t.totalBytes) : 'Unknown',
        percent,
        savePath: t.savePath || dest.savePath,
        url: t.url || cleanUrl
      };
    } else if (dest.savePath && fs.existsSync(dest.savePath)) {
      try {
        const st = fs.statSync(dest.savePath);
        if (st.size > 0) {
          existingMatch = {
            id: null,
            name: filename,
            status: 'completed',
            isDone: true,
            isCompletedOnDisk: true,
            downloadedBytes: st.size,
            totalBytes: st.size,
            formattedSize: this.formatBytes(st.size),
            percent: 100,
            savePath: dest.savePath,
            url: cleanUrl
          };
        }
      } catch (_) {}
    }

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
      estimatedTimeSec,
      isArchive: isArchiveFile(filename),
      multipart,
      existingMatch
    };
  }

  updateTaskOptions(id, options = {}) {
    const task = this.tasks.get(id);
    if (!task) return null;

    if (options.speedLimitBytesPerSec !== undefined) {
      task.speedLimitBytesPerSec = parseInt(options.speedLimitBytesPerSec, 10) || 0;
      task.speedLimitEnabled = Boolean(task.speedLimitBytesPerSec > 0 || options.speedLimitEnabled);
    }
    if (options.speedLimitEnabled !== undefined) {
      task.speedLimitEnabled = Boolean(options.speedLimitEnabled);
    }

    // Apply speed limit dynamically to active downloader if running
    const downloader = this.activeDownloaders.get(id);
    if (downloader && typeof downloader.setSpeedLimit === 'function') {
      const activeCap = task.speedLimitEnabled ? (task.speedLimitBytesPerSec || 0) : 0;
      downloader.setSpeedLimit(activeCap);
    }

    if (options.onCompleteAction !== undefined) {
      task.onCompleteAction = options.onCompleteAction;
    }

    if (options.triggerAtPercent !== undefined) {
      task.triggerAtPercent = parseInt(options.triggerAtPercent, 10);
      if (task.customScript) {
        task.customScript.triggerAtPercent = task.triggerAtPercent;
      }
    }

    if (options.customScript !== undefined && typeof options.customScript === 'object') {
      task.customScript = { ...(task.customScript || {}), ...options.customScript };
    }

    if (options.runScriptOnComplete !== undefined) {
      if (!task.customScript) task.customScript = {};
      task.customScript.enabled = Boolean(options.runScriptOnComplete);
    }

    if (options.scriptType !== undefined) {
      if (!task.customScript) task.customScript = {};
      task.customScript.type = options.scriptType;
    }

    if (options.scriptPath !== undefined) {
      if (!task.customScript) task.customScript = {};
      task.customScript.path = options.scriptPath;
    }

    if (options.scriptArgs !== undefined) {
      if (!task.customScript) task.customScript = {};
      task.customScript.args = options.scriptArgs;
    }

    if (options.autoExtract !== undefined) {
      task.autoExtract = Boolean(options.autoExtract);
    }

    if (options.extractPassword !== undefined) {
      task.archivePassword = options.extractPassword;
    }

    if (options.deleteArchiveAfterExtraction !== undefined) {
      task.deleteAfterExtract = Boolean(options.deleteArchiveAfterExtraction);
    }

    this.saveState();
    this.emit('taskUpdated', task);
    return task;
  }

  getTask(id) {
    return this.tasks.get(id);
  }
}

const downloadManager = new DownloadManager();
module.exports = downloadManager;
