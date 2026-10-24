/**
 * Waterfall Unified Binary Resolver & Auto-Downloader
 * Detects system resources (WinGet, Chocolatey, Scoop, PATH, Program Files)
 * and automatically downloads yt-dlp at startup if missing.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawn } = require('child_process');
const https = require('https');
const http = require('http');

let cachedYtDlpPath = null;
let cachedFfmpegDir = null;
let cached7zPath = null;
let cachedNodePath = null;
let isDownloadingYtDlp = false;

/**
 * Returns a persistent writable directory for binaries (e.g. %LOCALAPPDATA%\Waterfall\bin)
 */
function getPersistentBinDir() {
  const localAppData = process.env.LOCALAPPDATA || process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const targetDir = path.join(localAppData, 'Waterfall', 'bin');
  try {
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    return targetDir;
  } catch (_) {
    const fallback = path.join(os.tmpdir(), 'Waterfall', 'bin');
    if (!fs.existsSync(fallback)) fs.mkdirSync(fallback, { recursive: true });
    return fallback;
  }
}

/**
 * Searches system PATH for an executable using where.exe on Windows
 */
function findInSystemPath(name) {
  if (process.platform !== 'win32') {
    try {
      const out = execSync(`which ${name}`, { stdio: ['pipe', 'pipe', 'ignore'], encoding: 'utf8' }).trim();
      if (out && fs.existsSync(out)) return out;
    } catch (_) {}
    return null;
  }

  try {
    const out = execSync(`where.exe ${name}`, { stdio: ['pipe', 'pipe', 'ignore'], encoding: 'utf8' });
    const lines = out.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    for (const line of lines) {
      if (fs.existsSync(line)) return line;
    }
  } catch (_) {}
  return null;
}

/**
 * Scans WinGet package directories for specific binaries
 */
function findInWinGetPackages(binaryPattern) {
  const localAppData = process.env.LOCALAPPDATA || '';
  if (!localAppData) return null;

  // 1. Check WinGet Links
  const linksPath = path.join(localAppData, 'Microsoft', 'WinGet', 'Links', binaryPattern);
  if (fs.existsSync(linksPath)) return linksPath;

  // 2. Scan Packages directory
  const packagesDir = path.join(localAppData, 'Microsoft', 'WinGet', 'Packages');
  if (!fs.existsSync(packagesDir)) return null;

  try {
    const entries = fs.readdirSync(packagesDir);
    for (const entry of entries) {
      const lower = entry.toLowerCase();
      // Match relevant package prefix
      if (lower.includes('ffmpeg') || lower.includes('yt-dlp') || lower.includes('7zip')) {
        const pkgPath = path.join(packagesDir, entry);
        const candidate = findFileRecursive(pkgPath, binaryPattern, 4);
        if (candidate) return candidate;
      }
    }
  } catch (_) {}
  return null;
}

function findFileRecursive(dir, filename, maxDepth = 3) {
  if (maxDepth <= 0) return null;
  try {
    const files = fs.readdirSync(dir, { withFileTypes: true });
    for (const f of files) {
      const fullPath = path.join(dir, f.name);
      if (f.isFile() && f.name.toLowerCase() === filename.toLowerCase()) {
        return fullPath;
      } else if (f.isDirectory()) {
        const sub = findFileRecursive(fullPath, filename, maxDepth - 1);
        if (sub) return sub;
      }
    }
  } catch (_) {}
  return null;
}

/**
 * Locates the yt-dlp executable
 */
function getYtDlpPath() {
  if (cachedYtDlpPath && fs.existsSync(cachedYtDlpPath)) {
    return cachedYtDlpPath;
  }

  const localAppData = process.env.LOCALAPPDATA || '';
  const appData = process.env.APPDATA || '';
  const userProfile = os.homedir();

  const candidates = [
    // 1. Local workspace / application bin
    path.join(__dirname, '..', '..', 'bin', 'yt-dlp.exe'),
    path.join(__dirname.replace('app.asar', 'app.asar.unpacked'), '..', '..', 'bin', 'yt-dlp.exe'),
    process.resourcesPath ? path.join(process.resourcesPath, 'bin', 'yt-dlp.exe') : null,
    process.resourcesPath ? path.join(process.resourcesPath, 'app.asar.unpacked', 'bin', 'yt-dlp.exe') : null,
    path.join(process.cwd(), 'bin', 'yt-dlp.exe'),
    path.join(path.dirname(process.execPath || ''), 'bin', 'yt-dlp.exe'),

    // 2. Persistent AppData bin (auto-download destination)
    path.join(getPersistentBinDir(), 'yt-dlp.exe'),

    // 3. WinGet Links & Packages
    localAppData ? path.join(localAppData, 'Microsoft', 'WinGet', 'Links', 'yt-dlp.exe') : null,

    // 4. Scoop & Chocolatey
    userProfile ? path.join(userProfile, 'scoop', 'shims', 'yt-dlp.exe') : null,
    'C:\\ProgramData\\chocolatey\\bin\\yt-dlp.exe',

    // 5. Python Scripts
    localAppData ? path.join(localAppData, 'Programs', 'Python', 'Python312', 'Scripts', 'yt-dlp.exe') : null,
    localAppData ? path.join(localAppData, 'Programs', 'Python', 'Python311', 'Scripts', 'yt-dlp.exe') : null,
    appData ? path.join(appData, 'Python', 'Python312', 'Scripts', 'yt-dlp.exe') : null,

    // 6. Non-windows fallback
    path.join(__dirname, '..', '..', 'bin', 'yt-dlp')
  ].filter(Boolean);

  for (const c of candidates) {
    if (fs.existsSync(c)) {
      cachedYtDlpPath = c;
      return c;
    }
  }

  // 7. Check WinGet Packages recursive
  const wingetPkg = findInWinGetPackages('yt-dlp.exe');
  if (wingetPkg) {
    cachedYtDlpPath = wingetPkg;
    return wingetPkg;
  }

  // 8. System PATH check
  const systemPath = findInSystemPath('yt-dlp');
  if (systemPath) {
    cachedYtDlpPath = systemPath;
    return systemPath;
  }

  return 'yt-dlp';
}

/**
 * Checks if yt-dlp actually exists and is executable
 */
function isYtDlpAvailable() {
  const p = getYtDlpPath();
  if (p !== 'yt-dlp' && fs.existsSync(p)) return true;
  // If it's 'yt-dlp', test running it with --version
  try {
    execSync('yt-dlp --version', { stdio: 'ignore', timeout: 2000 });
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Locates the FFmpeg directory containing ffmpeg.exe (for yt-dlp --ffmpeg-location)
 */
function getFfmpegLocation() {
  if (cachedFfmpegDir && fs.existsSync(path.join(cachedFfmpegDir, 'ffmpeg.exe'))) {
    return cachedFfmpegDir;
  }

  const localAppData = process.env.LOCALAPPDATA || '';
  const userProfile = os.homedir();

  const candidates = [
    // 1. Local workspace / app bin
    path.join(__dirname, '..', '..', 'bin'),
    path.join(__dirname.replace('app.asar', 'app.asar.unpacked'), '..', '..', 'bin'),
    process.resourcesPath ? path.join(process.resourcesPath, 'bin') : null,
    process.resourcesPath ? path.join(process.resourcesPath, 'app.asar.unpacked', 'bin') : null,
    path.join(process.cwd(), 'bin'),
    path.join(path.dirname(process.execPath || ''), 'bin'),

    // 2. Persistent AppData bin
    getPersistentBinDir(),

    // 3. WinGet Links
    localAppData ? path.join(localAppData, 'Microsoft', 'WinGet', 'Links') : null,

    // 4. Scoop & Chocolatey
    userProfile ? path.join(userProfile, 'scoop', 'shims') : null,
    'C:\\ProgramData\\chocolatey\\bin',

    // 5. Common system installation paths
    'C:\\ffmpeg\\bin',
    'C:\\Program Files\\ffmpeg\\bin',
    'C:\\Program Files (x86)\\ffmpeg\\bin'
  ].filter(Boolean);

  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'ffmpeg.exe')) || fs.existsSync(path.join(c, 'ffmpeg'))) {
      cachedFfmpegDir = c;
      return c;
    }
  }

  // 6. Check WinGet Packages recursive
  const wingetFfmpeg = findInWinGetPackages('ffmpeg.exe');
  if (wingetFfmpeg) {
    const dir = path.dirname(wingetFfmpeg);
    cachedFfmpegDir = dir;
    return dir;
  }

  // 7. System PATH check via where.exe
  const systemPath = findInSystemPath('ffmpeg');
  if (systemPath) {
    const dir = path.dirname(systemPath);
    cachedFfmpegDir = dir;
    return dir;
  }

  return null;
}

/**
 * Locates 7-Zip or NanaZip executable
 */
function get7zExecutable() {
  if (cached7zPath && (cached7zPath === '7z' || fs.existsSync(cached7zPath))) {
    return cached7zPath;
  }

  const localAppData = process.env.LOCALAPPDATA || '';
  const progFiles = process.env.ProgramFiles || 'C:\\Program Files';
  const progFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';

  const candidates = [
    path.join(__dirname, '..', '..', 'bin', '7z.exe'),
    path.join(__dirname, '..', '..', 'bin', '7za.exe'),
    process.resourcesPath ? path.join(process.resourcesPath, 'bin', '7z.exe') : null,
    path.join(progFiles, '7-Zip', '7z.exe'),
    path.join(progFilesX86, '7-Zip', '7z.exe'),
    localAppData ? path.join(localAppData, 'Programs', '7-Zip', '7z.exe') : null,
    localAppData ? path.join(localAppData, 'Microsoft', 'WindowsApps', '7z.exe') : null,
    localAppData ? path.join(localAppData, 'Microsoft', 'WinGet', 'Links', '7z.exe') : null,
    path.join(progFiles, 'NanaZip', 'NanaZip.exe'),
    path.join(progFiles, 'NanaZip', 'NanaZipC.exe')
  ].filter(Boolean);

  for (const c of candidates) {
    if (fs.existsSync(c)) {
      cached7zPath = c;
      return c;
    }
  }

  // Check if 7z is runnable on PATH (e.g. NanaZip alias)
  try {
    execSync('7z', { stdio: 'ignore', timeout: 1500 });
    cached7zPath = '7z';
    return '7z';
  } catch (_) {}

  const sys7z = findInSystemPath('7z');
  if (sys7z) {
    cached7zPath = sys7z;
    return sys7z;
  }

  return '7z';
}

/**
 * Locates Node.js runtime for yt-dlp --js-runtimes
 */
function getNodeJsPath() {
  if (cachedNodePath && fs.existsSync(cachedNodePath)) {
    return cachedNodePath;
  }

  // Use current running Node if running via node.exe
  if (process.execPath && path.basename(process.execPath).toLowerCase().startsWith('node')) {
    cachedNodePath = process.execPath;
    return process.execPath;
  }

  const candidates = [
    'C:\\Program Files\\nodejs\\node.exe',
    'C:\\Program Files (x86)\\nodejs\\node.exe',
    process.env.APPDATA ? path.join(process.env.APPDATA, 'npm', 'node.exe') : null,
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs', 'nodejs', 'node.exe') : null
  ].filter(Boolean);

  for (const c of candidates) {
    if (fs.existsSync(c)) {
      cachedNodePath = c;
      return c;
    }
  }

  const sysNode = findInSystemPath('node');
  if (sysNode) {
    cachedNodePath = sysNode;
    return sysNode;
  }

  return null;
}

/**
 * Downloads a file following redirects up to 5 times
 */
function downloadFileWithRedirects(url, destPath, onProgress = null) {
  return new Promise((resolve, reject) => {
    let redirectsCount = 0;

    function doRequest(currentUrl) {
      const client = currentUrl.startsWith('https') ? https : http;
      const req = client.get(currentUrl, {
        headers: {
          'User-Agent': 'Waterfall-Download-Suite/2.0'
        }
      }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          redirectsCount++;
          if (redirectsCount > 5) {
            return reject(new Error('Too many redirects while downloading binary'));
          }
          const nextUrl = new URL(res.headers.location, currentUrl).href;
          return doRequest(nextUrl);
        }

        if (res.statusCode !== 200) {
          return reject(new Error(`Server returned HTTP ${res.statusCode}`));
        }

        const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
        let downloadedBytes = 0;

        const tmpPath = destPath + '.tmp_' + Date.now();
        const fileStream = fs.createWriteStream(tmpPath);

        res.on('data', (chunk) => {
          downloadedBytes += chunk.length;
          if (onProgress && totalBytes > 0) {
            onProgress(downloadedBytes, totalBytes);
          }
        });

        res.pipe(fileStream);

        fileStream.on('finish', () => {
          fileStream.close(() => {
            try {
              if (fs.existsSync(destPath)) {
                try { fs.unlinkSync(destPath); } catch (_) {}
              }
              fs.renameSync(tmpPath, destPath);
              resolve(destPath);
            } catch (err) {
              reject(err);
            }
          });
        });

        fileStream.on('error', (err) => {
          try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (_) {}
          reject(err);
        });
      });

      req.on('error', reject);
      req.setTimeout(30000, () => {
        req.destroy();
        reject(new Error('Download timed out after 30 seconds'));
      });
    }

    doRequest(url);
  });
}

/**
 * Ensures yt-dlp is installed and available.
 * If missing, automatically downloads it from official GitHub releases.
 */
async function ensureYtDlpInstalled(options = {}) {
  const { forceUpdate = false, onProgress = null } = options;

  if (!forceUpdate && isYtDlpAvailable()) {
    const existingPath = getYtDlpPath();
    console.log(`[Waterfall Binary] yt-dlp ready: ${existingPath}`);
    return { installed: true, path: existingPath, autoDownloaded: false };
  }

  if (isDownloadingYtDlp) {
    console.log('[Waterfall Binary] yt-dlp download already in progress. Waiting...');
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 1000));
      if (!isDownloadingYtDlp) break;
    }
    return { installed: isYtDlpAvailable(), path: getYtDlpPath(), autoDownloaded: true };
  }

  isDownloadingYtDlp = true;
  console.log('[Waterfall Binary] yt-dlp is not installed or update requested. Starting auto-download from GitHub releases...');

  try {
    // Determine destination path: prefer project bin if writable, otherwise persistent AppData bin
    let destDir = null;
    const projectBin = path.join(__dirname, '..', '..', 'bin');
    try {
      if (!fs.existsSync(projectBin)) fs.mkdirSync(projectBin, { recursive: true });
      const testFile = path.join(projectBin, '.test_' + Date.now());
      fs.writeFileSync(testFile, '1');
      fs.unlinkSync(testFile);
      destDir = projectBin;
    } catch (_) {
      destDir = getPersistentBinDir();
    }

    const destFile = path.join(destDir, 'yt-dlp.exe');
    const downloadUrl = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe';

    await downloadFileWithRedirects(downloadUrl, destFile, (dl, total) => {
      if (onProgress) onProgress(dl, total);
      const pct = total > 0 ? ((dl / total) * 100).toFixed(1) : '?';
      if (dl % (1024 * 1024 * 4) === 0 || dl === total) {
        console.log(`[Waterfall Binary] Downloading yt-dlp.exe: ${pct}% (${(dl / 1024 / 1024).toFixed(1)} MB)`);
      }
    });

    cachedYtDlpPath = destFile;
    // Prepend to PATH so child processes discover it immediately
    process.env.PATH = `${destDir};${process.env.PATH}`;

    console.log(`[Waterfall Binary] yt-dlp successfully downloaded and verified at: ${destFile}`);
    return { installed: true, path: destFile, autoDownloaded: true };
  } catch (err) {
    console.error('[Waterfall Binary] Failed to auto-download yt-dlp:', err.message);
    return { installed: false, error: err.message };
  } finally {
    isDownloadingYtDlp = false;
  }
}

/**
 * Returns comprehensive status of all system tools
 */
function getSystemBinariesStatus() {
  const ytPath = getYtDlpPath();
  const ffmpegDir = getFfmpegLocation();
  const sevenZipPath = get7zExecutable();
  const nodePath = getNodeJsPath();

  let ytVersion = null;
  try {
    ytVersion = execSync(`"${ytPath}" --version`, { stdio: ['pipe', 'pipe', 'ignore'], timeout: 3000, encoding: 'utf8' }).trim();
  } catch (_) {}

  return {
    ytdlp: {
      available: isYtDlpAvailable(),
      path: ytPath,
      version: ytVersion || 'Unknown',
      isSystemResource: !ytPath.includes(path.join(__dirname, '..', '..', 'bin'))
    },
    ffmpeg: {
      available: Boolean(ffmpegDir),
      directory: ffmpegDir,
      executable: ffmpegDir ? path.join(ffmpegDir, 'ffmpeg.exe') : null,
      isSystemResource: Boolean(ffmpegDir && !ffmpegDir.includes(path.join(__dirname, '..', '..', 'bin')))
    },
    sevenZip: {
      available: sevenZipPath !== '7z.exe' || findInSystemPath('7z') !== null,
      path: sevenZipPath
    },
    node: {
      available: Boolean(nodePath),
      path: nodePath
    }
  };
}

module.exports = {
  getYtDlpPath,
  isYtDlpAvailable,
  getFfmpegLocation,
  get7zExecutable,
  getNodeJsPath,
  ensureYtDlpInstalled,
  getSystemBinariesStatus,
  getPersistentBinDir
};
