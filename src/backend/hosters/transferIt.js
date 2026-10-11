const crypto = require('crypto');
const path = require('path');
const { safeRequest, safeProbe } = require('../httpHelper');

// Helper to decode Base64url to Buffer
function base64urlToBuffer(str) {
  if (!str) return Buffer.alloc(0);
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4 !== 0) base64 += '=';
  return Buffer.from(base64, 'base64');
}

// Decrypt MEGA 128-bit AES attributes
function decryptMegaAttributes(atStr, keyBuf) {
  try {
    if (!atStr || !keyBuf || keyBuf.length < 16) return null;
    const atBuf = base64urlToBuffer(atStr);
    const iv = Buffer.alloc(16, 0); // Mega uses 16-byte zero IV for attribute block
    const decipher = crypto.createDecipheriv('aes-128-cbc', keyBuf.slice(0, 16), iv);
    decipher.setAutoPadding(false);
    const decrypted = Buffer.concat([decipher.update(atBuf), decipher.final()]);
    const str = decrypted.toString('utf8');
    if (str.startsWith('MEGA{')) {
      const jsonStr = str.substring(4, str.lastIndexOf('}') + 1);
      return JSON.parse(jsonStr);
    }
  } catch (_) {}
  return null;
}

class TransferItResolver {
  extractParams(url) {
    if (!url) return {};
    try {
      const u = new URL(url);
      const match = u.pathname.match(/^\/(?:t\/)?([a-zA-Z0-9_-]+)/i);
      const fileId = match ? match[1] : null;
      let key = u.hash ? u.hash.replace(/^#/, '') : null;
      return { fileId, key };
    } catch (_) {
      return {};
    }
  }

  async resolve(url) {
    const { fileId, key } = this.extractParams(url);
    let filename = fileId ? `transfer_${fileId}` : 'transfer_file';
    let size = 0;
    let directUrl = url;
    let status = 'online';

    // 1. Try querying Mega API for metadata
    if (fileId) {
      try {
        const seq = Math.floor(Math.random() * 1000000000);
        const megaRes = await fetch(`https://g.api.mega.co.nz/cs?id=${seq}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify([{ a: 'g', g: 1, p: fileId }])
        }).catch(() => null);

        if (megaRes && megaRes.ok) {
          const megaData = await megaRes.json().catch(() => null);
          if (Array.isArray(megaData) && megaData[0] && typeof megaData[0] === 'object') {
            const fileInfo = megaData[0];
            if (fileInfo.s) size = parseInt(fileInfo.s, 10);
            if (fileInfo.g) directUrl = fileInfo.g;

            if (fileInfo.at && key) {
              const keyBuf = base64urlToBuffer(key);
              const attrs = decryptMegaAttributes(fileInfo.at, keyBuf);
              if (attrs && attrs.n) {
                filename = attrs.n;
              }
            }
          }
        }
      } catch (err) {
        console.warn('[Transfer.it] Mega API probe error:', err.message);
      }
    }

    // 2. Perform safe verification probe with insecureHTTPParser
    try {
      const probeRes = await safeProbe(url, { timeout: 8000 });
      if (probeRes && probeRes.status >= 200 && probeRes.status < 400) {
        status = 'online';
      }
    } catch (_) {}

    return {
      directUrl: directUrl || url,
      filename,
      size,
      hoster: 'Transfer.it',
      status
    };
  }
}

const transferItResolver = new TransferItResolver();

module.exports = {
  name: 'Transfer.it',
  id: 'transfer_it',
  pattern: /^https?:\/\/(?:www\.)?transfer\.it\/(?:t\/)?([a-zA-Z0-9_-]+)/i,
  resolve: (url) => transferItResolver.resolve(url)
};
