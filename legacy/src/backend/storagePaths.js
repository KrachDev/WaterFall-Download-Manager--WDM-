/**
 * Waterfall Storage Path Resolver & Bulletproof State Persistence Engine
 * Ensures downloads.json, config.json, and other user data are ALWAYS stored
 * on a real, writable filesystem path and NEVER inside a read-only asar archive.
 * Includes atomic file writes, automatic .bak backups, and corruption recovery.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

let cachedStorageDir = null;

function isWritableDirectory(dir) {
  try {
    if (!fs.existsSync(dir)) return false;
    const testFile = path.join(dir, `.test_write_${process.pid}_${Date.now()}`);
    fs.writeFileSync(testFile, '1');
    fs.unlinkSync(testFile);
    return true;
  } catch (_) {
    return false;
  }
}

function getElectronUserData() {
  try {
    const electron = require('electron');
    const app = electron.app || (electron.remote && electron.remote.app);
    if (app && typeof app.getPath === 'function') {
      return app.getPath('userData');
    }
  } catch (_) {}
  return null;
}

function getGlobalAppDataDir() {
  const electronUserDir = getElectronUserData();
  if (electronUserDir && isWritableDirectory(electronUserDir)) {
    return electronUserDir;
  }
  try {
    const appData = process.env.APPDATA || (process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support')
      : path.join(os.homedir(), '.config'));
    const userDir = path.join(appData, 'Waterfall');
    if (!fs.existsSync(userDir)) {
      fs.mkdirSync(userDir, { recursive: true });
    }
    if (isWritableDirectory(userDir)) {
      return userDir;
    }
  } catch (_) {}
  return null;
}

function getStorageDir() {
  if (cachedStorageDir) return cachedStorageDir;

  // 1. Explicit override via environment variable (useful for isolated tests)
  if (process.env.WATERFALL_DATA_DIR && process.env.WATERFALL_DATA_DIR.trim().length > 0) {
    const dir = path.resolve(process.env.WATERFALL_DATA_DIR.trim());
    try {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      if (isWritableDirectory(dir)) {
        cachedStorageDir = dir;
        return dir;
      }
    } catch (_) {}
  }

  // 2. Global application data directory shared by ALL builds (Electron, packaged, dev, portable, CLI)
  // Ensures all builds share the exact same settings, download history, and resume states.
  const globalDir = getGlobalAppDataDir();
  if (globalDir) {
    cachedStorageDir = globalDir;
    return globalDir;
  }

  // 3. Fallback: workspace source root
  if (!__dirname.includes('app.asar')) {
    const sourceDir = path.resolve(__dirname, '..', '..');
    if (isWritableDirectory(sourceDir)) {
      cachedStorageDir = sourceDir;
      return sourceDir;
    }
  }

  // 4. Absolute last resort fallback: temp directory
  const fallbackDir = path.join(os.tmpdir(), 'WaterfallData');
  if (!fs.existsSync(fallbackDir)) fs.mkdirSync(fallbackDir, { recursive: true });
  cachedStorageDir = fallbackDir;
  return fallbackDir;
}

function getStorageFilePath(filename) {
  const dir = getStorageDir();
  const targetPath = path.join(dir, filename);

  // If target file doesn't exist yet (or is virtually empty/unseeded),
  // seamlessly migrate and seed it from existing workspace or exe directories.
  const targetExists = fs.existsSync(targetPath);
  let targetSize = 0;
  if (targetExists) {
    try { targetSize = fs.statSync(targetPath).size; } catch (_) {}
  }

  const shouldSeed = !targetExists || targetSize < 10;

  if (shouldSeed) {
    try {
      // Check 1: workspace source root (seed if valid populated file exists)
      const workspaceSeed = path.resolve(__dirname, '..', '..', filename);
      if (fs.existsSync(workspaceSeed) && workspaceSeed !== targetPath) {
        try {
          const wSize = fs.statSync(workspaceSeed).size;
          if (wSize > targetSize) {
            fs.copyFileSync(workspaceSeed, targetPath);
            const bakSeed = `${workspaceSeed}.bak`;
            if (fs.existsSync(bakSeed)) {
              try { fs.copyFileSync(bakSeed, `${targetPath}.bak`); } catch (_) {}
            }
            console.log(`[Waterfall Storage] Migrated ${filename} (${wSize} bytes) to global data: ${targetPath}`);
            return targetPath;
          }
        } catch (_) {}
      }

      // Check 2: exe directory
      const exeDir = path.dirname(process.execPath);
      const exeSeed = path.join(exeDir, filename);
      if (fs.existsSync(exeSeed) && exeSeed !== targetPath) {
        try {
          const eSize = fs.statSync(exeSeed).size;
          if (eSize > targetSize) {
            fs.copyFileSync(exeSeed, targetPath);
            return targetPath;
          }
        } catch (_) {}
      }
    } catch (_) {}
  }

  return targetPath;
}

function safeReadJson(filePath, fallback = null) {
  // 1. Try reading the primary file
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      if (content && content.trim().length > 0) {
        const parsed = JSON.parse(content);
        if (parsed !== null && parsed !== undefined) {
          return parsed;
        }
      }
    }
  } catch (err) {
    console.warn(`[Waterfall Storage] Corrupted or unreadable JSON in ${filePath}:`, err.message);
  }

  // 2. Try backup file (.bak)
  const bakPath = `${filePath}.bak`;
  try {
    if (fs.existsSync(bakPath)) {
      const content = fs.readFileSync(bakPath, 'utf-8');
      if (content && content.trim().length > 0) {
        const parsed = JSON.parse(content);
        if (parsed !== null && parsed !== undefined) {
          console.log(`[Waterfall Storage] Successfully recovered state from backup: ${bakPath}`);
          try { fs.copyFileSync(bakPath, filePath); } catch (_) {}
          return parsed;
        }
      }
    }
  } catch (_) {}

  // 3. Try tmp file (.tmp) in case process terminated mid-rename
  const tmpPath = `${filePath}.tmp`;
  try {
    if (fs.existsSync(tmpPath)) {
      const content = fs.readFileSync(tmpPath, 'utf-8');
      if (content && content.trim().length > 0) {
        const parsed = JSON.parse(content);
        if (parsed !== null && parsed !== undefined) {
          console.log(`[Waterfall Storage] Recovered state from tmp file: ${tmpPath}`);
          try { fs.copyFileSync(tmpPath, filePath); } catch (_) {}
          return parsed;
        }
      }
    }
  } catch (_) {}

  // 4. Try seed file in workspace if running outside source
  try {
    const filename = path.basename(filePath);
    const workspaceSeed = path.resolve(__dirname, '..', '..', filename);
    if (fs.existsSync(workspaceSeed) && workspaceSeed !== filePath) {
      const content = fs.readFileSync(workspaceSeed, 'utf-8');
      if (content && content.trim().length > 0) {
        const parsed = JSON.parse(content);
        if (parsed !== null && parsed !== undefined) {
          console.log(`[Waterfall Storage] Seeded state from workspace: ${workspaceSeed}`);
          try { fs.copyFileSync(workspaceSeed, filePath); } catch (_) {}
          return parsed;
        }
      }
    }
  } catch (_) {}

  return fallback;
}

function safeWriteJsonSync(filePath, data, options = {}) {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const jsonStr = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    if (!jsonStr || jsonStr.trim().length === 0) {
      console.warn(`[Waterfall Storage] Refusing to write empty payload to ${filePath}`);
      return false;
    }

    // Safety guard against accidental empty list wiping populated file:
    // If incoming data is an empty array '[]', but existing file on disk has non-empty array,
    // only overwrite if allowEmpty is explicitly true!
    if (!options.allowEmpty && (jsonStr.trim() === '[]' || jsonStr.trim() === '{}')) {
      if (fs.existsSync(filePath)) {
        try {
          const current = fs.readFileSync(filePath, 'utf-8').trim();
          if (current.length > 5 && current !== '[]' && current !== '{}') {
            console.warn(`[Waterfall Storage] Safety guard triggered: blocked attempt to overwrite populated ${filePath} with empty list.`);
            return false;
          }
        } catch (_) {}
      }
    }

    const tmpFile = `${filePath}.tmp`;
    const bakFile = `${filePath}.bak`;

    // 1. Write first to .tmp file
    fs.writeFileSync(tmpFile, jsonStr, 'utf-8');

    // 2. Keep a backup (.bak) of the existing valid file
    if (fs.existsSync(filePath)) {
      try {
        const st = fs.statSync(filePath);
        if (st.size > 2) {
          fs.copyFileSync(filePath, bakFile);
        }
      } catch (_) {}
    }

    // 3. Atomically replace target file (with retry loop for Windows file locks)
    let replaced = false;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        fs.renameSync(tmpFile, filePath);
        replaced = true;
        break;
      } catch (err) {
        if (attempt === 3) {
          try {
            fs.copyFileSync(tmpFile, filePath);
            try { fs.unlinkSync(tmpFile); } catch (_) {}
            replaced = true;
          } catch (_) {}
        }
      }
    }

    return replaced;
  } catch (err) {
    console.error(`[Waterfall Storage] Failed to write ${filePath}:`, err.message);
    return false;
  }
}

module.exports = {
  getStorageDir,
  getStorageFilePath,
  safeReadJson,
  safeWriteJsonSync
};
