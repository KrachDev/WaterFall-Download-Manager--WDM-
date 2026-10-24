/**
 * Pixeldrain Advanced Resolver (Single files /u/ & Multi-file albums /l/)
 */
const pixeldrainHoster = {
  name: 'Pixeldrain',
  id: 'pixeldrain',
  pattern: /^https?:\/\/(?:www\.)?pixeldrain\.com\/(?:u|d|l)\/([a-zA-Z0-9_-]+)/i,

  async resolve(url) {
    const match = url.match(/^https?:\/\/(?:www\.)?pixeldrain\.com\/(u|d|l)\/([a-zA-Z0-9_-]+)/i);
    if (!match) return null;
    const type = match[1].toLowerCase();
    const id = match[2];

    // Case 1: Multi-file album / list under /l/:id
    if (type === 'l') {
      try {
        const res = await fetch(`https://pixeldrain.com/api/list/${id}`, {
          headers: { 'User-Agent': 'Waterfall/2.0' },
          signal: AbortSignal.timeout(6000)
        });
        if (res.ok) {
          const data = await res.json();
          if (data && Array.isArray(data.files) && data.files.length > 0) {
            const albumTitle = data.title || `Pixeldrain_Album_${id}`;
            const items = data.files.map(f => ({
              directUrl: `https://pixeldrain.com/api/file/${f.id}`,
              filename: f.name || `pixeldrain_${f.id}`,
              size: f.size || 0,
              hoster: 'Pixeldrain',
              packageName: albumTitle,
              status: 'online'
            }));

            return {
              isMulti: true,
              packageName: albumTitle,
              hoster: 'Pixeldrain',
              items
            };
          }
        }
      } catch (e) {
        console.warn('[Pixeldrain] List resolution warning:', e.message);
      }
    }

    // Case 2: Single file under /u/:id or /d/:id
    try {
      const infoRes = await fetch(`https://pixeldrain.com/api/file/${id}/info`, {
        headers: { 'User-Agent': 'Waterfall/2.0' },
        signal: AbortSignal.timeout(4000)
      });
      if (infoRes.ok) {
        const data = await infoRes.json();
        return {
          directUrl: `https://pixeldrain.com/api/file/${id}`,
          filename: data.name || `pixeldrain_${id}`,
          size: data.size || 0,
          hoster: 'Pixeldrain',
          status: 'online'
        };
      }
    } catch (_) {}

    return {
      directUrl: `https://pixeldrain.com/api/file/${id}`,
      filename: `pixeldrain_${id}`,
      size: 0,
      hoster: 'Pixeldrain',
      status: 'online'
    };
  }
};

module.exports = pixeldrainHoster;
