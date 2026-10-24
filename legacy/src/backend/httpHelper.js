const http = require('http');
const https = require('https');
const { URL } = require('url');

/**
 * Robust HTTP client that supports insecureHTTPParser: true.
 * Prevents Node undici HTTPParserError on servers that emit bare LF instead of CRLF in headers (e.g. transfer.it).
 */
function safeRequest(targetUrl, options = {}) {
  return new Promise((resolve, reject) => {
    let parsedUrl;
    try {
      parsedUrl = new URL(targetUrl);
    } catch (e) {
      return reject(e);
    }

    const client = parsedUrl.protocol === 'https:' ? https : http;
    const method = options.method || 'GET';
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': '*/*',
      ...(options.headers || {})
    };

    const req = client.request(parsedUrl, {
      method,
      headers,
      insecureHTTPParser: true,
      timeout: options.timeout || 10000,
      rejectUnauthorized: options.rejectUnauthorized !== false
    }, (res) => {
      // Handle redirects if followRedirects is enabled (default true, up to 5)
      const maxRedirects = options.maxRedirects !== undefined ? options.maxRedirects : 5;
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && maxRedirects > 0) {
        req.destroy();
        const nextUrl = new URL(res.headers.location, targetUrl).href;
        return safeRequest(nextUrl, { ...options, maxRedirects: maxRedirects - 1 })
          .then(resolve)
          .catch(reject);
      }

      const chunks = [];
      let totalLength = 0;
      const maxBodyLength = options.maxBodyLength || 5 * 1024 * 1024; // 5 MB max for probes/scrapes

      res.on('data', (chunk) => {
        if (options.stream) return;
        if (totalLength < maxBodyLength) {
          chunks.push(chunk);
          totalLength += chunk.length;
        }
      });

      res.on('end', () => {
        const bodyBuffer = Buffer.concat(chunks);
        resolve({
          status: res.statusCode,
          ok: res.statusCode >= 200 && res.statusCode < 400,
          headers: {
            ...res.headers,
            get: (key) => res.headers[key.toLowerCase()]
          },
          url: targetUrl,
          buffer: bodyBuffer,
          text: () => bodyBuffer.toString(options.encoding || 'utf8'),
          json: () => JSON.parse(bodyBuffer.toString('utf8'))
        });
      });

      res.on('error', (err) => {
        reject(err);
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Request timed out after ${options.timeout || 10000}ms`));
    });

    req.on('error', (err) => {
      reject(err);
    });

    if (options.body) {
      req.write(options.body);
    }

    req.end();
  });
}

/**
 * Lightweight safe HEAD/GET probe for LinkGrabber
 */
async function safeProbe(url, options = {}) {
  // First try GET with Range 0-0 or small timeout (safer than HEAD since many CDNs block/hang HEAD)
  try {
    const res = await safeRequest(url, {
      method: options.method || 'GET',
      headers: {
        'Range': 'bytes=0-0',
        ...(options.headers || {})
      },
      timeout: options.timeout || 8000,
      maxBodyLength: 1024 // Only read first 1KB if server ignores Range
    });
    return res;
  } catch (err) {
    return null;
  }
}

module.exports = {
  safeRequest,
  safeProbe
};
