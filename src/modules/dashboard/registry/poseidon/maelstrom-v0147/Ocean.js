import { uniform, attributeArray } from 'three/tsl';
import { createSharedSpectrumUniforms, applySpectrumParams } from './spectrum.js';
import { gaussianNoise } from './gaussianNoise.js';
import { OceanCascade } from './OceanCascade.js';
import { FFT } from './fft.js';
import { createCascadeMaps } from './maps.js';

const FIELD_NAMES = ['DxDz', 'DyDxz', 'DyxDyz', 'DxxDzz'];

// Orchestrates the spectral ocean: shared Gaussian noise + spectrum uniforms,
// a set of cascades, and the per-frame compute dispatch. The inverse FFT and
// map assembly are wired in by later steps; step 2 stops at the time-dependent
// spectra (still in the frequency domain).
export class Ocean {
  constructor(renderer, params) {
    this.renderer = renderer;
    this.params = params;
    this.N = params.N;
    this.time = uniform(0);

    this.shared = createSharedSpectrumUniforms();
    applySpectrumParams(this.shared, params);

    // One Gaussian noise field, shared by every cascade (matches gasgiant).
    const noiseData = gaussianNoise(this.N);
    this.noise = attributeArray(this.N * this.N, 'vec2');
    this.noise.value.array.set(noiseData);
    this.noise.value.needsUpdate = true;

    // Cascades with disjoint wavenumber bands. Hand-off wavenumber between
    // cascade i-1 and i is 2*pi / L_i * boundaryFactor.
    this.cascades = [];
    const count = Math.min(params.cascades, params.lengthScales.length);
    const boundary = (i) => ((2 * Math.PI) / params.lengthScales[i]) * params.boundaryFactor;
    for (let i = 0; i < count; i++) {
      this.cascades.push(new OceanCascade({
        N: this.N,
        shared: this.shared,
        noise: this.noise,
        lengthScale: params.lengthScales[i],
        cutoffLow: i === 0 ? 1e-4 : boundary(i),
        cutoffHigh: i === count - 1 ? 9999 : boundary(i + 1),
        time: this.time,
      }));
    }

    // Inverse FFT: one set of kernels per (cascade, field), each with its own
    // scratch buffer so fields are mutually independent and can share a step's
    // compute pass. Group kernels by step index for batched, barriered dispatch.
    this.fft = new FFT(this.N);
    this.timeDepGroup = this.cascades.map((c) => c.kTimeDependent);
    const ffts = [];
    for (const c of this.cascades) {
      for (const name of FIELD_NAMES) {
        const scratch = attributeArray(this.N * this.N, 'vec2');
        ffts.push(this.fft.buildField(c[name], scratch));
      }
    }
    this.stepGroups = [];
    for (let s = 0; s < this.fft.logN; s++) this.stepGroups.push(ffts.map((f) => f.h[s]));
    for (let s = 0; s < this.fft.logN; s++) this.stepGroups.push(ffts.map((f) => f.v[s]));
    this.stepGroups.push(ffts.map((f) => f.permute));

    // Assemble pass: pack each cascade's spatial buffers into sampled maps + foam.
    this.lambda = uniform(params.lambda);
    this.dt = uniform(1 / 60);
    this.foamDecay = uniform(params.foamDecay);
    this.assembleGroup = [];
    for (const c of this.cascades) {
      const maps = createCascadeMaps(c, { N: this.N, lambda: this.lambda, dt: this.dt, foamDecay: this.foamDecay });
      c.displacement = maps.displacement;
      c.derivatives = maps.derivatives;
      this.assembleGroup.push(maps.assemble);
    }
  }

  // Recompute h0 (once, and whenever wind/spectrum params change).
  async updateInitialSpectrum() {
    applySpectrumParams(this.shared, this.params);
    for (const c of this.cascades) {
      await this.renderer.computeAsync(c.kInitial);
      await this.renderer.computeAsync(c.kConjugate);
    }
  }

  // Per-frame: evolve to time t, then inverse-FFT every cascade's spectra to
  // the spatial domain. Each compute() call is a separate submit so the GPU
  // sees the ping-pong barrier between FFT steps; independent fields share a
  // step's pass.
  evolve(t, dt = 1 / 60) {
    this.time.value = t;
    this.dt.value = dt;
    this.renderer.compute(this.timeDepGroup); // all cascades' time-dependent spectra
    for (const group of this.stepGroups) this.renderer.compute(group); // logN*2 + 1 steps
    this.renderer.compute(this.assembleGroup); // pack spatial buffers + accumulate foam
  }

  // Read back a cascade's packed h0 buffer for validation/diagnostics.
  async readbackH0(i = 0) {
    const ab = await this.renderer.getArrayBufferAsync(this.cascades[i].h0.value);
    return new Float32Array(ab);
  }
}
