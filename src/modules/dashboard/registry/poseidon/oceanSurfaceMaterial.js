import { MeshBasicNodeMaterial, DoubleSide } from 'three/webgpu';
import {
  Fn, positionGeometry, positionWorld, cameraPosition, vec2, vec3, vec4, float,
  texture, normalize, reflect, refract, dot, max, min, pow, mix, saturate, abs, smoothstep,
  length, fwidth, sqrt, exp, log2, PI,
} from 'three/tsl';
import { skyColor } from './sky.js';
import { diffusionAttenuation } from './water.js';

// --- look constants, local to this file -----------------------------------
// params.js and the GUI belong to the integration pass; only the palette and
// the two strength knobs arrive as uniforms. Everything that shapes the water
// itself is tuned here so the whole model stays readable in one place.

// World-anchored km-scale amplitude envelope. An FFT sea is periodic by
// construction — cascade 0 repeats every 1024 m, the chop tile every 144 m —
// and from altitude the same neighbourhood marches across the frame. A
// compute texel IS every repeat of itself at once, so the variation has to
// live in world-anchored rendering: two octaves (2400 m and 770 m, both
// incommensurate with the tile periods) scale displacement, normals and foam
// per WORLD position. Mean 1, clamped to +/-40%. Wave groupiness at km scale
// is also simply true of real seas.
const ampEnvelope = (detailTex, uv) => {
  const a = texture(detailTex, uv.div(2400)).level(0).b;
  const b = texture(detailTex, uv.div(770).add(0.37)).level(0).a;
  return a.sub(0.4089).mul(1.35).add(b.sub(0.4089).mul(0.75)).add(1).clamp(0.6, 1.4);
};

// --- the air/water interface, done once and used three times ---------------
// Refractive index of sea water at 35 PSU, 589 nm (Quan & Fry 1995). Every
// number below falls out of it: F0 = ((n-1)/(n+1))^2 = 0.0211, and the critical
// angle for the water->air direction is asin(1/n) = 48.27 degrees.
const N_WATER = 1.34;
const ETA_AW = 1 / N_WATER; // air -> water
const ETA2 = ETA_AW * ETA_AW;

// The exact unpolarised Fresnel reflectance, not Schlick, and the reason is the
// water->air direction rather than fussiness about the third decimal.
//
// Going water->air there is a critical angle, and past it reflectance is
// exactly 1: a camera under the surface sees a mirror everywhere outside a
// 48-degree cone. Schlick has no critical angle at all — fed the water-side
// cosine at 48.27 degrees it returns 0.025, which is a factor of FORTY out, and
// it is why the old backface path could not do anything but crossfade to a flat
// swatch. There is no branch here: past the critical angle k goes negative, the
// max() pins cosT to 0, and both r terms go to +-1 on their own, so the
// function returns exactly 1 by construction.
//
// Above water it also removes a hack. Schlick^5 under-reports at 45-60 degrees
// and over-reports past 75, and the file was carrying `mix(5, 3.4, rough)` on
// the exponent to bend the curve back — which made the grazing error worse
// (+30% at 78.8 degrees at rough 0.4) in exactly the far field where the
// hold-back below then had to pay for it.
//
// eta is the ratio n_incident / n_transmitted: ETA_AW looking down into water,
// N_WATER looking up out of it.
const fresnelDielectric = (cosI, eta) => {
  const ci = abs(cosI).toVar();
  const k = float(1).sub(eta.mul(eta).mul(float(1).sub(ci.mul(ci)))).toVar();
  const ct = sqrt(max(k, float(0))).toVar();
  const ec = eta.mul(ci).toVar();
  const et = eta.mul(ct).toVar();
  const rs = ec.sub(ct).div(max(ec.add(ct), float(1e-5))).toVar();
  const rp = et.sub(ci).div(max(et.add(ci), float(1e-5))).toVar();
  return rs.mul(rs).add(rp.mul(rp)).mul(0.5);
};

// Henyey-Greenstein, peak-normalised so that g sets the WIDTH of the lobe and
// never its level — p(c)/p(1) = ((1-g)^2 / (1 + g^2 - 2gc))^1.5, and r*sqrt(r)
// is pow(r, 1.5) exactly. Peak-normalising is what lets the knee downstream keep
// its tuning when g moves.
const hgForward = (g, cosT) => {
  const r = float((1 - g) * (1 - g))
    .div(max(float(1 + g * g).sub(cosT.mul(2 * g)), float(1e-4))).toVar();
  return r.mul(sqrt(r));
};

// Band-limiting. Every map here is a StorageTexture with generateMipmaps left
// on, and three flags the binding needsMipmap on each compute write, so a mip
// chain *does* exist — the default LinearFilter min filter simply never reaches
// for it. An explicit level(log2(footprint / texel)) does, which is the correct
// average over the pixel rather than the bilinear lottery that used to print
// per-pixel static. That moves the aliasing problem out of the fade entirely.
//
// FEATURE_DIV is therefore no longer an anti-aliasing device; it is only the
// Toksvig bookkeeping — the point past which a cascade has been averaged away
// hard enough that what is left of it belongs in the roughness budget instead
// of in the normal. At 160 it was deleting cascade 2 (14 m patch, 5.5 cm texels)
// at a footprint of 8.75 cm, which a deck-height camera already exceeds in the
// FOREGROUND at a grazing angle: the near water lost every ripple it had and
// the mid-field showed nothing but cascade 1's 30 cm texel grid as hard-edged
// cells. At 45 cascade 2 survives out to a 31 cm footprint — several metres of
// real chop in front of the lens — and the mip chain keeps it clean past that.
const FEATURE_DIV = 45;
const ROUGH_FLOOR = 0.075; // never a perfect mirror, so no one-pixel spark
const ROUGH_FROM_VAR = 0.60; // sub-pixel slope variance -> lobe width
// A mip-filtered tap *is* the local mean slope, so it tends to zero on far
// water and takes the variance estimate with it. The footprint term is what
// carries roughness out there instead, so it has to bite much sooner than it
// did when the aliased tap was propping the variance up.
const ROUGH_FROM_FOOT = 0.30; // far water is rough even where it samples flat
const ROUGH_FOOT_SCALE = 0.55; // 1/m — footprint at which that term saturates
const ROUGH_MAX = 0.60;
const REFL_RELAX = 1.7; // how fast the mirror ray falls back to flat-water with roughness
// ...but never ALL the way. REFL_RELAX * ROUGH_MAX came to 1.02, so past a
// kilometre every pixel relaxed to the same flat-water ray, reflected the same
// point of sky and the far band went dead flat. Capping the relaxation leaves a
// quarter of the geometric normal in the ray at any roughness, which is what
// keeps swell modulation visible out to the horizon.
const REFL_RELAX_MAX = 0.74;
const GLINT_CLAMP = 0.9; // peak-radiance compression of the reflected sun
const REFL_FILTER = vec3(0.88, 1.00, 1.10); // the sea's own filter on a rough reflection
const REFL_DESAT = 1.8; // roughness at which the reflection is fully lobe-averaged
// How much chroma survives that averaging, and how much of the pixel the
// averaging is allowed to claim. Both were far too aggressive: saturate(rough *
// 1.8) hits 1 at rough 0.556 and ROUGH_MAX is 0.60, so essentially the whole
// frame ran at the 0.42 chroma floor and the sea came out R=G=B grey looking
// into the sun. The product (1 - CAP*(1 - CHROMA)) is the real number — the
// worst-case chroma anywhere on the water — and it now sits at 0.77.
const REFL_CHROMA = 0.62;
const REFL_DESAT_CAP = 0.60;
const REFL_GREY = vec3(0.84, 1.00, 1.21); // the cool grey it averages toward, never khaki
// The sky's haze band is a strongly saturated sand-orange directly under the
// sun's azimuth, and a deck camera reflects almost nothing else: every ripple
// facet in the near field aims within a couple of degrees of the line. A raw
// mirror tap of that band is a tan film lying over green water, which grades
// out as olive — the one colour a tropical sea must never be. A facet integrates
// over several degrees of the steepest gradient in the whole sky, and the mean
// of that band is far cooler than its peak, so cooling the reflection in
// proportion to how horizontal the reflected ray is fixes the film at source
// without muting the reflection anywhere else in the dome.
//
// Keyed on the reflection's own WARMTH rather than only on where it came from.
// An elevation gate alone is too blunt: the sand runs a long way up the sky
// under the sun's azimuth, and the cloud bases up there are warm too, so a gate
// tight enough to spare the blue overhead left a brown band across the sunward
// half of any high shot. (r - b) is positive only for the reflections that
// actually make olive on green water, and it is exactly zero for blue sky and
// for white cloud, so this can be driven hard without touching either.
const REFL_BAND = vec3(0.86, 0.99, 1.16); // the silver it is pulled toward
const REFL_BAND_DESAT = 0.80; // ...and how much of that warmth's chroma it costs
const REFL_WARM_GAIN = 3.5; // how sharply (r - b) counts as "warm"
const REFL_BAND_ELEV = 13.0; // 1/rad — the extra bite inside the haze band itself

// Sub-grid ripple. detailTexture.js packs a slope into RG, but it packs it as
// (-h' * 3 * 0.5 + 0.5) into 8 bits, and the fbm's own gradient is small enough
// that the whole field lands inside 128 +/- 3 — three usable code values, whose
// plateaus print as a hard-outlined cellular iso-contour wherever a sharp sky
// reflection runs over them. The height channels do not have that problem: B
// and A span most of the byte range. So the slope is reconstructed here by
// differencing the height instead, which costs two extra taps per scale and
// gives a continuous gradient at full precision. B is the base octave and A the
// same field at twice the frequency, so each 3-tap set carries two ripple
// scales, and two sets an octave apart carry four.
const RIPPLE_TILE = 0.55; // 1/m — ~1.8 m tile, so features are 45 cm and 22 cm
const RIPPLE_STEP = 2.5 / 512; // finite-difference offset, in tile units
const RIPPLE_GAIN = 2.6; // slope per unit of differenced height, times shading.detail
const RIPPLE_FINE = 0.7; // weight of the second (A-channel) octave
const RIPPLE_FOOT = 0.22; // m of footprint at which the coarse octave is filtered out
const RIPPLE_OCT = 4.0; // the second octave's scale against the first (~11 cm and 6 cm)
const RIPPLE_OCT_AMP = 0.85; // ...and its weight

// --- foam micro-relief -----------------------------------------------------
// Foam is a flat decal right now: the lace fields modulate its BRIGHTNESS but
// not its shape, so a cap lights uniformly and reads as paint. That is Crest
// issue #21 verbatim ("appears flat"; at sunset "looks overly saturated because
// the entire surface receives uniform lighting"), and the fix is Crest's own
// "Foam 3D Lighting": take the GRADIENT of a field you already have. War
// Thunder shipped the same thing in the 2026 "Ninth Wave" update as a
// micro-relief overlay for a slowly-settling 3D-suspension look.
//
// Here the field is detailTexture's CELLULAR pair (R, G), differenced at the
// same three taps the capillary ripple above already fetches off B and A. So
// this costs ZERO new texture samples — rippleGrad pulls whole vec4s and throws
// two channels away.
//
// Cellular is the right family for a bubble raft, for the reason
// detailTexture.js gives for the foam holes: one feature per grid cell so
// clusters cannot pile up (autocorrelation 0.117 at a tenth of a tile against
// the fbm's 0.414), each point with its own lognormal radius so the bubbles are
// visibly not all one size. The channel contract makes the tap reuse exact
// rather than merely convenient: R's feature diameter is 0.18 of a tile against
// B's 0.176, G's 0.078 against A's 0.088, so the ripple's own footprint fades
// (fadeA, fadeB) are already the right band limits. Delivered feature sizes:
//   coarse set (1.82 m tile): R 33 cm, G 14 cm — the clump-scale undulation.
//   fine set   (0.45 m tile): R  8 cm, G 3.5 cm — the bubble raft itself.
// Both inherit the ripple's slow drift, which is the settling: the fine set
// translates at 0.09/2.2 = 4.1 cm/s of world.
//
// This is a BRIGHTNESS term, not a normal fed to the specular, and that is
// deliberate. Inside foam a2 = roughSpec^4, so the GGX alpha is roughSpec^2 =
// 0.16 and the lobe half-width is atan(0.16) = 9.1 degrees; worse,
// `glint = max(ggx - 1.5, 0)` below is a HARD threshold with a 12.8-degree
// acceptance cone (peak ggx = 1/(a2*pi) = 12.4). A perturbation of the size
// that reads as bubbles is COARSER than both, so routing it through dot(N', H)
// would reshuffle glint membership per pixel and flash bubble-scale specks at
// wave frequency — and it would do it on WATER as well as foam, since the
// obvious gate (foamRough) is a 4.5 m-blurred halo that is nonzero metres
// outside any cap. A bounded factor on the finished foam brightness cannot do
// any of that, and needs no gate at all beyond `coverage`, which already masks
// the term and which descends from the accumulator (so it has memory).
// This scene's default sun also sits at 51.5 degrees but its other preset is
// 11.2, where a perturbed normal inside saturate(dot(Nf, L)) clamps to zero
// over a large fraction of the raft (a hard terminator on every cell) and is
// clipped away entirely on any crest facing away from the sun.
const FOAM_RELIEF_FINE = 0.6; // weight of G against R inside one tap set
// MEASURED on the real bake (via makeDetailTexture, bilinear finite difference
// at RIPPLE_STEP over a stride-2 sweep of the tile): rms(d/dx) is 0.01151 for R
// and 0.02490 for G, so G is 2.16x steeper per unit weight (it is a 2.2x denser
// lattice, 11 cells against 5). 0.6 brings the two slope contributions to
// 0.01151 and 0.01494 — within a third of each other — so the raft carries BOTH
// cell sizes rather than collapsing onto the finest. Cross-check that the two
// lattices are effectively independent: sqrt(0.01151^2 + 0.01494^2) = 0.01886
// against the directly measured 0.01906, agreeing to 1%.
const FOAM_RELIEF_OCT = 0.55; // weight of the coarse (clump) set against the fine
// Inverted against the ripple's RIPPLE_OCT_AMP: there the coarse set leads by
// 1.18x, here the fine set leads by 1.8x, because bubble scale is 3.5-8 cm and
// 14-33 cm is only the raft's slow lumpiness. 0.55 keeps 0.55/hypot(0.55,1) =
// 48% of full strength in the coarse-only regime, so the relief HALVES when the
// bubble grain filters out rather than vanishing with it.
const FOAM_RELIEF_RMS = 0.01906; // measured rms(d/dx) of R + 0.6 G at RIPPLE_STEP
// Two independent octaves at weights (0.55, 1) sum in quadrature, so this gain
// makes reliefGrad a field whose PER-COMPONENT rms is 1 at full fade.
// Everything downstream is then in sigma and nothing has to know about the bake.
// A difference of two samples has mean 0 whatever the weights, so TARGET_MEAN
// never enters and there is no shrunken-std trap here.
const FOAM_RELIEF_NORM = 1 / (FOAM_RELIEF_RMS * Math.hypot(FOAM_RELIEF_OCT, 1)); // 46.0
// Tail clamp, in sigma. cellularField is min(|x - p|/r), an unclamped distance
// field, so its gradient is DISCONTINUOUS along every cell boundary where the
// min switches feature point. Unclamped, those creases print as hard bright and
// dark lines through the raft rather than as bubble shading.
const FOAM_RELIEF_CLAMP = 2.0;

// Body. Mean sea level is y = 0, so height above it is a direct read on where
// a point sits between trough floor and crest lip. Every ramp built on it is
// *asymptotic*, never clamped: a saturate() here paints a hard iso-height
// contour across the sea and the fill between contours reads as spilled paint.
const WAVE_SCALE = 2.6; // metres of height that read as "a full crest"
const HEIGHT_SOFT = 1.3; // softness of the height ramp; larger = lazier gradient
// The trough->body ramp, as its own asymptotic curve rather than a smoothstep
// over `lift`. smoothstep(0, 0.50, lift) reached 1 at mean sea level, so the
// ENTIRE upper half of the sea was one flat body colour with a hard iso-height
// contour under it — the biggest single source of the paint-by-numbers look.
// These two put the ramp at 0.11 in a 5 m trough, 0.60 at 2.6 m below mean,
// 0.90 at mean level and 0.94 on a crest: same value range, no ceiling.
const BODY_BIAS = 1.07;
const BODY_SOFT = 0.27;
// Red is small but never zero. At literally 0.002 the sea comes out as printer
// cyan — a dye, not a body of water — and the highlights have nothing to roll
// toward.
//
// The deep end used to be biased GREEN, on the argument that a shadowed
// tropical trough is bottle-green rather than navy. That is true of the sea
// this project was originally aimed at and false of the one in the reference,
// and the gap it left was not subtle: measured over the foreground band,
// B is the maximum channel in 100.0% of the reference's water pixels and in
// 1.9-15.2% of ours. Not a hue that needs nudging — a channel ordering that
// was inverted almost everywhere.
//
// So every swatch below is now a rotation of the reference's own measured
// clean water, which normalises to (0.17, 0.44, 1.00) linear, i.e. R/G 0.386
// and B/G 2.273. The rotation is applied at CONSTANT LUMINANCE — each swatch
// keeps its old Y = 0.2126R + 0.7152G + 0.0722B to four figures — so this
// moves hue and nothing else. Every ramp, knee and asymptote built on these
// (BODY_BIAS, MASS_*, SHALLOW_MAX, the skyVis chain) is untouched by
// construction, which is the whole reason for doing it that way rather than
// by eye.
//
// SEA.crest is rotated only HALFWAY, and the reason is that it turned out to
// be doing two jobs. Nominally it is thin water at the lip, where the round
// trip is short enough that green survives — the reference shows exactly that,
// a distinct turquoise in every backlit lip, and it is what water.js exists to
// make reachable. But it is mixed in through `shallow`, which runs to
// SHALLOW_MAX 0.88 over the whole sunlit shoulder of a swell and not just the
// lip. Left unrotated it put teal back across the largest lit surface in the
// frame while everything under it went blue. Half the rotation (B/G 0.90 ->
// 1.55) keeps a genuinely thin lip reading turquoise and takes the broad
// shoulder tint with the rest of the sea. If the lip ever needs its green
// back, this is the constant, and narrowing `shallow` is the alternative.
// Both seas are kept, and `shading.palette` crossfades between them: 0 is the
// tropical green this project was originally aimed at, 1 the open-ocean blue
// the reference photograph measures. They are not two grades of one look, they
// are two different bodies of water, and the choice belongs to the shot.
//
// A single lerp is the whole mechanism, and it is exact at both ends — mix()
// returns its arguments at 0 and 1 — so neither sea is an approximation of the
// other. It also means the in-between is meaningful rather than a transition
// artifact: every pair below is a constant-luminance rotation of the same
// swatch, so interpolating them sweeps hue along a line and never dips through
// a value or saturation the endpoints do not have.
// The blue swatches carry a second correction beyond the hue rotation: a
// x0.60 luminance scale (x0.75 on the lit crest, x0.70 on scatter). The
// rotation was constant-luminance BY CONSTRUCTION, which preserved the
// tropical sea's brightness — and the reference's open ocean is measurably
// darker than a sunlit tropical shelf, which is why the blue sea read as
// powder under the midday rig. Hue untouched: each triplet is the rotated
// swatch scaled by one scalar.
const SEA = {
  //                    green (tropical)                blue (open ocean)
  trough: [vec3(0.0080, 0.0190, 0.0160), vec3(0.0040, 0.0103, 0.0233)], // shadowed floor
  abyss: [vec3(0.0170, 0.0440, 0.0400), vec3(0.0091, 0.0237, 0.0539)], // deep end of the mass wander
  body: [vec3(0.0280, 0.0930, 0.0995), vec3(0.0192, 0.0497, 0.1130)], // the bulk of the sea
  crest: [vec3(0.1650, 0.5200, 0.4700), vec3(0.1283, 0.3668, 0.5670)], // thin sunlit water at the lip
  bodyBlue: [vec3(0.0210, 0.0720, 0.1150), vec3(0.0155, 0.0401, 0.0911)], // bluer end of the wander
  scatter: [vec3(0.0880, 0.3000, 0.2820), vec3(0.0713, 0.1847, 0.4197)], // single scattering — see SCATTER_GAIN
};
const SHALLOW_MAX = 0.88; // crest water is never *pure* scatter paint
// Wander of the water mass' own colour. The tile sizes matter as much as the
// amount: at 0.0016 (a 625 m tile) the near field crossed three or four code
// values of an 8-bit channel, and the saturate() that used to sit on the end of
// this turned each of those into a flat plateau of one body colour with a
// one-pixel staircase boundary — continents on a map. Shorter tiles traverse
// far more texels per frame and the ramp below is asymptotic, so neither the
// quantisation nor the ramp can print a contour now.
const MASS_SCALE = 0.0055; // 1/m — ~180 m: the slow one, depth and turbidity
const MASS_NEAR = 0.0210; // ...and ~48 m, so near water varies within one wave group
const MASS_FINE = 0.1100; // ...and ~9 m, so ONE swell face in the foreground is not flat
const MASS_AMOUNT = 1.35; // how hard that wander swings deep <-> body
const MASS_SOFT = 0.55; // knee of the asymptotic ramp it runs through
const MASS_HUE = 0.0030; // 1/m — a third, independent axis: blue-green <-> green
const MASS_HUE_AMOUNT = 0.50;
const SKY_VIS_MIN = 0.34; // a trough only sees a slot of sky between its walls
// Sky-only light on faces turned away from the sun: the ambient's own hue,
// renormalised to a fixed shadow luminance (0.487) — so the shadow is mauve
// under the golden panorama and blue-grey under the midday one, computed in
// the shader from the measured ambient uniform instead of frozen against one
// sky. Changes only the COLOUR of shadow, never how dark it is.
const SHADOW_LUM = 0.487;

// Wave-group occlusion. Everything else in the value chain — the colour ramp,
// the sky visibility, the wrapped sun — is keyed off the same two numbers
// (height above mean, and how far the normal faces up), so on a near-flat
// foreground patch they all pin to constants together and the hero wave face
// comes out a 2%-range flat card. Cascade 0 carries the swell alone, which is
// the blurred sea level the rest of the field rides on: reading it separately
// gives a term that is *independent* of both, so a patch sitting low inside a
// swell group goes dark whatever its own height or facing is doing.
const GROUP_SCALE = 3.4; // metres of swell height that read as a full group
const GROUP_SOFT = 1.0;
const GROUP_DARK = 0.50; // how much value the bottom of a group loses
const CHOP_LIFT = 0.55; // ...and how much a chop crest standing on it wins back

// Subsurface scatter — the Sea of Thieves cue, and the one this file kept
// getting inside out. Thickness used to be (height above mean) AND (1 - facing
// up): both of those switch hard at the crest ridge and both are wrong about
// where a lip is, so the product printed a knife-edged mossy patch on crest
// backs that read as an island breaking the horizon.
//
// Thickness is now measured, not inferred: the displacement map is read twice,
// once sharp and once from the mip level that averages it over CREST_RADIUS
// metres of sea, and the difference is how far this point stands proud of the
// water immediately around it. That is largest at a lip, zero on a plateau and
// negative in a trough, it is a *local* comparison so it cannot draw an
// iso-height contour anywhere, and because both taps are of a smooth field it
// runs as a continuous gradient down the face instead of snapping at a ridge.
const CREST_RADIUS = 5.0; // metres of sea the "local mean height" probe averages over
const SSS_DEPTH = 0.80; // metres above that local mean that read as fully thin
const SSS_GAIN = 1.7; // peak input to the knee; low enough that it never plateaus
const SSS_MAX = 0.75;

// Effective asymmetry of the forward-scatter lobe. A single droplet of sea
// water is g ~ 0.92, but what is being looked through is a volume many
// scattering events deep and multiple scattering smears that lobe very wide.
// 0.62 puts the half-maximum 21 degrees off the sun's bearing, so the whole
// sunward side of a crest carries the glow as a gradient rather than a ring
// around the sun's exact azimuth.
const SSS_G = 0.62;
// The path light actually crosses, in METRES, at the thinnest and thickest ends
// of the lip detector. This pair is the thing that replaced a pair of authored
// colour swatches: exp(-mu*d) at 0.6 m comes out a warm near-white and at 3 m a
// jade green off the same coefficients, so the gold tip and the green run down
// the face are one exponential sampled twice instead of two constants and a
// blend factor between them.
//
// Note the direction. crestRel measures how far a point stands PROUD of the
// water around it, so it is largest where the water is THINNEST — the path
// shortens as thinP rises, which is why LIP_TIP is the second argument to the
// mix and not the first. Getting this backwards inverts the whole cue and is
// the single easiest mistake to make here.
const LIP_TIP = 0.60;
const LIP_BASE = 3.00;

// Diffusion attenuation of the two water types the mass wander interpolates
// between, 1/m per RGB, computed from published (a, b) tables — see water.js.
// These are the numbers that used to be the hand-picked SSS_COLOR swatch, and
// unlike a swatch they carry a length, so the glow can change hue with
// thickness instead of only with strength.
const MU_CLEAR = vec3(...diffusionAttenuation('1C'));
const MU_TURBID = vec3(...diffusionAttenuation('3C'));

// Single scattering — the missing half of the water's brightness, and the one
// that fills the value hole. SSS above is view-DEPENDENT: it only fires where
// the camera is looking down the forward-scattered ray, which is a small part
// of any frame. Everything else in the body chain only ever ATTENUATES a
// palette swatch whose brightest channel is 0.44 linear, so the frame had
// nothing at all between the near water's near-black teal and the far water's
// 90%-sky wash — the exact band where Sea of Thieves' turquoise lives.
//
// This term is view-independent: sun on the water, gated on the same measured
// thinness, so it lights the whole sunlit shoulder of every swell rather than
// only a back-lit lip. It is what puts real energy into 0.15-0.45 linear.
// Also a transmittance, but NOT the same one as SSS_COLOR, and the difference
// is path length. SSS is light crossing a sub-metre lip once. This is light
// that goes down INTO the water, turns around and comes back out — several
// metres of round trip, over which red really is gone. So red stays near the
// floor here even though the light is warm.
//
// Lifting it to 0.165 to "match the golden sun" was a mistake worth recording:
// this term is ADDED on the whole sunlit shoulder of every swell, so the red
// went everywhere the sun hit and the sea turned olive — the one colour the
// original note in this file warns against. Only the lip may go gold.
//
// Rotated blue with the body swatches — same constant-luminance rotation onto
// the reference's (0.386, 1.0, 2.273). This is the term that decides what
// colour the sunlit shoulder of every swell is, because it is ADDED there, and
// leaving it green while the body went blue would have put a green cast back
// over exactly the half of the sea that catches the light. It is also the
// physically right direction: this is light that goes down into the water,
// turns around and comes back, and over several metres of open ocean the only
// band with any of that left is blue. The swatch pair itself lives with the
// other five in SEA, so the whole sea moves on one uniform.
const SCATTER_GAIN = 0.72;
const SCATTER_BASE = 0.16; // ...at its weakest, on water that stands proud of nothing — the floor is what decides how dark a flat trough may stay, and the reference troughs are near-black

// Reflectivity with distance. Near water at eye level is grazing enough that
// pure Schlick hands the whole frame to the sky and the sea turns grey-tan;
// SoT keeps its body colour far out to sea and only lets the last kilometre go
// to mirror. REFL_NEAR is that hold-back, GRAZE the release.
// Both numbers were far too eager. At 1200 m / 0.52 the far HALF of every frame
// ran at 90% reflection or better, which is why a kilometre of sea was
// indistinguishable from the sky above it. The ceiling is the real guarantee:
// however grazing the angle and however far the water, a fixed share of the
// pixel is the sea's own colour, so the horizon band stays blue-green and can
// never resolve to the same putty as the sky.
// ...and it went up by a third when the Schlick approximation below was
// replaced with the exact Fresnel. Exact is 0.771x what `mix(5, 3.4, rough)`
// returned at 78.8 degrees and roughness 0.4, which is where a deck camera
// spends most of its frame, so holding the same amount back off a smaller
// number would have taken the near field's sky with it.
const REFL_NEAR = 0.26;
const GRAZE_RANGE = 4000; // metres over which the hold-back is released
const GRAZE_AMOUNT = 0.15; // ...and how hard the far field is then pushed to sky
const REFL_CEIL = 0.86; // the sea always keeps at least 14% of itself

// Sun specular. A saturating GGX lobe: broad glitter, no fireflies.
//
// Fresnel is applied AFTER the compressor, not folded into the lobe before it.
// Multiplied in first, it scales the number the knee sees, so the hold-back
// that keeps near water from going to mirror was also deciding how bright the
// glitter path is allowed to get — and with a knee of 13 the broad moderate
// part of the path, which is the part that makes a path *read*, was compressed
// to a fifth of its value. Looking straight into the sun, the water under it
// came out the darkest water in the frame. Knee at 1.5 and Fresnel outside puts
// the wash back and lets the true peaks clip white.
//
// What the knee actually controls is CONTRAST, and the direction is not the
// obvious one. x/(x+k)*M has slope M/k near zero and ceiling M, so lowering the
// knee makes the *wash* brighter while lowering the ceiling makes the *peaks*
// dimmer — together they flatten the path into the uniform sheet of light the
// last pass shipped, where a facet 25 degrees off the half-vector returned a
// third of what a mirror facet did. Raising k and M together is what opens the
// gap: at roughness 0.35 the core now returns 3.5 and the 26-degree skirt 0.15,
// a 23:1 ratio against the 13:1 it had. That ratio is the glitter road.
const SPEC_KNEE = 3.0;
const SPEC_MAX = 4.0;
// How much of the sun's own colour the glitter gives up. It was 0.70 — the
// brightest thing in the frame was being repainted seven-tenths white — and a
// measured deck capture came back with the specular road at a ratio of
// 1.000 / 0.994 / 0.984, which is white, under a sun the sky panorama measures
// at 1.000 / 0.827 / 0.584. The light source and the light did not agree.
//
// Physically this should be near zero: a dielectric's specular reflectance is
// almost flat across the visible band, so a mirror hands back the source's hue
// unchanged. The original note ("never tan") was guarding against a real thing,
// but the wrong one — what makes a tan film on green water is the reflected
// HAZE BAND, and that has its own desaturation chain (REFL_BAND and friends)
// which this constant never touched. What this constant governs is the sun.
//
// Not zero, though. The GGX lobe is ADDED to the water rather than replacing
// it, so its dim skirts land on green: a fully saturated gold added at low
// amplitude to a green body is olive, and the skirt covers far more of the
// frame than the core. A quarter white keeps the wash neutral enough while the
// road itself carries the sun's colour, and the core clips to white on its own
// through ACES — which is what a real sun road does.
const SPEC_WHITE = 0.25;
// The lobe's own roughness is clamped at both ends, and the top clamp is the
// one that makes a road. Far water reaches ROUGH_MAX plus the distance spread,
// which is a 35-degree lobe: every facet within thirty degrees of the sun's
// bearing returned most of the peak, so a high shot came out with a tan wash
// over its whole sunward half instead of a path. 0.40 is still a 23-degree
// lobe — far too wide to alias, narrow enough to have edges. The floor stops
// the near field going razor-thin and printing single-pixel sparks.
const SPEC_ROUGH_MIN = 0.12;
const SPEC_ROUGH_MAX = 0.40;
// A glitter path widens with distance because each far pixel averages more sea.
// Roughness alone half-does that; this adds the rest explicitly, so the path
// broadens toward the horizon instead of depending on lucky facets. Kept small:
// at 0.09 the far lobe was wide enough to cover the whole frame, so there was
// no road, only daylight.
const SPEC_SPREAD_RANGE = 4000; // metres to full extra spread
const SPEC_SPREAD = 0.035; // added to roughness^2 at that range

// --- aerial perspective ----------------------------------------------------
// The water composites its OWN haze (mat.fog is off below) rather than taking
// scene.fogNode. Two reasons, and both are about the horizon line.
//
// scene.fogNode runs after the material, so it hazes the finished pixel — but
// its target is skyColor() evaluated along the view ray, which just below the
// line is by construction the same value as the sky just above it. Fog that
// converges exactly on the sky cannot draw a horizon, it can only dissolve into
// one, and every additive term the water adds on the way (glitter, foam, glow)
// then rides on top of that and pushes the last few hundred metres of sea
// ABOVE the sky it meets. Measured: sea 205 against sky 197.
//
// Owning the composite fixes both. The target is the sky just ABOVE the line
// (so it is the value the eye compares against) scaled by SEA_SINK, and it is
// applied last, after the specular and the foam, so nothing escapes it. The sea
// then lands a fixed few percent under the sky at every distance and the line
// is a clean step instead of a bloom band.
//
// Density and scale height mirror atmosphere.js so the water agrees with every
// other fogged object in the scene.
// Thinner than atmosphere.js's 1/2150, deliberately. That density is right for
// a sky dome and for spray a few metres away, but on water it puts a fifth of
// the sand-coloured haze band over sea that is only six hundred metres out, and
// a fifth of sand over green reads as a mudflat. At 1/3200 the mid-field keeps
// its own colour, the last kilometre still dissolves, and by the horizon the
// extinction is 99.8% — which is all the horizon line needs.
// per-sky — see SKIES.hazeWater; resolved inside the material builder, after
// a shot's overrides have picked the sky
const HAZE_SCALE_H = 450; // metres for the haze to thin by 1/e
const HORIZON_LIFT = 0.004; // elevation the haze target is sampled at: just above the line
const SEA_SINK = 0.820; // ...and how far under the sky the sea is held
const FAR_SINK = 0.78; // extra darkening of the sea's own value with distance
const FAR_SINK_RANGE = 4000;

// A last, deliberate chroma push. ACES at exposure 1.2 desaturates hard, and
// the reflection is a large fraction of most pixels; without this the frame
// grades out cooler and greyer than any of the palette swatches suggest.
//
// 1.00, i.e. off, because the curve it was correcting for is gone — main.js
// swapped ACES for Khronos PBR Neutral and flagged this constant as doing less
// work than it was written for. Left in at 1.12 it was doing the opposite of
// its purpose: measured over the foreground band, our median pixel saturation
// is 0.61-0.67 against the reference's 0.351, and the top decile runs 0.854.
// Foam at 85% saturation is not white foam, and extrapolating away from
// luminance is what put it there.
//
// Kept as a named constant rather than deleted along with the two lines below,
// because it is one number and the grade may want it back on a different sky —
// and the green sea, which was authored under ACES, is exactly that sky, so it
// keeps its 1.12 and rides the same palette lerp as the swatches.
const SAT_BOOST = [1.12, 1.00];

// The ocean surface: multi-cascade displacement (vertex) + water shading
// (fragment). Shading is manual (unlit MeshBasicNodeMaterial): the normal is
// mip-filtered against the pixel footprint and the detail it still loses becomes
// roughness, a roughness-aware Fresnel blends a relaxed, lobe-averaged sky
// reflection against a body whose value runs from near-black trough to lit
// crest on three independent axes (height, wave group, and the water mass' own
// wander), a measured thickness makes back-lit crest lips transmit, a GGX lobe
// draws the glitter path, and accumulated-Jacobian foam whitens breaking crests.
// A baked tiling noise texture, differenced for its gradient, adds capillary
// ripple below the finest cascade.
// Specular anti-aliasing: where the normal varies fast inside one pixel
// (contour-grazing wave outlines), the GGX lobe both widens and desaturates,
// which removes the warm per-pixel speckle that traced wave contours in the
// away framings.
const SPEC_AA_VAR = 6.0; // roughness^2 added per unit of normal fwidth
const SPEC_AA_DESAT = 0.6;

// --- the foam carve: de-tiled, and decoded AC3-style ------------------------
// The dissolve read ONE 512^2 texture at 17 m and 3.4 m. The beat is not a
// cell/tile coincidence — the shipped carve touched no cellular channel at all,
// only .b and .a. It is that detailTexture.js bakes A as fbm(u*2, v*2), i.e.
// the SAME field as B at doubled UV, so the shipped pair was one field at 17 m
// and 1.7 m: an exact 10:1 harmonic of itself, re-aligning perfectly every
// 17 m. Three independent causes of a legible repeat, three fixes, applied
// together because each removes only one: a domain WARP (no two copies the same
// shape), a CONSTANT rotation between the taps (the two lattices never share an
// axis), and a NON-HARMONIC ratio between DIFFERENT channels.
//
// On top of that the carve is decoded the way Rendering Assassin's Creed III
// (St-Amour, GDC 2013) decodes foam: three grayscale densities — coarse,
// sparse, medium — with one ramp on foam intensity deciding the mix, "at ~0.1
// mostly coarse, at ~0.8 all coarse + all sparse + ~50% medium". detailTexture
// already bakes the equivalent set, so the densities cost nothing new: two taps
// are already paid for and a sample returns all four channels.
//   coarse = fbm B at the 17 m tile, warped          -> 2.99 m patch silhouette
//   sparse = coarse Worley R at the fine tile, warped, rotated, INVERTED
//                                                    -> 66 cm cells, 74 cm pitch
//   medium = fine Worley G at the same fine tap       -> 29 cm grain
// The sparse layer is inverted because a cellular F1 field is LOW near its
// feature points: its high side is the cell walls, a connected web, and its low
// side is the isolated round spots that "sparse" means.
const CARVE_MEAN = 0.4089; // detailTexture.js TARGET_MEAN, every channel
const CARVE_STD1 = 0.1328; // detailTexture.js TARGET_STD, one channel, mip 0
// The shipped composite weights, kept so the calibrated cut keeps its meaning.
const CARVE_W_C = 0.62;
const CARVE_W_F = 0.38;
// Tiles. The coarse tile is the shipped 17 m UNCHANGED — same channel, same
// scale, so the coarse feature stays 0.176*17 = 2.99 m and both drift speeds
// stay bit-identical. The fine tile is 17/(3 + phi): the ratio whose continued
// fraction is all 1s, hence worst-approximable (limsup q^2|x - p/q| =
// 1/sqrt(5), the Hurwitz maximum). Its convergents are Fibonacci, so the first
// place the two lattices come back within a fine feature width of alignment is
// 5 coarse tiles (85 m, 0.33 m residual against a 0.29 m feature) then 8
// (136 m, 0.21 m) — against the old 5:1, which re-aligned PERFECTLY every 17 m.
const CARVE_TILE_C = 17;
const CARVE_TILE_F = CARVE_TILE_C / (3 + (1 + Math.sqrt(5)) / 2); // 3.68124 m
// A CONSTANT rotation on the fine tap so its jittered SQUARE cellular lattices
// never share an axis with the coarse tap's tiling and drift. tan(theta) =
// 1/phi: a square lattice has a coincidence rotation at every atan(p/q), and
// the worst-approximable slope has no low-order coincidence site.
// atan(0.618034) = 31.72 degrees. What NOT to use: 0.54 rad, whose tan = 0.5994
// is within 0.4% of 3/5 — the 3-4-5 coincidence rotation, which maps a square
// lattice onto a sublattice of itself.
//
// Constant is the structural point. A spatially varying rotation of a world
// coordinate shears by |p| * grad(theta), and worldXZ reaches 20 km on this
// radial grid, so a +/-20 degree field over 60 m shears by a factor of ~100.
// Zero gradient, no lever arm. cos/sin folded at build time — no trig, and no
// Math call inside the shader body.
const CARVE_ROT = Math.atan(2 / (1 + Math.sqrt(5))); // 0.553574 rad
const CARVE_ROT_C = Math.cos(CARVE_ROT); // 0.850651
const CARVE_ROT_S = Math.sin(CARVE_ROT); // 0.525731
// The spatial variation comes from a DOMAIN WARP, the origin-safe way to vary a
// local frame: a translation field's Jacobian is I + grad(w), a local rotation
// plus a mild shear, with no |p| term. A periodic zero-mean warp is also a
// rearrangement of the plane, so to first order it cannot change the field's
// histogram and therefore cannot change foam area.
//
// Sized by the shear it costs. The components are the fbm pair read at one tap;
// at this tile their feature diameters are 0.176*110 = 19.4 m and 0.088*110 =
// 9.7 m, and the per-component displacement std is 0.1328*8.0 = 1.06 m, so the
// dominant-octave gradients are 0.055 and 0.110, ~sqrt(3) higher over three
// octaves at equal per-octave gradient energy: ~0.10 and ~0.19. det J stays
// comfortably positive (no folding) and Yu, Neyret, Bruneton & Holzschuch
// 2011's distortion metric max(sigma_max, 1/sigma_min) tops out near 1.2, far
// inside their kill margin. The payoff is the DIFFERENCE in warp between two
// copies of the coarse tile 17 m apart, ~1.7 m — over half a coarse feature,
// and several times over for the 29 cm fine features.
//
// The bias is CARVE_MEAN, not 0.5, and that is what makes the warp degrade
// gracefully where fwidth explodes at grazing incidence and taps mip-flatten
// toward the channel mean: a flattened tap gives exactly (0, 0), so the carve
// reads unwarped. A 0.5 bias would leave a spurious (-0.73, -0.73) m offset
// that fades IN with distance.
const CARVE_WARP_TILE = 110; // m
const CARVE_WARP_AMP = 8.0; // m per unit of channel deviation
// detailTexture.js bakes A as the B field at doubled UV, sharing the same
// coarsest-octave lattice values, so at ONE texel the two are correlated
// (rho ~ 0.249). Uncorrected the warp vector is biased along the diagonal
// (principal axes 1.29:1). Gram-Schmidt on the y component removes it for two
// multiplies and preserves the degrade-to-exactly-zero property, because both
// terms are already mean-biased.
const CARVE_WARP_RHO = 0.249;
const CARVE_WARP_ORTH = 1 / Math.sqrt(1 - 0.249 * 0.249); // 1.03242
// Footprint at which the FINE tile is treated as gone: half the 0.30 m grain,
// the same half-feature rule RIPPLE_FOOT uses. It drives BOTH the ramp's fine
// weights and the shipped-sigma model below, which is what makes the contrast
// match exact rather than approximate — see CARVE_TRIM.
const CARVE_FOOT_F = 0.15;
// AC3's published ramp stops, and the interpolation between them. These five
// ARE the ramp; they are the only part of the decode meant to be touched.
const RAMP_IN = 0.10; // "mostly coarse"
const RAMP_FULL = 0.80; // "all coarse + all sparse + ~50% medium"
const RAMP_MED_TOP = 0.50; // ...the "~50% medium" of that stop
const RAMP_MED_IN = 0.45; // medium enters halfway between the two published stops
// A pedestal under the sparse layer so a birth edge is broken by flecks rather
// than being a smooth 2.99 m contour. With w = (1, 0.25, 0) the sparse layer
// holds 0.0625/1.0625 = 5.9% of the composite variance, which is still "mostly
// coarse" by any reading.
const RAMP_SPARSE_MIN = 0.25;
// Clip on the inverted cellular's LONG side, in field units. F1 = min(|x-p|/r)
// is bounded below by 0 and unbounded above, so inverted it has a long LOW tail
// that detailTexture never measured (its header measures the other one).
// Unclipped, a cell-wall texel contributes about -2.7 sigma to the composite on
// its own at full ramp and punches a hole straight through a solid cap on the
// 74 cm lattice. The clip lifts the mean by a small fraction of a sigma and
// shrinks the std slightly, both negligible against a ~2 sigma cut and both in
// the strict direction.
const SPARSE_CLIP = -2.0 * CARVE_STD1;
// Measured area trim on the composite's contrast. 1.0 = the derived value, i.e.
// contrast matched to the SHIPPED composite at the same footprint and the same
// cov, which makes the calibrated 0.60/0.42/0.15 cut area-neutral by
// construction rather than by argument. Move THIS, never params.foamThreshold,
// if a coverage measurement drifts: the threshold sets generation and is
// calibrated against Monahan & O'Muircheartaigh 1980.
const CARVE_TRIM = 1.0;

// --- foam tonal ladder by age ----------------------------------------------
// Foam is not white and does not stay bright: fresh multilayer caps reflect
// ~0.50 of the visible (Whitlock, Bartlett & Gurganus 1982, layers >0.1 m
// against a 94-99% BaSO4 standard; Dierssen 2019 gives 0.4-0.5 on actively
// breaking foam) and Koepke 1984 followed individual whitecaps from 0.20-0.55
// at formation down to 0.03-0.10 within ~10 s. Reul & Chapron 2003's thickness
// classes are the scaffolding: fresh cap = a metres-thick opaque air-water
// mixture, trail = tens-of-cm static foam, late film = a ~1 mm emulsive
// monolayer. One flat saturated white for both a breaking cap and a
// four-second wake is the single biggest reason this foam read as plaster.
//
// THE LADDER IS RELATIVE, NOT AN ABSOLUTE ALBEDO, and the LEVEL is deliberately
// NOT budgeted under Khronos PBR Neutral's knee. Two reasons. (a) This renderer
// paints water as mix(body + glow, skyColor(R), fres) with REFL_CEIL and a
// chroma push, not as albedo x irradiance, so an absolute 0.22 effective albedo
// times a stand-in irradiance has no calibrated relationship to the sea beside
// it — and at the grazing angles most foam is seen from it lands whitecaps
// DARKER than the water. (b) The measured budget does not exist: R > 200 in the
// calibration probe needs 0.515 pre-exposure and the pre-exposure identity
// limit is 0.8/1.2 = 0.667, so the whole span from "reads as a whitecap" to
// "at the knee" is a factor of 1.29. A ladder that fits inside it is invisible;
// a ladder that does not fit drops most of the calibrated foam population out
// of the frame. So tone 1.0 means "the freshest solid cap", it lands near where
// today's foam already lands, and the ladder runs DOWN from there over the ~2:1
// span the dossier's own 1.0/0.85/0.8/0.58/0.5 rungs occupy. The top rung
// compresses in the knee exactly as today's flat white already does; every rung
// below it is uncompressed and separates cleanly.
//
// AGE. (1 - turb) IS the accumulator's own exponential: maps.js recovers
// foaminess as f = max(inject, f_prev*exp(-dt/tau)), so u = 1 - turb falls by e
// every tau seconds from whatever depth the last break left, and u^4 is a
// front-loaded exponential in age (u 0.95 -> 0.81, 0.90 -> 0.66, 0.80 -> 0.41)
// that is scale-invariant across cascades because tau scales with breaker phase
// speed for area and albedo alike.
//
// It is REMAPPED onto a display range [AGE_END, 1], not allowed to reach
// u_death^4 = 0.214. Two reasons, both measured. (a) `coverage` is ALREADY
// fading to zero as u falls to 1 - foamThreshold, so a tone that also falls to
// 0.214 there double-counts the fade. (b) The accumulator is a running max of
// the instantaneous injection with a slow release (at 60 fps with tau = 3.9 s
// the recovery term moves only 0.43% per frame), so it steps instantly on a
// reset; du^4/du = 4 at u = 1 would put a ~2.2x single-frame pop in phase with
// the alpha step, against 1.45x today. Narrowing the range cuts that to 1.4x.
const AGE_U_DEATH4 = (1 - 0.32) ** 4; // 0.2138. RECOMPUTE IF foamThreshold MOVES
const AGE_END = 0.72; // relative tone at the moment the mask lets go
// Far field. Cascade 1's texel is 144/256 = 0.5625 m and the accumulator tap
// has no explicit LOD, so past some footprint u is a bilinear lottery and u^4
// amplifies it fourfold. Do NOT fix this with .level() on the turb tap — that
// would change cov and therefore AREA. The fade starts at TWO texels rather
// than one because maps.js's spatial dissipation now band-limits the
// accumulator itself: it is diffused by 2.0-2.7 texels over one e-folding time,
// so at a 1-2 texel footprint the tap is resolving real structure and not a
// lottery. That is worth stating because it is a genuine interaction — with the
// accumulator un-blurred these two constants have to halve. AGE_FAR_HI is 8
// texels; the dossier's whitecap patch mode is 8-16 m^2, i.e. 2.8-4.5 m across,
// so past ~4.5 m the area average is the only meaningful answer.
const AGE_FAR_LO = 1.125;
const AGE_FAR_HI = 4.5;
// THICKNESS WITHIN THE RAFT. Deliberately NOT "distance past fEdge + 0.15":
// that quantity becomes a deterministic function of cov once the carve
// mip-flattens, and it bottoms out at exactly the cov contour where flattened
// foam first reaches alpha 1 — dark blotches where distant whitecaps should be.
// Centred on the baked mean over +/-2 sigma of a SINGLE channel instead, so
// there is no weighted-sum std shrinkage to get wrong and a mip-flattened tap
// degrades to exactly 0.5, i.e. to the factor's own mean, which is the
// constraint-4 answer by construction. Read off the FINE tap (29 cm grain) so
// the modulation is finer than a raft: the coarse 17 m field would darken and
// brighten whole GROUPS of caps, the dossier's patch mode being only 2.8-4.5 m
// across. Whitlock's single bubble layer reflects ~0.2 of the multilayer figure
// and Dierssen 2019's residual stage-B foam is 0.18/0.50 = 0.36 of it, which is
// the licence to modulate brightness by the lace texture at all; the physical
// ratio is not survivable on this display span, so LACE_MIN is that ratio
// shallowed onto it. It never touches alpha or silhouette, so foam AREA is
// bit-identical and the Monahan & O'Muircheartaigh calibration still holds.
const LACE_MEAN = 0.4089;
const LACE_HALF = 2 * 0.1328; // 2 sigma, one channel, no root-sum-square shrink
const LACE_MIN = 0.78;
// Safety floor on the product; with the ranges above it never binds
// (0.72*0.78 = 0.562) and exists so a threshold change cannot drive tone to 0.
const TONE_FLOOR = 0.45;
// The far-field area answer: coverage-weighted mean remapped age (~0.87) times
// laceF at its own mean (0.78 + 0.22*0.5 = 0.89). Continuous with the modal
// near-field cap, so nothing pops at the fade boundary.
const TONE_FAR = 0.78;
// The irradiance term, unchanged in RATIO from the foamLight it replaces —
// 0.55 standing in for Esky/pi and 0.60 for Lsun/pi, which is Dupuy & Bruneton
// 2012's l = (Lsun*max(dot(N,L),0) + Esky)/pi with an ambient floor.
const FOAM_AMB = 0.55;
const FOAM_SUN = 0.60;
// The standard wrap, diffuse = max(0, (N.L + w)/(1 + w)) (GPU Gems ch.16,
// worked example w = 0.2; the aerated-foam band is 0.2-0.4, so this is its
// centre), so the shadow side of a cap keeps its shape instead of flattening
// onto the ambient floor.
const FOAM_WRAP = 0.30;
// The grazing forward lobe. Goniometer measurements (Infrared Physics &
// Technology 2025) find a forward-scattering peak rising above the
// quasi-Lambertian background as incidence grows, with peak height growing
// about linearly with layer thickness, while the medium stays dominantly
// diffuse (Kokhanovsky B = 2.3). A quarter of the direct term is the most that
// reading supports, and the min() it feeds bounds it absolutely.
const FOAM_FWD = 0.15;
// Safety net on the peak, pre-exposure: normalise rather than clamp so hue
// survives if the colour picker is dragged somewhere the level did not cover.
// Sits just above today's own peak (foamColor.b 0.813 x 1.15 x 1.30 = 1.07), so
// it does not bite on the shipped swatch — it is a guard, not the budget.
const FOAM_CEIL = 1.05;
// Spectrally flat at the surface, but as foam ages, wets and thins the photon
// path crosses more liquid water and the red goes first: 0.889 at 670 nm in the
// Frouin, Schwindling & Deschamps 1996 whitecap factors NASA processing
// adopted (1.0 through 555 nm, 0.889 at 670, 0.760 at 765). The green-cyan of a
// SUBMERGED plume is a different mechanism and lives on the milkiness term.
const FOAM_RED_AGED = 0.889;
// How much of the water's BROAD specular comes back through an aged film. A
// fresh cap is a metres-thick opaque air-water mixture, which is why caps read
// matte against a glinting sea; a late ~1 mm emulsive monolayer IS a water film
// with a Fresnel interface. Only the broad lobe: the boosted glint term is
// 0.5*SPEC_MAX*specBoost and specBoost is 12.0 under the DEFAULT midday sky, so
// returning it would make a trail-band raft the brightest thing in the frame
// and erase the whole ladder — the exact "glint punches through the raft"
// failure the dossier names. Gated on AGE alone, never on the thickness axis: a
// fresh cap is opaque however lacy its carve texel happens to be.
const FOAM_SPEC_FILM = 0.5;

// --- submerged bubble plume, milkiness, and the scud apron ------------------
// A whitecap sits ON an aerated column: a plume of bubbles that brightens and
// desaturates the water under and BEYOND the visible white, so there is no
// clean boundary anywhere. Crest renders that as two layers (an opaque surface
// raft plus a transmissive, parallaxed sub-surface bubble layer), War Thunder
// adds milkiness to the refraction, Uncharted uses foam to reduce apparent
// water depth. All three act on the WATER, which is why the block below runs
// before the raft is composited.
//
// NOT attempted here, and it is a measured refusal: a WIDE plume dilated out of
// foamRough. foamRough is the mip-3 MEAN of the accumulator passed through the
// SAME threshold, so averaging pushes it toward the unfoamed value and the
// threshold zeroes it — it is an EROSION filter, nonzero only inside large
// dense rafts where cov has already clipped to 1, not a dilation. The reach
// past the white edge comes from the apron below, which is measurable, and from
// maps.js's spatial dissipation, which widens the accumulator itself.
const DETAIL_N = 512; // makeDetailTexture's default; the material never sees the
// texture's dimensions, so keep this in step with main.js's call
// Dierssen 2019: thin residual foam reflects ~18% against 40-55% for a fresh
// raft. Plume and film are the RAFT'S OWN swatch taken down by that ratio, so
// shading.foamColor still drives all three layers.
const SCUD_TONE = 0.18 / 0.475; // 0.379
// Crest gives its bubble layer no sun term (it is inside the water), which
// leaves a sunlit plume flat. What the raft does not reflect it passes down,
// fully diffused: 1 minus Dierssen's 47.5% mid.
const BUB_SUN_T = 1 - 0.475; // 0.525
// The column the milkiness is seen through, in metres, fed to the same muWater
// the crest glow uses. LIP_TIP (0.60 m) is a warm near-white off those
// coefficients and LIP_BASE (3.00 m) a jade green; a plume is neither — a pale
// sea-green — so the geometric mean brackets it. Jerlov 1C gives exp(-mu*d) =
// (0.563, 0.814, 0.751), 3C (0.532, 0.765, 0.624): desaturated, faintly green,
// greener when turbid. This IS the Uncharted apparent-depth cue — under foam
// the water transmits a 1.34 m column instead of the deep body.
const MILK_PATH = Math.sqrt(LIP_TIP * LIP_BASE); // 1.342 m
// Crest's parallaxed sub-surface layer: offset the lookup by -k*V.xz/V.y so the
// bubble cloud sits below the surface plane and slides against the white lace
// as the camera moves. That differential slide is the whole depth cue and it
// costs exactly one tap. A TRANSLATION, not a rotation, and bounded, so it
// cannot shear with |worldXZ| on the 20 km radial grid.
const BUB_DEPTH = 0.12; // m of fake depth — the dossier's k = 0.05-0.15
// Clamp on the parallax denominator: bounds the offset at 5*BUB_DEPTH = 0.60 m.
// V.y and NOT dot(N, V): N carries the capillary ripple and cascade 2's 9 cm
// texels, and d(offset)/d(NoV) = -k|V.xz|/NoV^2 is 1.3 m per unit at NoV = 0.3,
// so a normal-derived denominator would grain the plume for nothing. V.y is
// vertex-interpolated, smooth, and the correct flat-plane denominator anyway.
const BUB_VY_MIN = 0.20;
// B's measured feature diameter is 0.176 of a tile, so a 5.3 m tile delivers
// 0.93 m patches — plume scale, not the 0.29 m lace the carve's fine tap
// carries. Non-harmonic with both carve tiles (5.3/3.681 = 1.44, 17/5.3 = 3.21).
const BUB_TILE = 5.3;
const BUB_LOD_MIN = 3.0; // Crest forces mip 3 so the layer reads as cloud, not lace
// plume = clamp(1 + C*(bub - mean)/std, 0, 1.9). Mean preserved at exactly 1,
// so the texture cannot move average aeration; +/-2 sigma give 1.90 and 0.10, a
// torn cloud that closes to nothing in its low tail. NOT saturate(): saturate
// would clip the whole upper tail to a flat 1.0 — half the texture — and drop
// the mean to 0.82. `aer` is saturated AFTER the multiply instead, which is
// mandatory: an unclamped weight of 1.18 makes mix() EXTRAPOLATE, and over a
// glint at 3.0 linear that returns negative radiance into the tonemapper.
// Degrades to exactly 1.0 when a grazing footprint flattens the tap.
const BUB_CONTRAST = 0.45;
const BUB_PLUME_MAX = 1.9;
// The apron: the SAME dissolve field, one threshold lower and one window wider
// — the Sea of Thieves read that the trail is the same substance as the cap,
// only diffused and at lower alpha, never a separate hard-edged texture.
// 1.6 sigma down puts the onset at the field's own mean about where the white
// cap first becomes visible, so a fold too weak to whiten still lays down grey.
// Stated in the SHIPPED composite's sigma (0.1328*hypot(0.62,0.38) = 0.0966),
// which is what the carve is contrast-matched to.
const APRON_DROP = 1.6 * 0.1328 * Math.hypot(0.62, 0.38); // 0.1545
const APRON_SPAN = 2 * 0.15; // the low end of the dossier's "scud: 2-3x wider"
const APRON_COV_GAIN = 2 * 2.4; // full strength at cov 0.208 vs the white's 0.417
// A thin translucent film is an alpha lerp at LOW opacity, never a replacement:
// the dark water and its roughened specular have to read through the holes.
// Composited toward an 18%-reflectance tone this both LIFTS dark water and
// DARKENS a glinting or sky-bright pixel, which is the scud-over-dark-water
// case, and the alpha lerp does it with no branch and no second BRDF.
const APRON_ALPHA = 0.40;
// ...faded out past the coarse field's own feature diameter (0.176*17 m). The
// carve mip-flattens to CARVE_MEAN with distance while the apron's threshold
// keeps sliding down with cov, so without this the tail survives from cov 0.087
// where the white needs 0.455 and paints a structureless grey veil over the far
// sea — the snowfield failure params.js already calls out.
const APRON_FOOT = 3.0;
// Floor under the film's occlusion. litScud carries skyVis*groupOcc, which in a
// trough floors at 0.34*0.50 = 0.17 — so without this the trail would vanish in
// exactly the hollows where real scud collects. Not removed entirely: the
// occlusion is what keeps a film in a hollow from reading as white paint on
// dark water.
const SCUD_OCC_MIN = 0.45;

export function createOceanSurfaceMaterial(cascades, { lengthScales, shading, detailTex }) {
  const mat = new MeshBasicNodeMaterial();
  // Plane is authored in XY and remapped to XZ in positionNode, flipping the
  // winding — render both sides so it's visible from above too.
  mat.side = DoubleSide;
  // ...and the water composites its own aerial perspective, at the very end of
  // colorNode, so it has to opt out of scene.fogNode — see HAZE_DENSITY.
  mat.fog = false;
  // The mesh is a finite tile that gets recentred under the camera; adding its
  // offset here keeps every map lookup in true world space, so the wave field
  // stays put while the tile slides over it.
  const worldXZ = vec2(positionGeometry.x, positionGeometry.y).add(shading.originXZ);
  // Resolve the sea palette once — see SEA. Each of these is used exactly once
  // downstream, so this is six mix() nodes in the graph and not a fetch, a
  // branch or a variant.
  const sea = Object.fromEntries(
    Object.entries(SEA).map(([k, [g, b]]) => [k, mix(g, b, shading.palette)]),
  );
  const satBoost = mix(float(SAT_BOOST[0]), float(SAT_BOOST[1]), shading.palette);

  mat.positionNode = Fn(() => {
    // The macro amplitude envelope — see ampEnvelope in foamShading.js. The
    // two wave-carrying cascades scale by the local sea energy, so the 1024 m
    // and 144 m tile repeats stop being identical copies. Cascade 2 is 24 m
    // ripple no altitude can read; it stays flat.
    const env = ampEnvelope(detailTex, worldXZ).toVar();
    const disp = vec3(0).toVar();
    cascades.forEach((c, i) => {
      const d = texture(c.displacement, worldXZ.div(lengthScales[i])).level(0).xyz;
      disp.addAssign(i <= 1 ? d.mul(env) : d);
    });
    return vec3(positionGeometry.x.add(disp.x), disp.y, positionGeometry.y.add(disp.z));
  })();

  mat.colorNode = Fn(() => {
    const t = shading.time;
    const UP = vec3(0, 1, 0);

    // --- band-limited normal ------------------------------------------------
    // fwidth of the *sampling* coordinate is the true world footprint of this
    // pixel, grazing foreshortening included. Turn that into a mip level per
    // cascade and the tap becomes the correct average over the pixel — no
    // bilinear lottery, so no per-pixel speckle and no cascade-1 texel grid
    // printing as hard-edged cells across the mid-field. What is left of a
    // cascade once the mip chain has averaged it flat is then faded out of the
    // normal and banked as roughness: a Toksvig/LEAN trade, geometry below the
    // pixel becoming a wider lobe.
    const footprint = max(fwidth(worldXZ.x), fwidth(worldXZ.y)).max(1e-3).toVar();

    // same envelope as positionNode — the normal must belong to the geometry
    const envC = ampEnvelope(detailTex, worldXZ).toVar();
    const d = vec4(0).toVar();
    const lostVar = float(0).toVar();
    cascades.forEach((c, i) => {
      const texelM = lengthScales[i] / c.N;
      const lod = log2(footprint.div(texelM)).max(0);
      const s0 = texture(c.derivatives, worldXZ.div(lengthScales[i])).level(lod).toVar();
      const s = (i <= 1 ? s0.mul(envC) : s0).toVar();
      const w = saturate(float(lengthScales[i] / FEATURE_DIV).div(footprint)).toVar();
      d.addAssign(s.mul(w));
      lostVar.addAssign(s.x.mul(s.x).add(s.y.mul(s.y)).mul(float(1).sub(w.mul(w))));
    });
    const slopeX = d.x.div(float(1).add(d.z));
    const slopeZ = d.y.div(float(1).add(d.w));
    const N = normalize(vec3(slopeX.negate(), float(1), slopeZ.negate())).toVar();

    // Sub-grid capillary ripple, differenced out of the noise texture's HEIGHT
    // channels rather than read from its packed slope — see RIPPLE_TILE above
    // for why the packed slope is unusable. Three taps at one scale carry two
    // octaves, because A is the same field at twice B's frequency. Everything
    // here is capillary-scale on purpose: at a 17 m period this read as smooth
    // marbled swirls sliding over the surface — an oil slick, not water.
    // Ripples have to be smaller than the wave they ride on.
    const rippleGrad = (scale, drift) => {
      const uv = worldXZ.mul(scale).add(drift).toVar();
      const e = float(RIPPLE_STEP);
      const c0 = texture(detailTex, uv).toVar();
      const cx = texture(detailTex, uv.add(vec2(e, 0))).toVar();
      const cy = texture(detailTex, uv.add(vec2(0, e))).toVar();
      // xy is the ripple slope off the HEIGHT channels, unchanged. zw is the
      // foam micro-relief slope off the CELLULAR pair, from these same three
      // taps and therefore free — see FOAM_RELIEF_FINE. High cellular means far
      // from a feature point, so with the same sign convention as xy the walls
      // between bubbles stand proud and the holes sit low, which is the same
      // low tail detailTexture.js already earmarks for foam holes. Differencing
      // also means the baked TARGET_MEAN cancels exactly, so a weighted sum of
      // DIFFERENCES has mean 0 by construction whatever the weights.
      return vec4(
        cx.b.sub(c0.b).add(cx.a.sub(c0.a).mul(RIPPLE_FINE)),
        cy.b.sub(c0.b).add(cy.a.sub(c0.a).mul(RIPPLE_FINE)),
        cx.r.sub(c0.r).add(cx.g.sub(c0.g).mul(FOAM_RELIEF_FINE)),
        cy.r.sub(c0.r).add(cy.g.sub(c0.g).mul(FOAM_RELIEF_FINE)),
      ).toVar();
    };
    // Two octaves an octave-and-a-bit apart, each fading out at its own
    // footprint. One alone is not enough: at a metre from the lens the coarse
    // set is the only thing on the surface and it reads as slow marbled swirls
    // sliding over the water — an oil slick. The fine set is what a metre of
    // water in front of your face actually has on it.
    const fadeA = saturate(float(RIPPLE_FOOT).div(footprint)).toVar();
    const fadeB = saturate(float(RIPPLE_FOOT / RIPPLE_OCT).div(footprint)).toVar();
    const gradA = rippleGrad(RIPPLE_TILE, vec2(t.mul(0.035), t.mul(0.022)));
    const gradB = rippleGrad(RIPPLE_TILE * RIPPLE_OCT, vec2(t.mul(-0.09), t.mul(0.06)));
    const detail = gradA.xy.mul(fadeA).add(gradB.xy.mul(RIPPLE_OCT_AMP).mul(fadeB))
      .mul(RIPPLE_GAIN).mul(shading.detail).toVar();
    // The foam micro-relief slope rides the same two tap sets and, because the
    // cellular feature diameters were matched to the fbm channels beside them,
    // the same two footprint fades — weighted the other way round, fine set
    // leading, because 3.5-8 cm is bubble scale. Normalised to unit
    // per-component rms so the use site can be written in sigma. Grazing
    // degradation is free: fadeA/fadeB are built from the same anisotropy-aware
    // footprint as everything else here, and a mip-flattened cellular tap
    // differences to exactly 0, so the failure mode is "no relief", not
    // garbage. Deliberately NOT scaled by shading.detail: that dial is the
    // water's own capillary ripple (default 0.1, essentially a dither) and foam
    // relief is a different physical thing that must not switch off with it.
    const reliefGrad = gradB.zw.mul(fadeB)
      .add(gradA.zw.mul(FOAM_RELIEF_OCT).mul(fadeA)).mul(FOAM_RELIEF_NORM).toVar();
    // The texture has mips so it self-filters; these fades are only so the slope
    // they lose lands in the roughness budget like everything else.
    lostVar.addAssign(shading.detail.mul(shading.detail)
      .mul(float(2).sub(fadeA).sub(fadeB)).mul(0.35));
    N.assign(normalize(N.add(vec3(detail.x.negate(), 0, detail.y.negate()))));

    // --- roughness ----------------------------------------------------------
    // Variances add, so roughness combines in quadrature: a floor that keeps a
    // minimum lobe width, the slope variance we just threw away, and a straight
    // footprint term so far water still goes broad where it happens to sample
    // flat (a calm trough at 3 km must not turn back into a mirror).
    const rough = min(sqrt(
      float(ROUGH_FLOOR * ROUGH_FLOOR)
        .add(lostVar.mul(ROUGH_FROM_VAR))
        .add(saturate(footprint.mul(ROUGH_FOOT_SCALE)).mul(ROUGH_FROM_FOOT)),
    ), float(ROUGH_MAX)).toVar();

    const V = normalize(cameraPosition.sub(positionWorld)).toVar();
    const viewDist = length(cameraPosition.sub(positionWorld)).toVar();
    const NoV = saturate(dot(N, V)).toVar();

    const fres = fresnelDielectric(NoV, float(ETA_AW)).toVar();
    // Kept before the art direction below touches it, because the sun glitter
    // has to ride on the REAL reflection coefficient. REFL_NEAR is a hold-back
    // on the *sky* — it exists so a deck camera keeps its water colour at
    // grazing angles — and multiplying the glitter by it as well meant the
    // brightest thing in the sky was reflected at a fifth strength precisely
    // where the path should be at its most intense. That is most of why looking
    // down the sun's azimuth produced a flat wash with no road in it.
    const fresSpec = fres.toVar();
    // Near water keeps only part of that mirror so the body colour survives the
    // grazing angles a deck-height camera sees everything at; the far field is
    // then released and pushed the other way, because at a kilometre the shading
    // normal is an average over square metres of slope and an averaged sheet is
    // flatter — and so more mirror-like — than the water actually is.
    const distF = saturate(viewDist.div(GRAZE_RANGE)).toVar();
    fres.mulAssign(mix(float(REFL_NEAR), float(1), distF));
    fres.assign(mix(fres, float(1), distF.mul(GRAZE_AMOUNT)));
    // ...but never all of it. A hard ceiling is the only thing that guarantees
    // the far band keeps its own hue, and it is what puts a colour difference
    // under the horizon line instead of a value difference alone.
    fres.assign(min(fres, float(REFL_CEIL)));

    // --- sky reflection -----------------------------------------------------
    // As roughness rises the mirror ray relaxes toward the flat-water direction,
    // which is what a wide lobe averages out to.
    const Rm = reflect(V.negate(), N);
    const R = normalize(mix(Rm, reflect(V.negate(), UP),
      saturate(rough.mul(REFL_RELAX)).mul(REFL_RELAX_MAX))).toVar();
    // A steep fold throws that ray *below* the horizon. Mirroring it back up
    // (abs) sends it to the zenith — and the zenith is a saturated indigo, which
    // is exactly the blue dashes that were printing on wave faces. Instead the
    // elevation is floored at the horizon while the azimuth is kept, and the ray
    // is rebuilt unit-length from the two, so a sub-horizon fold lands in the
    // same pale grazing band its neighbours already use and nothing degenerates
    // when the ray points straight down.
    // A flat floor is not enough on its own, though: it collapses EVERY
    // sub-horizon fold onto one elevation, and that elevation sits in the
    // narrow warm haze band, so a whole population of steep facets came back
    // carrying the same sand-orange and printed as olive dashes on green wave
    // faces. Folding the ray instead — max() against a shallow line through the
    // negatives — is continuous, keeps a floor at the line, and sends genuinely
    // downward rays up into the pale blue above the band where they belong.
    const azN = normalize(vec2(R.x, R.z).add(vec2(1e-4, 1e-4))).toVar();
    const elev = R.y.max(R.y.mul(-0.35).add(0.007)).toVar();
    const flat = sqrt(saturate(float(1).sub(elev.mul(elev)))).toVar();
    const refl = skyColor(vec3(azN.x.mul(flat), elev, azN.y.mul(flat)), shading).toVar();
    // Below the line there is no sky to reflect, only more water, which is far
    // darker than the haze band — fade the sample down rather than pasting a
    // bright horizon on a downward-facing fold.
    refl.mulAssign(float(1).sub(saturate(R.y.negate().mul(5)).mul(0.6)));
    // A rough facet cannot hold the mirror image of a point source: compress
    // reflected radiance above 1 in proportion to roughness, so the sky's sun
    // disc stops printing single-pixel sparks on distant water. Everything
    // below 1 (the gradient, and whatever the sky lane adds) passes untouched.
    const peak = max(max(refl.x, refl.y), refl.z);
    refl.mulAssign(float(1).div(float(1).add(max(peak.sub(1), 0).mul(rough.mul(GLINT_CLAMP)))));
    // A rough facet's "reflection" is not only the mirror: some of it is light
    // that entered, scattered a wave-width inside the water and came back out,
    // and that path is filtered by the sea. Biasing the rough end of the
    // reflection toward the water's own transmission is what stops the warm
    // horizon band printing as a tan film over mid-distance chop.
    refl.mulAssign(mix(vec3(1), REFL_FILTER, rough));
    // ...and a much harder one on whatever came out of the haze band — see
    // REFL_BAND. A hue shift alone is not enough there: the band is saturated
    // sand-orange, and any amount of it on green water grades to olive, so what
    // has to go is its CHROMA. Keyed on the reflected ray's own elevation, so it
    // releases within the band's own width and cannot touch the blue overhead.
    const bandF = float(1).sub(saturate(elev.mul(REFL_BAND_ELEV))).mul(0.4).add(0.6).toVar();
    const warm = saturate(refl.x.sub(refl.z).mul(REFL_WARM_GAIN)).toVar();
    const bandL = dot(refl, vec3(0.2126, 0.7152, 0.0722)).toVar();
    // ...but NOT the sun itself, and that exemption is the whole reason the
    // glitter road used to read as chrome under a golden sky. This term keys on
    // "is the reflection warm", and it cannot tell the two warm things in the
    // dome apart: the sand-coloured haze band, which genuinely does grade to
    // olive on green water and is what this was written for, and the solar disc,
    // which is warm because it is the light source. Pulling the second one 48%
    // toward REFL_BAND — a deliberately COOL silver — was repainting the sun.
    //
    // Magnitude separates them cleanly. The haze band never clears the HDR knee
    // in sky.js, so it arrives at a luminance under half; the reconstructed disc
    // arrives an order of magnitude above. Full strength below 1, released to
    // nothing by 3, so the band is treated exactly as before and the sun is left
    // the colour the sky says it is.
    const notSun = saturate(float(3.0).sub(bandL).mul(0.5)).toVar();
    refl.assign(mix(refl, REFL_BAND.mul(bandL), warm.mul(bandF).mul(REFL_BAND_DESAT).mul(notSun)));
    // ...and the same argument applies to its *chroma*. A single mirror tap of a
    // high-contrast sky is a point sample of something the facet actually
    // integrates over several degrees, so a chop ripple that happens to aim at
    // a hole between clouds prints the zenith's saturated indigo as an isolated
    // dash on a wave face. The integral over the lobe is a mixture, and mixtures
    // desaturate: pulling the sample toward its own luminance in proportion to
    // roughness is that, for free, and it takes the blue dashes with it while
    // leaving the value structure — which is the part that reads as water —
    // completely intact.
    // The grey it averages toward is a COOL grey, not a neutral one. Neutral is
    // the trap: luminance is 72% green, so desaturating a warm cloud lands on a
    // khaki that reads as dirt floating on the sea. Biasing the grey point blue
    // means a washed-out reflection can only ever be silver.
    // Capped, though. The cap is the difference between "a rough facet
    // integrates over its lobe" and "the ocean is grey": at full strength every
    // pixel past roughness 0.556 sat on the chroma floor, and ROUGH_MAX is
    // 0.60, so that was the entire sea.
    const reflL = dot(refl, vec3(0.2126, 0.7152, 0.0722));
    refl.assign(mix(refl, mix(REFL_GREY.mul(reflL), refl, float(REFL_CHROMA)),
      saturate(rough.mul(REFL_DESAT)).mul(REFL_DESAT_CAP)));
    // ...and the same argument per PIXEL: where the normal varies fast inside
    // one pixel (ripple contours at grazing), a single mirror tap is a point
    // sample of a lobe integral — pull it toward its own luminance-grey before
    // it can print the warm haze band as magenta grains on dark water.
    const nVarR = fwidth(N.x).add(fwidth(N.z)).toVar();
    refl.assign(mix(refl, REFL_GREY.mul(reflL), saturate(nVarR.mul(2.5)).mul(0.55)));

    // --- body: real value range from trough floor to crest lip ---------------
    // The depth proxy is height above mean sea level through a soft ramp:
    // x/(|x|+k) is monotonic and asymptotic, so however tall a crest gets the
    // colour keeps moving and never lands on a ceiling. Two crests of different
    // height are therefore two different colours, which is the whole point.
    const hN = positionWorld.y.div(WAVE_SCALE).toVar();
    const lift = hN.div(abs(hN).add(HEIGHT_SOFT)).mul(0.5).add(0.5).toVar();
    const facing = saturate(dot(N, UP)).toVar();

    // --- the wave form, read at two scales -----------------------------------
    // Two probes of the displacement map per wave-carrying cascade: one at the
    // pixel's own mip level, one at whatever level blurs it over about
    // CREST_RADIUS metres of sea. Their difference is how far this point stands
    // proud of the water around it — a lip detector that costs two taps and no
    // thresholds, positive at a crest, zero on a plateau, negative in a trough,
    // and continuous everywhere because it is a difference of two smooth fields.
    // The sharp tap of cascade 0 on its own is the swell: the blurred sea level
    // the chop rides on, and an axis of value independent of both height and
    // facing (see GROUP_SCALE).
    const swellH = float(0).toVar();
    const crestRel = float(0).toVar();
    cascades.forEach((c, i) => {
      if (i > 1) return; // the 14 m ripple has nothing to say about wave form
      const L = lengthScales[i];
      const texelM = L / c.N;
      const lod = log2(footprint.div(texelM)).max(0).toVar();
      const blur = Math.max(0, Math.log2(CREST_RADIUS / texelM));
      const here = texture(c.displacement, worldXZ.div(L)).level(lod).y.mul(envC).toVar();
      const wide = texture(c.displacement, worldXZ.div(L)).level(lod.max(float(blur))).y.mul(envC);
      crestRel.addAssign(here.sub(wide));
      if (i === 0) swellH.assign(here);
    });
    const gN = swellH.div(GROUP_SCALE).toVar();
    const group = gN.div(abs(gN).add(GROUP_SOFT)).mul(0.5).add(0.5).toVar();
    // ...and what is left once the swell is subtracted is the chop's own height,
    // which is high on a chop crest even when the whole group is in a hollow.
    // softPos() is a smooth max(x, 0): the ramps below all want "how far above
    // this reference", and a bare max() creases at zero, which prints as an
    // iso-contour drawn across the sea in exactly the way this file spends most
    // of its length trying to avoid. sqrt(x^2 + k^2) rounds the corner off over
    // a band of width k and costs one instruction.
    const softPos = (x, k) => x.add(sqrt(x.mul(x).add(k * k))).mul(0.5);
    const chopS = positionWorld.y.sub(swellH).div(1.6).toVar();
    const chopP = softPos(chopS, 0.30).toVar();
    const chop = chopP.div(chopP.add(1.0)).toVar();
    // Thickness, as one number reused by every term that wants "thin water":
    // how far this point stands proud of the sea within a few metres of it,
    // through the same asymptotic knee. Never clamped, so a lip is a run down
    // the wave face and not a plateau with a contour round it.
    // The knee came down from 0.40, and it was a measured floor rather than a
    // taste change. softPos(0, k) is k/2, so on dead-flat water crestP was 0.20
    // and thinP was 0.20/0.90 = 0.222 — a 22% "thinness" on water that stands
    // proud of nothing at all, i.e. the glow could never switch off anywhere.
    // The comment below claiming thinP "is zero in a trough" was wrong: it was
    // 0.09 in a trough and 0.22 on a plateau, which is most of why the effect
    // read as an even wash. 0.15 puts the flat-water floor at 0.097. The wide
    // knee was there to soften a lobe that had no directional gating of its own;
    // the entry cosine below now does that job properly.
    const crestN = crestRel.div(SSS_DEPTH).toVar();
    const crestP = softPos(crestN, 0.15).toVar();
    const thinP = crestP.div(crestP.add(0.70)).toVar();

    // The water mass carries its own colour, wandering on a scale far longer
    // than the waves — depth, turbidity, plankton. Without it every patch of sea
    // at a given height is the same value and the field reads as a height key
    // rather than a body of water.
    // Three octaves, not two. The longest is depth and turbidity; the middle one
    // varies within a wave group; the shortest exists because a deck camera
    // spends half the frame on ONE swell face ten metres away, where the other
    // two are constants — and a ten-metre patch of sea at one flat value is the
    // moulded-plastic look however good the normal on it is.
    const mass = texture(detailTex, worldXZ.mul(MASS_SCALE).add(vec2(t.mul(0.0016), t.mul(-0.0011)))).b
      .add(texture(detailTex, worldXZ.mul(MASS_NEAR).add(vec2(t.mul(-0.01), t.mul(0.008)))).b.mul(0.6))
      .add(texture(detailTex, worldXZ.mul(MASS_FINE).add(vec2(t.mul(0.02), t.mul(0.03)))).a.mul(0.30))
      .div(1.9).sub(0.5).mul(MASS_AMOUNT).toVar();
    // Asymptotic, NOT saturate(). This is the line that drew the paint-by-
    // numbers coastlines: saturate(mass * 1.2 + 0.18) pinned every point below
    // mass = -0.15 to exactly the body swatch, so half the near field was one flat
    // colour with a one-pixel staircase where it started to move again. x/(|x|+k)
    // has the same shape and the same range and can never reach either end.
    const massT = mass.div(abs(mass).add(MASS_SOFT)).mul(0.5).add(0.5).toVar();
    // ...and the same wander picks the water TYPE, so a patch that is painted
    // as deeper, clearer water also transmits like it. One noise field, two
    // consistent consequences, instead of a colour swatch that knows nothing
    // about the transmittance sitting next to it. massT runs 0 = body toward
    // 1 = abyss, and deep water is the clear end, hence the argument order.
    const muWater = mix(MU_TURBID, MU_CLEAR, massT).toVar();
    // The deep anchor keeps some green in it: the palette's deep swatch is a
    // near-black navy, and letting the wander run all the way to it turned the
    // shadowed troughs slate-grey instead of the green-black a warm sea has.
    const abyss = mix(vec3(shading.deepColor), sea.abyss, float(0.65)).toVar();
    const deepBody = mix(sea.body, abyss, massT).toVar();
    // A second, independent axis: hue rather than value. Depth alone gives one
    // colour getting darker; a real sea also swings between blue-green over
    // deep water and a greener cast where it is shallower or richer, and having
    // that on its own frequency is what stops the wander reading as a single
    // grey-scale field tinted teal.
    const hue = texture(detailTex, worldXZ.mul(MASS_HUE).add(vec2(t.mul(-0.0022), t.mul(0.0017)))).a
      .sub(0.5).mul(2.2).toVar();
    deepBody.assign(mix(deepBody, sea.bodyBlue,
      hue.div(abs(hue).add(0.9)).mul(0.5).add(0.5).mul(MASS_HUE_AMOUNT)));

    // trough floor -> body -> thin lit crest, as one continuous run.
    // Also asymptotic — see BODY_BIAS. The smoothstep this replaces reached its
    // ceiling at mean sea level, which made the whole upper half of the sea one
    // flat card and drew a horizontal contour under it.
    const hB = hN.add(BODY_BIAS).toVar();
    const rise = hB.div(abs(hB).add(BODY_SOFT)).mul(0.5).add(0.5).toVar();
    const body = mix(sea.trough, deepBody, rise).toVar();
    // Thin water reads shallow where the water IS thin — which is the measured
    // quantity two lines up, not the surface's facing. Gating on facing had the
    // effect exactly inside out: a 75-degree overhanging lip, the one place the
    // whole cue exists for, ran the tint at 42% while flat water ran it at
    // 100%. Facing survives only as a weak trim, enough to stop a trough floor
    // lighting up, nothing like a gate.
    const shIn = lift.sub(0.46).mul(2.0).add(thinP.mul(1.6)).add(chop.mul(0.8)).toVar();
    const shP = softPos(shIn, 0.22).toVar();
    const shallow = shP.div(shP.add(1.0)).mul(SHALLOW_MAX)
      .mul(mix(float(0.30), float(1.0), thinP))
      .mul(float(0.85).add(facing.mul(0.15))).toVar();
    // The crest tint keeps the palette uniform in play so the GUI still bites,
    // pulled toward a more saturated turquoise than a mid teal swatch can give.
    body.assign(mix(body, mix(vec3(shading.scatterColor), sea.crest, float(0.72)), shallow));

    // Down in a trough the water only sees a slot of sky between the walls
    // around it; on a crest it sees the whole dome. This is what stops the
    // frame collapsing to one mid-tone — it darkens body and reflection alike.
    const skyVis = float(SKY_VIS_MIN).add(saturate(lift.mul(1.15)).mul(float(1).sub(SKY_VIS_MIN))).toVar();
    // The wave group's own occlusion, on its own axis. Deep inside a swell
    // hollow the surrounding water cuts the sky down whatever this point's own
    // height and facing are doing, and a chop crest standing on the group wins
    // some of it back. Without a term that is independent of (height, facing),
    // every quantity in the value chain pins to a constant on a flat foreground
    // patch and the hero wave face comes out a featureless card.
    const groupOcc = float(1).sub(float(GROUP_DARK).mul(float(1).sub(group)))
      .add(chop.mul(CHOP_LIFT).mul(float(1).sub(group))).toVar();
    // Sky ambient (a flat sheet sees the whole dome, a steep face a slice of it)
    // and then a wrapped sun term: faces turned away fall into a cool shadow
    // instead of a hard terminator, and that split does most of the value range.
    const sunWrap = pow(saturate(dot(N, shading.sunDir).mul(0.55).add(0.45)), float(1.7)).toVar();
    // Thin water does not obey a lambert on its own surface normal — light
    // arrives through it from behind, so the more of it there is the less the
    // ambient and the terminator are allowed to darken it. Without this the
    // crest tint is mixed in at full strength and then immediately halved by
    // the two attenuations, because a lip is by definition the steepest, most
    // side-lit part of the wave: the brightest colour in the palette was
    // reachable only on flat water, where nothing is thin.
    const amb = mix(float(0.36).add(facing.mul(0.64)), float(0.72).add(facing.mul(0.28)), thinP).toVar();
    body.mulAssign(amb.mul(skyVis).mul(groupOcc));
    // The sunlit half is lifted mostly in value, not in hue: multiplying deep
    // green water by a saturated warm light turns it olive, and olive is the one
    // colour a tropical sea must never be. But half-white was too much of a
    // hedge — under a sun the sky measures at 1.00 / 0.83 / 0.58 the sunlit
    // water was being lit by 1.00 / 0.81 / 0.63, so the sea disagreed with its
    // own sky. The white share comes down to a bit over a quarter and the gain
    // goes up to exactly compensate: 1.26 is (luminance at 0.50 white) / (at
    // 0.28), so this is a pure hue change and the value chain above it is
    // untouched. Olive is still the thing to watch for on the sunlit shoulder
    // of a swell — if it appears, raise the white share, not the gain.
    const ambC = vec3(shading.ambient).toVar();
    const shadowTint = ambC.div(max(dot(ambC, vec3(0.2126, 0.7152, 0.0722)), float(1e-4)))
      .mul(SHADOW_LUM).toVar();
    body.mulAssign(mix(shadowTint, mix(vec3(shading.sunColor), vec3(1), float(0.28)).mul(1.26),
      saturate(sunWrap.add(thinP.mul(0.35)))));
    // Single scattering, added rather than multiplied — see SEA.scatter. Every
    // other path to brightness in this file is either an attenuation of a dark
    // swatch or a reflection of the sky, so the frame's value histogram was
    // bimodal with a hole from 0.15 to 0.45 linear and the sea had no turquoise
    // anywhere. This is sun energy coming back OUT of the water: view-
    // independent, so it lights the whole sunlit shoulder of a swell, gated on
    // the measured thinness so a lip gets three times what a trough floor does,
    // and multiplied by the group occlusion so a hollow stays dark.
    const sunN = saturate(dot(N, shading.sunDir)).toVar();
    body.addAssign(sea.scatter.mul(vec3(shading.sunColor)).mul(sunN)
      .mul(mix(float(SCATTER_BASE), float(1), thinP)).mul(groupOcc).mul(SCATTER_GAIN));
    refl.mulAssign(float(0.55).add(skyVis.mul(0.5)));

    // --- subsurface scatter -------------------------------------------------
    // Light that entered the FAR side of the wave, crossed it, and came out
    // toward the eye. Three things have to line up and the old form only had
    // one and a half of them:
    //
    //   1. light has to get IN, through the face you cannot see;
    //   2. having scattered, it has to come out toward the CAMERA;
    //   3. the water it crossed has to be thin enough to let it.
    //
    // What was here was a single DICE-style wrap lobe,
    // pow(saturate(dot(V, -normalize(sunDir + N*0.9))), 1.6), doing all three at
    // once through one authored "distortion" constant — and it had the sign of
    // (1) inside out. Evaluated against this scene's own sun (az 122.8, el 11.2)
    // and a deck camera it returned 0.79 on the far face turned toward the sun,
    // the one surface whose light cannot reach the eye at all, 0.48 on flat
    // water, and 0.18 on the near-vertical backlit wall the whole effect exists
    // for. It was four and a half times brighter on the wrong facet than on the
    // right one, which is why the cue read as a green wash over the sunward half
    // of the sea rather than as light coming through a crest.
    //
    // Split into the three factors it always was:
    //
    // (1) The far face's outward normal is -N, so the cosine of incidence there
    // is -dot(N, sunDir). That one quantity replaces SSS_DISTORT entirely: it is
    // negative — clamped to zero — on every front-lit facet by construction, and
    // ~0.98 on a wall lit from behind. No constant to tune, and it cannot be
    // pointed the wrong way without the glow visibly vanishing.
    const cosIn = saturate(dot(N, shading.sunDir).negate()).toVar();
    // ...and only some of the sun gets in at all. At this sun's elevation the
    // interface rejects 31% of it before any of this starts, and at grazing
    // incidence on a steep face far more. This is the physical replacement for
    // sssStrength having to carry an entry term it knew nothing about.
    const Tin = float(1).sub(fresnelDielectric(cosIn, float(ETA_AW))).toVar();
    // (2) The exit lobe is the volume's phase function and NOTHING else. A phase
    // function is a property of the medium: it depends only on the angle between
    // where the light was going and where the eye is, and it has no opinion about
    // the surface normal. Folding N into it, as the old form did, is what made
    // the term fire on geometry rather than on light.
    const fwd = hgForward(SSS_G, saturate(dot(V, shading.sunDir.negate()))).toVar();
    // (3) Path length, in metres, and refracted. The view ray bends at the
    // surface, so the distance it travels through a sheet of thickness t is
    // t/cos(theta_t) — bounded at 1.50x by the critical angle, which is why this
    // is a real term and not an unbounded one. thinP is a proudness measure, so
    // the path SHORTENS as it rises: LIP_TIP is the thin end.
    const cosT = sqrt(float(1).sub(float(ETA2).mul(float(1).sub(NoV.mul(NoV))))).toVar();
    const lipD = mix(float(LIP_BASE), float(LIP_TIP), thinP).div(max(cosT, float(0.1))).toVar();
    // Diffusion transmittance over that path, not beam extinction. At a single-
    // scattering albedo near 0.9 most of the light arriving has scattered
    // several times, so it diffuses rather than travelling straight, and the
    // transport coefficient is the right one — see water.js. This is the term
    // that used to be a pair of authored swatches with a blend between them: a
    // thin lip lands on a warm near-white and a metre further down the face on a
    // jade green, off one exponential.
    const Tvol = exp(muWater.mul(lipD).negate()).toVar();
    // Thickness, measured rather than inferred — thinP, built above out of the
    // sharp-minus-blurred displacement, so it is largest exactly at a lip and
    // falls off continuously down the face over a metre or two. The height term
    // on the end is a gentle bias that keeps a chance ridge on the floor of a
    // deep trough from lighting up; it is a bias, not a gate, and it never clamps.
    const thin = thinP.mul(float(0.25).add(lift.mul(0.90))).toVar();
    // Input to the knee peaks a little under 2, where x/(x+1) is still climbing:
    // the glow stays a gradient over the whole face instead of clipping to a
    // flat patch of one green. The gain is unchanged from the old lobe on
    // purpose — hgForward is peak-normalised, so the number the knee sees still
    // tops out at the same place and the tuning carries over.
    const sss = fwd.mul(cosIn).mul(Tin).mul(thin).mul(shading.sssStrength).mul(SSS_GAIN).toVar();
    const glow = Tvol.mul(shading.sunColor).mul(sss.div(sss.add(1)).mul(SSS_MAX)).toVar();

    // One energy-conserving split: what is not reflected is transmitted, and
    // everything coming out of the water — body colour and subsurface glow
    // alike — is on the transmitted side of it.
    //
    // The glow used to be divided 45/55 between "under the Fresnel" and "on top
    // of it, at 1 - fres*0.5", with a component-wise body floor underneath the
    // lot. That existed because Schlick with the bent exponent reached 0.43 at
    // the grazing angles you actually view a backlit crest from, which killed
    // the glow at exactly the wrong moment; exact Fresnel is 0.31 there, so
    // there is nothing left to compensate for. The floor goes with it — REFL_CEIL
    // already guarantees the sea keeps 14% of its own colour in the mix.
    const water = mix(body.add(glow), refl, fres).toVar();
    // A deliberate chroma push, on the water and nothing else — see SAT_BOOST.
    // It sits here rather than on the finished pixel because foam and glitter
    // are white by intent, and extrapolating a white away from its own luminance
    // only ever finds a colour cast to exaggerate.
    const waterL = dot(water, vec3(0.2126, 0.7152, 0.0722));
    water.assign(max(mix(vec3(waterL), water, satBoost), vec3(0)));

    // --- sun glitter --------------------------------------------------------
    // One GGX lobe against the sun, rolled off through a knee instead of
    // clamped: the peak saturates smoothly however narrow the lobe gets, so
    // there are no fireflies, and because roughness grows with distance the
    // path widens and softens toward the horizon on its own.
    const Hv = normalize(V.add(shading.sunDir));
    // The lobe rides on a roughness that keeps widening with distance, so the
    // path broadens toward the horizon rather than breaking up into whichever
    // far facets happen to line up. It also widens with the normal's own
    // per-pixel variance — specular AA, see SPEC_AA_VAR: a facet whose normal
    // swings inside one pixel cannot hold a narrow lobe, and letting it try is
    // what printed the warm speckle tracing wave contours in the away shots.
    const nVar = fwidth(N.x).add(fwidth(N.z)).toVar();
    // Foam raises roughness (ATLAS; War Thunder's energy-modulated milkiness is
    // the same idea in the refraction term): a bubble film is a diffuse
    // scatterer, so glints over foam broaden and dim rather than mirroring the
    // sun. Nearly free and missing from most hobby ocean renderers. Read at a
    // coarse mip from the mid cascade — this only needs to know "is there foam
    // around here", and it is wanted BEFORE the foam block computes coverage.
    const foamRough = saturate(shading.foamThreshold.sub(
      texture(cascades[1].displacement, worldXZ.div(lengthScales[1])).level(float(3)).w)
      .mul(shading.foamScale)).toVar();
    const roughSpec = min(max(sqrt(rough.mul(rough)
      .add(saturate(viewDist.div(SPEC_SPREAD_RANGE)).mul(SPEC_SPREAD))
      .add(saturate(nVar.mul(SPEC_AA_VAR)).mul(0.06))
      .add(foamRough.mul(0.22))),
    float(SPEC_ROUGH_MIN)), float(SPEC_ROUGH_MAX)).toVar();
    const a2 = roughSpec.mul(roughSpec).mul(roughSpec).mul(roughSpec).toVar();
    const NoH = saturate(dot(N, Hv)).toVar();
    const den = NoH.mul(NoH).mul(a2.sub(1)).add(1);
    const ggx = a2.div(den.mul(den).mul(PI)).mul(saturate(dot(N, shading.sunDir))).toVar();
    // ...and the same variance desaturates the tint: the average over a fast-
    // swinging lobe is a mixture, and mixtures are never the saturated warm of
    // any single mirror sample.
    const stBase = mix(vec3(shading.sunColor), vec3(1), float(SPEC_WHITE)).toVar();
    const stL = dot(stBase, vec3(0.2126, 0.7152, 0.0722));
    const specTint = mix(stBase, vec3(stL), saturate(nVar.mul(3)).mul(SPEC_AA_DESAT));
    // The broad lobe is CAPTURED rather than added straight into the water,
    // because the foam block below needs it separately: an aged ~1 mm film lets
    // the water's own mirror back through and a metres-thick fresh cap does
    // not. `water` receives the identical value on the next line, so nothing
    // about the open sea changes. The BOOSTED GLINT line below is deliberately
    // NOT captured — see FOAM_SPEC_FILM.
    const specBroad = specTint.mul(ggx.div(ggx.add(SPEC_KNEE)).mul(SPEC_MAX))
      .mul(fresSpec).toVar();
    water.addAssign(specBroad);
    // Per-sky glint energy, gated to NEAR-MIRROR facets only. Glint is ~2%
    // (Fresnel) of the SOLAR DISC's radiance and the 8-bit reconstruction is
    // orders below a real disc — under the low golden sun the grazing Fresnel
    // hid that; under the high sun it printed no sparkle at all. Boosting the
    // whole lobe washed the far field white through the compressed skirt, so
    // the boost rides only on the part of the lobe above GLINT_MIN — the
    // facets actually mirroring the disc — and those clip to white through
    // the tonemapper, which is what real midday sparkle does.
    const glint = max(ggx.sub(float(1.5)), float(0)).toVar();
    water.addAssign(specTint.mul(glint.div(glint.add(6)).mul(0.5 * SPEC_MAX).mul(shading.specBoost)).mul(fresSpec));

    // foam on real crest-folds only (skip the finest cascade's constant
    // speckle): the accumulated-Jacobian turbulence rides displacement.w
    const foamRaw = float(0).toVar();
    // ...and the same taps carry the foam's AGE. min() across cascades is the
    // deepest, freshest break, which is exactly the "a new break over old foam
    // wins" semantics maps.js's own max() on foaminess has — age is not
    // additive the way coverage is, so this is a min while foamRaw stays a sum.
    // No extra sample: forcing `turb` to a Var pins each cascade to one fetch.
    const turbMin = float(1).toVar();
    cascades.forEach((c, i) => {
      if (i >= cascades.length - 1) return;
      const turb = texture(c.displacement, worldXZ.div(lengthScales[i])).w.toVar();
      turbMin.assign(min(turbMin, turb));
      foamRaw.addAssign(saturate(shading.foamThreshold.sub(turb).mul(shading.foamScale)));
    });
    // the macro envelope keeps tile copies from foaming identically
    const cov = saturate(foamRaw.mul(envC).mul(envC)).toVar();

    // --- the carve: de-tiled, and decoded AC3-style -------------------------
    // The classic dissolve, still: the threshold rides the coverage, so foam is
    // born as lace on a fresh fold, merges toward a solid cap as coverage
    // rises, and dies back into lace as the turbulence recovers. What changed
    // is WHERE the lace is and WHICH lace it is — see the CARVE_ and RAMP_
    // blocks above. Everything here is a STATIC world field with slow drift, so
    // nothing in it can blink; cov comes from the accumulator in
    // displacement.w and remains the only memory, and the only owner of AREA.
    //
    // 1. The DOMAIN WARP, read unwarped and biased by the channel mean so it
    //    vanishes to (0, 0) rather than to a constant when the tap mip-flattens
    //    at grazing incidence. No .level() on purpose: the implicit mip IS the
    //    graceful degradation. wy is decorrelated from wx because A is the B
    //    field at doubled UV.
    const wc = texture(detailTex, worldXZ.div(CARVE_WARP_TILE).add(0.23)).toVar();
    const wx = wc.b.sub(CARVE_MEAN).toVar();
    const wy = wc.a.sub(CARVE_MEAN).sub(wx.mul(CARVE_WARP_RHO)).mul(CARVE_WARP_ORTH);
    const qc = worldXZ.add(vec2(wx, wy).mul(CARVE_WARP_AMP)).toVar();
    // 2. The CONSTANT rotation, on the fine tap only — rotating both by
    //    different constants is the same pattern under a global rotation, so
    //    one angle is all the decorrelation there is to buy. Four multiplies
    //    and two adds, no trig.
    const qf = vec2(
      qc.x.mul(CARVE_ROT_C).sub(qc.y.mul(CARVE_ROT_S)),
      qc.y.mul(CARVE_ROT_C).add(qc.x.mul(CARVE_ROT_S)),
    ).toVar();
    // 3. NON-HARMONIC tiles, one fetch per scale held in a Var, so the fine
    //    fetch feeds BOTH the sparse and the medium density for ONE sample.
    //    That is what makes the three-density decode free.
    const cCoarse = texture(detailTex, qc.div(CARVE_TILE_C)
      .add(vec2(t.mul(0.012), t.mul(0.008)))).toVar();
    const cFine = texture(detailTex, qf.div(CARVE_TILE_F)
      .add(vec2(t.mul(-0.02), t.mul(0.015)))).toVar();
    const fA = cCoarse.b.toVar(); // coarse density: 2.99 m fbm patch silhouette
    const fB = cFine.g.toVar(); // medium density: 29 cm cellular grain
    // The ramp itself: two smoothsteps on the accumulator depth and nothing
    // else. cov descends from displacement.w, so the index HAS MEMORY — which
    // stage a patch of foam is in cannot blink with an instantaneous criterion,
    // and the weights are smooth in it, so stages cross-dissolve over seconds.
    // Both fine weights carry the footprint fade, which is constraint 4: as the
    // fine tile flattens toward CARVE_MEAN the weights go to zero and the field
    // degrades to the coarse layer alone rather than to an over-divided
    // constant.
    const fineFade = saturate(float(CARVE_FOOT_F).div(footprint)).toVar();
    const rampT = smoothstep(float(RAMP_IN), float(RAMP_FULL), cov).toVar();
    const wSparse = mix(float(RAMP_SPARSE_MIN), float(1), rampT).mul(fineFade).toVar();
    const wMed = smoothstep(float(RAMP_MED_IN), float(RAMP_FULL), cov)
      .mul(RAMP_MED_TOP).mul(fineFade).toVar();
    // Inverted cellular, with its long side clipped — see SPARSE_CLIP.
    const sparseDev = max(float(CARVE_MEAN).sub(cFine.r), float(SPARSE_CLIP)).toVar();
    const dev = fA.sub(CARVE_MEAN).add(sparseDev.mul(wSparse))
      .add(fB.sub(CARVE_MEAN).mul(wMed)).toVar();
    // CONTRAST-MATCHED TO THE SHIPPED COMPOSITE, at this same footprint and
    // this same cov, which is what keeps the calibrated 0.60/0.42/0.15 cut
    // area-neutral while the ramp rewrites the pattern underneath it. The AC3
    // stack is ADDITIVE — its weights sum to 1.25 at the low stop and 2.5 at
    // the high one — so summed unchanged the composite's mean would run
    // 0.51 -> 1.02 and a fixed 0.60 cut would pass almost nothing at one end
    // and everything at the other: the ramp would be a no-op and the calibrated
    // area would be gone. Coarse holds weight 1 at both AC3 stops, so it is the
    // unit the other two are measured in and sqrt(1 + wS^2 + wM^2) is the std
    // of the sum. The shipped field's own std at the same footprint is
    // sqrt(0.62^2 + (0.38*fineFade)^2) — 0.727 near, 0.62 once the fine tap has
    // filtered out — and the ratio of the two is the gain. Far field the two
    // expressions collapse to MEAN + 0.62*(coarse - MEAN), i.e. IDENTICAL to
    // shipped. A weighted sum preserves the mean only when the weights sum to
    // one and shrinks the std by sqrt(sum w^2) either way; getting that wrong
    // is how a carve silently stops carving at one end of the ramp.
    const sigMix = sqrt(wSparse.mul(wSparse).add(wMed.mul(wMed)).add(1)).toVar();
    const sigShip = sqrt(fineFade.mul(fineFade).mul(CARVE_W_F * CARVE_W_F)
      .add(CARVE_W_C * CARVE_W_C)).toVar();
    const carve = dev.mul(sigShip.div(sigMix).mul(CARVE_TRIM)).add(CARVE_MEAN).toVar();
    // The shipped literals, unchanged. In sigma of the field they cut, 0.60 is
    // +1.98 sigma above its mean at cov 0, sweeping to -2.37 at cov 1, through
    // a 1.55 sigma window.
    const fEdge = float(0.60).sub(cov.mul(0.42)).toVar();
    const coverage = smoothstep(fEdge, fEdge.add(0.15), carve)
      .mul(saturate(cov.mul(2.4))).toVar();

    // --- the submerged bubble plume, and the apron past the white edge ------
    // Three layers, and all of them act on `water` BEFORE the raft is
    // composited, so the aerated water reads through the lace holes — Crest's
    // two-layer model, where only the bubble layer is transmissive.
    //
    // NO FLICKER, BY CONSTRUCTION. Every driver has memory: `cov` is the
    // accumulator through its threshold. Nothing reads an instantaneous
    // lambda_min, a wave height, or any per-frame quantity without history. The
    // one view-dependent term (the parallax) is continuous in V and bounded,
    // and its denominator is V.y so it carries no per-pixel normal noise.
    //
    // OPEN WATER IS BIT-IDENTICAL: at cov = 0 both mix() weights are exactly 0.
    const bubOff = vec2(V.x, V.z)
      .mul(float(BUB_DEPTH).div(max(V.y, float(BUB_VY_MIN)))).toVar();
    const bubUV = worldXZ.sub(bubOff).div(BUB_TILE)
      .add(vec2(t.mul(-0.011), t.mul(0.007))).toVar();
    // Footprint-driven LOD with Crest's forced mip 3 as a FLOOR: a soft cloud
    // at any distance, and no aliasing once the footprint outruns the floor.
    const bubLod = log2(footprint.div(BUB_TILE / DETAIL_N)).max(float(BUB_LOD_MIN)).toVar();
    const plume = float(1).add(texture(detailTex, bubUV).level(bubLod).b
      .sub(CARVE_MEAN).div(CARVE_STD1).mul(BUB_CONTRAST)).clamp(0, BUB_PLUME_MAX).toVar();
    const aer = saturate(cov.mul(plume)).toVar();
    // MILKINESS, in the water's own shading. The plume is INSIDE the water, so
    // it is lit by the sky plus only what the raft above it passes down
    // (BUB_SUN_T), occluded by the same trough walls and wave group the body
    // is, and seen through a short column of the same muWater the crest glow
    // uses — which is what makes it a pale sea-green rather than a grey wash,
    // and what makes the water under foam read as SHALLOWER. It rides
    // (1 - fres) because aeration is a TRANSMISSION effect: the sky reflected
    // off the surface is not aerated, the water under it is.
    const litBub = float(FOAM_AMB).add(sunN.mul(FOAM_SUN * BUB_SUN_T))
      .mul(skyVis).mul(groupOcc).toVar();
    const milkCol = vec3(shading.foamColor).mul(SCUD_TONE)
      .mul(exp(muWater.mul(MILK_PATH).negate())).mul(litBub).toVar();
    water.assign(mix(water, milkCol,
      aer.mul(shading.foamMilk).mul(float(1).sub(fres))));

    // THE SCUD APRON. The same dissolve field, one threshold lower and one
    // window wider, faded out once the footprint outruns the field's own coarse
    // feature size so the far sea gets nothing rather than a flat veil. Only
    // the part that EXCEEDS the white is painted, which makes this a tail past
    // every white edge and identically zero inside a solid cap.
    const aEdge = fEdge.sub(APRON_DROP).toVar();
    const apron = smoothstep(aEdge, aEdge.add(APRON_SPAN), carve)
      .mul(saturate(cov.mul(APRON_COV_GAIN)))
      .mul(saturate(float(APRON_FOOT).div(footprint))).toVar();
    // A film sits ON the water: no water column and the raft's full sun weight,
    // but the SAME sky occlusion (floored — see SCUD_OCC_MIN), which is what
    // keeps a film in a hollow from reading as white paint on dark water.
    const litScud = float(FOAM_AMB).add(sunN.mul(FOAM_SUN))
      .mul(max(skyVis.mul(groupOcc), float(SCUD_OCC_MIN))).toVar();
    const scudCol = vec3(shading.foamColor).mul(SCUD_TONE).mul(litScud).toVar();
    // The extra (1 - coverage) is an AREA guard, not decoration: without it the
    // tail brightens the water UNDER a partially covered raft, which is a
    // second-order but real push on the calibrated bright-pixel count right at
    // the lace edge.
    water.assign(mix(water, scudCol,
      saturate(apron.sub(coverage)).mul(float(1).sub(coverage)).mul(APRON_ALPHA)));

    // --- foam tone: the ladder by age --------------------------------------
    // AGE. ageU = 1 - turbMin is the accumulator's own exponential, so ageU^4
    // is a front-loaded exponential in age; it is then REMAPPED onto
    // [AGE_END, 1] rather than allowed to reach 0.214, because `coverage` is
    // already fading to zero at the same moment and the accumulator steps
    // instantly on a reset. Nothing instantaneous enters the graph — ageU
    // inherits every bit of the accumulator's memory, which is what keeps this
    // off the flicker path that raw lambda_min put a core term on earlier.
    const ageU = saturate(float(1).sub(turbMin)).toVar();
    const ageU2 = ageU.mul(ageU).toVar();
    const ageRaw = ageU2.mul(ageU2).toVar();
    const farF = saturate(footprint.sub(AGE_FAR_LO).div(AGE_FAR_HI - AGE_FAR_LO)).toVar();
    // the physical age, far-faded to its area mean: drives the spectral rolloff
    // and the film's transmission, both of which want the full 0..1 range
    const ageP = mix(ageRaw, float(0.5), farF).toVar();
    // ...and the display tone, on the narrowed range
    const ageF = float(AGE_END).add(ageRaw.sub(AGE_U_DEATH4)
      .mul((1 - AGE_END) / (1 - AGE_U_DEATH4))).clamp(AGE_END, 1).toVar();
    // THICKNESS, centred on the baked mean over +/-2 sigma of the fine tap —
    // see LACE_MIN. Degrades to exactly 0.5 when that tap mip-flattens.
    const laceSolid = saturate(fB.sub(LACE_MEAN).div(LACE_HALF).mul(0.5).add(0.5)).toVar();
    const laceF = mix(float(LACE_MIN), float(1), laceSolid).toVar();
    // Age sets the raft's thickness class, the lace varies it inside — and the
    // PRODUCT, not one factor, fades to the far-field area answer, so nothing
    // downstream depends on a mip-flattened carve.
    const foamTone = mix(max(ageF.mul(laceF), float(TONE_FLOOR)),
      float(TONE_FAR), farF).toVar();

    // Near-Lambertian, as every operational ocean-colour treatment models it:
    // multiple scattering among 60-99% void-fraction bubble layers randomises
    // direction efficiently. Two corrections only — the wrap, so the shadow
    // side of a cap keeps its shape instead of flattening onto the ambient
    // floor, and the grazing forward lobe. `fwd` is the peak-normalised
    // Henyey-Greenstein lobe the crest glow already built and it is the right
    // geometry unchanged: V is surface->camera, so dot(V, -sunDir) peaks on a
    // BACK-LIT facet, which is where a forward lobe lives. Reused, so free.
    const foamWrap = saturate(dot(N, shading.sunDir).add(FOAM_WRAP).div(1 + FOAM_WRAP)).toVar();
    const foamSunT = min(foamWrap.mul(FOAM_SUN)
      .add(fwd.mul(float(1).sub(NoV)).mul(ageF).mul(FOAM_FWD)), float(FOAM_SUN)).toVar();
    // MICRO-RELIEF, as a bounded multiplicative modulation of the finished foam
    // brightness rather than a perturbed normal — see FOAM_RELIEF_FINE for why
    // it stays out of the specular and out of saturate(dot(Nf, L)). Mean 1 and
    // bounded, so it commutes with every tone rung above it and cannot move the
    // top of the HDR range by more than its own fraction.
    const reliefLit = dot(vec3(reliefGrad.x.negate(), 0, reliefGrad.y.negate()),
      shading.sunDir).clamp(-FOAM_RELIEF_CLAMP, FOAM_RELIEF_CLAMP)
      .mul(shading.foamRelief).toVar();
    // Foam is spectrally flat white at the surface, so the swatch supplies HUE
    // and shading.foamBright supplies the LEVEL. Same unit-luminance idiom
    // shadowTint uses on the water. Consequence worth knowing: the GUI's foam
    // picker is now a hue control and 'brightness' is the level dial.
    const foamHue = vec3(shading.foamColor).toVar();
    foamHue.assign(foamHue.div(max(dot(foamHue, vec3(0.2126, 0.7152, 0.0722)), float(1e-4))));
    const foamShaded = foamHue
      .mul(mix(vec3(1), vec3(FOAM_RED_AGED, 1, 1), float(1).sub(ageP)))
      .mul(foamTone.mul(shading.foamBright))
      .mul(float(FOAM_AMB).add(foamSunT).mul(float(1).add(reliefLit))).toVar();
    // The peak is NORMALISED, not clamped, so hue survives — a guard against
    // the colour picker being dragged past what the level budgeted for, not the
    // budget itself. See FOAM_CEIL.
    const foamPeak = foamShaded.r.max(foamShaded.g).max(foamShaded.b).toVar();
    foamShaded.mulAssign(min(float(1), float(FOAM_CEIL).div(max(foamPeak, float(1e-4)))));
    const surface = mix(water, foamShaded, coverage).toVar();
    // The water's own BROAD specular, back through a thin film. mix() has
    // already removed `coverage` of it; this returns the share a film of this
    // AGE transmits — nothing on a fresh cap, up to half through a late
    // monolayer. The boosted glint term is NOT returned. foamRough has already
    // broadened what does come back, which is exactly right for a mirror seen
    // through curved bubble film. Old foam sheens, fresh foam does not.
    surface.addAssign(specBroad.mul(coverage)
      .mul(float(FOAM_SPEC_FILM).mul(float(1).sub(ageP))));

    // A crest can swallow a deck-height camera. The sheet is DoubleSide, so that
    // frame is drawn from underneath — and looking UP through water is the one
    // place in this whole scene where refraction is a real, visible thing rather
    // than a bent ray with nothing behind it to bend.
    //
    // Snell's window. Everything above the surface — the entire 180-degree sky —
    // is compressed into a cone of half-angle asin(1/1.34) = 48.27 degrees
    // directly overhead. The zenith lands at the middle of it, the horizon lands
    // exactly on its rim, and the bottom ten degrees of sky squeeze into the last
    // one degree before that rim. Outside the cone there is no sky at all: past
    // the critical angle the surface is a perfect mirror and you see the water
    // column reflected back at you.
    //
    // This costs one sky tap and no plumbing whatsoever, and that is worth
    // saying out loud because it is the reason this is the refraction worth
    // having: skyColor() is a pure function of a direction into a baked
    // panorama, so a refracted ray can be evaluated exactly, in closed form,
    // with no render target, no framebuffer copy, no second pass and no depth
    // buffer. Screen-space refraction here would sample the clear colour and
    // return a flat constant — the ocean draws before the sky dome.
    //
    // What was here instead was a crossfade to a flat swatch with a glow bolted
    // on. It had no Fresnel at all, and the obvious fix — Schlick on the
    // water-side cosine — returns 0.025 at the critical angle where the true
    // answer is exactly 1.0, so it would have produced no window edge and no
    // total internal reflection.
    // Is the camera actually IN the water? dot(N, V) < 0 on its own is not that
    // test and never was: it fires on any facet tilting a few degrees away from
    // a grazing sight line, which at deck height is most of the horizon band, so
    // the old path was quietly painting the far field with a swatch meant for a
    // camera inside a wave. A debug pass showed it covering large contiguous
    // areas of open water in the deck framing.
    //
    // The honest test is a height comparison, and the height field is already on
    // the GPU. shading.originXZ is the ocean tile's origin, which main.js snaps
    // to the camera's own XZ every frame, so sampling the displacement there is
    // sampling the water under the lens. Two taps at an address that is constant
    // across the whole frame — no CPU readback, no async latency, no uniform to
    // keep in sync. Cascade 2 is 24 cm of ripple and cannot decide this.
    const camWaterY = float(0).toVar();
    const envO = ampEnvelope(detailTex, shading.originXZ).toVar();
    cascades.forEach((c, i) => {
      if (i > 1) return;
      camWaterY.addAssign(texture(c.displacement, shading.originXZ.div(lengthScales[i])).level(0).y.mul(envO));
    });
    // Ramped over ~30 cm rather than switched, so breaking the surface is a
    // dissolve and not a cut. Approximate by design: the sample is at the
    // undisplaced patch coordinate, so choppiness puts it up to a metre or two
    // off in XZ, which is nothing next to a wave that is swallowing the camera.
    const submerged = saturate(camWaterY.sub(cameraPosition.y).mul(3).add(0.5)).toVar();
    const under = saturate(dot(N, V).negate().mul(8)).mul(submerged).toVar();
    const Nb = N.negate().toVar(); // the sheet's normal as seen from below: into the air
    const ciUp = saturate(dot(Nb, V)).toVar();
    const Fup = fresnelDielectric(ciUp, float(N_WATER)).toVar();
    // refract() takes the incident direction — pointing AT the surface, hence
    // -V — and returns exactly vec3(0) under total internal reflection. That
    // zero is load-bearing and dangerous in equal measure: normalize(vec3(0)) is
    // NaN, and NaN survives multiplication by the zero weight it is about to get,
    // so the epsilon is required rather than defensive.
    const up = refract(V.negate(), Nb, float(N_WATER)).toVar();
    const window = skyColor(normalize(up.add(vec3(0, 1e-5, 0))), shading).toVar();
    // Inside the cone, sky; outside it, the mirrored water column. Fup does the
    // switch on its own and reaches exactly 1 at the rim, so the edge of the
    // window is drawn by the physics rather than by a threshold.
    const underLit = mix(window, deepBody.mul(float(0.30).add(facing.mul(0.5))), Fup).toVar();
    surface.assign(mix(surface, underLit, under));

    // --- aerial perspective -------------------------------------------------
    // The whole of it, composited here — see HAZE_DENSITY for why the water
    // opts out of scene.fogNode and does this itself.
    //
    // Two deliberate asymmetries make the horizon a line rather than a
    // dissolve. The target is the sky sampled just ABOVE the line rather than
    // along the view ray (which points below it), because "the value the sea
    // has to sit under" is the value the eye is comparing it with. And it is
    // scaled by SEA_SINK, so however thick the haze gets the far water lands a
    // measurable few percent darker than the sky it meets — a 1-pixel step,
    // which is what a horizon is. Being last, after the glitter and the foam,
    // is the other half: additive energy that escapes the haze is exactly what
    // used to bloom the last twenty pixels of sea brighter than the sky.
    const hazeDir = normalize(vec3(V.x.negate(), float(HORIZON_LIFT), V.z.negate()));
    const hazeCol = skyColor(hazeDir, shading).mul(SEA_SINK).toVar();
    // Beer-Lambert over true world distance, density falling off with altitude,
    // sampled at the ray's midpoint — the same model atmosphere.js applies to
    // everything else in the scene, so the water agrees with the spray and the
    // dome instead of drifting away from them.
    const midY = positionWorld.y.add(cameraPosition.y).mul(0.5).max(0);
    const tau = viewDist.mul(shading.hazeWater).mul(exp(midY.div(-HAZE_SCALE_H)));
    const ext = float(1).sub(exp(tau.negate())).toVar();
    // ...and the sea loses a little of its own value on top, so the band right
    // under the line reads as sea in shadow rather than as haze that happens to
    // be teal.
    const sink = mix(float(1), float(FAR_SINK), saturate(viewDist.div(FAR_SINK_RANGE)));
    const aerial = mix(surface.mul(sink), hazeCol, ext).toVar();
    // ...and none of that applies with the lens under the water. The extinction
    // along an underwater ray is the sea's, not the atmosphere's, and the two
    // are four orders of magnitude apart: air thins by 1/e over 3.2 km, water
    // over about three METRES. Compositing the sky's haze onto a submerged
    // frame put a sheet of cream-coloured sky across the bottom half of it,
    // which is what a `trough` capture that happened to be swallowed by a crest
    // came back with. Same Beer-Lambert, same muWater the crest glow uses, so
    // the underwater gloom and the light through a lip agree about what water
    // this is. Nothing beyond a few metres survives — which is correct, and is
    // also why this needs no volumetric anything.
    const seaExt = exp(muWater.mul(viewDist).negate()).toVar();
    return mix(aerial, mix(deepBody.mul(0.35), surface, seaExt), submerged);
  })();

  return mat;
}
