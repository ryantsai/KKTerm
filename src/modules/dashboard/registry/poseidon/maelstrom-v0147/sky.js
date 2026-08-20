import { Mesh, SphereGeometry, MeshBasicNodeMaterial, BackSide } from 'three/webgpu';
import { positionWorld, normalize, mix, smoothstep, max, dot, pow, float } from 'three/tsl';

// Analytic sky color for a view/reflection direction: vertical gradient plus a
// sun disc and soft halo. Shared by the sky dome and the ocean reflection so
// the reflected sky and the actual sky always match.
export function skyColor(dir, u) {
  const t = smoothstep(float(-0.05), float(0.4), dir.y);
  const grad = mix(u.horizon, u.zenith, t);
  const sd = max(dot(dir, u.sunDir), 0);
  const disc = pow(sd, float(1200)).mul(u.sunColor).mul(8); // sun disc
  const halo = pow(sd, float(7)).mul(u.sunColor).mul(0.35); // soft glow
  return grad.add(disc).add(halo);
}

export function createSkyDome(u, radius = 12000) {
  const mat = new MeshBasicNodeMaterial();
  mat.side = BackSide;
  mat.fog = false;
  mat.colorNode = skyColor(normalize(positionWorld), u);
  return new Mesh(new SphereGeometry(radius, 32, 16), mat);
}
