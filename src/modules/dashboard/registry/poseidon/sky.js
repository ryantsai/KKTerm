import {
  Mesh, SphereGeometry, MeshBasicNodeMaterial, BackSide, TextureLoader, SRGBColorSpace,
  RepeatWrapping, ClampToEdgeWrapping, LinearFilter,
} from 'three/webgpu';
import {
  Fn, positionWorld, cameraPosition, normalize, texture, equirectUV, vec3, float,
  max, pow, saturate, mix, smoothstep, dot,
} from 'three/tsl';
import { SKIES } from './params.js';

// The sky is a baked panorama (public/sky/), replacing the procedural gradient
// and fBm cloud decks entirely.
//
// skyColor() is called from three places and has to hold up in all of them:
//   - the sky dome (dir = camera-relative view ray)
//   - the ocean's Fresnel reflection (dir = reflected ray, y clamped just above
//     0, so it lands in the compressed near-horizon band and the wave slopes
//     smear cloud structure across the water)
//   - scene.fogNode in atmosphere.js (dir = camera -> fragment, so mostly
//     *below* the horizon; everything under y=0 has to resolve to the same haze
//     value the sky just above the line has, or the far water separates from
//     the sky instead of dissolving into it)

// The equirect panorama, not the cube faces shipped beside it. The cube would
// avoid the wrap seam for free, but this pack's faces are not in three's axis
// convention — aiming the camera straight down the measured sun vector does not
// find the sun in them — and guessing a rotation is worse than not needing one.
// The equirect convention IS verified: equirectUV is three's own, the sun
// position below was measured through that same convention, and the sky's sun
// lands exactly at the far end of the water's glitter path.
//
// Mipmaps are off deliberately. With them on, the u wrap prints a vertical seam
// down the frame: the UV derivative spikes from ~0 to 1 across the wrap column,
// the hardware reads that as an enormous footprint and drops to the coarsest
// mip, leaving a blurred stripe in the sky. Off, the seam is gone. The cost is
// minification aliasing, which this sky can afford — it is low-frequency
// painted art, and the ocean's reflection ray already relaxes toward flat with
// roughness before it gets here.
// KKTerm may render several ocean backgrounds at once. Give every scene its
// own texture instead of sharing Poseidon's page-global live sky switch.
export function loadSkyTexture(name) {
  const def = SKIES[name] ?? SKIES.midday;
  const skyTex = new TextureLoader().load(def.file);
  skyTex.colorSpace = SRGBColorSpace; // decoded to linear; grading happens at the tonemapper
  skyTex.wrapS = RepeatWrapping; // longitude wraps
  skyTex.wrapT = ClampToEdgeWrapping; // latitude must not
  skyTex.magFilter = LinearFilter;
  skyTex.minFilter = LinearFilter;
  skyTex.generateMipmaps = false;
  return skyTex;
}

// Each panorama's sun position/colours are measured by tools/skylight.mjs and
// live in the SKIES table (params.js) — re-measure if a texture is swapped.

// Below the horizon the panorama is a flat gradient with no haze band, and the
// fog path asks for exactly those directions. Fold the lower hemisphere onto the
// first couple of degrees above the line, so distant water dissolves into the
// sky it actually meets and the value stays continuous across y = 0.
const FOLD = 0.03;

// An 8-bit panorama peaks at 253, so its sun carries no more energy than a white
// cloud and every reflection of it comes back flat. Expand the top of the range
// back into HDR so the water gets a specular path with punch and ACES has
// something to roll off. Reconstruction, not a look — the alternative is an .hdr
// source. The knee is deliberately high: this sky's solar glow is broad and
// painted, and a low knee expands half the cloud deck into a white plate.
//
// The recovered energy is TINTED, and that is the half this was missing. Eight
// bits do not just lose the sun's magnitude, they lose its COLOUR: the disc
// clips, and what clips first is the channel that was brightest, so the core
// measures 0xfdffe1 — near-white — while the same sun read where it is NOT
// clipped, along its own azimuth in the first few degrees of elevation, measures
// 0xffd395. Multiplying the clipped white by eleven therefore reconstructs
// eleven times the wrong colour, and since a specular reflection of the disc is
// most of the glitter path, the sea's brightest highlights came back at a
// measured ratio of 1.000 / 0.994 / 0.984 under a sun that is 1.000 / 0.827 /
// 0.584. The light source and the light disagreed.
//
// So the ADDED energy carries the sun's own hue while the base sample passes
// through untouched. The quartic on `over` does the gating for free: a cumulus
// top at 0.92 of range gets a 14% lift and is barely tinted, the solar core gets
// the full eleven and is tinted completely. The hue is read from the sunColor
// uniform rather than pinned here, so the GUI swatch moves the sun in the sky
// and the sunlight on the water together, and they cannot drift apart again.
// Correcting this alone was NOT enough, and the reason is worth recording
// because it is where two days of plausible-looking fixes went. Tinting the
// reconstruction moved the measured highlight ratio by about one per cent. So
// did lowering the glitter's white mix, and exempting the sun from the
// reflection's warm-desaturation, and pushing the reconstructed hue to a power.
// All four are correct at the source and all four were invisible, because the
// frame was tone mapped with ACES: a reconstructed disc lands eight to twelve
// times over its white point, and up there ACES returns all three channels
// within a couple of per cent of each other whatever colour went in. The light
// was already golden in linear space — the curve was painting it white on the
// way out. See the tone mapping note in main.js.
// Per-sky — see SKIES in params.js. Read at first use, alongside the texture.

// This panorama's zenith blue is saturated enough that the ACES input matrix
// drives its red channel negative, which clamps to 0 and prints a hard-edged
// region boundary across an otherwise smooth gradient — measured at 8.11% of the
// `away` frame before this. Pulling a few percent toward the colour's own
// luminance puts it back inside the gamut the tone curve can carry. The number
// is set by the probe, not by eye: raise it until tools/probe.mjs reports
// clipR 0.00 on every preset, and no further.
const DESAT = 0.22;
const LUMA = vec3(0.2126, 0.7152, 0.0722);

export function skyColor(dir, u) {
  const d = normalize(dir).toVar();
  // smoothstep rather than max(): a hard clamp prints a seam along the line,
  // where every below-horizon ray collapses onto the same texel row.
  const y = mix(float(FOLD), d.y.max(0), smoothstep(float(-FOLD), float(FOLD), d.y));
  const c = texture(u.skyTexture, equirectUV(normalize(vec3(d.x, y, d.z)))).rgb.toVar();
  c.assign(mix(c, vec3(dot(c, LUMA)), float(DESAT)));

  const peak = max(max(c.r, c.g), c.b);
  const over = saturate(peak.sub(u.skyKnee).div(float(1).sub(u.skyKnee)));
  // Normalised to a peak of 1 so this is purely a hue, and the magnitude stays
  // where BOOST puts it — sunIntensity must not double-count here.
  const sc = vec3(u.sunColor).toVar();
  const sunHue = sc.div(max(max(sc.r, sc.g), sc.b).max(float(1e-4))).toVar();
  return c.add(c.mul(pow(over, float(4)).mul(u.skyBoost)).mul(sunHue));
}

export function createSkyDome(u, radius = 12000) {
  const mat = new MeshBasicNodeMaterial();
  mat.side = BackSide;
  mat.fog = false;
  mat.colorNode = Fn(() => skyColor(normalize(positionWorld.sub(cameraPosition)), u))();
  return new Mesh(new SphereGeometry(radius, 48, 32), mat);
}
