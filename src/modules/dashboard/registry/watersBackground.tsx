import { useEffect, useRef } from "react";
import * as THREE from "three";
import { dynamicBackgroundDevicePixelRatio } from "./dynamicBackgroundCanvas";
import { useDashboardAnimationActive } from "../view/animationGating";

// "Waters" is an original KKTerm reduction of the open-source WaterThreeJS
// ocean (https://github.com/achrefelouafi/WaterThreeJS, MIT). It keeps the
// techniques that give that scene its look — a procedural Gerstner wave
// spectrum with deep-water dispersion, the shared analytic atmosphere used for
// both the sky and the water reflections, Beer–Lambert depth colour, GGX sun
// glints, and Jacobian-seeded foam — and drops everything a Dashboard
// background cannot use: the island, screen-space reflections, the refraction
// and depth passes, floating bodies, the underwater camera, volumetric clouds
// and the post chain. There is no user input here, so the camera pans on a
// fixed cinematic sweep instead of orbit controls.

export const WATERS_WAVE_COUNT = 22;
export const WATERS_CAMERA_SWEEP_SECONDS = 96;
export const WATERS_CAMERA_YAW_RADIANS = 0.17;
export const WATERS_SUN_DIRECTION: readonly [number, number, number] = [0.3, 0.42, -0.86];

/** Camera yaw for the endless sweep, in radians. Pure so tests can sample it. */
export function watersCameraYaw(elapsedSeconds: number): number {
  const phase = (elapsedSeconds / WATERS_CAMERA_SWEEP_SECONDS) * Math.PI * 2;
  return Math.sin(phase) * WATERS_CAMERA_YAW_RADIANS;
}

/** Camera eye height in metres for the same sweep. */
export function watersCameraHeight(elapsedSeconds: number): number {
  return 11.5 + Math.sin(elapsedSeconds * 0.21) * 0.7;
}

const SCENE_CONSTANTS_GLSL = /* glsl */ `
  const vec3  SUN_DIR = normalize(vec3(${WATERS_SUN_DIRECTION.join(", ")}));
  const vec2  WIND_DIR = vec2(0.87656, 0.48211);
`;

// Hashing plus value noise with analytic derivatives (after Inigo Quilez); the
// gradient in .yz is what makes the detail normals free.
const NOISE_GLSL = /* glsl */ `
  float hash21(vec2 p){
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  vec3 noised(vec2 x){
    vec2 p = floor(x);
    vec2 f = fract(x);
    vec2 u  = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    vec2 du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
    float a = hash21(p + vec2(0.0, 0.0));
    float b = hash21(p + vec2(1.0, 0.0));
    float c = hash21(p + vec2(0.0, 1.0));
    float d = hash21(p + vec2(1.0, 1.0));
    float k1 = b - a;
    float k2 = c - a;
    float k3 = a - b - c + d;
    float n  = a + k1 * u.x + k2 * u.y + k3 * u.x * u.y;
    vec2  g  = du * vec2(k1 + k3 * u.y, k2 + k3 * u.x);
    return vec3(n, g);
  }

  const mat2 FBM_M = mat2(1.6, 1.2, -1.2, 1.6);

  float fbm(vec2 p, int oct){
    float amp = 0.5;
    float sum = 0.0;
    for (int i = 0; i < 5; i++){
      if (i >= oct) break;
      sum += amp * noised(p).x;
      p = FBM_M * p;
      amp *= 0.5;
    }
    return sum;
  }
`;

// One analytic atmosphere shared by the sky dome and the water reflection, so
// the horizon, clouds and sun in the reflection always match the real sky. The
// sun disc is deliberately far brighter than display range: it is what drives
// the glints once the frame is tone-mapped.
const ATMOSPHERE_GLSL = /* glsl */ `
  vec3 atmosphere(vec3 dir){
    dir = normalize(dir);
    float up = clamp(dir.y, -1.0, 1.0);
    float sunAmt = max(dot(dir, SUN_DIR), 0.0);
    float sunElev = clamp(SUN_DIR.y, 0.0, 1.0);

    vec3 zenith  = mix(vec3(0.06, 0.19, 0.52), vec3(0.09, 0.28, 0.66), sunElev);
    vec3 horizon = mix(vec3(0.44, 0.56, 0.75), vec3(0.60, 0.74, 0.90), sunElev);
    float h = pow(clamp(1.0 - up, 0.0, 1.0), 2.6);
    vec3 col = mix(zenith, horizon, h);

    col = mix(col, vec3(1.0, 0.72, 0.45), h * pow(sunAmt, 2.5) * (0.75 - 0.5 * sunElev));
    col = mix(col, vec3(0.05, 0.10, 0.15), smoothstep(0.0, -0.22, up));

    if (up > 0.04){
      float t = 900.0 / max(up, 0.05);
      vec2 cp = dir.xz * t * 0.0011 + uTime * vec2(0.006, 0.004);
      float density = fbm(cp, 5) * 0.7 + fbm(cp * 2.9 + 4.0, 4) * 0.3;
      float cover = smoothstep(0.48, 0.66, density) * smoothstep(0.05, 0.26, up);
      float shade = smoothstep(0.46, 0.82, density);
      vec3 cloudDark = mix(vec3(0.36, 0.40, 0.50), vec3(0.55, 0.44, 0.42), 1.0 - sunElev);
      vec3 cloudCol = mix(cloudDark, vec3(1.12, 1.08, 1.02), shade);
      cloudCol += vec3(1.0, 0.82, 0.55) * pow(sunAmt, 4.0) * 0.7;
      col = mix(col, cloudCol, cover);
    }

    vec3 sunTint = mix(vec3(1.00, 0.52, 0.24), vec3(1.00, 0.96, 0.88), sunElev);
    col += sunTint * (pow(sunAmt, 8.0) * 0.35 + pow(sunAmt, 90.0) * 0.6) * (0.6 + 0.4 * h);
    col += sunTint * smoothstep(0.99955, 0.99978, sunAmt) * 14.0;

    return max(col, vec3(0.0));
  }
`;

// A procedurally generated Gerstner spectrum: direction and phase are hashed
// per wave so the field never visibly tiles, frequency and amplitude follow
// geometric progressions from the long swell down to fine chop, and each wave
// travels at the deep-water phase speed sqrt(g*k). The same loop yields the
// analytic normal and the Jacobian determinant that seeds breaking foam.
const GERSTNER_GLSL = /* glsl */ `
  const float BASE_FREQ = 0.0418879;   // 2*pi / 150 m swell
  const float AMPLITUDE = 0.8;
  const float CHOPPY = 0.55;
  const float DIR_SPREAD = 0.95;
  const float FREQ_MUL = 1.19;
  const float AMP_MUL = 0.82;
  const float WAVE_SPEED = 0.95;

  struct WaveSample {
    vec3 displacement;
    vec3 normal;
    float fold;
    float height;
  };

  WaveSample sampleOcean(vec2 pos){
    vec3 disp = vec3(0.0);
    vec3 nrm = vec3(0.0, 1.0, 0.0);
    float jxx = 1.0;
    float jzz = 1.0;
    float jxz = 0.0;

    float baseAngle = atan(WIND_DIR.y, WIND_DIR.x);
    float freq = BASE_FREQ;
    float amp = AMPLITUDE;

    for (int i = 0; i < ${WATERS_WAVE_COUNT}; i++){
      float fi = float(i);
      float r0 = hash21(vec2(fi, 1.7));
      float r1 = hash21(vec2(fi, 9.1));

      float angle = baseAngle + (r0 * 2.0 - 1.0) * DIR_SPREAD;
      vec2 d = vec2(cos(angle), sin(angle));

      float w = freq;
      float A = amp;
      float phase = sqrt(9.81 * w) * WAVE_SPEED;
      float Q = CHOPPY / max(w * A * float(${WATERS_WAVE_COUNT}), 1e-3);

      float arg = w * dot(d, pos) + uTime * phase + r1 * 6.2831853;
      float s = sin(arg);
      float c = cos(arg);
      float WA = w * A;

      disp.x += Q * A * d.x * c;
      disp.z += Q * A * d.y * c;
      disp.y += A * s;

      nrm.x -= d.x * WA * c;
      nrm.z -= d.y * WA * c;
      nrm.y -= Q * WA * s;

      jxx -= Q * d.x * d.x * WA * s;
      jzz -= Q * d.y * d.y * WA * s;
      jxz -= Q * d.x * d.y * WA * s;

      freq *= FREQ_MUL;
      amp *= AMP_MUL;
    }

    WaveSample o;
    o.displacement = disp;
    o.normal = normalize(nrm);
    o.height = disp.y;
    o.fold = jxx * jzz - jxz * jxz;
    return o;
  }
`;

const SKY_VERTEX_SHADER = /* glsl */ `
  varying vec3 vWorldDir;
  void main(){
    vWorldDir = (modelMatrix * vec4(position, 1.0)).xyz - cameraPosition;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;
  uniform float uTime;
  varying vec3 vWorldDir;
  ${SCENE_CONSTANTS_GLSL}
  ${NOISE_GLSL}
  ${ATMOSPHERE_GLSL}
  void main(){
    gl_FragColor = vec4(atmosphere(normalize(vWorldDir)), 1.0);
  }
`;

const OCEAN_VERTEX_SHADER = /* glsl */ `
  precision highp float;
  uniform float uTime;
  ${SCENE_CONSTANTS_GLSL}
  ${NOISE_GLSL}
  ${GERSTNER_GLSL}

  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying float vFold;
  varying float vHeight;

  void main(){
    vec3 worldPos = (modelMatrix * vec4(position, 1.0)).xyz;
    worldPos.y = 0.0;

    WaveSample w = sampleOcean(worldPos.xz);
    vec3 displaced = worldPos + w.displacement;

    vWorldPos = displaced;
    vNormal = w.normal;
    vFold = w.fold;
    vHeight = w.height;

    gl_Position = projectionMatrix * viewMatrix * vec4(displaced, 1.0);
  }
`;

const OCEAN_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;
  uniform float uTime;
  ${SCENE_CONSTANTS_GLSL}
  ${NOISE_GLSL}
  ${ATMOSPHERE_GLSL}

  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying float vFold;
  varying float vHeight;

  // Absorption per metre of clear ocean water: red dies first, blue survives.
  const vec3 ABSORB = vec3(0.45, 0.09, 0.04);
  const float CLARITY = 1.3;
  const float DEPTH_FALLOFF = 0.16;
  const float SEABED_DEPTH = 9.0;
  const float DETAIL_SCALE = 0.3;
  const float DETAIL_STRENGTH = 0.14;
  const float ROUGHNESS = 0.07;
  const float SSS_STRENGTH = 0.4;
  const float FOAM_THRESHOLD = 0.2;
  const float FOAM_SOFTNESS = 0.4;
  const float CREST_FOAM_START = 1.35;
  const float FOAM_EDGE = 0.2;
  const float FOAM_OPACITY = 0.95;
  const vec3 DEEP_COLOR = vec3(0.0023, 0.0339, 0.0782);
  const vec3 SHALLOW_COLOR = vec3(0.13, 0.56, 0.55);
  const vec3 SAND_COLOR = vec3(0.68, 0.60, 0.44);
  const vec3 FOAM_COLOR = vec3(0.95, 0.98, 1.0);
  const vec3 SSS_COLOR = vec3(0.1, 0.52, 0.46);

  float fresnelF(float c, float f0){
    return f0 + (1.0 - f0) * pow(clamp(1.0 - c, 0.0, 1.0), 5.0);
  }

  // GGX / Trowbridge-Reitz normal distribution — a physically shaped glint.
  float dggx(float NoH, float a){
    float a2 = a * a;
    float d = (NoH * a2 - NoH) * NoH + 1.0;
    return a2 / (3.14159265 * d * d);
  }

  vec3 detailNormal(vec2 p, float t){
    vec2 g = vec2(0.0);
    float amp = 1.0;
    mat2 m = mat2(1.7, 1.1, -1.1, 1.7);
    vec2 flow = WIND_DIR * t * 0.6;
    for (int i = 0; i < 4; i++){
      vec3 n = noised(p + flow);
      g += amp * n.yz;
      p = m * p;
      flow = -flow * 0.85;
      amp *= 0.55;
    }
    return normalize(vec3(-g.x, 1.0, -g.y));
  }

  void main(){
    vec3 V = normalize(cameraPosition - vWorldPos);
    float dist = length(cameraPosition - vWorldPos);
    float sunElev = clamp(SUN_DIR.y, 0.0, 1.0);

    // Gerstner normal plus scrolling ripple cascades the vertex grid is too
    // coarse to resolve; the finest fades with distance so the horizon reads as
    // a soft streak instead of aliasing into shimmering fireflies.
    vec3 N = normalize(vNormal);
    float detFade = exp(-dist * 0.012);
    vec3 dN1 = detailNormal(vWorldPos.xz * DETAIL_SCALE, uTime);
    vec3 dN2 = detailNormal(vWorldPos.xz * DETAIL_SCALE * 3.7 + 11.0, uTime * 1.35);
    vec2 dsum = dN1.xz * DETAIL_STRENGTH
              + dN2.xz * DETAIL_STRENGTH * 0.5 * mix(0.35, 1.0, detFade);
    N = normalize(vec3(N.x + dsum.x, N.y, N.z + dsum.y));
    vec3 Ns = N.y >= 0.0 ? N : -N;
    if (dot(N, V) < 0.0) N = -N;

    // Reflection: rays that dip below the horizon are folded back up rather
    // than clamped, so the sky mirrors cleanly at grazing angles.
    vec3 R = reflect(-V, N);
    R.y = abs(R.y);
    vec3 reflection = atmosphere(R);
    float fres = fresnelF(max(dot(N, V), 0.0), 0.02);

    // Water column to a flat seabed, solved analytically instead of with a
    // refraction+depth pass: bright turquoise straight down, fading to a dark
    // saturated deep toward the horizon where the path through water is long.
    vec3 refr = refract(-V, N, 1.0 / 1.333);
    float thickness = SEABED_DEPTH / max(-refr.y, 0.03);
    vec3 bed = vWorldPos + refr * thickness;
    float caustic = smoothstep(0.34, 0.72, fbm(bed.xz * 0.32 + WIND_DIR * uTime * 0.12, 3));
    vec3 sand = SAND_COLOR * (0.7 + 0.9 * caustic);
    vec3 T = exp(-(ABSORB / CLARITY) * thickness);
    vec3 waterCol = mix(SHALLOW_COLOR, DEEP_COLOR, 1.0 - exp(-thickness * DEPTH_FALLOFF));
    waterCol *= 0.5 + 0.5 * sunElev;
    vec3 color = mix(sand * T + waterCol * (1.0 - T), reflection, fres);

    // Subsurface translucency through thin, back-lit crests only.
    float back = pow(max(dot(V, -SUN_DIR), 0.0), 4.0);
    float crest = smoothstep(0.4, 1.8, vHeight) * max(N.y, 0.0);
    color += SSS_COLOR * back * crest * sunElev * SSS_STRENGTH;

    // GGX sun glints, roughened with distance so the horizon stays soft.
    vec3 H = normalize(V + SUN_DIR);
    float rough = clamp(ROUGHNESS + (1.0 - detFade) * 0.26, 0.02, 0.6);
    float D = dggx(max(dot(N, H), 0.0), rough * rough);
    float fh = fresnelF(max(dot(H, V), 0.0), 0.02);
    color += vec3(1.0, 0.94, 0.82) * D * fh * max(dot(Ns, SUN_DIR), 0.0) * 3.0 * sunElev;

    // Foam energy: breaking folds (the Gerstner Jacobian) plus whitecaps. The
    // energy dissolves through wind-stretched noise so foam feathers into
    // trails instead of stamping a hard white shape.
    float breakE = smoothstep(FOAM_THRESHOLD, FOAM_THRESHOLD - FOAM_SOFTNESS, vFold);
    float crestE = smoothstep(CREST_FOAM_START, CREST_FOAM_START + 1.6, vHeight);
    float energy = clamp(breakE + crestE * 0.7, 0.0, 1.2);

    vec2 fp = vWorldPos.xz;
    vec2 flow = WIND_DIR * uTime * 0.4;
    vec2 wperp = vec2(-WIND_DIR.y, WIND_DIR.x);
    vec2 sp = vec2(dot(fp, WIND_DIR), dot(fp, wperp) * 3.0);
    float tCoarse = fbm(sp * 0.12 + flow, 5);
    float tMid = fbm(fp * 0.8 - flow * 1.3, 4);
    float tex = tCoarse * 0.66 + tMid * 0.34;

    float thr = 1.0 - clamp(energy, 0.0, 1.0);
    float foam = smoothstep(thr - FOAM_EDGE, thr + FOAM_EDGE, tex);
    foam *= smoothstep(0.0, 0.12, energy);
    float fresh = smoothstep(0.62, 0.95, tMid) * smoothstep(0.5, 1.0, breakE);
    foam = max(foam, fresh);

    float bubbles = 0.74 + 0.34 * fbm(fp * 4.5 - flow, 3);
    float foamLight = 0.55 + 0.5 * max(dot(Ns, SUN_DIR), 0.0);
    vec3 foamCol = FOAM_COLOR * bubbles * foamLight;
    foamCol = mix(mix(color, FOAM_COLOR, 0.5), foamCol, smoothstep(0.05, 0.75, foam));
    color = mix(color, foamCol, clamp(foam, 0.0, 1.0) * FOAM_OPACITY);

    // Aerial haze toward the same atmosphere. The sun disc is capped first, or
    // its HDR value paints a hard beam straight down the sun's azimuth.
    vec3 fogCol = min(atmosphere(normalize(vec3(-V.x, 0.02, -V.z))), vec3(1.6));
    color = mix(color, fogCol, clamp(1.0 - exp(-dist * 0.0016), 0.0, 1.0));

    gl_FragColor = vec4(color, 1.0);
  }
`;

const FALLBACK_BACKGROUND = "linear-gradient(180deg, #4c7fb6 0%, #7fa8c8 46%, #0b3d55 62%, #04141f 100%)";

export function WatersBg() {
  const active = useDashboardAnimationActive();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const activeRef = useRef(active);
  const runtimeRef = useRef<{ start: () => void; stop: () => void } | null>(null);

  useEffect(() => {
    const canvasElement = canvasRef.current;
    const parentElement = canvasElement?.parentElement;
    if (!canvasElement || !parentElement) return;
    const canvas = canvasElement;
    const parent = parentElement;

    let raf = 0;
    let lastNow = 0;
    let elapsed = 0;
    let width = 2;
    let height = 2;
    let warned = false;

    let renderer: THREE.WebGLRenderer | null = null;
    let scene: THREE.Scene | null = null;
    let camera: THREE.PerspectiveCamera | null = null;
    let sky: THREE.Mesh | null = null;
    let ocean: THREE.Mesh | null = null;
    let sceneReady = false;
    const timeUniform = { value: 0 };
    const cameraTarget = new THREE.Vector3();

    function applyFallbackBackground() {
      canvas.style.background = FALLBACK_BACKGROUND;
    }

    function releaseSceneResources() {
      sky?.geometry.dispose();
      (sky?.material as THREE.Material | undefined)?.dispose();
      ocean?.geometry.dispose();
      (ocean?.material as THREE.Material | undefined)?.dispose();
      renderer?.dispose();
      sky = null;
      ocean = null;
      scene = null;
      camera = null;
      renderer = null;
      sceneReady = false;
    }

    function initializeScene(): boolean {
      try {
        renderer = new THREE.WebGLRenderer({
          canvas,
          alpha: false,
          antialias: false,
          powerPreference: "low-power",
        });
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.05;
        renderer.outputColorSpace = THREE.SRGBColorSpace;

        scene = new THREE.Scene();
        camera = new THREE.PerspectiveCamera(55, 1, 0.5, 6000);

        const skyMaterial = new THREE.ShaderMaterial({
          side: THREE.BackSide,
          depthTest: false,
          depthWrite: false,
          uniforms: { uTime: timeUniform },
          vertexShader: SKY_VERTEX_SHADER,
          fragmentShader: SKY_FRAGMENT_SHADER,
        });
        sky = new THREE.Mesh(new THREE.SphereGeometry(4000, 32, 16), skyMaterial);
        sky.frustumCulled = false;
        sky.renderOrder = -1000;
        scene.add(sky);

        // ~10 m cells: fine enough that the near foreground under the camera is
        // not a single facet, while the aerial haze hides the grid's far edge.
        const oceanGeometry = new THREE.PlaneGeometry(3000, 3000, 300, 300);
        oceanGeometry.rotateX(-Math.PI / 2);
        const oceanMaterial = new THREE.ShaderMaterial({
          side: THREE.DoubleSide,
          uniforms: { uTime: timeUniform },
          vertexShader: OCEAN_VERTEX_SHADER,
          fragmentShader: OCEAN_FRAGMENT_SHADER,
        });
        ocean = new THREE.Mesh(oceanGeometry, oceanMaterial);
        ocean.frustumCulled = false;
        scene.add(ocean);

        canvas.style.background = "#04141f";
        return true;
      } catch (error) {
        releaseSceneResources();
        if (!warned) {
          console.warn("Waters WebGL background fell back to a static gradient:", error);
          warned = true;
        }
        applyFallbackBackground();
        return false;
      }
    }

    function resize() {
      const rect = parent.getBoundingClientRect();
      width = Math.max(2, Math.floor(rect.width));
      height = Math.max(2, Math.floor(rect.height));
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      if (!sceneReady || !renderer || !camera) {
        applyFallbackBackground();
        return;
      }
      const dpr = dynamicBackgroundDevicePixelRatio(window.devicePixelRatio);
      // A deliberately sub-Retina buffer: the haze and foam hide the softness,
      // and the per-pixel wave shading stays affordable behind widgets.
      renderer.setPixelRatio(Math.min(1, dpr * 0.75));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }

    function render(now: number) {
      const dt = lastNow ? Math.min((now - lastNow) / 1000, 0.05) : 0;
      lastNow = now;
      elapsed += dt;

      if (sceneReady && renderer && scene && camera && sky) {
        timeUniform.value = elapsed;
        const yaw = watersCameraYaw(elapsed);
        camera.position.set(0, watersCameraHeight(elapsed), 0);
        cameraTarget.set(Math.sin(yaw) * 120, 3.2, -Math.cos(yaw) * 120);
        camera.lookAt(cameraTarget);
        sky.position.copy(camera.position);
        renderer.render(scene, camera);
      }

      raf = activeRef.current ? requestAnimationFrame(render) : 0;
    }

    function start() {
      if (raf || !activeRef.current) return;
      if (!sceneReady) {
        sceneReady = initializeScene();
        if (!sceneReady) return;
        resize();
      }
      lastNow = 0;
      raf = requestAnimationFrame(render);
    }

    function cancelFrame() {
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
      lastNow = 0;
    }

    function stop() {
      cancelFrame();
      releaseSceneResources();
      applyFallbackBackground();
    }

    function handleContextLost(event: Event) {
      event.preventDefault();
      cancelFrame();
      sceneReady = false;
      applyFallbackBackground();
    }

    function handleContextRestored() {
      sceneReady = false;
      if (activeRef.current) start();
    }

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(parent);
    canvas.addEventListener("webglcontextlost", handleContextLost);
    canvas.addEventListener("webglcontextrestored", handleContextRestored);
    resize();
    runtimeRef.current = { start, stop };
    if (activeRef.current) start();

    return () => {
      cancelFrame();
      resizeObserver.disconnect();
      canvas.removeEventListener("webglcontextlost", handleContextLost);
      canvas.removeEventListener("webglcontextrestored", handleContextRestored);
      releaseSceneResources();
      runtimeRef.current = null;
    };
  }, []);

  useEffect(() => {
    activeRef.current = active;
    const runtime = runtimeRef.current;
    if (!runtime) return;
    if (active) runtime.start();
    else runtime.stop();
  }, [active]);

  return (
    <canvas
      ref={canvasRef}
      className="dw-dynamic-bg-canvas"
      style={{ background: FALLBACK_BACKGROUND }}
    />
  );
}
