use crate::config::GratingParams;
use serde_json::Value;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

const PIPE_NAMES: &[&str] = &["Cubestage_server_pipe", "OpenstageAI_server_pipe"];

const APP_REQUEST: &str = concat!(
    r#"{"id":"inbuilt","app_id":"fiber_c1_app","app_key":"fiber_c1_key","#,
    r#""app_secret":"fiber_c1_secret","app_version":"0.0.0","request_type":""#
);

fn pipe_path(name: &str) -> String {
    #[cfg(target_os = "windows")]
    return format!(r"\\.\pipe\{}", name);

    #[cfg(not(target_os = "windows"))]
    return format!("/tmp/{}", name);
}

fn send_request(stream: &mut dyn Write, request_type: &str) -> std::io::Result<()> {
    // NOTE: "getDeivice" (misspelling) is intentional — it must match the exact token used
    // by the Cubestage/OpenstageAI platform protocol and cannot be corrected.
    let json = format!("{}{}\"}}", APP_REQUEST, request_type);
    stream.write_all(json.as_bytes())?;
    stream.flush()
}

fn parse_response(
    raw: &str,
    grating_params: &Arc<Mutex<GratingParams>>,
    c1_label_list: &Arc<Mutex<Vec<String>>>,
    app: &AppHandle,
    app_data_dir: &std::path::PathBuf,
) {
    if raw.len() <= 2 {
        return;
    }
    let response: Value = match serde_json::from_str(raw) {
        Ok(v) => v,
        Err(_) => return,
    };

    let (request_type, response_data): (String, Value) =
        if response.get("request_type").is_some() {
            let rt = response["request_type"]
                .as_str()
                .unwrap_or("")
                .to_string();
            let rd = response.get("response_data").cloned().unwrap_or(Value::Null);
            // NOTE: "getDeivice" is the exact misspelled protocol token used by
            // Cubestage/OpenstageAI and must be preserved for wire compatibility.
            if rt == "getDeivice" {
                let inner_type = rd
                    .get("type")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let inner_data = rd.get("config").cloned().unwrap_or(Value::Null);
                (inner_type, inner_data)
            } else {
                (rt, rd)
            }
        } else {
            let rt = response.get("type").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let rd = response.get("config").cloned().unwrap_or(Value::Null);
            (rt, rd)
        };

    if request_type.is_empty() || response_data.is_null() {
        return;
    }

    if request_type == "getLabelList" {
        if let Some(arr) = response_data.as_array() {
            let labels: Vec<String> = arr
                .iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect();
            eprintln!("[pipe] C1 label list: {:?}", labels);
            *c1_label_list.lock().unwrap() = labels;
        }
        return;
    }

    if request_type == "getDeivice" || request_type == "device" {
        if let (Some(dev), Some(ln), Some(obl)) = (
            response_data.get("deviation").and_then(|v| v.as_f64()),
            response_data.get("lineNumber").and_then(|v| v.as_f64()),
            response_data.get("obliquity").and_then(|v| v.as_f64()),
        ) {
            let params = GratingParams {
                deviation: dev,
                line_number: ln,
                obliquity: obl,
            };
            eprintln!("[pipe] Grating params updated: {:?}", params);
            *grating_params.lock().unwrap() = params.clone();

            // Persist updated params
            let mut cfg =
                crate::config::load_config(app_data_dir);
            cfg.grating_params = params.clone();
            crate::config::save_config(&cfg, app_data_dir);

            let _ = app.emit("grating-params", &params);
        }
    }
}

// ---------------------------------------------------------------------------
// Platform-specific stream types
// ---------------------------------------------------------------------------

#[cfg(target_os = "windows")]
fn open_pipe(path: &str) -> std::io::Result<std::fs::File> {
    use std::fs::OpenOptions;
    OpenOptions::new().read(true).write(true).open(path)
}

#[cfg(not(target_os = "windows"))]
fn open_pipe(path: &str) -> std::io::Result<std::os::unix::net::UnixStream> {
    std::os::unix::net::UnixStream::connect(path)
}

// ---------------------------------------------------------------------------
// Background connection loop (runs in a std::thread)
// ---------------------------------------------------------------------------

pub fn start_pipe_loop(
    app: AppHandle,
    grating_params: Arc<Mutex<GratingParams>>,
    c1_label_list: Arc<Mutex<Vec<String>>>,
    app_data_dir: std::path::PathBuf,
) {
    std::thread::spawn(move || {
        let mut retry_index: usize = 0;
        loop {
            let name = PIPE_NAMES[retry_index % PIPE_NAMES.len()];
            let path = pipe_path(name);
            eprintln!("[pipe] Connecting to {}", path);

            match open_pipe(&path) {
                Ok(mut stream) => {
                    eprintln!("[pipe] Connected to {}", name);

                    // NOTE: "getDeivice" is the exact misspelled protocol token
                    if send_request(&mut stream, "getDeivice").is_ok() {
                        std::thread::sleep(Duration::from_secs(1));
                        let _ = send_request(&mut stream, "getLabelList");
                    }

                    // Read responses in a loop
                    let mut buf = [0u8; 4096];
                    loop {
                        match stream.read(&mut buf) {
                            Ok(0) => break, // EOF
                            Ok(n) => {
                                if let Ok(s) = std::str::from_utf8(&buf[..n]) {
                                    parse_response(
                                        s,
                                        &grating_params,
                                        &c1_label_list,
                                        &app,
                                        &app_data_dir,
                                    );
                                }
                            }
                            Err(_) => break,
                        }
                    }
                    eprintln!("[pipe] Connection closed, retrying…");
                }
                Err(e) => {
                    eprintln!("[pipe] Connect error ({}): {}", name, e);
                }
            }

            retry_index += 1;
            std::thread::sleep(Duration::from_secs(3));
        }
    });
}
