import * as THREE from "three";
import { WebGLBackgroundCanvas, type WebGLBackgroundHandle } from "./webglBackgroundHost";

// The window-rain shader stays in JavaScript so the copied raindrop
// simulation math is preserved verbatim.
// @ts-expect-error window-rain source is intentionally preserved as JavaScript.
import { createWindowRainMaterial, updateWindowRainMaterial } from "./windowRain/window-rain-effect.js";
import { rainWindowFragmentShader } from "./windowRain/rain-window-shader";

// Same night-city photo the reference gallery's own scene.js loads behind
// the glass (256KB, negligible bundle cost).
const BACKGROUND_URL = "/threejs-bg/window-rain/background.webp";
const CLEAR_COLOR = 0x05080c;

function setup(_canvas: HTMLCanvasElement, renderer: THREE.WebGLRenderer): WebGLBackgroundHandle {
  renderer.setClearColor(CLEAR_COLOR, 1);
  renderer.toneMapping = THREE.NoToneMapping;

  const scene = new THREE.Scene();
  // The reference uses an orthographic camera framing exactly [-1,1]x[-1,1]
  // at the origin; a bare THREE.Camera() has identity projection/view
  // matrices, which is mathematically equivalent for a [-1,1] plane at z=0.
  const camera = new THREE.Camera();

  // Placeholder 1x1 texture until the real photo loads (setup() must return
  // synchronously); swapped in-place once ready.
  const backgroundTexture = new THREE.DataTexture(new Uint8Array([8, 10, 14, 255]), 1, 1);
  backgroundTexture.needsUpdate = true;
  const material = createWindowRainMaterial({
    background: backgroundTexture,
    fragmentShader: rainWindowFragmentShader,
    backgroundResolution: new THREE.Vector2(1, 1),
  }) as THREE.ShaderMaterial;

  let loadedTexture: THREE.Texture | null = null;
  new THREE.TextureLoader().load(BACKGROUND_URL, (texture) => {
    texture.colorSpace = THREE.SRGBColorSpace;
    material.uniforms.u_tex0.value = texture;
    material.uniforms.u_tex0_resolution.value.set(texture.image.width, texture.image.height);
    backgroundTexture.dispose();
    loadedTexture = texture;
  });

  const geometry = new THREE.PlaneGeometry(2, 2);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  scene.add(mesh);

  return {
    // The shader reads `gl_FragCoord`, which is in device (framebuffer)
    // pixels, not the CSS logical pixels this handle's `render(width,
    // height, ...)` reports — on a scaled display those differ by the
    // renderer's pixel ratio. Feeding it the logical size left everything
    // beyond the top-left 1/dpr fraction of the canvas sampling out of
    // range, which the shader's vignette term reads as deeply negative
    // (rendering as black). Use the renderer's actual drawing-buffer size
    // instead, which always matches gl_FragCoord's space.
    render(_width, _height, time) {
      const canvas = renderer.domElement;
      updateWindowRainMaterial(material, { elapsed: time, width: canvas.width, height: canvas.height });
      renderer.render(scene, camera);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      loadedTexture?.dispose();
    },
  };
}

export function WindowRainBg() {
  return <WebGLBackgroundCanvas setup={setup} />;
}
