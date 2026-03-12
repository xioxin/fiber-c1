import { useState, useEffect, Suspense } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { DonutProgress } from './components/DonutProgress'
import { PercentLabel } from './components/PercentLabel'
import { Atmosphere } from './components/Atmosphere'
import { LenticularInterlacer } from './components/LenticularInterlacer'
import { LenticularOptics } from './lenticular/config'

import './App.css'

const RENDER_MODES = [
  { key: 'single', label: '原始单画面' },
  { key: 'atlas', label: '40图（未交织）' },
  { key: 'interlaced', label: '最终结果（交织图）' },
]

function Scene({ progress, renderMode }) {
  return (
    <>
      <color attach="background" args={['#05050f']} />

      {/* Lighting */}
      <ambientLight intensity={0.15} />
      <pointLight position={[4, 4, 6]} color="#00ccff" intensity={3} />
      <pointLight position={[-4, -4, 4]} color="#9900ff" intensity={2} />
      <directionalLight position={[0, 10, 5]} intensity={0.4} color="#ffffff" />
      <pointLight position={[0, 0, 8]} color="#ffffff" intensity={0.6} />

      <Atmosphere />

      {/* Donut progress ring */}
      <group position={[0, 0.72, 0]} scale={0.80}>
        <DonutProgress progress={progress} />
      </group>

      {/* 3D percentage text */}
      <Suspense fallback={null}>
        <PercentLabel progress={progress} />
      </Suspense>

      {/* Render 40 views and interlace into the final on-screen image */}
      <LenticularInterlacer
        focusPoint={[0, 0, 0]}
        mode={renderMode}
        obliquity={LenticularOptics.obliquity}
        lineNumber={LenticularOptics.lineNumber}
        deviation={LenticularOptics.deviation}
        thetaDeg={LenticularOptics.thetaDeg}
      />

      <OrbitControls enableZoom={false} enablePan={false} />
    </>
  )
}

function App() {
  const [progress, setProgress] = useState(65)
  const [renderMode, setRenderMode] = useState('interlaced')

  useEffect(() => {
    const tick = () => {
      setProgress(Math.floor(Math.random() * 96) + 2) // 2..97
    }
    // First change after a short delay, then every 3.5s
    const first = setTimeout(tick, 1200)
    const interval = setInterval(tick, 3500)
    return () => {
      clearTimeout(first)
      clearInterval(interval)
    }
  }, [])

  return (
    <div className="app-root">
      <Canvas camera={{ position: [0, 0, 6.5], fov: 45 }}>
        <Scene progress={progress} renderMode={renderMode} />
      </Canvas>

      <div className="debug-switcher" role="group" aria-label="Render mode switcher">
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
      </div>
    </div>
  )
}

export default App
