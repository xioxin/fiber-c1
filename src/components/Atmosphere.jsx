import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Stars } from '@react-three/drei'
import * as THREE from 'three'

// Tiny floating orb for ambient atmosphere
function FloatOrb({ position, color, speed, radius }) {
  const ref = useRef()
  useFrame(({ clock }) => {
    if (!ref.current) return
    const t = clock.elapsedTime * speed
    ref.current.position.x = position[0] + Math.sin(t) * radius
    ref.current.position.y = position[1] + Math.cos(t * 0.7) * radius * 0.6
    ref.current.position.z = position[2] + Math.sin(t * 0.5) * radius * 0.4
  })
  return (
    <mesh ref={ref} position={position}>
      <sphereGeometry args={[0.04, 8, 8]} />
      <meshStandardMaterial
        color={color}
        emissive={color}
        emissiveIntensity={3}
        toneMapped={false}
      />
    </mesh>
  )
}

export function Atmosphere() {
  const orbs = [
    { position: [-2.5, 1.8, -1], color: '#00e5ff', speed: 0.4, radius: 0.6 },
    { position: [2.8, -1.2, -0.5], color: '#b020ff', speed: 0.55, radius: 0.5 },
    { position: [-1.8, -2.5, 0.5], color: '#00e5ff', speed: 0.3, radius: 0.7 },
    { position: [1.5, 2.2, -1.5], color: '#ff40cc', speed: 0.45, radius: 0.55 },
    { position: [3.0, 0.5, -1], color: '#b020ff', speed: 0.35, radius: 0.65 },
    { position: [-3.2, -0.8, 0], color: '#00ccff', speed: 0.5, radius: 0.4 },
  ]

  return (
    <>
      <Stars
        radius={60}
        depth={60}
        count={2500}
        factor={2.5}
        saturation={0.8}
        fade
        speed={0.5}
      />
      {orbs.map((o, i) => (
        <FloatOrb key={i} {...o} />
      ))}
    </>
  )
}
