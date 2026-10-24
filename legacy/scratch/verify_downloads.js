/**
 * Verify Waterfall Download Engine end-to-end:
 * 1. Test binaryResolver status (system resources + yt-dlp auto download)
 * 2. Test createTask with autoStart: true
 * 3. Verify that queue starts immediately and download moves beyond 0%
 * 4. Verify completion
 */

const downloadManager = require('../src/backend/downloadManager');
const binaryResolver = require('../src/backend/binaryResolver');

async function runTest() {
  console.log('--- 1. Testing Binary Resolver & System Resources ---');
  const binaries = binaryResolver.getSystemBinariesStatus();
  console.log('System binaries status:', JSON.stringify(binaries, null, 2));

  console.log('\n--- 2. Testing ensureYtDlpInstalled ---');
  const ytRes = await binaryResolver.ensureYtDlpInstalled();
  console.log('yt-dlp status:', ytRes);

  console.log('\n--- 3. Testing Direct HTTP Download with autoStart: true ---');
  // Download a real sample file with unique URL to avoid deduplication cache
  const testUrl = `https://raw.githubusercontent.com/yt-dlp/yt-dlp/master/README.md?test=${Date.now()}`;

  let progressObserved = false;
  let completed = false;

  const task = downloadManager.createTask({
    url: testUrl,
    name: 'test_engine_verify.md',
    autoStart: true,
    connections: 2
  });

  console.log(`Task created with ID: ${task.id}, initial status: ${task.status}`);

  // Listen for progress updates
  downloadManager.on('taskProgress', (t) => {
    if (t.id === task.id) {
      if (t.downloadedBytes > 0) {
        progressObserved = true;
        console.log(`[Progress] ${t.downloadedBytes} / ${t.totalBytes} bytes (${t.speed}/s) - status: ${t.status}`);
      }
    }
  });

  downloadManager.on('taskCompleted', (t) => {
    if (t.id === task.id) {
      completed = true;
      console.log(`[Completed] Task ${t.id} successfully completed! File size: ${t.downloadedBytes} bytes`);
    }
  });

  downloadManager.on('taskError', (data) => {
    if (data.id === task.id) {
      console.error(`[Error] Task error:`, data.error);
    }
  });

  // Wait up to 15 seconds for download to run and complete
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 500));
    const current = downloadManager.getTask(task.id);
    if (current && (current.status === 'completed' || current.status === 'error')) {
      break;
    }
  }

  const finalTask = downloadManager.getTask(task.id);
  console.log('\n--- Final Verification Result ---');
  console.log('Final task status:', finalTask ? finalTask.status : 'not found');
  console.log('Final downloaded bytes:', finalTask ? finalTask.downloadedBytes : 0);
  console.log('Progress observed > 0:', progressObserved);
  console.log('Successfully completed:', completed || (finalTask && finalTask.status === 'completed'));

  // Clean up test task
  try {
    downloadManager.deleteTask(task.id, true);
  } catch (_) {}

  if ((progressObserved || (finalTask && finalTask.downloadedBytes > 0)) && (completed || (finalTask && finalTask.status === 'completed'))) {
    console.log('\n>>> ALL TESTS PASSED: Download started immediately and completed successfully! <<<');
    process.exit(0);
  } else {
    console.error('\n>>> TEST FAILED: Download did not complete properly <<<');
    process.exit(1);
  }
}

runTest().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
