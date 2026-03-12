import { useEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import {
  ImgCountX,
  ImgCountY,
  OutPutSizeX,
  OutPutSizeY,
  SubWidth,
  SubHeight,
  ViewCount,
  AtlasWidth,
  AtlasHeight,
  LenticularOptics,
} from '../lenticular/config'

function toFloatString(value) {
  return Number.isInteger(value) ? `${value}.0` : `${value}`
}

function buildInterlaceFragmentShader() {
  return /* glsl */ `
    precision highp float;

    varying vec2 vUV;
    uniform sampler2D tDiffuse;
    uniform float slope;
    uniform float interval;
    uniform float x0;

    float row_img_num = ${toFloatString(ImgCountX)};
    float col_img_num = ${toFloatString(ImgCountY)};
    float num_of_view = ${toFloatString(ViewCount)};
    float gridSizeX = ${toFloatString(OutPutSizeX)};
    float gridSizeY = ${toFloatString(OutPutSizeY)};

    vec2 get_choice(vec2 pos, float bias) {
      float x = floor(pos.x * gridSizeX) + 1.0;
      float y = floor((1.0 - pos.y) * gridSizeY) + 1.0;

      float x1 = (x + y * slope) * 3.0 + bias;
      float x_local = mod(x1 + x0, interval);

      int choice = int(floor((x_local / interval) * num_of_view));

      vec2 choice_vec = vec2(
        row_img_num - mod(float(choice), row_img_num) - 1.0,
        floor(float(choice) / row_img_num)
      );

      vec2 reciprocals = vec2(1.0 / row_img_num, 1.0 / col_img_num);
      vec2 uv = (choice_vec.xy + pos) * reciprocals;
      return uv;
    }

    vec4 get_color(float bias) {
      vec2 sel_pos = get_choice(vUV, bias);
      return texture2D(tDiffuse, sel_pos);
    }

    void main() {
      vec4 color = get_color(0.0);
      color.g = get_color(1.0).g;
      color.b = get_color(2.0).b;
      gl_FragColor = vec4(color.rgb, 1.0);
    }
  `
}

function buildAtlasPreviewFragmentShader() {
  return /* glsl */ `
    precision highp float;
    varying vec2 vUV;
    uniform sampler2D tDiffuse;
    void main() {
      // Keep native atlas orientation from render target
      gl_FragColor = texture2D(tDiffuse, vUV);
    }
  `
}

const fullScreenVertexShader = /* glsl */ `
  varying vec2 vUV;
  void main() {
    vUV = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

const tempTarget = new THREE.Vector3()
const tempOffset = new THREE.Vector3()
const tempRotatedOffset = new THREE.Vector3()

export function LenticularInterlacer({ focusPoint = [0, 0, 0], mode = 'interlaced' }) {
  const { gl, size, scene } = useThree()

  const viewCameras = useMemo(
    () => Array.from({ length: ViewCount }, () => new THREE.PerspectiveCamera(45, SubWidth / SubHeight, 0.1, 100)),
    [],
  )

  const atlasTarget = useMemo(() => {
    const target = new THREE.WebGLRenderTarget(AtlasWidth, AtlasHeight, {
      depthBuffer: true,
      stencilBuffer: false,
    })
    target.texture.generateMipmaps = false
    target.texture.minFilter = THREE.LinearFilter
    target.texture.magFilter = THREE.LinearFilter
    return target
  }, [])

  const postScene = useMemo(() => new THREE.Scene(), [])
  const postCamera = useMemo(() => new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), [])

  const interlaceMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          tDiffuse: { value: atlasTarget.texture },
          slope: { value: LenticularOptics.obliquity },
          interval: { value: LenticularOptics.lineNumber },
          x0: { value: LenticularOptics.deviation },
        },
        vertexShader: fullScreenVertexShader,
        fragmentShader: buildInterlaceFragmentShader(),
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }),
    [atlasTarget.texture],
  )

  const atlasPreviewMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          tDiffuse: { value: atlasTarget.texture },
        },
        vertexShader: fullScreenVertexShader,
        fragmentShader: buildAtlasPreviewFragmentShader(),
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }),
    [atlasTarget.texture],
  )

  const fullScreenQuad = useMemo(() => {
    const geometry = new THREE.PlaneGeometry(2, 2)
    return new THREE.Mesh(geometry, interlaceMaterial)
  }, [interlaceMaterial])

  useEffect(() => {
    postScene.add(fullScreenQuad)
    return () => {
      postScene.remove(fullScreenQuad)
      fullScreenQuad.geometry.dispose()
      interlaceMaterial.dispose()
      atlasPreviewMaterial.dispose()
      atlasTarget.dispose()
    }
  }, [atlasPreviewMaterial, atlasTarget, fullScreenQuad, interlaceMaterial, postScene])

  useFrame((state) => {
    const mainCamera = state.camera
    if (!mainCamera || !mainCamera.isPerspectiveCamera) return

    const prevTarget = gl.getRenderTarget()
    const prevAutoClear = gl.autoClear
    const prevScissorTest = gl.getScissorTest()
    const prevXR = gl.xr.enabled

    gl.xr.enabled = false
    gl.autoClear = true

    if (mode !== 'single') {
      tempTarget.set(focusPoint[0], focusPoint[1], focusPoint[2])
      tempOffset.copy(mainCamera.position).sub(tempTarget)

      const thetaRad = THREE.MathUtils.degToRad(LenticularOptics.thetaDeg)
      const half = 0.5

      for (let i = 0; i < ViewCount; i += 1) {
        const cam = viewCameras[i]
        const t = ViewCount <= 1 ? 0 : i / (ViewCount - 1)
        const yaw = (t - half) * thetaRad

        tempRotatedOffset.copy(tempOffset).applyAxisAngle(mainCamera.up, yaw)

        cam.position.copy(tempTarget).add(tempRotatedOffset)
        cam.up.copy(mainCamera.up)
        cam.fov = mainCamera.fov
        cam.near = mainCamera.near
        cam.far = mainCamera.far
        cam.zoom = mainCamera.zoom
        cam.aspect = SubWidth / SubHeight
        cam.lookAt(tempTarget)
        cam.updateProjectionMatrix()
        cam.updateMatrixWorld()
      }

      gl.setRenderTarget(atlasTarget)
      gl.setScissorTest(true)
      gl.clear(true, true, true)

      for (let i = 0; i < ViewCount; i += 1) {
        const col = i % ImgCountX
        const row = ImgCountY - 1 - Math.floor(i / ImgCountX)

        const vx = col * SubWidth
        const vy = row * SubHeight

        gl.setViewport(vx, vy, SubWidth, SubHeight)
        gl.setScissor(vx, vy, SubWidth, SubHeight)
        gl.render(scene, viewCameras[i])
      }

      gl.setScissorTest(false)
    }

    gl.setRenderTarget(null)
    gl.setViewport(0, 0, size.width, size.height)
    gl.clear(true, true, true)

    if (mode === 'single') {
      gl.render(scene, mainCamera)
    } else {
      fullScreenQuad.material = mode === 'atlas' ? atlasPreviewMaterial : interlaceMaterial
      gl.render(postScene, postCamera)
    }

    gl.setRenderTarget(prevTarget)
    gl.setScissorTest(prevScissorTest)
    gl.autoClear = prevAutoClear
    gl.xr.enabled = prevXR
  }, 1)

  return null
}
