import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
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
} from "../lenticular/config";

function toFloatString(value) {
  return Number.isInteger(value) ? `${value}.0` : `${value}`;
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
  `;
}

function buildAtlasPreviewFragmentShader() {
  return /* glsl */ `
    precision highp float;
    varying vec2 vUV;
    uniform sampler2D tDiffuse;
    void main() {
      gl_FragColor = texture2D(tDiffuse, vUV);
    }
  `;
}

const fullScreenVertexShader = /* glsl */ `
  varying vec2 vUV;
  void main() {
    vUV = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const tempTarget = new THREE.Vector3();
const tempRight = new THREE.Vector3();

export function LenticularInterlacer({
  focusPoint = [0, 0, 0],
  interlaced = true,
  slope = 0.10516,
  interval = 19.6401,
  x0 = 16.25578,
  thetaDeg = 40.0,
}) {
  const { gl, size, scene } = useThree();

  const viewCamerasRef = useRef(null);
  if (viewCamerasRef.current === null) {
    viewCamerasRef.current = Array.from(
      { length: ViewCount },
      () => {
        const cam = new THREE.PerspectiveCamera(45, SubWidth / SubHeight, 0.1, 100);
        cam.matrixAutoUpdate = false;
        return cam;
      },
    );
  }

  const atlasTarget = useMemo(() => {
    const target = new THREE.WebGLRenderTarget(AtlasWidth, AtlasHeight, {
      depthBuffer: true,
      stencilBuffer: false,
    });
    target.texture.generateMipmaps = false;
    target.texture.minFilter = THREE.LinearFilter;
    target.texture.magFilter = THREE.LinearFilter;
    return target;
  }, []);

  const interlaceScene = useMemo(() => new THREE.Scene(), []);
  const previewScene = useMemo(() => new THREE.Scene(), []);
  const postCamera = useMemo(
    () => new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1),
    [],
  );

  const interlaceMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          tDiffuse: { value: atlasTarget.texture },
          slope: { value: slope },
          interval: { value: interval },
          x0: { value: x0 },
        },
        vertexShader: fullScreenVertexShader,
        fragmentShader: buildInterlaceFragmentShader(),
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }),
    [atlasTarget.texture, slope, interval, x0],
  );

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
  );

  const interlaceQuad = useMemo(() => {
    const geometry = new THREE.PlaneGeometry(2, 2);
    return new THREE.Mesh(geometry, interlaceMaterial);
  }, [interlaceMaterial]);

  const previewQuad = useMemo(() => {
    const geometry = new THREE.PlaneGeometry(2, 2);
    return new THREE.Mesh(geometry, atlasPreviewMaterial);
  }, [atlasPreviewMaterial]);

  useEffect(() => {
    interlaceScene.add(interlaceQuad);
    previewScene.add(previewQuad);
    return () => {
      interlaceScene.remove(interlaceQuad);
      previewScene.remove(previewQuad);
      interlaceQuad.geometry.dispose();
      previewQuad.geometry.dispose();
      interlaceMaterial.dispose();
      atlasPreviewMaterial.dispose();
      atlasTarget.dispose();
    };
  }, [
    atlasPreviewMaterial,
    atlasTarget,
    interlaceMaterial,
    interlaceQuad,
    interlaceScene,
    previewQuad,
    previewScene,
  ]);

  useFrame((state) => {
    const mainCamera = state.camera;
    if (!mainCamera || !mainCamera.isPerspectiveCamera) return;

    const viewCameras = viewCamerasRef.current;
    const prevTarget = gl.getRenderTarget();
    const prevScissorTest = gl.getScissorTest();

    tempTarget.set(focusPoint[0], focusPoint[1], focusPoint[2]);
    const focusDistance = mainCamera.position.distanceTo(tempTarget);

    tempRight
      .set(1, 0, 0)
      .applyQuaternion(mainCamera.quaternion)
      .normalize();

    const thetaRad = THREE.MathUtils.degToRad(thetaDeg);
    const totalShift = 2.0 * focusDistance * Math.tan(thetaRad / 2.0);

    const fov = mainCamera.fov;
    const near = mainCamera.near;
    const far = mainCamera.far;
    const zoom = mainCamera.zoom;
    const aspect = SubWidth / SubHeight;

    const top = (near * Math.tan(THREE.MathUtils.degToRad(fov * 0.5))) / zoom;
    const bottom = -top;
    const halfWidth = top * aspect;

    for (let i = 0; i < ViewCount; i += 1) {
      const cam = viewCameras[i];

      // t ∈ [-0.5, +0.5]，表示当前视角在总范围中的归一化位置
      const t = ViewCount <= 1 ? 0 : i / (ViewCount - 1) - 0.5;

      // 当前相机相对于主相机的水平偏移量（世界坐标）
      const shift = t * totalShift;

      cam.position.copy(mainCamera.position);
      cam.position.addScaledVector(tempRight, shift);

      cam.quaternion.copy(mainCamera.quaternion);
      cam.up.copy(mainCamera.up);

      const shiftOnNear = shift * near / focusDistance;

      const left = -halfWidth + shiftOnNear;
      const right = halfWidth + shiftOnNear;

      cam.projectionMatrix.makePerspective(left, right, top, bottom, near, far);
      cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();

      cam.updateMatrix();
      cam.updateMatrixWorld(true);
    }

    gl.setRenderTarget(atlasTarget);
    gl.setScissorTest(true);
    gl.clear(true, true, true);

    for (let i = 0; i < ViewCount; i += 1) {
      const col = i % ImgCountX;
      const row = ImgCountY - 1 - Math.floor(i / ImgCountX);

      const vx = col * SubWidth;
      const vy = row * SubHeight;

      gl.setViewport(vx, vy, SubWidth, SubHeight);
      gl.setScissor(vx, vy, SubWidth, SubHeight);
      gl.render(scene, viewCameras[i]);
    }

    gl.setScissorTest(false);

    gl.setRenderTarget(null);
    gl.setViewport(0, 0, size.width, size.height);
    gl.clear(true, true, true);

    gl.render(interlaced ? interlaceScene : previewScene, postCamera);

    gl.setRenderTarget(prevTarget);
    gl.setScissorTest(prevScissorTest);
  }, 1);

  return null;
}