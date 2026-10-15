const crypto = require('crypto');
const path = require('path');
const hosterManager = require('./hosters');
const { resolveBestFilename } = require('./namingEngine');

const COMPRESSED_EXTS = new Set(['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'iso', 'pkg', 'part']);
const PROGRAM_EXTS = new Set(['exe', 'msi', 'bat', 'apk', 'bin', 'dmg', 'appimage', 'deb', 'rpm']);
const VIDEO_EXTS = new Set(['mp4', 'mkv', 'avi', 'mov', 'webm', 'wmv', 'flv', 'm4v']);
const AUDIO_EXTS = new Set(['mp3', 'flac', 'wav', 'aac', 'ogg', 'm4a', 'opus', 'alac']);
const DOC_EXTS = new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'epub', 'cbz', 'cbr']);

function getCategoryFromFilename(filename) {
  const ext = path.extname(filename).toLowerCase().replace('.', '');
  if (COMPRESSED_EXTS.has(ext)) return 'Compressed';
  if (PROGRAM_EXTS.has(ext)) return 'Programs';
  if (VIDEO_EXTS.has(ext)) return 'Video';
  if (AUDIO_EXTS.has(ext)) return 'Audio';
  if (DOC_EXTS.has(ext)) return 'Documents';
  return 'Uncategorized';
}

function extractFilenameFromHeadersOrUrl(url, headers) {
  const cd = headers ? headers.get('content-disposition') : null;
  const contentType = headers ? headers.get('content-type') : null;
  return resolveBestFilename({
    contentDisposition: cd,
    initialUrl: url,
    contentType
  });
}

const { safeProbe } = require('./httpHelper');

class LinkGrabber {
  constructor() {
    this.stagedItems = new Map(); // id -> item
  }

  extractUrls(text) {
    if (!text) return [];
    const urlRegex = /(https?:\/\/[^\s"'<>\(\)]+)/gi;
    const matches = text.match(urlRegex) || [];
    return [...new Set(matches.map(u => u.trim()))];
  }

  async probeUrl(url) {
    try {
      // 1. Resolve hoster first
      const resolved = await hosterManager.resolve(url);

      // Handle multi-file folder packages (e.g. Gofile folders)
      if (resolved && Array.isArray(resolved.items) && resolved.items.length > 0) {
        return {
          isMulti: true,
          items: resolved.items.map(item => ({
            originalUrl: url,
            directUrl: item.directUrl,
            filename: item.filename,
            size: item.size || 0,
            hoster: item.hoster || resolved.hoster || 'Gofile',
            packageName: item.packageName || resolved.packageName || '',
            isOnline: 'online',
            statusCode: 200,
            acceptRanges: true,
            downloadHeaders: item.downloadHeaders || null,
            category: getCategoryFromFilename(item.filename)
          }))
        };
      }

      const targetUrl = (resolved && resolved.directUrl) ? resolved.directUrl : url;
      let filename = (resolved && resolved.filename && resolved.filename !== 'download') ? resolved.filename : '';
      let size = (resolved && resolved.size) ? resolved.size : 0;
      let hoster = (resolved && resolved.hoster) ? resolved.hoster : 'Direct Web';
      const downloadHeaders = (resolved && resolved.downloadHeaders) ? resolved.downloadHeaders : null;

      let isOnline = (resolved && resolved.status === 'online');
      let acceptRanges = false;

      // If hoster explicitly determined the file is offline or deleted, return immediately
      if (resolved && resolved.status === 'offline') {
        return {
          originalUrl: url,
          directUrl: targetUrl,
          filename: filename || extractFilenameFromHeadersOrUrl(targetUrl, null),
          size: 0,
          hoster,
          isOnline: 'offline',
          statusCode: 404,
          acceptRanges: false,
          downloadHeaders,
          isMedia: false,
          mediaOptions: null,
          category: getCategoryFromFilename(filename || '')
        };
      }

      // 2. Perform safe probe with insecureHTTPParser (never crashes on bare LF)
      const res = await safeProbe(targetUrl, {
        headers: downloadHeaders || {}
      }).catch(() => null);

      if (res && res.status >= 200 && res.status < 400) {
        isOnline = true;
        const cl = res.headers.get('content-length');
        const cr = res.headers.get('content-range');
        const ar = res.headers.get('accept-ranges');

        if (cr) {
          const match = cr.match(/\/(\d+)/);
          if (match) size = parseInt(match[1], 10);
          acceptRanges = true;
        } else if (cl && (!size || size === 0)) {
          size = parseInt(cl, 10);
        }

        if (ar === 'bytes') acceptRanges = true;

        if (!filename || filename === 'download') {
          filename = extractFilenameFromHeadersOrUrl(res.url || targetUrl, res.headers);
        }
      } else {
        if (!filename) {
          filename = extractFilenameFromHeadersOrUrl(targetUrl, null);
        }
      }

      return {
        originalUrl: url,
        directUrl: targetUrl,
        filename,
        size,
        hoster,
        isOnline: isOnline ? 'online' : (res ? 'warning' : 'offline'),
        statusCode: res ? res.status : (isOnline ? 200 : 0),
        acceptRanges,
        downloadHeaders,
        isMedia: resolved ? !!resolved.isMedia : false,
        mediaOptions: resolved ? resolved.mediaOptions : null,
        category: (resolved && resolved.isMedia) ? 'Audio' : getCategoryFromFilename(filename)
      };
    } catch (e) {
      const fn = extractFilenameFromHeadersOrUrl(url, null);
      return {
        originalUrl: url,
        directUrl: url,
        filename: fn,
        size: 0,
        hoster: 'Direct Web',
        isOnline: 'offline',
        statusCode: 0,
        acceptRanges: false,
        category: getCategoryFromFilename(fn)
      };
    }
  }

  async crawlText(text, packageName = '') {
    const urls = this.extractUrls(text);
    const results = [];
    const defaultPackage = packageName.trim() || `Package_${new Date().toISOString().slice(0, 10)}_${Math.floor(Math.random() * 900 + 100)}`;

    const CONCURRENCY = 6;
    const queue = [...urls];
    const workers = Array.from({ length: Math.min(CONCURRENCY, urls.length) }, async () => {
      while (queue.length > 0) {
        const url = queue.shift();
        if (!url) continue;
        const probeData = await this.probeUrl(url);

        if (probeData && probeData.isMulti && Array.isArray(probeData.items)) {
          for (const subItem of probeData.items) {
            const id = crypto.randomUUID();
            const item = {
              id,
              packageName: subItem.packageName || defaultPackage,
              selected: true,
              addedAt: Date.now(),
              ...subItem
            };
            this.stagedItems.set(id, item);
            results.push(item);
          }
        } else if (probeData) {
          const id = crypto.randomUUID();
          const item = {
            id,
            packageName: defaultPackage,
            selected: true,
            addedAt: Date.now(),
            ...probeData
          };
          this.stagedItems.set(id, item);
          results.push(item);
        }
      }
    });

    await Promise.all(workers);
    return results;
  }

  getStagedItems() {
    return Array.from(this.stagedItems.values());
  }

  removeStagedItem(id) {
    return this.stagedItems.delete(id);
  }

  clear() {
    this.stagedItems.clear();
  }

  updateItem(id, updates) {
    const item = this.stagedItems.get(id);
    if (!item) return null;
    Object.assign(item, updates);
    return item;
  }
}

const linkGrabber = new LinkGrabber();
module.exports = {
  linkGrabber,
  getCategoryFromFilename
};
