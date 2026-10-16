/**
 * Hydra Desktop — Optimized Electron Native Shell
 * Engineered for minimum RAM footprint, instant startup, and rich desktop integration.
 */

const { app, BrowserWindow, Tray, Menu, nativeImage, shell, ipcMain, Notification, dialog, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const { execFile } = require('child_process');
const WebSocket = require('ws');
const { getStorageDir } = require('./src/backend/storagePaths');

try {
  process.env.WATERFALL_DATA_DIR = getStorageDir();
} catch (_) {}

// Augment PATH with local bin directory and WinGet links
const binPath = path.join(__dirname, 'bin');
process.env.PATH = `${binPath};${process.env.PATH || ''};${process.env.LOCALAPPDATA || ''}\\Microsoft\\WinGet\\Links`;

// Global safety net: prevent silent crashes
process.on('uncaughtException', (err) => {
  console.error('[Waterfall Electron] Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[Waterfall Electron] Unhandled Rejection:', reason);
});

// Ensure consistent Windows AppUserModelId for native Action Center notifications & Taskbar grouping
app.setAppUserModelId('Waterfall.DownloadSuite');

// ============================================================================
// PERFORMANCE & MEMORY OPTIMIZATION SWITCHES
// ============================================================================
// 1. Cap V8 garbage collector heap to 128 MB (prevents memory creep)
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=128');

// 2. Disable heavy, unneeded Chromium background services
app.commandLine.appendSwitch('disable-breakpad'); // Crash reporter
app.commandLine.appendSwitch('disable-component-update');
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-domain-reliability');
app.commandLine.appendSwitch('disable-sync');
app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling,MediaSessionService');

// ============================================================================
// SINGLE INSTANCE LOCK
// ============================================================================
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  console.log('[Waterfall Electron] Another instance is already active. Focusing existing instance.');
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    }
  });
}

let mainWindow = null;
let confirmWindow = null;
let tray = null;
let serverInstance = null;
let downloadManager = null;
const PORT = 4567;
const APP_URL = `http://localhost:${PORT}`;

let pendingConfirmData = null;

function openConfirmWindow(probeData) {
  pendingConfirmData = probeData;
  const icoPath = path.join(__dirname, 'assets', 'icon.ico');
  const pngPath = path.join(__dirname, 'assets', 'icon.png');
  const windowIcon = fs.existsSync(icoPath) ? icoPath : (fs.existsSync(pngPath) ? pngPath : undefined);

  if (confirmWindow && !confirmWindow.isDestroyed()) {
    if (confirmWindow.isMinimized()) confirmWindow.restore();
    if (!confirmWindow.isVisible()) confirmWindow.show();
    confirmWindow.focus();
    if (probeData) {
      try {
        confirmWindow.webContents.send('set-confirm-data', probeData);
      } catch (_) {}
    }
    return confirmWindow;
  }

  confirmWindow = new BrowserWindow({
    width: 620,
    height: 580,
    minWidth: 520,
    minHeight: 500,
    backgroundColor: '#090d16',
    title: 'Waterfall — Download File Info',
    icon: windowIcon,
    show: false,
    autoHideMenuBar: true,
    alwaysOnTop: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      spellcheck: false,
      backgroundThrottling: false
    }
  });

  confirmWindow.setMenuBarVisibility(false);

  const deliverData = () => {
    if (pendingConfirmData && confirmWindow && !confirmWindow.isDestroyed()) {
      try {
        confirmWindow.webContents.send('set-confirm-data', pendingConfirmData);
      } catch (_) {}
    }
  };

  confirmWindow.webContents.on('did-finish-load', () => {
    deliverData();
  });

  confirmWindow.once('ready-to-show', () => {
    if (confirmWindow && !confirmWindow.isDestroyed()) {
      confirmWindow.show();
      confirmWindow.focus();
      deliverData();
    }
  });

  // Safety fallback: ensure window shows even if ready-to-show is delayed
  setTimeout(() => {
    if (confirmWindow && !confirmWindow.isDestroyed() && !confirmWindow.isVisible()) {
      confirmWindow.show();
      confirmWindow.focus();
      deliverData();
    }
  }, 600);

  confirmWindow.on('closed', () => {
    confirmWindow = null;
    pendingConfirmData = null;
  });

  confirmWindow.loadURL(`${APP_URL}/confirm.html`).catch((err) => {
    console.warn('[Waterfall Electron] Failed to load confirm.html via HTTP, attempting file fallback:', err.message);
    if (confirmWindow && !confirmWindow.isDestroyed()) {
      confirmWindow.loadFile(path.join(__dirname, 'src', 'frontend', 'confirm.html')).catch(() => {});
    }
  });

  return confirmWindow;
}

const progressWindows = new Map();

function openProgressWindow(task) {
  if (!task || !task.id) return null;
  const taskId = task.id;

  const icoPath = path.join(__dirname, 'assets', 'icon.ico');
  const pngPath = path.join(__dirname, 'assets', 'icon.png');
  const windowIcon = fs.existsSync(icoPath) ? icoPath : (fs.existsSync(pngPath) ? pngPath : undefined);

  if (progressWindows.has(taskId)) {
    const existingWin = progressWindows.get(taskId);
    if (existingWin && !existingWin.isDestroyed()) {
      if (existingWin.isMinimized()) existingWin.restore();
      if (!existingWin.isVisible()) existingWin.show();
      existingWin.focus();
      try {
        existingWin.webContents.send('set-progress-data', task);
      } catch (_) {}
      return existingWin;
    }
  }

  const pWin = new BrowserWindow({
    width: 620,
    height: 540,
    minWidth: 540,
    minHeight: 460,
    resizable: true,
    backgroundColor: '#0a0f1d',
    title: `Waterfall — ${task.name || task.filename || 'Downloading'}`,
    icon: windowIcon,
    show: false,
    autoHideMenuBar: true,
    alwaysOnTop: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      spellcheck: false,
      backgroundThrottling: false
    }
  });

  pWin.setMenuBarVisibility(false);
  progressWindows.set(taskId, pWin);

  const deliverTask = () => {
    if (pWin && !pWin.isDestroyed()) {
      try {
        pWin.webContents.send('set-progress-data', task);
      } catch (_) {}
    }
  };

  pWin.webContents.on('did-finish-load', () => {
    deliverTask();
  });

  pWin.once('ready-to-show', () => {
    if (pWin && !pWin.isDestroyed()) {
      pWin.show();
      pWin.focus();
      deliverTask();
    }
  });

  // Safety fallback: ensure window shows and delivers data even if ready-to-show is delayed
  setTimeout(() => {
    if (pWin && !pWin.isDestroyed() && !pWin.isVisible()) {
      pWin.show();
      pWin.focus();
      deliverTask();
    }
  }, 600);

  pWin.on('closed', () => {
    progressWindows.delete(taskId);
  });

  const progressUrl = `${APP_URL}/download-progress.html?taskId=${encodeURIComponent(taskId)}`;
  pWin.loadURL(progressUrl).catch(() => {
    if (pWin && !pWin.isDestroyed()) {
      pWin.loadFile(path.join(__dirname, 'src', 'frontend', 'download-progress.html'), {
        query: { taskId }
      }).catch(() => {});
    }
  });

  return pWin;
}

function getAppConfig() {
  try {
    const configPath = path.join(__dirname, 'config.json');
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch (_) {}
  return {};
}

function updateAppConfig(patch) {
  try {
    const configPath = path.join(__dirname, 'config.json');
    let cfg = {};
    if (fs.existsSync(configPath)) {
      cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
    const updated = { ...cfg, ...patch };
    fs.writeFileSync(configPath, JSON.stringify(updated, null, 2), 'utf8');
    try {
      const req = http.request(`${APP_URL}/api/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        timeout: 600
      }, () => {});
      req.on('error', () => {});
      req.write(JSON.stringify(patch));
      req.end();
    } catch (_) {}
    return updated;
  } catch (err) {
    console.warn('[Waterfall Electron] updateAppConfig warning:', err.message);
  }
}

global.electronBrowserSolver = async function(targetUrl) {
  return new Promise((resolve) => {
    let resolved = false;
    let win = null;

    const finish = (result) => {
      if (resolved) return;
      resolved = true;
      if (win && !win.isDestroyed()) {
        try { win.destroy(); } catch (_) {}
      }
      resolve(result);
    };

    try {
      win = new BrowserWindow({
        show: false,
        width: 1280,
        height: 800,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          partition: 'cf-solver-partition'
        }
      });

      win.webContents.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');

      win.webContents.session.on('will-download', (event, item) => {
        event.preventDefault();
        finish({
          directUrl: item.getURL(),
          filename: item.getFilename(),
          size: item.getTotalBytes()
        });
      });

      win.webContents.on('did-navigate', (event, navUrl) => {
        if (navUrl.includes('/dl/') || /\.(7z|zip|rar|iso|bin|exe)(?:$|[?#])/i.test(navUrl)) {
          finish({ directUrl: navUrl });
        }
      });

      win.webContents.setWindowOpenHandler((details) => {
        if (details.url.includes('/dl/') || /\.(7z|zip|rar|iso|bin|exe)(?:$|[?#])/i.test(details.url)) {
          finish({ directUrl: details.url });
        }
        return { action: 'deny' };
      });

      win.loadURL(targetUrl);

      let attempts = 0;
      const interval = setInterval(async () => {
        if (resolved) {
          clearInterval(interval);
          return;
        }
        attempts++;
        if (attempts > 12) {
          clearInterval(interval);
          finish(null);
          return;
        }

        try {
          const title = win.getTitle();
          if (title && !title.includes('Just a moment')) {
            const data = await win.webContents.executeJavaScript(`
              (() => {
                const dlA = Array.from(document.querySelectorAll('a[href]'))
                  .find(a => a.href.includes('/dl/') || /\\.(7z|zip|rar|iso|bin|exe)($|[?#])/i.test(a.href));
                if (dlA) return { directUrl: dlA.href, filename: dlA.textContent.trim() };

                const btn = document.querySelector('button[hx-get*="/go"], a[hx-get*="/go"], button[type="submit"], button.btn');
                if (btn) btn.click();
                return null;
              })()
            `);
            if (data && data.directUrl) {
              clearInterval(interval);
              finish(data);
            }
          }
        } catch (_) {}
      }, 1000);

      setTimeout(() => finish(null), 15000);
    } catch (err) {
      finish(null);
    }
  });
};

// In-process backend server integration (avoids running a separate node.exe process!)
async function initServer() {
  try {
    const isRunning = await checkServerRunning();
    if (!isRunning) {
      console.log('[Waterfall Electron] Starting backend daemon in-process on port ' + PORT);
      const serverModule = require('./server.js');
      downloadManager = serverModule.downloadManager;
      serverInstance = await serverModule.startServer(PORT);
    } else {
      console.log('[Waterfall Electron] Backend daemon already running on port ' + PORT);
      try {
        downloadManager = require('./src/backend/downloadManager');
      } catch (e) {
        console.warn('[Waterfall Electron] Could not attach local downloadManager:', e.message);
      }
    }

    setupTaskbarProgress();
  } catch (err) {
    console.error('[Waterfall Electron] Failed to initialize backend server:', err);
  }
}

function checkServerRunning() {
  return new Promise((resolve) => {
    const req = http.get(`${APP_URL}/api/downloads`, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1200, () => {
      req.destroy();
      resolve(false);
    });
  });
}

function flushBackendSaveState() {
  if (serverInstance && downloadManager && typeof downloadManager.saveState === 'function') {
    try { downloadManager.saveState(true); } catch (_) {}
  }
  // Also ping /api/save in case server is running as an external daemon
  try {
    const req = http.request(`${APP_URL}/api/save`, { method: 'POST', timeout: 800 }, () => {});
    req.on('error', () => {});
    req.end();
  } catch (_) {}
}

function syncWindowsStartup(startWithWindows, startWithWindow) {
  if (process.platform !== 'win32') return;
  try {
    const isPackaged = !process.defaultApp && !__dirname.includes('node_modules');
    let targetExe = process.execPath;
    if (!isPackaged) {
      const candidateExe = path.join(__dirname, 'dist', 'Waterfall-win32-x64', 'Waterfall.exe');
      if (fs.existsSync(candidateExe)) targetExe = candidateExe;
    }

    const args = (startWithWindow !== true) ? ['--hidden'] : [];

    if (app && typeof app.setLoginItemSettings === 'function') {
      app.setLoginItemSettings({
        openAtLogin: Boolean(startWithWindows),
        path: targetExe,
        args
      });
    }

    // Also synchronize Windows Registry HKCU\...\Run key for guaranteed persistence
    if (startWithWindows) {
      const regValue = `"${targetExe}"${args.length ? ' ' + args.join(' ') : ''}`;
      execFile('reg', ['add', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', '/v', 'Waterfall', '/t', 'REG_SZ', '/d', regValue, '/f'], { windowsHide: true }, () => {});
    } else {
      execFile('reg', ['delete', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', '/v', 'Waterfall', '/f'], { windowsHide: true }, () => {});
    }
  } catch (err) {
    console.warn('[Waterfall Electron] syncWindowsStartup warning:', err.message);
  }
}

function formatSpeed(bytes) {
  if (!bytes || bytes === 0) return '0.0 KB/s';
  if (bytes >= 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB/s';
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB/s';
  return (bytes / 1024).toFixed(1) + ' KB/s';
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  if (!bytes) return 'Unknown';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

let lastToastTime = 0;
function sendOsProgressToast(fileName, speed, progress) {
  const scriptPath = path.join(__dirname, 'src', 'backend', 'send_os_toast.ps1');
  if (!fs.existsSync(scriptPath)) return;

  execFile('powershell', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy', 'Bypass',
    '-File', scriptPath,
    '-action', 'progress',
    '-fileName', fileName || 'Active Downloads',
    '-speed', speed || '',
    '-progress', String(progress)
  ], { windowsHide: true }, () => {});
}

function clearOsProgressToast() {
  const scriptPath = path.join(__dirname, 'src', 'backend', 'send_os_toast.ps1');
  if (!fs.existsSync(scriptPath)) return;

  execFile('powershell', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy', 'Bypass',
    '-File', scriptPath,
    '-action', 'clear'
  ], { windowsHide: true }, () => {});
}

const recentNotifs = new Map();

function handleTaskCompletion(task) {
  if (!task) return;

  const taskId = task.id || task.filename || task.name || 'unknown';
  const now = Date.now();
  if (recentNotifs.has('comp_' + taskId) && (now - recentNotifs.get('comp_' + taskId) < 3000)) {
    return;
  }
  recentNotifs.set('comp_' + taskId, now);

  clearOsProgressToast();
  lastMilestone = -1;

  if (mainWindow && !mainWindow.isFocused()) {
    mainWindow.flashFrame(true);
  }

  const fileName = task.name || task.filename || 'Downloaded file';
  const sizeStr = task.totalBytes ? formatBytes(task.totalBytes) : '';
  const savePath = task.savePath || '';

  // Single Windows 10/11 Action Center native Toast with interactive "Open File" and "Open Folder" buttons
  const scriptPath = path.join(__dirname, 'src', 'backend', 'send_os_toast.ps1');
  if (fs.existsSync(scriptPath)) {
    execFile('powershell', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-File', scriptPath,
      '-action', 'complete',
      '-fileName', fileName,
      '-fileSize', sizeStr,
      '-savePath', savePath
    ], { windowsHide: true }, () => {});
  }
}

function handleTaskFailure(data) {
  if (!data) return;
  const task = data.task || data;
  const taskId = (task && task.id) || (task && task.filename) || 'unknown';
  const now = Date.now();
  if (recentNotifs.has('fail_' + taskId) && (now - recentNotifs.get('fail_' + taskId) < 3000)) {
    return;
  }
  recentNotifs.set('fail_' + taskId, now);

  const errorMsg = data.error || task.error || 'Download encountered an unexpected network error.';
  const fileName = task.name || task.filename || 'Downloaded file';

  clearOsProgressToast();
  lastMilestone = -1;

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setProgressBar(1, { mode: 'error' });
    mainWindow.flashFrame(true);
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setProgressBar(-1);
      }
    }, 4500);
  }

  // 1. Electron Native Notification (with click to focus app & update link)
  // Single Windows 10/11 Action Center native Toast
  const scriptPath = path.join(__dirname, 'src', 'backend', 'send_os_toast.ps1');
  if (fs.existsSync(scriptPath)) {
    execFile('powershell', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-File', scriptPath,
      '-action', 'error',
      '-fileName', fileName,
      '-errorMessage', errorMsg
    ], { windowsHide: true }, () => {});
  }
}

let backendWs = null;
let reconnectWsTimer = null;
let lastMilestone = -1;

function connectBackendWebSocket() {
  try {
    const ws = new WebSocket(`ws://localhost:${PORT}/ws`);

    ws.on('open', () => {
      console.log('[Waterfall Electron] Connected to backend WebSocket for Taskbar & OS Progress sync');
      if (reconnectWsTimer) {
        clearTimeout(reconnectWsTimer);
        reconnectWsTimer = null;
      }
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'tick') {
          handleEngineTick(msg);
          // Forward ticks to active individual download progress windows
          if (Array.isArray(msg.tasks) && progressWindows.size > 0) {
            for (const t of msg.tasks) {
              if (progressWindows.has(t.id)) {
                const pWin = progressWindows.get(t.id);
                if (pWin && !pWin.isDestroyed()) {
                  pWin.webContents.send('download-progress-tick', t);
                }
              }
            }
          }
        } else if (msg.type === 'taskCompleted') {
          handleTaskCompletion(msg.task);
          if (msg.task && msg.task.id) {
            if (progressWindows.has(msg.task.id)) {
              const pWin = progressWindows.get(msg.task.id);
              if (pWin && !pWin.isDestroyed()) {
                if (pWin.isMinimized()) pWin.restore();
                if (!pWin.isVisible()) pWin.show();
                pWin.focus();
                pWin.webContents.send('task-completed', msg.task);
              }
            } else {
              const cfg = getAppConfig();
              if (cfg.showDownloadCompleteDialog !== false) {
                openProgressWindow(msg.task);
              }
            }
          }
        } else if (msg.type === 'taskUpdated' && msg.task) {
          if (msg.task.id && progressWindows.has(msg.task.id)) {
            const pWin = progressWindows.get(msg.task.id);
            if (pWin && !pWin.isDestroyed()) {
              pWin.webContents.send('set-progress-data', msg.task);
            }
          }
        } else if (msg.type === 'taskFailed') {
          handleTaskFailure(msg);
        } else if (msg.type === 'showDownloadConfirmation') {
          openConfirmWindow(msg.probeData);
        } else if (msg.type === 'taskCreated') {
          const cfg = getAppConfig();
          if (cfg.showDownloadProgressDialog !== false && msg.task && (msg.task.status === 'downloading' || msg.task.status === 'pending')) {
            openProgressWindow(msg.task);
          }
          if (cfg.forceTopOnDownload === true && mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
            forceWindowToTop();
          }
        } else if (msg.type === 'configUpdated') {
          const cfg = msg.config || getAppConfig();
          if (cfg.alwaysOnTop !== undefined && mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.setAlwaysOnTop(!!cfg.alwaysOnTop, 'floating');
          }
          syncWindowsStartup(cfg.startWithWindows !== false, cfg.startWithWindow === true);
        }
      } catch (_) {}
    });

    ws.on('close', () => {
      if (!reconnectWsTimer) {
        reconnectWsTimer = setTimeout(connectBackendWebSocket, 2000);
      }
    });

    ws.on('error', () => {});
    backendWs = ws;
  } catch (err) {
    console.warn('[Waterfall Electron] WebSocket connect warning:', err.message);
  }
}

let currentTaskbarState = {
  activeCount: -1,
  pct: -1,
  speed: ''
};

function updateTaskbarState(activeCount, progress, speed = '', status = 'normal') {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  if (activeCount <= 0 || progress === undefined || progress < 0) {
    if (currentTaskbarState.activeCount === 0) return; // Already clean & idle, avoid redundant calls
    currentTaskbarState.activeCount = 0;
    currentTaskbarState.pct = -1;
    currentTaskbarState.speed = '';
    mainWindow.setProgressBar(-1);
    mainWindow.setTitle('Waterfall — Modern IDM & JDownloader Suite');
    return;
  }

  const validProgress = Math.min(1, Math.max(0, progress));
  const pct = Math.round(validProgress * 100);
  const speedStr = speed || '0 KB/s';

  // Deduplicate: avoid re-setting title and taskbar if state hasn't changed
  if (currentTaskbarState.activeCount === activeCount && currentTaskbarState.pct === pct && currentTaskbarState.speed === speedStr) {
    return;
  }

  currentTaskbarState.activeCount = activeCount;
  currentTaskbarState.pct = pct;
  currentTaskbarState.speed = speedStr;

  mainWindow.setProgressBar(validProgress, { mode: 'normal' });
  mainWindow.setTitle(`[${pct}% • ${speedStr}] Waterfall — Modern IDM & JDownloader Suite`);
}

function handleEngineTick(msg) {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  const tasks = msg.tasks || [];
  const activeTasks = tasks.filter(t => t.status === 'downloading' || t.status === 'assembling');

  if (activeTasks.length === 0) {
    lastMilestone = -1;
    updateTaskbarState(0, -1, '0 KB/s');
    return;
  }

  let totalBytes = 0;
  let downloadedBytes = 0;
  for (const t of activeTasks) {
    if (t.totalBytes > 0) {
      totalBytes += t.totalBytes;
      downloadedBytes += (t.downloadedBytes || 0);
    }
  }

  const speedStr = formatSpeed(msg.globalSpeed || 0);

  if (totalBytes > 0) {
    const progress = Math.min(1, Math.max(0, downloadedBytes / totalBytes));
    updateTaskbarState(activeTasks.length, progress, speedStr, 'normal');
  } else {
    // Indeterminate mode for active download without known content length
    mainWindow.setProgressBar(2);
    mainWindow.setTitle(`[Downloading • ${speedStr}] Waterfall — Modern IDM & JDownloader Suite`);
  }
}

// Windows Taskbar Progress Bar Sync
function setupTaskbarProgress() {
  connectBackendWebSocket();

  if (downloadManager) {
    downloadManager.on('taskCompleted', handleTaskCompletion);
    downloadManager.on('taskFailed', handleTaskFailure);
  }
}

const WINDOW_STATE_PATH = path.join(app.getPath('userData') || __dirname, 'window-state.json');

function getWindowState() {
  let primaryDisplay;
  try {
    primaryDisplay = screen.getPrimaryDisplay();
  } catch (_) {}

  const screenW = (primaryDisplay && primaryDisplay.workAreaSize) ? primaryDisplay.workAreaSize.width : 1920;
  const screenH = (primaryDisplay && primaryDisplay.workAreaSize) ? primaryDisplay.workAreaSize.height : 1080;

  // Generous, authentic desktop width: 1540px or 88% of screen, giving ample room to all columns
  const defaultWidth = Math.min(1560, Math.max(1420, Math.round(screenW * 0.88)));
  const defaultHeight = Math.min(960, Math.max(860, Math.round(screenH * 0.88)));

  let state = {
    width: defaultWidth,
    height: defaultHeight,
    isMaximized: false
  };

  try {
    if (fs.existsSync(WINDOW_STATE_PATH)) {
      const data = JSON.parse(fs.readFileSync(WINDOW_STATE_PATH, 'utf8'));
      if (data && data.width && data.height) {
        state.width = Math.max(1100, Math.min(data.width, screenW));
        state.height = Math.max(680, Math.min(data.height, screenH));
        if (data.x !== undefined && data.y !== undefined && data.x >= 0 && data.x < screenW - 200 && data.y >= 0 && data.y < screenH - 200) {
          state.x = data.x;
          state.y = data.y;
        }
        state.isMaximized = Boolean(data.isMaximized);
      }
    }
  } catch (_) {}

  return state;
}

function saveWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    const isMaximized = mainWindow.isMaximized();
    let bounds = mainWindow.getBounds();
    if (isMaximized && mainWindow.getNormalBounds) {
      bounds = mainWindow.getNormalBounds();
    }
    fs.writeFileSync(WINDOW_STATE_PATH, JSON.stringify({
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      isMaximized
    }));
  } catch (_) {}
}

function createWindow() {
  const icoPath = path.join(__dirname, 'assets', 'icon.ico');
  const pngPath = path.join(__dirname, 'assets', 'icon.png');
  const windowIcon = fs.existsSync(icoPath) ? icoPath : (fs.existsSync(pngPath) ? pngPath : undefined);

  const windowState = getWindowState();

  mainWindow = new BrowserWindow({
    width: windowState.width,
    height: windowState.height,
    x: windowState.x,
    y: windowState.y,
    minWidth: 1060,
    minHeight: 640,
    backgroundColor: '#090d16',
    title: 'Waterfall — Modern IDM & JDownloader Suite',
    icon: windowIcon,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      spellcheck: false,
      backgroundThrottling: false
    }
  });

  if (windowState.isMaximized) {
    mainWindow.maximize();
  }

  if (windowIcon) {
    try {
      mainWindow.setIcon(windowIcon);
    } catch (_) {}
  }

  mainWindow.setMenuBarVisibility(false);

  mainWindow.once('ready-to-show', () => {
    const cfg = getAppConfig();
    if (cfg && cfg.alwaysOnTop) {
      mainWindow.setAlwaysOnTop(true, 'floating');
    }
    const isHiddenStart = process.argv.includes('--hidden') || process.argv.includes('--minimized') || (cfg && cfg.startWithWindow !== true);
    if (!isHiddenStart) {
      mainWindow.show();
      mainWindow.focus();
    } else {
      console.log('[Waterfall Electron] Starting silently minimized to system tray (startWithWindow is OFF by default).');
    }
  });

  let resizeSaveTimeout = null;
  const triggerSaveState = () => {
    if (resizeSaveTimeout) clearTimeout(resizeSaveTimeout);
    resizeSaveTimeout = setTimeout(saveWindowState, 600);
  };
  mainWindow.on('resize', triggerSaveState);
  mainWindow.on('move', triggerSaveState);
  mainWindow.on('maximize', triggerSaveState);
  mainWindow.on('unmaximize', triggerSaveState);

  function loadApp() {
    mainWindow.loadURL(APP_URL).catch(() => {
      console.log('[Waterfall Electron] Retrying loadURL in 600ms...');
      setTimeout(loadApp, 600);
    });
  }
  loadApp();

  mainWindow.on('close', async (e) => {
    saveWindowState();
    if (app.isQuitting) {
      return;
    }

    const cfg = getAppConfig();
    const closeAction = cfg.closeAction || 'ask';

    if (closeAction === 'tray') {
      e.preventDefault();
      mainWindow.hide();
      return;
    }

    if (closeAction === 'exit') {
      flushBackendSaveState();
      app.isQuitting = true;
      app.quit();
      return;
    }

    // Default 'ask': Intercept close and show dialog
    e.preventDefault();

    let hasActive = false;
    try {
      if (downloadManager) {
        const tasks = downloadManager.getAllTasks();
        hasActive = tasks.some(t => t.status === 'downloading' || t.status === 'assembling');
      }
    } catch (_) {}

    const icoPath = path.join(__dirname, 'assets', 'icon.ico');
    const pngPath = path.join(__dirname, 'assets', 'icon.png');
    const windowIcon = fs.existsSync(icoPath) ? icoPath : (fs.existsSync(pngPath) ? pngPath : undefined);

    const result = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      buttons: ['Tray (Minimize to Tray)', 'Full Exit (Close Waterfall)', 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      title: 'Exit Waterfall',
      message: 'Choose how to exit Waterfall:',
      detail: hasActive
        ? 'Active downloads are currently running! If you choose Full Exit, downloads will stop. You can minimize to Tray to let them finish in the background.'
        : 'Do you want to minimize Waterfall to the system tray or close it completely?',
      checkboxLabel: 'Remember my choice',
      checkboxChecked: false,
      noLink: true,
      icon: windowIcon
    });

    if (result.response === 0) {
      // Tray
      if (result.checkboxChecked) {
        updateAppConfig({ closeAction: 'tray' });
      }
      mainWindow.hide();
      try {
        if (tray) {
          tray.displayBalloon({
            title: 'Waterfall Running in Background',
            content: 'Waterfall is minimized to the system tray. Click the tray icon to restore.',
            iconType: 'info'
          });
        }
      } catch (_) {}
    } else if (result.response === 1) {
      // Full Exit
      if (result.checkboxChecked) {
        updateAppConfig({ closeAction: 'exit' });
      }
      flushBackendSaveState();
      app.isQuitting = true;
      app.quit();
    } else {
      // Cancel: stay open, do nothing
    }
  });
}

function createTray() {
  try {
    const icoPath = path.join(__dirname, 'assets', 'icon.ico');
    const pngPath = path.join(__dirname, 'assets', 'icon.png');
    const trayIconPath = (process.platform === 'win32' && fs.existsSync(icoPath)) ? icoPath : pngPath;
    if (!fs.existsSync(trayIconPath)) return;

    tray = new Tray(trayIconPath);
    tray.setToolTip('Waterfall — Modern IDM & JDownloader Suite');

    const contextMenu = Menu.buildFromTemplate([
      {
        label: '🚀 Open Waterfall',
        click: () => {
          if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
          }
        }
      },
      { type: 'separator' },
      {
        label: '▶️ Resume All Downloads',
        click: () => {
          if (downloadManager) downloadManager.resumeAll();
        }
      },
      {
        label: '⏸️ Pause All Downloads',
        click: () => {
          if (downloadManager) downloadManager.pauseAll();
        }
      },
      { type: 'separator' },
      {
        label: '📂 Open Downloads Folder',
        click: () => {
          const downloadsPath = path.join(require('os').homedir(), 'Downloads');
          shell.openPath(downloadsPath);
        }
      },
      {
        label: '🌐 Open in Web Browser',
        click: () => shell.openExternal(APP_URL)
      },
      { type: 'separator' },
      {
        label: '❌ Exit Waterfall',
        click: () => {
          app.isQuitting = true;
          app.quit();
        }
      }
    ]);

    tray.setContextMenu(contextMenu);

    tray.on('double-click', () => {
      if (mainWindow) {
        if (mainWindow.isVisible()) {
          mainWindow.focus();
        } else {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    });
  } catch (err) {
    console.warn('[Waterfall Electron] Tray initialization warning:', err.message);
  }
}

// IPC Window Controls
ipcMain.on('window-minimize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
  if (win) win.minimize();
});

ipcMain.on('window-maximize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
  if (win) {
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  }
});

ipcMain.on('window-close', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
  if (win) win.close();
});

ipcMain.on('open-confirm-window', (event, probeData) => {
  openConfirmWindow(probeData);
});

ipcMain.on('close-confirm-window', () => {
  if (confirmWindow && !confirmWindow.isDestroyed()) {
    confirmWindow.close();
  }
});

ipcMain.on('open-progress-window', (event, task) => {
  openProgressWindow(task);
});

ipcMain.on('close-progress-window', (event, taskId) => {
  if (taskId && progressWindows.has(taskId)) {
    const pWin = progressWindows.get(taskId);
    if (pWin && !pWin.isDestroyed()) pWin.close();
  }
});

ipcMain.handle('get-progress-data', (event, taskId) => {
  if (downloadManager && taskId) {
    try {
      const t = downloadManager.getTask(taskId);
      if (t) return t;
    } catch (_) {}
  }
  return null;
});

ipcMain.on('open-external', (event, url) => {
  if (url) shell.openExternal(url);
});

ipcMain.handle('open-file', async (event, filePath) => {
  if (!filePath) return false;
  try {
    const res = await shell.openPath(filePath);
    return res === ''; // empty string means success
  } catch (err) {
    console.warn('[Waterfall Electron] shell.openPath failed:', err.message);
    return false;
  }
});

ipcMain.handle('open-folder', async (event, filePath) => {
  if (!filePath) return false;
  try {
    const resolved = path.resolve(filePath);
    if (fs.existsSync(resolved)) {
      const stat = fs.statSync(resolved);
      if (stat.isDirectory()) {
        shell.openPath(resolved);
      } else {
        shell.showItemInFolder(resolved);
      }
      return true;
    } else {
      const parentDir = path.dirname(resolved);
      if (fs.existsSync(parentDir)) {
        shell.openPath(parentDir);
        return true;
      }
    }
    shell.showItemInFolder(filePath);
    return true;
  } catch (err) {
    console.warn('[Waterfall Electron] shell open folder failed:', err.message);
    return false;
  }
});

ipcMain.handle('select-folder', async (event, defaultPath) => {
  try {
    const ownerWin = BrowserWindow.fromWebContents(event.sender) || mainWindow;
    const res = await dialog.showOpenDialog(ownerWin, {
      title: 'Select Download Folder',
      defaultPath: (defaultPath && fs.existsSync(defaultPath)) ? defaultPath : undefined,
      properties: ['openDirectory', 'createDirectory']
    });
    if (!res.canceled && res.filePaths && res.filePaths.length > 0) {
      return res.filePaths[0];
    }
    return null;
  } catch (err) {
    console.warn('[Waterfall Electron] select-folder dialog failed:', err.message);
    return null;
  }
});

ipcMain.handle('select-file', async (event, options = {}) => {
  try {
    const ownerWin = BrowserWindow.fromWebContents(event.sender) || mainWindow;
    const res = await dialog.showOpenDialog(ownerWin, {
      title: options.title || 'Select Script File',
      defaultPath: (options.defaultPath && fs.existsSync(options.defaultPath)) ? options.defaultPath : undefined,
      filters: options.filters || [
        { name: 'Scripts & Executables', extensions: ['ps1', 'bat', 'cmd', 'py', 'js', 'exe', 'sh'] },
        { name: 'All Files', extensions: ['*'] }
      ],
      properties: ['openFile']
    });
    if (!res.canceled && res.filePaths && res.filePaths.length > 0) {
      return res.filePaths[0];
    }
    return null;
  } catch (err) {
    console.warn('[Waterfall Electron] select-file dialog failed:', err.message);
    return null;
  }
});

function forceWindowToTop(keepPinned = false) {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  try {
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    if (!mainWindow.isVisible()) {
      mainWindow.show();
    }

    // Force window to front through Windows foreground lock
    mainWindow.setAlwaysOnTop(true, 'screen-saver');
    mainWindow.moveTop();
    mainWindow.show();
    mainWindow.focus();
    mainWindow.flashFrame(true);

    let isAlwaysOnTopEnabled = keepPinned;
    try {
      const cfg = getAppConfig();
      if (cfg && cfg.alwaysOnTop) isAlwaysOnTopEnabled = true;
    } catch (_) {}

    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (!isAlwaysOnTopEnabled) {
          mainWindow.setAlwaysOnTop(false);
        } else {
          mainWindow.setAlwaysOnTop(true, 'floating');
        }
      }
    }, 1200);
  } catch (err) {
    console.warn('[Waterfall Electron] forceWindowToTop error:', err.message);
  }
}

ipcMain.on('window-focus', () => {
  forceWindowToTop();
});

ipcMain.on('window-force-top', (event, keepPinned) => {
  forceWindowToTop(keepPinned);
});

ipcMain.on('window-set-always-on-top', (event, flag) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setAlwaysOnTop(!!flag, 'floating');
  }
});

ipcMain.handle('get-app-icon', async (event, { filePath, ext }) => {
  try {
    let iconUrl = null;
    let targetPath = (filePath && fs.existsSync(filePath)) ? filePath : null;

    // If target file doesn't exist yet on disk (e.g. queued or downloading),
    // probe with a dummy file in os.tmpdir() with that extension so Electron
    // resolves the registered Windows shell icon natively in <2ms!
    const effectiveExt = (ext || (filePath ? path.extname(filePath) : '')).trim();

    if (!targetPath && effectiveExt) {
      const cleanExt = effectiveExt.startsWith('.') ? effectiveExt : ('.' + effectiveExt);
      const tempDummy = path.join(os.tmpdir(), `waterfall_ico_probe_${process.pid}${cleanExt}`);
      try {
        if (!fs.existsSync(tempDummy)) {
          fs.writeFileSync(tempDummy, '');
        }
        targetPath = tempDummy;
      } catch (_) {}
    }

    if (targetPath) {
      const nativeIcon = await app.getFileIcon(targetPath, { size: 'large' });
      if (nativeIcon && !nativeIcon.isEmpty()) {
        iconUrl = nativeIcon.toDataURL();
      }
    }

    return {
      icon: iconUrl,
      extension: effectiveExt
    };
  } catch (err) {
    return null;
  }
});

// OS & Taskbar Progress IPC Channels
ipcMain.on('update-taskbar-progress', (event, data) => {
  if (!data) return;
  const { progress, speed, status, activeCount } = data;
  updateTaskbarState(activeCount || 0, progress, speed, status);
});

ipcMain.on('notify-task-completed', (event, task) => {
  handleTaskCompletion(task);
});

ipcMain.on('notify-task-failed', (event, data) => {
  handleTaskFailure(data);
});

ipcMain.on('notify-download-progress', () => {
  // OS progress notification removed per user request
});

// App ready event
app.whenReady().then(async () => {
  app.setAppUserModelId('Waterfall.DownloadSuite');
  await initServer();
  const cfg = getAppConfig();
  syncWindowsStartup(cfg.startWithWindows !== false, cfg.startWithWindow !== false);
  createWindow();
  createTray();
  setupTaskbarProgress();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
});

app.on('before-quit', () => {
  flushBackendSaveState();
  app.isQuitting = true;
});

app.on('will-quit', () => {
  flushBackendSaveState();
});

app.on('window-all-closed', () => {
  // If not explicitly running in tray, quit
  if (!tray || app.isQuitting) {
    app.quit();
  }
});
