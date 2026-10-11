/**
 * Hydra Desktop — Optimized Electron Native Shell
 * Engineered for minimum RAM footprint, instant startup, and rich desktop integration.
 */

const { app, BrowserWindow, Tray, Menu, nativeImage, shell, ipcMain, Notification, dialog, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { execFile } = require('child_process');
const WebSocket = require('ws');

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
let tray = null;
let serverInstance = null;
let downloadManager = null;
const PORT = 4567;
const APP_URL = `http://localhost:${PORT}`;

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
        } else if (msg.type === 'taskCompleted') {
          handleTaskCompletion(msg.task);
        } else if (msg.type === 'taskFailed') {
          handleTaskFailure(msg);
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
  const appIcon = nativeImage.createFromPath(fs.existsSync(icoPath) ? icoPath : pngPath);

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
    icon: !appIcon.isEmpty() ? appIcon : (fs.existsSync(icoPath) ? icoPath : undefined),
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

  if (!appIcon.isEmpty()) {
    try {
      mainWindow.setIcon(appIcon);
    } catch (_) {}
  }

  mainWindow.setMenuBarVisibility(false);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
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

  mainWindow.on('close', (e) => {
    saveWindowState();
    if (!app.isQuitting) {
      let hasActive = false;
      try {
        if (downloadManager) {
          const tasks = downloadManager.getAllTasks();
          hasActive = tasks.some(t => t.status === 'downloading' || t.status === 'assembling');
        }
      } catch (err) {}

      // If active downloads are running and tray exists, minimize to tray
      if (hasActive && tray) {
        e.preventDefault();
        mainWindow.hide();
        try {
          tray.displayBalloon({
            title: 'Waterfall Running in Background',
            content: 'Active downloads are continuing in the background.',
            iconType: 'info'
          });
        } catch (err) {}
      } else {
        // Otherwise quit cleanly so no orphaned background processes remain
        if (downloadManager && typeof downloadManager.saveState === 'function') {
          downloadManager.saveState(true);
        }
        app.isQuitting = true;
        app.quit();
      }
    }
  });

  app.on('before-quit', () => {
    if (downloadManager && typeof downloadManager.saveState === 'function') {
      downloadManager.saveState(true);
    }
  });
}

function createTray() {
  try {
    const iconPath = path.join(__dirname, 'assets', 'icon.png');
    if (!fs.existsSync(iconPath)) return;

    const img = nativeImage.createFromPath(iconPath);
    if (img.isEmpty()) return;

    const trayIcon = img.resize({ width: 16, height: 16 });
    tray = new Tray(trayIcon);
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
ipcMain.on('window-minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.on('window-maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  }
});

ipcMain.on('window-close', () => {
  if (mainWindow) mainWindow.close();
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
    const res = await dialog.showOpenDialog(mainWindow, {
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

ipcMain.on('window-focus', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
  }
});

ipcMain.handle('get-app-icon', async (event, { filePath, ext }) => {
  try {
    let iconUrl = null;
    if (filePath && fs.existsSync(filePath)) {
      const nativeIcon = await app.getFileIcon(filePath, { size: 'large' });
      if (nativeIcon && !nativeIcon.isEmpty()) {
        iconUrl = nativeIcon.toDataURL();
      }
    }
    return {
      icon: iconUrl,
      extension: ext || (filePath ? path.extname(filePath) : '')
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
  app.isQuitting = true;
});

app.on('window-all-closed', () => {
  // If not explicitly running in tray, quit
  if (!tray || app.isQuitting) {
    app.quit();
  }
});
