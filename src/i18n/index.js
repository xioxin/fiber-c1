// ---------------------------------------------------------------------------
// Internationalization (i18n) – Chinese (zh) and English (en)
// ---------------------------------------------------------------------------

export const LANGUAGES = ['zh', 'en']

export const STRINGS = {
  zh: {

    noGratingParamsTips: '请启动 OpenstageAI 主程序以获取光栅参数',

    // Tray menu
    tray_settings: '设置',
    tray_copy_calibration: '复制校准信息',
    tray_github: 'GitHub',
    tray_exit: '退出',

    // Settings panel title
    settings_title: '设置',
    settings_close: '关闭',

    // Language section
    section_language: '语言',
    lang_zh: '中文',
    lang_en: 'English',
    lang_auto: '自动',

    // Theme section
    section_theme: '主题色',
    theme_system: '跟随系统',
    theme_preset: '预设色卡',
    theme_custom: '自定义',
    theme_primary: '主要色',
    theme_secondary: '次要色',

    // Display info section
    section_display_info: '展示信息',
    info_cpu_usage: 'CPU 占用率',
    info_cpu_temp: 'CPU 温度',
    info_mem_usage: '内存占用率',
    info_gpu_usage: 'GPU 占用率',
    info_vram_usage: '显存占用率',
    info_gpu_temp: '显卡温度',

    // Units
    unit_percent: '%',
    unit_celsius: '°C',
  },

  en: {
    noGratingParamsTips: 'Please launch the main Cubestage application to obtain grating parameters',
    // Tray menu
    tray_settings: 'Settings',
    tray_copy_calibration: 'Copy Calibration Info',
    tray_github: 'GitHub',
    tray_exit: 'Exit',

    // Settings panel title
    settings_title: 'Settings',
    settings_close: 'Close',

    // Language section
    section_language: 'Language',
    lang_zh: '中文',
    lang_en: 'English',
    lang_auto: 'Auto',

    // Theme section
    section_theme: 'Theme Color',
    theme_system: 'Follow System',
    theme_preset: 'Preset Swatches',
    theme_custom: 'Custom',
    theme_primary: 'Primary Color',
    theme_secondary: 'Secondary Color',

    // Display info section
    section_display_info: 'Display Info',
    info_cpu_usage: 'CPU Usage',
    info_cpu_temp: 'CPU Temperature',
    info_mem_usage: 'Memory Usage',
    info_gpu_usage: 'GPU Usage',
    info_vram_usage: 'VRAM Usage',
    info_gpu_temp: 'GPU Temperature',

    // Units
    unit_percent: '%',
    unit_celsius: '°C',
  },
}

/** Resolve a translation key for the given language. Falls back to the key itself. */
export function t(lang, key) {
  const dict = STRINGS[lang] || STRINGS.en
  return dict[key] ?? STRINGS.zh[key] ?? key
}

/** Return the unit string for a given displayInfo type. */
export function getUnit(lang, displayInfo) {
  const dict = STRINGS[lang] || STRINGS.en
  const isTemp = displayInfo === 'cpu_temp' || displayInfo === 'gpu_temp'
  return isTemp ? dict.unit_celsius : dict.unit_percent
}

/** Preset gradient color pairs [primaryColor, secondaryColor]. */
export const PRESET_COLORS = [
  { primary: '#00e5ff', secondary: '#b020ff' }, // Cyan → Purple (default)
  { primary: '#ff6b6b', secondary: '#ffd93d' }, // Red → Yellow
  { primary: '#6bcb77', secondary: '#4d96ff' }, // Green → Blue
  { primary: '#ff9ff3', secondary: '#54a0ff' }, // Pink → Sky blue
  { primary: '#ffeaa7', secondary: '#fd79a8' }, // Gold → Rose
  { primary: '#00b894', secondary: '#00cec9' }, // Teal → Cyan
  { primary: '#a29bfe', secondary: '#fd79a8' }, // Lavender → Pink
  { primary: '#fdcb6e', secondary: '#e17055' }, // Peach → Coral
]
