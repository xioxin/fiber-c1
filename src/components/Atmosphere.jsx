import { useRef, useMemo, useEffect } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { ORB_LIGHTS } from './orbLightingConfig'
import { cursorLightState } from './cursorLightState'

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

function CursorGlowOrb({ color, focusPoint }) {
  const groupRef = useRef()
  const haloRef = useRef()
  const lightRef = useRef()
  const pointerRef = useRef({ x: 0, y: 0 })
  const pointerInWindowRef = useRef(true)
  const pressedRef = useRef(false)
  const depthRef = useRef(0)
  const depthReadyRef = useRef(false)
  const pressAmountRef = useRef(0)
  const { camera, gl } = useThree()

  const camPos = useMemo(() => new THREE.Vector3(), [])
  const camRight = useMemo(() => new THREE.Vector3(), [])
  const camUp = useMemo(() => new THREE.Vector3(), [])
  const camForward = useMemo(() => new THREE.Vector3(), [])
  const targetPos = useMemo(() => new THREE.Vector3(), [])
  const focusPos = useMemo(() => new THREE.Vector3(), [])
  const focusOffset = useMemo(() => new THREE.Vector3(), [])

  useEffect(() => {
    cursorLightState.color.set(color)
  }, [color])

  useEffect(() => {
    const dom = gl.domElement

    const updatePointer = (event) => {
      const rect = dom.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return
      const x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      const y = -(((event.clientY - rect.top) / rect.height) * 2 - 1)
      pointerRef.current.x = THREE.MathUtils.clamp(x, -1, 1)
      pointerRef.current.y = THREE.MathUtils.clamp(y, -1, 1)
      pointerInWindowRef.current = true
    }

    const onPointerDown = (event) => {
      pressedRef.current = true
      pointerInWindowRef.current = true
      updatePointer(event)
    }

    const onPointerUp = () => {
      pressedRef.current = false
    }

    const hideCursorOrb = () => {
      pointerInWindowRef.current = false
      pressedRef.current = false
    }

    const onWindowMouseOut = (event) => {
      if (!event.relatedTarget && !event.toElement) {
        hideCursorOrb()
      }
    }

    const onWindowMouseOver = () => {
      pointerInWindowRef.current = true
    }

    const onVisibilityChange = () => {
      if (document.hidden) {
        hideCursorOrb()
      }
    }

    dom.addEventListener('pointermove', updatePointer)
    dom.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)
    window.addEventListener('mouseout', onWindowMouseOut)
    window.addEventListener('mouseover', onWindowMouseOver)
    window.addEventListener('blur', hideCursorOrb)
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      dom.removeEventListener('pointermove', updatePointer)
      dom.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
      window.removeEventListener('mouseout', onWindowMouseOut)
      window.removeEventListener('mouseover', onWindowMouseOver)
      window.removeEventListener('blur', hideCursorOrb)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [gl])

  useFrame((_, delta) => {
    if (!groupRef.current) return

    if (!pointerInWindowRef.current) {
      groupRef.current.visible = false
      cursorLightState.enabled = false
      cursorLightState.intensity = 0
      return
    }

    groupRef.current.visible = true

    const damping = 1 - Math.exp(-delta * 16)
    const targetPress = pressedRef.current ? 1 : 0
    pressAmountRef.current = THREE.MathUtils.lerp(pressAmountRef.current, targetPress, damping)

    camPos.setFromMatrixPosition(camera.matrixWorld)
    camRight.setFromMatrixColumn(camera.matrixWorld, 0).normalize()
    camUp.setFromMatrixColumn(camera.matrixWorld, 1).normalize()
    camForward.setFromMatrixColumn(camera.matrixWorld, 2).normalize().multiplyScalar(-1)

    focusPos.set(focusPoint[0], focusPoint[1], focusPoint[2])
    focusOffset.copy(focusPos).sub(camPos)
    const focusDepth = Math.max(0.35, focusOffset.dot(camForward))
    const targetDepth = pressedRef.current ? focusDepth + 0.15 : focusDepth-0.15

    if (!depthReadyRef.current) {
      depthRef.current = focusDepth
      depthReadyRef.current = true
    }
    depthRef.current = THREE.MathUtils.lerp(depthRef.current, targetDepth, damping)

    const depth = depthRef.current
    const viewHeight = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)) * depth
    const viewWidth = viewHeight * camera.aspect
    const offsetX = pointerRef.current.x * viewWidth * 0.5
    const offsetY = pointerRef.current.y * viewHeight * 0.5

    targetPos
      .copy(camPos)
      .addScaledVector(camForward, depth)
      .addScaledVector(camRight, offsetX)
      .addScaledVector(camUp, offsetY)

    groupRef.current.position.copy(targetPos)

    const pressAmount = pressAmountRef.current
    const scale = THREE.MathUtils.lerp(1, 0.84, pressAmount)
    groupRef.current.scale.setScalar(scale)

    if (haloRef.current) {
      haloRef.current.material.opacity = THREE.MathUtils.lerp(0.4, 0.24, pressAmount)
    }
    if (lightRef.current) {
      lightRef.current.intensity = THREE.MathUtils.lerp(3.8, 2.4, pressAmount)
    }

    cursorLightState.position.copy(groupRef.current.position)
    cursorLightState.color.set(color)
    cursorLightState.intensity = lightRef.current ? lightRef.current.intensity : 3.8
    cursorLightState.distance = 4.6
    cursorLightState.enabled = true
  })

  useEffect(() => {
    return () => {
      cursorLightState.enabled = false
      cursorLightState.intensity = 0
    }
  }, [])

  return (
    <group ref={groupRef}>
      <mesh>
        <sphereGeometry args={[0.05, 20, 20]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>

      <mesh ref={haloRef}>
        <sphereGeometry args={[0.12, 20, 20]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.4}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      <pointLight ref={lightRef} color={color} intensity={3.8} distance={4.6} decay={3} />
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
  const cursorColor = useMemo(() => {
    return '#' + new THREE.Color(primaryColor).lerp(new THREE.Color(secondaryColor), 0.35).getHexString()
  }, [primaryColor, secondaryColor])

  return (
    <>
      {ORB_LIGHTS.map((o, i) => (
        <FloatOrb key={i} {...o} color={orbColors[i]} />
      ))}
      <CursorGlowOrb color={cursorColor} focusPoint={[0, 0, 0]} />
    </>
  )
}
