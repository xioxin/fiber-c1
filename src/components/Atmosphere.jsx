import { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
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

/** Sample N evenly-spaced colors from a linear gradient between two hex colors. */
function sampleGradient(primaryColor, secondaryColor, count) {
  const c1 = new THREE.Color(primaryColor)
  const c2 = new THREE.Color(secondaryColor)
  return Array.from({ length: count }, (_, i) => {
    const t = count > 1 ? i / (count - 1) : 0
    return '#' + c1.clone().lerp(c2, t).getHexString()
  })
}

export function Atmosphere({ primaryColor = '#00e5ff', secondaryColor = '#b020ff' }) {
  // Recompute gradient colors only when theme colors change
  const orbColors = useMemo(
    () => sampleGradient(primaryColor, secondaryColor, ORB_LIGHTS.length),
    [primaryColor, secondaryColor],
  )

  return (
    <>
      {ORB_LIGHTS.map((o, i) => (
        <FloatOrb key={i} {...o} color={orbColors[i]} />
      ))}
    </>
  )
}
