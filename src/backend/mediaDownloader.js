const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { sanitizeFilename } = require('./namingEngine');

function getYtDlpPath() {
  const candidates = [
    path.join(__dirname, '..', '..', 'bin', 'yt-dlp.exe'),
    path.join(__dirname.replace('app.asar', 'app.asar.unpacked'), '..', '..', 'bin', 'yt-dlp.exe'),
    process.resourcesPath ? path.join(process.resourcesPath, 'bin', 'yt-dlp.exe') : null,
    process.resourcesPath ? path.join(process.resourcesPath, 'app.asar.unpacked', 'bin', 'yt-dlp.exe') : null,
    path.join(process.cwd(), 'bin', 'yt-dlp.exe'),
    path.join(path.dirname(process.execPath || ''), 'bin', 'yt-dlp.exe'),
    path.join(__dirname, '..', '..', 'bin', 'yt-dlp')
  ].filter(Boolean);

  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }

  return 'yt-dlp';
}

function getFfmpegLocation() {
  const candidates = [
    path.join(__dirname, '..', '..', 'bin'),
    path.join(__dirname.replace('app.asar', 'app.asar.unpacked'), '..', '..', 'bin'),
    process.resourcesPath ? path.join(process.resourcesPath, 'bin') : null,
    process.resourcesPath ? path.join(process.resourcesPath, 'app.asar.unpacked', 'bin') : null,
    path.join(process.cwd(), 'bin'),
    path.join(path.dirname(process.execPath || ''), 'bin')
  ].filter(Boolean);

  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'ffmpeg.exe'))) return c;
  }
  return null;
}

function isMediaUrl(url) {
  if (!url) return false;
  return /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be|soundcloud\.com|vimeo\.com|tiktok\.com|twitch\.tv|twitter\.com|x\.com)\/.+/i.test(url);
}

function probeMedia(url) {
  return new Promise((resolve, reject) => {
    const isPotentialPlaylist = /[?&]list=|(\/playlist|\/sets\/|\/album)/i.test(url);
    const args = isPotentialPlaylist
      ? ['--dump-single-json', '--flat-playlist', '--no-warnings', url]
      : ['--dump-json', '--no-playlist', '--no-warnings', url];

    const ffmpegLoc = getFfmpegLocation();
    if (ffmpegLoc) {
      args.unshift('--ffmpeg-location', ffmpegLoc);
    }

    const ytDlpExe = getYtDlpPath();
    const proc = spawn(ytDlpExe, args, { windowsHide: true });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', data => stdout += data.toString());
    proc.stderr.on('data', data => stderr += data.toString());

    proc.on('error', (err) => {
      reject(new Error(`yt-dlp failed to launch: ${err.message}`));
    });

    proc.on('close', code => {
      if (code !== 0) {
        return reject(new Error(stderr || `yt-dlp probe failed with code ${code}`));
      }

      try {
        const info = JSON.parse(stdout);
        const standardFormats = [
          { id: 'mp3-320', type: 'audio', ext: 'mp3', quality: '320k', label: 'MP3 High Quality (320 kbps)' },
          { id: 'mp3-192', type: 'audio', ext: 'mp3', quality: '192k', label: 'MP3 Standard (192 kbps)' },
          { id: 'm4a-best', type: 'audio', ext: 'm4a', quality: 'best', label: 'M4A / AAC (Apple Quality)' },
          { id: 'flac-lossless', type: 'audio', ext: 'flac', quality: '0', label: 'FLAC (Lossless Audio)' },
          { id: 'wav-lossless', type: 'audio', ext: 'wav', quality: '0', label: 'WAV (Uncompressed Audio)' },
          { id: 'mp4-1080', type: 'video', ext: 'mp4', quality: '1080p', label: 'MP4 Full HD (1080p)' },
          { id: 'mp4-720', type: 'video', ext: 'mp4', quality: '720p', label: 'MP4 HD (720p)' },
          { id: 'mp4-best', type: 'video', ext: 'mp4', quality: 'best', label: 'MP4 Best Available' }
        ];

        // Check if playlist
        if (info._type === 'playlist' && Array.isArray(info.entries)) {
          const entries = info.entries.filter(e => e && (e.title || e.id)).map(e => {
            const sec = e.duration || 0;
            const mins = Math.floor(sec / 60);
            const secs = Math.floor(sec % 60);
            return {
              id: e.id,
              title: e.title || 'Untitled Track',
              url: e.url && e.url.startsWith('http') ? e.url : `https://www.youtube.com/watch?v=${e.id}`,
              duration: sec > 0 ? `${mins}:${secs < 10 ? '0' : ''}${secs}` : '--:--',
              durationSeconds: sec,
              thumbnail: (e.thumbnails && e.thumbnails[0]) ? e.thumbnails[0].url : (info.thumbnails && info.thumbnails[0] ? info.thumbnails[0].url : null)
            };
          });

          return resolve({
            isPlaylist: true,
            id: info.id,
            title: info.title || 'YouTube Playlist',
            uploader: info.uploader || info.channel || 'Various Artists',
            thumbnail: (info.thumbnails && info.thumbnails[0]) ? info.thumbnails[0].url : (entries[0] ? entries[0].thumbnail : null),
            totalTracks: entries.length,
            entries,
            formats: standardFormats
          });
        }

        const durationSec = info.duration || 0;
        const mins = Math.floor(durationSec / 60);
        const secs = Math.floor(durationSec % 60);
        const formattedDuration = `${mins}:${secs < 10 ? '0' : ''}${secs}`;

        resolve({
          isPlaylist: false,
          id: info.id,
          title: info.title,
          thumbnail: info.thumbnail,
          uploader: info.uploader || info.channel || 'Unknown Artist',
          duration: formattedDuration,
          durationSeconds: durationSec,
          webpage_url: info.webpage_url || url,
          formats: standardFormats
        });
      } catch (err) {
        reject(new Error(`Failed to parse yt-dlp metadata: ${err.message}`));
      }
    });
  });
}

function isGenericTitle(str) {
  if (!str || typeof str !== 'string') return true;
  const s = str.trim().toLowerCase();
  if (!s || s === 'media' || s === 'download' || s === 'media download' || s === 'stream' || s === 'video' || s === 'audio') return true;
  if (/^file[_\-\d]/i.test(s)) return true;
  if (/^stream[_\-\s#\d]/i.test(s)) return true;
  if (/^videoplayback/i.test(s)) return true;
  if (/^video_\d+/i.test(s)) return true;
  return false;
}

class MediaDownloader {
  constructor(task, options = {}) {
    this.task = task;
    this.options = options;
    this.proc = null;
    this.isPaused = false;
    this.isCancelled = false;
  }

  start(onUpdate, onComplete, onError) {
    const mediaType = this.options.mediaType || 'audio'; // 'audio' or 'video'
    const audioFormat = this.options.audioFormat || 'mp3';
    const audioQuality = this.options.audioQuality || '0'; // 0 = best VBR / 320k
    const videoQuality = this.options.videoQuality || '1080';
    const outputDir = path.dirname(this.task.savePath);

    fs.mkdirSync(outputDir, { recursive: true });

    // Build filename template: prefer explicit title, otherwise use yt-dlp %(title)s to grab real online title
    let baseTitle = '';
    if (!isGenericTitle(this.task.name)) {
      baseTitle = this.task.name;
    } else if (this.task.packageName && !isGenericTitle(this.task.packageName)) {
      baseTitle = this.task.packageName;
    }

    const ext = (mediaType === 'audio') ? audioFormat : 'mp4';
    const hasExplicitTitle = Boolean(baseTitle && !isGenericTitle(baseTitle));
    const sanitizedTitle = hasExplicitTitle
      ? sanitizeFilename(baseTitle.replace(/\.[^/.]+$/, '').trim())
      : '%(title)s';

    let targetFile = hasExplicitTitle ? path.join(outputDir, `${sanitizedTitle}.${ext}`) : '';
    if (hasExplicitTitle) {
      this.task.savePath = targetFile;
      this.task.name = `${sanitizedTitle}.${ext}`;
    }

    // Guard: If destination file already exists and is non-empty on disk, mark completed immediately
    if (this.task.savePath && fs.existsSync(this.task.savePath)) {
      try {
        const stat = fs.statSync(this.task.savePath);
        if (stat.size > 1024) {
          console.log(`[MediaDownloader] Media file already exists on disk: ${this.task.savePath}`);
          this.task.status = 'completed';
          this.task.totalBytes = stat.size;
          this.task.downloadedBytes = stat.size;
          this.task.speed = 0;
          this.task.eta = 0;
          this.task.completedAt = Date.now();
          onComplete(this.task);
          return;
        }
      } catch (_) {}
    }

    const args = ['--newline', '--no-playlist', '--mtime'];

    if (mediaType === 'audio') {
      args.push(
        '-x',
        '--audio-format', audioFormat,
        '--audio-quality', audioQuality,
        '--embed-thumbnail',
        '--embed-metadata'
      );
    } else {
      // Video
      args.push('--embed-metadata', '--embed-thumbnail', '--embed-chapters');
      if (videoQuality === '1080') {
        args.push('-f', 'bestvideo[height<=1080]+bestaudio/best[height<=1080]/best');
      } else if (videoQuality === '720') {
        args.push('-f', 'bestvideo[height<=720]+bestaudio/best[height<=720]/best');
      } else {
        args.push('-f', 'bestvideo+bestaudio/best');
      }
      args.push('--merge-output-format', 'mp4');
    }

    // Output template
    const templatePath = path.join(outputDir, `${sanitizedTitle}.%(ext)s`);
    args.push('-o', templatePath, this.task.url);

    this.task.status = 'downloading';
    this.task.hoster = 'YouTube / yt-dlp';
    this.task.category = (mediaType === 'audio') ? 'Audio' : 'Video';
    const ytDlpExe = getYtDlpPath();
    const ffmpegLoc = getFfmpegLocation();
    if (ffmpegLoc) {
      args.unshift('--ffmpeg-location', ffmpegLoc);
    }

    const nodePath = 'C:\\Program Files\\nodejs\\node.exe';
    if (fs.existsSync(nodePath)) {
      args.unshift('--js-runtimes', `node:${nodePath}`);
    }

    const existingFiles = new Set(fs.existsSync(outputDir) ? fs.readdirSync(outputDir) : []);
    let detectedDestination = null;
    let lastErrorMsg = '';

    onUpdate(this.task);
    this.proc = spawn(ytDlpExe, args, { windowsHide: true });

    this.proc.stdout.on('data', (data) => {
      const text = data.toString();
      const destMatch = text.match(/(?:Destination:\s+|Merging formats into\s+["']?|\[ExtractAudio\] Destination:\s+|\[download\]\s+)([^\r\n"']+\.(?:mp4|mp3|mkv|webm|m4a|flv|opus|wav|aac|ogg))/i);
      if (destMatch && destMatch[1]) {
        const found = destMatch[1].trim().replace(/["']$/, '');
        detectedDestination = found;
        const foundBase = path.basename(found);
        if (!foundBase.includes('.f') && !foundBase.includes('.temp') && !foundBase.endsWith('.part')) {
          this.task.name = foundBase;
          this.task.savePath = found;
          onUpdate(this.task);
        }
      }
      this.parseProgress(text, onUpdate);
    });

    this.proc.stderr.on('data', (data) => {
      const line = data.toString();
      if (line.includes('ERROR:')) {
        lastErrorMsg = line.trim();
      }
      this.parseProgress(line, onUpdate);
    });

    this.proc.on('close', (code) => {
      if (this.isCancelled) return;

      if (code === 0) {
        // Detect actual resulting file on disk
        let actualFile = (hasExplicitTitle && targetFile && fs.existsSync(targetFile)) ? targetFile : null;
        if (!actualFile && detectedDestination && fs.existsSync(detectedDestination)) {
          actualFile = detectedDestination;
        }
        if (!actualFile) {
          try {
            const files = fs.readdirSync(outputDir);
            const newFile = files.find(f => !existingFiles.has(f) && !f.endsWith('.part') && !f.endsWith('.ytdl'));
            if (newFile) {
              actualFile = path.join(outputDir, newFile);
            } else if (hasExplicitTitle) {
              const found = files.find(f => f.startsWith(sanitizedTitle) && !f.endsWith('.part'));
              if (found) {
                actualFile = path.join(outputDir, found);
              }
            }
          } catch (_) {}
        }

        if (actualFile && fs.existsSync(actualFile)) {
          const stats = fs.statSync(actualFile);
          this.task.totalBytes = stats.size;
          this.task.downloadedBytes = stats.size;
          this.task.savePath = actualFile;
          this.task.name = path.basename(actualFile);
        }

        this.task.status = 'completed';
        this.task.error = null;
        this.task.completedAt = Date.now();
        this.task.speed = 0;
        this.task.eta = 0;
        onComplete(this.task);
      } else {
        this.task.status = 'error';
        this.task.error = lastErrorMsg || `yt-dlp exited with error code ${code}`;

        // Clean up empty directory if nothing was downloaded into it
        try {
          if (fs.existsSync(outputDir) && fs.readdirSync(outputDir).length === 0) {
            fs.rmdirSync(outputDir);
          }
        } catch (_) {}

        onError(new Error(this.task.error));
      }
    });

    this.proc.on('error', (err) => {
      this.task.status = 'error';
      this.task.error = err.message;
      onError(err);
    });
  }

  parseProgress(line, onUpdate) {
    // Example yt-dlp progress:
    // [download]  45.2% of ~ 18.50MiB at 4.25MiB/s ETA 00:03
    // [ExtractAudio] Destination: ...
    if (line.includes('[ExtractAudio]') || line.includes('[Merger]')) {
      this.task.status = 'assembling';
      onUpdate(this.task);
      return;
    }

    const matchPercent = line.match(/(\d+\.?\d*)%/);
    const matchSize = line.match(/of\s+~?\s*(\d+\.?\d*)\s*([KMG]iB)/i);
    const matchSpeed = line.match(/at\s+(\d+\.?\d*)\s*([KMG]iB\/s)/i);
    const matchEta = line.match(/ETA\s+(\d+:\d+(?::\d+)?)/i);

    if (matchPercent) {
      const percent = parseFloat(matchPercent[1]);
      if (matchSize) {
        const val = parseFloat(matchSize[1]);
        const unit = matchSize[2].toLowerCase();
        let mult = 1024 * 1024;
        if (unit.startsWith('k')) mult = 1024;
        if (unit.startsWith('g')) mult = 1024 * 1024 * 1024;
        this.task.totalBytes = Math.floor(val * mult);
        this.task.downloadedBytes = Math.floor((this.task.totalBytes * percent) / 100);
      }

      if (matchSpeed) {
        const sVal = parseFloat(matchSpeed[1]);
        const sUnit = matchSpeed[2].toLowerCase();
        let sMult = 1024 * 1024;
        if (sUnit.startsWith('k')) sMult = 1024;
        if (sUnit.startsWith('g')) sMult = 1024 * 1024 * 1024;
        this.task.speed = Math.floor(sVal * sMult);
      }

      if (matchEta) {
        const parts = matchEta[1].split(':').map(Number);
        if (parts.length === 2) {
          this.task.eta = parts[0] * 60 + parts[1];
        } else if (parts.length === 3) {
          this.task.eta = parts[0] * 3600 + parts[1] * 60 + parts[2];
        }
      }

      onUpdate(this.task);
    }
  }

  pause() {
    this.isPaused = true;
    if (this.proc) {
      try { this.proc.kill(); } catch (_) {}
    }
  }

  cancel() {
    this.isCancelled = true;
    this.pause();
    try {
      if (fs.existsSync(this.task.savePath)) fs.unlinkSync(this.task.savePath);
    } catch (_) {}
  }
}

module.exports = {
  isMediaUrl,
  probeMedia,
  MediaDownloader,
  isGenericTitle
};
