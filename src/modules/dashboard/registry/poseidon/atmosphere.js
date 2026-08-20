import { Fn, fog, positionWorld, cameraPosition, normalize, length } from 'three/tsl';
import { skyColor } from './sky.js';

// Aerial perspective, wired in as scene.fogNode so every fogged material picks
// it up without any of them knowing about it.
//
// The haze colour is not a constant: it is the *sky in the direction of the
// fragment*, evaluated with the same analytic function the dome and the water
// reflection use. So distant water converges on exactly the value of the sky
// directly behind it, which is what makes the far edge of the mesh vanish and
// leaves a horizon line instead of a silhouette. It also picks up the bright
// band around the sun's azimuth for free, so the glitter path dissolves into
// glare rather than stopping dead.
//
// Extinction is Beer-Lambert over true world distance (not view-z, so the haze
// band stays circular instead of bulging at the frame corners) with density
// falling off exponentially with altitude. The height term is what lets a
// grazing shot from 2 m have a thick horizon band while a 200 m vista of the
// same water stays clear enough to keep its contrast.
const HAZE_DENSITY = 1 / 2150; // extinction per metre at sea level
const SCALE_HEIGHT = 450; // metres for the haze to thin by 1/e

export function createAerialPerspective(shading, { density = HAZE_DENSITY, scaleHeight = SCALE_HEIGHT } = {}) {
  const toFrag = positionWorld.sub(cameraPosition);
  // exp(-y/H) at the ray's midpoint stands in for its average along the ray —
  // within a few percent for anything under the scale height, and free of the
  // divide-by-zero the exact integral has for a level ray.
  const midY = positionWorld.y.add(cameraPosition.y).mul(0.5).max(0);
  const tau = length(toFrag).mul(density).mul(midY.div(scaleHeight).negate().exp());
  // skyColor() declares locals (the cloud fBm), so it has to be evaluated
  // inside a Fn() stack — calling it bare here builds nodes with nowhere to
  // assign to and the clouds silently drop out of the haze.
  return fog(Fn(() => skyColor(normalize(toFrag), shading))(), tau.negate().exp().oneMinus());
}
