const path = require('path');
const { spawn } = require('child_process');

/**
 * Headless Cloudflare / Anti-Bot Resolver for Electron & Node.
 */
class CfBrowserSolver {
  constructor() {
    this.electronPath = null;
    this.findElectronPath();
  }

  findElectronPath() {
    try {
      const electronModule = require('electron');
      if (typeof electronModule === 'string') {
        this.electronPath = electronModule;
      }
    } catch (_) {}
  }

  async resolveInRunningElectron(targetUrl) {
    const { BrowserWindow } = require('electron');
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
            sandbox: true
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
  }

  async resolveStandalone(targetUrl) {
    return new Promise((resolve) => {
      const solverScript = path.join(__dirname, 'cfSolverWorker.js');
      const child = spawn(process.execPath, [
        path.join(__dirname, '..', '..', 'node_modules', 'electron', 'cli.js'),
        solverScript,
        targetUrl
      ], {
        windowsHide: true,
        env: { ...process.env, ELECTRON_ENABLE_LOGGING: '0' }
      });

      let stdout = '';
      child.stdout.on('data', (d) => { stdout += d.toString(); });
      child.on('close', () => {
        try {
          const match = stdout.match(/__RESULT_JSON__([\s\S]*?)__END_RESULT__/);
          if (match && match[1]) {
            return resolve(JSON.parse(match[1].trim()));
          }
        } catch (_) {}
        resolve(null);
      });
      child.on('error', () => resolve(null));

      setTimeout(() => {
        try { child.kill(); } catch (_) {}
        resolve(null);
      }, 16000);
    });
  }

  async solve(targetUrl) {
    if (process.versions.electron || global.electronBrowserSolver) {
      if (global.electronBrowserSolver) {
        return await global.electronBrowserSolver(targetUrl);
      }
      return await this.resolveInRunningElectron(targetUrl);
    }

    // Otherwise use standalone Electron solver worker
    return await this.resolveStandalone(targetUrl);
  }
}

const cfBrowserSolver = new CfBrowserSolver();
module.exports = cfBrowserSolver;
