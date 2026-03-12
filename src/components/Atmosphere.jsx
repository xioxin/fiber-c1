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
    ref.current.position.x = position[0] * 0.5 + Math.sin(t) * radius
    ref.current.position.y = position[1] * 0.5 + Math.cos(t * 0.7) * radius * 0.6
    ref.current.position.z = position[2] * 0.5 + Math.sin(t * 0.5) * radius * 0.4
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
    { position: [-1.25,0.9,-0.5], color: '#00e5ff', speed: 0.4, radius: 0.6 },
    { position: [1.4,-0.6,-0.25], color: '#b020ff', speed: 0.55, radius: 0.5 },
    { position: [-0.9,-1.25,0.25], color: '#00e5ff', speed: 0.3, radius: 0.7 },
    { position: [0.75,1.1,-0.75], color: '#ff40cc', speed: 0.45, radius: 0.55 },
    { position: [1.5,0.25,-0.5], color: '#b020ff', speed: 0.35, radius: 0.65 },
    { position: [-1.6,-0.4,0], color: '#00ccff', speed: 0.5, radius: 0.4 },
  ]
  return (
    <>
      {/* <Stars
        radius={60}
        depth={60}
        count={2500}
        factor={2.5}
        saturation={0.8}
        fade
        speed={0.5}
      /> */}
      {orbs.map((o, i) => (
        <FloatOrb key={i} {...o} />
      ))}
    </>
  )
}
