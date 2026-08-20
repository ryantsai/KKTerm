import {
  DataTexture, RGBAFormat, UnsignedByteType, RepeatWrapping, LinearFilter, LinearMipmapLinearFilter,
} from 'three/webgpu';

// A seamless tiling fbm noise texture, baked once on the CPU. Sampling this is
// vastly cheaper than evaluating MaterialX fbm per fragment. Channels:
//   RG = detail normal perturbation (encoded *0.5+0.5)
//   B  = low-frequency value (foam break-up / variation)
//   A  = higher-frequency value
export function makeDetailTexture(size = 512, octaves = 3) {
  const rand = new Float32Array(size * size);
  let seed = 1234567;
  const rng = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let i = 0; i < size * size; i++) rand[i] = rng();

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

  const fbm = (u, v) => {
    let s = 0;
    let amp = 0.5;
    let f = 4;
    for (let o = 0; o < octaves; o++) {
      s += amp * octave(u, v, f);
      amp *= 0.5;
      f *= 2;
    }
    return s;
  };

  const clamp255 = (x) => Math.max(0, Math.min(255, Math.round(x)));
  const data = new Uint8Array(size * size * 4);
  const eps = 1 / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const h = fbm(u, v);
      const hx = fbm(u + eps, v) - fbm(u - eps, v);
      const hy = fbm(u, v + eps) - fbm(u, v - eps);
      const i = (y * size + x) * 4;
      data[i] = clamp255((-hx * 3 * 0.5 + 0.5) * 255); // normal.x
      data[i + 1] = clamp255((-hy * 3 * 0.5 + 0.5) * 255); // normal.y
      data[i + 2] = clamp255(h * 255); // low-freq value
      data[i + 3] = clamp255(fbm(u * 2, v * 2) * 255); // higher-freq value
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
