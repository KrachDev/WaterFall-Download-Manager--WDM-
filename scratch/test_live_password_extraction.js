const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');
const { spawnSync } = require('child_process');
const { get7zExecutable } = require('../src/backend/binaryResolver');
const downloadManager = require('../src/backend/downloadManager');
const extractionQueue = require('../src/backend/extractionQueue');

async function testLivePasswordExtraction() {
  console.log('Testing Live Password-Protected Archive Extraction with 7z...');

  const sevenZip = get7zExecutable();
  console.log('Using 7z binary:', sevenZip);

  const testDir = path.join(os.tmpdir(), 'waterfall_pwd_test_' + Date.now());
  fs.mkdirSync(testDir, { recursive: true });

  const dummyFile = path.join(testDir, 'secret_document.txt');
  fs.writeFileSync(dummyFile, 'Confidential Waterfall Data 1234567890');

  const archivePath = path.join(testDir, 'protected_archive.zip');
  const password = 'WaterfallPassword456';

  // Create password protected zip with 7z
  const zipResult = spawnSync(sevenZip, ['a', '-y', `-p${password}`, archivePath, dummyFile], { windowsHide: true });
  assert.strictEqual(zipResult.status, 0, '7z must create encrypted archive successfully');
  assert(fs.existsSync(archivePath), 'Encrypted archive must exist');

  // Remove original unencrypted dummy file so we can verify extraction creates it
  fs.unlinkSync(dummyFile);

  const taskId = 'test-pwd-task-' + Date.now();
  const task = downloadManager.createTask({
    id: taskId,
    url: 'https://example.com/protected_archive.zip',
    filename: 'protected_archive.zip',
    saveDir: testDir,
    autoExtract: true
  });
  task.savePath = archivePath;
  task.status = 'completed';
  downloadManager.tasks.set(taskId, task);

  // 1. Initial extraction without password -> should report password required
  console.log('1. Attempting extraction without password...');
  downloadManager.extractTask(taskId, '');

  // Wait for queue processing
  await new Promise(r => setTimeout(r, 1200));

  assert(task.extractStatus === 'extract_password_required' || task.extractPasswordRequired === true,
    `Expected password_required, got: ${task.extractStatus}`);
  console.log('✓ Archive correctly flagged as extract_password_required:', task.extractStatus);

  // 2. Submit wrong password -> should remain password required
  console.log('2. Submitting incorrect password...');
  downloadManager.submitExtractionPassword(taskId, 'WrongPasswordX');
  await new Promise(r => setTimeout(r, 1200));

  assert(task.extractStatus === 'extract_password_required' || task.extractPasswordRequired === true,
    `Expected password_required on wrong password, got: ${task.extractStatus}`);
  console.log('✓ Incorrect password correctly flagged as extract_password_required');

  // 3. Submit correct password -> should extract successfully
  console.log('3. Submitting correct password...');
  downloadManager.submitExtractionPassword(taskId, password, true);
  await new Promise(r => setTimeout(r, 1500));

  assert.strictEqual(task.extractStatus, 'extracted', `Expected extracted, got ${task.extractStatus}`);
  assert(task.extractedPath, 'task.extractedPath must be set');
  console.log('✓ Successfully extracted to:', task.extractedPath);

  // Check extracted file exists
  const extractedFile = path.join(task.extractedPath, 'secret_document.txt');
  assert(fs.existsSync(extractedFile), 'Extracted secret_document.txt must exist on disk');
  const content = fs.readFileSync(extractedFile, 'utf8');
  assert.strictEqual(content, 'Confidential Waterfall Data 1234567890');
  console.log('✓ Extracted content verified perfectly!');

  // Clean up test directory
  try {
    fs.rmSync(testDir, { recursive: true, force: true });
    if (task.extractedPath && fs.existsSync(task.extractedPath)) {
      fs.rmSync(task.extractedPath, { recursive: true, force: true });
    }
  } catch (_) {}
  downloadManager.deleteTask(taskId, false);

  console.log('\nLIVE PASSWORD ARCHIVE EXTRACTION TEST PASSED! ✓');
  process.exit(0);
}

testLivePasswordExtraction().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
