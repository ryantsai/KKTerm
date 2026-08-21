// eslint-disable-next-line @typescript-eslint/ban-ts-comment -- vendored preserved-algorithm file; see fujiBackground.tsx for the same convention
// @ts-nocheck -- vendored almost-verbatim from the submerged-snell-ocean reference
// gallery scene.js (createWaterlineTower / createSaucerSeabedGeometry and their
// noise/geometry helpers): real geometry-building code preserved close to its
// original JavaScript form, matching fujiBackground.tsx's convention for other
// preserved-algorithm files.
import * as THREE from "three/webgpu";

/**
 * The waterline tower prop and the saucer-shaped seabed terrain for the
 * submerged Snell's-window background, ported from the reference gallery's
 * submerged-snell-ocean/scene.js almost unchanged. See that file for the
 * authoritative version this was copied from.
 */

export const SEABED_Y = -26;
const SAUCER_EXTENT = 2800;
const SAUCER_SEGMENTS = 224;
const SAUCER_RISE_START = 680;
const SAUCER_RISE_END = 1150;
export const TOWER_Z = -34;

function hash2(x: number, y: number, seed: number) {
  let value =
    Math.imul(x | 0, 374761393) +
    Math.imul(y | 0, 668265263) +
    Math.imul(seed | 0, 2246822519);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

function smoothCurve(value: number) {
  return value * value * (3 - 2 * value);
}

function valueNoise2(x: number, y: number, seed = 0) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  const u = smoothCurve(xf);
  const v = smoothCurve(yf);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm2(x: number, y: number, octaves = 5, seed = 0) {
  let value = 0;
  let amplitude = 0.5;
  let fx = x;
  let fy = y;
  for (let index = 0; index < octaves; index += 1) {
    value += valueNoise2(fx, fy, seed + index * 101) * amplitude;
    const rotatedX = fx * 0.8 - fy * 0.6;
    const rotatedY = fx * 0.6 + fy * 0.8;
    fx = rotatedX * 2.03;
    fy = rotatedY * 2.03;
    amplitude *= 0.5;
  }
  return value;
}

function smoothstepNumber(edge0: number, edge1: number, value: number) {
  const t = THREE.MathUtils.clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * The far rim: terrain fills the water column geometrically, which is what
 * closes the seabed/ocean horizon gap. A view-aligned scattering slab cannot
 * do it — see the note in the medium.
 */
function saucerHeight(x: number, z: number) {
  const blend = smoothstepNumber(
    SAUCER_RISE_START,
    SAUCER_RISE_END,
    Math.hypot(x, z),
  );
  const rimTop = -3.6 + (fbm2(x * 0.006, z * 0.006, 3, 131) - 0.5) * 2.2;
  return THREE.MathUtils.lerp(SEABED_Y, rimTop, blend);
}

export function createSaucerSeabedGeometry() {
  const geometry = new THREE.PlaneGeometry(
    SAUCER_EXTENT,
    SAUCER_EXTENT,
    SAUCER_SEGMENTS,
    SAUCER_SEGMENTS,
  );
  geometry.rotateX(-Math.PI / 2);
  const positions = geometry.getAttribute("position");
  for (let index = 0; index < positions.count; index += 1) {
    positions.setY(
      index,
      saucerHeight(positions.getX(index), positions.getZ(index)),
    );
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function createMaterial(color: number, roughness: number, metalness: number, medium: unknown = null) {
  const material = new THREE.MeshStandardNodeMaterial();
  material.color.set(color);
  material.roughness = roughness;
  material.metalness = metalness;
  if (medium) (medium as { applyCaustics: (material: unknown, strength: number) => void }).applyCaustics(material, 1.2);
  return material;
}

function createStrut(material: THREE.MeshStandardNodeMaterial, start: THREE.Vector3, end: THREE.Vector3, radius: number, radialSegments = 12) {
  const direction = new THREE.Vector3().subVectors(end, start);
  const length = direction.length();
  const geometry = new THREE.CylinderGeometry(
    radius,
    radius,
    length,
    radialSegments,
  );
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(start).add(end).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    direction.normalize(),
  );
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * A deliberately simplified structure that crosses the waterline: seabed-rooted
 * piles with underwater bracing, a deck, and an above-water headframe. Its
 * air-side geometry is what the Snell window has to transport.
 */
export function createWaterlineTower(medium: unknown) {
  const group = new THREE.Group();
  const underwaterBronze = createMaterial(0x376f70, 0.54, 0.72, medium);
  const bronze = createMaterial(0x7b5b2d, 0.36, 0.82);
  const iron = createMaterial(0x283640, 0.48, 0.72);
  const timber = createMaterial(0x6e4a2a, 0.78, 0.04);
  const canvas = createMaterial(0x86b0aa, 0.9, 0);
  canvas.side = THREE.DoubleSide;
  const materials = [underwaterBronze, bronze, iron, timber, canvas];
  const airSide: THREE.Mesh[] = [];

  const pileRadius = 5.5;
  const pileCount = 6;
  const pilePoints: THREE.Vector3[] = [];
  for (let index = 0; index < pileCount; index += 1) {
    const angle = (index / pileCount) * Math.PI * 2 + Math.PI / 6;
    const x = Math.sin(angle) * pileRadius;
    const z = Math.cos(angle) * pileRadius;
    pilePoints.push(new THREE.Vector3(x, 0, z));

    const underwaterHeight = -SEABED_Y;
    const underwaterPile = new THREE.Mesh(
      new THREE.CylinderGeometry(0.3, 0.42, underwaterHeight, 18),
      underwaterBronze,
    );
    underwaterPile.position.set(x, SEABED_Y + underwaterHeight * 0.5, z);
    underwaterPile.castShadow = true;
    underwaterPile.receiveShadow = true;
    group.add(underwaterPile);

    const upperPile = new THREE.Mesh(
      new THREE.CylinderGeometry(0.28, 0.3, 2.45, 18),
      bronze,
    );
    upperPile.position.set(x, 1.225, z);
    upperPile.castShadow = true;
    upperPile.receiveShadow = true;
    group.add(upperPile);
    airSide.push(upperPile);
  }

  for (let index = 0; index < pileCount; index += 1) {
    const next = (index + 1) % pileCount;
    const a = pilePoints[index];
    const b = pilePoints[next];
    for (const [top, bottom] of [[-2, -14], [-14, -25]]) {
      group.add(
        createStrut(
          underwaterBronze,
          new THREE.Vector3(a.x, top, a.z),
          new THREE.Vector3(b.x, bottom, b.z),
          0.075,
        ),
      );
      group.add(
        createStrut(
          underwaterBronze,
          new THREE.Vector3(b.x, top, b.z),
          new THREE.Vector3(a.x, bottom, a.z),
          0.075,
        ),
      );
    }
  }

  const deck = new THREE.Mesh(
    new THREE.CylinderGeometry(6.5, 6.5, 0.48, 72),
    timber,
  );
  deck.position.y = 2.62;
  deck.castShadow = true;
  deck.receiveShadow = true;
  group.add(deck);
  airSide.push(deck);

  const deckTrim = new THREE.Mesh(
    new THREE.TorusGeometry(6.52, 0.1, 10, 72),
    bronze,
  );
  deckTrim.rotation.x = Math.PI / 2;
  deckTrim.position.y = 2.82;
  group.add(deckTrim);
  airSide.push(deckTrim);

  const legAngles = [Math.PI / 4, 3 * Math.PI / 4, 5 * Math.PI / 4, 7 * Math.PI / 4];
  for (const angle of legAngles) {
    const leg = createStrut(
      iron,
      new THREE.Vector3(Math.sin(angle) * 3.6, 2.85, Math.cos(angle) * 3.6),
      new THREE.Vector3(Math.sin(angle) * 0.65, 13.2, Math.cos(angle) * 0.65),
      0.15,
      16,
    );
    group.add(leg);
    airSide.push(leg);
  }

  const canopy = new THREE.Mesh(
    new THREE.CylinderGeometry(2.1, 6.15, 1.2, 72, 1, true),
    canvas,
  );
  canopy.position.y = 6.05;
  canopy.castShadow = true;
  group.add(canopy);
  airSide.push(canopy);

  const crown = new THREE.Mesh(
    new THREE.TorusGeometry(0.72, 0.1, 12, 40),
    bronze,
  );
  crown.rotation.x = Math.PI / 2;
  crown.position.y = 13.35;
  group.add(crown);
  airSide.push(crown);

  const beacon = new THREE.Mesh(
    new THREE.CylinderGeometry(0.38, 0.62, 2.6, 24),
    bronze,
  );
  beacon.position.y = 14.65;
  beacon.castShadow = true;
  group.add(beacon);
  airSide.push(beacon);

  return { group, materials, airSide };
}
