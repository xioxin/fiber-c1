/**
 * Platform-aware system metrics helpers.
 *
 * CPU temperature
 *   Uses node-wmi to query Win32_PerfFormattedData_Counters_ThermalZoneInformation
 *   on Windows (temperature value is in Kelvin; subtract 273.15 for Celsius).
 *   Falls back to si.cpuTemperature() if wmi query fails.
 *
 * GPU metrics
 *   Uses node-nvidia-smi (calls `nvidia-smi -q -x`) for NVIDIA GPUs — far cheaper
 *   than si.graphics() which issues expensive WMI queries on Windows.
 *   Falls back to si.graphics() for non-NVIDIA hardware or if nvidia-smi is absent.
 */

import { createRequire } from 'module'
import si from 'systeminformation'

// Both node-wmi and node-nvidia-smi are CommonJS packages
const require = createRequire(import.meta.url)

const isWindows = process.platform === 'win32'

// ---------------------------------------------------------------------------
// CPU temperature
// ---------------------------------------------------------------------------

/**
 * Returns CPU temperature in Celsius as an integer.
 * On Windows queries WMI via node-wmi; falls back to si.cpuTemperature().
 */
export async function getCpuTemperature() {
  if (isWindows) {
    try {
      const wmi = require('node-wmi')
      const result = await new Promise((resolve, reject) => {
        wmi.Query(
          {
            class: 'Win32_PerfFormattedData_Counters_ThermalZoneInformation',
            properties: ['Temperature'],
          },
          (err, data) => {
            if (err) return reject(err)
            resolve(data)
          },
        )
      })
      if (result && result.length > 0) {
        // Temperature is reported in Kelvin
        const tempK = result[0].Temperature
        return Math.round(tempK - 273.15)
      }
    } catch {
      // node-wmi unavailable or wmic not found — fall through to si fallback
    }
  }

  // Non-Windows or WMI query failed
  try {
    const temp = await si.cpuTemperature()
    return Math.round(temp.main || 0)
  } catch {
    return 0
  }
}

// ---------------------------------------------------------------------------
// GPU metrics
// ---------------------------------------------------------------------------

// Tri-state flag:  null = not yet probed,  true = working,  false = unavailable
let nvidiaSmiAvailable = null

/**
 * Parse a "value unit" string like "58 C" or "3 %" and return the integer.
 */
function parseUnit(str) {
  return parseInt((str || '0').trim().split(' ')[0], 10)
}

/**
 * Returns { gpuLoad, gpuTemp, vramUsage } for the primary GPU.
 * Tries node-nvidia-smi first; falls back to si.graphics().
 */
export async function getGpuMetrics() {
  if (nvidiaSmiAvailable !== false) {
    try {
      const nvidiaSmi = require('node-nvidia-smi')
      const rawData = await new Promise((resolve, reject) => {
        nvidiaSmi((err, data) => {
          if (err) return reject(err)
          resolve(data)
        })
      })

      // node-nvidia-smi wraps the XML as nvidia_smi_log.gpu
      // For multi-GPU systems `gpu` is an array; for single GPU it's an object.
      let gpus = rawData?.nvidia_smi_log?.gpu
      if (!gpus) throw new Error('No GPU data from nvidia-smi')
      if (!Array.isArray(gpus)) gpus = [gpus]
      const gpu = gpus[0]

      const gpuLoad = parseUnit(gpu.utilization?.gpu_util)
      const gpuTemp = parseUnit(gpu.temperature?.gpu_temp)
      const memUsed  = parseUnit(gpu.fb_memory_usage?.used)
      const memTotal = parseUnit(gpu.fb_memory_usage?.total)

      nvidiaSmiAvailable = true
      return {
        gpuLoad:   isNaN(gpuLoad)  ? 0 : gpuLoad,
        gpuTemp:   isNaN(gpuTemp)  ? 0 : gpuTemp,
        vramUsage: memTotal > 0 ? Math.round((memUsed / memTotal) * 100) : 0,
      }
    } catch {
      nvidiaSmiAvailable = false
      // fall through to systeminformation fallback
    }
  }

  // Fallback: systeminformation (AMD / Intel, or when nvidia-smi is absent)
  try {
    const graphics = await si.graphics()
    const gpu =
      graphics.controllers?.find(
        (c) => c.utilizationGpu !== undefined && c.utilizationGpu !== null,
      ) || graphics.controllers?.[0]

    if (gpu) {
      const vramTotal = gpu.vram || 0
      const vramUsed  = gpu.memoryUsed || 0
      return {
        gpuLoad:   Math.round(gpu.utilizationGpu || 0),
        gpuTemp:   Math.round(gpu.temperatureGpu || 0),
        vramUsage: vramTotal > 0 ? Math.round((vramUsed / vramTotal) * 100) : 0,
      }
    }
  } catch {
    // ignore
  }

  return { gpuLoad: 0, gpuTemp: 0, vramUsage: 0 }
}
