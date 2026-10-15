const path = require('path');
const { safeRequest, safeProbe } = require('../httpHelper');
const cfBrowserSolver = require('../cfBrowserSolver');

class FuckingFastResolver {
  extractFileId(url) {
    if (!url) return null;
    const match = url.match(/^https?:\/\/(?:www\.)?fuck(?:ing)?fast\.co\/(?:f\/|dl\/)?([a-zA-Z0-9_-]+)/i);
    return match ? match[1] : null;
  }

  isDirectDownloadUrl(url) {
    try {
      const u = new URL(url);
      return u.pathname.startsWith('/dl/');
    } catch (_) {
      return false;
    }
  }

  async resolve(url) {
    const fileId = this.extractFileId(url) || 'file';

    // 1. If it's already a direct download URL
    if (this.isDirectDownloadUrl(url)) {
      let filename = `fuckingfast_${fileId}`;
      try {
        const u = new URL(url);
        const base = path.basename(u.pathname);
        if (base && base.includes('.')) {
          filename = decodeURIComponent(base);
        }
      } catch (_) {}

      return {
        directUrl: url,
        filename,
        size: 0,
        hoster: 'FuckingFast',
        status: 'online'
      };
    }

    // 2. Try fast HTTP scrape first
    try {
      const res = await safeRequest(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        },
        timeout: 6000
      });

      if (res) {
        if (res.status === 404 || res.status === 410) {
          return {
            directUrl: url,
            filename: `fuckingfast_${fileId}`,
            size: 0,
            hoster: 'FuckingFast',
            status: 'offline'
          };
        }

        if (res.status === 200) {
          const html = res.text();
          if (html.includes('File Not Found') || html.includes('File has been deleted') || html.includes('File does not exist')) {
            return {
              directUrl: url,
              filename: `fuckingfast_${fileId}`,
              size: 0,
              hoster: 'FuckingFast',
              status: 'offline'
            };
          }

          if (!html.includes('Just a moment') && !html.includes('challenges.cloudflare.com')) {
            // Check for direct download link or scripts
            const dlMatch = html.match(/<a\s+[^>]*href=["'](https?:\/\/[^"']*fuckingfast\.co\/dl\/[^"']+)["']/i) ||
                            html.match(/window\.open\(\s*["'](https?:\/\/[^"']*fuckingfast\.co\/dl\/[^"']+)["']/i) ||
                            html.match(/(?:window\.)?location(?:\.href)?\s*=\s*["'](https?:\/\/[^"']*fuckingfast\.co\/dl\/[^"']+)["']/i);

            const titleMatch = html.match(/<title>(.*?)<\/title>/i);
            let filename = `fuckingfast_${fileId}`;
            if (titleMatch && titleMatch[1] && !titleMatch[1].toLowerCase().includes('fuckingfast')) {
              filename = titleMatch[1].trim();
            }

            if (dlMatch && dlMatch[1]) {
              let size = 0;
              try {
                const probeRes = await safeProbe(dlMatch[1], { timeout: 3500 });
                if (probeRes && probeRes.headers) {
                  const cl = probeRes.headers.get('content-length');
                  if (cl) size = parseInt(cl, 10);
                }
              } catch (_) {}

              return {
                directUrl: dlMatch[1],
                filename,
                size,
                hoster: 'FuckingFast',
                status: 'online'
              };
            }
          }
        }
      }
    } catch (_) {}

    // 3. Fallback to Cloudflare headless solver
    try {
      const solved = await cfBrowserSolver.solve(url);
      if (solved && solved.directUrl) {
        let size = solved.size || 0;
        if (!size) {
          try {
            const probeRes = await safeProbe(solved.directUrl, { timeout: 3500 });
            if (probeRes && probeRes.headers) {
              const cl = probeRes.headers.get('content-length');
              if (cl) size = parseInt(cl, 10);
            }
          } catch (_) {}
        }

        return {
          directUrl: solved.directUrl,
          filename: solved.filename || `fuckingfast_${fileId}`,
          size,
          hoster: 'FuckingFast',
          status: 'online'
        };
      }
    } catch (err) {
      console.warn('[FuckingFast] Cloudflare solver warning:', err.message);
    }

    // 4. Fallback online item
    return {
      directUrl: url,
      filename: `fuckingfast_${fileId}`,
      size: 0,
      hoster: 'FuckingFast',
      status: 'online'
    };
  }
}

const fuckingFastResolver = new FuckingFastResolver();

module.exports = {
  name: 'FuckingFast',
  id: 'fuckingfast',
  pattern: /^https?:\/\/(?:www\.)?fuck(?:ing)?fast\.co\/(?:f\/|dl\/)?([a-zA-Z0-9_-]+)/i,
  resolve: (url) => fuckingFastResolver.resolve(url)
};
