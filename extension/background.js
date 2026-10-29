/**
 * Waterfall Download Suite — Background Service Worker
 * Manages local Waterfall Engine bridge, IDM-style network stream sniffer,
 * download interception with zero browser duplicates, context menus, and YouTube converter dispatch.
 */

const DEFAULT_SETTINGS = {
  hydraHost: 'http://127.0.0.1:4567',
  jdFallbackHost: 'http://127.0.0.1:9666',
  autostart: true,
  interceptDownloads: true,
  interceptExtensions: [
    '.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz', '.iso', '.exe', '.msi', '.bin',
    '.apk', '.dmg', '.pkg', '.pdf', '.docx', '.xlsx', '.pptx', '.csv', '.tsv', '.json',
    '.xml', '.txt', '.log', '.mp4', '.mkv', '.avi', '.mov', '.webm', '.flv', '.m4v', '.ts',
    '.mp3', '.flac', '.wav', '.aac', '.m4a', '.ogg', '.opus',
    '.png', '.jpg', '.jpeg', '.webp', '.svg', '.gif',
    '.epub', '.torrent'
  ],
  interceptMinSizeKB: 500,
  enableVideoPanel: true,
  videoPanelPosition: 'top-right',
  videoPanelTrigger: 'hover',
  showDesktopNotifications: true,
  showInPageToasts: true,
  packageNamePattern: '{title}',
  defaultAudioFormat: 'mp3-320',
  defaultVideoQuality: '1080',
  bypassKey: 'both' // 'ctrl', 'alt', 'both'
};

// In-memory cache for sniffed media streams per tab (IDM-style sniffer)
const tabMediaMap = new Map();

// Synchronous settings cache
let cachedSettings = { ...DEFAULT_SETTINGS };

// Track intercepted downloads and deduplicate
const interceptedDownloadIds = new Set();
const recentlyInterceptedUrls = new Map();
const bypassedUrls = new Map();
const pendingBlobDownloads = new Map(); // id -> { id, url, filename, referrer, timestamp }
let lastBlobIntent = null;
let lastBypassTimestamp = 0;

/**
 * Load settings with defaults
 */
async function getSettings() {
  try {
    const stored = await chrome.storage.sync.get('settings');
    cachedSettings = { ...DEFAULT_SETTINGS, ...(stored.settings || {}) };
  } catch (err) {
    cachedSettings = { ...DEFAULT_SETTINGS };
  }
  return cachedSettings;
}

getSettings().catch(() => {});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'sync' && changes.settings) {
    cachedSettings = { ...DEFAULT_SETTINGS, ...(changes.settings.newValue || {}) };
    broadcastSettings(cachedSettings);
  }
});

function broadcastSettings(settings) {
  chrome.tabs.query({}, (tabs) => {
    if (!tabs || !Array.isArray(tabs)) return;
    tabs.forEach(tab => {
      chrome.tabs.sendMessage(tab.id, {
        action: 'SETTINGS_UPDATED',
        settings
      }).catch(() => {});
    });
  });
}

async function saveSettings(newSettings) {
  const current = await getSettings();
  const updated = { ...current, ...newSettings };
  await chrome.storage.sync.set({ settings: updated });
  cachedSettings = updated;
  broadcastSettings(updated);
  return updated;
}

/**
 * Check connectivity to Waterfall Hybrid Engine (or fallback to JD)
 */
async function checkHydraStatus(hostOverride) {
  const settings = await getSettings();
  const host = (hostOverride || settings.hydraHost || 'http://127.0.0.1:4567').replace(/\/+$/, '');
  const startTime = Date.now();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);

    // 1. Try Waterfall native downloads API
    const response = await fetch(`${host}/api/downloads`, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal
    }).catch(async () => {
      // 2. Try Waterfall / JDownloader jdcheck.js
      return await fetch(`${host}/jdcheck.js`, {
        method: 'GET',
        cache: 'no-store',
        signal: controller.signal
      });
    });

    clearTimeout(timeoutId);

    if (response && response.ok) {
      const latency = Date.now() - startTime;
      return {
        connected: true,
        latency,
        host,
        version: 'Waterfall Hybrid Engine'
      };
    }

    // 3. Optional fallback check to JD port 9666
    if (!hostOverride && settings.jdFallbackHost) {
      const fbRes = await fetch(`${settings.jdFallbackHost}/jdcheck.js`, { method: 'GET', cache: 'no-store' }).catch(() => null);
      if (fbRes && fbRes.ok) {
        return {
          connected: true,
          latency: Date.now() - startTime,
          host: settings.jdFallbackHost,
          version: 'JDownloader 2 (Fallback)'
        };
      }
    }

    return { connected: false, latency: null, host, error: `HTTP ${response ? response.status : 'No response'}` };
  } catch (err) {
    return {
      connected: false,
      latency: null,
      host,
      error: err.name === 'AbortError' ? 'Connection timed out' : (err.message || 'Connection refused')
    };
  }
}

function isMediaUrl(url) {
  if (!url || typeof url !== 'string') return false;
  return /(?:https?:\/\/)?(?:[a-zA-Z0-9-]+\.)?(?:youtube\.com|youtu\.be|googlevideo\.com|soundcloud\.com|vimeo\.com|tiktok\.com|twitch\.tv|twitter\.com|x\.com)(?:\/|$)/i.test(url);
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

/**
 * Helper to collect comprehensive session cookies and resolve referrer for downloads
 * Reads cookies for exact URL, apex/root domain, and active tab/referrer
 */
async function collectCookiesAndReferrer(url, initialReferrer) {
  let resolvedReferrer = (initialReferrer || '').trim();

  // If no referrer passed, query the active tab
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs && tabs.length > 0 && tabs[0].url && !tabs[0].url.startsWith('chrome://')) {
      if (!resolvedReferrer) {
        resolvedReferrer = tabs[0].url;
      }
    }
  } catch (_) {}

  function getRootDomain(rawUrl) {
    try {
      const u = new URL(rawUrl);
      const hostParts = u.hostname.split('.');
      if (hostParts.length >= 2) {
        return hostParts.slice(-2).join('.');
      }
      return u.hostname;
    } catch (_) {
      return '';
    }
  }

  const urlsToQuery = new Set();
  const domainsToQuery = new Set();

  if (url) {
    urlsToQuery.add(url);
    const rootD = getRootDomain(url);
    if (rootD) {
      domainsToQuery.add(rootD);
      domainsToQuery.add('.' + rootD);
    }
  }

  if (resolvedReferrer) {
    urlsToQuery.add(resolvedReferrer);
    const rootD = getRootDomain(resolvedReferrer);
    if (rootD) {
      domainsToQuery.add(rootD);
      domainsToQuery.add('.' + rootD);
    }
  }

  let cookieHeader = '';
  if (chrome.cookies) {
    const seenNames = new Set();
    const pairs = [];

    // 1. By exact URL
    for (const u of urlsToQuery) {
      try {
        const cks = await chrome.cookies.getAll({ url: u });
        if (cks) {
          for (const c of cks) {
            if (!seenNames.has(c.name)) {
              seenNames.add(c.name);
              pairs.push(`${c.name}=${c.value}`);
            }
          }
        }
      } catch (_) {}
    }

    // 2. By domain
    for (const d of domainsToQuery) {
      try {
        const cks = await chrome.cookies.getAll({ domain: d });
        if (cks) {
          for (const c of cks) {
            if (!seenNames.has(c.name)) {
              seenNames.add(c.name);
              pairs.push(`${c.name}=${c.value}`);
            }
          }
        }
      } catch (_) {}
    }

    cookieHeader = pairs.join('; ');
  }

  return { cookieHeader, referrer: resolvedReferrer };
}

/**
 * Dispatch downloads to Hydra Engine
 */
async function sendToHydra({ urls, packageName, source, autostartOverride, isMedia, mediaOptions, filename, cookies, fileSize }) {
  if (!urls) return { success: false, error: 'No URLs provided' };

  const settings = await getSettings();
  const host = (settings.hydraHost || 'http://127.0.0.1:4567').replace(/\/+$/, '');
  const autostart = autostartOverride !== undefined ? autostartOverride : settings.autostart;

  const urlList = Array.isArray(urls) ? urls : [urls];
  const cleanUrls = urlList.map(u => String(u).trim()).filter(u => u.length > 0);

  if (cleanUrls.length === 0) {
    return { success: false, error: 'Empty URL list' };
  }

  let cookieHeader = cookies || '';
  let resolvedSource = source || '';
  if (cleanUrls.length > 0) {
    const authData = await collectCookiesAndReferrer(cleanUrls[0], resolvedSource);
    if (!cookieHeader && authData.cookieHeader) {
      cookieHeader = authData.cookieHeader;
    }
    if (!resolvedSource && authData.referrer) {
      resolvedSource = authData.referrer;
    }
  }

  let cleanFilename = (filename || '').trim();
  let targetUrl = cleanUrls[0];

  // Special Treatment for YouTube: Canonicalize to clean watch URL so yt-dlp receives working link
  const ytCanonical = extractCanonicalYoutubeUrl(targetUrl, source);
  if (ytCanonical) {
    targetUrl = ytCanonical;
    isMedia = true;
    if (!mediaOptions) {
      mediaOptions = { mediaType: 'video', videoQuality: '1080' };
    }
  } else if (source && isMediaUrl(source) && (targetUrl.includes('googlevideo.com') || targetUrl.startsWith('blob:') || targetUrl.includes('/videoplayback'))) {
    targetUrl = source;
    isMedia = true;
  }

  const isMediaDetection = !!(isMedia || isMediaUrl(targetUrl) || (source && isMediaUrl(source)));

  // If filename is not supplied or generic, infer from packageName if meaningful
  const isGeneric = !cleanFilename || /^file[_\-\d]/i.test(cleanFilename) || /^stream/i.test(cleanFilename) || /^videoplayback/i.test(cleanFilename);
  if (isGeneric && packageName && packageName !== 'Browser Downloads' && !packageName.startsWith('Package_') && !packageName.startsWith('file_')) {
    let base = packageName.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim();
    if (!base.includes('.')) {
      base += (isMediaDetection && mediaOptions && mediaOptions.mediaType === 'audio') ? '.mp3' : '.mp4';
    }
    cleanFilename = base;
  }

  const pkgName = packageName || cleanFilename || 'Browser Downloads';

  // Strategy A: Native Hydra REST API (single item or media conversion)
  if (cleanUrls.length === 1 || isMediaDetection) {
    try {
      const payload = {
        url: targetUrl,
        filename: cleanFilename || undefined,
        packageName: pkgName,
        referrer: resolvedSource || source || undefined,
        source: resolvedSource || source || undefined,
        cookies: cookieHeader || undefined,
        userAgent: navigator.userAgent,
        totalBytes: fileSize || 0,
        isMedia: isMediaDetection,
        mediaOptions: mediaOptions || undefined,
        autoStart: autostart
      };

      const res = await fetch(`${host}/api/downloads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        notifySuccess(1, pkgName, isMedia ? 'Sent to YouTube/Media Converter' : 'Added to Waterfall');
        return { success: true, count: 1, package: pkgName };
      }
    } catch (e) {
      console.warn('[Waterfall Ext] Native endpoint failed, falling back to batch crawl:', e.message);
    }
  }

  // Strategy B: Waterfall LinkGrabber Crawl / Batch
  try {
    const crawlRes = await fetch(`${host}/api/linkgrabber/crawl`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: cleanUrls.join('\n'),
        packageName: pkgName
      })
    });

    if (crawlRes.ok) {
      notifySuccess(cleanUrls.length, pkgName, 'Added to Waterfall LinkGrabber');
      return { success: true, count: cleanUrls.length, package: pkgName };
    }
  } catch (err) {}

  // Strategy C: FlashGot Compatibility Fallback
  const endpoints = ['/flashgot', '/flash/add'];
  for (const ep of endpoints) {
    try {
      const formData = new URLSearchParams();
      formData.append('urls', cleanUrls.join('\r\n'));
      formData.append('package', pkgName);
      if (source) formData.append('source', source);
      formData.append('autostart', autostart ? '1' : '0');

      const fgRes = await fetch(`${host}${ep}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formData.toString()
      });

      if (fgRes.ok) {
        notifySuccess(cleanUrls.length, pkgName, 'Pushed via FlashGot bridge');
        return { success: true, count: cleanUrls.length, package: pkgName };
      }
    } catch (err) {}
  }

  notifyFailure('Could not connect to Waterfall Engine on ' + host);
  return {
    success: false,
    error: `Could not reach Waterfall Engine at ${host}. Please ensure Waterfall is running.`
  };
}

/**
 * Desktop Notifications
 */
function notifySuccess(count, packageName, subtext = '') {
  if (cachedSettings.showDesktopNotifications) {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'Waterfall Download Suite',
      message: `${subtext || 'Successfully added ' + count + ' item(s)'}\nPackage: ${packageName}`
    });
  }
}

function notifyFailure(errorMessage) {
  if (cachedSettings.showDesktopNotifications) {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'Waterfall Connection Notice',
      message: `${errorMessage}`
    });
  }
}

/**
 * Context Menus
 */
function initContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'hydra-download-link',
      title: '⚡ Download Link with Waterfall',
      contexts: ['link']
    });

    chrome.contextMenus.create({
      id: 'hydra-download-media',
      title: '🎬 Download Media with Waterfall',
      contexts: ['image', 'video', 'audio']
    });

    chrome.contextMenus.create({
      id: 'hydra-convert-mp3',
      title: '🎵 Convert to MP3 (320k) with Waterfall',
      contexts: ['link', 'video', 'audio']
    });

    chrome.contextMenus.create({
      id: 'hydra-download-selection',
      title: '📥 Download Selected Links with Waterfall',
      contexts: ['selection']
    });

    chrome.contextMenus.create({
      id: 'hydra-sep-1',
      type: 'separator',
      contexts: ['page', 'selection']
    });

    chrome.contextMenus.create({
      id: 'hydra-download-all',
      title: '📑 Download All Links on Page with Waterfall',
      contexts: ['page']
    });

    chrome.contextMenus.create({
      id: 'hydra-download-page',
      title: '🌐 Download Page URL with Waterfall',
      contexts: ['page']
    });
  });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const pageTitle = (tab && tab.title) || 'Browser Links';
  const pageUrl = (tab && tab.url) || '';

  if (info.menuItemId === 'hydra-download-link' && info.linkUrl) {
    const ytCanonical = extractCanonicalYoutubeUrl(info.linkUrl, pageUrl);
    await sendToHydra({
      urls: [ytCanonical || info.linkUrl],
      packageName: pageTitle,
      source: pageUrl,
      isMedia: Boolean(ytCanonical),
      mediaOptions: ytCanonical ? { mediaType: 'video', videoQuality: '1080' } : undefined
    });
  } else if (info.menuItemId === 'hydra-download-media' && info.srcUrl) {
    const ytCanonical = extractCanonicalYoutubeUrl(info.srcUrl, pageUrl);
    await sendToHydra({
      urls: [ytCanonical || info.srcUrl],
      packageName: pageTitle,
      source: pageUrl,
      isMedia: Boolean(ytCanonical),
      mediaOptions: ytCanonical ? { mediaType: 'video', videoQuality: '1080' } : undefined
    });
  } else if (info.menuItemId === 'hydra-convert-mp3') {
    const targetUrl = info.linkUrl || info.srcUrl || info.pageUrl;
    const ytCanonical = extractCanonicalYoutubeUrl(targetUrl, pageUrl);
    if (targetUrl || ytCanonical) {
      await sendToHydra({
        urls: [ytCanonical || targetUrl],
        packageName: pageTitle,
        source: pageUrl,
        isMedia: true,
        mediaOptions: {
          mediaType: 'audio',
          audioFormat: 'mp3',
          audioQuality: '0'
        }
      });
    }
  } else if (info.menuItemId === 'hydra-download-selection' && info.selectionText) {
    const extracted = extractUrlsFromText(info.selectionText);
    if (extracted.length > 0) {
      await sendToHydra({
        urls: extracted,
        packageName: `${pageTitle} (Selected Links)`,
        source: pageUrl
      });
    } else {
      notifyFailure('No valid URLs found in selection.');
    }
  } else if (info.menuItemId === 'hydra-download-page' && info.pageUrl) {
    const ytCanonical = extractCanonicalYoutubeUrl(info.pageUrl, pageUrl);
    await sendToHydra({
      urls: [ytCanonical || info.pageUrl],
      packageName: pageTitle,
      source: pageUrl,
      isMedia: Boolean(ytCanonical),
      mediaOptions: ytCanonical ? { mediaType: 'video', videoQuality: '1080' } : undefined
    });
  } else if (info.menuItemId === 'hydra-download-all' && tab && tab.id) {
    try {
      const response = await chrome.tabs.sendMessage(tab.id, { action: 'HARVEST_PAGE_LINKS' });
      if (response && response.links && response.links.length > 0) {
        await sendToHydra({
          urls: response.links,
          packageName: pageTitle,
          source: pageUrl
        });
      } else {
        notifyFailure('No downloadable links detected on page.');
      }
    } catch {
      notifyFailure('Could not collect page links. Please reload tab.');
    }
  }
});

function extractUrlsFromText(text) {
  if (!text) return [];
  const urlRegex = /(?:https?|ftp):\/\/[^\s"'<>)\]}]+/gi;
  const magnetRegex = /magnet:\?[^\s"'<>)\]}]+/gi;

  const urls = text.match(urlRegex) || [];
  const magnets = text.match(magnetRegex) || [];
  return Array.from(new Set([...urls, ...magnets].map(u => u.trim())));
}

/**
 * IDM-Style Network Sniffer
 */
chrome.webRequest.onResponseStarted.addListener(
  (details) => {
    if (details.tabId < 0) return;

    const url = details.url;
    if (url.startsWith('chrome-extension://') || url.includes('127.0.0.1:4567') || url.includes('127.0.0.1:9666')) return;

    let contentType = '';
    let contentLength = 0;

    if (details.responseHeaders) {
      for (const h of details.responseHeaders) {
        const name = h.name.toLowerCase();
        if (name === 'content-type') contentType = (h.value || '').toLowerCase();
        else if (name === 'content-length') contentLength = parseInt(h.value, 10) || 0;
      }
    }

    const isMediaContentType =
      contentType.startsWith('video/') ||
      contentType.startsWith('audio/') ||
      contentType.includes('application/vnd.apple.mpegurl') ||
      contentType.includes('application/x-mpegurl') ||
      contentType.includes('application/dash+xml') ||
      contentType.includes('video/mp4') ||
      contentType.includes('video/webm');

    const mediaExtensions = /\.(mp4|mkv|webm|avi|mov|flv|m4v|ts|m3u8|mpd|mp3|m4a|flac|wav|ogg|opus)(\?|$)/i;
    const isMediaExtension = mediaExtensions.test(url);

    // Special treatment for YouTube: Never store raw googlevideo chunks; store canonical YouTube stream instead
    if (url.includes('googlevideo.com') || url.includes('/videoplayback')) {
      chrome.tabs.get(details.tabId, (tab) => {
        if (chrome.runtime.lastError || !tab || !tab.url) return;
        const canonicalYt = extractCanonicalYoutubeUrl(tab.url);
        if (canonicalYt) {
          let list = tabMediaMap.get(details.tabId) || [];
          if (!list.some(m => m.isYouTube && m.url === canonicalYt)) {
            const cleanTitle = (tab.title || 'YouTube Video')
              .replace(/\s*[-–|•]\s*YouTube\s*$/i, '')
              .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
              .trim();
            list.unshift({
              url: canonicalYt,
              title: cleanTitle,
              filename: `${cleanTitle}.mp4`,
              isMedia: true,
              isYouTube: true,
              contentType: 'video/mp4',
              formattedSize: '1080p Full HD (yt-dlp)',
              timestamp: Date.now()
            });
            tabMediaMap.set(details.tabId, list);
            chrome.tabs.sendMessage(details.tabId, { action: 'MEDIA_DETECTED' }).catch(() => {});
          }
        }
      });
      return;
    }

    if (isMediaContentType || isMediaExtension) {
      if (contentLength > 0 && contentLength < 50000 && !url.includes('.m3u8')) return;

      const mediaItem = {
        url,
        contentType: contentType || 'media/stream',
        contentLength,
        formattedSize: formatBytes(contentLength),
        timestamp: Date.now()
      };

      let list = tabMediaMap.get(details.tabId) || [];
      if (!list.some(m => m.url === url)) {
        list.unshift(mediaItem);
        if (list.length > 50) list = list.slice(0, 50);
        tabMediaMap.set(details.tabId, list);

        chrome.tabs.sendMessage(details.tabId, {
          action: 'MEDIA_DETECTED',
          media: mediaItem,
          allMedia: list
        }).catch(() => {});
      }
    }
  },
  { urls: ['<all_urls>'] },
  ['responseHeaders']
);

/**
 * Chrome Download Interception Engine
 */
async function handleDownloadInterception(downloadItem, candidateFilename) {
  if (!cachedSettings.interceptDownloads) return false;
  if (!downloadItem || !downloadItem.id) return false;
  if (interceptedDownloadIds.has(downloadItem.id)) return true;

  const url = downloadItem.url || '';
  if (!url || url.startsWith('chrome-extension:')) {
    return false;
  }

  // Handle in-memory blob: and data: client-side downloads (e.g. dummyfiles.com, Mega, client-side generators)
  if (url.startsWith('blob:') || url.startsWith('data:')) {
    const rawName = candidateFilename || downloadItem.filename || (lastBlobIntent ? lastBlobIntent.filename : '') || 'download';
    const cleanName = rawName.split(/[\\/]/).pop().split('?')[0];
    const ext = ('.' + cleanName.split('.').pop()).toLowerCase();

    // Check if matches extension or archive/media MIME
    const isMatchedExt = (cachedSettings.interceptExtensions || []).some(e => e.toLowerCase() === ext);
    const isSpecialMime = downloadItem.mime && (
      downloadItem.mime.startsWith('video/') ||
      downloadItem.mime.startsWith('audio/') ||
      downloadItem.mime.includes('zip') ||
      downloadItem.mime.includes('compressed') ||
      downloadItem.mime.includes('tar') ||
      downloadItem.mime.includes('7z') ||
      downloadItem.mime.includes('octet-stream')
    );

    if (isMatchedExt || isSpecialMime || cleanName.includes('.')) {
      pendingBlobDownloads.set(downloadItem.id, {
        id: downloadItem.id,
        url,
        filename: cleanName,
        referrer: downloadItem.referrer || (lastBlobIntent ? lastBlobIntent.pageUrl : ''),
        timestamp: Date.now()
      });
    }
    // Return false so Chrome successfully completes writing the blob data from RAM to disk!
    return false;
  }

  // Check Ctrl / Alt key bypass (forces native browser download)
  const now = Date.now();
  if (now - lastBypassTimestamp < 5000) {
    return false;
  }

  if (bypassedUrls.has(url)) {
    const bypassTime = bypassedUrls.get(url);
    if (now - bypassTime < 20000) return false;
    else bypassedUrls.delete(url);
  }

  if (downloadItem.referrer && bypassedUrls.has(downloadItem.referrer)) {
    const bypassTime = bypassedUrls.get(downloadItem.referrer);
    if (now - bypassTime < 20000) return false;
    else bypassedUrls.delete(downloadItem.referrer);
  }

  const filename = candidateFilename || downloadItem.filename || url.split('?')[0];
  let cleanName = filename.split(/[\\/]/).pop().split('?')[0];
  try { cleanName = decodeURIComponent(cleanName); } catch (_) {}
  const ext = ('.' + cleanName.split('.').pop()).toLowerCase();

  const isGeneric = !cleanName || cleanName.toLowerCase() === 'download' || cleanName.toLowerCase() === 'download.php' || cleanName.toLowerCase().startsWith('file_');

  // If candidateFilename is not provided (e.g. onCreated event) and the name is generic,
  // do NOT intercept yet - wait for onDeterminingFilename where Chrome provides the real Content-Disposition filename!
  if (!candidateFilename && isGeneric) {
    return false;
  }

  const isMatchedExt = (cachedSettings.interceptExtensions || []).some(e => e.toLowerCase() === ext);

  const isMediaOrArchiveMime = downloadItem.mime && (
    downloadItem.mime.startsWith('video/') ||
    downloadItem.mime.startsWith('audio/') ||
    downloadItem.mime.includes('zip') ||
    downloadItem.mime.includes('compressed') ||
    downloadItem.mime.includes('tar') ||
    downloadItem.mime.includes('iso') ||
    downloadItem.mime.includes('x-rar') ||
    downloadItem.mime.includes('7z') ||
    downloadItem.mime.includes('application/octet-stream')
  );

  if (!isMatchedExt && !isMediaOrArchiveMime) return false;

  interceptedDownloadIds.add(downloadItem.id);

  try {
    await chrome.downloads.cancel(downloadItem.id);
  } catch (err) {}

  try {
    await chrome.downloads.erase({ id: downloadItem.id });
  } catch (err) {}

  if (recentlyInterceptedUrls.has(url) && (now - recentlyInterceptedUrls.get(url)) < 5000) {
    return true;
  }
  recentlyInterceptedUrls.set(url, now);

  const pkgName = cleanName || 'Intercepted Download';

  const authData = await collectCookiesAndReferrer(url, downloadItem.referrer || '');

  await sendToHydra({
    urls: [url],
    filename: cleanName,
    packageName: pkgName,
    source: authData.referrer,
    cookies: authData.cookieHeader,
    fileSize: downloadItem.fileSize || downloadItem.totalBytes || 0
  });

  return true;
}

chrome.downloads.onCreated.addListener((downloadItem) => {
  handleDownloadInterception(downloadItem).catch(() => {});
});

chrome.downloads.onDeterminingFilename.addListener((downloadItem, suggest) => {
  handleDownloadInterception(downloadItem, downloadItem.filename)
    .then((intercepted) => {
      if (!intercepted) suggest();
    })
    .catch(() => suggest());
  return true;
});

// Watch for completed blob downloads written to disk by Chrome
chrome.downloads.onChanged.addListener(async (delta) => {
  if (!delta || !delta.id) return;

  if (delta.state && delta.state.current === 'complete') {
    if (pendingBlobDownloads.has(delta.id)) {
      const blobMeta = pendingBlobDownloads.get(delta.id);
      pendingBlobDownloads.delete(delta.id);

      try {
        const items = await chrome.downloads.search({ id: delta.id });
        if (items && items.length > 0 && items[0].filename) {
          const item = items[0];
          const cleanName = item.filename.split(/[\\/]/).pop();
          const host = (cachedSettings.hydraHost || 'http://127.0.0.1:4567').replace(/\/+$/, '');

          const res = await fetch(`${host}/api/downloads/import-completed`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              filePath: item.filename,
              filename: cleanName,
              totalBytes: item.fileSize || 0,
              sourceUrl: item.referrer || blobMeta.referrer || '',
              url: item.url || blobMeta.referrer || '',
              autoExtract: true
            })
          });

          if (res.ok) {
            notifySuccess(1, cleanName, 'Caught download & transferred to Waterfall');
          }
        }
      } catch (err) {
        console.warn('[Waterfall Ext] Failed to import completed blob download:', err);
      }
    }
  } else if (delta.state && delta.state.current === 'interrupted') {
    pendingBlobDownloads.delete(delta.id);
  }
});

/**
 * Message Handler
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const action = message.action;

  if (action === 'GET_SETTINGS') {
    getSettings().then(sendResponse);
    return true;
  }

  if (action === 'SAVE_SETTINGS') {
    saveSettings(message.settings).then(sendResponse);
    return true;
  }

  if (action === 'CHECK_STATUS' || action === 'CHECK_WATERFALL_STATUS' || action === 'CHECK_HYDRA_STATUS') {
    checkHydraStatus(message.host).then(sendResponse);
    return true;
  }

  if (action === 'SEND_TO_WATERFALL' || action === 'SEND_TO_HYDRA') {
    sendToHydra(message.data).then(sendResponse);
    return true;
  }

  if (action === 'GET_TAB_MEDIA') {
    const tabId = message.tabId || (sender.tab && sender.tab.id);
    const media = tabId ? (tabMediaMap.get(tabId) || []) : [];
    sendResponse({ media });
    return false;
  }

  if (action === 'REGISTER_BLOB_INTENT') {
    lastBlobIntent = {
      url: message.url,
      filename: message.filename,
      pageUrl: message.pageUrl,
      pageTitle: message.pageTitle,
      timestamp: Date.now()
    };
    sendResponse({ ok: true });
    return false;
  }

  if (action === 'REGISTER_BYPASS_URL' || action === 'REGISTER_BYPASS') {
    const ts = Date.now();
    lastBypassTimestamp = ts;
    if (message.url) bypassedUrls.set(message.url, ts);
    if (message.pageUrl) bypassedUrls.set(message.pageUrl, ts);
    sendResponse({ ok: true, timestamp: ts });
    return false;
  }

  return false;
});

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return 'Stream / Dynamic';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// Lifecycle
chrome.runtime.onInstalled.addListener(() => {
  initContextMenus();
});

chrome.runtime.onStartup.addListener(() => {
  initContextMenus();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabMediaMap.delete(tabId);
});
