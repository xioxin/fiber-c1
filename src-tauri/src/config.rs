use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

// ---------------------------------------------------------------------------
// Config types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeConfig {
    pub mode: String,
    pub preset_index: u32,
    pub primary_color: String,
    pub secondary_color: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GratingParams {
    pub deviation: f64,
    pub line_number: f64,
    pub obliquity: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    pub language: String,
    pub display_info: String,
    pub theme: ThemeConfig,
    pub grating_params: GratingParams,
}

impl Default for ThemeConfig {
    fn default() -> Self {
        Self {
            mode: "preset".to_string(),
            preset_index: 0,
            primary_color: "#00e5ff".to_string(),
            secondary_color: "#b020ff".to_string(),
        }
    }
}

impl Default for GratingParams {
    fn default() -> Self {
        Self {
            deviation: 16.25578,
            line_number: 19.6401,
            obliquity: 0.10516,
        }
    }
}

impl Default for Config {
    fn default() -> Self {
        Self {
            language: "zh".to_string(),
            display_info: "cpu_usage".to_string(),
            theme: ThemeConfig::default(),
            grating_params: GratingParams::default(),
        }
    }
}

// ---------------------------------------------------------------------------
// Load / save helpers
// ---------------------------------------------------------------------------

pub fn config_path(app_data_dir: &PathBuf) -> PathBuf {
    app_data_dir.join("config.json")
}

pub fn load_config(app_data_dir: &PathBuf) -> Config {
    let path = config_path(app_data_dir);
    match fs::read_to_string(&path) {
        Ok(raw) => {
            let parsed: serde_json::Value = match serde_json::from_str(&raw) {
                Ok(v) => v,
                Err(_) => return Config::default(),
            };
            deep_merge_config(Config::default(), &parsed)
        }
        Err(_) => Config::default(),
    }
}

pub fn save_config(config: &Config, app_data_dir: &PathBuf) {
    let path = config_path(app_data_dir);
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    match serde_json::to_string_pretty(config) {
        Ok(json) => {
            let _ = fs::write(&path, json);
        }
        Err(e) => eprintln!("[config] Failed to serialize config: {}", e),
    }
}

/// Deep-merge a JSON patch into a Config, keeping defaults for missing keys.
pub fn deep_merge_config(mut base: Config, patch: &serde_json::Value) -> Config {
    let obj = match patch.as_object() {
        Some(o) => o,
        None => return base,
    };

    if let Some(v) = obj.get("language").and_then(|v| v.as_str()) {
        base.language = v.to_string();
    }
    if let Some(v) = obj.get("displayInfo").and_then(|v| v.as_str()) {
        base.display_info = v.to_string();
    }
    if let Some(t) = obj.get("theme").and_then(|v| v.as_object()) {
        if let Some(v) = t.get("mode").and_then(|v| v.as_str()) {
            base.theme.mode = v.to_string();
        }
        if let Some(v) = t.get("presetIndex").and_then(|v| v.as_u64()) {
            base.theme.preset_index = v as u32;
        }
        if let Some(v) = t.get("primaryColor").and_then(|v| v.as_str()) {
            base.theme.primary_color = v.to_string();
        }
        if let Some(v) = t.get("secondaryColor").and_then(|v| v.as_str()) {
            base.theme.secondary_color = v.to_string();
        }
    }
    if let Some(g) = obj.get("gratingParams").and_then(|v| v.as_object()) {
        if let Some(v) = g.get("deviation").and_then(|v| v.as_f64()) {
            base.grating_params.deviation = v;
        }
        if let Some(v) = g.get("lineNumber").and_then(|v| v.as_f64()) {
            base.grating_params.line_number = v;
        }
        if let Some(v) = g.get("obliquity").and_then(|v| v.as_f64()) {
            base.grating_params.obliquity = v;
        }
    }
    base
}

/// Apply a JSON patch object onto an existing Config (partial update).
pub fn apply_patch(base: Config, patch: &serde_json::Value) -> Config {
    deep_merge_config(base, patch)
}
