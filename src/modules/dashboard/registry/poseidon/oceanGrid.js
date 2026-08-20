import { BufferGeometry, BufferAttribute, Sphere, Vector3 } from 'three/webgpu';

// Camera-centred radial grid ("donut"): concentric rings of `sectors` vertices
// around a single centre vertex, authored in the XY plane so it drops straight
// into the surface material's positionGeometry.xy -> world XZ convention.
//
// Ring spacing grows quadratically with ring index — dr(i) = spacing*(1+i/soften)^2
// — so the innermost rings sit ~0.35 m apart under the camera and the outermost
// are hundreds of metres apart out at ~20 km. Two properties make this the right
// shape for an ocean:
//   - angular resolution is constant, so one triangle covers about the same
//     number of pixels at 5 m as it does at 5 km: no wasted density anywhere;
//   - the outer rings are far wider than the longest wave in the spectrum, so
//     the displaced surface flattens out on its own into a clean horizon line
//     instead of ending in a wall of waves.
export function createRadialGrid({ rings = 620, sectors = 1280, spacing = 0.35, soften = 41 } = {}) {
  const radii = new Float64Array(rings + 1); // radii[0] = 0 (centre vertex)
  for (let i = 1; i <= rings; i++) {
    const g = 1 + (i - 1) / soften;
    radii[i] = radii[i - 1] + spacing * g * g;
  }

  // Odd rings are rotated half a sector. That turns the quad strips into a
  // staggered triangular lattice, which matters for more than triangle quality:
  // an unstaggered grid puts a dead-straight line of vertices along every
  // sector angle, and looking down one of those spokes the long radial
  // triangles are seen edge-on all the way to the horizon, printing a visible
  // wedge on the water at the vanishing point. Zig-zagging the rows scatters it.
  const vertexCount = rings * sectors + 1;
  const pos = new Float32Array(vertexCount * 3); // centre is already (0,0,0)
  const step = (Math.PI * 2) / sectors;
  for (let i = 1; i <= rings; i++) {
    const r = radii[i];
    const off = (i % 2) * 0.5 * step;
    let p = (1 + (i - 1) * sectors) * 3;
    for (let j = 0; j < sectors; j++, p += 3) {
      pos[p] = r * Math.cos(j * step + off);
      pos[p + 1] = r * Math.sin(j * step + off);
    }
  }

  // centre fan + one strip per ring gap, splitting each cell on its short
  // diagonal — which way that runs flips with the stagger
  const idx = new Uint32Array(sectors * 3 + (rings - 1) * sectors * 6);
  let k = 0;
  for (let j = 0; j < sectors; j++) {
    const j2 = (j + 1) % sectors;
    idx[k++] = 0; idx[k++] = 1 + j; idx[k++] = 1 + j2;
  }
  for (let i = 1; i < rings; i++) {
    const a = 1 + (i - 1) * sectors;
    const b = 1 + i * sectors;
    const outwardShift = i % 2 === 0; // ring i+1 sits half a sector anticlockwise
    for (let j = 0; j < sectors; j++) {
      const j2 = (j + 1) % sectors;
      if (outwardShift) {
        idx[k++] = a + j; idx[k++] = b + j; idx[k++] = a + j2;
        idx[k++] = a + j2; idx[k++] = b + j; idx[k++] = b + j2;
      } else {
        idx[k++] = a + j; idx[k++] = b + j2; idx[k++] = b + j;
        idx[k++] = a + j; idx[k++] = a + j2; idx[k++] = b + j2;
      }
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(pos, 3));
  geometry.setIndex(new BufferAttribute(idx, 1));
  // set by hand: the mesh is never frustum-culled and displacement moves the
  // vertices anyway, so nothing should ever walk this many verts to find it
  geometry.boundingSphere = new Sphere(new Vector3(), radii[rings]);

  return { geometry, outerRadius: radii[rings], vertexCount, innerSpacing: spacing };
}
