import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  onCpuLoad: (callback) => {
    const handler = (_event, value) => callback(value)
    ipcRenderer.on('cpu-load', handler)
    // Return a cleanup function
    return () => ipcRenderer.removeListener('cpu-load', handler)
  },
  getCpuLoad: () => ipcRenderer.invoke('get-cpu-load'),
})
