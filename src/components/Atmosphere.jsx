import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Stars } from '@react-three/drei'
import { ORB_LIGHTS } from './orbLightingConfig'

// Tiny floating orb for ambient atmosphere
function FloatOrb({ position, color, speed, radius, lightIntensity, lightDistance, lightDecay }) {
  const ref = useRef()
  useFrame(({ clock }) => {
    if (!ref.current) return
    const t = clock.elapsedTime * speed
    ref.current.position.x = position[0] + Math.sin(t) * radius
    ref.current.position.y = position[1] + Math.cos(t * 0.7) * radius * 0.6
    ref.current.position.z = position[2] + Math.sin(t * 0.5) * radius * 0.4
  })
  return (
    <group ref={ref} position={position}>
      <mesh>
        <sphereGeometry args={[0.04, 8, 8]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={3}
          toneMapped={false}
        />
      </mesh>

      <pointLight
        color={color}
        intensity={lightIntensity}
        distance={lightDistance}
        decay={lightDecay}
      />
    </group>
  )
}

export function Atmosphere() {
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
      {ORB_LIGHTS.map((o, i) => (
        <FloatOrb key={i} {...o} />
      ))}
    </>
  )
}
