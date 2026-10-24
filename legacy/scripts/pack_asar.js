const path = require('path');
const fs = require('fs');
const { packager } = require('@electron/packager');

async function packAsarOnly() {
  const rootDir = path.resolve(__dirname, '..');
  const distDir = path.join(rootDir, 'dist');
  const targetAppDir = path.join(distDir, 'Waterfall-win32-x64');

  console.log('[PackAsar] Updating app.asar with packager...');
  await packager({
    dir: rootDir,
    name: 'Waterfall',
    platform: 'win32',
    arch: 'x64',
    out: distDir,
    overwrite: true,
    electronVersion: '44.7.0',
    icon: path.join(rootDir, 'assets', 'icon.ico'),
    asar: true,
    prune: true,
    ignore: (filePath) => {
      if (!filePath) return false;
      const normalized = filePath.replace(/\\/g, '/');
      const ignoredFolders = [
        '/dist', '/downloads', '/temp', '/bin', '/scratch',
        '/.git', '/.github', '/scripts', '/target', '/src-tauri', '/Publish'
      ];
      for (const ig of ignoredFolders) {
        if (normalized === ig || normalized.startsWith(ig + '/')) return true;
      }
      if (/\.(log|bak|tmp|md)$/i.test(normalized) && !normalized.includes('LICENSE')) return true;
      if (/^\/test-.*\.js$/i.test(normalized)) return true;
      if (normalized === '/Hydra.exe') return true;
      return false;
    }
  });

  const srcAsar = path.join(targetAppDir, 'resources', 'app.asar');
  const destAsar = 'C:\\Waterfall\\resources\\app.asar';
  if (fs.existsSync(srcAsar)) {
    fs.copyFileSync(srcAsar, destAsar);
    console.log('[PackAsar] Copied fresh app.asar to', destAsar);
  }
}

packAsarOnly().catch(console.error);
