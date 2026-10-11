const path = require('path');
const { probeMedia } = require('../mediaDownloader');
const gofileHoster = require('./gofile');
const transferItHoster = require('./transferIt');
const fuckingFastHoster = require('./fuckingfast');

class HosterManager {
  constructor() {
    this.hosters = [];
    this.registerDefaults();
  }

  registerDefaults() {
    // Specialized hosters
    this.register(gofileHoster);
    this.register(transferItHoster);
    this.register(fuckingFastHoster);

    // 0. YouTube & Streaming Audio/Video
    this.register({
      name: 'YouTube',
      id: 'youtube',
      pattern: /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+/i,
      async resolve(url) {
        try {
          const info = await probeMedia(url);
          return {
            directUrl: url,
            filename: `${info.title.replace(/[<>:"/\\|?*]/g, '_')}.mp3`,
            size: 0,
            hoster: 'YouTube',
            status: 'online',
            isMedia: true,
            mediaOptions: { mediaType: 'audio', audioFormat: 'mp3', audioQuality: '0' }
          };
        } catch (_) {
          return {
            directUrl: url,
            filename: `youtube_stream.mp3`,
            size: 0,
            hoster: 'YouTube',
            status: 'online',
            isMedia: true,
            mediaOptions: { mediaType: 'audio', audioFormat: 'mp3', audioQuality: '0' }
          };
        }
      }
    });

    // 1. Pixeldrain
    this.register({
      name: 'Pixeldrain',
      id: 'pixeldrain',
      pattern: /^https?:\/\/(?:www\.)?pixeldrain\.com\/(?:u|d)\/([a-zA-Z0-9_-]+)/i,
      async resolve(url) {
        const match = url.match(/^https?:\/\/(?:www\.)?pixeldrain\.com\/(?:u|d)\/([a-zA-Z0-9_-]+)/i);
        if (!match) return null;
        const fileId = match[1];
        
        try {
          const infoRes = await fetch(`https://pixeldrain.com/api/file/${fileId}/info`, {
            headers: { 'User-Agent': 'WaterfallDL/2.0' }
          });
          if (infoRes.ok) {
            const data = await infoRes.json();
            return {
              directUrl: `https://pixeldrain.com/api/file/${fileId}`,
              filename: data.name || `pixeldrain_${fileId}`,
              size: data.size || 0,
              hoster: 'Pixeldrain',
              status: 'online'
            };
          }
        } catch (e) {
          console.warn('Pixeldrain API probe failed, using direct fallback:', e.message);
        }

        return {
          directUrl: `https://pixeldrain.com/api/file/${fileId}`,
          filename: `pixeldrain_${fileId}`,
          size: 0,
          hoster: 'Pixeldrain',
          status: 'online'
        };
      }
    });

    // 2. MediaFire
    this.register({
      name: 'MediaFire',
      id: 'mediafire',
      pattern: /^https?:\/\/(?:www\.)?mediafire\.com\/(?:file|download)\/([a-zA-Z0-9]+)/i,
      async resolve(url) {
        try {
          const res = await fetch(url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
          });
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
          console.warn('Mediafire scraping failed:', e.message);
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

    // 3. Catbox
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

    // 4. Archive.org
    this.register({
      name: 'Archive.org',
      id: 'archive_org',
      pattern: /^https?:\/\/(?:www\.)?archive\.org\/download\//i,
      async resolve(url) {
        const u = new URL(url);
        const filename = path.basename(u.pathname) || 'archive_download';
        return {
          directUrl: url,
          filename: decodeURIComponent(filename),
          size: 0,
          hoster: 'Archive.org',
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
          notice: 'Requires direct token or premium for instant high-speed multi-threaded chunks.'
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
    if (!hoster) return null;
    return await hoster.resolve(url);
  }
}

const hosterManager = new HosterManager();
module.exports = hosterManager;
