const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron');

// Expose a safe API to the renderer process (React)
// This is the ONLY way the UI can talk to the main process
contextBridge.exposeInMainWorld('sysmonApi', {
  // Database queries
  db: {
    query: (sql: string, params?: unknown[]) => ipcRenderer.invoke('db:query', sql, params),
    execute: (sql: string, params?: unknown[]) => ipcRenderer.invoke('db:execute', sql, params),
    executeMany: (statements: { sql: string; params?: unknown[] }[]) =>
      ipcRenderer.invoke('db:executeMany', statements),
    hasData: () => ipcRenderer.invoke('db:hasData'),
    clearAll: () => ipcRenderer.invoke('db:clearAll'),
    openFile: (filePath: string) => ipcRenderer.invoke('db:openFile', filePath),
    getPath: () => ipcRenderer.invoke('db:getPath'),
  },

  // File dialogs
  dialog: {
    openXmlFiles: () => ipcRenderer.invoke('dialog:openXmlFiles'),
    openDatabase: () => ipcRenderer.invoke('dialog:openDatabase'),
  },

  // Import
  import: {
    xmlFiles: (filePaths: string[]) => ipcRenderer.invoke('import:xmlFiles', filePaths),
    onProgress: (callback: (progress: any) => void) => {
      ipcRenderer.on('import:progress', (_event, progress) => callback(progress));
    },
    removeProgressListener: () => {
      ipcRenderer.removeAllListeners('import:progress');
    },
  },

  // Settings (T&C flags etc.)
  settings: {
    get: (key: string) => ipcRenderer.invoke('settings:get', key),
    set: (key: string, value: string) => ipcRenderer.invoke('settings:set', key, value),
  },

  // GeoIP enrichment
  geoip: {
    getKey: () => ipcRenderer.invoke('geoip:getKey'),
    setKey: (key: string) => ipcRenderer.invoke('geoip:setKey', key),
    getProvider: () => ipcRenderer.invoke('geoip:getProvider'),
    setProvider: (provider: string) => ipcRenderer.invoke('geoip:setProvider', provider),
    resolve: (provider: string, apiKey: string) => ipcRenderer.invoke('geoip:resolve', provider, apiKey),
    onProgress: (callback: (progress: any) => void) => {
      ipcRenderer.on('geoip:progress', (_event, progress) => callback(progress));
    },
    removeProgressListener: () => {
      ipcRenderer.removeAllListeners('geoip:progress');
    },
  },

  // VirusTotal
  vt: {
    getKey: () => ipcRenderer.invoke('vt:getKey'),
    setKey: (key: string) => ipcRenderer.invoke('vt:setKey', key),
    lookup: (apiKey: string, hash: string) => ipcRenderer.invoke('vt:lookup', apiKey, hash),
    lookupIp: (apiKey: string, ip: string) => ipcRenderer.invoke('vt:lookupIp', apiKey, ip),
  },

  // Shell utilities
  shell: {
    openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  },

  // Menu events from main process
  menu: {
    on: (channel: string, callback: () => void) => {
      ipcRenderer.on(`menu:${channel}`, () => callback());
    },
    removeAll: (channel: string) => {
      ipcRenderer.removeAllListeners(`menu:${channel}`);
    },
  },
});
