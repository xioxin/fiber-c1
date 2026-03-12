import { useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Text3D, Center } from '@react-three/drei'

export function PercentLabel({ progress }) {
  const [displayValue, setDisplayValue] = useState(progress)
  const animRef = useRef({ current: progress, target: progress })
  const displayRef = useRef(progress)
  const progressPropRef = useRef(progress)
  progressPropRef.current = progress

  useFrame(() => {
    animRef.current.target = progressPropRef.current
    const { current, target } = animRef.current
    animRef.current.current = current + (target - current) * 0.04

    const rounded = Math.round(animRef.current.current)
    if (rounded !== displayRef.current) {
      displayRef.current = rounded
      setDisplayValue(rounded)
    }
  })

  return (
    <Center position={[0, -2.05, 0]}>
      <Text3D
        font="/fonts/helvetiker_bold.typeface.json"
        size={0.58}
        height={0.16}
        curveSegments={12}
        bevelEnabled
        bevelThickness={0.03}
        bevelSize={0.025}
        bevelSegments={6}
      >
        {`${displayValue}%`}
        <meshStandardMaterial
          color="#e8e0ff"
          metalness={0.75}
          roughness={0.12}
          emissive="#4400aa"
          emissiveIntensity={0.35}
        />
      </Text3D>
    </Center>
  )
}
