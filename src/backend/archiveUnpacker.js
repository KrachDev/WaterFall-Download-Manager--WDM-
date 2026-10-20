const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { get7zExecutable } = require('./binaryResolver');

const ARCHIVE_EXTENSIONS = new Set([
  '.zip', '.rar', '.7z', '.tar', '.gz', '.tgz', '.bz2', '.xz', '.iso',
  '.z01', '.r00', '.001'
]);

function isArchiveFile(filePath) {
  if (!filePath || typeof filePath !== 'string') return false;
  const lower = filePath.toLowerCase();
  const ext = path.extname(lower);
  if (ARCHIVE_EXTENSIONS.has(ext)) return true;
  // Multipart formats: .part1.rar, .part01.rar, .7z.001, .zip.001, .part1
  if (/\.part\d+(\.rar)?$/i.test(lower)) return true;
  if (/\.7z\.\d+$/i.test(lower)) return true;
  if (/\.zip\.\d+$/i.test(lower)) return true;
  if (/\.r\d+$/i.test(lower)) return true;
  if (/\.z\d+$/i.test(lower)) return true;
  return false;
}

function isPasswordRequiredError(output) {
  if (!output || typeof output !== 'string') return false;
  return /Wrong password|Data Error in encrypted file|Can not open encrypted archive|Enter password/i.test(output);
}

/**
 * Executes a command with timeout and captures stdout/stderr.
 */
function runProcess(cmd, args, cwd, timeoutMs = 600000, onProgress = null) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let timer = null;

    const proc = spawn(cmd, args, { cwd, windowsHide: true });

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        try { proc.kill('SIGKILL'); } catch (_) {}
        reject(new Error(`Extraction process timed out after ${Math.round(timeoutMs / 1000)}s`));
      }, timeoutMs);
    }

    proc.stdout.on('data', data => {
      const chunk = data.toString();
      stdout += chunk;
      if (typeof onProgress === 'function') {
        const matches = chunk.match(/(\d+)\s*%/g);
        if (matches && matches.length > 0) {
          const last = matches[matches.length - 1];
          const pct = parseInt(last, 10);
          if (!isNaN(pct) && pct >= 0 && pct <= 100) {
            onProgress(pct);
          }
        }
      }
    });
    proc.stderr.on('data', data => stderr += data.toString());

    proc.on('close', code => {
      if (timer) clearTimeout(timer);
      const combined = stderr + '\n' + stdout;
      if (code === 0) {
        if (typeof onProgress === 'function') onProgress(100);
        resolve({ code, stdout, stderr });
      } else {
        const isPasswordErr = isPasswordRequiredError(combined);
        const err = new Error(`Extraction ${cmd} failed (code ${code}): ${stderr || stdout}`);
        err.code = code;
        err.isPasswordRequired = isPasswordErr;
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
      }
    });

    proc.on('error', err => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * Automatically unpacks an archive file with optional password and post-cleanup.
 *
 * @param {string} archivePath - Absolute path to archive file (or root part of multipart).
 * @param {object} options - Options:
 *   - outDir: target directory
 *   - password: string
 *   - deleteArchiveAfter: boolean
 *   - allPartPaths: string[] (if multipart)
 *   - onProgress: function (receives percent 0-100)
 * @returns {Promise<{success: boolean, outDir: string, durationMs: number, passwordRequired?: boolean, error?: string}>}
 */
async function unpackArchive(archivePath, options = {}) {
  if (!fs.existsSync(archivePath)) {
    return { success: false, error: 'Archive file does not exist on disk' };
  }

  const startTime = Date.now();
  const dir = path.dirname(archivePath);
  const ext = path.extname(archivePath);
  let baseName = path.basename(archivePath, ext);
  // Clean multipart suffixes from folder name (e.g. Movie.part1 -> Movie)
  baseName = baseName.replace(/\.part\d+$/i, '').replace(/\.7z$/i, '').replace(/\.zip$/i, '').trim() || 'Extracted';

  const outDir = options.outDir || path.join(dir, baseName);
  try {
    fs.mkdirSync(outDir, { recursive: true });
  } catch (e) {
    return { success: false, error: `Failed to create output directory: ${e.message}` };
  }

  const password = options.password ? String(options.password) : '';
  const extLower = ext.toLowerCase();

  // Try 7z / NanaZip first (handles .rar, .7z, .zip, .tar, .gz, multipart, etc.)
  try {
    const args = ['x', '-y', '-bsp1'];
    if (password) {
      args.push(`-p${password}`);
    } else {
      // Disables interactive password prompt so 7z will not hang waiting on stdin
      args.push('-p-');
    }
    args.push(`-o${outDir}`);
    args.push(archivePath);
    const sevenZipBin = get7zExecutable();
    await runProcess(sevenZipBin, args, dir, 600000, options.onProgress);
    const durationMs = Date.now() - startTime;

    if (options.deleteArchiveAfter) {
      cleanArchiveFiles(archivePath, options.allPartPaths);
    }

    return { success: true, outDir, durationMs };
  } catch (err7z) {
    if (err7z.isPasswordRequired) {
      return {
        success: false,
        passwordRequired: true,
        error: 'Archive is password-protected or password incorrect.'
      };
    }

    // Fallback 1: Windows built-in tar.exe (handles unencrypted .zip, .tar, .gz)
    if (!password) {
      try {
        await runProcess('tar.exe', ['-xf', archivePath, '-C', outDir], dir);
        const durationMs = Date.now() - startTime;
        if (options.deleteArchiveAfter) {
          cleanArchiveFiles(archivePath, options.allPartPaths);
        }
        return { success: true, outDir, durationMs };
      } catch (errTar) {
        // Fallback 2: PowerShell Expand-Archive (for .zip only)
        if (extLower === '.zip') {
          try {
            const psScript = `Expand-Archive -LiteralPath '${archivePath.replace(/'/g, "''")}' -DestinationPath '${outDir.replace(/'/g, "''")}' -Force`;
            await runProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psScript], dir);
            const durationMs = Date.now() - startTime;
            if (options.deleteArchiveAfter) {
              cleanArchiveFiles(archivePath, options.allPartPaths);
            }
            return { success: true, outDir, durationMs };
          } catch (errPs) {
            return { success: false, error: `Unpack failed: ${errPs.message}` };
          }
        }
      }
    }

    return {
      success: false,
      passwordRequired: Boolean(err7z.isPasswordRequired),
      error: `Extraction failed: ${err7z.message}`
    };
  }
}

function cleanArchiveFiles(rootPath, allPartPaths) {
  try {
    if (Array.isArray(allPartPaths) && allPartPaths.length > 0) {
      for (const p of allPartPaths) {
        if (fs.existsSync(p)) {
          try { fs.unlinkSync(p); } catch (_) {}
        }
      }
    } else if (fs.existsSync(rootPath)) {
      try { fs.unlinkSync(rootPath); } catch (_) {}
    }
  } catch (_) {}
}

module.exports = {
  isArchiveFile,
  unpackArchive,
  cleanArchiveFiles,
  isPasswordRequiredError,
  ARCHIVE_EXTENSIONS
};
