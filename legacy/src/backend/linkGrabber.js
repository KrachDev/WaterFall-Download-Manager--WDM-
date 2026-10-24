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
    if (!text || typeof text !== 'string') return [];

    // 1. Decode HTML entities first
    let cleaned = text
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'");

    const candidateUrls = new Set();

    // 2. Extract and replace BBCode [url=...] or [url]...[/url]
    const bbcodeRegex = /\[url(?:=([^\]]+))?\](.*?)\[\/url\]/gi;
    cleaned = cleaned.replace(bbcodeRegex, (m, u1, u2) => {
      const target = (u1 || u2 || '').trim();
      if (target.startsWith('http://') || target.startsWith('https://')) {
        candidateUrls.add(target);
      }
      return ' ';
    });

    // 3. Extract and replace Markdown links [text](url)
    const mdRegex = /\[([^\]]*)\]\((https?:\/\/[^\s\)]+)\)/gi;
    cleaned = cleaned.replace(mdRegex, (m, text, url) => {
      candidateUrls.add(url.trim());
      return ' ';
    });

    // 4. Extract and replace HTML hrefs
    const htmlRegex = /href=["'](https?:\/\/[^"']+)["']/gi;
    cleaned = cleaned.replace(htmlRegex, (m, url) => {
      candidateUrls.add(url.trim());
      return ' ';
    });

    // 5. Extract standard plaintext URLs
    const rawUrlRegex = /(https?:\/\/[^\s"'<>\(\)\[\]]+)/gi;
    let rawMatch;
    while ((rawMatch = rawUrlRegex.exec(cleaned)) !== null) {
      candidateUrls.add(rawMatch[1].trim());
    }

    // 6. Clean and sanitize all extracted candidates
    const cleanResults = new Set();
    for (let u of candidateUrls) {
      // Strip trailing punctuation and wrapping characters
      u = u.replace(/[.,;!?:)\]}'">]+$/, '');
      u = u.replace(/^[<(\["']+|[>)\]"']+$/g, '');

      try {
        const parsed = new URL(u);
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
          cleanResults.add(parsed.href);
        }
      } catch (_) {}
    }

    return Array.from(cleanResults);
  }

  async probeUrl(url, depth = 0) {
    try {
      // 0. Container check: Pastebin, Rentry, raw pastes
      if (depth === 0) {
        try {
          const { crawlPastebinOrRaw } = require('./crawlerEngine');
          const container = await crawlPastebinOrRaw(url).catch(() => null);
          if (container && Array.isArray(container.foundLinks) && container.foundLinks.length > 0) {
            const subItems = [];
            for (const subLink of container.foundLinks) {
              const sub = await this.probeUrl(subLink, depth + 1);
              if (sub && sub.isMulti && Array.isArray(sub.items)) {
                subItems.push(...sub.items);
              } else if (sub) {
                subItems.push({ ...sub, packageName: container.packageName });
              }
            }
            if (subItems.length > 0) {
              return {
                isMulti: true,
                packageName: container.packageName,
                items: subItems
              };
            }
          }
        } catch (_) {}
      }

      // 1. Resolve hoster first (handles specialized hosters, Gofile, Pixeldrain lists, Archive.org details, YouTube)
      const resolved = await hosterManager.resolve(url);

      // Handle multi-file folder packages (e.g. Gofile folders, Pixeldrain albums, Archive.org files, YouTube playlists)
      if (resolved && Array.isArray(resolved.items) && resolved.items.length > 0) {
        return {
          isMulti: true,
          packageName: resolved.packageName || '',
          items: resolved.items.map(item => ({
            originalUrl: item.originalUrl || url,
            directUrl: item.directUrl,
            filename: item.filename,
            size: item.size || 0,
            hoster: item.hoster || resolved.hoster || 'Hoster',
            packageName: item.packageName || resolved.packageName || '',
            isOnline: item.status === 'offline' ? 'offline' : 'online',
            statusCode: item.status === 'offline' ? 404 : 200,
            acceptRanges: item.acceptRanges !== false,
            downloadHeaders: item.downloadHeaders || null,
            isMedia: !!item.isMedia,
            mediaOptions: item.mediaOptions || null,
            category: item.isMedia ? 'Audio' : getCategoryFromFilename(item.filename)
          }))
        };
      }

      const targetUrl = (resolved && resolved.directUrl) ? resolved.directUrl : url;
      let filename = (resolved && resolved.filename && resolved.filename !== 'download') ? resolved.filename : '';
      let size = (resolved && resolved.size) ? resolved.size : 0;
      let hoster = (resolved && resolved.hoster) ? resolved.hoster : 'Direct Web';
      const downloadHeaders = (resolved && resolved.downloadHeaders) ? resolved.downloadHeaders : null;

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

      let isOnline = (resolved && resolved.status === 'online');
      let acceptRanges = false;
      let contentType = res && res.headers ? (res.headers.get('content-type') || '') : '';

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

      // 3. Webpage Deep Crawl: If probe returned HTML/web content and target URL lacks binary file extension
      const isHtmlResponse = contentType.includes('text/html') || contentType.includes('text/plain');
      const hasBinaryExt = /\.(zip|rar|7z|tar|gz|bz2|xz|iso|pkg|bin|exe|msi|dmg|apk|deb|rpm|pdf|docx?|xlsx?|epub|cbz|cbr|mp4|mkv|avi|webm|mp3|flac|wav|m4a)(\?.*)?$/i.test(targetUrl);

      if (depth === 0 && !hasBinaryExt && isHtmlResponse && (!resolved || hoster === 'Direct CDN/Web' || hoster === 'Direct Web')) {
        try {
          const { deepCrawlWebpage } = require('./crawlerEngine');
          const crawlRes = await deepCrawlWebpage(targetUrl).catch(() => null);
          if (crawlRes && Array.isArray(crawlRes.foundLinks) && crawlRes.foundLinks.length > 0) {
            // Probe up to 40 candidate links from the scraped page
            const candidateQueue = crawlRes.foundLinks.slice(0, 40);
            const subItems = [];
            const CONC = 4;
            const workers = Array.from({ length: Math.min(CONC, candidateQueue.length) }, async () => {
              while (candidateQueue.length > 0) {
                const link = candidateQueue.shift();
                if (!link) continue;
                const sub = await this.probeUrl(link, depth + 1);
                if (sub && sub.isMulti && Array.isArray(sub.items)) {
                  for (const item of sub.items) {
                    subItems.push({ ...item, packageName: crawlRes.packageName });
                  }
                } else if (sub && sub.isOnline !== 'offline') {
                  subItems.push({ ...sub, packageName: crawlRes.packageName });
                }
              }
            });
            await Promise.all(workers);

            if (subItems.length > 0) {
              return {
                isMulti: true,
                packageName: crawlRes.packageName,
                items: subItems
              };
            }
          }
        } catch (_) {}
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

  async crawlText(text, packageName = '', onProgress = null) {
    const urls = this.extractUrls(text);
    const results = [];
    const defaultPackage = packageName.trim() || `Package_${new Date().toISOString().slice(0, 10)}_${Math.floor(Math.random() * 900 + 100)}`;

    if (urls.length === 0) return results;

    const CONCURRENCY = 6;
    const queue = [...urls];
    let processedCount = 0;

    const workers = Array.from({ length: Math.min(CONCURRENCY, urls.length) }, async () => {
      while (queue.length > 0) {
        const url = queue.shift();
        if (!url) continue;

        if (typeof onProgress === 'function') {
          onProgress({
            type: 'probing',
            currentUrl: url,
            processed: processedCount,
            total: urls.length,
            stagedCount: results.length
          });
        }

        const probeData = await this.probeUrl(url);
        processedCount++;

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
            packageName: probeData.packageName || defaultPackage,
            selected: true,
            addedAt: Date.now(),
            ...probeData
          };
          this.stagedItems.set(id, item);
          results.push(item);
        }

        if (typeof onProgress === 'function') {
          onProgress({
            type: 'item_added',
            currentUrl: url,
            processed: processedCount,
            total: urls.length,
            stagedCount: results.length,
            latestItem: results[results.length - 1]
          });
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
