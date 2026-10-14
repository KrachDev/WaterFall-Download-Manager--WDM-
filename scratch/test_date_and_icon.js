const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    show: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: false
    }
  });

  const indexPath = path.join(__dirname, '..', 'src', 'frontend', 'index.html');
  await win.loadFile(indexPath);

  await new Promise(r => setTimeout(r, 1200));

  const now = Date.now();
  await win.webContents.executeJavaScript(`
    window.appState.tasks = [
      {
        id: '1',
        name: 'Ubuntu-24.04-desktop-amd64.iso',
        totalBytes: 4500000000,
        downloadedBytes: 2500000000,
        speed: 15400000,
        status: 'downloading',
        eta: 130,
        hoster: 'Direct Web',
        addedAt: ${now - 3600000 * 2},
        packageName: 'Linux Distributions'
      },
      {
        id: '2',
        name: 'Blender_4.2.0_Windows.msi',
        totalBytes: 350000000,
        downloadedBytes: 350000000,
        speed: 0,
        status: 'completed',
        eta: 0,
        hoster: 'Mirror 1',
        addedAt: ${now - 86400000},
        completedAt: ${now - 86400000 + 120000},
        savePath: 'C:\\\\Downloads\\\\Blender_4.2.0_Windows.msi'
      },
      {
        id: '3',
        name: 'Cyberpunk_2077_Patch_2.1.zip',
        totalBytes: 15000000000,
        downloadedBytes: 5000000000,
        speed: 0,
        status: 'paused',
        eta: 0,
        hoster: 'Steam CDN',
        addedAt: ${now - 86400000 * 3},
        packageName: 'Gaming Updates'
      },
      {
        id: '4',
        name: 'FLAC_Studio_Master_Album.part1.rar',
        totalBytes: 500000000,
        downloadedBytes: 500000000,
        speed: 0,
        status: 'completed',
        eta: 0,
        hoster: 'Direct Web',
        addedAt: ${now - 1800000},
        completedAt: ${now - 1200000},
        multipart: { groupKey: 'flac_album_pkg', partNumber: 1, baseName: 'FLAC Studio Master Album' }
      },
      {
        id: '5',
        name: 'FLAC_Studio_Master_Album.part2.rar',
        totalBytes: 500000000,
        downloadedBytes: 250000000,
        speed: 12000000,
        status: 'downloading',
        eta: 25,
        hoster: 'Direct Web',
        addedAt: ${now - 1800000},
        multipart: { groupKey: 'flac_album_pkg', partNumber: 2, baseName: 'FLAC Studio Master Album' }
      }
    ];

    window.appState.activeFilter = 'all';
    window.appState.hideFinished = false;
    window.dispatchEvent(new CustomEvent('state:change'));
  `);

  await new Promise(r => setTimeout(r, 800));

  const image = await win.capturePage();
  fs.writeFileSync(path.join(__dirname, 'date_and_icon_verified.png'), image.toPNG());
  console.log('Saved date_and_icon_verified.png');

  app.quit();
});
