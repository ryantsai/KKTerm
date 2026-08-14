import { StorageTexture, HalfFloatType, RepeatWrapping } from 'three/webgpu';
import {
  Fn, instanceIndex, uint, uvec2, vec4, float, max, min, attributeArray, textureStore,
} from 'three/tsl';

// rgba16f storage texture: filterable (bilinear) AND storage-capable, tiling
// via RepeatWrapping, auto-mipmapped after each compute write.
function mapTexture(N) {
  const tex = new StorageTexture(N, N);
  tex.type = HalfFloatType;
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  return tex;
}

// Assemble pass: pack a cascade's spatial IFFT buffers into two sampled maps and
// accumulate foam.
//   displacement = ( lambda*Dx, height, lambda*Dz, turbulence )
//   derivatives  = ( dDy/dx, dDy/dz, lambda*dDx/dx, lambda*dDz/dz )
// Foam: the Jacobian of horizontal displacement folds (< ~0) on breaking crests.
// `turbulence` is a persistent per-texel value that snaps down on a fold and
// recovers slowly, so whitecaps build and dissipate instead of flickering
// (gasgiant). It rides in displacement.w; the surface shader reads it for foam.
export function createCascadeMaps(cascade, { N, lambda, dt, foamDecay }) {
  const displacement = mapTexture(N);
  const derivatives = mapTexture(N);
  const turbulence = attributeArray(N * N, 'float');
  turbulence.value.array.fill(1.0); // start un-foamed (flat Jacobian)
  turbulence.value.needsUpdate = true;

  const assemble = Fn(() => {
    const id = instanceIndex;
    const coord = uvec2(id.mod(uint(N)), id.div(uint(N)));
    const DxDz = cascade.DxDz.element(id); // (Dx, Dz)
    const DyDxz = cascade.DyDxz.element(id); // (height, dDz/dx)
    const DyxDyz = cascade.DyxDyz.element(id); // (dDy/dx, dDy/dz)
    const DxxDzz = cascade.DxxDzz.element(id); // (dDx/dx, dDz/dz)

    const jxx = float(1).add(lambda.mul(DxxDzz.x));
    const jzz = float(1).add(lambda.mul(DxxDzz.y));
    const jxz = lambda.mul(DyDxz.y); // lambda * dDz/dx (= dDx/dz by symmetry)
    const J = jxx.mul(jzz).sub(jxz.mul(jxz));

    // snap down on a fold (foam appears with the crash), then recover slowly
    // toward 1 so foam lingers and dissipates. foamDecay = recovery rate
    // (lower = foam lasts longer).
    const prev = turbulence.element(id);
    const turb = min(J, prev.add(dt.mul(foamDecay).div(max(J, float(0.5)))));
    turbulence.element(id).assign(turb);

    textureStore(displacement, coord, vec4(DxDz.x.mul(lambda), DyDxz.x, DxDz.y.mul(lambda), turb)).toWriteOnly();
    textureStore(derivatives, coord, vec4(DyxDyz.x, DyxDyz.y, DxxDzz.x.mul(lambda), DxxDzz.y.mul(lambda))).toWriteOnly();
  })().compute(N * N);

  return { displacement, derivatives, turbulence, assemble };
}
