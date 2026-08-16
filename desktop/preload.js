const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dshDesktop', {
  platform: process.platform,
  versions: process.versions,
  onLog: (cb) => { ipcRenderer.on('dsh-log', (_e, msg) => cb(msg)); },
  onStatus: (cb) => { ipcRenderer.on('dsh-status', (_e, state) => cb(state)); },
  getStatus: () => ipcRenderer.invoke('dsh-get-status'),
  toggleLog: () => ipcRenderer.send('dsh-toggle-log')
});
