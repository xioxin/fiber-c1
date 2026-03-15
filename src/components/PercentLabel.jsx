import { useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Text3D, Center } from '@react-three/drei'
import * as THREE from 'three'
import { ORB_LIGHTS } from './orbLightingConfig'
import { cursorLightState } from './cursorLightState'

const ORB_COUNT = ORB_LIGHTS.length

// Module-level temp Color objects for allocation-free gradient sampling.
const _tmpGradA = new THREE.Color()
const _tmpGradB = new THREE.Color()

const lightingGLSL = /* glsl */ `
  uniform vec3  orbBasePos[${ORB_COUNT}];
  uniform vec3  orbColor[${ORB_COUNT}];
  uniform float orbSpeed[${ORB_COUNT}];
  uniform float orbRadius[${ORB_COUNT}];
  uniform float orbIntensity[${ORB_COUNT}];
  uniform float orbDistance[${ORB_COUNT}];
  uniform float orbTime;

  uniform vec3  cursorLightPos;
  uniform vec3  cursorLightColor;
  uniform float cursorLightIntensity;
  uniform float cursorLightDistance;
  uniform float cursorLightEnabled;

  vec3 applyOrbLights(vec3 N, vec3 V, vec3 worldPos) {
    vec3 acc = vec3(0.0);
    for (int i = 0; i < ${ORB_COUNT}; i++) {
      float t = orbTime * orbSpeed[i];
      vec3 orbPos = orbBasePos[i] + vec3(
        sin(t) * orbRadius[i],
        cos(t * 0.7) * orbRadius[i] * 0.6,
        sin(t * 0.5) * orbRadius[i] * 0.4
      );

      vec3 toLight = orbPos - worldPos;
      float dist = length(toLight);
      float att = pow(max(1.0 - dist / orbDistance[i], 0.0), 2.0);
      if (att <= 0.0) continue;

      vec3 L = normalize(toLight);
      float diff = max(dot(N, L), 0.0) * orbIntensity[i] * att;
      vec3 H = normalize(L + V);
      float spec = pow(max(dot(N, H), 0.0), 36.0) * 0.35 * orbIntensity[i] * att;
      acc += (diff + spec) * orbColor[i];
    }
    return acc;
  }

  vec3 applyCursorLight(vec3 N, vec3 V, vec3 worldPos) {
    if (cursorLightEnabled < 0.5) return vec3(0.0);

    vec3 toLight = cursorLightPos - worldPos;
    float dist = length(toLight);
    float falloff = max(cursorLightDistance, 0.001);
    float att = pow(max(1.0 - dist / falloff, 0.0), 2.0);
    if (att <= 0.0) return vec3(0.0);

    vec3 L = normalize(toLight);
    float diff = max(dot(N, L), 0.0) * cursorLightIntensity * att;
    vec3 H = normalize(L + V);
    float spec = pow(max(dot(N, H), 0.0), 48.0) * 0.4 * cursorLightIntensity * att;
    return (diff + spec) * cursorLightColor;
  }

  vec3 applyLighting(vec3 base, vec3 N, vec3 V, vec3 worldPos, vec3 colorA) {
    vec3 L1 = normalize(vec3(2.0, 3.0, 4.0));
    vec3 L2 = normalize(vec3(-2.0, -2.0, 1.0));
    float diff = max(dot(N, L1), 0.0) + max(dot(N, L2), 0.0) * 0.2;
    vec3 H = normalize(L1 + V);
    float spec = pow(max(dot(N, H), 0.0), 90.0);
    float rim = pow(1.0 - max(dot(V, N), 0.0), 2.4);
    return 0.15 * base
         + diff * base
         + spec * vec3(1.0, 0.95, 1.0) * 0.85
         + rim * mix(colorA, vec3(1.0), 0.45) * 0.7
          + applyOrbLights(N, V, worldPos)
          + applyCursorLight(N, V, worldPos);
  }
`

const textVertexShader = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vViewPosition;
  varying vec3 vLocalPosition;
  varying vec3 vWorldPos;
  void main() {
    vLocalPosition = position;
    vNormal = normalize(normalMatrix * normal);
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    vViewPosition = -mvPos.xyz;
    vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
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
  varying vec3 vWorldPos;
  void main() {
    float width = max(maxX - minX, 0.001);
    float gradT = clamp((vLocalPosition.x - minX) / width, 0.0, 1.0);
    vec3 base = mix(colorA, colorB, gradT);
    gl_FragColor = vec4(applyLighting(base, normalize(vNormal), normalize(vViewPosition), vWorldPos, colorA), 1.0);
  }
`

export function PercentLabel({ progress, primaryColor = '#00e5ff', secondaryColor = '#b020ff', unit = '%' }) {
  const [displayValue, setDisplayValue] = useState(progress)
  const [displayUnit, setDisplayUnit] = useState(unit)
  const fontUrl = `${import.meta.env.BASE_URL}fonts/helvetiker_bold.typeface.json`
  const textRef = useRef()
  const animRef = useRef({ current: progress, target: progress })
  const displayRef = useRef(progress)
  const progressPropRef = useRef(progress)
  progressPropRef.current = progress
  const primaryColorRef = useRef(primaryColor)
  primaryColorRef.current = primaryColor
  const secondaryColorRef = useRef(secondaryColor)
  secondaryColorRef.current = secondaryColor
  const unitRef = useRef(unit)
  unitRef.current = unit

  const uniforms = useMemo(
    () => ({
      colorA: { value: new THREE.Color(primaryColor) },
      colorB: { value: new THREE.Color(secondaryColor) },
      minX: { value: -1 },
      maxX: { value: 1 },
      orbBasePos: { value: ORB_LIGHTS.map((o) => new THREE.Vector3(o.position[0], o.position[1], o.position[2])) },
      orbColor: { value: ORB_LIGHTS.map((o) => new THREE.Color(o.color)) },
      orbSpeed: { value: ORB_LIGHTS.map((o) => o.speed) },
      orbRadius: { value: ORB_LIGHTS.map((o) => o.radius) },
      orbIntensity: { value: ORB_LIGHTS.map((o) => o.lightIntensity) },
      orbDistance: { value: ORB_LIGHTS.map((o) => o.lightDistance) },
      orbTime: { value: 0 },
      cursorLightPos: { value: new THREE.Vector3() },
      cursorLightColor: { value: new THREE.Color('#ffffff') },
      cursorLightIntensity: { value: 0 },
      cursorLightDistance: { value: 4.6 },
      cursorLightEnabled: { value: 0 },
    }),
    // Colors and orb properties are intentionally excluded from deps: the Color
    // objects are mutated in-place each frame inside useFrame (via refs and the
    // _tmpGrad* helpers), so rebuilding the uniforms object would wastefully
    // recompile the shader on every theme change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  useFrame(({ clock }) => {
    animRef.current.target = progressPropRef.current
    const { current, target } = animRef.current
    animRef.current.current = current + (target - current) * 0.04
    uniforms.orbTime.value = clock.elapsedTime
    uniforms.colorA.value.set(primaryColorRef.current)
    uniforms.colorB.value.set(secondaryColorRef.current)

    // Update orb lighting colors to match theme gradient
    _tmpGradA.set(primaryColorRef.current)
    _tmpGradB.set(secondaryColorRef.current)
    const orbColors = uniforms.orbColor.value
    for (let i = 0; i < ORB_COUNT; i++) {
      const t = ORB_COUNT > 1 ? i / (ORB_COUNT - 1) : 0
      orbColors[i].copy(_tmpGradA).lerp(_tmpGradB, t)
    }

    // Sync cursor light for text shader lighting.
    uniforms.cursorLightPos.value.copy(cursorLightState.position)
    uniforms.cursorLightColor.value.copy(cursorLightState.color)
    uniforms.cursorLightIntensity.value = cursorLightState.intensity
    uniforms.cursorLightDistance.value = cursorLightState.distance
    uniforms.cursorLightEnabled.value = cursorLightState.enabled ? 1 : 0

    const rounded = Math.round(animRef.current.current)
    const currentUnit = unitRef.current
    if (rounded !== displayRef.current || currentUnit !== displayUnit) {
      displayRef.current = rounded
      setDisplayValue(rounded)
      setDisplayUnit(currentUnit)
    }
  })

  return (
    <Center key={`${displayValue}${displayUnit}`} position={[0, 0, 0]}>
      <Text3D
        ref={textRef}
        font={fontUrl}
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
        {`${displayValue}${displayUnit}`}
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
