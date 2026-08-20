import { Vector2 } from 'three/webgpu';
import { uniform, attributeArray } from 'three/tsl';
import { createSharedSpectrumUniforms, applySpectrumParams } from './spectrum.js';
import { gaussianNoise } from './gaussianNoise.js';
import { OceanCascade } from './OceanCascade.js';
import { FFT } from './fft.js';
import { createCascadeMaps } from './maps.js';

const FIELD_NAMES = ['DxDz', 'DyDxz', 'DyxDyz', 'DxxDzz'];

// Surface drift the foam rafts ride, as a fraction of U10. Foam is a passive
// tracer of the surface CURRENT, not of the wave orbital: rafts ride ~3% of the
// wind plus Stokes drift and are left nearly stationary in the water frame
// while the waves pass under them (docs/foam-research.md). At the default
// 10.5 m/s that is 0.32 m/s, two orders below the crest phase speed, so trails
// lag the crest that made them instead of tracking it, and the lag lies along
// the wind, which is within a few degrees of where Langmuir windrows actually
// are. Stokes drift would add another 20-30% on top; 3% is the documented
// figure, so 3% ships.
const FOAM_DRIFT_FRACTION = 0.03;

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
    // Foam rafts drift with the surface current, so the accumulator advects.
    // Refreshed every evolve() from params.local — never params.swell, since a
    // distant storm's swell carries no local surface current — so a wind change
    // carries straight through with no rebuild.
    this.drift = uniform(new Vector2());
    this.foamSpread = uniform(params.foamSpread);
    this.frame = 0;
    // The accumulator reads its own NEIGHBOURHOOD from last frame, and a
    // storage texture cannot be sampled and written in the same dispatch, so it
    // ping-pongs between two history textures swapped by frame parity: one
    // assemble kernel per parity, six pipelines instead of three. The extra
    // cost is one-time shader compilation, not per-frame work.
    this.assembleGroups = [[], []];
    for (const c of this.cascades) {
      const maps = createCascadeMaps(c, {
        N: this.N,
        lambda: this.lambda,
        dt: this.dt,
        foamDecay: this.foamDecay,
        foamSpread: this.foamSpread,
        drift: this.drift,
      });
      c.displacement = maps.displacement;
      c.derivatives = maps.derivatives;
      this.assembleGroups[0].push(maps.assemble[0]);
      this.assembleGroups[1].push(maps.assemble[1]);
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
    // Downwind unit vector in world XZ, in spectrum.js's own convention
    // (windX = cos(wd), windZ = sin(wd) — see applySpectrumParams), so the
    // drift lines up with the sea it is drifting.
    const wd = (this.params.local.windDirection * Math.PI) / 180;
    const v = FOAM_DRIFT_FRACTION * this.params.local.windSpeed;
    this.drift.value.set(v * Math.cos(wd), v * Math.sin(wd));
    this.renderer.compute(this.timeDepGroup); // all cascades' time-dependent spectra
    for (const group of this.stepGroups) this.renderer.compute(group); // logN*2 + 1 steps
    // pack spatial buffers + accumulate foam; parity picks which history is
    // read and which is written
    this.renderer.compute(this.assembleGroups[this.frame & 1]);
    this.frame++;
  }

  // Read back a cascade's packed h0 buffer for validation/diagnostics.
  async readbackH0(i = 0) {
    const ab = await this.renderer.getArrayBufferAsync(this.cascades[i].h0.value);
    return new Float32Array(ab);
  }
}
