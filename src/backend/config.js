const fs = require('fs');
const path = require('path');
const os = require('os');
const { getStorageFilePath, safeReadJson, safeWriteJsonSync } = require('./storagePaths');

const CONFIG_FILE = getStorageFilePath('config.json');

const DEFAULT_CONFIG = {
  // Storage & Directory Architecture
  downloadDir: path.join(os.homedir(), 'Downloads', 'Waterfall'),
  tempDir: path.join(os.tmpdir(), 'Waterfall', 'temp'),
  useOsMediaFolders: true,
  createPackageSubfolders: false,
  duplicateAction: 'rename', // 'rename' | 'overwrite' | 'skip'
  preserveMetadata: true,

  // Acceleration Engine & Network Connection
  maxConcurrentDownloads: 3,
  maxConcurrentPerHost: 2,
  segmentsPerFile: 8,
  downloadEngineMode: 'inPlace', // 'inPlace' (Zero Assembly) | 'singleStream' (Whole File) | 'legacyTemp'
  bufferSizeBytes: 1048576, // 1MB highWaterMark chunk buffer
  connectionTimeoutSec: 15,
  maxRetries: 5,
  retryDelaySec: 3,
  customUserAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) WaterfallDL/2.0',

  // Bandwidth & Speed Limiter
  speedLimitEnabled: false,
  speedLimitBytesPerSec: 0, // 0 = unlimited

  // Post-Processing & Automation
  autoExtractArchives: true,
  deleteArchiveAfterExtract: false,
  multipartAutoForceTimeoutSec: 20, // Auto-force download/extract multipart groups after 20s if stalled or waiting for parts
  postDownloadCommand: '',
  powerActionOnComplete: 'none', // 'none' | 'sleep' | 'shutdown'

  // Post-Download Script Execution Engine
  postDownloadScriptEnabled: false,
  postDownloadScriptType: 'auto', // 'auto' | 'python' | 'powershell' | 'batch' | 'node' | 'custom'
  postDownloadScriptPath: '',
  postDownloadCustomCompiler: '',
  postDownloadArguments: '"%FILE%"',
  postDownloadRunCondition: 'all', // 'all' | 'video' | 'audio' | 'compressed' | 'programs' | 'documents'

  // Media & YouTube / yt-dlp Engine
  defaultVideoQuality: '1080', // 'best' | '2160' | '1080' | '720' | '480'
  defaultAudioFormat: 'mp3',   // 'mp3' | 'm4a' | 'flac' | 'wav'
  defaultAudioQuality: '0',    // '0' (320k) | '128k' | '192k' | '256k'
  embedMediaMetadata: true,
  embedMediaThumbnail: true,
  embedMediaChapters: true,
  nodeJsAcceleration: true,

  // Browser Integration & Clipboard
  listenPort: 4567,
  clipboardMonitoring: false,

  // UI, Audio & Notifications
  showTopFilterBar: false, // Show top filter tabs bar in main menu - OFF by default
  autoDownloadWithoutConfirmation: false, // Auto-download files immediately without confirmation (OFF by default)
  showDownloadConfirmation: true, // IDM-style confirmation dialog before starting (ON by default)
  forceTopOnDownload: false, // Do not force main app window to top on download (OFF by default)
  alwaysOnTop: false, // Keep Waterfall pinned on top of other windows (OFF by default)
  mediaStreamPreviewEnabled: true, // Watch as you download live streaming preview
  soundChimeEnabled: true,
  soundChimeVolume: 0.8,
  nativeOsNotifications: true,
  inAppCompletionToast: true,
  highFramerateTick: true,
  hideFinishedInAllDownloads: false, // Hide completed downloads in 'All Downloads' view
  defaultQueueSorting: 'active-first', // 'active-first' | 'date-desc' | 'date-asc' | 'name-asc' | 'size-desc'
  startWithWindows: true, // Automatically launch Waterfall on Windows startup (ON by default)
  startWithWindow: false, // Open main window immediately on launch (OFF by default for silent startup)
  showDownloadProgressDialog: true, // IDM-style download progress dialog window (ON by default)
  showDownloadCompleteDialog: true, // IDM-style download complete finish window (ON by default)
  closeAction: 'ask', // 'ask' | 'tray' | 'exit' - Action when clicking window exit 'X' button
  themeAccent: 'cyan' // 'cyan' | 'purple' | 'emerald' | 'amber' | 'crimson'
};

let currentConfig = { ...DEFAULT_CONFIG };

function loadConfig() {
  try {
    const data = safeReadJson(CONFIG_FILE, null);
    if (data && typeof data === 'object') {
      currentConfig = { ...DEFAULT_CONFIG, ...data };
      // Always enforce Windows Temp directory for temporary chunks & metadata operations
      if (!currentConfig.tempDir || currentConfig.tempDir.includes('Jdownloader rebirth') || !path.isAbsolute(currentConfig.tempDir)) {
        currentConfig.tempDir = path.join(os.tmpdir(), 'Waterfall', 'temp');
      }
      try {
        fs.mkdirSync(currentConfig.tempDir, { recursive: true });
        fs.mkdirSync(path.join(os.tmpdir(), 'Waterfall', 'metadata'), { recursive: true });
        fs.mkdirSync(path.join(os.tmpdir(), 'Waterfall', 'chunks'), { recursive: true });
      } catch (_) {}
    } else {
      saveConfig(DEFAULT_CONFIG);
    }
  } catch (err) {
    console.error('Failed to load config, using defaults:', err.message);
    currentConfig = { ...DEFAULT_CONFIG };
  }
  return currentConfig;
}

function saveConfig(newConfig) {
  try {
    currentConfig = { ...currentConfig, ...newConfig };
    if (!currentConfig.tempDir || currentConfig.tempDir.includes('Jdownloader rebirth') || !path.isAbsolute(currentConfig.tempDir)) {
      currentConfig.tempDir = path.join(os.tmpdir(), 'Waterfall', 'temp');
    }
    safeWriteJsonSync(CONFIG_FILE, currentConfig);
  } catch (err) {
    console.error('Failed to save config:', err.message);
  }
  return currentConfig;
}

function getConfig() {
  return currentConfig;
}

loadConfig();

module.exports = {
  getConfig,
  saveConfig,
  loadConfig,
  DEFAULT_CONFIG
};
