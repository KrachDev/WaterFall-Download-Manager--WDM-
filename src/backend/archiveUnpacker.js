const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ARCHIVE_EXTENSIONS = new Set([
  '.zip', '.rar', '.7z', '.tar', '.gz', '.tgz', '.bz2', '.xz', '.iso'
]);

function isArchiveFile(filePath) {
  if (!filePath) return false;
  const ext = path.extname(filePath).toLowerCase();
  return ARCHIVE_EXTENSIONS.has(ext);
}

/**
 * Executes a command and captures stdout/stderr.
 */
function runProcess(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { cwd, windowsHide: true });
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', data => stdout += data.toString());
    proc.stderr.on('data', data => stderr += data.toString());

    proc.on('close', code => {
      if (code === 0) {
        resolve({ code, stdout });
      } else {
        reject(new Error(`Command ${cmd} exited with code ${code}: ${stderr || stdout}`));
      }
    });

    proc.on('error', err => reject(err));
  });
}

/**
 * Automatically unpacks an archive file.
 * Creates an extraction directory named after the archive (without extension).
 *
 * @param {string} archivePath - Absolute path to archive file.
 * @param {object} options - Options (e.g. outDir, deleteArchiveAfter)
 * @returns {Promise<{success: boolean, outDir: string, durationMs: number, error?: string}>}
 */
async function unpackArchive(archivePath, options = {}) {
  if (!fs.existsSync(archivePath)) {
    return { success: false, error: 'Archive file does not exist' };
  }

  const startTime = Date.now();
  const dir = path.dirname(archivePath);
  const ext = path.extname(archivePath);
  const baseName = path.basename(archivePath, ext);

  const outDir = options.outDir || path.join(dir, baseName);
  fs.mkdirSync(outDir, { recursive: true });

  const extLower = ext.toLowerCase();

  // Try 7z / NanaZip first (handles .rar, .7z, .zip, .tar, etc.)
  try {
    // 7z x -y -o"<outDir>" "<archivePath>"
    await runProcess('7z.exe', ['x', '-y', `-o${outDir}`, archivePath], dir);
    const durationMs = Date.now() - startTime;
    return { success: true, outDir, durationMs };
  } catch (err7z) {
    // Fallback 1: Windows built-in tar.exe (handles .zip, .tar, .gz)
    try {
      await runProcess('tar.exe', ['-xf', archivePath, '-C', outDir], dir);
      const durationMs = Date.now() - startTime;
      return { success: true, outDir, durationMs };
    } catch (errTar) {
      // Fallback 2: PowerShell Expand-Archive (for .zip only)
      if (extLower === '.zip') {
        try {
          const psScript = `Expand-Archive -LiteralPath '${archivePath.replace(/'/g, "''")}' -DestinationPath '${outDir.replace(/'/g, "''")}' -Force`;
          await runProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psScript], dir);
          const durationMs = Date.now() - startTime;
          return { success: true, outDir, durationMs };
        } catch (errPs) {
          return { success: false, error: `Unpack failed: ${errPs.message}` };
        }
      }
      return { success: false, error: `Extraction failed: ${err7z.message}` };
    }
  }
}

module.exports = {
  isArchiveFile,
  unpackArchive,
  ARCHIVE_EXTENSIONS
};
