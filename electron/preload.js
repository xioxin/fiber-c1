import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  onSystemMetric: (callback) => {
    const handler = (_event, value) => callback(value)
    ipcRenderer.on('system-metric', handler)
    return () => ipcRenderer.removeListener('system-metric', handler)
  },
  getSystemMetric: async () => await ipcRenderer.invoke('get-system-metric'),

  // ---- Grating parameters (from Cubestage / OpenstageAI platform) ----
  getGratingParams: () => ipcRenderer.invoke('get-grating-params'),
  onGratingParams: (callback) => {
    const handler = (_event, params) => callback(params)
    ipcRenderer.on('grating-params', handler)
    return () => ipcRenderer.removeListener('grating-params', handler)
  },

  // ---- C1 display (grating screen) connection status ----
  getDisplayStatus: () => ipcRenderer.invoke('get-display-status'),
  onDisplayStatus: (callback) => {
    const handler = (_event, status) => callback(status)
    ipcRenderer.on('display-status', handler)
    return () => ipcRenderer.removeListener('display-status', handler)
  },

  // ---- Settings ----
  getSettings: () => ipcRenderer.invoke('get-settings'),
  setSettings: (partial) => ipcRenderer.invoke('set-settings', partial),
  onSettingsUpdated: (callback) => {
    const handler = (_event, settings) => callback(settings)
    ipcRenderer.on('settings-updated', handler)
    return () => ipcRenderer.removeListener('settings-updated', handler)
  },
  closeSettings: () => ipcRenderer.invoke('close-settings'),

  // ---- System accent color (for "follow system" theme) ----
  getSystemAccentColor: () => ipcRenderer.invoke('get-system-accent-color'),

  // ---- Extended system metrics ----
  getSystemMetric: () => ipcRenderer.invoke('get-system-metric'),
})
