import { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, clipboard, shell, systemPreferences } from 'electron'
import { fileURLToPath } from 'url'
import path from 'path'
import net from 'net'
import si from 'systeminformation'
import { load as loadConfig, save as saveConfig } from './store.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const isDev = process.env.NODE_ENV === 'development'

// ---------------------------------------------------------------------------
// Named-pipe configuration for Cubestage / OpenstageAI platform
// ---------------------------------------------------------------------------
const PIPE_NAMES = ['Cubestage_server_pipe', 'OpenstageAI_server_pipe']

function getPipePath(name) {
  return process.platform === 'win32'
    ? `\\\\.\\pipe\\${name}`
    : `/tmp/${name}`
}

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

let config = null

// Default grating parameters (used when the platform is unavailable)
let gratingParams = {
  deviation: 16.25578,
  lineNumber: 19.6401,
  obliquity: 0.10516,
}

let c1LabelList = []
let pipeClient = null
let pipeConnected = false
let pipeRetryIndex = 0

let viewerWindow = null
let settingsWindow = null
let tray = null

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

function getConfig() {
  if (!config) {
    config = loadConfig()
    // Restore saved grating params as fallback for when the platform is offline
    if (config.gratingParams) {
      gratingParams = { ...gratingParams, ...config.gratingParams }
    }
  }
  return config
}

/** Deep-merge partial into target (partial values win). */
function deepMergePartial(target, partial) {
  const result = { ...target }
  for (const key of Object.keys(partial)) {
    if (
      partial[key] !== null &&
      typeof partial[key] === 'object' &&
      !Array.isArray(partial[key]) &&
      typeof target[key] === 'object' &&
      target[key] !== null
    ) {
      result[key] = deepMergePartial(target[key], partial[key])
    } else {
      result[key] = partial[key]
    }
  }
  return result
}

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

function parsePipeData(respJson) {
  if (!respJson || respJson.length <= 2) return

  const response = JSON.parse(respJson)
  let requestType = ''
  let responseData = null

  if (response.request_type) {
    requestType = response.request_type
    responseData = response.response_data
    // NOTE: 'getDeivice' (misspelling) is the exact protocol token
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

  if (requestType === 'getDeivice' || requestType === 'device') {
    if (responseData.deviation !== undefined) {
      gratingParams = {
        deviation: responseData.deviation,
        lineNumber: responseData.lineNumber,
        obliquity: responseData.obliquity,
      }
      console.log('[pipe] Grating params updated:', gratingParams)
      // Persist the latest grating params so they can be restored on next startup
      const cfg = getConfig()
      cfg.gratingParams = { ...gratingParams }
      saveConfig(cfg)
      broadcastGratingParams()
    }
  }
}

function broadcastGratingParams() {
  ;[viewerWindow].forEach((win) => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('grating-params', gratingParams)
    }
  })
}

// ---------------------------------------------------------------------------
// C1 display detection
// ---------------------------------------------------------------------------

function findC1Display() {
  const all = screen.getAllDisplays()

  if (c1LabelList.length > 0) {
    const byLabel = all.find((d) => c1LabelList.includes(d.label))
    if (byLabel) return byLabel
  }

  const byResolution = all.find(
    (d) => d.size.width === 1440 && d.size.height === 2560,
  )
  if (byResolution) return byResolution

  const primary = screen.getPrimaryDisplay()
  return all.find((d) => d.id !== primary.id) || null
}

function broadcastDisplayStatus(connected, displayId) {
  ;[viewerWindow].forEach((win) => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('display-status', { connected, displayId })
    }
  })
}

function onDisplayAdded(_event, display) {
  console.log('[screen] display-added:', display.id, display.label || '')
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
      nodeIntegration: true,
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

function openSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus()
    return
  }

  settingsWindow = new BrowserWindow({
    width: 520,
    height: 680,
    resizable: false,
    fullscreen: false,
    frame: true,
    backgroundColor: '#0d0d1a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: true,
    },
  })

  if (isDev) {
    settingsWindow.loadURL('http://localhost:5173/#settings')
  } else {
    settingsWindow.loadFile(path.join(__dirname, '../dist/index.html'), {
      hash: 'settings',
    })
  }

  settingsWindow.setMenuBarVisibility(false)

  settingsWindow.on('closed', () => {
    settingsWindow = null
  })
}

// ---------------------------------------------------------------------------
// System tray
// ---------------------------------------------------------------------------

function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'tray-icon.png')
  const icon = nativeImage.createFromPath(iconPath)
  tray = new Tray(icon.resize({ width: 16, height: 16 }))
  tray.setToolTip('Fiber C1')
  rebuildTrayMenu()
}

function rebuildTrayMenu() {
  if (!tray) return
  const cfg = getConfig()
  const lang = cfg.language || 'zh'

  const strings = {
    zh: { settings: '设置', copyCalib: '复制校准信息', github: 'GitHub', exit: '退出' },
    en: { settings: 'Settings', copyCalib: 'Copy Calibration Info', github: 'GitHub', exit: 'Exit' },
  }
  const s = strings[lang] || strings.zh

  const menu = Menu.buildFromTemplate([
    { label: s.settings, click: () => openSettingsWindow() },
    {
      label: s.copyCalib,
      click: () => clipboard.writeText(JSON.stringify(gratingParams, null, 2)),
    },
    { label: s.github, click: () => shell.openExternal('https://github.com/xioxin/fiber-c1') },
    { type: 'separator' },
    { label: s.exit, click: () => app.quit() },
  ])

  tray.setContextMenu(menu)
}

// ---------------------------------------------------------------------------
// System metrics polling
// ---------------------------------------------------------------------------

let cpuPollInterval = null

let latestMetrics = {
  cpuLoad: 0,
  cpuTemp: 0,
  memUsage: 0,
  gpuLoad: 0,
  vramUsage: 0,
  gpuTemp: 0,
}

async function pollSystemMetrics() {
  try {
    const cfg = getConfig()
    const info = cfg.displayInfo || 'cpu_usage'

    // Only query the API that is actually required for the current display type.
    // si.graphics() in particular is very expensive on Windows (WMI) — never
    // call it unless the user has selected a GPU metric.
    if (info === 'cpu_usage') {
      const load = await si.currentLoad()
      latestMetrics.cpuLoad = Math.round(load.currentLoad)
    } else if (info === 'cpu_temp') {
      const temp = await si.cpuTemperature()
      latestMetrics.cpuTemp = Math.round(temp.main || 0)
    } else if (info === 'mem_usage') {
      const mem = await si.mem()
      latestMetrics.memUsage = Math.round((mem.used / mem.total) * 100)
    } else {
      // gpu_usage | vram_usage | gpu_temp
      const graphics = await si.graphics()
      const gpu = graphics.controllers?.find(
        (c) => c.utilizationGpu !== undefined && c.utilizationGpu !== null,
      ) || graphics.controllers?.[0]

      if (gpu) {
        latestMetrics.gpuLoad = Math.round(gpu.utilizationGpu || 0)
        latestMetrics.gpuTemp = Math.round(gpu.temperatureGpu || 0)
        const vramTotal = gpu.vram || 0
        const vramUsed = gpu.memoryUsed || 0
        latestMetrics.vramUsage = vramTotal > 0 ? Math.round((vramUsed / vramTotal) * 100) : 0
      }
    }

    broadcastMetrics()
  } catch {
    // ignore transient errors
  }
}

const DISPLAY_INFO_VALUE_GETTERS = {
  cpu_usage:  () => latestMetrics.cpuLoad,
  cpu_temp:   () => latestMetrics.cpuTemp,
  mem_usage:  () => latestMetrics.memUsage,
  gpu_usage:  () => latestMetrics.gpuLoad,
  vram_usage: () => latestMetrics.vramUsage,
  gpu_temp:   () => latestMetrics.gpuTemp,
}

function broadcastMetrics() {
  const cfg = getConfig()
  const info = cfg.displayInfo || 'cpu_usage'
  const getMetric = DISPLAY_INFO_VALUE_GETTERS[info] ?? DISPLAY_INFO_VALUE_GETTERS.cpu_usage
  const value = getMetric()

  ;[viewerWindow].forEach((win) => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('cpu-load', value)
    }
  })
}

function startCpuPolling() {
  cpuPollInterval = setInterval(pollSystemMetrics, 1000)
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

app.whenReady().then(() => {
  getConfig()
  startCpuPolling()
  connectToPlatform()
  createTray()

  screen.on('display-added', onDisplayAdded)
  screen.on('display-removed', onDisplayRemoved)

  const c1 = findC1Display()
  if (c1) createViewerWindow(c1)

  app.on('activate', () => {})
})

app.on('window-all-closed', () => {
  if (cpuPollInterval) clearInterval(cpuPollInterval)
  if (pipeClient) pipeClient.destroy()
  if (process.platform !== 'darwin') app.quit()
})

// ---------------------------------------------------------------------------
// IPC handlers
// ---------------------------------------------------------------------------

ipcMain.handle('get-cpu-load', async () => {
  const load = await si.currentLoad()
  return Math.round(load.currentLoad)
})

ipcMain.handle('get-grating-params', () => gratingParams)

ipcMain.handle('get-display-status', () => ({
  connected: findC1Display() !== null,
}))

// ---- Settings ----

ipcMain.handle('get-settings', () => getConfig())

ipcMain.handle('set-settings', (_event, partial) => {
  const cfg = getConfig()
  const updated = deepMergePartial(cfg, partial)
  config = updated
  saveConfig(updated)
  rebuildTrayMenu()
  ;[viewerWindow, settingsWindow].forEach((win) => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('settings-updated', updated)
    }
  })
  return updated
})

ipcMain.handle('get-system-accent-color', () => {
  try {
    if (process.platform === 'win32' || process.platform === 'darwin') {
      const hex = systemPreferences.getAccentColor()
      return '#' + hex.slice(0, 6)
    }
  } catch {
    // not available on this platform
  }
  return null
})

ipcMain.handle('get-system-metrics', () => ({ ...latestMetrics }))

ipcMain.handle('close-settings', () => {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.close()
  }
})
