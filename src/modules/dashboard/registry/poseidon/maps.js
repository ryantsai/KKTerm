import { StorageTexture, HalfFloatType, RepeatWrapping, LinearFilter } from 'three/webgpu';
import {
  Fn, instanceIndex, uint, uvec2, vec2, vec4, float, min, max, mix, sqrt, exp, texture,
  textureStore,
} from 'three/tsl';

// --- accumulator dissipation ------------------------------------------------
// Every shipped foam sim dissipates its turbulent energy in SPACE as well as in
// time: War Thunder's energy "dissipates over time (exponential fade) *and* in
// space (blur)", ATLAS's rule is verbatim "dissipate it over time (blur +
// fade)", and Sea of Thieves makes progressive feedback blur its whole
// dispersion model. Without the spatial half, patches fade in place with hard
// edges instead of spreading and softening as they age.
//
// The blur kernel is FOUR mip-0 taps at +/-0.5 texel diagonals, not a mip-1
// tap. A mip-1 tap would be cheaper by two samples but it lands on a MIP-0
// texel centre, which in mip-1 texel space is a quarter of a texel off the
// nearest mip-1 centre, so bilinear blends 75/25 and the effective kernel is
// asymmetric with a 2-texel period between even and odd rows — and it would
// make the whole item depend on three.js regenerating a StorageTexture's mip
// chain lazily at bind time, which is undocumented and whose failure mode is
// silent. The 4-tap tent is translation-invariant, needs no mip chain at all,
// and its second moment is exactly 0.5 texel^2 (centre 0.25, four edges 0.125
// each, four corners 0.0625 each).
//
// Blending toward it with weight w = spread*dt per frame therefore accrues
// spread*0.5*texel^2 of variance per SECOND at any frame rate — as frame-rate
// independent as the fade, by the same argument. Over one e-folding time the
// blur alone reaches sigma = texel*sqrt(spread*tau/2), which at the shipped
// 1.32 is 2.62 texels on the 1024 m cascade (tau 10.4 s), 1.60 on the 144 m
// (3.9 s) and 1.02 on the 24 m (1.59 s). The semi-Lagrangian back-trace adds
// its own numerical diffusion (linear interpolation gives D = v*texel/2, i.e.
// sigma = sqrt(v*tau/texel) texels = 0.76 / 1.24 / 1.94 across the same three)
// and the two scale OPPOSITELY in texel size, so the quadrature total lands at
// 2.73 / 2.03 / 2.19 texels and ONE dial serves every cascade. That is "one
// kernel footprint of softening per e-folding time", which matches the spatial
// and the temporal dissipation timescales to each other.

// Hitch guard on the blend weight. main.js clamps dt to 0.1 s and
// params.timeScale (GUI 0-3) multiplies it, so 0.3 s is the ceiling the app can
// reach and at the shipped spread this never binds. Kept because it also holds
// the per-step blend inside the near-linear regime where repeated blending
// converges to the Gaussian family the sizing above assumes.
const BLUR_W_MAX = 0.30;
// Lower bound on the effective e-folding time, in seconds. dt is
// frameTime * params.timeScale and gui.js exposes timeScale down to 0, so
// without this floor the tau cap below makes the decay exp(-0/0): either NaN
// into a persistent texture (where the blur then spreads it to every neighbour
// on the next frame, permanently) or, if the driver's max() drops the NaN, the
// entire accumulated trail vanishing the instant the sim is paused. Far below
// any real tau (foamDecay's GUI floor of 0.5 s times the smallest tauScale of
// 0.408 is 0.204 s), so it only ever catches dt = 0, where it correctly gives
// exp(0) = 1 and the accumulator holds perfectly still.
const TAU_FLOOR = 1e-3;
// Cap on tau expressed in frames, and it exists because the accumulator state
// moved out of a float32 attributeArray into a HALF-FLOAT texture. Half carries
// 11 significant bits, so relative spacing inside a binade runs 2^-10 = 9.8e-4
// at its bottom to 4.9e-4 at its top, and round-to-nearest DISCARDS any
// multiplicative decrement below half a spacing. The per-step decay fraction is
// dt/tau, so above tau/dt ~ 2048 the foam would stop fading at all and
// permanently stain the sea. 1500 keeps a 1.33x margin. At 60 fps it caps tau
// at 25 s, well above the 10.4 s the shipped foamDecay = 3.9 produces on the
// 1024 m cascade, so the default look is untouched; it first engages above
// ~144 fps at defaults. Where it engages the trail shortens gracefully instead
// of never fading.
const FOAM_TAU_STEPS = 1500;
// Ceiling on injected foaminess, f = 1 - lambda_min. f = 1 is a cusp; the
// material saturates at f ~ 1.08, so everything above that is pure LIFETIME —
// a violent break outliving a light one is the mechanism the decay-the-DEPTH
// design turns on. The old accumulator was an unclamped float32 buffer, so any
// cap is a lifetime (and therefore area) reduction on the brightest foam in the
// frame; 8.0 is lambda_min = -7, about 21 sigma of the 0.374 strain RMS on the
// largest cascade, so nothing this spectrum produces is truncated. The field is
// still bounded, so one freak texel cannot be smeared into a bright halo by the
// blur — the one failure mode the old design did not have, because nothing
// sampled its neighbours.
const FOAM_F_MAX = 8.0;
// Foam-AREA compensation. Blurring conserves the INTEGRAL of foaminess but not
// the thresholded AREA: for a patch of amplitude A and half-width s, area above
// threshold T goes as pi*s^2*ln(A/T), and the blur takes it to
// pi*(s^2+sigma^2)*ln(A*s^2/(T*(s^2+sigma^2))) — near-neutral on solid caps
// (A/T = 3 with sigma^2/s^2 = 0.25 costs 0.5%) but it annihilates marginal
// wisps (A/T = 1.5 loses 44%). Foam on this spectrum is almost entirely a
// 1024 m-cascade phenomenon — reaching lambda_min = 0.32 is 1.8 sigma of its
// 0.374 strain RMS against 6.2 sigma of the 144 m cascade's 0.109 — where
// sigma(tau) is 2.73 texels and trail blobs run s = 3-6 texels.
//
// MEASURED, not derived, because the derivation's 1.10-1.42 bracket is wrong by
// an order of magnitude for THIS shader: it treats the gain as an amplitude
// scale, but the material thresholds the accumulator's DEPTH, so a gain here is
// an effective THRESHOLD shift — foam draws where g*(1 - lambda_min) > 1 -
// foamThreshold, i.e. where lambda_min < 1 - 0.68/g. At g = 1.20 that moves the
// criterion from 0.32 to 0.433 and the calibrated bright-pixel count from 53911
// to 96632 (measured). The blur's actual area cost, measured on the same band
// with the gain off, is 53911 -> 51782, i.e. 21% of the foam-attributable
// population; at the calibration's own slope of ~2300 px per 0.01 of threshold
// that is recovered by +0.009 on the criterion, hence 0.68/(1 - 0.329) = 1.013.
// The gain still pivots exactly on flat water (lambda_min = 1 -> f = 0), so it
// can never invent foam where nothing broke. RE-MEASURE IF foamSpread MOVES.
const FOAM_INJECT_GAIN = 1.048;

// rgba16f storage texture: filterable (bilinear) AND storage-capable, tiling
// via RepeatWrapping, auto-mipmapped after each compute write.
function mapTexture(N) {
  const tex = new StorageTexture(N, N);
  tex.type = HalfFloatType;
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  return tex;
}

// ...and the same thing WITHOUT a mip chain, for the foam history. The blur in
// the assemble pass is an explicit 4-tap tent on mip 0, so a mip chain would be
// per-frame regeneration work that nothing ever reads.
function histTexture(N) {
  const tex = mapTexture(N);
  tex.generateMipmaps = false;
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  return tex;
}

// Assemble pass: pack a cascade's spatial IFFT buffers into two sampled maps and
// accumulate foam.
//   displacement = ( lambda*Dx, height, lambda*Dz, turbulence )
//   derivatives  = ( dDy/dx, dDy/dz, lambda*dDx/dx, lambda*dDz/dz )
// Foam follows the architecture every shipped FFT ocean uses (NVIDIA WaveWorks
// / War Thunder's "turbulent energy", ATLAS, Crest, Sea of Thieves): a
// breaking criterion on the horizontal-displacement Jacobian injects into a
// persistent per-texel buffer that decays over time, and that buffer is an
// OPACITY which pulls a separately authored foam texture through. The mask
// decides where, the texture decides what foam looks like.
//
// The criterion is the MINIMUM EIGENVALUE of the deformation matrix, not its
// determinant (Tessendorf, Reinhard & Gao 2023). det = lambda_min*lambda_max,
// so a sharp fold in one direction can be masked by stretching in the other;
// lambda_min is "a more sensitive measure of peak sharpness" and fires at the
// true onset. 1 = flat water, ~0 at a cusp, negative where the surface
// self-intersects. Deliberately NOT wave height: the Jacobian is dimensionless
// and scale-local, so one threshold means the same thing in every cascade,
// where a height threshold does not — only the largest cascade has metre-scale
// height of its own, so height caps whole swell faces while never firing on the
// wind-wave band at all.
//
// The accumulator is a pair of ping-ponged history textures holding FOAMINESS
// (1 - turbulence): it snaps up on a fold and decays exponentially, spreading
// and softening as it goes, so whitecaps build and dissipate instead of
// flickering and the water a crest has moved on from keeps its foam as a
// fading, drifting wake. displacement.w carries 1 - f, so the material's view
// of the accumulator is unchanged.
export function createCascadeMaps(cascade,
  { N, lambda, dt, foamDecay, foamSpread, drift }) {
  // Decay time grows with breaker phase speed c ~ sqrt(gL/2pi), so foam from
  // big cascades outlives foam from small ones (Callaghan 2012; Reul & Chapron
  // 2003 put static-foam persistence at ~5x crest foam, both proportional to
  // the carrier period). 144 m is the reference cascade.
  const tauScale = Math.sqrt(cascade.lengthScale / 144);
  const displacement = mapTexture(N);
  const derivatives = mapTexture(N);
  // The accumulator dissipates in SPACE as well as in time now, which means the
  // kernel has to read its own NEIGHBOURHOOD from last frame — and a storage
  // texture cannot be sampled and written in one dispatch. So the state leaves
  // the per-texel attributeArray (which could only ever touch its own element)
  // for two ping-ponged history textures, read/write swapped by frame parity
  // from Ocean.evolve. Nothing outside this file ever read the old buffer;
  // displacement.w stays the material's only view of the accumulator, so the
  // surface shader needs no edit for any of this.
  //
  // HARD CONSTRAINT for anything added later: the assemble kernel now writes
  // three storage textures (displacement, derivatives, history) and the default
  // WebGPU maxStorageTexturesPerShaderStage is 4. A fourth storage write here
  // is one slot from a device-limit validation failure — use the history's free
  // G/B/A channels instead, and never read and write the same history in one
  // dispatch.
  const hist = [histTexture(N), histTexture(N)];

  const buildAssemble = (histRead, histWrite) => Fn(() => {
    const id = instanceIndex;
    const coord = uvec2(id.mod(uint(N)), id.div(uint(N)));
    const DxDz = cascade.DxDz.element(id); // (Dx, Dz)
    const DyDxz = cascade.DyDxz.element(id); // (height, dDz/dx)
    const DyxDyz = cascade.DyxDyz.element(id); // (dDy/dx, dDy/dz)
    const DxxDzz = cascade.DxxDzz.element(id); // (dDx/dx, dDz/dz)

    const jxx = float(1).add(lambda.mul(DxxDzz.x));
    const jzz = float(1).add(lambda.mul(DxxDzz.y));
    const jxz = lambda.mul(DyDxz.y); // lambda * dDz/dx (= dDx/dz by symmetry)
    // lambda_min of [[jxx, jxz], [jxz, jzz]] — the analytic 2x2 eigenvalue
    const half = jxx.add(jzz).mul(0.5);
    const disc = sqrt(jxx.sub(jzz).mul(jxx.sub(jzz)).add(jxz.mul(jxz).mul(4))).mul(0.5);
    const lMin = half.sub(disc);

    // Reset-on-generation, exponential fade in TIME, and — new — dissipation in
    // SPACE. See the constants block at the top of this file for the sizing.
    //
    // The state is kept as FOAMINESS f = 1 - turbulence, and the sign matters
    // now that it lives in a half-float texture rather than a float32 buffer.
    // Half has RELATIVE precision, so a multiplicative fade on f resolves the
    // whole decaying tail down to zero, while the same fade on turbulence
    // stalls once (1 - turb) drops below a half-ulp — pinning the field at a
    // constant that at high frame rates can fall BELOW foamThreshold and whiten
    // the entire sea. Storing f also makes an uninitialised texel read as CLEAN
    // WATER rather than as foam (WebGPU zero-initialises textures, so no init
    // pass is needed at all), and lets the injection gain pivot exactly on flat
    // water (lambda_min = 1 -> f = 0) so it can never invent foam where nothing
    // broke. min(criterion, decayed) in turbulence is max(injected, decayed)
    // here: the same law, one subtraction cheaper at the write.
    //
    // Advection is a semi-Lagrangian back-trace by the SURFACE DRIFT — ~3% of
    // U10 plus Stokes drift, 0.32 m/s at the default 10.5 m/s wind, two orders
    // below the crest phase speed, so the raft stays nearly still in the water
    // frame while the crest runs out from under it. At that magnitude it is a
    // sub-texel-per-frame nudge on the cascade that actually carries the foam
    // (0.83 texels over a whole e-folding time on the 1024 m cascade), so its
    // main measurable contribution is the numerical diffusion above rather than
    // a visible directional comet — do not budget for streaking. The +0.5 is
    // load-bearing: without it the sample sits on a texel CORNER and averages
    // four texels every frame, a large unintended blur on top of the sized one.
    const uv = vec2(float(coord.x), float(coord.y)).add(0.5).div(N)
      .sub(drift.mul(dt).div(cascade.lengthScale));
    const tx = float(1 / N);
    // .level() is mandatory: WGSL allows only textureSampleLevel in a compute
    // stage, never textureSample.
    const tap = (ox, oy) => texture(hist[histRead], uv.add(vec2(tx.mul(ox), tx.mul(oy))))
      .level(float(0)).x;
    const fTent = tap(0.5, 0.5).add(tap(-0.5, 0.5)).add(tap(0.5, -0.5)).add(tap(-0.5, -0.5))
      .mul(0.25);
    const blurW = min(dt.mul(foamSpread), float(BLUR_W_MAX));
    const fPrev = mix(tap(0, 0), fTent, blurW);

    // foamDecay is an e-folding TIME in seconds, which is the measured law
    // A(t) = A0*exp(-t/tau) with tau ~ 3.85 s in salt water (2.54 s in fresh —
    // seawater inhibits bubble coalescence, so salt foam lives ~50% longer;
    // Monahan & Zietlow 1969), scaled sqrt(L/144) per cascade. Being a time
    // rather than a per-frame rate makes it frame-rate independent, so a hitch
    // cannot jump the whole foam field.
    const tauEff = max(min(foamDecay.mul(tauScale), dt.mul(FOAM_TAU_STEPS)),
      float(TAU_FLOOR)).toVar();
    const fDecayed = fPrev.mul(exp(dt.negate().div(tauEff)));
    // The max() both resets where the surface is folding NOW and recharges
    // where a second wave breaks over old foam, and because it injects DEPTH
    // rather than a flag, a hard break outlives a light one.
    const fInj = min(float(1).sub(lMin).mul(FOAM_INJECT_GAIN), float(FOAM_F_MAX));
    const f = max(fInj, fDecayed).toVar();
    const turb = float(1).sub(f).toVar();

    textureStore(hist[histWrite], coord, vec4(f, 0, 0, 1)).toWriteOnly();

    textureStore(displacement, coord, vec4(DxDz.x.mul(lambda), DyDxz.x, DxDz.y.mul(lambda), turb)).toWriteOnly();
    textureStore(derivatives, coord, vec4(DyxDyz.x, DyxDyz.y, DxxDzz.x.mul(lambda), DxxDzz.y.mul(lambda))).toWriteOnly();
  })().compute(N * N);

  // Both parities built up front: one kernel reads hist[0] and writes hist[1],
  // the other the reverse. Ocean.evolve picks by frame parity, which makes the
  // read/write hazard impossible by construction.
  const assemble = [buildAssemble(0, 1), buildAssemble(1, 0)];
  return { displacement, derivatives, assemble };
}
