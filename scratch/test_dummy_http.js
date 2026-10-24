const assert = require('assert');
const http = require('http');
const express = require('express');
const { createDummyFileBuffer, parseSizeString } = require('../src/backend/dummyFileGenerator');

const app = express();
app.get('/api/dummy-generator', (req, res) => {
  const format = (req.query.format || 'bin').toLowerCase().replace('.', '');
  const size = parseSizeString(req.query.size || '10mb');
  const filename = req.query.filename || `dummy_${req.query.size || '10mb'}.${format}`;

  let mimeType = 'application/octet-stream';
  if (format === 'zip') mimeType = 'application/zip';

  const range = req.headers.range;
  const fullBuf = createDummyFileBuffer(format, size);

  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : (size - 1);
    const chunksize = (end - start) + 1;

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': mimeType,
      'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`
    });

    res.end(fullBuf.subarray(start, end + 1));
  } else {
    res.writeHead(200, {
      'Content-Length': size,
      'Content-Type': mimeType,
      'Accept-Ranges': 'bytes',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`
    });
    res.end(fullBuf);
  }
});

const server = app.listen(0, async () => {
  const port = server.address().port;

  // 1. Test full request
  const req1 = http.get(`http://127.0.0.1:${port}/api/dummy-generator?format=zip&size=1mb`, res => {
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.headers['content-length'], String(1024 * 1024));
    assert.strictEqual(res.headers['content-type'], 'application/zip');
    let chunks = [];
    res.on('data', c => chunks.push(c));
    res.on('end', () => {
      const full = Buffer.concat(chunks);
      assert.strictEqual(full.length, 1024 * 1024);
      console.log('✓ Full 200 response verified: 1 MB zip received');

      // 2. Test range request (first 500 bytes)
      const req2 = http.get({
        host: '127.0.0.1',
        port: port,
        path: '/api/dummy-generator?format=zip&size=1mb',
        headers: { 'Range': 'bytes=0-499' }
      }, res2 => {
        assert.strictEqual(res2.statusCode, 206);
        assert.strictEqual(res2.headers['content-range'], `bytes 0-499/${1024*1024}`);
        assert.strictEqual(res2.headers['content-length'], '500');
        let rChunks = [];
        res2.on('data', c => rChunks.push(c));
        res2.on('end', () => {
          const rBuf = Buffer.concat(rChunks);
          assert.strictEqual(rBuf.length, 500);
          console.log('✓ Range 206 response verified: bytes 0-499 received');
          server.close();
          console.log('>>> DUMMY GENERATOR HTTP ENDPOINT VERIFIED!');
        });
      });
    });
  });
});
