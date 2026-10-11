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
  getAppIcon: (filePath, ext) => ipcRenderer.invoke('get-app-icon', { filePath, ext }),
  updateTaskbarProgress: (data) => ipcRenderer.send('update-taskbar-progress', data),
  notifyTaskCompleted: (task) => ipcRenderer.send('notify-task-completed', task),
  notifyTaskFailed: (data) => ipcRenderer.send('notify-task-failed', data),
  notifyDownloadProgress: (data) => ipcRenderer.send('notify-download-progress', data)
};

contextBridge.exposeInMainWorld('waterfallDesktop', desktopApi);
contextBridge.exposeInMainWorld('hydraDesktop', desktopApi);
