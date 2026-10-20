const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { isMediaUrl } = require('./mediaDownloader');
const { getYtDlpPath, getNodeJsPath } = require('./binaryResolver');

class MediaPrefetcher {
  constructor() {
    this.cacheDir = path.join(os.tmpdir(), 'Waterfall', 'media_cache');
    try { fs.mkdirSync(this.cacheDir, { recursive: true }); } catch (_) {}
    this.activeWorkers = 0;
    this.maxConcurrentPrefetch = 2; // Polite background workers
    this.prefetchingIds = new Set();
    this.onCheckMore = null;
  }

  getCachePath(taskId) {
    return path.join(this.cacheDir, `${taskId}.info.json`);
  }

  hasCachedInfo(taskId) {
    try {
      const p = this.getCachePath(taskId);
      return fs.existsSync(p) && fs.statSync(p).size > 100;
    } catch (_) {
      return false;
    }
  }

  checkQueue(tasksMap, notifyCallback) {
    if (this.activeWorkers >= this.maxConcurrentPrefetch) return;

    for (const [id, task] of tasksMap.entries()) {
      if (this.activeWorkers >= this.maxConcurrentPrefetch) break;
      if (task.status !== 'queued') continue;
      if (!task.isMedia && !isMediaUrl(task.url)) continue;
      if (this.prefetchingIds.has(id)) continue;
      if (this.hasCachedInfo(id) && task.streamPreResolved) continue;

      this.prefetchTask(task, notifyCallback);
    }
  }

  prefetchTask(task, notifyCallback) {
    const taskId = task.id;
    this.prefetchingIds.add(taskId);
    this.activeWorkers++;

    const ytDlpExe = getYtDlpPath();
    const cacheFile = this.getCachePath(taskId);

    const args = ['--dump-json', '--no-warnings', '--no-playlist', task.url];

    if (/youtu\.?be/i.test(task.url)) {
      args.unshift('--extractor-args', 'youtube:player_client=android,web');
    }

    const nodePath = getNodeJsPath();
    if (nodePath) {
      args.unshift('--js-runtimes', `node:${nodePath}`);
    }

    let stdout = '';
    const proc = spawn(ytDlpExe, args, { windowsHide: true });
    let isSettled = false;

    const timeout = setTimeout(() => {
      if (isSettled) return;
      isSettled = true;
      try { proc.kill(); } catch (_) {}
      this.activeWorkers = Math.max(0, this.activeWorkers - 1);
      this.prefetchingIds.delete(taskId);
    }, 20000);

    proc.stdout.on('data', chunk => {
      stdout += chunk.toString();
    });

    proc.on('error', () => {
      if (isSettled) return;
      isSettled = true;
      clearTimeout(timeout);
      this.activeWorkers = Math.max(0, this.activeWorkers - 1);
      this.prefetchingIds.delete(taskId);
    });

    proc.on('close', code => {
      if (isSettled) return;
      isSettled = true;
      clearTimeout(timeout);
      this.activeWorkers = Math.max(0, this.activeWorkers - 1);
      this.prefetchingIds.delete(taskId);

      if (code === 0 && stdout.trim().length > 0) {
        try {
          fs.writeFileSync(cacheFile, stdout, 'utf8');
          const info = JSON.parse(stdout);

          task.streamPreResolved = true;
          task.prefetchedAt = Date.now();

          if (info.title && (!task.name || task.name.startsWith('Untitled Track') || task.name.startsWith('download_'))) {
            const ext = (task.mediaOptions && task.mediaOptions.mediaType === 'video')
              ? 'mp4'
              : (task.mediaOptions && task.mediaOptions.audioFormat ? task.mediaOptions.audioFormat : 'mp3');
            task.name = `${info.title}.${ext}`;
          }

          if (info.duration && !task.duration) {
            task.duration = info.duration;
          }

          if (info.thumbnail && !task.thumbnail) {
            task.thumbnail = info.thumbnail;
          }

          // Extract direct stream URL
          let directStream = info.url;
          if (!directStream && Array.isArray(info.formats)) {
            const targetFormat = (task.mediaOptions && task.mediaOptions.mediaType === 'video')
              ? info.formats.find(f => f.vcodec !== 'none' && f.url)
              : info.formats.find(f => f.acodec !== 'none' && f.url);
            if (targetFormat) directStream = targetFormat.url;
          }
          if (directStream) {
            task.directUrl = directStream;
          }

          if (typeof notifyCallback === 'function') {
            notifyCallback(task);
          }
        } catch (_) {}
      }

      if (this.onCheckMore) {
        this.onCheckMore();
      }
    });

    proc.on('error', () => {
      this.activeWorkers = Math.max(0, this.activeWorkers - 1);
      this.prefetchingIds.delete(taskId);
      if (this.onCheckMore) {
        this.onCheckMore();
      }
    });
  }

  clearCache(taskId) {
    try {
      const p = this.getCachePath(taskId);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch (_) {}
  }
}

module.exports = new MediaPrefetcher();
