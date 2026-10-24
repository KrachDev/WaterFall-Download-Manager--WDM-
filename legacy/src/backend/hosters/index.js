const path = require('path');
const { probeMedia, isMediaUrl } = require('../mediaDownloader');
const gofileHoster = require('./gofile');
const transferItHoster = require('./transferIt');
const fuckingFastHoster = require('./fuckingfast');
const pixeldrainHoster = require('./pixeldrain');
const archiveOrgHoster = require('./archiveOrg');
const krakenfilesHoster = require('./krakenfiles');
const buzzheavierHoster = require('./buzzheavier');
const dummyfilesHoster = require('./dummyfiles');

class HosterManager {
  constructor() {
    this.hosters = [];
    this.registerDefaults();
  }

  registerDefaults() {
    // Specialized multi-file & direct hosters
    this.register(gofileHoster);
    this.register(transferItHoster);
    this.register(fuckingFastHoster);
    this.register(pixeldrainHoster);
    this.register(archiveOrgHoster);
    this.register(krakenfilesHoster);
    this.register(buzzheavierHoster);
    this.register(dummyfilesHoster);

    // 0. YouTube & Streaming Audio/Video
    this.register({
      name: 'YouTube',
      id: 'youtube',
      pattern: /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+/i,
      async resolve(url) {
        // If playlist, extract via crawlMediaPlaylist directly
        if (/[?&]list=|(\/playlist)/i.test(url)) {
          const { crawlMediaPlaylist } = require('../crawlerEngine');
          const pl = await crawlMediaPlaylist(url);
          if (pl && pl.isMulti && Array.isArray(pl.items) && pl.items.length > 0) {
            return pl;
          }
        }

        try {
          const info = await probeMedia(url);
          if (info && info.isPlaylist && Array.isArray(info.entries)) {
            const playlistTitle = info.title || 'YouTube Playlist';
            return {
              isMulti: true,
              packageName: playlistTitle,
              hoster: 'YouTube',
              items: info.entries.map((entry, idx) => ({
                originalUrl: entry.url,
                directUrl: entry.url,
                filename: `${(entry.title || `Track_${idx + 1}`).replace(/[<>:"/\\|?*]/g, '_')}.mp3`,
                size: 0,
                hoster: 'YouTube',
                packageName: playlistTitle,
                status: 'online',
                isMedia: true,
                mediaOptions: { mediaType: 'audio', audioFormat: 'mp3', audioQuality: '0' }
              }))
            };
          }

          return {
            directUrl: url,
            filename: `${((info && info.title) ? info.title : 'youtube_media').replace(/[<>:"/\\|?*]/g, '_')}.mp3`,
            size: 0,
            hoster: 'YouTube',
            status: 'online',
            isMedia: true,
            mediaOptions: { mediaType: 'audio', audioFormat: 'mp3', audioQuality: '0' }
          };
        } catch (_) {
          return {
            directUrl: url,
            filename: 'youtube_stream.mp3',
            size: 0,
            hoster: 'YouTube',
            status: 'online',
            isMedia: true,
            mediaOptions: { mediaType: 'audio', audioFormat: 'mp3', audioQuality: '0' }
          };
        }
      }
    });

    // 0.1 Qiwi
    this.register({
      name: 'Qiwi',
      id: 'qiwi',
      pattern: /^https?:\/\/(?:www\.)?qiwi\.(?:gg|to)\/file\/([a-zA-Z0-9_-]+)/i,
      async resolve(url) {
        try {
          const res = await fetch(url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            signal: AbortSignal.timeout(5000)
          });
          if (res.ok) {
            const html = await res.text();
            const dlMatch = html.match(/href="(https:\/\/[^"]*qiwi\.[^"]*\/[^\/]+\/download[^"]*)"/i) ||
                            html.match(/<a[^>]*href="([^"]+)"[^>]*>Download/i);
            const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
            let filename = titleMatch ? titleMatch[1].replace(/\s*-\s*Qiwi.*$/i, '').trim() : 'qiwi_download';

            if (dlMatch) {
              return {
                directUrl: new URL(dlMatch[1], url).href,
                filename,
                size: 0,
                hoster: 'Qiwi',
                status: 'online'
              };
            }
          }
        } catch (_) {}

        return {
          directUrl: url,
          filename: 'qiwi_file',
          size: 0,
          hoster: 'Qiwi',
          status: 'online'
        };
      }
    });

    // 1. Google Drive
    this.register({
      name: 'Google Drive',
      id: 'gdrive',
      pattern: /^https?:\/\/(?:drive|docs)\.google\.com\/(?:file\/d\/|open\?id=)([a-zA-Z0-9_-]+)/i,
      async resolve(url) {
        const match = url.match(/^https?:\/\/(?:drive|docs)\.google\.com\/(?:file\/d\/|open\?id=)([a-zA-Z0-9_-]+)/i);
        if (!match) return null;
        const id = match[1];
        return {
          directUrl: `https://drive.google.com/uc?export=download&id=${id}`,
          filename: `gdrive_${id}`,
          size: 0,
          hoster: 'Google Drive',
          status: 'online'
        };
      }
    });

    // 2. Dropbox
    this.register({
      name: 'Dropbox',
      id: 'dropbox',
      pattern: /^https?:\/\/(?:www\.)?dropbox\.com\/s(?:cl)?\//i,
      async resolve(url) {
        let directUrl = url;
        if (directUrl.includes('dl=0')) directUrl = directUrl.replace('dl=0', 'dl=1');
        else if (!directUrl.includes('dl=1')) directUrl += (directUrl.includes('?') ? '&dl=1' : '?dl=1');
        const u = new URL(url);
        const filename = path.basename(u.pathname) || 'dropbox_file';
        return {
          directUrl,
          filename: decodeURIComponent(filename),
          size: 0,
          hoster: 'Dropbox',
          status: 'online'
        };
      }
    });

    // 3. MediaFire
    this.register({
      name: 'MediaFire',
      id: 'mediafire',
      pattern: /^https?:\/\/(?:www\.)?mediafire\.com\/(?:file|download|folder)\/([a-zA-Z0-9]+)/i,
      async resolve(url) {
        try {
          const res = await fetch(url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
            },
            signal: AbortSignal.timeout(5000)
          });
          if (!res.ok) return null;
          const html = await res.text();

          // Regex search for direct download button href
          const dlMatch = html.match(/aria-label="Download file"[\s\S]*?href="(https:\/\/[^"]+)"/i) ||
                          html.match(/id="downloadButton"[\s\S]*?href="(https:\/\/[^"]+)"/i) ||
                          html.match(/href="(https:\/\/download\d+\.mediafire\.com\/[^"]+)"/i);

          const nameMatch = html.match(/<div class="filename">(.*?)<\/div>/i) ||
                            html.match(/<title>Download (.*?)<\/title>/i) ||
                            html.match(/aria-label="Download file"[^>]*>Download (.*?)\(/i);

          if (dlMatch && dlMatch[1]) {
            return {
              directUrl: dlMatch[1],
              filename: nameMatch ? nameMatch[1].trim() : 'mediafire_download',
              size: 0,
              hoster: 'MediaFire',
              status: 'online'
            };
          }
        } catch (e) {
          console.warn('[MediaFire] Scraping failed:', e.message);
        }

        return {
          directUrl: url,
          filename: 'mediafire_file',
          size: 0,
          hoster: 'MediaFire',
          status: 'online'
        };
      }
    });

    // 4. Catbox
    this.register({
      name: 'Catbox',
      id: 'catbox',
      pattern: /^https?:\/\/files\.catbox\.moe\/([a-zA-Z0-9_-]+\.[a-zA-Z0-9]+)/i,
      async resolve(url) {
        const match = url.match(/^https?:\/\/files\.catbox\.moe\/([a-zA-Z0-9_-]+\.[a-zA-Z0-9]+)/i);
        const filename = match ? match[1] : path.basename(new URL(url).pathname);
        return {
          directUrl: url,
          filename: filename,
          size: 0,
          hoster: 'Catbox',
          status: 'online'
        };
      }
    });

    // 5. 1Fichier
    this.register({
      name: '1Fichier',
      id: '1fichier',
      pattern: /^https?:\/\/(?:www\.)?1fichier\.com\/\?([a-zA-Z0-9]+)/i,
      async resolve(url) {
        return {
          directUrl: url,
          filename: '1fichier_file',
          size: 0,
          hoster: '1Fichier',
          status: 'online',
          notice: 'Supports direct download token or premium.'
        };
      }
    });

    // 6. Direct HTTP / CDN / Fallback
    this.register({
      name: 'Direct URL / CDN',
      id: 'direct',
      pattern: /^https?:\/\/.+/i,
      async resolve(url) {
        let filename = 'download';
        let size = 0;
        let status = 'online';

        try {
          const u = new URL(url);
          const base = path.basename(u.pathname);
          if (base && base.includes('.')) {
            filename = decodeURIComponent(base);
          }
        } catch (_) {}

        return {
          directUrl: url,
          filename: filename,
          size: size,
          hoster: 'Direct CDN/Web',
          status: status
        };
      }
    });
  }

  register(plugin) {
    this.hosters.push(plugin);
  }

  detectHoster(url) {
    for (const h of this.hosters) {
      if (h.id !== 'direct' && h.pattern.test(url)) {
        return h;
      }
    }
    return this.hosters.find(h => h.id === 'direct');
  }

  async resolve(url) {
    const hoster = this.detectHoster(url);
    if (hoster && hoster.id !== 'direct') {
      try {
        const res = await hoster.resolve(url);
        if (res) return res;
      } catch (e) {
        console.warn(`[Waterfall] Specialized hoster ${hoster.name} failed:`, e.message);
      }
    }

    // Fast-path: If the URL is an explicit media host (YouTube, TikTok, SoundCloud, etc.), probe via yt-dlp
    if (isMediaUrl(url)) {
      try {
        const { probeWithYtDlp } = require('../crawlerEngine');
        const universalRes = await probeWithYtDlp(url);
        if (universalRes && universalRes.directUrl) {
          return universalRes;
        }
      } catch (_) {}
    }

    const directHoster = this.hosters.find(h => h.id === 'direct');
    if (directHoster) {
      return await directHoster.resolve(url);
    }
    return null;
  }
}

const hosterManager = new HosterManager();
module.exports = hosterManager;
