/**
 * Krakenfiles Resolver
 */
const krakenfilesHoster = {
  name: 'Krakenfiles',
  id: 'krakenfiles',
  pattern: /^https?:\/\/(?:www\.)?krakenfiles\.com\/view\/([a-zA-Z0-9_-]+)/i,

  async resolve(url) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
        },
        signal: AbortSignal.timeout(6000)
      });
      if (!res.ok) return null;
      const html = await res.text();

      // Extract filename
      const titleMatch = html.match(/<h5 class="[^"]*file-name[^"]*">([^<]+)<\/h5>/i) ||
                         html.match(/<title>([^<]+)<\/title>/i);
      let filename = titleMatch ? titleMatch[1].trim() : 'krakenfiles_download';
      filename = filename.replace(/\s*-\s*Krakenfiles.*$/i, '').trim();

      // Extract direct download link or token form
      const tokenMatch = html.match(/name="token"\s+value="([^"]+)"/i);
      const actionMatch = html.match(/id="dl-form"\s+action="([^"]+)"/i);

      if (tokenMatch && actionMatch) {
        const actionUrl = new URL(actionMatch[1], url).href;
        const postRes = await fetch(actionUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Referer': url
          },
          body: `token=${encodeURIComponent(tokenMatch[1])}`,
          signal: AbortSignal.timeout(6000)
        });

        if (postRes.ok) {
          const json = await postRes.json().catch(() => null);
          if (json && json.url) {
            return {
              directUrl: json.url,
              filename,
              size: 0,
              hoster: 'Krakenfiles',
              status: 'online'
            };
          }
        }
      }

      // Fallback: direct anchor search
      const directMatch = html.match(/href="([^"]+\/download\/[^"]+)"/i);
      if (directMatch) {
        return {
          directUrl: new URL(directMatch[1], url).href,
          filename,
          size: 0,
          hoster: 'Krakenfiles',
          status: 'online'
        };
      }
    } catch (e) {
      console.warn('[Krakenfiles] Scraping warning:', e.message);
    }

    return null;
  }
};

module.exports = krakenfilesHoster;
