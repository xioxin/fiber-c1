import { app, BrowserWindow, ipcMain } from 'electron'
import { fileURLToPath } from 'url'
import path from 'path'
import si from 'systeminformation'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const isDev = process.env.NODE_ENV === 'development'

let mainWindow

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 600,
    minHeight: 500,
    backgroundColor: '#05050f',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: true,
    },
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.setMenuBarVisibility(false)
}

// Poll CPU load every second and push to the renderer
let cpuPollInterval = null

function startCpuPolling() {
  cpuPollInterval = setInterval(async () => {
    try {
      const load = await si.currentLoad()
      const cpuPercent = Math.round(load.currentLoad)
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('cpu-load', cpuPercent)
      }
    } catch {
      // ignore transient errors
    }
  }, 1000)
}

app.whenReady().then(() => {
  createWindow()
  startCpuPolling()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (cpuPollInterval) clearInterval(cpuPollInterval)
  if (process.platform !== 'darwin') app.quit()
})

// Allow renderer to request a one-off CPU snapshot
ipcMain.handle('get-cpu-load', async () => {
  const load = await si.currentLoad()
  return Math.round(load.currentLoad)
})
