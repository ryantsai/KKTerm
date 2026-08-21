// eslint-disable-next-line @typescript-eslint/ban-ts-comment -- the raymarched
// Schwarzschild black hole shader/effect below is preserved verbatim from its
// source (untyped JS raymarch math + a small effect factory); full typing is
// out of scope, matching the convention used by fujiBackground.tsx.
// @ts-nocheck
import * as THREE from "three";
import { WebGLBackgroundCanvas, type WebGLBackgroundHandle } from "./webglBackgroundHost";

// ─────────────────────────────────────────────────────────────────────────
// Source: schwarzschild-geodesic-black-hole/geodesic-black-hole-effect.js
// A self-contained raymarched Schwarzschild black hole: gravitational
// lensing bends the accretion disk's far side up and over the event
// horizon, plus a small bloom/tonemap post pipeline. Reproduced verbatim —
// do not simplify the raymarch math.
// ─────────────────────────────────────────────────────────────────────────

const SCHWARZSCHILD_BLACK_HOLE_PRESETS = {
  broadDisk: {
    temp: 5800,
    gain: 1,
    beam: 3,
    jet: 0,
    hot: 1,
    innerRadius: 3,
    outerRadius: 12,
    exposure: 1.15,
  },
  jetDisk: {
    temp: 12500,
    gain: 1.35,
    beam: 3.4,
    jet: 1,
    hot: 1,
    innerRadius: 2.7,
    outerRadius: 14.5,
    exposure: 1.05,
  },
  coolDisk: {
    temp: 3300,
    gain: 0.75,
    beam: 2.6,
    jet: 0,
    hot: 0,
    innerRadius: 3.2,
    outerRadius: 9.5,
    exposure: 1.25,
  },
};

const SCHWARZSCHILD_BLACK_HOLE_QUALITIES = {
  low: 120,
  medium: 200,
  high: 320,
};

const FULLSCREEN_VERTEX_SHADER = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const BLACK_HOLE_FRAGMENT_SHADER = `
varying vec2 vUv;
uniform vec2 uRes;
uniform float uT;
uniform float uTd;
uniform vec3 uPos;
uniform vec3 uRt;
uniform vec3 uUp;
uniform vec3 uFw;
uniform float uFov;
uniform float uSteps;
uniform float uGain;
uniform float uTemp;
uniform float uBeam;
uniform float uIn;
uniform float uOut;
uniform float uJet;
uniform float uHot;
uniform int uDebugMode;

#define MAXS 400

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

float vnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float a = hash13(i + vec3(0.0, 0.0, 0.0));
  float b = hash13(i + vec3(1.0, 0.0, 0.0));
  float c = hash13(i + vec3(0.0, 1.0, 0.0));
  float d = hash13(i + vec3(1.0, 1.0, 0.0));
  float e = hash13(i + vec3(0.0, 0.0, 1.0));
  float g = hash13(i + vec3(1.0, 0.0, 1.0));
  float h = hash13(i + vec3(0.0, 1.0, 1.0));
  float k = hash13(i + vec3(1.0, 1.0, 1.0));
  return mix(
    mix(mix(a, b, u.x), mix(c, d, u.x), u.y),
    mix(mix(e, g, u.x), mix(h, k, u.x), u.y),
    u.z
  );
}

float fbm(vec3 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i += 1) {
    s += a * vnoise(p);
    p = p * 2.02 + vec3(11.7, 7.3, 5.1);
    a *= 0.5;
  }
  return s;
}

vec3 blackbody(float t) {
  t = clamp(t, 1000.0, 40000.0) * 0.01;
  float r;
  float g;
  float b;
  if (t <= 66.0) {
    r = 255.0;
    g = 99.4708025861 * log(t) - 161.1195681661;
  } else {
    r = 329.698727446 * pow(t - 60.0, -0.1332047592);
    g = 288.1221695283 * pow(t - 60.0, -0.0755148492);
  }
  if (t >= 66.0) {
    b = 255.0;
  } else if (t <= 19.0) {
    b = 0.0;
  } else {
    b = 138.5177312231 * log(t - 10.0) - 305.0447927307;
  }
  vec3 c = clamp(vec3(r, g, b) / 255.0, 0.0, 1.0);
  return c * c;
}

vec3 stars(vec3 d) {
  vec3 col = vec3(0.0);
  for (int l = 0; l < 3; l += 1) {
    float S = 90.0 + float(l) * 140.0;
    vec3 p = d * S;
    vec3 id = floor(p);
    vec3 f = fract(p);
    float h = hash13(id);
    vec3 sp = vec3(
      hash13(id + vec3(7.1)),
      hash13(id + vec3(13.7)),
      hash13(id + vec3(27.3))
    );
    float dist = length(f - sp);
    float bmag = pow(h, 28.0) * (16.0 - float(l) * 4.5);
    float tw = 0.78 + 0.22 * sin(uT * (1.5 + h * 4.0) + h * 41.0);
    vec3 tint = mix(
      vec3(1.0, 0.86, 0.72),
      vec3(0.72, 0.82, 1.0),
      hash13(id + vec3(3.3))
    );
    col += bmag * tw * exp(-dist * dist * (140.0 + float(l) * 160.0)) * tint;
  }
  return col;
}

vec3 nebula(vec3 d) {
  float n1 = fbm(d * 2.4 + vec3(3.1));
  float n2 = fbm(d * 5.1 - vec3(7.7));
  float n3 = fbm(d * 3.3 + vec3(9.0));
  vec3 col =
    vec3(0.13, 0.05, 0.27) * smoothstep(0.42, 0.95, n1) +
    vec3(0.02, 0.11, 0.30) * smoothstep(0.45, 0.90, n3) +
    vec3(0.45, 0.17, 0.07) * smoothstep(0.62, 0.95, n2) * 0.5;
  vec3 gn = normalize(vec3(0.35, 1.0, 0.2));
  float band = exp(-pow(dot(d, gn) * 4.5, 2.0));
  col += band *
    (vec3(0.30, 0.26, 0.22) * fbm(d * 7.0) + vec3(0.05, 0.045, 0.06)) *
    0.8;
  return col * 0.55;
}

vec3 background(vec3 d) {
  return nebula(d) + stars(d);
}

vec4 diskShade(vec3 p, vec3 rd) {
  float r = length(p.xz);
  float fadeIn = smoothstep(uIn, uIn + 0.35, r);
  float fadeOut = 1.0 - smoothstep(uOut * 0.55, uOut, r);
  float fade = fadeIn * fadeOut;
  if (fade < 0.002) return vec4(0.0);

  float ang = atan(p.z, p.x);
  float om = 0.7071 * pow(r, -1.5);
  float a2 = ang - om * uTd;
  vec3 q = vec3(cos(a2) * r, sin(a2) * r, 0.35 * r);
  float n = fbm(q * 1.15 + vec3(0.0, 0.0, uTd * 0.05));
  float dens = 0.30 + 0.70 * smoothstep(0.32, 0.85, n);
  dens *= 0.78 + 0.34 * vnoise(q * 4.2);

  float em =
    pow(max(1.0 - sqrt(uIn * 0.95 / r), 0.0), 0.6) *
    pow(uIn / r, 2.0);

  float v = clamp(sqrt(0.5 / max(r - 1.0, 0.4)), 0.0, 0.92);
  vec3 tang = normalize(vec3(-p.z, 0.0, p.x));
  float mu = dot(tang, -rd);
  float dop = sqrt(1.0 - v * v) / (1.0 - v * mu);
  float gsh = sqrt(max(1.0 - 1.0 / r, 0.03));
  float s = dop * gsh;

  vec3 c = blackbody(uTemp * pow(uIn / r, 0.75) * s);
  float I = em * dens * pow(s, uBeam);
  vec3 col = c * I * 14.0;

  if (uHot > 0.5) {
    float rh = uIn * 1.30;
    float ah = 0.7071 * pow(rh, -1.5) * uTd + 1.7;
    vec2 hp = vec2(cos(ah), sin(ah)) * rh;
    vec2 dv = p.xz - hp;
    col +=
      blackbody(uTemp * 1.3 * s) *
      exp(-dot(dv, dv) * 5.0) *
      9.0 *
      pow(s, uBeam);
  }

  float alpha = clamp(dens * 1.25, 0.0, 1.0) * fade;
  return vec4(col * fade, alpha);
}

void main() {
  vec2 ndc = vUv * 2.0 - 1.0;
  ndc.x *= uRes.x / uRes.y;
  vec3 rd = normalize(uFw + uFov * (ndc.x * uRt + ndc.y * uUp));

  vec3 p = uPos;
  vec3 v = rd;
  vec3 hv = cross(p, v);
  float h2 = dot(hv, hv);

  vec3 col = vec3(0.0);
  float T = 1.0;
  bool esc = false;
  vec3 ed = v;
  float stepsTaken = 0.0;
  float closestRadius = length(p);
  float diskOpacity = 0.0;

  for (int i = 0; i < MAXS; i += 1) {
    if (float(i) >= uSteps) break;
    float r2 = dot(p, p);
    float r = sqrt(r2);
    closestRadius = min(closestRadius, r);
    if (r < 1.02) break;
    if (r2 > 2500.0 && dot(p, v) > 0.0) {
      esc = true;
      ed = normalize(v);
      break;
    }

    float dt = clamp((r - 1.0) * 0.28, 0.02, 0.7);

    vec3 a1 = -1.5 * h2 * p / max(r2 * r2 * r, 0.05);
    vec3 pm = p + v * (dt * 0.5);
    vec3 vm = v + a1 * (dt * 0.5);
    float rm2 = dot(pm, pm);
    vec3 a2v = -1.5 * h2 * pm / max(rm2 * rm2 * sqrt(rm2), 0.05);
    vec3 pn = p + vm * dt;
    vec3 vn = v + a2v * dt;
    if (dot(pn, pn) < 1.0) break;

    if (uJet > 0.5) {
      float rc2 = dot(p.xz, p.xz);
      float jd =
        exp(-rc2 * 1.8) *
        smoothstep(0.7, 2.5, abs(p.y)) *
        exp(-abs(p.y) * 0.16);
      jd *= 0.6 + 0.5 *
        vnoise(vec3(p.x * 3.0, p.y * 1.2 - uTd * 2.5, p.z * 3.0));
      col += T * vec3(0.35, 0.55, 1.0) * jd * dt * 0.55;
    }

    if (p.y * pn.y < 0.0) {
      float f = p.y / (p.y - pn.y);
      vec3 hp = mix(p, pn, f);
      float hr = length(hp.xz);
      if (hr > uIn * 0.98 && hr < uOut) {
        vec4 dc = diskShade(hp, normalize(mix(v, vn, f)));
        col += T * dc.rgb * uGain;
        T *= 1.0 - dc.a;
        diskOpacity = max(diskOpacity, dc.a);
        if (T < 0.02) break;
      }
    }
    p = pn;
    v = vn;
    stepsTaken = float(i) + 1.0;
  }

  if (uDebugMode == 1) {
    col = esc ? ed * 0.5 + 0.5 : vec3(0.04, 0.0, 0.0);
  } else if (uDebugMode == 2) {
    col = vec3(T);
  } else if (uDebugMode == 3) {
    col = vec3(diskOpacity, diskOpacity * 0.35, diskOpacity * 0.04);
  } else if (uDebugMode == 4) {
    float approach = 1.0 - smoothstep(1.0, 14.0, closestRadius);
    col = vec3(approach, approach * approach, 1.0 - approach);
  } else if (uDebugMode == 5) {
    col = vec3(clamp(stepsTaken / max(uSteps, 1.0), 0.0, 1.0));
  } else {
    if (esc) col += T * background(ed);
    col = min(col, vec3(64.0));
  }

  if (any(notEqual(col, col))) col = vec3(0.0);
  gl_FragColor = vec4(col, 1.0);
}`;

const BRIGHT_FRAGMENT_SHADER = `
varying vec2 vUv;
uniform sampler2D tex;
uniform float uThresh;
void main() {
  vec3 c = texture2D(tex, vUv).rgb;
  c = min(max(c, vec3(0.0)), vec3(48.0));
  if (any(notEqual(c, c))) c = vec3(0.0);
  float l = max(max(c.r, c.g), c.b);
  float k = max(l - uThresh, 0.0);
  k = k / (k + 0.6);
  gl_FragColor = vec4(c * k, 1.0);
}`;

const BLUR_FRAGMENT_SHADER = `
varying vec2 vUv;
uniform sampler2D tex;
uniform vec2 uDir;
void main() {
  vec3 s = texture2D(tex, vUv).rgb * 0.2270270270;
  vec2 o1 = uDir * 1.3846153846;
  vec2 o2 = uDir * 3.2307692308;
  s += texture2D(tex, vUv + o1).rgb * 0.3162162162;
  s += texture2D(tex, vUv - o1).rgb * 0.3162162162;
  s += texture2D(tex, vUv + o2).rgb * 0.0702702703;
  s += texture2D(tex, vUv - o2).rgb * 0.0702702703;
  gl_FragColor = vec4(s, 1.0);
}`;

const COMPOSITE_FRAGMENT_SHADER = `
varying vec2 vUv;
uniform sampler2D tScene;
uniform sampler2D tB1;
uniform sampler2D tB2;
uniform float uExp;
uniform float uBloom;
uniform float uTn;
uniform vec2 uRes2;

vec3 aces(vec3 x) {
  return clamp(
    (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14),
    0.0,
    1.0
  );
}

float h21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

void main() {
  vec2 uv = vUv;
  vec2 cc = uv - 0.5;
  float r2 = dot(cc, cc);
  float ca = r2 * 0.055;
  vec3 col;
  col.r = texture2D(tScene, uv + cc * ca).r;
  col.g = texture2D(tScene, uv).g;
  col.b = texture2D(tScene, uv - cc * ca).b;
  vec3 bl = texture2D(tB1, uv).rgb * 0.9 + texture2D(tB2, uv).rgb * 0.75;
  col += bl * uBloom;
  col *= uExp;
  col = aces(col);
  col = pow(col, vec3(0.92));
  col *= 1.0 - 0.32 * smoothstep(0.15, 0.62, r2);
  col += (h21(uv * uRes2 + vec2(uTn, uTn * 1.7)) - 0.5) * 0.022;
  gl_FragColor = vec4(col, 1.0);
}`;

function createRenderTarget(width, height, type) {
  return new THREE.WebGLRenderTarget(width, height, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    type,
    depthBuffer: false,
    stencilBuffer: false,
  });
}

function createPass(fragmentShader, uniforms) {
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const geometry = new THREE.PlaneGeometry(2, 2);
  const material = new THREE.ShaderMaterial({
    vertexShader: FULLSCREEN_VERTEX_SHADER,
    fragmentShader,
    uniforms,
    depthWrite: false,
    depthTest: false,
  });
  scene.add(new THREE.Mesh(geometry, material));
  return { scene, camera, geometry, material, uniforms };
}

function disposePass(pass) {
  pass.geometry.dispose();
  pass.material.dispose();
}

function runPass(renderer, pass, target) {
  renderer.setRenderTarget(target);
  renderer.render(pass.scene, pass.camera);
}

function selectRenderTargetType(renderer, fallbackType) {
  if (fallbackType) return fallbackType;
  if (
    renderer?.capabilities?.isWebGL2 ||
    (
      renderer?.extensions?.get("OES_texture_half_float") &&
      renderer?.extensions?.get("OES_texture_half_float_linear")
    )
  ) {
    return THREE.HalfFloatType;
  }
  return THREE.UnsignedByteType;
}

function createSchwarzschildGeodesicBlackHoleEffect({
  renderer = null,
  preset = "broadDisk",
  quality = "medium",
  bloom = 1,
  renderTargetType = null,
} = {}) {
  const targetType = selectRenderTargetType(renderer, renderTargetType);
  const bhUniforms = {
    uRes: { value: new THREE.Vector2(2, 2) },
    uT: { value: 0 },
    uTd: { value: 0 },
    uPos: { value: new THREE.Vector3() },
    uRt: { value: new THREE.Vector3() },
    uUp: { value: new THREE.Vector3() },
    uFw: { value: new THREE.Vector3() },
    uFov: { value: Math.tan(THREE.MathUtils.degToRad(30)) },
    uSteps: { value: SCHWARZSCHILD_BLACK_HOLE_QUALITIES.medium },
    uGain: { value: 1 },
    uTemp: { value: 5800 },
    uBeam: { value: 3 },
    uIn: { value: 3 },
    uOut: { value: 12 },
    uJet: { value: 0 },
    uHot: { value: 1 },
    uDebugMode: { value: 0 },
  };
  const brightUniforms = {
    tex: { value: null },
    uThresh: { value: 0.85 },
  };
  const blurUniforms = {
    tex: { value: null },
    uDir: { value: new THREE.Vector2() },
  };
  const compositeUniforms = {
    tScene: { value: null },
    tB1: { value: null },
    tB2: { value: null },
    uExp: { value: 1.15 },
    uBloom: { value: bloom },
    uTn: { value: 0 },
    uRes2: { value: new THREE.Vector2(2, 2) },
  };

  const blackHolePass = createPass(BLACK_HOLE_FRAGMENT_SHADER, bhUniforms);
  const brightPass = createPass(BRIGHT_FRAGMENT_SHADER, brightUniforms);
  const blurPass = createPass(BLUR_FRAGMENT_SHADER, blurUniforms);
  const compositePass = createPass(COMPOSITE_FRAGMENT_SHADER, compositeUniforms);

  let width = 2;
  let height = 2;
  let frame = 0;
  let debugMode = "final";
  let sceneTarget = createRenderTarget(width, height, targetType);
  let halfA = createRenderTarget(width, height, targetType);
  let halfB = createRenderTarget(width, height, targetType);
  let quarterA = createRenderTarget(width, height, targetType);
  let quarterB = createRenderTarget(width, height, targetType);

  const debugModes = new Map([
    ["final", 0],
    ["escape-direction", 1],
    ["transmittance", 2],
    ["disk-crossing", 3],
    ["closest-approach", 4],
    ["step-count", 5],
  ]);

  function setSize(nextWidth, nextHeight) {
    width = Math.max(1, Math.round(nextWidth));
    height = Math.max(1, Math.round(nextHeight));
    const halfWidth = Math.max(1, width >> 1);
    const halfHeight = Math.max(1, height >> 1);
    const quarterWidth = Math.max(1, width >> 2);
    const quarterHeight = Math.max(1, height >> 2);
    sceneTarget.setSize(width, height);
    halfA.setSize(halfWidth, halfHeight);
    halfB.setSize(halfWidth, halfHeight);
    quarterA.setSize(quarterWidth, quarterHeight);
    quarterB.setSize(quarterWidth, quarterHeight);
    bhUniforms.uRes.value.set(width, height);
    compositeUniforms.uRes2.value.set(width, height);
  }

  function applyPreset(name) {
    const nextPreset =
      SCHWARZSCHILD_BLACK_HOLE_PRESETS[name] ??
      SCHWARZSCHILD_BLACK_HOLE_PRESETS.broadDisk;
    bhUniforms.uTemp.value = nextPreset.temp;
    bhUniforms.uGain.value = nextPreset.gain;
    bhUniforms.uBeam.value = nextPreset.beam;
    bhUniforms.uJet.value = nextPreset.jet;
    bhUniforms.uHot.value = nextPreset.hot;
    bhUniforms.uIn.value = nextPreset.innerRadius;
    bhUniforms.uOut.value = nextPreset.outerRadius;
    compositeUniforms.uExp.value = nextPreset.exposure;
  }

  function setQuality(name) {
    bhUniforms.uSteps.value =
      SCHWARZSCHILD_BLACK_HOLE_QUALITIES[name] ??
      SCHWARZSCHILD_BLACK_HOLE_QUALITIES.medium;
  }

  applyPreset(preset);
  setQuality(quality);

  return {
    uniforms: {
      blackHole: bhUniforms,
      bright: brightUniforms,
      blur: blurUniforms,
      composite: compositeUniforms,
    },
    get debugMode() {
      return debugMode;
    },
    get stepCount() {
      return bhUniforms.uSteps.value;
    },
    setSize,
    setPreset: applyPreset,
    setQuality,
    setPost({ exposure, bloom: nextBloom } = {}) {
      if (Number.isFinite(exposure)) compositeUniforms.uExp.value = exposure;
      if (Number.isFinite(nextBloom)) compositeUniforms.uBloom.value = nextBloom;
    },
    setDebugMode(mode) {
      debugMode = debugModes.has(mode) ? mode : "final";
      bhUniforms.uDebugMode.value = debugModes.get(debugMode) ?? 0;
    },
    updateCamera(camera) {
      camera.updateMatrixWorld(true);
      camera.getWorldDirection(bhUniforms.uFw.value);
      bhUniforms.uPos.value.copy(camera.position);
      bhUniforms.uRt.value
        .set(1, 0, 0)
        .applyQuaternion(camera.quaternion)
        .normalize();
      bhUniforms.uUp.value
        .set(0, 1, 0)
        .applyQuaternion(camera.quaternion)
        .normalize();
      if (camera.isPerspectiveCamera) {
        bhUniforms.uFov.value = Math.tan(
          THREE.MathUtils.degToRad(camera.fov) * 0.5,
        );
      }
    },
    update(time, diskTime = time) {
      bhUniforms.uT.value = time;
      bhUniforms.uTd.value = diskTime;
      compositeUniforms.uTn.value = (frame % 1024) * 0.618;
      frame += 1;
    },
    render(renderer) {
      if (debugMode !== "final") {
        runPass(renderer, blackHolePass, null);
        return;
      }

      runPass(renderer, blackHolePass, sceneTarget);

      brightUniforms.tex.value = sceneTarget.texture;
      runPass(renderer, brightPass, halfA);

      for (let iteration = 0; iteration < 2; iteration += 1) {
        const radius = 1.0 + iteration * 1.2;
        blurUniforms.tex.value = halfA.texture;
        blurUniforms.uDir.value.set(radius / halfA.width, 0);
        runPass(renderer, blurPass, halfB);
        blurUniforms.tex.value = halfB.texture;
        blurUniforms.uDir.value.set(0, radius / halfA.height);
        runPass(renderer, blurPass, halfA);
      }

      blurUniforms.tex.value = halfA.texture;
      blurUniforms.uDir.value.set(1.6 / quarterA.width, 0);
      runPass(renderer, blurPass, quarterA);
      blurUniforms.tex.value = quarterA.texture;
      blurUniforms.uDir.value.set(0, 1.6 / quarterA.height);
      runPass(renderer, blurPass, quarterB);

      compositeUniforms.tScene.value = sceneTarget.texture;
      compositeUniforms.tB1.value = halfA.texture;
      compositeUniforms.tB2.value = quarterB.texture;
      runPass(renderer, compositePass, null);
    },
    dispose() {
      disposePass(blackHolePass);
      disposePass(brightPass);
      disposePass(blurPass);
      disposePass(compositePass);
      sceneTarget.dispose();
      halfA.dispose();
      halfB.dispose();
      quarterA.dispose();
      quarterB.dispose();
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// KKTerm dynamic-background adapter
// ─────────────────────────────────────────────────────────────────────────

// Static framing matches the reference gallery's own scene.js exactly
// (fov/near/far/camera position, "medium" quality, target at the origin) —
// only time (disk rotation/turbulence) advances per frame, the camera never
// moves after setup.
function setup(_canvas: HTMLCanvasElement, renderer: THREE.WebGLRenderer): WebGLBackgroundHandle {
  const effect = createSchwarzschildGeodesicBlackHoleEffect({
    renderer,
    preset: "broadDisk",
    quality: "medium",
  });

  const camera = new THREE.PerspectiveCamera(60, 1, 0.01, 120);
  camera.position.set(10.439843, 2.150796, 8.284549);
  camera.lookAt(0, 0, 0);
  effect.updateCamera(camera);

  return {
    render(_width, _height, time) {
      effect.update(time);
      effect.render(renderer);
    },
    // uRes must match gl_FragCoord's space, which is device (framebuffer)
    // pixels — not the CSS logical width/height this hook reports. On a
    // scaled display those differ by the renderer's pixel ratio, leaving
    // the raymarch confined to a top-left fraction of the canvas and the
    // rest black. Read the renderer's actual drawing-buffer size instead.
    onResize() {
      const canvas = renderer.domElement;
      effect.setSize(canvas.width, canvas.height);
    },
    dispose() {
      effect.dispose();
    },
  };
}

export function BlackHoleBg() {
  return <WebGLBackgroundCanvas setup={setup} />;
}
