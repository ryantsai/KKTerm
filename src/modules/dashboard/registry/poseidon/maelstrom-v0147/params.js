// Single source of truth for tunable parameters. The lil-gui panel (step 6)
// binds to this object; the compute passes and render loop read from it.
//
// The spectrum model follows gasgiant/FFT-Ocean (MIT), which implements
// Horvath 2015, "Empirical Directional Wave Spectra for Computer Graphics":
// JONSWAP amplitude (from fetch + wind speed) x TMA depth correction x
// Donelan-Banner directional spreading x short-wave fade, summed over a local
// wind-sea spectrum and a swell spectrum.

export const params = {
  // --- simulation grid ---
  N: 256, // FFT resolution (power of two; 512 supported)
  cascades: 3, // number of wave cascades (1-3)
  lengthScales: [250, 17, 5], // patch size (meters) of each cascade
  boundaryFactor: 6, // wavenumber hand-off between cascades (2*pi/L_next * factor)

  // --- physics ---
  g: 9.81,
  depth: 500, // water depth (meters); large = deep-water dispersion
  lambda: 1.3, // choppiness (horizontal displacement scale)

  // --- local wind sea spectrum ---
  local: {
    scale: 1.0,
    windSpeed: 16.0, // m/s
    windDirection: 45, // degrees
    fetch: 100000, // meters
    spreadBlend: 1.0, // 0 = isotropic-ish, 1 = fully directional
    swell: 0.2, // 0-1
    peakEnhancement: 3.3, // JONSWAP gamma
    shortWavesFade: 0.02, // suppression of small wavelengths
  },

  // --- swell spectrum (longer, more directional, slower) ---
  swell: {
    scale: 0.8,
    windSpeed: 2.0,
    windDirection: 70,
    fetch: 300000,
    spreadBlend: 1.0,
    swell: 1.0,
    peakEnhancement: 3.3,
    shortWavesFade: 0.01,
  },

  // --- animation / view ---
  timeScale: 1.0,
  amplitude: 1.0, // (step-1 sine-ocean view only)
  patchSize: 1000, // (step-1 sine-ocean view only)
  sunAzimuth: 135,
  sunElevation: 28,

  // --- shading (step 5) ---
  sssStrength: 1.0,
  colors: {
    deep: 0x071a26, // deep water body
    scatter: 0x2e8f8f, // subsurface / crest scatter (teal)
    sun: 0xfff1dc, // sun disc + specular
    skyHorizon: 0x9fb8cc,
    skyZenith: 0x2a5b9c,
    foam: 0xdce7ea, // whitecaps
  },

  // --- foam (step 6) ---
  foamThreshold: 0.4, // accumulated-Jacobian value below which foam appears (lower = only real breaks)
  foamScale: 2.5, // foam coverage falloff
  foamDecay: 0.4, // foam recovery rate (lower = foam lingers/dissipates longer)

  // --- detail ---
  detailStrength: 0.1, // sub-grid normal-noise amount (breaks up uniformity)
};
