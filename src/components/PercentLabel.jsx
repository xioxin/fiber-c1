import { useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Text3D, Center } from '@react-three/drei'
import * as THREE from 'three'

const lightingGLSL = /* glsl */ `
  vec3 applyLighting(vec3 base, vec3 N, vec3 V, vec3 colorA) {
    vec3 L1 = normalize(vec3(2.0, 3.0, 4.0));
    vec3 L2 = normalize(vec3(-2.0, -2.0, 1.0));
    float diff = max(dot(N, L1), 0.0) + max(dot(N, L2), 0.0) * 0.2;
    vec3 H = normalize(L1 + V);
    float spec = pow(max(dot(N, H), 0.0), 90.0);
    float rim = pow(1.0 - max(dot(V, N), 0.0), 2.4);
    return 0.15 * base
         + diff * base
         + spec * vec3(1.0, 0.95, 1.0) * 0.85
         + rim * mix(colorA, vec3(1.0), 0.45) * 0.7;
  }
`

const textVertexShader = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vViewPosition;
  varying vec3 vLocalPosition;
  void main() {
    vLocalPosition = position;
    vNormal = normalize(normalMatrix * normal);
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    vViewPosition = -mvPos.xyz;
    gl_Position = projectionMatrix * mvPos;
  }
`

const textFragmentShader = lightingGLSL + /* glsl */ `
  uniform vec3 colorA;
  uniform vec3 colorB;
  uniform float minX;
  uniform float maxX;
  varying vec3 vNormal;
  varying vec3 vViewPosition;
  varying vec3 vLocalPosition;
  void main() {
    float width = max(maxX - minX, 0.001);
    float gradT = clamp((vLocalPosition.x - minX) / width, 0.0, 1.0);
    vec3 base = mix(colorA, colorB, gradT);
    gl_FragColor = vec4(applyLighting(base, normalize(vNormal), normalize(vViewPosition), colorA), 1.0);
  }
`

export function PercentLabel({ progress }) {
  const [displayValue, setDisplayValue] = useState(progress)
  const textRef = useRef()
  const animRef = useRef({ current: progress, target: progress })
  const displayRef = useRef(progress)
  const progressPropRef = useRef(progress)
  progressPropRef.current = progress

  const uniforms = useMemo(
    () => ({
      colorA: { value: new THREE.Color('#00e5ff') },
      colorB: { value: new THREE.Color('#b020ff') },
      minX: { value: -1 },
      maxX: { value: 1 },
    }),
    [],
  )

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
        key={displayValue}
        ref={textRef}
        font="/fonts/helvetiker_bold.typeface.json"
        size={0.58}
        height={0.16}
        curveSegments={12}
        bevelEnabled
        bevelThickness={0.03}
        bevelSize={0.025}
        bevelSegments={6}
        onUpdate={(self) => {
          self.geometry.computeBoundingBox()
          const box = self.geometry.boundingBox
          if (box) {
            uniforms.minX.value = box.min.x
            uniforms.maxX.value = box.max.x
          }
        }}
      >
        {`${displayValue}%`}
        <shaderMaterial
          vertexShader={textVertexShader}
          fragmentShader={textFragmentShader}
          uniforms={uniforms}
          side={THREE.DoubleSide}
        />
      </Text3D>
    </Center>
  )
}
