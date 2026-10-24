const assert = require('assert');
const multipartMatcher = require('./src/backend/multipartMatcher');
const extractionQueue = require('./src/backend/extractionQueue');
const queueManager = require('./src/backend/queueManager');
const archiveUnpacker = require('./src/backend/archiveUnpacker');
const { getConfig, saveConfig } = require('./src/backend/config');

async function runTests() {
  console.log('============================================================');
  console.log('       WATERFALL 1.0 COMPREHENSIVE INTEGRATION TEST         ');
  console.log('============================================================\n');

  // ------------------------------------------------------------------------
  // 1. Multipart Matcher Tests
  // ------------------------------------------------------------------------
  console.log('--- 1. Testing Multipart File Grouping & Parsing ---');
  const part1 = multipartMatcher.parseMultipartInfo('game_archive.part1.rar');
  const part2 = multipartMatcher.parseMultipartInfo('game_archive.part2.rar');
  const sevenZip1 = multipartMatcher.parseMultipartInfo('big_backup.7z.001');
  const sevenZip2 = multipartMatcher.parseMultipartInfo('big_backup.7z.002');
  const singleZip = multipartMatcher.parseMultipartInfo('normal_file.zip');

  assert(part1.isMultipart, 'part1 should be parsed as multipart');
  assert(part2.isMultipart, 'part2 should be parsed as multipart');
  assert.strictEqual(part1.groupKey, part2.groupKey, 'part1 and part2 must share the same groupKey');
  assert.strictEqual(part1.partNumber, 1);
  assert.strictEqual(part2.partNumber, 2);

  assert(sevenZip1.isMultipart, '7z.001 should be parsed as multipart');
  assert(sevenZip2.isMultipart, '7z.002 should be parsed as multipart');
  assert.strictEqual(sevenZip1.groupKey, sevenZip2.groupKey, '7z parts must share groupKey');
  assert.strictEqual(singleZip.isMultipart, false, 'Single zip should not be multipart');

  const rootPart = multipartMatcher.findRootArchivePart([
    'C:\\downloads\\game.part2.rar',
    'C:\\downloads\\game.part1.rar',
    'C:\\downloads\\game.part3.rar'
  ]);
  assert.strictEqual(rootPart, 'C:\\downloads\\game.part1.rar', 'Root archive part must be part 1');
  console.log('✓ Multipart parsing, grouping, and root archive detection passed!');

  // ------------------------------------------------------------------------
  // 2. Queue Manager & Priority Scheduling Tests
  // ------------------------------------------------------------------------
  console.log('\n--- 2. Testing Queue System & Priority Scheduling ---');
  const origConfig = { ...getConfig() };
  saveConfig({ maxConcurrentDownloads: 2, maxConcurrentPerHost: 1 });

  const sampleTasks = new Map([
    ['task-low', { id: 'task-low', url: 'https://rapidgator.net/f/1', priority: 'low', status: 'queued', queueOrder: 0 }],
    ['task-norm', { id: 'task-norm', url: 'https://rapidgator.net/f/2', priority: 'normal', status: 'queued', queueOrder: 1 }],
    ['task-high', { id: 'task-high', url: 'https://rapidgator.net/f/3', priority: 'high', status: 'queued', queueOrder: 2 }],
    ['task-other-host', { id: 'task-other-host', url: 'https://mediafire.com/f/4', priority: 'normal', status: 'queued', queueOrder: 3 }]
  ]);

  const activeDownloaders = new Map();
  const queueOrder = ['task-low', 'task-norm', 'task-high', 'task-other-host'];

  const scheduled = queueManager.scheduleNext(sampleTasks, activeDownloaders, queueOrder);

  // High priority task should be picked over low/normal on same host!
  assert.strictEqual(scheduled.length, 2, 'Should schedule 2 tasks up to maxConcurrentDownloads');
  assert.strictEqual(scheduled[0].id, 'task-high', 'High priority task must be scheduled first');
  assert.strictEqual(scheduled[1].id, 'task-other-host', 'Task on different host should be scheduled up to host limit');
  console.log('✓ Priority scheduling and per-host connection limiter passed!');

  saveConfig(origConfig); // Restore original config

  // ------------------------------------------------------------------------
  // 3. Extraction Worker Queue Tests
  // ------------------------------------------------------------------------
  console.log('\n--- 3. Testing Extraction Queue Concurrency & Worker ---');
  assert.strictEqual(extractionQueue.getMaxConcurrent(), 1, 'Default extraction concurrency must be 1');

  assert.strictEqual(extractionQueue.getActiveCount(), 0);
  assert.strictEqual(extractionQueue.getAllJobs().length, 0);
  console.log('✓ Extraction worker queue instantiated with concurrency 1!');

  // ------------------------------------------------------------------------
  // 4. Archive Unpacker Command & Password Detection
  // ------------------------------------------------------------------------
  console.log('\n--- 4. Testing Archive Password Regex & NanaZip Support ---');
  const errorOutputWrongPassword = 'ERROR: Data Error in encrypted file. Wrong password?';
  const isEncrypted = archiveUnpacker.isPasswordRequiredError(errorOutputWrongPassword);
  assert.strictEqual(isEncrypted, true, 'Regex should detect "Wrong password" as password required');

  const normalError = 'ERROR: Can not open file as archive';
  const isNormalEncrypted = archiveUnpacker.isPasswordRequiredError(normalError);
  assert.strictEqual(isNormalEncrypted, false, 'Non-password errors should not be flagged as password required');
  console.log('✓ Archive password error detection verified!');

  // ------------------------------------------------------------------------
  // 5. Strict User Concurrency Limiter (e.g. maxConcurrentDownloads = 1)
  // ------------------------------------------------------------------------
  console.log('\n--- 5. Testing Strict Single-Task Concurrency (maxConcurrentDownloads = 1) ---');
  saveConfig({ maxConcurrentDownloads: 1, maxConcurrentPerHost: 1 });
  const multiHostTasks = new Map([
    ['task-h1', { id: 'task-h1', url: 'https://host1.com/a', priority: 'normal', status: 'queued', queueOrder: 0 }],
    ['task-h2', { id: 'task-h2', url: 'https://host2.com/b', priority: 'normal', status: 'queued', queueOrder: 1 }],
    ['task-h3', { id: 'task-h3', url: 'https://host3.com/c', priority: 'normal', status: 'queued', queueOrder: 2 }]
  ]);
  const scheduledSingle = queueManager.scheduleNext(multiHostTasks, new Map(), ['task-h1', 'task-h2', 'task-h3']);
  assert.strictEqual(scheduledSingle.length, 1, 'Should schedule exactly 1 task when user sets maxConcurrentDownloads = 1');
  assert.strictEqual(scheduledSingle[0].id, 'task-h1');
  console.log('✓ Strict single-task concurrency correctly enforced!');

  saveConfig(origConfig); // Restore original config

  console.log('\n============================================================');
  console.log('       ALL 1.0 INTEGRATION TESTS PASSED CLEANLY!            ');
  console.log('============================================================');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
