// eslint-disable-next-line @typescript-eslint/ban-ts-comment -- vendored preserved-algorithm file; see fujiBackground.tsx for the same convention
// @ts-nocheck -- vendored verbatim from the submerged-snell-ocean reference skill (shared sun direction/color uniforms); preserved byte-for-byte, matching fujiBackground.tsx's convention for other preserved-algorithm files.
import { Color, Vector3 } from 'three'
import { uniform } from 'three/tsl'

/**
 * The one sun: fixed at a golden afternoon. Everything that lights, glints,
 * shafts, or shadows derives from these values — sky dome, ocean reflection,
 * caustics, god rays, shadow light.
 */
const SUN_ELEVATION = (42 * Math.PI) / 180
const SUN_AZIMUTH = (215 * Math.PI) / 180

/** Unit vector pointing from the scene toward the sun. */
export const sunDirection = new Vector3(
  Math.cos(SUN_ELEVATION) * Math.sin(SUN_AZIMUTH),
  Math.sin(SUN_ELEVATION),
  Math.cos(SUN_ELEVATION) * Math.cos(SUN_AZIMUTH),
).normalize()

export const sunColor = new Color(1.0, 0.925, 0.79)

/** DirectionalLight intensity (scene lighting, not the visible disc). */
export const SUN_LIGHT_INTENSITY = 3.4

/** Shared TSL uniforms — never create per-material copies of these. */
export const sunDirectionUniform = uniform(sunDirection)
export const sunColorUniform = uniform(sunColor)
