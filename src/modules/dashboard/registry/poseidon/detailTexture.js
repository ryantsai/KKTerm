import {
  DataTexture, RGBAFormat, UnsignedByteType, RepeatWrapping, LinearFilter, LinearMipmapLinearFilter,
} from 'three/webgpu';

// A seamless tiling noise texture, baked once on the CPU. Sampling this is
// vastly cheaper than evaluating MaterialX fbm per fragment. Channels:
//   R  = coarse cellular (Worley F1, jittered radius) — foam holes
//   G  = finer cellular, ~2x the density
//   B  = low-frequency fbm value (streak / chunk carves, variation)
//   A  = higher-frequency fbm value
//
// R and G used to hold a baked gradient of the fbm, which nothing ever read:
// the gradient of a smooth field is small, and packing it as (-h' * 3 * 0.5 +
// 0.5) into 8 bits put the whole field inside 128 +/- 3. Three code values. The
// cellular pair below is what they carry now.
//
// WHY CELLULAR, FOR HOLES SPECIFICALLY. An fbm has energy at every scale, so
// whole regions of it run low and the holes a threshold punches inside those
// regions CLUSTER. Measured on the shipped B channel: autocorrelation still
// 0.414 at a tenth of a tile, and the variance-to-mean ratio of below-threshold
// pixel counts per block is 521. That clustering is what reads as clumpy and
// concentrated foam, and no change of tile size fixes it, because it is a
// property of the spectrum rather than of the scale.
//
// A cellular field has one feature per grid cell, so holes cannot pile up:
// measured 0.117 at the same lag and a dispersion of 303 at the settings baked
// here — roughly a third of the clustering. Density (cells per tile) and size
// (the radius) are also independent knobs, which they never are in an fbm.
//
// The classic objection to Worley for this job is that plain F1 has exactly ONE
// characteristic size, which trades a clumping problem for a halftone one. That
// is why each feature point carries its own LOGNORMAL radius and the field is
// min(|x - p_i| / r_i): a genuine size distribution at fixed density. The other
// objection — that a cellular field's low tail is empty, so hole-punching
// carves silently stop punching — applies to F2-F1, not to this. Measured
// against the fbm at the three thresholds this project actually cuts at:
// P(<0.20) 5.7% vs 5.0%, P(<0.28) 17.1% vs 18.1%, P(<0.35) 33.6% vs 35.1%.
// Within a point and a half everywhere, so every carve constant tuned against
// the fbm stays valid unchanged.
// Statistics of the field as it was originally baked (3 octaves, persistence
// 0.5), measured over the whole tile. Every carve constant in foamShading.js is
// tuned against these — the `sub(0.44)` and `sub(0.45)` biases scattered through
// that file are all sitting near this mean — so the field is renormalised back
// onto them below. That is what makes the octave count and the persistence FREE
// PARAMETERS: change the spectrum, keep the statistics, and nothing downstream
// has to be retuned.
const TARGET_MEAN = 0.4089;
const TARGET_STD = 0.1328;

// Cells per tile for the two cellular channels, and the spread of their radii.
// Non-harmonic on purpose (5 and 11, not 5 and 10): two cellular lattices an
// octave apart reinforce instead of interfering, which is the same trap the
// erosion tiles in foamShading.js are kept clear of.
//
// The counts are chosen so the delivered feature size matches the fbm channels
// they sit beside — measured feature diameter is 0.176 x tile for B and 0.088
// for A, and these land at 0.18 and 0.078 — so foamShading's CELL_TILE keeps
// meaning what it means and the ~40 cm holes it is set for stay ~40 cm.
//
// RADIUS_SIGMA is the one real dial. At 0 the field is maximally regular
// (dispersion 178, the least clumpy) but every hole is the same size; at 0.55
// there is a wide size distribution and dispersion climbs to 303. 0.45 keeps
// most of the decluttering and still gives holes that are visibly not all one
// size, which is the failure a single-frequency cellular field is known for.
const CELL_COUNT_COARSE = 5;
const CELL_COUNT_FINE = 11;
const RADIUS_SIGMA = 0.45;

// More octaves, and a flatter falloff than the classic 0.5. Both are aimed at
// one artifact: with three octaves at half amplitude the coarsest one carries
// 57% of the variance, so the field has essentially ONE feature size, and every
// carve built on it punches holes of that same size. A magnified capture of a
// whitecap showed exactly that — a raft of near-identical comma-shaped holes at
// near-identical spacing, which reads as one brush stamped repeatedly. At 0.68
// the third and fourth octaves still carry real weight, so holes come in a
// range of sizes and the raft stops looking printed.
//
// Five octaves and not six: the finest lands at 8 texels per feature on a 512
// tile, which the mip chain can still filter honestly. At six it is 4 texels and
// the bake is aliasing before the GPU ever sees it.
// Tiling cellular field: one feature point per grid cell, uniformly jittered
// inside it, each with its own lognormal radius, and F = min(|x - p| / r) over
// the 5x5 neighbourhood. 5x5 rather than 3x3 because a large-radius point two
// cells away can legitimately win the min once the radii are jittered.
//
// It wraps by construction — the cell index is taken modulo `cells`, so the
// field is exactly periodic on the tile with no seam and no blend region.
//
// Returned unnormalised; the caller renormalises onto TARGET_MEAN / TARGET_STD
// exactly as it does for the fbm, which is what keeps the channel contract.
function cellularField(size, cells, sigmaLog, seed) {
  let s = seed >>> 0;
  const rng = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const n = cells * cells;
  const px = new Float32Array(n);
  const py = new Float32Array(n);
  const pr = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    px[i] = rng();
    py[i] = rng();
    // Box-Muller into a lognormal with median radius of one cell.
    const u1 = Math.max(rng(), 1e-9);
    const u2 = rng();
    const g = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    pr[i] = Math.exp(g * sigmaLog);
  }
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const fy = (y / size) * cells;
    const cy = Math.floor(fy);
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * cells;
      const cx = Math.floor(fx);
      let best = 1e9;
      for (let oy = -2; oy <= 2; oy++) {
        const gy = (((cy + oy) % cells) + cells) % cells;
        for (let ox = -2; ox <= 2; ox++) {
          const gx = (((cx + ox) % cells) + cells) % cells;
          const i = gy * cells + gx;
          const dx = cx + ox + px[i] - fx;
          const dy = cy + oy + py[i] - fy;
          const d = Math.sqrt(dx * dx + dy * dy) / pr[i];
          if (d < best) best = d;
        }
      }
      out[y * size + x] = best;
    }
  }
  return out;
}

// Renormalise a field onto the target moments — see TARGET_MEAN. This is what
// makes the field's construction a free parameter: change the spectrum, or the
// noise family entirely, keep the statistics, and nothing downstream retunes.
function renormalise(f) {
  let sum = 0;
  let sum2 = 0;
  for (let i = 0; i < f.length; i++) { sum += f[i]; sum2 += f[i] * f[i]; }
  const mean = sum / f.length;
  const gain = TARGET_STD / Math.sqrt(Math.max(sum2 / f.length - mean * mean, 1e-9));
  for (let i = 0; i < f.length; i++) f[i] = (f[i] - mean) * gain + TARGET_MEAN;
  return f;
}

export function makeDetailTexture(size = 512, octaves = 5, persistence = 0.68) {
  const rand = new Float32Array(size * size);
  let seed = 1234567;
  const rng = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let i = 0; i < size * size; i++) rand[i] = rng();

  const cellC = renormalise(cellularField(size, CELL_COUNT_COARSE, RADIUS_SIGMA, 0x9e3779b9));
  const cellF = renormalise(cellularField(size, CELL_COUNT_FINE, RADIUS_SIGMA, 0x85ebca6b));

  const smooth = (t) => t * t * (3 - 2 * t);

  // Value-noise octave that wraps at frequency f, so the whole field tiles.
  const octave = (u, v, f) => {
    const x = u * f;
    const y = v * f;
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const uu = smooth(x - xi);
    const vv = smooth(y - yi);
    const A = (X, Y) => rand[((((Y % f) + f) % f) * size) + (((X % f) + f) % f)];
    const a = A(xi, yi);
    const b = A(xi + 1, yi);
    const c = A(xi, yi + 1);
    const d = A(xi + 1, yi + 1);
    return a * (1 - uu) * (1 - vv) + b * uu * (1 - vv) + c * (1 - uu) * vv + d * uu * vv;
  };

  const raw = (u, v) => {
    let s = 0;
    let amp = 0.5;
    let f = 4;
    for (let o = 0; o < octaves; o++) {
      s += amp * octave(u, v, f);
      amp *= persistence;
      f *= 2;
    }
    return s;
  };

  // Renormalise onto TARGET_MEAN / TARGET_STD — see above. Measured on a coarse
  // stride rather than every texel: this is estimating two moments of a smooth
  // field, and a quarter of the samples gets them to more decimal places than
  // anything downstream can tell apart, for a sixteenth of the bake cost.
  let n = 0;
  let sum = 0;
  let sum2 = 0;
  for (let y = 0; y < size; y += 4) {
    for (let x = 0; x < size; x += 4) {
      const h = raw(x / size, y / size);
      n++; sum += h; sum2 += h * h;
    }
  }
  const mean = sum / n;
  const gain = TARGET_STD / Math.sqrt(Math.max(sum2 / n - mean * mean, 1e-9));
  const fbm = (u, v) => (raw(u, v) - mean) * gain + TARGET_MEAN;

  // Dithered quantisation, +/- half an LSB before the round. The filament
  // transform in foamShading divides these channels by widths of 0.15-0.24,
  // amplifying 8-bit staircase plateaus ~6x — visible as contour banding in
  // the ribbons. Half-LSB noise converts the staircase into grain the carves
  // already own.
  const clamp255 = (x) => Math.max(0, Math.min(255, Math.round(x + (rng() - 0.5))));
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const i = (y * size + x) * 4;
      data[i] = clamp255(cellC[y * size + x] * 255); // coarse cellular
      data[i + 1] = clamp255(cellF[y * size + x] * 255); // fine cellular
      data[i + 2] = clamp255(fbm(u, v) * 255); // low-freq fbm value
      data[i + 3] = clamp255(fbm(u * 2, v * 2) * 255); // higher-freq fbm value
    }
  }

  const tex = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}
