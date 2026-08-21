import * as THREE from "three";

export const windowRainVertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export function createWindowRainMaterial({
  background,
  fragmentShader,
  backgroundResolution = new THREE.Vector2(1920, 1080),
} = {}) {
  if (!background) throw new Error("createWindowRainMaterial requires a background texture");
  if (!fragmentShader) throw new Error("createWindowRainMaterial requires the copied rain fragment shader");

  return new THREE.ShaderMaterial({
    uniforms: {
      u_tex0: { value: background },
      u_tex0_resolution: { value: backgroundResolution.clone() },
      u_time: { value: 0 },
      u_resolution: { value: new THREE.Vector2(1, 1) },
      u_speed: { value: 0.25 },
      u_intensity: { value: 0.4 },
      u_normal: { value: 0.5 },
      u_brightness: { value: 0.8 },
      u_blur_intensity: { value: 0.5 },
      u_zoom: { value: 2.61 },
      u_blur_iterations: { value: 16 },
      u_panning: { value: false },
      u_post_processing: { value: true },
      u_lightning: { value: false },
      u_texture_fill: { value: true },
    },
    vertexShader: windowRainVertexShader,
    fragmentShader,
  });
}

export function updateWindowRainMaterial(material, {
  elapsed,
  width,
  height,
  debugMode = "final",
} = {}) {
  material.uniforms.u_time.value = elapsed % 21600;
  material.uniforms.u_resolution.value.set(width, height);
  material.uniforms.u_blur_iterations.value = debugMode === "drops" ? 1 : 16;
  material.uniforms.u_blur_intensity.value = debugMode === "drops" ? 0 : 0.5;
  material.uniforms.u_post_processing.value = debugMode !== "raw";
  material.uniforms.u_normal.value = debugMode === "no-refraction" ? 0 : 0.5;
}
