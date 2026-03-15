import { useState, useEffect, useCallback } from 'react'
import { PRESET_COLORS, t } from './i18n/index.js'
import './SettingsPanel.css'

const DISPLAY_INFO_TYPES = [
  'cpu_usage',
  // 'cpu_temp', // <-- todo: Both WMI and SystemInformation cannot be obtained
  'mem_usage',
  'gpu_usage',
  'vram_usage',
  'gpu_temp',
]

const DEFAULT_SETTINGS = {
  language: 'zh',
  displayInfo: 'cpu_usage',
  theme: {
    mode: 'preset',
    presetIndex: 0,
    primaryColor: '#00e5ff',
    secondaryColor: '#b020ff',
  },
}

export function SettingsPanel() {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  const [saving, setSaving] = useState(false)
  const isElectron = typeof window !== 'undefined' && !!window.electronAPI

  // Load settings on mount
  useEffect(() => {
    if (isElectron) {
      window.electronAPI.getSettings().then((s) => {
        if (s) setSettings(s)
      })
    }
  }, [isElectron])

  const lang = settings.language || 'zh'

  const updateSettings = useCallback(
    async (patch) => {
      const merged = deepMerge(settings, patch)
      setSettings(merged)
      if (isElectron) {
        setSaving(true)
        try {
          await window.electronAPI.setSettings(patch)
        } finally {
          setSaving(false)
        }
      }
    },
    [settings, isElectron],
  )

  const handleThemeModeChange = async (mode) => {
    if (mode === 'system' && isElectron) {
      const accent = await window.electronAPI.getSystemAccentColor()
      if (accent) {
        const secondary = darkenAndShift(accent)
        updateSettings({ theme: { mode, primaryColor: accent, secondaryColor: secondary } })
        return
      }
    }
    updateSettings({ theme: { mode } })
  }

  const handlePresetSelect = (index) => {
    const preset = PRESET_COLORS[index]
    updateSettings({
      theme: {
        mode: 'preset',
        presetIndex: index,
        primaryColor: preset.primary,
        secondaryColor: preset.secondary,
      },
    })
  }

  const handleClose = () => {
    if (isElectron) {
      window.electronAPI.closeSettings()
    }
  }

  const themeMode = settings.theme?.mode || 'preset'
  const primaryColor = settings.theme?.primaryColor || '#00e5ff'
  const secondaryColor = settings.theme?.secondaryColor || '#b020ff'

  return (
    <div className="sp-root">
      <div className="sp-header">
        <span className="sp-title">{t(lang, 'settings_title')}</span>
        <button className="sp-close-btn" onClick={handleClose} type="button">
          ✕
        </button>
      </div>

      <div className="sp-body">
        {/* Language section */}
        <section className="sp-section">
          <h3 className="sp-section-title">{t(lang, 'section_language')}</h3>
          <div className="sp-row">
            {['zh', 'en'].map((l) => (
              <button
                key={l}
                type="button"
                className={`sp-btn ${settings.language === l ? 'active' : ''}`}
                onClick={() => updateSettings({ language: l })}
              >
                {t(lang, `lang_${l}`)}
              </button>
            ))}
          </div>
        </section>

        {/* Theme section */}
        <section className="sp-section">
          <h3 className="sp-section-title">{t(lang, 'section_theme')}</h3>

          {/* Theme mode selector */}
          <div className="sp-row">
            {[
              // 'system', // <-- TODO
              'preset', 
              'custom'
            ].map((mode) => (
              <button
                key={mode}
                type="button"
                className={`sp-btn ${themeMode === mode ? 'active' : ''}`}
                onClick={() => handleThemeModeChange(mode)}
              >
                {t(lang, `theme_${mode}`)}
              </button>
            ))}
          </div>

          {/* Preset swatches */}
          {themeMode === 'preset' && (
            <div className="sp-swatches">
              {PRESET_COLORS.map((preset, i) => (
                <button
                  key={i}
                  type="button"
                  className={`sp-swatch ${settings.theme?.presetIndex === i ? 'selected' : ''}`}
                  style={{
                    background: `linear-gradient(135deg, ${preset.primary} 0%, ${preset.secondary} 100%)`,
                  }}
                  onClick={() => handlePresetSelect(i)}
                  aria-label={`Preset ${i + 1}`}
                />
              ))}
            </div>
          )}

          {/* Custom color pickers */}
          {themeMode === 'custom' && (
            <div className="sp-custom-colors">
              <div className="sp-color-row">
                <label className="sp-color-label">{t(lang, 'theme_primary')}</label>
                <input
                  type="color"
                  className="sp-color-input"
                  value={primaryColor}
                  onChange={(e) =>
                    updateSettings({ theme: { mode: 'custom', primaryColor: e.target.value } })
                  }
                />
                <span className="sp-color-hex">{primaryColor}</span>
              </div>
              <div className="sp-color-row">
                <label className="sp-color-label">{t(lang, 'theme_secondary')}</label>
                <input
                  type="color"
                  className="sp-color-input"
                  value={secondaryColor}
                  onChange={(e) =>
                    updateSettings({ theme: { mode: 'custom', secondaryColor: e.target.value } })
                  }
                />
                <span className="sp-color-hex">{secondaryColor}</span>
              </div>
            </div>
          )}

          {/* Color preview gradient */}
          <div
            className="sp-gradient-preview"
            style={{
              background: `linear-gradient(90deg, ${primaryColor} 0%, ${secondaryColor} 100%)`,
            }}
          />
        </section>

        {/* Display info section */}
        <section className="sp-section">
          <h3 className="sp-section-title">{t(lang, 'section_display_info')}</h3>
          <div className="sp-info-grid">
            {DISPLAY_INFO_TYPES.map((type) => {
              const isTemp = type === 'cpu_temp' || type === 'gpu_temp'
              const unit = isTemp ? t(lang, 'unit_celsius') : t(lang, 'unit_percent')
              return (
                <button
                  key={type}
                  type="button"
                  className={`sp-info-btn ${settings.displayInfo === type ? 'active' : ''}`}
                  onClick={() => updateSettings({ displayInfo: type })}
                >
                  <span className="sp-info-label">{t(lang, `info_${type}`)}</span>
                </button>
              )
            })}
          </div>
        </section>
      </div>

      {saving && <div className="sp-saving-indicator" />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deepMerge(base, patch) {
  const result = { ...base }
  for (const key of Object.keys(patch)) {
    if (
      patch[key] !== null &&
      typeof patch[key] === 'object' &&
      !Array.isArray(patch[key]) &&
      typeof base[key] === 'object' &&
      base[key] !== null
    ) {
      result[key] = deepMerge(base[key], patch[key])
    } else {
      result[key] = patch[key]
    }
  }
  return result
}

/**
 * Given a hex color, produce a complementary secondary color for a nice gradient.
 * Shifts hue by ~120° and slightly adjusts saturation/lightness.
 */
function darkenAndShift(hex) {
  const [r, g, b] = hexToRgb(hex)
  const [h, s, l] = rgbToHsl(r, g, b)
  const h2 = (h + 200) % 360
  const s2 = Math.min(1, s * 1.1)
  const l2 = Math.max(0.2, Math.min(0.6, l * 0.85))
  const [r2, g2, b2] = hslToRgb(h2, s2, l2)
  return rgbToHex(r2, g2, b2)
}

function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')
}

function rgbToHsl(r, g, b) {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  switch (max) {
    case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break
    case g: h = ((b - r) / d + 2) / 6; break
    case b: h = ((r - g) / d + 4) / 6; break
  }
  return [h * 360, s, l]
}

function hslToRgb(h, s, l) {
  h /= 360
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const hue2rgb = (t) => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  return [hue2rgb(h + 1 / 3) * 255, hue2rgb(h) * 255, hue2rgb(h - 1 / 3) * 255]
}
