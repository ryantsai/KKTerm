// Gaussian white noise (two independent N(0,1) samples per cell) used to seed
// the initial spectrum h0. Box-Muller transform, generated once on the CPU.
export function gaussianNoise(N) {
  const data = new Float32Array(N * N * 2);
  for (let i = 0; i < N * N; i++) {
    const u1 = Math.max(Math.random(), 1e-7);
    const u2 = Math.random();
    const r = Math.sqrt(-2.0 * Math.log(u1));
    data[i * 2 + 0] = r * Math.cos(2.0 * Math.PI * u2);
    data[i * 2 + 1] = r * Math.sin(2.0 * Math.PI * u2);
  }
  return data;
}
