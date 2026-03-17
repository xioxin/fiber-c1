import { useState, useEffect, useCallback, Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { DonutProgress } from "./components/DonutProgress";
import { PercentLabel } from "./components/PercentLabel";
import { Atmosphere } from "./components/Atmosphere";
import { LenticularInterlacer } from "./components/LenticularInterlacer";
import { SettingsPanel } from "./SettingsPanel";
import { PRESET_COLORS, t } from './i18n/index.js'

import "./App.css";

// Default theme colors
const DEFAULT_PRIMARY = '#00e5ff'
const DEFAULT_SECONDARY = '#b020ff'


const RENDER_MODES = [
  { key: 'single', label: '原始' },
  { key: 'atlas', label: '40图' },
  { key: 'interlaced', label: '交织图' },
]

/** Derive theme colors from a settings object. */
function resolveThemeColors(theme) {
  if (!theme) return { primary: DEFAULT_PRIMARY, secondary: DEFAULT_SECONDARY }
  return {
    primary: theme.primaryColor || DEFAULT_PRIMARY,
    secondary: theme.secondaryColor || DEFAULT_SECONDARY,
  }
}

function Scene({ progress, renderMode, gratingParams, primaryColor, secondaryColor, unit, maxValue }) {
  return (
    <>
      <color attach="background" args={["#000000"]} />

      {/* Lighting */}
      <ambientLight intensity={0.15} />
      <pointLight position={[4, 4, 6]} color="#00ccff" intensity={3} />
      <pointLight position={[-4, -4, 4]} color="#9900ff" intensity={2} />
      <directionalLight position={[0, 10, 5]} intensity={0.4} color="#ffffff" />
      <pointLight position={[0, 0, 8]} color="#ffffff" intensity={0.6} />

      <Atmosphere primaryColor={primaryColor} secondaryColor={secondaryColor} />

      {/* Donut progress ring */}
      <group position={[0, 0, 0]} scale={0.8}>
        <DonutProgress
          progress={progress / maxValue}
          primaryColor={primaryColor}
          secondaryColor={secondaryColor}
        />
      </group>

      {/* 3D percentage text */}
      <group position={[0, 0, 0]} scale={unit === '°C' || unit === '°F' ? 0.8 : 0.9}>
        <Suspense fallback={null}>
          <PercentLabel
            progress={progress}
            primaryColor={primaryColor}
            secondaryColor={secondaryColor}
            unit={unit}
          />
        </Suspense>
      </group>

      {/* Render 40 views and interlace into the final on-screen image */}
      {renderMode !== "single" && (
        <LenticularInterlacer
          focusPoint={[0, 0, 0]}
          interlaced={renderMode === "interlaced"}
          slope={gratingParams.obliquity}
          interval={gratingParams.lineNumber}
          x0={gratingParams.deviation}
          thetaDeg={40}
        />
      )}
      <OrbitControls enableZoom={false} enablePan={false} />
    </>
  );
}

function App() {
  const [progress, setProgress] = useState({
    type: 'cpu_usage',
    value: 0,
    unit: '%',
    maxValue: 100,
  });
  const [renderMode, setRenderMode] = useState('interlaced')

  window.setRenderMode = (mode) => {
    if (RENDER_MODES.some(m => m.key === mode)) {
      setRenderMode(mode);
    }
  }

  const [gratingParams, setGratingParams] = useState({
    obliquity: null,
    lineNumber: null,
    deviation: null,
  });
  const [settings, setSettings] = useState({
    language: 'auto',
    displayInfo: 'cpu_usage',
    temperatureUnit: 'celsius',
    theme: {
      mode: 'preset',
      presetIndex: 0,
      primaryColor: DEFAULT_PRIMARY,
      secondaryColor: DEFAULT_SECONDARY,
    },
  });

  const isElectron = typeof window !== "undefined" && !!window.electronAPI;
  const isSettings = typeof window !== "undefined" && window.location.hash === '#settings';

  const themeColors = resolveThemeColors(settings.theme);

  // Apply settings from loaded config
  const applySettings = useCallback((s) => {
    if (!s) return;
    setSettings(s);
    // If preset mode, ensure colors match the stored preset index
    if (s.theme?.mode === 'preset' && s.theme?.presetIndex !== undefined) {
      const preset = PRESET_COLORS[s.theme.presetIndex];
      if (preset) {
        setSettings((prev) => ({
          ...prev,
          theme: {
            ...prev.theme,
            primaryColor: preset.primary,
            secondaryColor: preset.secondary,
          },
        }));
      }
    }
  }, []);

  useEffect(() => {
    if (isElectron) {
      // Load saved settings
      window.electronAPI.getSettings().then(applySettings);

      // Subscribe to settings updates (e.g. from settings window)
      const cleanupSettings = window.electronAPI.onSettingsUpdated(applySettings);

      if (!isSettings) {
        // Only poll system metrics in the viewer window
        window.electronAPI.getSystemMetric().then(setProgress);
        const cleanupCpu = window.electronAPI.onSystemMetric(setProgress);

        window.electronAPI.getGratingParams().then((params) => {
          console.log('[grating] Initial parameters:', params);
          if (params) setGratingParams(params);
        });
        const cleanupGrating = window.electronAPI.onGratingParams((params) => {
          console.log('[grating] Updated parameters:', params);
          if (params) setGratingParams(params);
        });

        return () => {
          cleanupCpu();
          cleanupGrating();
          cleanupSettings();
        };
      }

      return () => {
        cleanupSettings();
      };
    } else {
      // Fallback: random values for browser preview
      const tick = () => {
        setProgress({
          type: 'cpu_usage',
          value: Math.floor(Math.random() * 96) + 2,
          maxValue: 100,
          unit: '%'
        });
      };
      const first = setTimeout(tick, 1200);
      const interval = setInterval(tick, 3500);
      return () => {
        clearTimeout(first);
        clearInterval(interval);
      };
    }
  }, [isElectron, isSettings, applySettings]);

  // Settings window
  if (isSettings) {
    return <SettingsPanel />;
  }

  return (
    <div className="app-root">

      {!gratingParams?.obliquity && (
        <div className="no-grating-params">
          <div className="loading-content">
            <div className="loading-spinner" />
            <p>{t(settings.currentLanguage, 'noGratingParamsTips')}</p>
          </div>
        </div>
      )}

      <Canvas camera={{ position: [0, 0, 6.5], fov: 45 }}>
        <Scene
          progress={progress.value}
          maxValue={progress.maxValue}
          renderMode={renderMode}
          gratingParams={gratingParams}
          primaryColor={themeColors.primary}
          secondaryColor={themeColors.secondary}
          unit={progress.unit}
        />
      </Canvas>

      { !isElectron && <div className="debug-switcher" role="group" aria-label="Render mode switcher">
        {RENDER_MODES.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`debug-btn ${renderMode === item.key ? 'active' : ''}`}
            onClick={() => setRenderMode(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>}

    </div>
  );
}

export default App;
