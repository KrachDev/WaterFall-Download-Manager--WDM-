const http = require('http');
const { spawn } = require('child_process');
const assert = require('assert');
const path = require('path');

const serverProc = spawn('node', ['server.js'], {
  cwd: path.resolve(__dirname, '..'),
  stdio: ['ignore', 'pipe', 'pipe']
});

function request(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost',
      port: 4567,
      path,
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {}
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function run() {
  console.log('Waiting for server on port 4567...');
  for (let i = 0; i < 25; i++) {
    await new Promise(r => setTimeout(r, 400));
    try {
      const ping = await request('GET', '/api/settings');
      if (ping.status === 200) break;
    } catch (_) {}
  }

  console.log('Testing GET /api/settings...');
  const res = await request('GET', '/api/settings');
  assert.strictEqual(res.status, 200);
  console.log('Settings:', {
    startWithWindows: res.body.startWithWindows,
    startWithWindow: res.body.startWithWindow,
    showDownloadProgressDialog: res.body.showDownloadProgressDialog,
    showDownloadCompleteDialog: res.body.showDownloadCompleteDialog,
    forceTopOnDownload: res.body.forceTopOnDownload
  });

  assert.strictEqual(res.body.startWithWindows, true, 'startWithWindows should default to true');
  assert.strictEqual(res.body.startWithWindow, false, 'startWithWindow should default to false (silent startup)');
  assert.strictEqual(res.body.showDownloadProgressDialog, true, 'showDownloadProgressDialog should default to true');
  assert.strictEqual(res.body.showDownloadCompleteDialog, true, 'showDownloadCompleteDialog should default to true');
  assert.strictEqual(res.body.forceTopOnDownload, false, 'forceTopOnDownload should default to false');
  console.log('>>> Verified API returns correct defaults for silent startup and IDM dialogs!');

  // Also check that download-progress.html is served via HTTP
  const htmlRes = await request('GET', '/download-progress.html');
  assert.strictEqual(htmlRes.status, 200);
  assert(htmlRes.raw.includes('progress-view'), 'download-progress.html must contain progress-view');
  assert(htmlRes.raw.includes('finish-view'), 'download-progress.html must contain finish-view');
  console.log('>>> Verified download-progress.html is successfully served via HTTP with both progress and finish views!');

  serverProc.kill();
  console.log('\n=== ALL API & ENDPOINT TESTS PASSED! ===');
  process.exit(0);
}

run().catch((err) => {
  console.error('Test error:', err);
  serverProc.kill();
  process.exit(1);
});
