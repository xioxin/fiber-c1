import { useState, useEffect, Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { DonutProgress } from "./components/DonutProgress";
import { PercentLabel } from "./components/PercentLabel";
import { Atmosphere } from "./components/Atmosphere";
import { LenticularInterlacer } from "./components/LenticularInterlacer";
import { LenticularOptics } from "./lenticular/config";

import "./App.css";

const RENDER_MODES = [
  { key: "single", label: "原始" },
  { key: "atlas", label: "40图" },
  { key: "interlaced", label: "交织图" },
];

function Scene({ progress, renderMode, gratingParams }) {
  return (
    <>
      <color attach="background" args={["#05050f"]} />

      {/* Lighting */}
      <ambientLight intensity={0.15} />
      <pointLight position={[4, 4, 6]} color="#00ccff" intensity={3} />
      <pointLight position={[-4, -4, 4]} color="#9900ff" intensity={2} />
      <directionalLight position={[0, 10, 5]} intensity={0.4} color="#ffffff" />
      <pointLight position={[0, 0, 8]} color="#ffffff" intensity={0.6} />

      <Atmosphere />

      {/* Donut progress ring */}
      <group position={[0, 0, 0]} scale={0.8}>
        <DonutProgress progress={progress} />
      </group>

      {/* 3D percentage text */}
      <group position={[0, 0, 0]} scale={0.9}>
        <Suspense fallback={null}>
          <PercentLabel progress={progress} />
        </Suspense>
      </group>

      {/* Render 40 views and interlace into the final on-screen image */}
      {renderMode !== "single" && (
        <LenticularInterlacer
          focusPoint={[0, 0, 0]}
          interlaced={renderMode === "interlaced"}
          obliquity={gratingParams.obliquity}
          lineNumber={gratingParams.lineNumber}
          deviation={gratingParams.deviation}
          thetaDeg={LenticularOptics.thetaDeg}
        />
      )}
      <OrbitControls enableZoom={false} enablePan={false} />
    </>
  );
}

function App() {
  const [progress, setProgress] = useState(0);
  const [renderMode, setRenderMode] = useState("interlaced");
  // Grating parameters: start with built-in defaults; updated from the
  // Cubestage / OpenstageAI platform once the Electron pipe connects.
  const [gratingParams, setGratingParams] = useState({
    obliquity: LenticularOptics.obliquity,
    lineNumber: LenticularOptics.lineNumber,
    deviation: LenticularOptics.deviation,
  });
  const [displayConnected, setDisplayConnected] = useState(false);
  const isElectron = typeof window !== "undefined" && !!window.electronAPI;

  useEffect(() => {
    if (isElectron) {
      // Get initial CPU value immediately
      window.electronAPI.getCpuLoad().then(setProgress);
      // Subscribe to push updates every second
      const cleanupCpu = window.electronAPI.onCpuLoad(setProgress);

      // Fetch grating params from the platform (or defaults if offline)
      window.electronAPI.getGratingParams().then((params) => {
        if (params) setGratingParams(params);
      });
      // Subscribe to live platform updates
      const cleanupGrating = window.electronAPI.onGratingParams((params) => {
        if (params) setGratingParams(params);
      });

      // Get initial C1 display connection state
      window.electronAPI.getDisplayStatus().then(({ connected }) => {
        setDisplayConnected(connected);
      });
      // Subscribe to C1 connect / disconnect events
      const cleanupDisplay = window.electronAPI.onDisplayStatus(
        ({ connected }) => {
          setDisplayConnected(connected);
        }
      );

      return () => {
        cleanupCpu();
        cleanupGrating();
        cleanupDisplay();
      };
    } else {
      // Fallback: random values for browser preview
      const tick = () => {
        setProgress(Math.floor(Math.random() * 96) + 2); // 2..97
      };
      const first = setTimeout(tick, 1200);
      const interval = setInterval(tick, 3500);
      return () => {
        clearTimeout(first);
        clearInterval(interval);
      };
    }
  }, [isElectron]);

  return (
    <div className="app-root">
      <Canvas camera={{ position: [0, 0, 6.5], fov: 45 }}>
        <Scene
          progress={progress}
          renderMode={renderMode}
          gratingParams={gratingParams}
        />
      </Canvas>

      {/* <div
        className="debug-switcher"
        role="group"
        aria-label="Render mode switcher"
      >
        {RENDER_MODES.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`debug-btn ${renderMode === item.key ? "active" : ""}`}
            onClick={() => setRenderMode(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div> */}
    </div>
  );
}

export default App;
