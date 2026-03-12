import { useMemo, useRef, useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { ORB_LIGHTS } from './orbLightingConfig'

const RADIUS      = 1.5
const TUBE_RADIUS = 0.32
const RADIAL_SEGS = 32   // cross-section roundness
const PATH_SEGS   = 360  // arc smoothness (1 per degree)
const BASE_TILT_X = -0.35
const Y_SPIN_SPEED = 0.4
const ARC_DRIFT_SPEED = 0.16
const TILT_SWAY_AMOUNT = 0.06
const TILT_SWAY_SPEED = 0.7
const ORB_COUNT = ORB_LIGHTS.length

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
  uniform vec3  orbBasePos[${ORB_COUNT}];
  uniform vec3  orbColor[${ORB_COUNT}];
  uniform float orbSpeed[${ORB_COUNT}];
  uniform float orbRadius[${ORB_COUNT}];
  uniform float orbIntensity[${ORB_COUNT}];
  uniform float orbDistance[${ORB_COUNT}];
  uniform float orbTime;

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

  vec3 applyLighting(vec3 base, vec3 N, vec3 V, vec3 worldPos, vec3 colorA) {
    vec3 L1 = normalize(vec3(2.0, 3.0, 4.0));
    vec3 L2 = normalize(vec3(-2.0, -2.0, 1.0));
    float diff = max(dot(N, L1), 0.0) + max(dot(N, L2), 0.0) * 0.2;
    vec3  H    = normalize(L1 + V);
    float spec = pow(max(dot(N, H), 0.0), 90.0);
    float rim  = pow(1.0 - max(dot(V, N), 0.0), 2.5);
    return 0.12 * base
         + diff  * base
         + spec  * vec3(1.0, 0.95, 1.0) * 0.9
         + rim   * mix(colorA, vec3(1.0), 0.4) * 0.6
         + applyOrbLights(N, V, worldPos);
  }
`

// ── Tube shader (vT comes from uv.x) ─────────────────────────────────────────
const vertexShader = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vViewPosition;
  varying float vT;
  varying vec3 vWorldPos;
  void main() {
    vT = uv.x;
    vNormal = normalize(normalMatrix * normal);
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    vViewPosition = -mvPos.xyz;
    vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
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
  varying vec3  vWorldPos;
  void main() {
    float gradT = progress > 0.001 ? clamp(vT / progress, 0.0, 1.0) : 0.0;
    vec3 base = mix(colorA, colorB, gradT);
    gl_FragColor = vec4(applyLighting(base, normalize(vNormal), normalize(vViewPosition), vWorldPos, colorA), 1.0);
  }
`

// ── Cap shader (vT fixed via uniform capT) ────────────────────────────────────
const capVertexShader = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vViewPosition;
  varying vec3 vWorldPos;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    vViewPosition = -mvPos.xyz;
    vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * mvPos;
  }
`

const capFragmentShader = lightingGLSL + /* glsl */ `
  uniform vec3  colorA;
  uniform vec3  colorB;
  uniform float capT;   // 0.0 = start colour, 1.0 = end colour
  varying vec3  vNormal;
  varying vec3  vViewPosition;
  varying vec3  vWorldPos;
  void main() {
    vec3 base = mix(colorA, colorB, capT);
    gl_FragColor = vec4(applyLighting(base, normalize(vNormal), normalize(vViewPosition), vWorldPos, colorA), 1.0);
  }
`

export function DonutProgress({ progress }) {
  const groupRef    = useRef()
  const arcGroupRef = useRef()
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

  const orbUniforms = useMemo(
    () => ({
      orbBasePos: { value: ORB_LIGHTS.map((o) => new THREE.Vector3(o.position[0], o.position[1], o.position[2])) },
      orbColor: { value: ORB_LIGHTS.map((o) => new THREE.Color(o.color)) },
      orbSpeed: { value: ORB_LIGHTS.map((o) => o.speed) },
      orbRadius: { value: ORB_LIGHTS.map((o) => o.radius) },
      orbIntensity: { value: ORB_LIGHTS.map((o) => o.lightIntensity) },
      orbDistance: { value: ORB_LIGHTS.map((o) => o.lightDistance) },
      orbTime: { value: 0 },
    }),
    [],
  )

  const uniforms = useMemo(() => ({
    colorA:   { value: new THREE.Color('#00e5ff') },
    colorB:   { value: new THREE.Color('#b020ff') },
    progress: { value: progress / 100 },
    ...orbUniforms,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [orbUniforms])

  // Cap uniforms share the same colorA/colorB objects — colour is always in sync
  const startCapUniforms = useMemo(() => ({
    colorA: { value: new THREE.Color('#00e5ff') },
    colorB: { value: new THREE.Color('#b020ff') },
    capT:   { value: 0.0 },
    ...orbUniforms,
  }), [orbUniforms])

  const endCapUniforms = useMemo(() => ({
    colorA: { value: new THREE.Color('#00e5ff') },
    colorB: { value: new THREE.Color('#b020ff') },
    capT:   { value: 1.0 },
    ...orbUniforms,
  }), [orbUniforms])

  useFrame(({ clock }) => {
    animRef.current.target = progressRef.current / 100
    const { current, target } = animRef.current
    const next = current + (target - current) * 0.04
    animRef.current.current = next

    // Only update drawRange — no geometry rebuild, no flickering, no gaps
    geometry.setDrawRange(0, Math.ceil(PATH_SEGS * next) * RADIAL_SEGS * 6)
    uniforms.progress.value = next
    orbUniforms.orbTime.value = clock.elapsedTime

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
      groupRef.current.rotation.x = BASE_TILT_X + Math.sin(clock.elapsedTime * TILT_SWAY_SPEED) * TILT_SWAY_AMOUNT
      groupRef.current.rotation.y = clock.elapsedTime * Y_SPIN_SPEED
    }

    if (arcGroupRef.current) {
      // Rotate the progress arc clockwise around its own axis so the start point drifts
      arcGroupRef.current.rotation.z = -clock.elapsedTime * ARC_DRIFT_SPEED
    }
  })

  // Start cap position: 12 o'clock = (0, RADIUS, 0)
  const startCapPos = [0, RADIUS, 0]
  // Initial end cap position based on initial progress
  const initAngle = Math.PI / 2 - 2 * Math.PI * (progress / 100)
  const initEndCapPos = [Math.cos(initAngle) * RADIUS, Math.sin(initAngle) * RADIUS, 0]

  return (
    <group ref={groupRef} rotation={[BASE_TILT_X, 0, 0]}>
      <group ref={arcGroupRef}>
        {/* Progress arc tube */}
        <mesh geometry={geometry}>
          <shaderMaterial
            vertexShader={vertexShader}
            fragmentShader={fragmentShader}
            uniforms={uniforms}
            side={THREE.DoubleSide}
          />
        </mesh>

        {/* Start cap — fixed relative to the arc, but the whole arc now drifts */}
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
    </group>
  )
}
