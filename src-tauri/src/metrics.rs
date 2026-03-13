use serde::{Deserialize, Serialize};
use sysinfo::{Components, System};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemMetrics {
    pub cpu_load: u32,
    pub cpu_temp: u32,
    pub mem_usage: u32,
    pub gpu_load: u32,
    pub vram_usage: u32,
    pub gpu_temp: u32,
}

pub struct MetricsCollector {
    sys: System,
}

impl MetricsCollector {
    pub fn new() -> Self {
        Self {
            sys: System::new(),
        }
    }

    pub fn refresh_cpu_load(&mut self) -> u32 {
        self.sys.refresh_cpu_usage();
        self.sys.global_cpu_usage().round() as u32
    }

    pub fn refresh_mem_usage(&mut self) -> u32 {
        self.sys.refresh_memory();
        let total = self.sys.total_memory();
        let used = self.sys.used_memory();
        if total == 0 {
            return 0;
        }
        ((used as f64 / total as f64) * 100.0).round() as u32
    }

    pub fn get_cpu_temp(&self) -> u32 {
        let components = Components::new_with_refreshed_list();
        for comp in &components {
            let label = comp.label().to_lowercase();
            if label.contains("cpu")
                || label.contains("package")
                || label.contains("tctl")
                || label.contains("coretemp")
            {
                if let Some(t) = comp.temperature() {
                    return t.round() as u32;
                }
            }
        }
        // Fallback: try the first available component with a valid temperature
        for comp in Components::new_with_refreshed_list().iter() {
            if let Some(t) = comp.temperature() {
                return t.round() as u32;
            }
        }
        0
    }
}

/// Query GPU metrics via nvidia-smi CLI.
/// Returns (gpu_load %, gpu_temp °C, vram_usage %) or None if unavailable.
pub fn get_gpu_metrics_via_nvidia_smi() -> Option<(u32, u32, u32)> {
    let output = std::process::Command::new("nvidia-smi")
        .args([
            "--query-gpu=utilization.gpu,temperature.gpu,memory.used,memory.total",
            "--format=csv,noheader,nounits",
        ])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8(output.stdout).ok()?;
    let parts: Vec<&str> = stdout.trim().split(',').collect();
    if parts.len() < 4 {
        return None;
    }

    let gpu_load = parts[0].trim().parse::<u32>().ok()?;
    let gpu_temp = parts[1].trim().parse::<u32>().ok()?;
    let mem_used = parts[2].trim().parse::<u64>().ok()?;
    let mem_total = parts[3].trim().parse::<u64>().ok()?;
    let vram_usage = if mem_total > 0 {
        ((mem_used as f64 / mem_total as f64) * 100.0).round() as u32
    } else {
        0
    };

    Some((gpu_load, gpu_temp, vram_usage))
}
