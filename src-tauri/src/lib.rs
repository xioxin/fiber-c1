mod config;
mod metrics;
mod pipe;

use config::{apply_patch, load_config, save_config, Config, GratingParams};
use metrics::{get_gpu_metrics_via_nvidia_smi, MetricsCollector, SystemMetrics};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, State,
};

// ---------------------------------------------------------------------------
// Shared application state
// ---------------------------------------------------------------------------

pub struct AppState {
    pub config: Mutex<Config>,
    pub grating_params: Arc<Mutex<GratingParams>>,
    pub latest_metrics: Mutex<SystemMetrics>,
    pub c1_label_list: Arc<Mutex<Vec<String>>>,
    pub app_data_dir: PathBuf,
    /// Whether nvidia-smi produced valid output on the last attempt.
    pub nvidia_smi_ok: Mutex<Option<bool>>,
}

// ---------------------------------------------------------------------------
// IPC command return types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayStatus {
    pub connected: bool,
}

// ---------------------------------------------------------------------------
// Helper: open a URL with the default browser / application
// ---------------------------------------------------------------------------

fn open_url(url: &str) {
    #[cfg(target_os = "windows")]
    let _ = std::process::Command::new("cmd")
        .args(["/c", "start", "", url])
        .spawn();
    #[cfg(target_os = "macos")]
    let _ = std::process::Command::new("open").arg(url).spawn();
    #[cfg(target_os = "linux")]
    let _ = std::process::Command::new("xdg-open").arg(url).spawn();
}

// ---------------------------------------------------------------------------
// Helper: create / focus the settings window
// ---------------------------------------------------------------------------

fn open_settings_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("settings") {
        let _ = window.show();
        let _ = window.set_focus();
        return;
    }

    let url = {
        #[cfg(debug_assertions)]
        {
            tauri::WebviewUrl::External(
                "http://localhost:5173/#settings".parse().expect("valid url"),
            )
        }
        #[cfg(not(debug_assertions))]
        {
            tauri::WebviewUrl::App("index.html".into())
        }
    };

    match tauri::webview::WebviewWindowBuilder::new(app, "settings", url)
        .title("Fiber C1 – Settings")
        .inner_size(520.0, 680.0)
        .resizable(false)
        .decorations(true)
        .build()
    {
        Ok(win) => {
            #[cfg(not(debug_assertions))]
            {
                // Navigate to the settings hash after the page has loaded
                let _ = win.eval("window.location.hash = 'settings'");
            }
            let _ = win.show();
        }
        Err(e) => eprintln!("[settings] Failed to open settings window: {}", e),
    }
}

// ---------------------------------------------------------------------------
// Helper: find the C1 lenticular display among available monitors
// ---------------------------------------------------------------------------

/// Find the C1 lenticular display among available monitors.
/// Uses `AppHandle` directly since `available_monitors()` is an inherent
/// method on `AppHandle`, not part of the `Manager` trait.
fn find_c1_monitor(app: &AppHandle) -> Option<tauri::Monitor> {
    let monitors = app.available_monitors().ok()?;
    let c1_labels = app
        .try_state::<AppState>()
        .map(|s| s.c1_label_list.lock().unwrap().clone())
        .unwrap_or_default();

    // 1. Match by label
    if !c1_labels.is_empty() {
        let by_label = monitors.iter().find(|m| {
            m.name()
                .map(|n| c1_labels.contains(n))
                .unwrap_or(false)
        });
        if let Some(m) = by_label {
            return Some(m.clone());
        }
    }

    // 2. Match by 1440×2560 resolution
    let by_res = monitors
        .iter()
        .find(|m| m.size().width == 1440 && m.size().height == 2560);
    if let Some(m) = by_res {
        return Some(m.clone());
    }

    // 3. Fall back to any non-primary display
    let primary = app.primary_monitor().ok()??;
    let non_primary = monitors
        .iter()
        .find(|m: &&tauri::Monitor| m.position() != primary.position());
    non_primary.cloned()
}

// ---------------------------------------------------------------------------
// Helper: build / rebuild the tray context menu
// ---------------------------------------------------------------------------

fn build_tray_menu(
    app: &AppHandle,
    lang: &str,
) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    let s = if lang == "zh" {
        ("设置", "复制校准信息", "GitHub", "退出")
    } else {
        ("Settings", "Copy Calibration Info", "GitHub", "Exit")
    };

    MenuBuilder::new(app)
        .item(&MenuItemBuilder::with_id("settings", s.0).build(app)?)
        .item(&MenuItemBuilder::with_id("copy_calib", s.1).build(app)?)
        .item(&MenuItemBuilder::with_id("github", s.2).build(app)?)
        .item(&PredefinedMenuItem::separator(app)?)
        .item(&MenuItemBuilder::with_id("exit", s.3).build(app)?)
        .build()
}

// ---------------------------------------------------------------------------
// System metrics polling (runs every 1 s in a background task)
// ---------------------------------------------------------------------------

async fn poll_metrics(app: &AppHandle, collector: &mut MetricsCollector) {
    let state: State<AppState> = app.state();
    let display_info = state.config.lock().unwrap().display_info.clone();

    match display_info.as_str() {
        "cpu_usage" => {
            let v = collector.refresh_cpu_load();
            state.latest_metrics.lock().unwrap().cpu_load = v;
        }
        "cpu_temp" => {
            let v = collector.get_cpu_temp();
            state.latest_metrics.lock().unwrap().cpu_temp = v;
        }
        "mem_usage" => {
            let v = collector.refresh_mem_usage();
            state.latest_metrics.lock().unwrap().mem_usage = v;
        }
        _ => {
            // gpu_usage | vram_usage | gpu_temp
            let ok = state.nvidia_smi_ok.lock().unwrap().unwrap_or(true);
            if ok {
                match get_gpu_metrics_via_nvidia_smi() {
                    Some((load, temp, vram)) => {
                        let mut m = state.latest_metrics.lock().unwrap();
                        m.gpu_load = load;
                        m.gpu_temp = temp;
                        m.vram_usage = vram;
                        *state.nvidia_smi_ok.lock().unwrap() = Some(true);
                    }
                    None => {
                        *state.nvidia_smi_ok.lock().unwrap() = Some(false);
                    }
                }
            }
        }
    }

    broadcast_metrics(app, &state, &display_info);
}

fn broadcast_metrics(app: &AppHandle, state: &State<AppState>, display_info: &str) {
    let value = {
        let m = state.latest_metrics.lock().unwrap();
        match display_info {
            "cpu_usage" => m.cpu_load,
            "cpu_temp" => m.cpu_temp,
            "mem_usage" => m.mem_usage,
            "gpu_usage" => m.gpu_load,
            "vram_usage" => m.vram_usage,
            "gpu_temp" => m.gpu_temp,
            _ => m.cpu_load,
        }
    };
    // Emit only to the viewer window to reduce churn
    if let Some(win) = app.get_webview_window("viewer") {
        let _ = win.emit("cpu-load", value);
    }
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
fn get_cpu_load(state: State<'_, AppState>) -> u32 {
    state.latest_metrics.lock().unwrap().cpu_load
}

#[tauri::command]
fn get_grating_params(state: State<'_, AppState>) -> GratingParams {
    state.grating_params.lock().unwrap().clone()
}

#[tauri::command]
fn get_display_status(app: AppHandle) -> DisplayStatus {
    DisplayStatus {
        connected: find_c1_monitor(&app).is_some(),
    }
}

#[tauri::command]
fn get_settings(state: State<'_, AppState>) -> Config {
    state.config.lock().unwrap().clone()
}

#[tauri::command]
fn set_settings(
    partial: serde_json::Value,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Config {
    let updated = {
        let current = state.config.lock().unwrap().clone();
        apply_patch(current, &partial)
    };
    *state.config.lock().unwrap() = updated.clone();
    save_config(&updated, &state.app_data_dir);

    // Broadcast updated settings to all windows
    let _ = app.emit("settings-updated", &updated);

    updated
}

#[tauri::command]
fn get_system_accent_color() -> Option<String> {
    #[cfg(target_os = "windows")]
    {
        get_windows_accent_color()
    }
    #[cfg(not(target_os = "windows"))]
    {
        None
    }
}

#[cfg(target_os = "windows")]
fn get_windows_accent_color() -> Option<String> {
    // Read accent color from the Windows registry.
    // HKCU\Software\Microsoft\Windows\DWM\AccentColor is stored as ABGR u32.
    use std::process::Command;
    let output = Command::new("reg")
        .args([
            "query",
            r"HKCU\Software\Microsoft\Windows\DWM",
            "/v",
            "AccentColor",
        ])
        .output()
        .ok()?;
    let stdout = String::from_utf8(output.stdout).ok()?;
    // Line format: "    AccentColor    REG_DWORD    0xffXXYYZZ"
    let hex_str = stdout
        .lines()
        .find(|l| l.contains("AccentColor") && l.contains("REG_DWORD"))?;
    let value_str = hex_str.trim().split_whitespace().last()?;
    let abgr = u32::from_str_radix(value_str.trim_start_matches("0x"), 16).ok()?;
    // ABGR → RGB
    let b = (abgr >> 8) & 0xFF;
    let g = (abgr >> 16) & 0xFF;
    let r = (abgr >> 24) & 0xFF;
    Some(format!("#{:02x}{:02x}{:02x}", r, g, b))
}

#[tauri::command]
fn get_system_metrics(state: State<'_, AppState>) -> SystemMetrics {
    state.latest_metrics.lock().unwrap().clone()
}

#[tauri::command]
fn close_settings(app: AppHandle) {
    if let Some(window) = app.get_webview_window("settings") {
        let _ = window.close();
    }
}

// ---------------------------------------------------------------------------
// Application entry point
// ---------------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // ---- Config ----
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("Failed to resolve app data directory");
            let config = load_config(&app_data_dir);

            // ---- Shared state ----
            let grating_params = Arc::new(Mutex::new(config.grating_params.clone()));
            let c1_label_list: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));

            let state = AppState {
                grating_params: Arc::clone(&grating_params),
                c1_label_list: Arc::clone(&c1_label_list),
                latest_metrics: Mutex::new(SystemMetrics::default()),
                app_data_dir: app_data_dir.clone(),
                nvidia_smi_ok: Mutex::new(None),
                config: Mutex::new(config),
            };
            app.manage(state);

            // ---- Tray icon ----
            let app_handle = app.handle().clone();
            let lang = app
                .state::<AppState>()
                .config
                .lock()
                .unwrap()
                .language
                .clone();
            let menu = build_tray_menu(&app_handle, &lang)?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().cloned().unwrap_or_else(|| {
                    tauri::image::Image::from_bytes(include_bytes!("../icons/icon.png"))
                        .expect("icon bytes")
                }))
                .tooltip("Fiber C1")
                .menu(&menu)
                .on_menu_event(move |app, event| {
                    match event.id().as_ref() {
                        "settings" => open_settings_window(app),
                        "copy_calib" => {
                            let params = app
                                .state::<AppState>()
                                .grating_params
                                .lock()
                                .unwrap()
                                .clone();
                            if let Ok(json) = serde_json::to_string_pretty(&params) {
                                if let Ok(mut cb) = arboard::Clipboard::new() {
                                    let _ = cb.set_text(json);
                                }
                            }
                        }
                        "github" => open_url("https://github.com/xioxin/fiber-c1"),
                        "exit" => app.exit(0),
                        _ => {}
                    }
                })
                .build(app)?;

            // ---- Viewer window on the C1 display ----
            {
                let app_handle2 = app.handle().clone();
                // Delay slightly so the tray/state is fully initialised
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_millis(300));
                    create_viewer_window(&app_handle2);
                });
            }

            // ---- Named-pipe client (background thread) ----
            pipe::start_pipe_loop(
                app.handle().clone(),
                Arc::clone(&grating_params),
                Arc::clone(&c1_label_list),
                app_data_dir,
            );

            // ---- Metrics polling (background async task) ----
            {
                let app_handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    let mut collector = MetricsCollector::new();
                    loop {
                        tokio::time::sleep(Duration::from_secs(1)).await;
                        poll_metrics(&app_handle, &mut collector).await;
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_cpu_load,
            get_grating_params,
            get_display_status,
            get_settings,
            set_settings,
            get_system_accent_color,
            get_system_metrics,
            close_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// ---------------------------------------------------------------------------
// Create the viewer window on the C1 display (or primary monitor)
// ---------------------------------------------------------------------------

fn create_viewer_window(app: &AppHandle) {
    if app.get_webview_window("viewer").is_some() {
        return;
    }

    let monitor = find_c1_monitor(app);
    let (x, y, w, h) = match &monitor {
        Some(m) => (
            m.position().x as f64,
            m.position().y as f64,
            m.size().width as f64,
            m.size().height as f64,
        ),
        None => (0.0, 0.0, 1440.0, 2560.0),
    };

    let url = {
        #[cfg(debug_assertions)]
        {
            tauri::WebviewUrl::External("http://localhost:5173/".parse().expect("valid url"))
        }
        #[cfg(not(debug_assertions))]
        {
            tauri::WebviewUrl::App("index.html".into())
        }
    };

    match tauri::webview::WebviewWindowBuilder::new(app, "viewer", url)
        .title("Fiber C1")
        .position(x, y)
        .inner_size(w, h)
        .fullscreen(monitor.is_some())
        .decorations(false)
        .build()
    {
        Ok(win) => {
            let _ = win.show();
        }
        Err(e) => eprintln!("[viewer] Failed to create viewer window: {}", e),
    }
}
