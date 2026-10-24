/**
 * Archive.org Unified Resolver (Direct files & /details/ multi-file items)
 */
const path = require('path');

const archiveOrgHoster = {
  name: 'Archive.org',
  id: 'archive_org',
  pattern: /^https?:\/\/(?:www\.)?archive\.org\/(?:details|download)\/([^\/?#]+)/i,

  async resolve(url) {
    const match = url.match(/^https?:\/\/(?:www\.)?archive\.org\/(?:details|download)\/([^\/?#]+)/i);
    if (!match) return null;
    const identifier = match[1];

    // Case 1: Direct file link under /download/identifier/filename
    const downloadMatch = url.match(/^https?:\/\/(?:www\.)?archive\.org\/download\/([^\/?#]+)\/(.+)$/i);
    if (downloadMatch) {
      const filename = path.basename(new URL(url).pathname);
      return {
        directUrl: url,
        filename: decodeURIComponent(filename) || 'archive_file',
        size: 0,
        hoster: 'Archive.org',
        status: 'online'
      };
    }

    // Case 2: Multi-file item page under /details/identifier
    try {
      const apiUrl = `https://archive.org/metadata/${identifier}/files`;
      const res = await fetch(apiUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Waterfall/2.0' },
        signal: AbortSignal.timeout(8000)
      });

      if (!res.ok) return null;
      const data = await res.json();
      if (!data || !Array.isArray(data.result)) return null;

      // Filter out internal metadata/xml/sqlite files unless explicitly requested
      const ignoredExts = new Set(['xml', 'sqlite', 'torrent', 'meta']);
      const files = data.result.filter(f => {
        const ext = path.extname(f.name || '').replace('.', '').toLowerCase();
        return !ignoredExts.has(ext) && !f.name.startsWith('__');
      });

      if (files.length === 0) return null;

      const items = files.map(f => {
        const directUrl = `https://archive.org/download/${identifier}/${encodeURIComponent(f.name)}`;
        const size = parseInt(f.size || '0', 10);
        return {
          directUrl,
          filename: f.name,
          size,
          hoster: 'Archive.org',
          packageName: `Archive_${identifier}`,
          status: 'online'
        };
      });

      return {
        isMulti: true,
        packageName: `Archive_${identifier}`,
        hoster: 'Archive.org',
        items
      };
    } catch (e) {
      console.warn('[Archive.org] Metadata fetch failed:', e.message);
      return null;
    }
  }
};

module.exports = archiveOrgHoster;
