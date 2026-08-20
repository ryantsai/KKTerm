import { uniform, attributeArray } from 'three/tsl';
import { buildInitialSpectrum, buildConjugate, buildTimeDependent } from './spectrum.js';

// One wave cascade: its own storage buffers, per-cascade uniforms, and the
// three compute kernels (initial spectrum, conjugate packing, time evolution).
// A cascade covers a disjoint band of wavenumbers [cutoffLow, cutoffHigh] at a
// given patch size (lengthScale), so several cascades sum to a wide spectrum
// without any single FFT having to span all wavelengths.
export class OceanCascade {
  constructor({ N, shared, noise, lengthScale, cutoffLow, cutoffHigh, time }) {
    this.N = N;
    this.lengthScale = lengthScale;
    this.deltaK = uniform((2 * Math.PI) / lengthScale);
    this.cutoffLow = uniform(cutoffLow);
    this.cutoffHigh = uniform(cutoffHigh);

    const n2 = N * N;
    // frequency-domain state
    this.h0k = attributeArray(n2, 'vec2'); // h0(k) (pre-conjugate)
    this.h0 = attributeArray(n2, 'vec4'); // ( h0(k), conj(h0(-k)) )
    this.wavesData = attributeArray(n2, 'vec4'); // ( kx, 1/|k|, kz, omega )
    // packed time-dependent spectra — the four IFFT inputs
    this.DxDz = attributeArray(n2, 'vec2');
    this.DyDxz = attributeArray(n2, 'vec2');
    this.DyxDyz = attributeArray(n2, 'vec2');
    this.DxxDzz = attributeArray(n2, 'vec2');

    this.kInitial = buildInitialSpectrum({
      N, noise, h0k: this.h0k, wavesData: this.wavesData,
      shared, deltaK: this.deltaK, cutoffLow: this.cutoffLow, cutoffHigh: this.cutoffHigh,
    });
    this.kConjugate = buildConjugate({ N, h0k: this.h0k, h0: this.h0 });
    this.kTimeDependent = buildTimeDependent({
      N, h0: this.h0, wavesData: this.wavesData,
      DxDz: this.DxDz, DyDxz: this.DyDxz, DyxDyz: this.DyxDyz, DxxDzz: this.DxxDzz, time,
    });
  }
}
