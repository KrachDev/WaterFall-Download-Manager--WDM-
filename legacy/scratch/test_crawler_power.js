const html = `
<!DOCTYPE html>
<html>
<head><title>Super Cool Game Repack - Download Mirrors</title></head>
<body>
  <h1>Download Super Cool Game</h1>
  <p>Mirror 1: <a href="https://pixeldrain.com/u/abc12345">Pixeldrain Mirror</a></p>
  <p>Mirror 2 (Multi-part):</p>
  <a href="https://files.catbox.moe/part1.rar">Part 1</a>
  <a href="https://files.catbox.moe/part2.rar">Part 2</a>
  <a href="/downloads/setup.exe">Direct Installer (Relative)</a>
  <a href="https://twitter.com/dev">Follow us on Twitter</a>
  <a href="#comments">Comments</a>
</body>
</html>
`;

function extractDownloadLinksFromHtml(htmlContent, baseUrl) {
  const links = new Set();
  const hrefRegex = /href=["']([^"']+)["']/gi;
  let match;
  while ((match = hrefRegex.exec(htmlContent)) !== null) {
    const raw = match[1].trim();
    if (!raw || raw.startsWith('#') || raw.startsWith('javascript:')) continue;
    try {
      const fullUrl = new URL(raw, baseUrl).href;
      links.add(fullUrl);
    } catch (_) {}
  }

  // Filter links: known hosters or binary file extensions
  const fileExtRegex = /\.(zip|rar|7z|tar|gz|bz2|xz|iso|pkg|bin|exe|msi|dmg|apk|deb|rpm|pdf|docx?|xlsx?|epub|cbz|cbr|mp4|mkv|avi|webm|mp3|flac|wav|m4a)(\?.*)?$/i;
  const hosterRegex = /(pixeldrain\.com|gofile\.io|mediafire\.com|mega\.nz|1fichier\.com|rapidgator\.net|ddownload\.com|catbox\.moe|krakenfiles\.com|buzzheavier\.com|qiwi\.gg|fuckingfast\.co|transfer\.it)/i;

  const validLinks = Array.from(links).filter(u => {
    // Ignore social / standard navigation
    if (/(twitter\.com|facebook\.com|instagram\.com|discord\.gg|patreon\.com)/i.test(u)) return false;
    return fileExtRegex.test(u) || hosterRegex.test(u);
  });

  return validLinks;
}

const extracted = extractDownloadLinksFromHtml(html, 'https://example-repacks.site/game-123/');
console.log('Extracted links:', extracted);
