// Initial spectrum h0(k), conjugate packing, and time-dependent spectra.
//
// Ported from gasgiant/FFT-Ocean (MIT) — InitialSpectrum.compute and
// TimeDependentSpectrum.compute — which implement Horvath 2015. The piecewise
// HLSL branches are rewritten branchlessly (mix/step) and evaluated on a
// floor-clamped wavenumber so no texel can produce NaN/Inf before the in-band
// mask is applied.
import {
  Fn, instanceIndex, uniform, int, uint, float, vec2, vec4,
  sin, cos, atan, sqrt, exp, log, pow, abs, tanh, cosh, min, max, step, mix, length,
} from 'three/tsl';

// ---------- spectrum math (all take/return TSL nodes) ----------

function frequency(k, g, depth) {
  return sqrt(g.mul(k).mul(tanh(min(k.mul(depth), float(20)))));
}

function frequencyDerivative(k, g, depth) {
  const th = tanh(min(k.mul(depth), float(20)));
  const ch = cosh(k.mul(depth));
  const f = frequency(k, g, depth);
  return g.mul(depth.mul(k).div(ch).div(ch).add(th)).div(f).div(2);
}

function normalisationFactor(s) {
  const s2 = s.mul(s);
  const s3 = s2.mul(s);
  const s4 = s3.mul(s);
  const a = s4.mul(-0.000564).add(s3.mul(0.00776)).add(s2.mul(-0.044)).add(s.mul(0.192)).add(0.163);
  const b = s4.mul(-4.8e-8).add(s3.mul(1.07e-5)).add(s2.mul(-9.53e-4)).add(s.mul(5.9e-2)).add(3.93e-1);
  return mix(a, b, step(float(5), s));
}

function cosine2s(theta, s) {
  return normalisationFactor(s).mul(pow(abs(cos(theta.mul(0.5))), s.mul(2)));
}

function spreadPower(omega, peakOmega) {
  const r = omega.div(peakOmega);
  const hi = pow(abs(r), float(-2.5)).mul(9.77); // omega > peak
  const lo = pow(abs(r), float(5)).mul(6.97); // omega <= peak
  return mix(lo, hi, step(peakOmega, omega));
}

function directionSpectrum(theta, omega, p) {
  const s = spreadPower(omega, p.peakOmega)
    .add(tanh(min(omega.div(p.peakOmega), float(20))).mul(16).mul(p.swell).mul(p.swell));
  const base = cos(theta).mul(cos(theta)).mul(2.0 / Math.PI);
  return mix(base, cosine2s(theta.sub(p.angle), s), p.spreadBlend);
}

function tmaCorrection(omega, g, depth) {
  const omegaH = omega.mul(sqrt(depth.div(g)));
  const c1 = omegaH.mul(omegaH).mul(0.5);
  const tw = float(2).sub(omegaH);
  const c2 = float(1).sub(tw.mul(tw).mul(0.5));
  return mix(c1, mix(c2, float(1), step(float(2), omegaH)), step(float(1), omegaH));
}

function jonswap(omega, g, depth, p) {
  const sigma = mix(float(0.07), float(0.09), step(p.peakOmega, omega));
  const dw = omega.sub(p.peakOmega);
  const r = exp(dw.mul(dw).mul(-1).div(sigma.mul(sigma).mul(p.peakOmega).mul(p.peakOmega).mul(2)));
  const oo = float(1).div(omega);
  const oo2 = oo.mul(oo);
  const oo5 = oo2.mul(oo2).mul(oo); // 1 / omega^5
  const po = p.peakOmega.div(omega);
  const po2 = po.mul(po);
  const po4 = po2.mul(po2);
  return p.scale
    .mul(tmaCorrection(omega, g, depth))
    .mul(p.alpha).mul(g).mul(g)
    .mul(oo5)
    .mul(exp(po4.mul(-1.25)))
    .mul(pow(p.gamma, r));
}

function shortWavesFade(kLen, p) {
  return exp(p.shortWavesFade.mul(p.shortWavesFade).mul(kLen).mul(kLen).mul(-1));
}

const cmul = (a, b) => vec2(a.x.mul(b.x).sub(a.y.mul(b.y)), a.x.mul(b.y).add(a.y.mul(b.x)));

// ---------- shared parameter uniforms ----------

function spectrumUniformSet() {
  return {
    scale: uniform(0), angle: uniform(0), spreadBlend: uniform(0), swell: uniform(0),
    alpha: uniform(0), peakOmega: uniform(0), gamma: uniform(0), shortWavesFade: uniform(0),
  };
}

export function createSharedSpectrumUniforms() {
  return { g: uniform(9.81), depth: uniform(500), local: spectrumUniformSet(), swell: spectrumUniformSet() };
}

function fillSet(u, d, g) {
  u.scale.value = d.scale;
  u.angle.value = (d.windDirection * Math.PI) / 180;
  u.spreadBlend.value = d.spreadBlend;
  u.swell.value = Math.min(Math.max(d.swell, 0.01), 1);
  u.alpha.value = 0.076 * Math.pow((g * d.fetch) / (d.windSpeed * d.windSpeed), -0.22);
  u.peakOmega.value = 22 * Math.pow((d.windSpeed * d.fetch) / (g * g), -0.33);
  u.gamma.value = d.peakEnhancement;
  u.shortWavesFade.value = d.shortWavesFade;
}

export function applySpectrumParams(uniforms, params) {
  uniforms.g.value = params.g;
  uniforms.depth.value = params.depth;
  fillSet(uniforms.local, params.local, params.g);
  fillSet(uniforms.swell, params.swell, params.g);
}

// ---------- compute kernels ----------

// Pass A: h0(k) from spectrum * Gaussian noise, plus wavesData = (kx, 1/|k|, kz, omega).
export function buildInitialSpectrum({ N, noise, h0k, wavesData, shared, deltaK, cutoffLow, cutoffHigh }) {
  return Fn(() => {
    const id = instanceIndex;
    const x = id.mod(uint(N));
    const y = id.div(uint(N));
    const nx = float(int(x).sub(N / 2));
    const nz = float(int(y).sub(N / 2));
    const k = vec2(nx, nz).mul(deltaK);
    const kLen = length(k);
    const kSafe = max(kLen, cutoffLow); // floor so the masked-out DC texel can't blow up
    const angle = atan(k.y, k.x.add(1e-9));
    const omega = frequency(kSafe, shared.g, shared.depth);
    const dOmega = frequencyDerivative(kSafe, shared.g, shared.depth);

    const spectrum = jonswap(omega, shared.g, shared.depth, shared.local)
      .mul(directionSpectrum(angle, omega, shared.local))
      .mul(shortWavesFade(kSafe, shared.local))
      .add(
        jonswap(omega, shared.g, shared.depth, shared.swell)
          .mul(directionSpectrum(angle, omega, shared.swell))
          .mul(shortWavesFade(kSafe, shared.swell)),
      );

    const inBand = step(cutoffLow, kLen).mul(step(kLen, cutoffHigh));
    const amplitude = sqrt(spectrum.mul(2).mul(abs(dOmega)).div(kSafe).mul(deltaK).mul(deltaK));

    h0k.element(id).assign(noise.element(id).mul(amplitude).mul(inBand));
    wavesData.element(id).assign(vec4(k.x, float(1).div(kSafe), k.y, omega));
  })().compute(N * N);
}

// Pass B: pack h0 = ( h0(k), conj(h0(-k)) ) into one vec4 per texel.
export function buildConjugate({ N, h0k, h0 }) {
  return Fn(() => {
    const id = instanceIndex;
    const x = id.mod(uint(N));
    const y = id.div(uint(N));
    const xm = uint(N).sub(x).mod(uint(N));
    const ym = uint(N).sub(y).mod(uint(N));
    const idConj = ym.mul(uint(N)).add(xm);
    const a = h0k.element(id);
    const b = h0k.element(idConj);
    h0.element(id).assign(vec4(a.x, a.y, b.x, b.y.negate()));
  })().compute(N * N);
}

// Pass C: evolve to time t and build the 4 packed complex spectra for the IFFT.
// Each output packs two real fields (A + i*B) so 8 real fields ride on 4 IFFTs.
export function buildTimeDependent({ N, h0, wavesData, DxDz, DyDxz, DyxDyz, DxxDzz, time }) {
  return Fn(() => {
    const id = instanceIndex;
    const wave = wavesData.element(id); // (kx, 1/|k|, kz, omega)
    const phase = wave.w.mul(time);
    const ex = vec2(cos(phase), sin(phase));
    const h0v = h0.element(id);
    const h = cmul(h0v.xy, ex).add(cmul(h0v.zw, vec2(ex.x, ex.y.negate())));
    const ih = vec2(h.y.negate(), h.x);

    const dispX = ih.mul(wave.x).mul(wave.y);
    const dispY = h;
    const dispZ = ih.mul(wave.z).mul(wave.y);
    const dispXdx = h.mul(wave.x).mul(wave.x).mul(wave.y).negate();
    const dispYdx = ih.mul(wave.x);
    const dispZdx = h.mul(wave.x).mul(wave.z).mul(wave.y).negate();
    const dispYdz = ih.mul(wave.z);
    const dispZdz = h.mul(wave.z).mul(wave.z).mul(wave.y).negate();

    DxDz.element(id).assign(vec2(dispX.x.sub(dispZ.y), dispX.y.add(dispZ.x)));
    DyDxz.element(id).assign(vec2(dispY.x.sub(dispZdx.y), dispY.y.add(dispZdx.x)));
    DyxDyz.element(id).assign(vec2(dispYdx.x.sub(dispYdz.y), dispYdx.y.add(dispYdz.x)));
    DxxDzz.element(id).assign(vec2(dispXdx.x.sub(dispZdz.y), dispXdx.y.add(dispZdz.x)));
  })().compute(N * N);
}
