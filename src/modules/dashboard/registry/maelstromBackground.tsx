import { useEffect, useRef } from "react";
import * as THREE from "three";
import { dynamicBackgroundDevicePixelRatio } from "./dynamicBackgroundCanvas";
import { useDashboardAnimationActive } from "../view/animationGating";

// Adapted for KKTerm from the Poseidon three.js ocean scene:
// https://github.com/owenyuwono/poseidon
//
// Poseidon's WebGPU FFT pipeline is intentionally reduced to a WebGL vertex
// spectrum here. This keeps its directional wind sea, swell, choppiness,
// whitecaps, analytic sky reflection, and fixed cinematic viewpoint while
// remaining available in WebViews that do not expose WebGPU.

export const MAELSTROM_WAVE_COUNT = 28;
export const MAELSTROM_CAMERA_SWEEP_SECONDS = 72;

export function maelstromCameraYaw(elapsedSeconds: number): number {
  return Math.sin((elapsedSeconds / MAELSTROM_CAMERA_SWEEP_SECONDS) * Math.PI * 2) * 0.12;
}

const VERTEX_SHADER = /* glsl */ `
  uniform float uTime;
  varying vec3 vWorldPosition;
  varying vec3 vNormal;
  varying float vFoam;

  float hash(float n) { return fract(sin(n * 127.1) * 43758.5453123); }

  void main() {
    vec3 p = position;
    vec3 tangentX = vec3(1.0, 0.0, 0.0);
    vec3 tangentZ = vec3(0.0, 0.0, 1.0);
    float frequency = 0.035;
    float amplitude = 1.15;
    float fold = 0.0;

    for (int i = 0; i < ${MAELSTROM_WAVE_COUNT}; i++) {
      float fi = float(i);
      float spread = (hash(fi + 3.7) * 2.0 - 1.0) * 1.05;
      float angle = 0.78 + spread;
      vec2 direction = vec2(cos(angle), sin(angle));
      float phase = frequency * dot(direction, p.xz)
        + uTime * sqrt(9.81 * frequency) * 1.08
        + hash(fi + 17.0) * 6.2831853;
      float steepness = 0.72 / (frequency * amplitude * float(${MAELSTROM_WAVE_COUNT}));
      float wave = sin(phase);
      float crest = cos(phase);

      p.xz += steepness * amplitude * direction * crest;
      p.y += amplitude * wave;
      float wa = frequency * amplitude;
      tangentX += vec3(
        -steepness * direction.x * direction.x * wa * wave,
        direction.x * wa * crest,
        -steepness * direction.x * direction.y * wa * wave
      );
      tangentZ += vec3(
        -steepness * direction.x * direction.y * wa * wave,
        direction.y * wa * crest,
        -steepness * direction.y * direction.y * wa * wave
      );
      fold += max(0.0, wave - 0.72) * wa;
      frequency *= 1.185;
      amplitude *= 0.825;
    }

    vec4 world = modelMatrix * vec4(p, 1.0);
    vWorldPosition = world.xyz;
    vNormal = normalize(mat3(modelMatrix) * cross(tangentZ, tangentX));
    vFoam = smoothstep(0.07, 0.28, fold);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  precision highp float;
  uniform float uTime;
  varying vec3 vWorldPosition;
  varying vec3 vNormal;
  varying float vFoam;

  const vec3 SUN_DIR = vec3(0.487, 0.469, -0.736);

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  vec3 skyColor(vec3 direction) {
    direction = normalize(direction);
    float horizon = pow(clamp(1.0 - max(direction.y, 0.0), 0.0, 1.0), 2.2);
    vec3 sky = mix(vec3(0.055, 0.16, 0.32), vec3(0.52, 0.66, 0.76), horizon);
    float sun = max(dot(direction, SUN_DIR), 0.0);
    sky += vec3(1.0, 0.88, 0.72) * (pow(sun, 9.0) * 0.25 + pow(sun, 900.0) * 5.0);
    return sky;
  }

  void main() {
    vec3 normal = normalize(vNormal);
    vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
    vec3 reflected = reflect(-viewDirection, normal);
    reflected.y = abs(reflected.y);
    float fresnel = 0.02 + 0.98 * pow(1.0 - max(dot(normal, viewDirection), 0.0), 5.0);
    float crestLight = pow(max(dot(normal, SUN_DIR), 0.0), 2.0);
    vec3 body = mix(vec3(0.018, 0.075, 0.105), vec3(0.10, 0.40, 0.43), crestLight);
    vec3 water = mix(body, skyColor(reflected), fresnel);
    float sparkle = hash21(floor(vWorldPosition.xz * 1.7 + uTime * 0.4));
    float foam = vFoam * smoothstep(0.22, 0.82, sparkle);
    vec3 color = mix(water, vec3(0.76, 0.84, 0.85), foam * 0.9);
    color = color / (color + vec3(0.72));
    color = pow(color, vec3(0.88));
    gl_FragColor = vec4(color, 1.0);
  }
`;

export function MaelstromBg() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const active = useDashboardAnimationActive();
  const activeRef = useRef(active);
  const runtimeRef = useRef<{ start: () => void; stop: () => void } | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x7896aa);
    scene.fog = new THREE.FogExp2(0x7896aa, 0.0045);
    const camera = new THREE.PerspectiveCamera(55, 1, 0.5, 4000);
    camera.position.set(0, 14, 58);
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(dynamicBackgroundDevicePixelRatio(window.devicePixelRatio));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);

    const uniforms = { uTime: { value: 0 } };
    const geometry = new THREE.PlaneGeometry(520, 520, 220, 220);
    geometry.rotateX(-Math.PI / 2);
    const material = new THREE.ShaderMaterial({ vertexShader: VERTEX_SHADER, fragmentShader: FRAGMENT_SHADER, uniforms });
    const ocean = new THREE.Mesh(geometry, material);
    ocean.frustumCulled = false;
    scene.add(ocean);

    let raf = 0;
    let elapsed = 0;
    let lastNow = 0;

    function resize() {
      const rect = host.getBoundingClientRect();
      const width = Math.max(2, Math.floor(rect.width));
      const height = Math.max(2, Math.floor(rect.height));
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    }

    function frame(now: number) {
      const dt = lastNow ? Math.min((now - lastNow) / 1000, 0.05) : 0;
      lastNow = now;
      elapsed += dt;
      uniforms.uTime.value = elapsed;
      const yaw = maelstromCameraYaw(elapsed);
      camera.position.x = Math.sin(yaw) * 60;
      camera.position.z = Math.cos(yaw) * 60;
      camera.position.y = 14 + Math.sin(elapsed * 0.18) * 0.8;
      camera.lookAt(0, 0.5, -24);
      renderer.render(scene, camera);
      raf = activeRef.current ? requestAnimationFrame(frame) : 0;
    }

    function start() {
      if (raf || !activeRef.current) return;
      lastNow = 0;
      raf = requestAnimationFrame(frame);
    }

    function stop() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      lastNow = 0;
    }

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);
    resize();
    runtimeRef.current = { start, stop };
    if (activeRef.current) start();

    return () => {
      stop();
      resizeObserver.disconnect();
      runtimeRef.current = null;
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, []);

  useEffect(() => {
    activeRef.current = active;
    if (active) runtimeRef.current?.start();
    else runtimeRef.current?.stop();
  }, [active]);

  return <div ref={hostRef} className="dw-dynamic-bg-canvas" />;
}
