const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dshDesktop', {
  platform: process.platform,
  versions: process.versions,
  onLog: (cb) => { ipcRenderer.on('dsh-log', (_e, msg) => cb(msg)); },
  onStatus: (cb) => { ipcRenderer.on('dsh-status', (_e, state) => cb(state)); },
  getStatus: () => ipcRenderer.invoke('dsh-get-status'),
  toggleLog: () => ipcRenderer.send('dsh-toggle-log'),
  deepseek: {
    getConfig: () => ipcRenderer.invoke('deepseek-config-get'),
    setConfig: (cfg) => ipcRenderer.invoke('deepseek-config-set', cfg),
    balance: (cfg) => ipcRenderer.invoke('deepseek-balance', cfg),
    chat: (cfg, messages) => ipcRenderer.send('deepseek-chat', { cfg, messages }),
    onChunk: (cb) => { ipcRenderer.on('deepseek-chunk', (_e, data) => cb(data)); },
    onError: (cb) => { ipcRenderer.on('deepseek-error', (_e, msg) => cb(msg)); }
  }
});
