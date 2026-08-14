import { MeshBasicNodeMaterial, DoubleSide } from 'three/webgpu';
import {
  Fn, positionGeometry, positionWorld, cameraPosition, vec2, vec3, vec4, float,
  texture, normalize, reflect, dot, max, pow, mix, saturate, abs, smoothstep,
} from 'three/tsl';
import { skyColor } from './sky.js';

// The ocean surface: multi-cascade displacement (vertex) + water shading
// (fragment). Shading is manual (unlit MeshBasicNodeMaterial): Fresnel blends
// the deep water body against an analytic sky reflection, the reflected sun
// disc gives the glitter path, SSS adds crest glow, and accumulated-Jacobian
// foam whitens breaking crests. A cheap baked tiling noise texture (sampled at
// two scrolling scales) adds sub-grid normal detail and breaks up the foam, so
// neither the surface nor the whitecaps read as uniform.
export function createOceanSurfaceMaterial(cascades, { lengthScales, shading, detailTex }) {
  const mat = new MeshBasicNodeMaterial();
  // Plane is authored in XY and remapped to XZ in positionNode, flipping the
  // winding — render both sides so it's visible from above too.
  mat.side = DoubleSide;
  const worldXZ = vec2(positionGeometry.x, positionGeometry.y);

  mat.positionNode = Fn(() => {
    const disp = vec3(0).toVar();
    cascades.forEach((c, i) => {
      disp.addAssign(texture(c.displacement, worldXZ.div(lengthScales[i])).level(0).xyz);
    });
    return vec3(positionGeometry.x.add(disp.x), disp.y, positionGeometry.y.add(disp.z));
  })();

  mat.colorNode = Fn(() => {
    const t = shading.time;

    // world normal from summed derivative maps (fold-aware slope)
    const d = vec4(0).toVar();
    cascades.forEach((c, i) => {
      d.addAssign(texture(c.derivatives, worldXZ.div(lengthScales[i])));
    });
    const slopeX = d.x.div(float(1).add(d.z));
    const slopeZ = d.y.div(float(1).add(d.w));
    const N = normalize(vec3(slopeX.negate(), float(1), slopeZ.negate())).toVar();

    // sub-grid ripple detail from the baked noise texture, two scrolling scales
    const det1 = texture(detailTex, worldXZ.mul(0.06).add(vec2(t.mul(0.012), t.mul(0.008)))).xy.sub(0.5).mul(2);
    const det2 = texture(detailTex, worldXZ.mul(0.17).add(vec2(t.mul(-0.02), t.mul(0.015)))).xy.sub(0.5).mul(2);
    const detail = det1.add(det2.mul(0.5)).mul(shading.detail);
    N.assign(normalize(N.add(vec3(detail.x, 0, detail.y))));

    const V = normalize(cameraPosition.sub(positionWorld));
    const fresnel = float(0.02).add(float(0.98).mul(pow(float(1).sub(max(dot(N, V), 0)), 5)));

    // sky reflection, reflected ray clamped to the upper hemisphere
    const R = reflect(V.negate(), N);
    const reflection = skyColor(normalize(vec3(R.x, abs(R.y).max(0.02), R.z)), shading);

    // deep water body + subsurface scatter on sunlit crests
    const heightFactor = saturate(positionWorld.y.mul(0.5).add(0.4));
    const H = normalize(N.negate().add(shading.sunDir));
    const sss = pow(saturate(dot(V, H.negate())), 4).mul(shading.sssStrength).mul(heightFactor);
    const body = mix(shading.deepColor, shading.scatterColor, saturate(float(0.12).add(sss)));
    const water = mix(body, reflection, fresnel);

    // foam on real crest-folds only (skip the finest cascade's constant speckle)
    const foamRaw = float(0).toVar();
    cascades.forEach((c, i) => {
      if (i >= cascades.length - 1) return;
      const turb = texture(c.displacement, worldXZ.div(lengthScales[i])).w;
      foamRaw.addAssign(saturate(shading.foamThreshold.sub(turb).mul(shading.foamScale)));
    });
    const coverage = smoothstep(float(0.2), float(0.9), foamRaw); // smooth crest coverage

    // bubbly structure: modulate foam BRIGHTNESS with the noise texture at two
    // scrolling scales (never carve coverage -> no dots), then shade the foam as
    // a near-Lambertian surface lit by sun + sky so it has depth, not flat paint
    const fb1 = texture(detailTex, worldXZ.mul(0.45).add(vec2(t.mul(0.03), t.mul(0.02)))).b;
    const fb2 = texture(detailTex, worldXZ.mul(1.6).add(vec2(t.mul(-0.05), t.mul(0.04)))).a;
    const bubbles = saturate(fb1.mul(0.7).add(fb2.mul(0.5)).add(0.2));
    const foamLight = float(0.55).add(saturate(dot(N, shading.sunDir)).mul(0.6));
    const foamShaded = shading.foamColor.mul(foamLight).mul(bubbles);
    return mix(water, foamShaded, coverage);
  })();

  return mat;
}
