const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('Testing Progress Window Normal by Default & Open When Finished Button...');

const electronMain = fs.readFileSync(path.join(__dirname, '../electron-main.js'), 'utf8');
const progressHtml = fs.readFileSync(path.join(__dirname, '../src/frontend/download-progress.html'), 'utf8');
const progressJs = fs.readFileSync(path.join(__dirname, '../src/frontend/js/download-progress.js'), 'utf8');
const confirmHtml = fs.readFileSync(path.join(__dirname, '../src/frontend/confirm.html'), 'utf8');
const confirmJs = fs.readFileSync(path.join(__dirname, '../src/frontend/js/confirm.js'), 'utf8');
const downloadManager = fs.readFileSync(path.join(__dirname, '../src/backend/downloadManager.js'), 'utf8');

// 1. Verify progress window is normal by default in electron-main.js
assert(!progressHtml.includes('btn-pin-dlg'), 'btn-pin-dlg must be removed from download-progress.html');
assert(!progressJs.includes('btnPinDlg'), 'btnPinDlg must be removed from download-progress.js');
assert(!progressJs.includes('setAlwaysOnTop(true)'), 'download-progress.js must not force setAlwaysOnTop(true) upon initialization');

// In openProgressWindow, alwaysOnTop must be false
assert(electronMain.includes('alwaysOnTop: false,'), 'BrowserWindow for progress window must have alwaysOnTop: false');

// 2. Other windows stay as top
assert(electronMain.includes("confirmWindow.setAlwaysOnTop(true, 'screen-saver')"), 'confirmWindow must remain always on top');
assert(electronMain.includes("sharedProgressWindow.setAlwaysOnTop(true, 'screen-saver')"), 'sharedProgressWindow must become top window upon taskCompleted');

// 3. Open when finished button exists in header and footer
assert(progressHtml.includes('id="btn-open-when-done"'), 'btn-open-when-done must be present in progress header');
assert(progressHtml.includes('id="btn-footer-open-when-done"'), 'btn-footer-open-when-done must be present in progress footer');
assert(confirmHtml.includes('id="confirm-open-when-done"'), 'confirm-open-when-done must be present in confirm.html');
assert(confirmJs.includes('confirmOpenWhenDone'), 'confirm.js must wire confirmOpenWhenDone');
assert(confirmJs.includes('openWhenFinished: Boolean(confirmOpenWhenDone'), 'confirm.js must pass openWhenFinished to API');

// 4. Download manager supports openWhenFinished
assert(downloadManager.includes('openWhenFinished: Boolean(options.openWhenFinished)'), 'downloadManager must save openWhenFinished property on task');
assert(downloadManager.includes('task.openWhenFinished = Boolean(options.openWhenFinished)'), 'updateTaskOptions must update openWhenFinished');

console.log('✓ All assertions passed successfully!');
