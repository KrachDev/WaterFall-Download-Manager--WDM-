const assert = require('assert');

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

// Tests
console.log('Testing YouTube Canonicalization...');

// 1. Standard watch URL
const t1 = extractCanonicalYoutubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
assert.strictEqual(t1, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');

// 2. Watch URL with extra query params
const t2 = extractCanonicalYoutubeUrl('https://www.youtube.com/watch?feature=shared&v=dQw4w9WgXcQ&t=42s');
assert.strictEqual(t2, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');

// 3. youtu.be shortlink
const t3 = extractCanonicalYoutubeUrl('https://youtu.be/dQw4w9WgXcQ?t=10');
assert.strictEqual(t3, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');

// 4. YouTube shorts
const t4 = extractCanonicalYoutubeUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ');
assert.strictEqual(t4, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');

// 5. Raw googlevideo.com chunk with YouTube source
const t5 = extractCanonicalYoutubeUrl('https://rr3---sn-4g5edn6s.googlevideo.com/videoplayback?expire=123', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
assert.strictEqual(t5, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');

// 6. Direct non-youtube url
const t6 = extractCanonicalYoutubeUrl('https://example.com/file.zip');
assert.strictEqual(t6, null);

console.log('All YouTube Canonicalization tests passed successfully!');
