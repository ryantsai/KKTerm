// Gaussian white noise (two independent N(0,1) samples per cell) used to seed
// the initial spectrum h0. Box-Muller transform, generated once on the CPU.
//
// SEEDED, and that is load-bearing rather than tidiness. This field is the only
// stochastic input to the whole simulation: h0 is built from it, and every
// wave in every frame follows. Drawn from Math.random() — which is what this
// did — each page load produced a *different ocean*, so tools/shot.mjs could
// not do the one job it exists for. Its own header calls the captures
// "deterministic screenshots ... for comparable shots across iterations"; they
// were comparable in framing and sim time only, and any two runs differed by a
// whole sea state's worth of luck. That silently invalidates every A/B this
// project has ever taken: a preset like `trough` (eye at 1.4 m) can come back
// with the camera underwater on one run and in clear air on the next, off the
// same code.
//
// mulberry32: 4 lines, no dependency, and passes enough of gjrand for noise
// this is only ever fed through a Box-Muller transform. Pass a different seed
// to get a different ocean on purpose rather than by accident.
// Not crypto, not a distribution to defend — it seeds a wave field.
function mulberry32(a) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gaussianNoise(N, seed = 0x5eed0cea) {
  const rand = mulberry32(seed);
  const data = new Float32Array(N * N * 2);
  for (let i = 0; i < N * N; i++) {
    const u1 = Math.max(rand(), 1e-7);
    const u2 = rand();
    const r = Math.sqrt(-2.0 * Math.log(u1));
    data[i * 2 + 0] = r * Math.cos(2.0 * Math.PI * u2);
    data[i * 2 + 1] = r * Math.sin(2.0 * Math.PI * u2);
  }
  return data;
}
