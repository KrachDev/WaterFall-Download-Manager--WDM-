/**
 * Buzzheavier Direct Download Resolver
 */
const path = require('path');

const buzzheavierHoster = {
  name: 'Buzzheavier',
  id: 'buzzheavier',
  pattern: /^https?:\/\/(?:www\.)?buzzheavier\.com\/([a-zA-Z0-9_-]+)/i,

  async resolve(url) {
    try {
      const u = new URL(url);
      const cleanUrl = u.origin + u.pathname;
      const downloadTarget = cleanUrl.endsWith('/download') ? cleanUrl : `${cleanUrl}/download`;

      const res = await fetch(downloadTarget, {
        method: 'HEAD',
        redirect: 'follow',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        signal: AbortSignal.timeout(5000)
      });

      if (res.ok) {
        let filename = 'buzzheavier_file';
        const cd = res.headers.get('content-disposition');
        if (cd) {
          const match = cd.match(/filename\*?=['"]?(?:UTF-8'')?([^'";\n]+)['"]?/i);
          if (match) filename = decodeURIComponent(match[1]);
        }
        if (filename === 'buzzheavier_file') {
          const base = path.basename(new URL(res.url).pathname);
          if (base && base.includes('.')) filename = decodeURIComponent(base);
        }

        const size = parseInt(res.headers.get('content-length') || '0', 10);
        return {
          directUrl: res.url || downloadTarget,
          filename,
          size,
          hoster: 'Buzzheavier',
          status: 'online'
        };
      }
    } catch (_) {}

    return {
      directUrl: url.endsWith('/download') ? url : `${url}/download`,
      filename: 'buzzheavier_download',
      size: 0,
      hoster: 'Buzzheavier',
      status: 'online'
    };
  }
};

module.exports = buzzheavierHoster;
