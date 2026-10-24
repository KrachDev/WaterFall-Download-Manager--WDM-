const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');
const vm = require('vm');
const downloadManager = require('../src/backend/downloadManager');

async function testDoneDialogExtraction() {
  console.log('Testing Done Dialog & Duplicate Extraction Metadata...');

  // Create dummy archive and extracted folder
  const tmpDir = os.tmpdir();
  const dummyZipName = 'waterfall_done_test_archive.zip';
  const dummyZipPath = path.join(tmpDir, dummyZipName);
  const dummyExtractedDir = path.join(tmpDir, 'waterfall_done_test_archive');

  fs.writeFileSync(dummyZipPath, Buffer.from('PK\x03\x04dummycontent'));
  if (!fs.existsSync(dummyExtractedDir)) {
    fs.mkdirSync(dummyExtractedDir, { recursive: true });
  }

  const taskId = 'test-done-archive-task-1';
  downloadManager.tasks.set(taskId, {
    id: taskId,
    name: dummyZipName,
    url: 'https://example.com/test/' + dummyZipName,
    directUrl: 'https://example.com/test/' + dummyZipName,
    status: 'completed',
    downloadedBytes: 1024,
    totalBytes: 1024,
    savePath: dummyZipPath,
    extractedPath: dummyExtractedDir,
    extractStatus: 'extracted'
  });

  const probe = await downloadManager.probeUrl('https://example.com/test/' + dummyZipName);
  assert(probe.existingMatch, 'existingMatch should be present');
  assert.strictEqual(probe.existingMatch.isDone, true, 'isDone should be true');
  assert.strictEqual(probe.existingMatch.extractedPath, dummyExtractedDir, 'extractedPath must match dummyExtractedDir');
  assert.strictEqual(probe.existingMatch.extractStatus, 'extracted', 'extractStatus should be extracted');
  assert.strictEqual(probe.existingMatch.isArchive, true, 'isArchive should be true');
  console.log('✓ probeUrl successfully attaches extractedPath and extractStatus to existingMatch!');

  // Cleanup test files
  try {
    fs.unlinkSync(dummyZipPath);
    fs.rmdirSync(dummyExtractedDir);
  } catch (_) {}

  // -------------------------------------------------------------
  // Test download-progress.js DOM behavior with mock environment
  // -------------------------------------------------------------
  console.log('\nTesting download-progress.js extraction lifecycle in Done View...');

  function createMockElement(id) {
    const listeners = {};
    return {
      id,
      style: { display: 'none', width: '0%', background: '' },
      textContent: '',
      innerHTML: '',
      title: '',
      className: '',
      onclick: null,
      querySelectorAll: () => [],
      addEventListener: (evt, fn) => { listeners[evt] = fn; },
      removeEventListener: () => {},
      click: async function() {
        if (typeof listeners['click'] === 'function') await listeners['click']();
        else if (typeof this.onclick === 'function') await this.onclick();
      }
    };
  }

  const elements = {
    'btn-extract-toggle-pwd': createMockElement('btn-extract-toggle-pwd'),
    'opt-delete-archive': createMockElement('opt-delete-archive'),
    'opt-extract-dir-label': createMockElement('opt-extract-dir-label'),
    'finish-view': createMockElement('finish-view'),
    'finish-file-name': createMockElement('finish-file-name'),
    'finish-file-size': createMockElement('finish-file-size'),
    'finish-avg-speed': createMockElement('finish-avg-speed'),
    'finish-save-path': createMockElement('finish-save-path'),
    'finish-extract-section': createMockElement('finish-extract-section'),
    'finish-extract-title': createMockElement('finish-extract-title'),
    'finish-extract-pct': createMockElement('finish-extract-pct'),
    'finish-extract-fill': createMockElement('finish-extract-fill'),
    'finish-extract-dest': createMockElement('finish-extract-dest'),
    'finish-password-box': createMockElement('finish-password-box'),
    'finish-password-label': createMockElement('finish-password-label'),
    'finish-password-input': createMockElement('finish-password-input'),
    'finish-password-remember': createMockElement('finish-password-remember'),
    'btn-finish-pwd-toggle': createMockElement('btn-finish-pwd-toggle'),
    'btn-finish-password-submit': createMockElement('btn-finish-password-submit'),
    'finish-extract-retry-box': createMockElement('finish-extract-retry-box'),
    'btn-finish-extract-retry': createMockElement('btn-finish-extract-retry'),
    'btn-finish-open': createMockElement('btn-finish-open'),
    'btn-finish-folder': createMockElement('btn-finish-folder'),
    'btn-finish-extracted-folder': createMockElement('btn-finish-extracted-folder'),
    'btn-finish-close': createMockElement('btn-finish-close'),
    'dlg-footer-controls': createMockElement('dlg-footer-controls'),
    'btn-pause-resume': createMockElement('btn-pause-resume'),
    'btn-cancel': createMockElement('btn-cancel'),
    'btn-save-options': createMockElement('btn-save-options'),
    'save-status-msg': createMockElement('save-status-msg'),
    'btn-hide-bg': createMockElement('btn-hide-bg'),
    'file-icon': createMockElement('file-icon'),
    'dlg-file-name': createMockElement('dlg-file-name'),
    'dlg-file-url': createMockElement('dlg-file-url'),
    'btn-copy-url': createMockElement('btn-copy-url'),
    'tab-limiter-badge': createMockElement('tab-limiter-badge'),
    'dlg-status': createMockElement('dlg-status'),
    'status-dot': createMockElement('status-dot'),
    'dlg-percent': createMockElement('dlg-percent'),
    'dlg-bar-fill': createMockElement('dlg-bar-fill'),
    'dlg-segments-bar': createMockElement('dlg-segments-bar'),
    'btn-stream-now': createMockElement('btn-stream-now'),
    'dlg-size': createMockElement('dlg-size'),
    'dlg-speed': createMockElement('dlg-speed'),
    'dlg-downloaded': createMockElement('dlg-downloaded'),
    'dlg-eta': createMockElement('dlg-eta'),
    'dlg-resumable': createMockElement('dlg-resumable'),
    'dlg-threads': createMockElement('dlg-threads'),
    'limiter-enable': createMockElement('limiter-enable'),
    'limiter-slider': createMockElement('limiter-slider'),
    'limiter-input-val': createMockElement('limiter-input-val'),
    'limiter-unit-val': createMockElement('limiter-unit-val'),
    'limiter-status-label': createMockElement('limiter-status-label'),
    'btn-apply-limiter': createMockElement('btn-apply-limiter'),
    'opt-enable-extract': createMockElement('opt-enable-extract'),
    'opt-extract-password': createMockElement('opt-extract-password')
  };

  let openedFolders = [];
  let callbacks = {};
  let fetchCalls = [];

  const mockWindow = {
    location: {
      search: '?taskId=task-done-extract-test',
      protocol: 'http:',
      hostname: 'localhost',
      port: '4567'
    },
    document: {
      title: '',
      activeElement: null,
      getElementById: (id) => elements[id] || null,
      querySelectorAll: (sel) => []
    },
    waterfallDesktop: {
      onProgressData: (cb) => { callbacks.onProgressData = cb; },
      onProgressTick: (cb) => { callbacks.onProgressTick = cb; },
      onTaskCompleted: (cb) => { callbacks.onTaskCompleted = cb; },
      openFolder: async (p) => { openedFolders.push(p); },
      openFile: async () => {},
      getProgressData: async () => null
    },
    fetch: async (url, opts) => {
      fetchCalls.push({ url, opts });
      return { json: async () => ({ success: true }) };
    },
    WebSocket: function() {
      return { onmessage: () => {}, onclose: () => {} };
    },
    setTimeout: (fn) => setTimeout(fn, 0),
    clearTimeout: (t) => clearTimeout(t)
  };

  const progressCode = fs.readFileSync(path.join(__dirname, '../src/frontend/js/download-progress.js'), 'utf8');
  vm.runInNewContext(progressCode, {
    window: mockWindow,
    document: mockWindow.document,
    URLSearchParams: class {
      get() { return 'task-done-extract-test'; }
    },
    WebSocket: mockWindow.WebSocket,
    fetch: mockWindow.fetch,
    setTimeout: mockWindow.setTimeout,
    clearTimeout: mockWindow.clearTimeout,
    console
  });

  // 1. Initial State: download completed for archive, extraction queued
  const archiveTask = {
    id: 'task-done-extract-test',
    name: 'test_pack.zip',
    status: 'completed',
    savePath: 'C:\\Downloads\\test_pack.zip',
    isArchive: true,
    extractStatus: 'extract_queued',
    extractProgress: 0,
    downloadedBytes: 5000000,
    totalBytes: 5000000
  };

  callbacks.onTaskCompleted(archiveTask);

  const extractSection = elements['finish-extract-section'];
  const extractedFolderBtn = elements['btn-finish-extracted-folder'];
  const extractTitle = elements['finish-extract-title'];
  const extractPct = elements['finish-extract-pct'];
  const extractFill = elements['finish-extract-fill'];
  const passwordBox = elements['finish-password-box'];
  const passwordLabel = elements['finish-password-label'];
  const passwordInput = elements['finish-password-input'];
  const passwordRemember = elements['finish-password-remember'];
  const passwordSubmitBtn = elements['btn-finish-password-submit'];

  assert.strictEqual(extractSection.style.display, 'flex', 'Extraction section should be visible in Done view');
  assert.strictEqual(extractedFolderBtn.style.display, 'none', 'Open Extracted Folder button MUST BE HIDDEN while extraction is queued');
  assert.strictEqual(passwordBox.style.display, 'none', 'Password box should be hidden when queued');
  assert(extractTitle.textContent.includes('Extraction Queued') || extractTitle.innerHTML.includes('Extraction Queued'), 'Title should show queued');
  console.log('✓ On completion with queued extraction: Progress bar is shown and Open Extracted Folder button is HIDDEN');

  // 2. Extraction in progress: 45%
  callbacks.onProgressTick({
    id: 'task-done-extract-test',
    status: 'completed',
    extractStatus: 'extracting',
    extractProgress: 45,
    savePath: 'C:\\Downloads\\test_pack.zip'
  });

  assert.strictEqual(extractSection.style.display, 'flex', 'Extraction section must remain visible while extracting');
  assert.strictEqual(extractedFolderBtn.style.display, 'none', 'Open Extracted Folder button MUST STILL BE HIDDEN during extraction');
  assert.strictEqual(passwordBox.style.display, 'none', 'Password box must be hidden during extraction');
  assert.strictEqual(extractPct.textContent, '45%', 'Progress percentage text should be 45%');
  assert.strictEqual(extractFill.style.width, '45%', 'Progress bar fill width should be 45%');
  console.log('✓ During active extraction: Progress bar updates smoothly (45%) and button remains HIDDEN');

  // 3. Password Required Event
  callbacks.onProgressTick({
    id: 'task-done-extract-test',
    status: 'completed',
    extractStatus: 'extract_password_required',
    extractPasswordRequired: true,
    savePath: 'C:\\Downloads\\test_pack.zip'
  });

  assert.strictEqual(extractSection.style.display, 'flex', 'Extraction section remains visible on password required');
  assert.strictEqual(passwordBox.style.display, 'flex', 'Password input box MUST BE VISIBLE when password is required');
  assert(passwordLabel.textContent.includes('Password Required'), 'Password label should prompt for password');
  assert.strictEqual(extractedFolderBtn.style.display, 'none', 'Open Extracted Folder button must be hidden when password is required');
  console.log('✓ When archive is password-protected: Password prompt box is shown with error notice');

  // 4. Submit Password & Retry
  passwordInput.value = 'SecretArchive123';
  passwordRemember.checked = true;
  assert(typeof passwordSubmitBtn.onclick === 'function', 'Password submit button must have click handler');
  await passwordSubmitBtn.onclick();

  const setPwdCall = fetchCalls.find(c => c.url.includes('/set-password'));
  const extractCall = fetchCalls.find(c => c.url.includes('/extract'));
  assert(setPwdCall, 'Submit password must call /set-password endpoint');
  assert(extractCall, 'Submit password must trigger /extract endpoint');
  const setPwdPayload = JSON.parse(setPwdCall.opts.body);
  assert.strictEqual(setPwdPayload.password, 'SecretArchive123');
  assert.strictEqual(setPwdPayload.remember, true);
  console.log('✓ Submitting password invokes backend /set-password & /extract with the user password!');

  // 5. Wrong Password Retry Feedback
  callbacks.onProgressTick({
    id: 'task-done-extract-test',
    status: 'completed',
    extractStatus: 'extract_password_required',
    extractPasswordRequired: true,
    extractError: 'Wrong password or data error in encrypted file',
    savePath: 'C:\\Downloads\\test_pack.zip'
  });

  assert.strictEqual(passwordBox.style.display, 'flex', 'Password box remains visible on retry failure');
  assert(passwordLabel.textContent.includes('Incorrect password'), 'Password label must show incorrect password warning');
  console.log('✓ On wrong password: Shows inline "Incorrect password!" feedback allowing easy retry');

  // 6. Extraction completes after correct password: 100%
  callbacks.onProgressTick({
    id: 'task-done-extract-test',
    status: 'completed',
    extractStatus: 'extracted',
    extractProgress: 100,
    extractedPath: 'C:\\Downloads\\test_pack',
    savePath: 'C:\\Downloads\\test_pack.zip'
  });

  assert.strictEqual(extractSection.style.display, 'flex', 'Extraction section visible on completion');
  assert.strictEqual(passwordBox.style.display, 'none', 'Password box must be hidden after successful extraction');
  assert.strictEqual(extractPct.textContent, '100%', 'Progress percentage text should be 100%');
  assert.strictEqual(extractFill.style.width, '100%', 'Progress bar fill width should be 100%');
  assert(extractTitle.textContent.includes('Successfully') || extractTitle.innerHTML.includes('Successfully'), 'Title must indicate success');
  assert.strictEqual(extractedFolderBtn.style.display, 'inline-flex', 'Open Extracted Folder button MUST BE DISPLAYED after extraction is finished!');
  console.log('✓ Once extraction finishes: Progress bar displays 100% and Open Extracted Folder button is DISPLAYED');

  // 7. Clicking Open Extracted Folder button opens the extracted directory
  assert(typeof extractedFolderBtn.onclick === 'function', 'Button click handler must be registered');
  await extractedFolderBtn.onclick();
  assert(openedFolders.includes('C:\\Downloads\\test_pack'), 'Clicking Open Extracted Folder must call openFolder on extracted path');
  console.log('✓ Clicking Open Extracted Folder opens the extracted path in file explorer!');

  // 8. Non-archive file completion
  const nonArchiveTask = {
    id: 'task-done-extract-test',
    name: 'movie.mp4',
    status: 'completed',
    savePath: 'C:\\Downloads\\movie.mp4',
    isArchive: false,
    extractStatus: 'none',
    downloadedBytes: 10000000,
    totalBytes: 10000000
  };

  callbacks.onTaskCompleted(nonArchiveTask);
  assert.strictEqual(extractSection.style.display, 'none', 'Extraction section must be hidden for non-archive files');
  assert.strictEqual(extractedFolderBtn.style.display, 'none', 'Extracted Folder button must be hidden for non-archive files');
  console.log('✓ Non-archive files: Extraction section and button remain hidden');

  console.log('\nALL DONE DIALOG EXTRACTION TESTS PASSED SUCCESSFULLY! ✓');
  process.exit(0);
}

testDoneDialogExtraction().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
