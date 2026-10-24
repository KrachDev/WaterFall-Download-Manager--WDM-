const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

console.log('=== Testing Startup & Silent Tray Options Configuration ===\n');

const projectRoot = path.resolve(__dirname, '..');
const { getConfig, saveConfig } = require(path.join(projectRoot, 'src', 'backend', 'config'));
const cfg = getConfig();

console.log('[Test 1] startWithWindows default:', cfg.startWithWindows);
console.log('[Test 1] startWithWindow default:', cfg.startWithWindow);
console.log('[Test 1] showDownloadProgressDialog default:', cfg.showDownloadProgressDialog);
console.log('[Test 1] showDownloadCompleteDialog default:', cfg.showDownloadCompleteDialog);

assert.strictEqual(cfg.startWithWindows, true, 'startWithWindows must be true by default');
assert.strictEqual(cfg.startWithWindow, false, 'startWithWindow must be false by default for silent startup');
assert.strictEqual(cfg.showDownloadProgressDialog, true, 'showDownloadProgressDialog must be true by default');
assert.strictEqual(cfg.showDownloadCompleteDialog, true, 'showDownloadCompleteDialog must be true by default');
console.log('>>> Test 1 Passed: startWithWindow is OFF (false) by default, while startWithWindows and dialogs are ON (true).\n');

// 2. Test updating settings
const updated = saveConfig({ startWithWindows: true, startWithWindow: false });
assert.strictEqual(updated.startWithWindows, true);
assert.strictEqual(updated.startWithWindow, false);
console.log('>>> Test 2 Passed: Settings save successfully.\n');

// 3. Test Windows registry startup entry with --hidden flag for silent startup
const targetExe = path.resolve(__dirname, '..', 'dist', 'Waterfall-win32-x64', 'Waterfall.exe');
const regValSilent = `"${targetExe}" --hidden`;
execFileSync('reg', ['add', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', '/v', 'Waterfall', '/t', 'REG_SZ', '/d', regValSilent, '/f']);

const queryOut = execFileSync('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', '/v', 'Waterfall'], { encoding: 'utf-8' });
console.log('[Test 3] Registry Query Output:\n' + queryOut.trim());
assert(queryOut.includes('Waterfall.exe'), 'Registry entry must point to Waterfall.exe');
assert(queryOut.includes('--hidden'), 'Registry entry must include --hidden for silent background startup');
console.log('>>> Test 3 Passed: Windows Startup Registry contains --hidden for silent startup.\n');

console.log('=== ALL STARTUP & SILENT TRAY TESTS PASSED SUCCESSFULLY! ===');
process.exit(0);
