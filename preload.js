const { contextBridge, ipcRenderer } = require('electron');

const desktopApi = {
  isElectron: true,
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  openExternal: (url) => ipcRenderer.send('open-external', url),
  openFile: (filePath) => ipcRenderer.invoke('open-file', filePath),
  openFolder: (filePath) => ipcRenderer.invoke('open-folder', filePath),
  selectFolder: (defaultPath) => ipcRenderer.invoke('select-folder', defaultPath),
  focusWindow: () => ipcRenderer.send('window-focus'),
  forceTop: (keepPinned) => ipcRenderer.send('window-force-top', keepPinned),
  setAlwaysOnTop: (flag) => ipcRenderer.send('window-set-always-on-top', flag),
  getAppIcon: (filePath, ext) => ipcRenderer.invoke('get-app-icon', { filePath, ext }),
  updateTaskbarProgress: (data) => ipcRenderer.send('update-taskbar-progress', data),
  notifyTaskCompleted: (task) => ipcRenderer.send('notify-task-completed', task),
  notifyTaskFailed: (data) => ipcRenderer.send('notify-task-failed', data),
  notifyDownloadProgress: (data) => ipcRenderer.send('notify-download-progress', data),
  openConfirmWindow: (probeData) => ipcRenderer.send('open-confirm-window', probeData),
  closeConfirmWindow: () => ipcRenderer.send('close-confirm-window'),
  onConfirmData: (cb) => { ipcRenderer.on('set-confirm-data', (e, data) => cb(data)); },
  openProgressWindow: (task) => ipcRenderer.send('open-progress-window', task),
  closeProgressWindow: (taskId) => ipcRenderer.send('close-progress-window', taskId),
  onProgressData: (cb) => { ipcRenderer.on('set-progress-data', (e, data) => cb(data)); },
  onProgressTick: (cb) => { ipcRenderer.on('download-progress-tick', (e, data) => cb(data)); },
  onTaskCompleted: (cb) => { ipcRenderer.on('task-completed', (e, task) => cb(task)); }
};

contextBridge.exposeInMainWorld('waterfallDesktop', desktopApi);
contextBridge.exposeInMainWorld('hydraDesktop', desktopApi);
