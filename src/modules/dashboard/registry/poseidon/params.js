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
  // Patch size (meters) per cascade. Each cascade's band runs from
  // L[i+1]/boundaryFactor to L[i]/boundaryFactor in wavelength, so
  // boundaryFactor is literally "how many times the longest wave in a cascade
  // repeats across its own tile" — at 4 that repeat was readable as a texture,
  // which is what made the mid-scale chop look stamped-on.
  //
  // Cascade 0 carries every wave a viewer reads as "a wave", and its patch size
  // is what decides whether that reads as a sea or as corduroy. The field is a
  // sum of discrete modes on a deltaK = 2*pi/L lattice, so a train of wavelength
  // lambda lives on the ring at radial index L/lambda, and Donelan-Banner then
  // keeps only the arc of it inside the spreading lobe. Counting that honestly
  // is the whole argument: at L = 640 m the 172 m swell sat on radial index 3.7,
  // a ring of 23 lattice points, of which a 40-degree lobe keeps FOUR. Four
  // sinusoids is not a wave train, it is a diffraction grating, and it is
  // exactly why the dominant swell came out as endless parallel corduroy with no
  // beginning or end to any crest. At 1024 m the same train sits on index 6
  // spanning rings 4-9, which is around 27 modes — enough for the amplitude
  // envelope to vary along a crest so crests become finite arcs that start,
  // build, break and stop. The wind sea at 55 m sits on index 18 and is richly
  // resolved either way. The tile also stops repeating inside the aerial and
  // vista framings, which 640 m did not.
  //
  // Texel size is the cost, and it sets the other two entries. 1024/256 = 4 m,
  // so the hand-off to cascade 1 has to move from 16 m to 24 m to keep six
  // texels on the shortest wave cascade 0 carries. Five was enough to
  // reconstruct the height but not the *derivative*: the derivative of a
  // bilinear fetch is piecewise constant, so a near-Nyquist wave in cascade 0
  // prints its own texel grid into the normal as a diamond pattern on the crest
  // faces. A 24 m hand-off means cascade 1 must be 144 m (24 = L1/6), whose own
  // texels are 0.56 m, so its 4 m floor is seven texels — and that floor in turn
  // sets cascade 2 at 24 m. The hand-off also has to sit *below* the choppiness
  // knee (see chopFalloff): a wave being sculpted hard is a wave whose
  // derivative you cannot afford to resolve badly.
  //
  // The last patch is 24 m rather than 6 so cascade 2 spends its 256 texels on
  // the 0.4-4 m ripple you can actually see, instead of on 6 cm modes that no
  // pixel ever resolves and shortWavesFade deletes anyway — and 24 m of tile is
  // enough that the near-field ripple does not visibly repeat under the deck
  // camera the way a 16 m tile did.
  lengthScales: [1024, 144, 24],
  boundaryFactor: 6, // wavenumber hand-off between cascades (2*pi/L_next * factor)

  // --- physics ---
  g: 9.81,
  depth: 500, // water depth (meters); large = deep-water dispersion
  lambda: 2.2, // choppiness (horizontal displacement scale)
  // Choppiness is wavenumber-weighted (see spectrum.js): full strength on the
  // swell, rolled off on the chop. Without this, lambda high enough to sculpt a
  // peaked swell crest folds the ripples into pinched noise first — so lambda
  // had to stay near 1.7 and the swell never got its overhanging lip. With it,
  // a 55 m crest runs at an effective 2.15 while a 10 m ripple runs at 0.51, so
  // the sculpting lands on the waves you can see and the chop stays smooth.
  //
  // The right way to set this number is not by eye on the bare value — it is by
  // the RMS of lambda*chop(k)*k*a summed over the mode lattice, which is the
  // term that drives the Jacobian negative and therefore sets how much of the
  // sea maps.js paints white. At this tuning it comes to 0.374 / 0.109 / 0.066
  // across the three cascades: the folding happens on the 40-170 m crests that
  // are meant to break rather than being smeared over the 4-24 m chop, which is
  // why the whitecaps sit on crest lines with clean water between them instead
  // of covering the field.
  //
  // 2.2 is also an upper bound, and it was found by overshooting it. At 2.55 the
  // sculpting stops being a crest and becomes a fold: the telephoto framing
  // shows the dominant wave pinched into a symmetrical pyramid with a sharp
  // ridge, because the displacement has pulled enough surface into the crest
  // that the Jacobian goes through zero on the *whole* peak rather than at a
  // lip. Below about 1.8 the crests round off into shoulders again.
  //
  // The weighting is quartic in k (spectrum.js), so this knee is a band edge
  // rather than a slope. At the old 0.20 it sat at 31 m, which sounds like it
  // covers the visible band and does not: the waves you actually read from deck
  // height are 20-60 m, and the quartic had already taken the 20 m wave down to
  // 0.28 — near the floor — so the entire mid-band ran unsculpted and came out
  // as rounded shoulders under a sculpted swell. 0.28 rad/m puts the knee at
  // 22 m: 170 m keeps 1.00 of lambda and 55 m keeps 0.98, 40 m keeps 0.93, 25 m
  // keeps 0.69, 12 m drops to 0.27 and 6 m is at the floor. So every wave whose
  // crest shape a viewer can resolve gets the peaked profile, and the ripple
  // that folds into pinched noise (and paints maps.js white) still does not.
  //
  // The floor stays low for that last reason. Raising it sculpts the 2-8 m chop
  // too, and the fold budget those waves generate is spent as an even speckle of
  // whitecap over the whole field rather than as caps on crests.
  chopFalloff: 0.28, // rad/m — quartic knee, ~22 m waves
  chopFloor: 0.20, // residual choppiness left on the short chop

  // Fore-aft crest asymmetry: the fraction of the horizontal displacement moved
  // from the classic quarter-period-out-of-phase term into an in-phase one, so
  // the sharp part of the crest sits *ahead* of the height peak instead of on
  // it. See spectrum.js for the derivation and the reality constraint that makes
  // it a projection onto the wind direction rather than a constant.
  //
  // This is the number that turns a convex mound into a wave, and the A/B is
  // unambiguous: at 0 the whole field is smooth symmetric ridges with barely a
  // break on them, and no amount of extra lambda fixes that — it only makes a
  // symmetric spike. At 0.62 the compression point sits 32 degrees of phase
  // ahead of the crest, which on a 55 m wave is 4.9 m of forward overhang; the
  // back face lengthens into the long shallow ramp a swell actually has, and
  // the fold lands on the lip, which is where a whitecap belongs.
  //
  // 0.8 was tried and is past the line: the crest tips far enough that the fold
  // covers the entire front face and the wave comes back with a white blanket
  // down it rather than a cap on it. Every 0.1 here buys about 5 degrees of
  // phase and costs fold budget, so it is not a free sharpness knob.
  chopLean: 0.62,

  // --- local wind sea spectrum ---
  // Wind speed is a sea-state choice, not a physics constant, and 16 m/s was the
  // wrong one. 16 m/s over 90 km of fetch is a Beaufort 7 near-gale: the linear
  // theory puts the RMS slope of that sea at 0.26, which means a large fraction
  // of the surface is at or past the fold threshold every single frame. That is
  // the root cause of the whitecap snowfield in the aerial framing — the foam
  // constants were being asked to hide a sea state that genuinely breaks
  // everywhere. It is also simply not the reference: Sea of Thieves' signature
  // open ocean is a fair-weather one, long rollers with caps on a few crests and
  // clean water in between.
  //
  // 10.5 m/s is a Beaufort 5. It drops this train's variance to 45% of what it
  // was and — because the JONSWAP peak follows the wind — shortens its dominant
  // from 72 m to 55 m, which is the more useful half of the change: against the
  // fixed 172 m swell that is a separation factor of 3.1 rather than 2.4, and
  // 3.1 is where two trains stop reinforcing into one broad hump and start
  // reading as a swell with a wind sea on it. Measured over the mode lattice,
  // the 100-200 m band goes from 41% of the height variance to 54% while the
  // 50-100 m band drops from 37% to 21% — that gap *is* the readable dominant
  // wave. Fetch stays at 90 km; it is the wind that should carry the sea state,
  // because fetch is a property of the coastline, not of the weather.
  //
  // `scale` is the other half, and rendering the two trains in isolation is what
  // settled it. The swell alone gives big rolling forms with countable crest
  // lines and broad dark troughs. The wind sea alone, at the weight it used to
  // carry, is a field of near-identical 55-72 m lumps from foreground to
  // horizon — exactly the "snow-covered mountain range" the critics describe.
  // The two trains were never competing for height; they were competing for the
  // 40-80 m band, and that band is what the eye reads as "an individual wave"
  // from a low camera. Whichever train owns it owns the silhouette.
  //
  // So the wind sea is cut to 18% of the variance and demoted to what it is
  // physically: a secondary train that puts a readable 40-80 m wave inside a
  // deck-height frame (where the 172 m swell subtends barely a degree and only
  // heaves you), and a tail of chop that gives the swell's flanks texture.
  // Measured over the mode lattice that lands at RMS slope 0.081 in the
  // 100-200 m band, 0.106 in 50-100 and 0.114 in 25-50 — a plateau, not a
  // spike. A spike anywhere in that range is the mat; the swell's height
  // majority on top of a flat mid-band slope is a sea. Below about 0.4 the
  // deck framing loses its mid-scale wave entirely and the sea reads as one
  // slow heave under a fine ripple; above about 0.7 the 55 m train starts
  // winning the silhouette back and the lumps return.
  local: {
    scale: 0.48,
    windSpeed: 10.5, // m/s
    windDirection: 45, // degrees
    fetch: 90000, // meters
    // The wind sea is the train that should be BROAD. It was not: spreadBlend 1
    // with swell 0.85 gave it a Donelan-Banner exponent of ~18 at the peak,
    // i.e. a 44-degree lobe, and a 44-degree wind sea crossing a 44-degree
    // swell at 17 degrees is one train, not two. 0.48/0.82 opens the wind sea to
    // roughly a 70-degree lobe over a real isotropic floor, so its crests are
    // finite arcs that start and stop instead of running to the horizon. The
    // swell keeps its own concentration high — narrow swell under a broad wind
    // sea is the right combination, and it is what breaks corduroy into a sea.
    spreadBlend: 0.78, // 0 = isotropic-ish, 1 = fully directional
    swell: 0.42, // 0-1 — directional concentration (high = long parallel crests)
    peakEnhancement: 5.0, // JONSWAP gamma
    // Knee near 0.65 m, which is roughly the radial grid's finest vertex spacing
    // doubled: below that the displacement cannot be carried by the mesh at all,
    // it only aliases, while the derivative map still feeds the normal.
    shortWavesFade: 0.07,
    // 1.7/0.45 bought the dominant scale by deleting the chop outright: measured
    // over the actual mode lattice it left the short cascade with 0.07 m of RMS
    // height against the swell band's 1.33 m, and total RMS slope at 0.11 where
    // an unmodified JONSWAP at this wind gives 0.19. That is not chop riding on
    // a swell, it is a swell with nothing on it, and it is why broad wave faces
    // read as moulded plastic. The dominant scale is now bought by *weight* —
    // this train is down to 14% of the variance — rather than by killing its
    // tail, so the roll-off only has to keep the sub-metre ripple from going to
    // chrome. 0.95 against a floor of 0.45 leaves the 4-24 m band with RMS slope
    // 0.147 and the sub-4 m band with 0.150, which is the texture that stops a
    // near-field trough reading as a sheet of green marble.
    tailFalloff: 0.95, // extra omega roll-off above the peak — see spectrum.js
    tailFloor: 0.45, // ...which stops ~2 octaves down, so the ripple survives
  },

  // --- swell spectrum (longer, more directional, slower) ---
  // THIS is the ocean. The train crossing at 32 deg used to be a garnish on a
  // wind sea; it now carries 82% of the height variance and every wave the
  // viewer reads as a wave. Fixed wind/fetch on purpose — swell comes from a
  // distant storm, so it should NOT track the local sea state. Its short-wave
  // fade is hard and its tail floor is low, so it contributes the big rolling
  // form and a smooth 25-100 m shoulder, and nothing below that.
  //
  // 172 m is chosen against the camera, not against the other train. At the
  // deck preset's 3.2 m eye that is roughly three crests between the lens and
  // the 400 m mark, each filling enough of the frame to occlude the horizon as
  // it passes — which is what "you can read an individual wave" means from sea
  // level. It is also long enough that the crest arcs survive the aerial
  // framing at 90 m instead of collapsing into grain. Pushed much past 220 m it
  // stops being a wave from deck height and just heaves mean sea level, eating
  // value range in the shading ramp and dunking the camera; below about 120 m
  // it starts competing with its own chop again.
  //
  // Weight. `scale` multiplies a spectral *density*, and JONSWAP variance goes
  // as alpha*g^2/omega_peak^4, so a long train converts scale into height far
  // more efficiently than a short one — 0.36 here against 0.48 on the wind sea
  // is not a split against the swell, it is 4.4:1 in its favour. (The old 0.12/0.68
  // pairing was likewise never the 6:1 *against* it that it reads as; it was
  // 0.37:1. Neither number in this pair means anything without the peak
  // wavelength beside it, which is why both are written down above.)
  //
  // gamma and the spreading are loosened from the 7.0/1.0 they were at, and for
  // one reason: crest LENGTH. A very peaked, very narrow train is a handful of
  // near-identical sinusoids, and a handful of near-identical sinusoids is
  // corduroy that runs unbroken from one edge of frame to the other. 4.5 widens
  // the peak enough that the modes under it beat into groups — sets of two or
  // three crests with a calm behind them — and 0.88/0.97 leaves a little
  // angular spread and a thin isotropic floor, which is what makes a crest an
  // arc that starts, builds and stops rather than a rail.
  swell: {
    scale: 0.36,
    // Exponent on (local.windSpeed / 10.5) applied to this train's variance —
    // spectrum.js reads it. NOT a wavelength coupling: the swell stays 172 m at
    // every sea state, because a distant storm does not care what the local wind
    // is doing. Only the amplitude follows, and only at 0.7 against the wind
    // sea's own ~1.8, so a light-air day is almost pure swell (long, smooth,
    // barely a break on it) while a gale piles a real wind sea on top of it,
    // which is how the two look in life. At 0 the swell is fixed and "calm"
    // comes out as the same ocean with less texture.
    windCoupling: 0.7,
    windSpeed: 14.0,
    windDirection: 13,
    fetch: 380000,
    spreadBlend: 0.97,
    swell: 0.88,
    peakEnhancement: 4.5,
    shortWavesFade: 2.5,
    tailFalloff: 1.7,
    tailFloor: 0.15,
  },

  // --- sky ---
  // Which baked panorama lights the scene. 'midday' is the reference
  // photograph's lighting — a Beaufort-7 sea under a high white sun is a
  // DIFFERENT IMAGE from the same sea at golden hour, and every foam
  // calibration chased a lighting confound until this existed. 'golden' is the
  // original sunset panorama. Each entry carries the values tools/skylight.mjs
  // measures off its own image; applySky() below merges the active one into
  // the flat fields the rest of the app reads.
  sky: 'midday',

  // --- animation / view ---
  timeScale: 1.0,
  amplitude: 1.0, // (step-1 sine-ocean view only)
  patchSize: 1000, // (step-1 sine-ocean view only)
  // Must match the sun baked into the sky cube map, or the specular path lands
  // somewhere the eye can see is wrong. Measured, not chosen — see SKY_SUN in
  // sky.js and re-run tools/skylight.mjs if the sky is swapped.
  sunAzimuth: 122.8,
  sunElevation: 11.2,
  // Radiance multiplier on colors.sun. An 8-bit panorama clips its solar disc,
  // so the true sun/sky ratio is NOT recoverable from it (skylight.mjs reports
  // 3.13, which is a floor rather than the answer) — set by eye against the
  // render. A sun this low is dim next to noon but still well above sky ambient.
  // 1.15, not the 2.6 this started at. sunColor is multiplied into the SSS glow
  // and the single-scatter term as well as the specular lobe, and every gain in
  // oceanSurfaceMaterial.js was tuned against a sun of magnitude ~1 — so a 2.6x
  // "intensity" silently rescaled the whole water body, not just the glitter.
  // Golden hour is DIMMER than noon anyway; the warmth belongs in the hue.
  sunIntensity: 1.15,

  // --- shading (step 5) ---
  sssStrength: 1.0,
  // sun / skyHorizon / skyZenith / ambient are MEASURED off the sky panorama by
  // `node tools/skylight.mjs public/sky/sky_131_2k.png`. Hand-picking these
  // against a baked sky is how the lighting and the background end up
  // disagreeing with each other.
  colors: {
    deep: 0x071a26, // deep water body
    scatter: 0x2e8f8f, // subsurface / crest scatter (teal)
    // The sky along the sun's own azimuth in the first 5 degrees of elevation —
    // sunlight through the most air mass, and the only honest read on the direct
    // light's colour when the disc is clipped. The glow ring immediately around
    // the disc measures 0xfff7d6, which is the painted highlight, not the light:
    // a near-white sun over a golden-hour sky is the most obvious tell there is.
    sun: 0xffd395,
    skyHorizon: 0xc29f83, // solid-angle mean of the first 3 degrees above the line
    skyZenith: 0x938797, // ...and of the top 20
    foam: 0xdce7ea, // whitecaps
    // Cosine-weighted irradiance of the upper hemisphere: the sky fill term.
    // Lives INSIDE colors because main.js reads it as params.colors.ambient. It
    // sat one level up for a while, and the failure was silent and expensive:
    // new Color(undefined) is WHITE, so every consumer got a flat white sky fill
    // instead of this mauve-grey, and the spray came out blue-violet under a
    // golden sun while its own comments described a colour it never received.
    ambient: 0xa3939b,
  },

  // Which sea the body swatches paint: 0 = the tropical green this project was
  // originally aimed at, 1 = the open-ocean blue measured off the reference
  // photograph. Not a slider between two grades — two different bodies of
  // water, and it is a lerp only so that the switch is one uniform rather than
  // a material rebuild. See SEA in oceanSurfaceMaterial.js.
  palette: 1,

  // --- foam (step 6) ---
  // lambda_min accumulator value below which foam draws. CALIBRATED, not picked:
  // Monahan & O'Muircheartaigh 1980 gives whitecap coverage W = 3.84e-6*U10^3.41
  // — about 1% of the sea at this 10.5 m/s wind, 4% at 15, 10% at 20, zero
  // below ~4 m/s. Measured foam area against that: 0.7% at 0.30, 1.6% at 0.33.
  // lambda_min fires more readily than the old det J, so this sits well below
  // the 0.4 that criterion wanted.
  foamThreshold: 0.32,
  foamScale: 2.5, // foam coverage falloff
  // e-folding decay TIME of foam in SECONDS, per the measured whitecap law
  // A(t) = A0*exp(-t/tau); tau ~ 3.85 s in seawater. Bigger = longer wake.
  // Scaled per cascade by sqrt(L/144) in maps.js. Was a per-frame rate.
  foamDecay: 3.9,
  // Spatial dissipation of that same accumulator, in 1/s: the per-second weight
  // with which each texel blends toward a 4-tap tent of its own neighbourhood
  // in maps.js. Every shipped foam sim dissipates in space as well as in time
  // (War Thunder, ATLAS, Sea of Thieves), and without it patches fade in place
  // with hard edges. 1.32 is "one kernel footprint of softening per e-folding
  // time" — sigma reaches 2.7 / 2.0 / 2.2 texels across the three cascades over
  // one tau, advective numerical diffusion included. 0 turns spatial
  // dissipation off, which is the check that it is reaching the image at all.
  foamSpread: 1.32,
  // Brightness of the top rung of the foam tonal ladder (albedo x irradiance,
  // pre-exposure, before the peak normalisation). Foam is NOT one flat white:
  // fresh multilayer caps reflect ~0.50 of the visible (Whitlock, Bartlett &
  // Gurganus 1982; Dierssen 2019) and Koepke 1984 followed individual whitecaps
  // down to 0.03-0.10 within ~10 s, so oceanSurfaceMaterial.js runs a two-axis
  // tone (age x within-raft thickness) and this is its LEVEL.
  //
  // MEASURED, and it is the number that decides whether the ladder is a
  // redistribution or a dimming. 0.88 lands the calibrated bright-pixel count
  // at 53758 against the pre-change 53911 (-0.3%), i.e. the foam is spread
  // across the ladder without the population moving. Raising it lifts the whole
  // ladder further past Khronos PBR Neutral's knee, where rungs are DESTROYED
  // rather than compressed (1.0 -> 0.911, 1.5 -> 0.954 post-exposure); lowering
  // it drops solid caps out of the calibrated population entirely — at 0.80 the
  // count fell to 45263, nearly all of it foam.
  foamBright: 0.88,
  // Micro-relief on the foam: rms modulation of foam brightness by the gradient
  // of the baked cellular channels, projected on the sun. Fixes the "foam is a
  // flat decal" read (Crest issue #21; War Thunder's 2026 Ninth Wave
  // micro-relief overlay) for free — the gradient comes off taps the capillary
  // ripple already fetches. 0 is off, and it measures as off: 0.11 delivered a
  // maximum of 10/255 on near-field foam, because only the HORIZONTAL part of
  // the sun direction projects onto a horizontal slope and this scene's default
  // sun is 51.5 degrees up, so cos(51.5) = 0.62 of the nominal figure survives.
  // 0.18 restores the designed ~11% rms at that elevation. The delivered amount
  // still scales with cos(elevation), which is physically right — relief
  // shading is strongest under grazing light — so the golden preset's 11.2
  // degree sun gets 1.6x this scene's.
  foamRelief: 0.18,
  // Opacity ceiling of the submerged bubble plume that milks the water under
  // and beyond a cap (Crest's transmissive bubble layer, War Thunder's
  // energy-modulated milkiness, Uncharted's foam-reduces-apparent-depth cue).
  // A whitecap's plume is about one optical depth at its own scale, so 1 - 1/e
  // = 0.63 is the physical ceiling; 0.45 ships because at 0.63 a lace hole
  // loses half its contrast against the raft. 0 turns the plume off.
  foamMilk: 0.45,

  // --- detail ---
  detailStrength: 0.1, // sub-grid normal-noise amount (breaks up uniformity)
};

// The two lighting rigs, each measured off its own panorama by
// tools/skylight.mjs (midday is generated by tools/makesky.mjs). knee/boost
// are the HDR reconstruction constants in sky.js: the golden panorama's solar
// glow is broad painted art needing a low knee; the midday disc is tight, so
// its knee sits above everything but the disc itself.
export const SKIES = {
  golden: {
    file: '/sky/sky_131_2k.png',
    knee: 0.88, boost: 11.0,
    // aerial perspective, metres to 1/e: the sunset panorama is a hazy sky
    hazeWater: 3200, hazeAir: 2150,
    specBoost: 0.0, // the glint term is always in the graph now; golden never had one
    sunAzimuth: 122.8, sunElevation: 11.2, sunIntensity: 1.15,
    colors: { sun: 0xffd395, skyHorizon: 0xc29f83, skyZenith: 0x938797, ambient: 0xa3939b },
  },
  midday: {
    file: '/sky/sky_midday_2k.png',
    knee: 0.965, boost: 9.0,
    // clear midday air: a third of the sunset extinction, or the midfield
    // lifts toward the pale sky and the reference's dark 2 km band is lost
    hazeWater: 9000, hazeAir: 6500,
    specBoost: 12.0, // see the glint note in oceanSurfaceMaterial.js
    sunAzimuth: 122.6, sunElevation: 51.5,
    // sunToAmbient measured 4.07 against the golden panorama's 3.13 — but the
    // water's additive gains (scatter, SSS, glitter) were all tuned against a
    // sun of magnitude ~1.15, and 1.9 washed the whole sea powder-blue.
    // 1.45 keeps the midday contrast without rescaling the water body.
    sunIntensity: 1.45,
    // sun hue: near-white with the faint warmth of a real 5800 K disc — the
    // measured clipped core, not the blue the glow ring averages to.
    colors: { sun: 0xfffbf2, skyHorizon: 0xc2d5eb, skyZenith: 0x356ace, ambient: 0x5d86d5 },
  },
};
// Merge the active sky's rig into the flat fields everything reads. Called at
// module load and again by main.js after shot overrides, so `?p={"sky":...}`
// switches the whole rig.
export function applySky(p) {
  if (!SKIES[p.sky]) p.sky = 'midday'; // normalise once; downstream reads never mix rigs
  const s = SKIES[p.sky];
  p.sunAzimuth = s.sunAzimuth;
  p.sunElevation = s.sunElevation;
  p.sunIntensity = s.sunIntensity;
  Object.assign(p.colors, s.colors);
}
applySky(params);
