/**
 * Tauri API adapter.
 *
 * Provides the same interface that the rest of the frontend used to access
 * through `window.electronAPI`, now backed by Tauri's `invoke` / `listen`.
 */

import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'

// ---------------------------------------------------------------------------
// Runtime detection
// ---------------------------------------------------------------------------

export const isTauri =
  typeof window !== 'undefined' &&
  typeof window.__TAURI_INTERNALS__ !== 'undefined'

/**
 * Returns the label of the current Tauri webview window, or null when running
 * outside of Tauri (e.g. plain browser preview).
 */
export function getCurrentWindowLabel() {
  if (!isTauri) return null
  try {
    return getCurrentWebviewWindow().label
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Listener helper
// Wraps `listen()` (which returns a Promise<UnlistenFn>) so that callers can
// treat the returned cleanup function as synchronous — matching the Electron
// preload API surface.
// ---------------------------------------------------------------------------

function createListener(eventName, callback) {
  let unlisten = null
  listen(eventName, (event) => callback(event.payload)).then((u) => {
    unlisten = u
  })
  return () => {
    if (unlisten) unlisten()
  }
}

// ---------------------------------------------------------------------------
// Exported API object (same shape as window.electronAPI)
// ---------------------------------------------------------------------------

export const api = {
  // ---- CPU load ----
  getCpuLoad: () => invoke('get_cpu_load'),
  onCpuLoad: (callback) => createListener('cpu-load', callback),

  // ---- Grating parameters ----
  getGratingParams: () => invoke('get_grating_params'),
  onGratingParams: (callback) => createListener('grating-params', callback),

  // ---- Display status ----
  getDisplayStatus: () => invoke('get_display_status'),
  onDisplayStatus: (callback) => createListener('display-status', callback),

  // ---- Settings ----
  getSettings: () => invoke('get_settings'),
  setSettings: (partial) => invoke('set_settings', { partial }),
  onSettingsUpdated: (callback) => createListener('settings-updated', callback),
  closeSettings: () => invoke('close_settings'),

  // ---- System ----
  getSystemAccentColor: () => invoke('get_system_accent_color'),
  getSystemMetrics: () => invoke('get_system_metrics'),
}
