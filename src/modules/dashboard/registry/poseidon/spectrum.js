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

// Horvath's swell term is tanh(omega/peak), which saturates at 1 and then stays
// there for every frequency above the peak. So turning `swell` up to get the
// long parallel crests of a real swell train also concentrates the wind chop
// into the same direction, and the surface comes out combed — parallel corduroy
// at every scale at once — instead of chop riding on a swell. Short wind waves
// are in fact far more broadly spread than the dominant wave. Tapering the term
// by peak/omega above the peak leaves the rise (and the value at the peak)
// untouched and band-limits the concentration to the waves meant to be coherent.
function swellConcentration(omega, p) {
  const r = omega.div(p.peakOmega);
  return tanh(min(r, float(20))).mul(min(float(1).div(max(r, float(1e-3))), float(1)));
}

function directionSpectrum(theta, omega, p) {
  const s = spreadPower(omega, p.peakOmega)
    .add(swellConcentration(omega, p).mul(16).mul(p.swell).mul(p.swell));
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

// Extra roll-off applied only above the peak. Textbook JONSWAP holds an
// omega^-5 equilibrium tail, and in wavenumber that works out to a *flat* slope
// spectrum: every octave of wavelength contributes the same amount of tilt, so
// the surface is self-similar and reads as one uniform rough texture with no
// dominant wave. Steepening the tail to omega^-(5+tailFalloff) is what buys a
// dominant scale — the swell keeps its height and its slope, and the chop drops
// to a subordinate ripple that rides on the swell instead of replacing it.
//
// tailFloor stops the roll-off once it has done that job. Run unbounded it
// keeps going all the way down to the capillary end and takes the sub-metre
// ripple with it, and water with no micro-slope is a mirror: the surface goes
// to polished chrome and every wave face turns into a hard sky reflection.
// Clamping the ratio means the suppression saturates at floor^tailFalloff a
// couple of octaves below the peak — the mid-scale corrugation that competed
// with the swell is gone, the fine ripple that reads as *water* is only halved.
function tailRolloff(omega, p) {
  return pow(max(min(p.peakOmega.div(omega), float(1)), p.tailFloor), p.tailFalloff);
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
    .mul(pow(p.gamma, r))
    .mul(tailRolloff(omega, p));
}

function shortWavesFade(kLen, p) {
  return exp(p.shortWavesFade.mul(p.shortWavesFade).mul(kLen).mul(kLen).mul(-1));
}

const cmul = (a, b) => vec2(a.x.mul(b.x).sub(a.y.mul(b.y)), a.x.mul(b.y).add(a.y.mul(b.x)));

// ---------- wavenumber-weighted choppiness ----------
//
// Tessendorf's horizontal displacement is scaled by one global lambda, but the
// steepness a mode contributes to the Jacobian goes as lambda*k*a, and with a
// JONSWAP tail that term grows with k. So a flat lambda pinches the ripples
// into folded noise (and sprays foam speckle everywhere) long before the swell
// crests get their peaked profile. Weighting the displacement by a low-pass in
// k — full strength on the swell, a small floor on the chop — lets lambda go
// high enough to sculpt sharp crests and broad troughs while the short waves
// stay smooth and near-sinusoidal.
//
// The roll-off is quartic in k, not the quadratic Lorentzian it started as. A
// Lorentzian (1/(1+r^2)) is far too gradual to be a band split: with the knee
// anywhere low enough to keep the 10-30 m chop smooth, it has already taken a
// fifth of the sculpting off the 70-170 m waves that are the only ones whose
// crest shape a viewer can read. Squaring the denominator turns the same knee
// into something much closer to a brick wall — at knee 0.20 rad/m the 72 m
// dominant keeps 95% of lambda and the 172 m swell keeps 100%, while a 16 m
// wave is down to 27% and a 4 m ripple is at the floor. So full choppiness
// lands on exactly the waves that need a peaked, slightly overhanging profile,
// and the wavelengths that fold into pinched noise (and paint maps.js white)
// never see it.
//
// Module-level uniforms because buildTimeDependent is constructed per cascade
// from OceanCascade with a fixed argument list; every cascade shares these.
// All are overwritten from params by applySpectrumParams before the first
// dispatch; these values only mirror the params defaults.
const chopFalloff = uniform(0.40);
const chopFloor = uniform(0.20);
const chopLean = uniform(0.5);
const windX = uniform(Math.SQRT1_2);
const windZ = uniform(Math.SQRT1_2);

function choppiness(kLen) {
  const r = kLen.div(chopFalloff);
  const r2 = r.mul(r);
  return chopFloor.add(float(1).sub(chopFloor).div(r2.mul(r2).add(1)));
}

// ---------- fore-aft crest asymmetry ----------
//
// Gerstner/Tessendorf horizontal displacement is -i*(k/|k|)*h: a quarter-period
// out of phase with the height, which bunches the surface *exactly* on the crest
// and thins it *exactly* in the trough. That is symmetric by construction, and
// symmetric is the one thing a real wave crest never is — the whole silhouette
// comes out as a convex mound with the same slope on both faces, which is what
// leaves foam sitting on it as a blanket instead of capping a lip.
//
// The fix costs one extra term and no extra bandwidth. Add a slice of
// displacement *in phase* with the height, i.e. rotate the displacement
// coefficient in the complex plane instead of leaving it on the imaginary axis.
// For a single wave h = a*cos(theta) the displacement becomes
//   Dx = a*(lean*cos(theta) - chop*sin(theta)) = a*R*cos(theta + phi),
// so the point of maximum horizontal compression — the sharp part of the crest —
// slides from theta = 0 to theta = 90deg - atan2(chop, lean), i.e. *forward of*
// the height crest. The face ahead of the crest steepens and can pass vertical
// while the face behind it flattens into a long back: a wave leaning downwind.
//
// Two constraints make the term well-behaved rather than a hack:
//
//   REALITY   a displacement multiplier m(k) only yields a real field when
//             m(-k) = conj(m(k)). The classic -i*kx/|k| satisfies that because
//             it is imaginary and odd. The new part is *real*, so it has to be
//             odd on its own — hence the projection onto the wind direction,
//             which is exactly odd in k and additionally leans every wave
//             downwind rather than leaning the upwind-running half of the
//             spectrum backwards into the oncoming ones.
//   EXACTNESS the derivative outputs below are re-derived from the same complex
//             weight rather than patched, so d(disp)/dx really is d/dx of the
//             displacement that got written. maps.js differentiates nothing and
//             trusts these four fields to build the Jacobian, so an inconsistent
//             pair would put foam where the surface is not folding.
//
// Scaled by the same wavenumber weight as the choppiness, so only waves big
// enough to read as waves lean; ripples stay sinusoidal.
function leanWeight(k, chop) {
  return k.x.mul(windX).add(k.y.mul(windZ)).mul(chopLean).mul(chop);
}

// ---------- shared parameter uniforms ----------

function spectrumUniformSet() {
  return {
    scale: uniform(0), angle: uniform(0), spreadBlend: uniform(0), swell: uniform(0),
    alpha: uniform(0), peakOmega: uniform(0), gamma: uniform(0), shortWavesFade: uniform(0),
    tailFalloff: uniform(0), tailFloor: uniform(1),
  };
}

export function createSharedSpectrumUniforms() {
  return { g: uniform(9.81), depth: uniform(500), local: spectrumUniformSet(), swell: spectrumUniformSet() };
}

function fillSet(u, d, g, scaleMul = 1) {
  u.scale.value = d.scale * scaleMul;
  u.angle.value = (d.windDirection * Math.PI) / 180;
  u.spreadBlend.value = d.spreadBlend;
  u.swell.value = Math.min(Math.max(d.swell, 0.01), 1);
  u.alpha.value = 0.076 * Math.pow((g * d.fetch) / (d.windSpeed * d.windSpeed), -0.22);
  u.peakOmega.value = 22 * Math.pow((d.windSpeed * d.fetch) / (g * g), -0.33);
  u.gamma.value = d.peakEnhancement;
  u.shortWavesFade.value = d.shortWavesFade;
  u.tailFalloff.value = d.tailFalloff ?? 0;
  u.tailFloor.value = d.tailFloor ?? 1;
}

export function applySpectrumParams(uniforms, params) {
  uniforms.g.value = params.g;
  uniforms.depth.value = params.depth;
  // choppiness weighting is read every frame by the time-dependent pass, so it
  // is live even though the rest of this function only matters on an h0 rebuild
  chopFalloff.value = params.chopFalloff;
  chopFloor.value = params.chopFloor;
  chopLean.value = params.chopLean ?? 0;
  const wd = (params.local.windDirection * Math.PI) / 180;
  windX.value = Math.cos(wd);
  windZ.value = Math.sin(wd);
  fillSet(uniforms.local, params.local, params.g);
  // The swell train is fixed in wavelength — it comes from a distant storm and
  // must not shorten when the local wind drops. Its *height* is another matter.
  // Left fully fixed it becomes the entire ocean at low wind: at 8 m/s the wind
  // sea carries so little variance that a fixed swell held 56% of it, so "calm"
  // rendered as a 4.5 m sea and the wind-speed control stopped meaning anything.
  // Coupling only the amplitude, and only weakly, keeps the two trains in the
  // same ratio across the range while leaving the beat structure alone.
  fillSet(uniforms.swell, params.swell, params.g, swellWindCoupling(params));
}

// The wind speed at which swell.scale is taken literally. Pinned to the default
// sea state so the number in params reads as the weight it actually has; when
// this sat at 16 against a 10.5 m/s default, every swell scale in the file was
// silently multiplied by 0.61 and no amount of staring at the two numbers told
// you which train was winning.
const SWELL_REF_WIND = 10.5;

function swellWindCoupling(params) {
  const k = params.swell.windCoupling ?? 0;
  if (!k) return 1;
  const r = Math.min(Math.max(params.local.windSpeed / SWELL_REF_WIND, 0.35), 1.7);
  return Math.pow(r, k);
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

    // wave.y is 1/|k| and is always finite (kSafe is floored at cutoffLow), so
    // this reciprocal is safe. The weights multiply the horizontal displacement
    // and every derivative of it, and nothing else — height and the height
    // gradient stay exactly as the linear theory gives them, so the Jacobian
    // maps.js builds from these fields stays the true Jacobian of the warp.
    const kInv = wave.y;
    const kHat = vec2(wave.x, wave.z).mul(kInv);
    const chop = choppiness(float(1).div(kInv)).toVar();
    const lean = leanWeight(kHat, chop).toVar();

    // One complex weight carries both terms: the imaginary part is the classic
    // crest-peaking quarter-turn, the real part is the downwind lean. Everything
    // horizontal is then this one field times a real direction factor, and every
    // horizontal derivative is d/dx = i*kx of that — so the pair stays exact.
    const hc = cmul(h, vec2(lean, chop)).toVar();
    const ihc = vec2(hc.y.negate(), hc.x).toVar();

    const dispX = hc.mul(wave.x).mul(kInv);
    const dispY = h;
    const dispZ = hc.mul(wave.z).mul(kInv);
    const dispXdx = ihc.mul(wave.x).mul(wave.x).mul(kInv);
    const dispYdx = ih.mul(wave.x);
    const dispZdx = ihc.mul(wave.x).mul(wave.z).mul(kInv);
    const dispYdz = ih.mul(wave.z);
    const dispZdz = ihc.mul(wave.z).mul(wave.z).mul(kInv);

    DxDz.element(id).assign(vec2(dispX.x.sub(dispZ.y), dispX.y.add(dispZ.x)));
    DyDxz.element(id).assign(vec2(dispY.x.sub(dispZdx.y), dispY.y.add(dispZdx.x)));
    DyxDyz.element(id).assign(vec2(dispYdx.x.sub(dispYdz.y), dispYdx.y.add(dispYdz.x)));
    DxxDzz.element(id).assign(vec2(dispXdx.x.sub(dispZdz.y), dispXdx.y.add(dispZdz.x)));
  })().compute(N * N);
}
