const { app, BrowserWindow } = require('electron');
const path = require('path');

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: false } });
  const indexPath = path.join(__dirname, '..', 'src', 'frontend', 'index.html');
  await win.loadFile(indexPath);
  await new Promise(r => setTimeout(r, 1200));

  const res = await win.webContents.executeJavaScript(`
    (() => {
      try {
        window.appState.tasks = [
          {
            id: '1',
            name: 'Ubuntu-24.04-desktop-amd64.iso',
            status: 'downloading',
            totalBytes: 4500000000,
            downloadedBytes: 2500000000,
            speed: 15400000,
            eta: 130,
            hoster: 'Direct Web',
            addedAt: Date.now() - 3600000 * 2,
            packageName: 'Linux Distributions'
          }
        ];
        window.appState.activeFilter = 'all';
        window.appState.activeCategory = null;
        window.appState.searchQuery = '';
        renderDownloads();
        const tbody = document.getElementById('downloads-table-body');
        const empty = document.getElementById('empty-state');
        return {
          rowCount: tbody ? tbody.children.length : 0,
          rowHtml: tbody && tbody.firstElementChild ? tbody.firstElementChild.outerHTML : 'none',
          emptyDisplay: empty ? empty.style.display : 'none'
        };
      } catch (err) {
        return { error: err.message, stack: err.stack };
      }
    })()
  `);
  console.log('RENDER RESULT:', JSON.stringify(res, null, 2));
  app.quit();
});
