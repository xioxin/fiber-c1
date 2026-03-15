# Fiber C1 / DonutMonitor

基于 **React + React Three Fiber + Electron** 构建的 [CubeVi C1](https://cubevi.com/products/cube-c1) 裸眼3D显示屏模板应用。项目以全息3D场景的形式实时展示系统监控数据（CPU / GPU / 内存），并内置了开箱即用的 `LenticularInterlacer` 组件，负责全部多视角渲染与光栅交织合成工作。

> **将本项目作为二次开发的起点。** 3D 场景、系统数据管道、平台集成、光栅着色器每一层都被拆分在独立、易于替换的文件中。

English Docs: [README.md](README.md)

---

## 关于 CubeVi C1 显示屏

**CubeVi C1** 是一款裸眼全息3D显示器。屏幕表面覆盖微米级柱状透镜阵列，将不同视角的画面同时引导至观察者的左右眼，无需任何眼镜即可感受真实立体深度。

要在 C1 上正确渲染，应用需要：

1. **从多个摄像机角度渲染场景**（C1 需要 40 个视角，排列为 8 × 5 网格）。
2. **交织合成视图**，将多张渲染图合并为一帧，像素排布与实体透镜列精确对齐。
3. **使用校准好的光栅参数**（`X0` / `Interval` / `Slope`），这三个参数描述了该设备透镜阵列的精确几何结构。

光栅参数由同一台 Windows 机器上运行的 **Cubestage**（国际版）或 **OpenstageAI**（国内版）平台软件通过命名管道自动下发，无需手动填写。详见 [平台集成](#平台集成) 章节。

---

## 技术栈

| 层级 | 技术 |
|---|---|
| UI / 3D 场景 | React 19、React Three Fiber v9、Three.js |
| 桌面壳层 | Electron 41 |
| 构建工具 | Vite 7 |
| 系统指标 | systeminformation、node-wmi（Windows）、node-nvidia-smi（NVIDIA） |
| 打包 | electron-builder |

---

## 环境要求

- **Windows 10 / 11 64 位**（系统指标依赖 WMI；其他平台可用浏览器模式预览）
- **Node.js 18+** 及 **npm 9+**
- 已安装并运行的 **[Cubestage](https://cubevi.com/pages/download-page)**（国际版）或 **[OpenstageAI](https://www.openstageai.com/download)**（国内版）——用于获取实时光栅参数并在 C1 上显示应用

---

## 快速开始

```bash
# 安装依赖
npm install

# 开发模式（同时启动 Vite 开发服务器和 Electron）
npm run electron:dev

# 仅浏览器预览（无 Electron，使用随机模拟数据）
npm run dev
```

### 生产构建

```bash
npm run electron:build
```

打包后的安装包输出到 `dist/` 目录。

---

## 目录结构

```
fiber-c1/
├── electron/
│   ├── main.js          # Electron 主进程：窗口管理、命名管道平台连接、IPC 处理
│   ├── metrics.js       # CPU / GPU / 内存指标采集工具函数
│   ├── preload.js       # 通过 contextBridge 向渲染进程暴露 electronAPI
│   └── store.js         # 持久化设置（electron-store）
│
└── src/
    ├── App.jsx           # 根组件：Canvas 配置、指标轮询、设置加载
    ├── SettingsPanel.jsx # 设置窗口（语言、主题、展示信息选择）
    ├── i18n/index.js     # 中英文字符串与单位定义
    │
    ├── lenticular/
    │   └── config.js     # ← 显示屏常量与默认光栅参数
    │
    └── components/
        ├── LenticularInterlacer.jsx  # ← 核心：多视角渲染 + 光栅交织合成
        ├── DonutProgress.jsx         # 动态圆环进度条
        ├── PercentLabel.jsx          # 3D 立体数字标签
        ├── Atmosphere.jsx            # 背景粒子/大气效果
        ├── orbLightingConfig.js      # 轨道光照参数配置
        └── cursorLightState.js       # 鼠标跟踪光照状态
```

---

## 开发指南

### 1 · 替换或扩展 3D 场景

所有场景内容位于 [src/App.jsx](src/App.jsx) 的 `<Scene>` 组件中。可以自由增删替换组件。唯一的规则是：**`<LenticularInterlacer>` 必须放在 `<Canvas>` 内的最后位置**，确保它能在所有其他内容渲染完毕后执行合成。

### 2 · 展示不同的系统指标

展示的指标由 `settings.displayInfo` 控制，支持的键名定义在 [src/i18n/index.js](src/i18n/index.js)：

```
cpu_usage（CPU 占用率）· cpu_temp（CPU 温度）· mem_usage（内存占用率）
gpu_usage（GPU 占用率）· vram_usage（显存占用率）· gpu_temp（显卡温度）
```

如需新增指标：在 `i18n/index.js` 中添加键名和单位，在 [electron/metrics.js](electron/metrics.js) 中实现数据采集，再通过 [electron/main.js](electron/main.js) 中的 IPC 处理器推送给渲染进程。

### 3 · 调整显示屏常量

[src/lenticular/config.js](src/lenticular/config.js) 存储了物理显示屏参数：

```js
export const ImgCountX   = 8     // 水平视图数
export const ImgCountY   = 5     // 垂直视图数
export const OutPutSizeX = 1440  // 显示屏物理宽度（像素）
export const OutPutSizeY = 2560  // 显示屏物理高度（像素）
export const SubWidth    = 450   // 单个子视图宽度（像素）
export const SubHeight   = 800   // 单个子视图高度（像素）

export const LenticularOptics = {
  obliquity:  0.10516,   // Slope（斜率）      — 默认备用值
  lineNumber: 19.6401,   // Interval（间距）   — 默认备用值
  deviation:  16.25578,  // X0（水平偏移）     — 默认备用值
  thetaDeg:   40,        // 摄像机总扫描角度（度）
}
```

`LenticularOptics` 中的值是平台不可用时的默认备用值。运行时应用始终优先使用平台下发的实时值。

---

## LenticularInterlacer 组件

`LenticularInterlacer` 是整个项目的核心。它是一个 **React Three Fiber 组件**（返回 `null`，本身没有任何几何体），通过劫持渲染循环完成以下工作：

1. 在 `focusPoint` 周围以弧形排列 40 个透视摄像机。
2. 将整个场景从每个摄像机视角分别渲染至离屏图集（Atlas）纹理的对应瓦片区域。
3. 执行全屏 GLSL 交织合成着色器，将 40 张瓦片合并为一帧，像素排布与实体透镜列精确匹配。

### 使用位置

`LenticularInterlacer` **必须**放置在 R3F 的 `<Canvas>` 内，且置于所有场景内容**之后**：

```jsx
import { Canvas } from '@react-three/fiber'
import { LenticularInterlacer } from './components/LenticularInterlacer'
import { LenticularOptics } from './lenticular/config'

function App() {
  return (
    <Canvas camera={{ position: [0, 0, 6.5], fov: 45 }}>
      {/* 你的场景内容 */}
      <MySceneContent />

      {/* 光栅合成通道 —— 必须放最后 */}
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

### Props 说明

| Prop | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `focusPoint` | `[x, y, z]` | `[0, 0, 0]` | 40 个摄像机环绕的世界空间中心点，设置为场景视觉中心。 |
| `interlaced` | `boolean` | `true` | `true` → 输出 C1 所需的交织合成帧；`false` → 显示原始 8×5 图集（用于调试）。 |
| `slope` | `number` | `0.10516` | 斜率 ——透镜阵列相对像素网格的倾斜角正切值（来自平台）。 |
| `interval` | `number` | `19.6401` | 间距——一列透镜的宽度，以子像素为单位（来自平台）。 |
| `x0` | `number` | `16.25578` | 水平偏移 ——透镜网格水平原点偏移量，以子像素为单位（来自平台，每台设备独立校准）。 |
| `thetaDeg` | `number` | `40` | 40 个摄像机的总扫描角度（度）。值越大视差越强，默认值与 C1 光学参数匹配。 |

### 内部工作原理

```
useFrame（优先级 1）
  │
  ├─ 克隆主摄像机 × 40，在 –thetaDeg/2 … +thetaDeg/2 偏航弧上均匀分布
  ├─ 对每个摄像机：
  │    ├─ 在图集渲染目标中设置对应瓦片区域的裁剪框（scissor）
  │    └─ gl.render(scene, viewCamera[i])
  │
  └─ 全屏着色器合成通道
       ├─ 对图集纹理进行采样
       ├─ 对每个输出像素：计算所属透镜列 → 对应子视图索引
       ├─ RGB 三通道色差修正（R/G/B 通道分别使用不同偏置值）
       └─ 将最终像素写入屏幕
```

### 调试：切换到图集预览模式

传入 `interlaced={false}` 可在浏览器中查看原始的 8 × 5 视角网格图，这是在连接真实 C1 设备之前验证场景是否正确覆盖所有视角的最快方式。

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

## 平台集成

应用通过 Windows 命名管道与 **Cubestage** 或 **OpenstageAI** 通信，获取实时光栅参数。相关代码位于 [electron/main.js](electron/main.js)。

### 命名管道

| 平台 | 管道名称 |
|---|---|
| Cubestage（国际版） | `Cubestage_server_pipe` |
| OpenstageAI（国内版） | `OpenstageAI_server_pipe` |

主进程会依次尝试两个管道，并在断开后自动重连。

### 请求 / 响应格式

```js
// 请求
{ request_type: 'getDeivice', ... }

// 响应字段（response_data）
{
  config: {
    deviation:  16.25578,   // → X0 水平偏移
    lineNumber: 19.6401,    // → Interval 间距
    obliquity:  0.10516     // → Slope 斜率
  }
}
```

收到参数后，主进程通过 IPC（`onGratingParams`）将数据推送给渲染进程，渲染进程再将其作为 props 传给 `<LenticularInterlacer>`。最近一次收到的值也会持久化到磁盘，以便在平台暂时不可用时继续使用。

### 渲染进程 IPC（`window.electronAPI`）

| 方法 | 说明 |
|---|---|
| `getGratingParams()` | 获取最近一次的光栅参数 |
| `onGratingParams(cb)` | 订阅来自平台的光栅参数更新 |
| `getSettings()` | 加载持久化设置 |
| `setSettings(patch)` | 保存部分设置更新 |
| `closeSettings()` | 关闭设置窗口 |

---

## 设置

设置窗口（URL hash 为 `#settings`）允许用户配置：

- **语言** — 中文（`zh`）或英文（`en`）
- **展示信息** — 选择展示哪项指标（`cpu_usage`、`cpu_temp`、`mem_usage`、`gpu_usage`、`vram_usage`、`gpu_temp`）
- **主题** — 预设色卡、跟随系统强调色、或完全自定义主色/辅色

设置通过 `electron-store` 持久化，并在查看窗口与设置窗口之间实时同步。

---

## 光栅参数校准

校准工作完全在平台内完成——应用只需在启动时读取存储好的值即可。如果用户反映 3D 效果错位，请先让他们在 Cubestage / OpenstageAI 中重新运行校准，大多数情况下无需修改任何代码即可解决。

---

## 发布你的应用

基于本模板开发完成后，欢迎将应用分享到 C1 社区：

- 在 [CubeVi Discord](https://discord.gg/ZzEhKNJE8g) 的 **#engineers-developers** 频道发送一条消息，附上应用名称、简介、截图或视频。
- 没有复杂的审核流程——发布即可，让更多 C1 用户体验到你的作品。

