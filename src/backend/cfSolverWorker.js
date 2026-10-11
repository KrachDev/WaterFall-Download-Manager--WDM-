const { app, BrowserWindow } = require('electron');

const targetUrl = process.argv[2];

if (!targetUrl) {
  process.exit(1);
}

app.whenReady().then(() => {
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  win.webContents.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');

  let resolved = false;
  const finish = (result) => {
    if (resolved) return;
    resolved = true;
    if (result) {
      process.stdout.write('__RESULT_JSON__' + JSON.stringify(result) + '__END_RESULT__\n');
    }
    app.quit();
  };

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
});
