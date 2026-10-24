const { parseSizeString } = require('../dummyFileGenerator');

/**
 * DummyFiles.com Host Resolver
 * Generates exact-size dummy streams with full Accept-Ranges support.
 */
const dummyfilesHoster = {
  name: 'DummyFiles',
  id: 'dummyfiles',
  pattern: /^https?:\/\/(?:www\.)?dummyfiles\.com\/.*/i,

  async resolve(url) {
    let format = 'zip';
    let sizeStr = '10mb';

    const match = url.match(/dummyfiles\.com\/dummy-([a-z0-9]+)(?:\/([a-z0-9]+))?/i);
    if (match) {
      if (match[1]) format = match[1].toLowerCase();
      if (match[2]) sizeStr = match[2].toLowerCase();
    } else {
      // Check query params if any
      try {
        const u = new URL(url);
        if (u.searchParams.get('format')) format = u.searchParams.get('format');
        if (u.searchParams.get('size')) sizeStr = u.searchParams.get('size');
      } catch (_) {}
    }

    const sizeBytes = parseSizeString(sizeStr);
    const filename = `dummy_${sizeStr}.${format}`;
    const directUrl = `http://127.0.0.1:4567/api/dummy-generator?format=${encodeURIComponent(format)}&size=${sizeBytes}&filename=${encodeURIComponent(filename)}`;

    return {
      directUrl,
      filename,
      size: sizeBytes,
      hoster: 'DummyFiles (Direct Stream)',
      status: 'online',
      acceptRanges: true,
      downloadHeaders: null,
      isMedia: false
    };
  }
};

module.exports = dummyfilesHoster;
