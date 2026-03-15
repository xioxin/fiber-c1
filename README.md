# Fiber C1 / DonutMonitor

A glasses-free 3D display template app for the [CubeVi C1](https://cubevi.com/products/cube-c1) lenticular display, built with **React + React Three Fiber + Electron**. It renders a real-time system-metrics dashboard (CPU / GPU / memory) as a holographic 3D scene and ships a ready-to-extend `LenticularInterlacer` component that handles all multi-view rendering and interlacing.

> **Use this project as a starting point** for your own C1 app. Every layer — the 3-D scene, the system-data pipeline, the platform integration, and the interlacing shader — is contained in focused, easy-to-replace files.

中文文档: [README.zh-CN.md](README.zh-CN.md)

---

## The CubeVi C1 Display

The **CubeVi C1** is a glasses-free holographic 3D monitor. A micro-lenticular lens array covers the screen surface and directs a different rendered view to each eye (and angular position) simultaneously, producing real depth perception without any special eyewear.

To render correctly on a C1 your application must:

1. **Render the scene from multiple camera angles** (the C1 expects 40 views arranged in an 8 × 5 grid).
2. **Interlace the views** into a single composite frame whose pixel layout matches the physical lens columns.
3. **Use calibrated grating parameters** (`X0` / `Interval` / `Slope`) that describe the exact geometry of the lens array on the specific unit.

The grating parameters are provided automatically by the **Cubestage** (international) or **OpenstageAI** (Chinese) platform software running on the same Windows machine. Your app reads them from the platform at startup via a named-pipe connection — see [Platform Integration](#platform-integration) below.

---

## Tech Stack

| Layer | Technology |
|---|---|
| UI / 3-D scene | React 19, React Three Fiber v9, Three.js |
| Desktop shell | Electron 41 |
| Build tool | Vite 7 |
| System metrics | systeminformation, node-wmi (Windows), node-nvidia-smi (NVIDIA) |
| Packaging | electron-builder |

---

## Requirements

- **Windows 10 / 11 64-bit** (system metrics use WMI; other platforms work for browser-mode preview)
- **Node.js 18+** and **npm 9+**
- **[Cubestage](https://cubevi.com/pages/download-page)** (international) or **[OpenstageAI](https://www.openstageai.com/download)** (Chinese) installed and running — required for live grating parameters and to display the app on the C1

---

## Quick Start

```bash
# Install dependencies
npm install

# Start development mode (Vite dev server + Electron)
npm run electron:dev

# Browser-only preview (no Electron, random metric values)
npm run dev
```

### Production build

```bash
npm run electron:build
```

The packaged installer is emitted to the `dist/` folder.

---

## Project Structure

```
fiber-c1/
├── electron/
│   ├── main.js          # Electron main process: window management, named-pipe
│   │                    #   platform connection, IPC handlers
│   ├── metrics.js       # CPU / GPU / memory metric helpers
│   ├── preload.js       # Exposes electronAPI to the renderer via contextBridge
│   └── store.js         # Persistent settings (electron-store)
│
└── src/
    ├── App.jsx           # Root component: Canvas setup, metric polling, settings
    ├── SettingsPanel.jsx # Settings window (language, theme, display-info choice)
    ├── i18n/index.js     # English / Chinese strings and units
    │
    ├── lenticular/
    │   └── config.js     # ← Display constants and default grating parameters
    │
    └── components/
        ├── LenticularInterlacer.jsx  # ← Core lenticular render + interlace pass
        ├── DonutProgress.jsx         # Animated ring showing the metric value
        ├── PercentLabel.jsx          # 3-D extruded text label
        ├── Atmosphere.jsx            # Background particle / atmosphere effect
        ├── orbLightingConfig.js      # Orb light definitions
        └── cursorLightState.js       # Cursor-follow light state
```

---

## Development Guide

### 1 · Replace or extend the 3-D scene

All scene content lives inside the `<Scene>` component in [src/App.jsx](src/App.jsx). Add, remove, or swap components freely. The only rule is that `<LenticularInterlacer>` must remain as the **last element** inside the `<Canvas>` (so it composites over everything rendered before it).

### 2 · Display different system metrics

The metric type is controlled by `settings.displayInfo`. The supported keys are defined in [src/i18n/index.js](src/i18n/index.js):

```
cpu_usage · cpu_temp · mem_usage · gpu_usage · vram_usage · gpu_temp
```

Add a new key there together with a unit string, then handle the collection in [electron/metrics.js](electron/metrics.js) and wire it up through the IPC handlers in [electron/main.js](electron/main.js).

### 3 · Adjust display constants

[src/lenticular/config.js](src/lenticular/config.js) holds the physical display parameters:

```js
export const ImgCountX   = 8     // Horizontal view count
export const ImgCountY   = 5     // Vertical view count
export const OutPutSizeX = 1440  // Physical display width  (px)
export const OutPutSizeY = 2560  // Physical display height (px)
export const SubWidth    = 450   // Width of one sub-view   (px)
export const SubHeight   = 800   // Height of one sub-view  (px)

export const LenticularOptics = {
  obliquity:  0.10516,   // Slope    — fallback default
  lineNumber: 19.6401,   // Interval — fallback default
  deviation:  16.25578,  // X0       — fallback default
  thetaDeg:   40,        // Total camera sweep angle (degrees)
}
```

The `LenticularOptics` values are the default fallbacks used when the platform is unavailable. At runtime the app always prefers the live values returned by the platform.

---

## LenticularInterlacer Component

`LenticularInterlacer` is the heart of the project. It is a **React Three Fiber component** (returns `null` — no geometry of its own) that hooks into the render loop to:

1. Spin up 40 perspective cameras arranged in an arc around `focusPoint`.
2. Render the entire scene from each camera into tiles of an offscreen atlas render target.
3. Run a full-screen GLSL interlacing pass that composites the 40 tiles into one interlaced frame matching the physical lens layout.

### Placement

`LenticularInterlacer` **must** be placed inside an R3F `<Canvas>`. Put it last so it composites every other scene element:

```jsx
import { Canvas } from '@react-three/fiber'
import { LenticularInterlacer } from './components/LenticularInterlacer'
import { LenticularOptics } from './lenticular/config'

function App() {
  return (
    <Canvas camera={{ position: [0, 0, 6.5], fov: 45 }}>
      {/* Your scene content */}
      <MySceneContent />

      {/* Lenticular pass — always last */}
      <LenticularInterlacer
        focusPoint={[0, 0, 0]}
        interlaced={true}
        slope={LenticularOptics.obliquity}
        interval={LenticularOptics.lineNumber}
        x0={LenticularOptics.deviation}
        thetaDeg={LenticularOptics.thetaDeg}
      />
    </Canvas>
  )
}
```

### Props

| Prop | Type | Default | Description |
|---|---|---|---|
| `focusPoint` | `[x, y, z]` | `[0, 0, 0]` | World-space point the 40 cameras orbit. Set it to the visual centre of your scene. |
| `interlaced` | `boolean` | `true` | `true` → produce the interlaced output for the C1. `false` → display the raw 8 × 5 atlas (useful for debugging). |
| `slope` | `number` | `0.10516` | Slope — tilt of the lens array relative to the pixel grid (from the platform). |
| `interval` | `number` | `19.6401` | Interval — pitch of one lens column in subpixels (from the platform). |
| `x1` | `number` | `16.25578` | X0 — horizontal origin offset of the lens grid in subpixels (from the platform; the most unit-specific value). |
| `thetaDeg` | `number` | `40` | Total angular sweep of the 40 cameras in degrees. Wider values give more parallax; the default matches the C1 optics. |

### How it works internally

```
useFrame (priority 1)
  │
  ├─ Clone main camera × 40, distribute across –thetaDeg/2 … +thetaDeg/2 yaw arc
  ├─ For each camera:
  │    ├─ Set scissor to its tile slot in the atlas render target
  │    └─ gl.render(scene, viewCamera[i])
  │
  └─ Full-screen shader pass (interlaceScene / previewScene)
       ├─ Sample the atlas texture
       ├─ For each output pixel: compute lens column → sub-view index
       ├─ Sub-pixel R/G/B chromatic correction (separate bias per channel)
       └─ Write final pixel to screen
```

### Debug: switching to atlas-preview mode

Pass `interlaced={false}` to show the raw 8 × 5 grid in the browser. This is the fastest way to verify that your scene renders across all view angles before connecting to a real C1.

```jsx
const [debugAtlas, setDebugAtlas] = useState(false)

<LenticularInterlacer
  focusPoint={[0, 0, 0]}
  interlaced={!debugAtlas}
  slope={gratingParams.obliquity}
  interval={gratingParams.lineNumber}
  x0={gratingParams.deviation}
  thetaDeg={40}
/>
```

---

## Platform Integration

The app communicates with **Cubestage** or **OpenstageAI** over a Windows named pipe to fetch live grating parameters. The relevant code is in [electron/main.js](electron/main.js).

### Named pipes

| Platform | Pipe name |
|---|---|
| Cubestage (international) | `Cubestage_server_pipe` |
| OpenstageAI (Chinese) | `OpenstageAI_server_pipe` |

The main process tries both in sequence and reconnects automatically on disconnect.

### Request / response

```js
// Request
{ request_type: 'getDeivice', ... }

// Response field (response_data)
{
  config: {
    deviation:  16.25578,   // → X0
    lineNumber: 19.6401,    // → Interval
    obliquity:  0.10516     // → Slope
  }
}
```

Once received, the values are pushed to the renderer via IPC (`onGratingParams`) and forwarded to `<LenticularInterlacer>` as props. The last-known values are also persisted to disk so the app still runs when the platform is temporarily unavailable.

### Renderer IPC (`window.electronAPI`)

| Method | Description |
|---|---|
| `getGratingParams()` | Get last-known grating params |
| `onGratingParams(cb)` | Subscribe to grating param updates from platform |
| `getSettings()` | Load persisted settings |
| `setSettings(patch)` | Save partial settings update |
| `closeSettings()` | Close the settings window |

---

## Settings

The settings window (`#settings` hash route) allows end-users to configure:

- **Language** — Chinese (`zh`) or English (`en`)
- **Display info** — which metric to show (`cpu_usage`, `cpu_temp`, `mem_usage`, `gpu_usage`, `vram_usage`, `gpu_temp`)
- **Theme** — preset colour swatches, follow-system accent colour, or fully custom primary / secondary colours

Settings are persisted via `electron-store` and synced between the viewer and settings windows in real time.

---

## Grating Parameter Calibration

Calibration is performed entirely inside the platform — your app just reads the stored value at startup. If a user reports misaligned 3D output, ask them to re-run calibration in Cubestage / OpenstageAI first.

---

## Publishing Your App

Once you have built something on top of this template, you can share it with C1 users:

- Drop a message in the **#engineers-developers** channel on the [CubeVi Discord](https://discord.gg/ZzEhKNJE8g) with a brief description, screenshot, or video.
- There is no complex review pipeline — just share what you built.
