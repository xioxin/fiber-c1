import { app, BrowserWindow, ipcMain, screen } from 'electron'
import { fileURLToPath } from 'url'
import path from 'path'
import net from 'net'
import si from 'systeminformation'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const isDev = process.env.NODE_ENV === 'development'

// ---------------------------------------------------------------------------
// Named-pipe configuration for Cubestage / OpenstageAI platform
// ---------------------------------------------------------------------------
// Both platform variants expose a named pipe.  We try them in order and retry
// on failure so the app works with whichever one is installed.
const PIPE_NAMES = ['Cubestage_server_pipe', 'OpenstageAI_server_pipe']

function getPipePath(name) {
  return process.platform === 'win32'
    ? `\\\\.\\pipe\\${name}`
    : `/tmp/${name}`
}

// Application credentials used when sending requests to the platform.
// Register your own app with Cubestage / OpenstageAI to receive real values.
const APP_REQUEST_BASE = {
  id: 'inbuilt',
  app_id: 'fiber_c1_app',
  app_key: 'fiber_c1_key',
  app_secret: 'fiber_c1_secret',
  app_version: '0.0.0',
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

// Default grating parameters (used when the platform is unavailable)
let gratingParams = {
  deviation: 16.25578, // X0  – horizontal origin of the lenticular grid
  lineNumber: 19.6401, // Interval – pitch of one lenticular lens (subpixels)
  obliquity: 0.10516,  // Slope   – tangent of the lens-array tilt angle
}

// Display labels reported by the platform for connected C1 units
let c1LabelList = []

// Named-pipe client
let pipeClient = null
let pipeConnected = false
let pipeRetryIndex = 0

// Electron windows
let mainWindow = null
let viewerWindow = null

// ---------------------------------------------------------------------------
// Named-pipe helpers
// ---------------------------------------------------------------------------

function connectToPlatform() {
  const pipeName = PIPE_NAMES[pipeRetryIndex % PIPE_NAMES.length]
  const pipePath = getPipePath(pipeName)
  console.log('[pipe] Connecting to', pipePath)

  pipeClient = net.createConnection(pipePath)

  pipeClient.on('connect', () => {
    pipeConnected = true
    console.log('[pipe] Connected to', pipeName)
    // Request device configuration immediately, then fetch the C1 label list.
    // NOTE: 'getDeivice' is the exact string used by the platform protocol
    // (the misspelling is intentional and must be preserved for compatibility).
    sendToPlatform('getDeivice')
    setTimeout(() => sendToPlatform('getLabelList'), 1000)
  })

  pipeClient.on('data', (data) => {
    try {
      parsePipeData(data.toString())
    } catch (e) {
      console.error('[pipe] Parse error:', e)
    }
  })

  pipeClient.on('error', () => {
    pipeConnected = false
    pipeClient = null
    pipeRetryIndex++
    // Alternate between pipe names on each retry
    setTimeout(connectToPlatform, 3000)
  })

  pipeClient.on('close', () => {
    pipeConnected = false
    pipeClient = null
    setTimeout(connectToPlatform, 3000)
  })
}

function sendToPlatform(requestType) {
  if (!pipeClient || !pipeConnected) return
  const request = { ...APP_REQUEST_BASE, request_type: requestType }
  pipeClient.write(JSON.stringify(request))
}

/** Parse a JSON message from the platform pipe and act on it. */
function parsePipeData(respJson) {
  if (!respJson || respJson.length <= 2) return

  const response = JSON.parse(respJson)
  let requestType = ''
  let responseData = null

  // Compatible with new and old platform response formats:
  //   New: { request_type, response_data: { type, config } }
  //   Old: { type, config }
  if (response.request_type) {
    requestType = response.request_type
    responseData = response.response_data
    // NOTE: 'getDeivice' (misspelling) is the exact protocol token used by
    // both Cubestage and OpenstageAI — do not correct it.
    if (requestType === 'getDeivice') {
      requestType = responseData?.type
      responseData = responseData?.config
    }
  } else {
    requestType = response.type
    responseData = response.config
  }

  if (!requestType || !responseData) return
  console.log('[pipe] requestType:', requestType)

  if (requestType === 'getLabelList') {
    c1LabelList = Array.isArray(responseData) ? responseData : []
    console.log('[pipe] C1 label list:', c1LabelList)
    return
  }

  // 'getDeivice' (misspelling) and 'device' are both used by platform versions
  if (requestType === 'getDeivice' || requestType === 'device') {
    if (responseData.deviation !== undefined) {
      gratingParams = {
        deviation: responseData.deviation,
        lineNumber: responseData.lineNumber,
        obliquity: responseData.obliquity,
      }
      console.log('[pipe] Grating params updated:', gratingParams)
      broadcastGratingParams()
    }
  }
}

function broadcastGratingParams() {
  ;[mainWindow, viewerWindow].forEach((win) => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('grating-params', gratingParams)
    }
  })
}

// ---------------------------------------------------------------------------
// C1 display detection
// ---------------------------------------------------------------------------

/** Return the C1 display if one is currently connected, otherwise null. */
function findC1Display() {
  const all = screen.getAllDisplays()

  // Prefer the label list provided by the platform
  if (c1LabelList.length > 0) {
    const byLabel = all.find((d) => c1LabelList.includes(d.label))
    if (byLabel) return byLabel
  }

  // Fallback: C1 native resolution is 1440 × 2560 (portrait)
  const byResolution = all.find(
    (d) => d.size.width === 1440 && d.size.height === 2560,
  )
  if (byResolution) return byResolution

  // Fallback: any non-primary display when more than one is connected
  const primary = screen.getPrimaryDisplay()
  return all.find((d) => d.id !== primary.id) || null
}

function broadcastDisplayStatus(connected, displayId) {
  ;[mainWindow, viewerWindow].forEach((win) => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('display-status', { connected, displayId })
    }
  })
}

function onDisplayAdded(_event, display) {
  console.log('[screen] display-added:', display.id, display.label || '')
  // Give the OS a moment to settle before querying the display list
  setTimeout(() => {
    if (!viewerWindow) {
      const c1 = findC1Display()
      if (c1) createViewerWindow(c1)
    }
  }, 1000)
  broadcastDisplayStatus(true, display.id)
}

function onDisplayRemoved(_event, display) {
  console.log('[screen] display-removed:', display.id, display.label || '')
  if (viewerWindow && !viewerWindow.isDestroyed()) {
    viewerWindow.close()
    viewerWindow = null
  }
  broadcastDisplayStatus(false, display.id)
}

// ---------------------------------------------------------------------------
// Window creation
// ---------------------------------------------------------------------------

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 600,
    minHeight: 500,
    backgroundColor: '#05050f',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    },
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.setMenuBarVisibility(false)

  mainWindow.on('closed', () => {
    mainWindow = null
    if (viewerWindow && !viewerWindow.isDestroyed()) {
      viewerWindow.close()
    }
  })
}

/**
 * Create a borderless fullscreen window on the C1 display.
 * This window renders the lenticular-interlaced 3D content for the C1.
 */
function createViewerWindow(display) {
  if (viewerWindow && !viewerWindow.isDestroyed()) return

  const { x, y, width, height } = display.bounds
  console.log('[viewer] Creating viewer window at', x, y, width, height)

  viewerWindow = new BrowserWindow({
    x,
    y,
    width,
    height,
    fullscreen: true,
    frame: false,
    backgroundColor: '#05050f',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    },
  })

  if (isDev) {
    viewerWindow.loadURL('http://localhost:5173')
  } else {
    viewerWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  viewerWindow.setMenuBarVisibility(false)

  viewerWindow.on('closed', () => {
    viewerWindow = null
  })
}

// ---------------------------------------------------------------------------
// CPU polling
// ---------------------------------------------------------------------------

let cpuPollInterval = null

function startCpuPolling() {
  cpuPollInterval = setInterval(async () => {
    try {
      const load = await si.currentLoad()
      const cpuPercent = Math.round(load.currentLoad)
      ;[mainWindow, viewerWindow].forEach((win) => {
        if (win && !win.isDestroyed()) {
          win.webContents.send('cpu-load', cpuPercent)
        }
      })
    } catch {
      // ignore transient errors
    }
  }, 1000)
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

app.whenReady().then(() => {
  createMainWindow()
  startCpuPolling()
  connectToPlatform()

  // Listen for display connect / disconnect events
  screen.on('display-added', onDisplayAdded)
  screen.on('display-removed', onDisplayRemoved)

  // If a C1 is already connected at startup, open the viewer window immediately
  const c1 = findC1Display()
  if (c1) createViewerWindow(c1)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (cpuPollInterval) clearInterval(cpuPollInterval)
  if (pipeClient) pipeClient.destroy()
  if (process.platform !== 'darwin') app.quit()
})

// ---------------------------------------------------------------------------
// IPC handlers
// ---------------------------------------------------------------------------

// Allow renderer to request a one-off CPU snapshot
ipcMain.handle('get-cpu-load', async () => {
  const load = await si.currentLoad()
  return Math.round(load.currentLoad)
})

// Return the current grating parameters (from platform or defaults)
ipcMain.handle('get-grating-params', () => gratingParams)

// Return whether a C1 display is currently connected
ipcMain.handle('get-display-status', () => ({
  connected: findC1Display() !== null,
}))
