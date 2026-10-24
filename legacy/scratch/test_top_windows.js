const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('Testing Top Window configurations for Confirm and Progress windows...');

// 1. Check electron-main.js
const electronMain = fs.readFileSync(path.join(__dirname, '..', 'electron-main.js'), 'utf8');

// confirmWindow checks
assert(electronMain.includes("confirmWindow.setAlwaysOnTop(true, 'screen-saver');"), 'confirmWindow should have setAlwaysOnTop with screen-saver');
assert(electronMain.includes("title: 'Waterfall — Download File Info'") && electronMain.includes("alwaysOnTop: true"), 'confirmWindow BrowserWindow must have alwaysOnTop: true');

// sharedProgressWindow checks
const pWinMatch = electronMain.includes("title: `Waterfall — ${task.name || task.filename || 'Downloading'}`") &&
                  electronMain.includes("alwaysOnTop: true");
assert(pWinMatch, 'sharedProgressWindow BrowserWindow must have alwaysOnTop: true');
assert(electronMain.includes("sharedProgressWindow.setAlwaysOnTop(true, 'screen-saver');"), 'sharedProgressWindow must have setAlwaysOnTop with screen-saver');

// IPC handlers check
assert(electronMain.includes('forceTargetWindowToTop'), 'forceTargetWindowToTop must be defined');
assert(electronMain.includes("win.setAlwaysOnTop(!!flag, 'screen-saver');"), 'window-set-always-on-top must support sender window');

// 2. Check HTML files
const progressHtml = fs.readFileSync(path.join(__dirname, '..', 'src', 'frontend', 'download-progress.html'), 'utf8');
assert(progressHtml.includes('id="btn-pin-dlg"'), 'download-progress.html must have #btn-pin-dlg');

const confirmHtml = fs.readFileSync(path.join(__dirname, '..', 'src', 'frontend', 'confirm.html'), 'utf8');
assert(confirmHtml.includes('id="btn-pin-confirm"'), 'confirm.html must have #btn-pin-confirm');

// 3. Check JS controllers
const progressJs = fs.readFileSync(path.join(__dirname, '..', 'src', 'frontend', 'js', 'download-progress.js'), 'utf8');
assert(progressJs.includes("btnPinDlg.addEventListener('click'"), 'download-progress.js must handle btnPinDlg click');
assert(progressJs.includes("window.waterfallDesktop.setAlwaysOnTop(true)"), 'download-progress.js must ensure top window initially');
assert(progressJs.includes("window.waterfallDesktop.forceTop(true)"), 'download-progress.js must call forceTop on complete');

const confirmJs = fs.readFileSync(path.join(__dirname, '..', 'src', 'frontend', 'js', 'confirm.js'), 'utf8');
assert(confirmJs.includes("btnPinConfirm.addEventListener('click'"), 'confirm.js must handle btnPinConfirm click');
assert(confirmJs.includes("window.waterfallDesktop.setAlwaysOnTop(true)"), 'confirm.js must ensure top window initially');

// 4. Check Tauri lib.rs
const tauriLib = fs.readFileSync(path.join(__dirname, '..', 'src-tauri', 'src', 'lib.rs'), 'utf8');
assert(tauriLib.includes('.always_on_top(true)'), 'tauri lib.rs must configure always_on_top(true)');
assert(tauriLib.includes('let _ = win.set_always_on_top(true);'), 'tauri lib.rs must call set_always_on_top');

console.log('>>> ALL TOP WINDOW CHECKS PASSED SUCCESSFULLY!');
