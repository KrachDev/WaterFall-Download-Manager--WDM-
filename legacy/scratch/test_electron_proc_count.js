const { app, BrowserWindow } = require('electron');
const { execSync } = require('child_process');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('in-process-gpu');

app.on('ready', () => {
  const win = new BrowserWindow({ width: 400, height: 300, show: false });
  win.loadURL('about:blank');
  win.webContents.once('did-finish-load', () => {
    try {
      const output = execSync('tasklist /FI "IMAGENAME eq electron.exe" /FO TABLE', { encoding: 'utf8' });
      console.log('--- ELECTRON PROCESS LIST ---');
      console.log(output);
    } catch (e) {
      console.error(e);
    }
    app.quit();
  });
});
