import { app } from 'electron'
import fs from 'fs'
import path from 'path'

// ---------------------------------------------------------------------------
// Persistent JSON config store
// Stores settings in <userData>/config.json so they survive app restarts.
// ---------------------------------------------------------------------------

const CONFIG_FILE = path.join(app.getPath('userData'), 'config.json')
console.log('[store] Config file path:', CONFIG_FILE)

const DEFAULTS = {
  language: 'auto',                // 'auto' | 'zh' | 'en'
  displayInfo: 'cpu_usage',      // 'cpu_usage'|'cpu_temp'|'mem_usage'|'gpu_usage'|'vram_usage'|'gpu_temp'
  theme: {
    mode: 'preset',              // 'system' | 'preset' | 'custom'
    presetIndex: 0,
    primaryColor: '#00e5ff',
    secondaryColor: '#b020ff',
  },
  gratingParams: {
    deviation: null,
    lineNumber: null,
    obliquity: null,
  },
}

let _cache = null

/** Load config from disk (or use defaults if file doesn't exist / is corrupt). */
function load() {
  if (_cache) return _cache
  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf8')
    _cache = deepMerge(DEFAULTS, JSON.parse(raw))
  } catch {
    _cache = structuredClone(DEFAULTS)
  }
  return _cache
}

/** Save config to disk. */
function save(config) {
  _cache = config
  try {
    fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true })
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8')
  } catch (e) {
    console.error('[store] Failed to save config:', e)
  }
}

/** Deep-merge source into target (non-destructively – target values win). */
function deepMerge(defaults, source) {
  const result = structuredClone(defaults)
  for (const key of Object.keys(source)) {
    if (
      key in result &&
      typeof result[key] === 'object' &&
      result[key] !== null &&
      !Array.isArray(result[key])
    ) {
      result[key] = deepMerge(result[key], source[key])
    } else {
      result[key] = source[key]
    }
  }
  return result
}

export { load, save, DEFAULTS }
