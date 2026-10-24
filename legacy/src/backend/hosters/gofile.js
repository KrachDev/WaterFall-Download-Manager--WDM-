const vm = require('vm');
const path = require('path');

class GofileResolver {
  constructor() {
    this.sessionCache = {
      token: null,
      wtCode: null,
      fetchedAt: 0,
      sandbox: null
    };
    this.USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
    this.LANG = 'en-US';
  }

  async getSandbox() {
    const now = Date.now();
    // Cache wtCode and sandbox for 3 hours
    if (this.sessionCache.sandbox && (now - this.sessionCache.fetchedAt < 3 * 3600 * 1000)) {
      return this.sessionCache.sandbox;
    }

    try {
      const wtRes = await fetch('https://gofile.io/js/wt.obf.js', {
        headers: { 'User-Agent': this.USER_AGENT }
      });
      if (!wtRes.ok) throw new Error(`Failed to load wt.obf.js: ${wtRes.status}`);
      const wtCode = await wtRes.text();

      const safeConsole = Object.freeze({
        log: () => {},
        warn: () => {},
        error: () => {},
        info: () => {},
        debug: () => {}
      });

      const sandbox = {
        console: safeConsole,
        navigator: Object.freeze({ userAgent: this.USER_AGENT, language: this.LANG }),
        location: Object.freeze({ hostname: 'gofile.io', protocol: 'https:' }),
        window: {},
        globalThis: {}
      };
      sandbox.window = sandbox;
      sandbox.globalThis = sandbox;
      sandbox.self = sandbox;

      vm.createContext(sandbox);
      vm.runInContext(wtCode, sandbox, { timeout: 3000 });

      this.sessionCache.wtCode = wtCode;
      this.sessionCache.sandbox = sandbox;
      this.sessionCache.fetchedAt = now;
      return sandbox;
    } catch (err) {
      console.warn('[Gofile] Sandbox creation warning:', err.message);
      return null;
    }
  }

  async getGuestSession() {
    const sandbox = await this.getSandbox();
    if (!sandbox) return null;

    try {
      // If we don't have an active guest token, mint one
      if (!this.sessionCache.token) {
        const wtNoToken = await sandbox.generateWT();
        const accRes = await fetch('https://api.gofile.io/accounts', {
          method: 'POST',
          headers: {
            'User-Agent': this.USER_AGENT,
            'X-BL': this.LANG,
            'X-Website-Token': wtNoToken,
            'Origin': 'https://gofile.io',
            'Referer': 'https://gofile.io/'
          }
        });

        if (accRes.ok) {
          const accData = await accRes.json();
          if (accData.status === 'ok' && accData.data && accData.data.token) {
            this.sessionCache.token = accData.data.token;
          }
        }
      }

      // Generate WT with the guest token (or without if minting failed)
      const token = this.sessionCache.token || '';
      const wt = await sandbox.generateWT(token);

      return {
        token,
        wt,
        ua: this.USER_AGENT,
        lang: this.LANG
      };
    } catch (err) {
      console.warn('[Gofile] Session generation error:', err.message);
      return null;
    }
  }

  extractContentId(url) {
    if (!url) return null;
    const match = url.match(/^https?:\/\/(?:www\.)?gofile\.(?:io|me)\/(?:d\/)?([a-zA-Z0-9_-]+)/i);
    return match ? match[1] : null;
  }

  async resolve(url) {
    const contentId = this.extractContentId(url);
    if (!contentId) return null;

    const session = await this.getGuestSession();
    if (!session) {
      return {
        directUrl: url,
        filename: `gofile_${contentId}`,
        size: 0,
        hoster: 'Gofile',
        status: 'online'
      };
    }

    try {
      const headers = {
        'User-Agent': session.ua,
        'X-BL': session.lang,
        'X-Website-Token': session.wt,
        'Origin': 'https://gofile.io',
        'Referer': 'https://gofile.io/'
      };
      if (session.token) {
        headers['Authorization'] = `Bearer ${session.token}`;
        headers['Cookie'] = `accountToken=${session.token}`;
      }

      const res = await fetch(`https://api.gofile.io/contents/${encodeURIComponent(contentId)}?page=1&pageSize=100&sortField=name&sortDirection=1`, {
        headers
      });

      if (!res.ok) {
        // If 401 or token expired, reset token cache once and retry
        if (res.status === 401 && this.sessionCache.token) {
          this.sessionCache.token = null;
          this.sessionCache.sandbox = null;
        }
        return {
          directUrl: url,
          filename: `gofile_${contentId}`,
          size: 0,
          hoster: 'Gofile',
          status: 'online'
        };
      }

      const json = await res.json();
      if (json.status !== 'ok' || !json.data) {
        if (json.status === 'error-passwordRequired') {
          return {
            directUrl: url,
            filename: `gofile_${contentId}`,
            size: 0,
            hoster: 'Gofile',
            status: 'warning',
            notice: 'Password protected Gofile link'
          };
        }
        return {
          directUrl: url,
          filename: `gofile_${contentId}`,
          size: 0,
          hoster: 'Gofile',
          status: 'online'
        };
      }

      const data = json.data;

      // Case 1: Single file
      if (data.type === 'file' && data.link) {
        return {
          directUrl: data.link,
          filename: data.name || `gofile_${contentId}`,
          size: data.size || 0,
          hoster: 'Gofile',
          status: 'online',
          downloadHeaders: {
            'Cookie': `accountToken=${session.token}`,
            'User-Agent': session.ua
          }
        };
      }

      // Case 2: Folder with children
      if (data.type === 'folder' && data.children) {
        const children = Object.values(data.children);
        const files = children.filter(c => c.type === 'file' && c.link).map(child => ({
          originalUrl: url,
          directUrl: child.link,
          filename: child.name || child.id,
          size: child.size || 0,
          hoster: 'Gofile',
          packageName: data.name || `Gofile_${contentId}`,
          status: 'online',
          downloadHeaders: {
            'Cookie': `accountToken=${session.token}`,
            'User-Agent': session.ua
          }
        }));

        if (files.length === 1) {
          return files[0];
        }

        if (files.length > 1) {
          return {
            directUrl: files[0].directUrl,
            filename: files[0].filename,
            size: files[0].size,
            hoster: 'Gofile',
            packageName: data.name || `Gofile_${contentId}`,
            status: 'online',
            items: files
          };
        }
      }

      // Fallback for empty folder or metadata
      return {
        directUrl: url,
        filename: data.name || `gofile_${contentId}`,
        size: data.size || 0,
        hoster: 'Gofile',
        status: 'online'
      };
    } catch (err) {
      console.warn('[Gofile] Resolution failed:', err.message);
      return {
        directUrl: url,
        filename: `gofile_${contentId}`,
        size: 0,
        hoster: 'Gofile',
        status: 'online'
      };
    }
  }
}

const gofileResolver = new GofileResolver();

module.exports = {
  name: 'Gofile',
  id: 'gofile',
  pattern: /^https?:\/\/(?:www\.)?gofile\.(?:io|me)\/(?:d\/)?([a-zA-Z0-9_-]+)/i,
  resolve: (url) => gofileResolver.resolve(url)
};
