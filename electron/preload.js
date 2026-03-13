import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  // ---- CPU load ----
  onCpuLoad: (callback) => {
    const handler = (_event, value) => callback(value)
    ipcRenderer.on('cpu-load', handler)
    return () => ipcRenderer.removeListener('cpu-load', handler)
  },
  getCpuLoad: () => ipcRenderer.invoke('get-cpu-load'),

  // ---- Grating parameters (from Cubestage / OpenstageAI platform) ----
  // Returns a Promise<{ deviation, lineNumber, obliquity }> with the current
  // grating parameters, or the built-in defaults if the platform is offline.
  getGratingParams: () => ipcRenderer.invoke('get-grating-params'),

  // Subscribe to live grating-parameter updates pushed from the platform.
  // callback receives { deviation, lineNumber, obliquity }.
  // Returns a cleanup function to unsubscribe.
  onGratingParams: (callback) => {
    const handler = (_event, params) => callback(params)
    ipcRenderer.on('grating-params', handler)
    return () => ipcRenderer.removeListener('grating-params', handler)
  },

  // ---- C1 display (grating screen) connection status ----
  // Returns a Promise<{ connected: boolean }>.
  getDisplayStatus: () => ipcRenderer.invoke('get-display-status'),

  // Subscribe to C1 connect / disconnect events.
  // callback receives { connected: boolean, displayId: number }.
  // Returns a cleanup function to unsubscribe.
  onDisplayStatus: (callback) => {
    const handler = (_event, status) => callback(status)
    ipcRenderer.on('display-status', handler)
    return () => ipcRenderer.removeListener('display-status', handler)
  },
})
