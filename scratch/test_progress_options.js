const assert = require('assert');
const downloadManager = require('../src/backend/downloadManager');

async function testProgressOptions() {
  console.log('--- Testing Progress Window Options & Limiter in DownloadManager ---');

  const task = downloadManager.createTask({
    url: 'https://example.com/test-options-file.zip',
    filename: 'test-options-file.zip',
    size: 50 * 1024 * 1024,
    autoStart: false
  });

  assert(task && task.id, 'Task should be created');
  console.log('1. Created task:', task.id, task.name);

  // Test updating task options
  const updated = downloadManager.updateTaskOptions(task.id, {
    speedLimitEnabled: true,
    speedLimitBytesPerSec: 2 * 1024 * 1024, // 2 MB/s
    onCompleteAction: 'openFile',
    triggerAtPercent: 75,
    runScriptOnComplete: true,
    scriptType: 'powershell',
    scriptPath: 'C:\\scripts\\notify.ps1',
    scriptArgs: '"%FILE%" "%SIZE%"',
    autoExtract: true,
    extractPassword: 'secretPassword123',
    deleteArchiveAfterExtraction: true
  });

  assert(updated, 'Task should be updated');
  assert.strictEqual(updated.speedLimitEnabled, true, 'speedLimitEnabled should be true');
  assert.strictEqual(updated.speedLimitBytesPerSec, 2 * 1024 * 1024, 'speedLimitBytesPerSec should be 2 MB/s');
  assert.strictEqual(updated.onCompleteAction, 'openFile', 'onCompleteAction should be openFile');
  assert.strictEqual(updated.triggerAtPercent, 75, 'triggerAtPercent should be 75');
  assert(updated.customScript && updated.customScript.enabled, 'customScript should be enabled');
  assert.strictEqual(updated.customScript.path, 'C:\\scripts\\notify.ps1', 'scriptPath should match');
  assert.strictEqual(updated.customScript.args, '"%FILE%" "%SIZE%"', 'scriptArgs should match');
  assert.strictEqual(updated.autoExtract, true, 'autoExtract should be true');
  assert.strictEqual(updated.archivePassword, 'secretPassword123', 'archivePassword should match');
  assert.strictEqual(updated.deleteAfterExtract, true, 'deleteAfterExtract should be true');

  console.log('2. Successfully updated options via updateTaskOptions:');
  console.log('   - Speed Limit:', updated.speedLimitBytesPerSec / 1024 / 1024, 'MB/s (enabled:', updated.speedLimitEnabled + ')');
  console.log('   - On Complete:', updated.onCompleteAction);
  console.log('   - Trigger At:', updated.triggerAtPercent + '%');
  console.log('   - Custom Script:', updated.customScript.path, 'with args:', updated.customScript.args);
  console.log('   - Extraction:', updated.autoExtract, 'pwd:', updated.archivePassword, 'del:', updated.deleteAfterExtract);

  // Clean up
  downloadManager.deleteTask(task.id, false);
  console.log('3. Cleaned up test task');
  console.log('\n✓ ALL PROGRESS OPTIONS TESTS PASSED SUCCESSFULLY!');
  process.exit(0);
}

testProgressOptions().catch(err => {
  console.error('❌ Test error:', err);
  process.exit(1);
});
