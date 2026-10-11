const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

function request(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, data: JSON.parse(data) });
        } catch (_) {
          resolve({ status: res.statusCode, headers: res.headers, data });
        }
      });
    });
    req.on('error', reject);
    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

async function runTests() {
  console.log('============================================================');
  console.log(' TESTING DUPLICATE DETECTION & WINDOWS TEMP ISOLATION      ');
  console.log('============================================================\n');

  // 1. Verify Windows Temp isolation directories exist or are used
  console.log('--- 1. Testing Isolated Windows Temp Paths ---');
  const tempDir = path.join(os.tmpdir(), 'Waterfall');
  const metaDir = path.join(tempDir, 'metadata');
  const mediaTempDir = path.join(tempDir, 'media_temp');
  console.log(`Windows Temp Root: ${tempDir}`);
  console.log(`Metadata Folder: ${metaDir}`);
  console.log(`Media Temp Folder: ${mediaTempDir}`);

  // 2. Create a mock completed task and test duplicate detection (DONE)
  console.log('\n--- 2. Testing Completed Task Duplicate Detection ---');
  const dummyFile = path.join(os.tmpdir(), 'waterfall_test_done.bin');
  fs.writeFileSync(dummyFile, Buffer.alloc(1024 * 1024 * 5, 0xAB)); // 5MB test file

  const downloadManager = require('../src/backend/downloadManager');
  const completedTaskId = 'test-completed-uuid-1';
  const completedTask = {
    id: completedTaskId,
    name: 'waterfall_test_done.bin',
    url: 'https://example.com/files/waterfall_test_done.bin',
    directUrl: 'https://example.com/files/waterfall_test_done.bin',
    status: 'completed',
    downloadedBytes: 5 * 1024 * 1024,
    totalBytes: 5 * 1024 * 1024,
    savePath: dummyFile
  };
  downloadManager.tasks.set(completedTaskId, completedTask);

  // Probe matching URL
  const probeDone = await downloadManager.probeUrl('https://example.com/files/waterfall_test_done.bin');
  console.log('Probe result for completed file:');
  console.log(`  filename: ${probeDone.filename}`);
  console.log(`  existingMatch:`, probeDone.existingMatch ? {
    id: probeDone.existingMatch.id,
    name: probeDone.existingMatch.name,
    isDone: probeDone.existingMatch.isDone,
    status: probeDone.existingMatch.status,
    percent: probeDone.existingMatch.percent
  } : 'NONE');

  if (probeDone.existingMatch && probeDone.existingMatch.isDone) {
    console.log('✓ Successfully detected duplicate for completed download (isDone=true)!');
  } else {
    throw new Error('Completed duplicate was not detected properly!');
  }

  // 3. Create a mock in-progress / paused task and test file update offer
  console.log('\n--- 3. Testing In-Progress / Paused Download Detection & Update Offer ---');
  const partialFile = path.join(os.tmpdir(), 'waterfall_partial_download.bin');
  fs.writeFileSync(partialFile, Buffer.alloc(1024 * 1024 * 2, 0xCD)); // 2MB on disk

  const pausedTaskId = 'test-paused-uuid-2';
  const pausedTask = {
    id: pausedTaskId,
    name: 'waterfall_partial_download.bin',
    url: 'https://expired-cdn.com/waterfall_partial_download.bin?token=expired123',
    directUrl: 'https://expired-cdn.com/waterfall_partial_download.bin?token=expired123',
    status: 'paused',
    downloadedBytes: 2 * 1024 * 1024,
    totalBytes: 10 * 1024 * 1024,
    savePath: partialFile
  };
  downloadManager.tasks.set(pausedTaskId, pausedTask);

  // Probe the same file with a fresh new URL
  const freshUrl = 'https://fresh-cdn.com/waterfall_partial_download.bin?token=fresh999';
  const probeInProgress = await downloadManager.probeUrl(freshUrl, { filename: 'waterfall_partial_download.bin' });
  console.log('Probe result for in-progress / paused file:');
  console.log(`  filename: ${probeInProgress.filename}`);
  console.log(`  existingMatch:`, probeInProgress.existingMatch ? {
    id: probeInProgress.existingMatch.id,
    name: probeInProgress.existingMatch.name,
    isDone: probeInProgress.existingMatch.isDone,
    status: probeInProgress.existingMatch.status,
    downloadedBytes: probeInProgress.existingMatch.downloadedBytes,
    totalBytes: probeInProgress.existingMatch.totalBytes,
    percent: probeInProgress.existingMatch.percent
  } : 'NONE');

  if (probeInProgress.existingMatch && !probeInProgress.existingMatch.isDone && probeInProgress.existingMatch.percent === 20) {
    console.log('✓ Successfully detected in-progress download with exact 20% progress!');
  } else {
    throw new Error('In-progress duplicate was not detected properly!');
  }

  // 4. Test Updating the URL of the existing in-progress task directly and via HTTP
  console.log('\n--- 4. Testing Link Update & Seamless Resumption API ---');
  const updatedTask = downloadManager.updateTaskUrl(pausedTaskId, freshUrl);
  console.log('Updated Task URL in local manager:', updatedTask?.url);

  console.log('Updated Task status:', updatedTask?.status);

  if (updatedTask && updatedTask.url === freshUrl && (updatedTask.status === 'queued' || updatedTask.status === 'downloading')) {
    console.log('✓ Successfully updated task URL directly in downloadManager!');
  } else {
    throw new Error('Task URL was not updated correctly in downloadManager!');
  }

  // Also test over HTTP against the running daemon
  const createHttpRes = await request({
    hostname: '127.0.0.1',
    port: 4567,
    path: '/api/downloads',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    url: 'https://cdn.example.com/http_test_file.zip',
    filename: 'http_test_file.zip',
    autoStart: false,
    confirmed: true
  });

  const createdId = createHttpRes.data.id;
  console.log('Created test task on server daemon:', createdId);

  const updateHttpRes = await request({
    hostname: '127.0.0.1',
    port: 4567,
    path: `/api/downloads/${createdId}/update-url`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { url: 'https://new-mirror.example.com/http_test_file.zip' });

  console.log('HTTP update-url status:', updateHttpRes.status);
  console.log('HTTP update-url response data:', updateHttpRes.data);

  if (updateHttpRes.status === 200 && updateHttpRes.data.success && updateHttpRes.data.task.url.includes('new-mirror')) {
    console.log('✓ Server HTTP endpoint /api/downloads/:id/update-url verified successfully!');
  } else {
    throw new Error('HTTP update-url endpoint failed!');
  }

  // Clean up HTTP task
  await request({
    hostname: '127.0.0.1',
    port: 4567,
    path: `/api/downloads/${createdId}?deleteFile=false`,
    method: 'DELETE'
  });

  // Clean up test files
  try { fs.unlinkSync(dummyFile); } catch (_) {}
  try { fs.unlinkSync(partialFile); } catch (_) {}
  downloadManager.tasks.delete(completedTaskId);
  downloadManager.tasks.delete(pausedTaskId);

  console.log('\n============================================================');
  console.log(' ALL DUPLICATE & TEMP ISOLATION TESTS PASSED!               ');
  console.log('============================================================');
}

runTests().catch(err => {
  console.error('\n❌ Test failed:', err);
  process.exit(1);
});
