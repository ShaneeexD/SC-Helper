const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlay', {
  getStatus: () => ipcRenderer.invoke('overlay:getStatus'),
  setClickThrough: (enabled) => ipcRenderer.invoke('overlay:setClickThrough', enabled),
  getClickThrough: () => ipcRenderer.invoke('overlay:getClickThrough'),
  quit: () => ipcRenderer.invoke('overlay:quit'),
  llmQuery: (question) => ipcRenderer.invoke('overlay:llmQuery', question),
  resizeToContent: (height) => ipcRenderer.invoke('overlay:resizeToContent', height),
  llmHealth: () => ipcRenderer.invoke('overlay:llmHealth'),
  onClickThroughChanged: (cb) => {
    const handler = (_e, payload) => cb && cb(payload);
    ipcRenderer.on('overlay:clickThroughChanged', handler);
    return () => ipcRenderer.removeListener('overlay:clickThroughChanged', handler);
  }
});
