import { useMemo, useRef, useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

const RADIUS      = 1.5
const TUBE_RADIUS = 0.32
const RADIAL_SEGS = 32   // cross-section roundness
const PATH_SEGS   = 360  // arc smoothness (1 per degree)

/** Full-circle curve starting at 12 o'clock, going clockwise. */
class FullCircle extends THREE.Curve {
  constructor(r) { super(); this._r = r }
  getPoint(t) {
    const a = Math.PI / 2 - 2 * Math.PI * t
    return new THREE.Vector3(Math.cos(a) * this._r, Math.sin(a) * this._r, 0)
  }
}

// Shared lighting function used by both tube and cap shaders
const lightingGLSL = /* glsl */ `
  vec3 applyLighting(vec3 base, vec3 N, vec3 V, vec3 colorA) {
    vec3 L1 = normalize(vec3(2.0, 3.0, 4.0));
    vec3 L2 = normalize(vec3(-2.0, -2.0, 1.0));
    float diff = max(dot(N, L1), 0.0) + max(dot(N, L2), 0.0) * 0.2;
    vec3  H    = normalize(L1 + V);
    float spec = pow(max(dot(N, H), 0.0), 90.0);
    float rim  = pow(1.0 - max(dot(V, N), 0.0), 2.5);
    return 0.12 * base
         + diff  * base
         + spec  * vec3(1.0, 0.95, 1.0) * 0.9
         + rim   * mix(colorA, vec3(1.0), 0.4) * 0.6;
  }
`

// ── Tube shader (vT comes from uv.x) ─────────────────────────────────────────
const vertexShader = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vViewPosition;
  varying float vT;
  void main() {
    vT = uv.x;
    vNormal = normalize(normalMatrix * normal);
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    vViewPosition = -mvPos.xyz;
    gl_Position = projectionMatrix * mvPos;
  }
`

const fragmentShader = lightingGLSL + /* glsl */ `
  uniform vec3  colorA;
  uniform vec3  colorB;
  uniform float progress;
  varying vec3  vNormal;
  varying vec3  vViewPosition;
  varying float vT;
  void main() {
    float gradT = progress > 0.001 ? clamp(vT / progress, 0.0, 1.0) : 0.0;
    vec3 base = mix(colorA, colorB, gradT);
    gl_FragColor = vec4(applyLighting(base, normalize(vNormal), normalize(vViewPosition), colorA), 1.0);
  }
`

// ── Cap shader (vT fixed via uniform capT) ────────────────────────────────────
const capVertexShader = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vViewPosition;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    vViewPosition = -mvPos.xyz;
    gl_Position = projectionMatrix * mvPos;
  }
`

const capFragmentShader = lightingGLSL + /* glsl */ `
  uniform vec3  colorA;
  uniform vec3  colorB;
  uniform float capT;   // 0.0 = start colour, 1.0 = end colour
  varying vec3  vNormal;
  varying vec3  vViewPosition;
  void main() {
    vec3 base = mix(colorA, colorB, capT);
    gl_FragColor = vec4(applyLighting(base, normalize(vNormal), normalize(vViewPosition), colorA), 1.0);
  }
`

export function DonutProgress({ progress }) {
  const groupRef    = useRef()
  const endCapRef   = useRef()
  const animRef     = useRef({ current: progress / 100, target: progress / 100 })
  const progressRef = useRef(progress)
  progressRef.current = progress

  // Full-circle tube — created ONCE, never rebuilt.
  // drawRange controls how much of it is rendered each frame.
  const geometry = useMemo(() => {
    const geom = new THREE.TubeGeometry(
      new FullCircle(RADIUS), PATH_SEGS, TUBE_RADIUS, RADIAL_SEGS, false,
    )
    // Set initial drawRange immediately so there's no full-circle flash
    geom.setDrawRange(0, Math.ceil(PATH_SEGS * (progress / 100)) * RADIAL_SEGS * 6)
    return geom
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => () => geometry.dispose(), [geometry])

  const uniforms = useMemo(() => ({
    colorA:   { value: new THREE.Color('#00e5ff') },
    colorB:   { value: new THREE.Color('#b020ff') },
    progress: { value: progress / 100 },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [])

  // Cap uniforms share the same colorA/colorB objects — colour is always in sync
  const startCapUniforms = useMemo(() => ({
    colorA: { value: new THREE.Color('#00e5ff') },
    colorB: { value: new THREE.Color('#b020ff') },
    capT:   { value: 0.0 },
  }), [])

  const endCapUniforms = useMemo(() => ({
    colorA: { value: new THREE.Color('#00e5ff') },
    colorB: { value: new THREE.Color('#b020ff') },
    capT:   { value: 1.0 },
  }), [])

  useFrame(({ clock }) => {
    animRef.current.target = progressRef.current / 100
    const { current, target } = animRef.current
    const next = current + (target - current) * 0.04
    animRef.current.current = next

    // Only update drawRange — no geometry rebuild, no flickering, no gaps
    geometry.setDrawRange(0, Math.ceil(PATH_SEGS * next) * RADIAL_SEGS * 6)
    uniforms.progress.value = next

    // Update end cap position along the arc
    if (endCapRef.current) {
      const a = Math.PI / 2 - 2 * Math.PI * next
      endCapRef.current.position.set(
        Math.cos(a) * RADIUS,
        Math.sin(a) * RADIUS,
        0,
      )
    }

    if (groupRef.current) {
      groupRef.current.rotation.y = clock.elapsedTime * 0.4
    }
  })

  // Start cap position: 12 o'clock = (0, RADIUS, 0)
  const startCapPos = [0, RADIUS, 0]
  // Initial end cap position based on initial progress
  const initAngle = Math.PI / 2 - 2 * Math.PI * (progress / 100)
  const initEndCapPos = [Math.cos(initAngle) * RADIUS, Math.sin(initAngle) * RADIUS, 0]

  return (
    <group ref={groupRef} rotation={[-0.35, 0, 0]}>
      {/* Progress arc tube */}
      <mesh geometry={geometry}>
        <shaderMaterial
          vertexShader={vertexShader}
          fragmentShader={fragmentShader}
          uniforms={uniforms}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Start cap — fixed at 12 o'clock, same shader as tube with capT=0 */}
      <mesh position={startCapPos}>
        <sphereGeometry args={[TUBE_RADIUS, RADIAL_SEGS, RADIAL_SEGS]} />
        <shaderMaterial
          vertexShader={capVertexShader}
          fragmentShader={capFragmentShader}
          uniforms={startCapUniforms}
        />
      </mesh>

      {/* End cap — follows arc end, same shader as tube with capT=1 */}
      <mesh ref={endCapRef} position={initEndCapPos}>
        <sphereGeometry args={[TUBE_RADIUS, RADIAL_SEGS, RADIAL_SEGS]} />
        <shaderMaterial
          vertexShader={capVertexShader}
          fragmentShader={capFragmentShader}
          uniforms={endCapUniforms}
        />
      </mesh>
    </group>
  )
}
