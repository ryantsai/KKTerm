// GPU inverse FFT via the Stockham/Cooley-Tukey butterfly, ported from
// gasgiant/FFT-Ocean (MIT) FastFourierTransform.compute. A precomputed
// twiddle+butterfly-index buffer drives log2(N) horizontal then log2(N)
// vertical steps, ping-ponging between a field buffer and a scratch buffer,
// followed by an in-place (-1)^(x+y) permute that reconciles the centered
// spectrum. The transform is the unnormalized inverse DFT (Tessendorf's raw
// synthesis sum) — no 1/N^2 scaling, matching the h0 amplitude calibration.
//
// WebGPU has no memory barrier between dispatches inside one compute pass, so
// each step must be a separate renderer.compute() call (separate submit). To
// keep that cheap, callers batch the same step across many independent fields
// into one call (see Ocean.evolve).
import { Fn, instanceIndex, uint, float, vec2, attributeArray } from 'three/tsl';

const cmul = (a, b) => vec2(a.x.mul(b.x).sub(a.y.mul(b.y)), a.x.mul(b.y).add(a.y.mul(b.x)));

// CPU precompute of the butterfly table: for each step and output index,
// (twiddle.re, twiddle.im, inputIndexA, inputIndexB). Forward twiddles; the
// IFFT kernels conjugate them.
function fillButterfly(array, N) {
  const logN = Math.log2(N);
  for (let step = 0; step < logN; step++) {
    const b = N >> (step + 1);
    for (let j = 0; j < N / 2; j++) {
      const i = (2 * b * Math.floor(j / b) + (j % b)) % N;
      const X = Math.floor(j / b) * b;
      const twRe = Math.cos((2 * Math.PI * X) / N);
      const twIm = -Math.sin((2 * Math.PI * X) / N);
      const put = (col, re, im) => {
        const o = (step * N + col) * 4;
        array[o] = re; array[o + 1] = im; array[o + 2] = i; array[o + 3] = i + b;
      };
      put(j, twRe, twIm);
      put(j + N / 2, -twRe, -twIm);
    }
  }
}

export class FFT {
  constructor(N) {
    this.N = N;
    this.logN = Math.log2(N);
    this.butterfly = attributeArray(this.logN * N, 'vec4');
    fillButterfly(this.butterfly.value.array, N);
    this.butterfly.value.needsUpdate = true;
  }

  // One horizontal butterfly step (transform along x). Even steps read `field`
  // and write `scratch`; odd steps the reverse — so after logN (even) steps the
  // result is back in `field`.
  _hStep(field, scratch, s) {
    const N = this.N;
    const src = s % 2 === 0 ? field : scratch;
    const dst = s % 2 === 0 ? scratch : field;
    const bf = this.butterfly;
    return Fn(() => {
      const id = instanceIndex;
      const x = id.mod(uint(N));
      const y = id.div(uint(N));
      const data = bf.element(uint(s * N).add(x));
      const tw = vec2(data.x, data.y.negate()); // conjugate -> inverse
      const a = src.element(y.mul(N).add(uint(data.z)));
      const b = src.element(y.mul(N).add(uint(data.w)));
      dst.element(id).assign(a.add(cmul(tw, b)));
    })().compute(N * N);
  }

  // One vertical butterfly step (transform along y).
  _vStep(field, scratch, s) {
    const N = this.N;
    const src = s % 2 === 0 ? field : scratch;
    const dst = s % 2 === 0 ? scratch : field;
    const bf = this.butterfly;
    return Fn(() => {
      const id = instanceIndex;
      const x = id.mod(uint(N));
      const y = id.div(uint(N));
      const data = bf.element(uint(s * N).add(y));
      const tw = vec2(data.x, data.y.negate());
      const a = src.element(uint(data.z).mul(N).add(x));
      const b = src.element(uint(data.w).mul(N).add(x));
      dst.element(id).assign(a.add(cmul(tw, b)));
    })().compute(N * N);
  }

  // Final in-place permute: multiply by (-1)^(x+y).
  _permute(field) {
    const N = this.N;
    return Fn(() => {
      const id = instanceIndex;
      const x = id.mod(uint(N));
      const y = id.div(uint(N));
      const sign = float(1).sub(float(x.add(y).mod(uint(2))).mul(2));
      field.element(id).assign(field.element(id).mul(sign));
    })().compute(N * N);
  }

  // Build the ordered kernels that inverse-transform `field` in place using
  // `scratch`. Returns { h: [logN], v: [logN], permute }.
  buildField(field, scratch) {
    const h = [];
    const v = [];
    for (let s = 0; s < this.logN; s++) {
      h.push(this._hStep(field, scratch, s));
      v.push(this._vStep(field, scratch, s));
    }
    return { h, v, permute: this._permute(field) };
  }
}

// Isolation test (the hard gate): inverse-transform two known spectra and
// compare against the analytic spatial result. Runs once at init, fully
// independent of the ocean. Returns { pass, err1, err2 }.
export async function validateFFT(renderer, N) {
  const fft = new FFT(N);

  async function ifftOf(fill) {
    const field = attributeArray(N * N, 'vec2');
    const scratch = attributeArray(N * N, 'vec2');
    const k = fft.buildField(field, scratch);
    fill(field.value.array);
    field.value.needsUpdate = true;
    for (const s of k.h) renderer.compute(s);
    for (const s of k.v) renderer.compute(s);
    renderer.compute(k.permute);
    return new Float32Array(await renderer.getArrayBufferAsync(field.value));
  }

  // Test 1: impulse at centered DC -> constant (1, 0) everywhere.
  const r1 = await ifftOf((a) => {
    a.fill(0);
    const c = ((N / 2) * N + N / 2) * 2;
    a[c] = 1;
  });
  let err1 = 0;
  for (let i = 0; i < N * N; i++) err1 = Math.max(err1, Math.abs(r1[i * 2] - 1), Math.abs(r1[i * 2 + 1]));

  // Test 2: impulse at centered (N/2+1, N/2) -> ( cos(2pi x/N), sin(2pi x/N) ).
  const r2 = await ifftOf((a) => {
    a.fill(0);
    const c = ((N / 2) * N + (N / 2 + 1)) * 2;
    a[c] = 1;
  });
  let err2 = 0;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const o = (y * N + x) * 2;
      err2 = Math.max(err2, Math.abs(r2[o] - Math.cos((2 * Math.PI * x) / N)), Math.abs(r2[o + 1] - Math.sin((2 * Math.PI * x) / N)));
    }
  }

  return { pass: err1 < 1e-3 && err2 < 1e-3, err1, err2 };
}
