import { useEffect, useRef } from "react";
import { dynamicBackgroundDevicePixelRatio } from "./dynamicBackgroundCanvas";
import { useDashboardAnimationActive } from "../view/animationGating";

type Rgb = readonly [number, number, number];

export interface MistySeaPalette {
  sky: Rgb;
  horizon: Rgb;
  water: Rgb;
  cloud: Rgb;
  sun: Rgb;
  sunHeight: number;
  sunStrength: number;
  daylight: number;
}

interface MistySeaPaletteStop extends MistySeaPalette {
  hour: number;
}

// Palette stops mirror the supplied scene's automatic dawn-to-midnight mood.
// The WebGL implementation below is original KKTerm code; it does not embed
// Wallpaper Engine assets or its compiled DirectX shaders. Visual reference:
// “Misty Sea” by Seyul Saltz, whose project credits Tater's “Lonely Waters”.
const MISTY_SEA_PALETTE_STOPS: readonly MistySeaPaletteStop[] = [
  {
    hour: 5,
    sky: [0.72, 0.35, 0.42],
    horizon: [1, 0.48, 0.44],
    water: [0.15, 0.07, 0.12],
    cloud: [0.92, 0.54, 0.62],
    sun: [1, 0.74, 0.42],
    sunHeight: -0.02,
    sunStrength: 1,
    daylight: 0.48,
  },
  {
    hour: 7,
    sky: [0.75, 0.45, 0.52],
    horizon: [1, 0.64, 0.6],
    water: [0.25, 0.12, 0.17],
    cloud: [0.95, 0.67, 0.71],
    sun: [1, 0.9, 0.72],
    sunHeight: 0.08,
    sunStrength: 0.94,
    daylight: 0.72,
  },
  {
    hour: 9,
    sky: [0.28, 0.48, 0.58],
    horizon: [0.45, 0.75, 0.75],
    water: [0.02, 0.25, 0.3],
    cloud: [0.86, 0.98, 1],
    sun: [1, 0.98, 0.74],
    sunHeight: 0.25,
    sunStrength: 0.84,
    daylight: 0.9,
  },
  {
    hour: 11,
    sky: [0.32, 0.62, 0.7],
    horizon: [0.65, 0.82, 0.78],
    water: [0.02, 0.3, 0.34],
    cloud: [0.78, 0.94, 0.96],
    sun: [1, 0.72, 0.58],
    sunHeight: 0.42,
    sunStrength: 0.78,
    daylight: 1,
  },
  {
    hour: 14,
    sky: [0.42, 0.62, 0.68],
    horizon: [0.58, 0.78, 0.7],
    water: [0.05, 0.25, 0.28],
    cloud: [0.5, 0.72, 0.72],
    sun: [1, 0.61, 0.45],
    sunHeight: 0.34,
    sunStrength: 0.86,
    daylight: 0.94,
  },
  {
    hour: 16,
    sky: [0.58, 0.43, 0.45],
    horizon: [0.88, 0.58, 0.48],
    water: [0.32, 0.15, 0.18],
    cloud: [0.55, 0.4, 0.42],
    sun: [1, 0.35, 0.19],
    sunHeight: 0.14,
    sunStrength: 1,
    daylight: 0.76,
  },
  {
    hour: 18,
    sky: [0.5, 0.2, 0.26],
    horizon: [1, 0.48, 0.32],
    water: [0.13, 0.05, 0.09],
    cloud: [0.71, 0.49, 0.52],
    sun: [1, 0.96, 0.85],
    sunHeight: -0.01,
    sunStrength: 1.15,
    daylight: 0.42,
  },
  {
    hour: 20,
    sky: [0.02, 0.08, 0.12],
    horizon: [0.06, 0.18, 0.18],
    water: [0.005, 0.025, 0.04],
    cloud: [0.05, 0.09, 0.12],
    sun: [0.8, 0.86, 0.92],
    sunHeight: 0.16,
    sunStrength: 0.18,
    daylight: 0.08,
  },
  {
    hour: 23,
    sky: [0.015, 0.02, 0.07],
    horizon: [0.03, 0.04, 0.09],
    water: [0.002, 0.005, 0.015],
    cloud: [0.025, 0.03, 0.08],
    sun: [0.73, 0.8, 0.9],
    sunHeight: 0.24,
    sunStrength: 0.12,
    daylight: 0,
  },
];

const VERTEX_SHADER_SOURCE = `
attribute vec2 aPosition;
varying vec2 vUv;

void main() {
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER_SOURCE = `
precision highp float;

varying vec2 vUv;
uniform vec2 uResolution;
uniform vec2 uPointer;
uniform float uTime;
uniform vec3 uSkyColor;
uniform vec3 uHorizonColor;
uniform vec3 uWaterColor;
uniform vec3 uCloudColor;
uniform vec3 uSunColor;
uniform float uSunHeight;
uniform float uSunStrength;
uniform float uDaylight;

float hash21(vec2 point) {
  point = fract(point * vec2(123.34, 456.21));
  point += dot(point, point + 45.32);
  return fract(point.x * point.y);
}

float valueNoise(vec2 point) {
  vec2 cell = floor(point);
  vec2 local = fract(point);
  local = local * local * (3.0 - 2.0 * local);
  float a = hash21(cell);
  float b = hash21(cell + vec2(1.0, 0.0));
  float c = hash21(cell + vec2(0.0, 1.0));
  float d = hash21(cell + vec2(1.0, 1.0));
  return mix(mix(a, b, local.x), mix(c, d, local.x), local.y);
}

float fbm(vec2 point) {
  float sum = 0.0;
  float weight = 0.54;
  mat2 turn = mat2(0.82, -0.57, 0.57, 0.82);
  for (int octave = 0; octave < 5; octave++) {
    sum += valueNoise(point) * weight;
    point = turn * point * 2.03 + vec2(7.1, 3.7);
    weight *= 0.5;
  }
  return sum;
}

float waveField(vec2 point) {
  vec2 drifted = point + vec2(uTime * 0.22, -uTime * 0.16);
  float wave = sin(dot(drifted, vec2(0.72, 0.31))) * 0.42;
  wave += sin(dot(drifted, vec2(-0.46, 1.17)) + 1.4) * 0.27;
  wave += sin(dot(drifted, vec2(1.83, 0.24)) - 0.7) * 0.16;
  wave += sin(dot(drifted, vec2(-1.12, 2.31)) + 2.2) * 0.09;
  wave += (valueNoise(drifted * 0.62) - 0.5) * 0.24;
  return wave;
}

void main() {
  vec2 point = vUv * 2.0 - 1.0;
  float aspect = uResolution.x / max(1.0, uResolution.y);
  point.x *= aspect;

  vec2 pointerOffset = (uPointer - 0.5) * vec2(0.11, 0.055);
  float horizon = 0.035 + pointerOffset.y;
  vec2 sunPosition = vec2(pointerOffset.x * 1.6, horizon + 0.035 + uSunHeight);
  float skyAmount = clamp((point.y - horizon) / max(0.001, 1.0 - horizon), 0.0, 1.0);

  vec3 sky = mix(uHorizonColor, uSkyColor, pow(skyAmount, 0.62));
  float cloudFade = smoothstep(horizon + 0.015, horizon + 0.2, point.y)
    * (1.0 - smoothstep(0.72, 1.05, point.y));
  vec2 cloudPoint = vec2(point.x * 0.72 + uTime * 0.009, point.y * 2.15 - uTime * 0.0025);
  float cloudNoise = fbm(cloudPoint * 2.0) + fbm(cloudPoint * 4.3 + 8.0) * 0.3;
  float cloudMask = smoothstep(0.48, 0.72, cloudNoise) * cloudFade;
  sky = mix(sky, uCloudColor, cloudMask * (0.27 + 0.31 * uDaylight));
  float horizonHaze = (1.0 - smoothstep(0.0, 0.17, abs(point.y - horizon - 0.075)))
    * (0.55 + 0.45 * valueNoise(vec2(point.x * 2.1 + uTime * 0.004, 3.7)));
  sky = mix(sky, uCloudColor, horizonHaze * 0.13);

  vec2 sunDelta = point - sunPosition;
  sunDelta.x *= 0.82;
  float sunDistance = length(sunDelta);
  float sunDisc = 1.0 - smoothstep(0.025, 0.045, sunDistance);
  float sunGlow = exp(-sunDistance * 8.0) * 0.72 + exp(-sunDistance * 28.0) * 0.42;
  sky += uSunColor * (sunDisc * 1.35 + sunGlow) * uSunStrength;

  vec3 color = sky;
  if (point.y < horizon) {
    float waterDepth = min(38.0, 0.72 / max(0.025, horizon - point.y));
    vec2 waterPoint = vec2(point.x * waterDepth * 1.18, waterDepth * 1.75);
    float wave = waveField(waterPoint);
    float epsilon = 0.055 + waterDepth * 0.0035;
    float waveX = waveField(waterPoint + vec2(epsilon, 0.0));
    float waveZ = waveField(waterPoint + vec2(0.0, epsilon));
    vec3 normal = normalize(vec3((wave - waveX) / epsilon * 0.48, 1.0, (wave - waveZ) / epsilon * 0.58));

    float distanceFromHorizon = clamp(horizon - point.y, 0.0, 1.2);
    float fresnel = 0.24 + 0.58 * pow(1.0 - distanceFromHorizon * 0.72, 3.0);
    float reflectedHeight = clamp(0.28 + normal.z * 0.55 + distanceFromHorizon * 0.18, 0.0, 1.0);
    vec3 reflectedSky = mix(uHorizonColor, uSkyColor, reflectedHeight);
    reflectedSky = mix(reflectedSky, uCloudColor, cloudMask * 0.18);

    float waveLight = clamp(normal.x * -0.22 + normal.z * 0.38 + 0.48, 0.0, 1.0);
    color = mix(uWaterColor * (0.5 + waveLight * 0.24), reflectedSky, fresnel);
    float swellBand = 0.5 + 0.5 * sin(waterPoint.y * 2.35 + wave * 3.1 + normal.x * 0.8);
    float rippleBand = 0.5 + 0.5 * sin(waterPoint.y * 5.8 - wave * 2.4);
    color *= 0.7 + swellBand * 0.26 + rippleBand * 0.08;
    color += reflectedSky * pow(swellBand, 7.0) * (0.035 + distanceFromHorizon * 0.08);

    float reflectionOffset = point.x - sunPosition.x + normal.x * (0.035 + distanceFromHorizon * 0.055);
    float reflectionColumn = exp(-abs(reflectionOffset) * (10.0 + distanceFromHorizon * 16.0));
    float reflectionBands = pow(0.5 + 0.5 * sin(waterPoint.y * 4.7 + wave * 5.0), 5.0);
    reflectionBands += pow(0.5 + 0.5 * sin(waterPoint.y * 8.9 - wave * 3.0), 9.0) * 0.55;
    float reflectionReach = smoothstep(0.005, 0.055, distanceFromHorizon)
      * (1.0 - smoothstep(0.7, 1.08, distanceFromHorizon));
    float reflection = reflectionColumn * reflectionBands * reflectionReach;
    color += uSunColor * reflection * uSunStrength * 1.55;

    float crest = max(
      smoothstep(0.57, 0.91, wave + normal.z * 0.22),
      pow(swellBand, 11.0) * 0.72
    ) * smoothstep(0.07, 0.82, distanceFromHorizon);
    color += mix(uHorizonColor, vec3(0.92, 0.96, 1.0), uDaylight * 0.5) * crest * 0.16;

    float seaMist = smoothstep(12.0, 35.0, waterDepth);
    color = mix(color, uHorizonColor, seaMist * 0.45);
  }

  float vignette = 1.0 - 0.28 * pow(length(point * vec2(0.58, 0.82)), 2.25);
  color *= vignette;
  color = vec3(1.0) - exp(-max(color, 0.0) * 1.22);
  color = pow(color, vec3(0.92));
  color += (hash21(gl_FragCoord.xy + floor(uTime * 10.0)) - 0.5) / 255.0;
  gl_FragColor = vec4(color, 1.0);
}
`;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function smoothstep(value: number): number {
  const clamped = clamp01(value);
  return clamped * clamped * (3 - 2 * clamped);
}

function mixNumber(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

function mixRgb(from: Rgb, to: Rgb, amount: number): Rgb {
  return [
    mixNumber(from[0], to[0], amount),
    mixNumber(from[1], to[1], amount),
    mixNumber(from[2], to[2], amount),
  ];
}

export function mistySeaPaletteAtHour(inputHour: number): MistySeaPalette {
  const normalizedHour = ((inputHour % 24) + 24) % 24;
  let from = MISTY_SEA_PALETTE_STOPS[MISTY_SEA_PALETTE_STOPS.length - 1];
  let to = MISTY_SEA_PALETTE_STOPS[0];
  let adjustedHour = normalizedHour;

  for (let index = 0; index < MISTY_SEA_PALETTE_STOPS.length; index += 1) {
    const candidate = MISTY_SEA_PALETTE_STOPS[index];
    const next = MISTY_SEA_PALETTE_STOPS[(index + 1) % MISTY_SEA_PALETTE_STOPS.length];
    const nextHour = index === MISTY_SEA_PALETTE_STOPS.length - 1 ? next.hour + 24 : next.hour;
    const candidateHour = candidate.hour;
    const testHour = normalizedHour < candidateHour ? normalizedHour + 24 : normalizedHour;
    if (testHour >= candidateHour && testHour < nextHour) {
      from = candidate;
      to = next;
      adjustedHour = testHour;
      break;
    }
  }

  const toHour = to.hour <= from.hour ? to.hour + 24 : to.hour;
  const amount = smoothstep((adjustedHour - from.hour) / Math.max(0.001, toHour - from.hour));
  return {
    sky: mixRgb(from.sky, to.sky, amount),
    horizon: mixRgb(from.horizon, to.horizon, amount),
    water: mixRgb(from.water, to.water, amount),
    cloud: mixRgb(from.cloud, to.cloud, amount),
    sun: mixRgb(from.sun, to.sun, amount),
    sunHeight: mixNumber(from.sunHeight, to.sunHeight, amount),
    sunStrength: mixNumber(from.sunStrength, to.sunStrength, amount),
    daylight: mixNumber(from.daylight, to.daylight, amount),
  };
}

function currentLocalHour(): number {
  const forcedHour = (window as Window & { __kkMistySeaHour?: number }).__kkMistySeaHour;
  if (Number.isFinite(forcedHour)) return forcedHour as number;
  const now = new Date();
  return now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
}

function compileShader(
  gl: WebGLRenderingContext,
  type: number,
  source: string,
): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Unable to allocate a WebGL shader.");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const detail = gl.getShaderInfoLog(shader) || "Unknown shader compilation error.";
    gl.deleteShader(shader);
    throw new Error(detail);
  }
  return shader;
}

function createProgram(gl: WebGLRenderingContext): WebGLProgram {
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_SOURCE);
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SOURCE);
  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    throw new Error("Unable to allocate a WebGL program.");
  }
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const detail = gl.getProgramInfoLog(program) || "Unknown shader link error.";
    gl.deleteProgram(program);
    throw new Error(detail);
  }
  return program;
}

function cssRgb(color: Rgb): string {
  return `rgb(${color.map((channel) => Math.round(clamp01(channel) * 255)).join(", ")})`;
}

export function MistySeaBg() {
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
    let pointerX = 0.5;
    let pointerY = 0.5;
    let targetPointerX = 0.5;
    let targetPointerY = 0.5;
    let palette = mistySeaPaletteAtHour(currentLocalHour());
    let nextPaletteRefresh = 0;
    let warned = false;

    let gl: WebGLRenderingContext | null = null;
    let loseContextExtension: WEBGL_lose_context | null = null;
    let program: WebGLProgram | null = null;
    let positionBuffer: WebGLBuffer | null = null;
    let webGlReady = false;
    let positionLocation = -1;
    let timeLocation: WebGLUniformLocation | null = null;
    let resolutionLocation: WebGLUniformLocation | null = null;
    let pointerLocation: WebGLUniformLocation | null = null;
    let skyLocation: WebGLUniformLocation | null = null;
    let horizonLocation: WebGLUniformLocation | null = null;
    let waterLocation: WebGLUniformLocation | null = null;
    let cloudLocation: WebGLUniformLocation | null = null;
    let sunLocation: WebGLUniformLocation | null = null;
    let sunHeightLocation: WebGLUniformLocation | null = null;
    let sunStrengthLocation: WebGLUniformLocation | null = null;
    let daylightLocation: WebGLUniformLocation | null = null;

    function applyFallbackBackground() {
      canvas.style.background = `linear-gradient(180deg, ${cssRgb(palette.sky)} 0%, ${cssRgb(palette.horizon)} 51%, ${cssRgb(palette.water)} 100%)`;
    }

    function releaseWebGlResources() {
      if (gl && !gl.isContextLost()) {
        if (positionBuffer) gl.deleteBuffer(positionBuffer);
        if (program) gl.deleteProgram(program);
      }
      positionBuffer = null;
      program = null;
      webGlReady = false;
    }

    function initializeWebGl(): boolean {
      if (!gl) {
        gl = canvas.getContext("webgl", {
          alpha: false,
          antialias: false,
          depth: false,
          stencil: false,
          preserveDrawingBuffer: false,
          powerPreference: "low-power",
        });
        loseContextExtension = gl?.getExtension("WEBGL_lose_context") ?? null;
      }
      if (!gl) {
        applyFallbackBackground();
        return false;
      }
      if (gl.isContextLost()) {
        loseContextExtension?.restoreContext();
        return false;
      }
      try {
        program = createProgram(gl);
        positionBuffer = gl.createBuffer();
        if (!positionBuffer) throw new Error("Unable to allocate a WebGL vertex buffer.");
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        gl.bufferData(
          gl.ARRAY_BUFFER,
          new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
          gl.STATIC_DRAW,
        );
        positionLocation = gl.getAttribLocation(program, "aPosition");
        timeLocation = gl.getUniformLocation(program, "uTime");
        resolutionLocation = gl.getUniformLocation(program, "uResolution");
        pointerLocation = gl.getUniformLocation(program, "uPointer");
        skyLocation = gl.getUniformLocation(program, "uSkyColor");
        horizonLocation = gl.getUniformLocation(program, "uHorizonColor");
        waterLocation = gl.getUniformLocation(program, "uWaterColor");
        cloudLocation = gl.getUniformLocation(program, "uCloudColor");
        sunLocation = gl.getUniformLocation(program, "uSunColor");
        sunHeightLocation = gl.getUniformLocation(program, "uSunHeight");
        sunStrengthLocation = gl.getUniformLocation(program, "uSunStrength");
        daylightLocation = gl.getUniformLocation(program, "uDaylight");
        if (positionLocation < 0) throw new Error("Misty Sea shader input is unavailable.");
        gl.useProgram(program);
        gl.enableVertexAttribArray(positionLocation);
        gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
        canvas.style.background = "#08101a";
        return true;
      } catch (error) {
        releaseWebGlResources();
        if (!warned) {
          console.warn("Misty Sea WebGL background fell back to a static gradient:", error);
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
      const dpr = dynamicBackgroundDevicePixelRatio(window.devicePixelRatio);
      // The mist softens a deliberately sub-Retina buffer while keeping the
      // ray-free shader inexpensive behind terminals and Dashboard widgets.
      const renderScale = Math.min(1, dpr * 0.75);
      canvas.width = Math.max(2, Math.floor(width * renderScale));
      canvas.height = Math.max(2, Math.floor(height * renderScale));
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      if (webGlReady && gl) gl.viewport(0, 0, canvas.width, canvas.height);
      else applyFallbackBackground();
    }

    function followPointer(event: PointerEvent) {
      if (!activeRef.current) return;
      const rect = parent.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      targetPointerX = clamp01((event.clientX - rect.left) / rect.width);
      targetPointerY = 1 - clamp01((event.clientY - rect.top) / rect.height);
    }

    function render(now: number) {
      const dt = lastNow ? Math.min((now - lastNow) / 1000, 0.05) : 0;
      lastNow = now;
      elapsed += dt;
      const pointerMix = Math.min(1, dt * 3.5);
      pointerX = mixNumber(pointerX, targetPointerX, pointerMix);
      pointerY = mixNumber(pointerY, targetPointerY, pointerMix);

      if (now >= nextPaletteRefresh) {
        palette = mistySeaPaletteAtHour(currentLocalHour());
        nextPaletteRefresh = now + 1000;
      }

      if (webGlReady && gl && program) {
        gl.useProgram(program);
        gl.uniform1f(timeLocation, elapsed);
        gl.uniform2f(resolutionLocation, canvas.width, canvas.height);
        gl.uniform2f(pointerLocation, pointerX, pointerY);
        gl.uniform3fv(skyLocation, palette.sky);
        gl.uniform3fv(horizonLocation, palette.horizon);
        gl.uniform3fv(waterLocation, palette.water);
        gl.uniform3fv(cloudLocation, palette.cloud);
        gl.uniform3fv(sunLocation, palette.sun);
        gl.uniform1f(sunHeightLocation, palette.sunHeight);
        gl.uniform1f(sunStrengthLocation, palette.sunStrength);
        gl.uniform1f(daylightLocation, palette.daylight);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }

      raf = activeRef.current ? requestAnimationFrame(render) : 0;
    }

    function start() {
      if (raf || !activeRef.current) return;
      if (gl?.isContextLost()) {
        loseContextExtension?.restoreContext();
        return;
      }
      if (!webGlReady) {
        webGlReady = initializeWebGl();
        if (!webGlReady) return;
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
      releaseWebGlResources();
      if (gl && !gl.isContextLost()) loseContextExtension?.loseContext();
      applyFallbackBackground();
    }

    function handleContextLost(event: Event) {
      event.preventDefault();
      cancelFrame();
      webGlReady = false;
      positionBuffer = null;
      program = null;
      applyFallbackBackground();
      if (activeRef.current) {
        queueMicrotask(() => {
          if (activeRef.current && gl?.isContextLost()) loseContextExtension?.restoreContext();
        });
      }
    }

    function handleContextRestored() {
      webGlReady = false;
      if (activeRef.current) start();
    }

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(parent);
    document.addEventListener("pointermove", followPointer, { passive: true });
    canvas.addEventListener("webglcontextlost", handleContextLost);
    canvas.addEventListener("webglcontextrestored", handleContextRestored);
    resize();
    runtimeRef.current = { start, stop };
    if (activeRef.current) start();

    return () => {
      cancelFrame();
      resizeObserver.disconnect();
      document.removeEventListener("pointermove", followPointer);
      canvas.removeEventListener("webglcontextlost", handleContextLost);
      canvas.removeEventListener("webglcontextrestored", handleContextRestored);
      releaseWebGlResources();
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
      style={{ background: "linear-gradient(180deg, #201225 0%, #9f4f49 51%, #120813 100%)" }}
    />
  );
}
