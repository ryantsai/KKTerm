// Inherent optical properties of sea water, from the published tables rather
// than from the eye.
//
// This file exists because of one measurement. The hand-authored transmittance
// this shader used for its crest glow — SSS_COLOR = (0.500, 0.920, 0.720) —
// turns out to be, to within 0.65% of hue, the *diffusion* transmittance of
// about 2.3 m of Jerlov 2C coastal water. Whoever tuned it by eye walked onto a
// physical constant. So the constant is not wrong, it is just undocumented and
// frozen: it can only ever describe ONE path length, which is why the old glow
// needed a separate SSS_TIP swatch bolted on to go warm at a thin lip.
//
// An exponential does that for free. exp(-mu * d) at d = 0.6 m comes out a warm
// near-white and at d = 3 m a jade green, off the same coefficients — the gold
// tip and the green run are the same curve sampled twice, not two swatches.
//
// SOURCE. Absorption a and scattering b are Solonenko & Mobley 2015, "Inherent
// optical properties of Jerlov water types", Appl. Opt. 54(17):5392-5401,
// Tables 6-7, read at the paper's own 600 / 550 / 450 nm grid points. Reading
// the grid points rather than interpolating matters: interpolated values can
// land below the Pope & Fry 1997 pure-water absorption floor, which is
// unphysical and shows up as a channel that will not attenuate.
//
// WHICH WATER. 1C and 3C are the coastal green types (chlorophyll ~1.0 and
// ~1.28 mg/m^3). That is a deliberate match to this scene rather than a
// default: fitting the shader's own authored palette against the whole Jerlov
// table puts every swatch in it between 1C and 3C to within 2% of hue. Open
// ocean (Jerlov IB) is a saturated navy — (0.05, 0.23, 1.00) — and nothing in
// this project wants it. The jade lip is only physically reachable in coastal
// water, which is also where the reference photography comes from.
const JERLOV = {
  '1C': { a: [0.2360, 0.0760, 0.1050], b: [0.3140, 0.3650, 0.5140] },
  '3C': { a: [0.2390, 0.0820, 0.1540], b: [0.9160, 1.0600, 1.5000] },
};

// Mean cosine of the particle phase function (Petzold average particle). Water
// is far more forward-scattering than the g ~ 0.5 a graphics phase function
// usually runs at, and that is the whole reason the transport form below is not
// simply Beer-Lambert: at g = 0.924 a scattering event barely deflects a photon,
// so b hardly attenuates anything and the reduced coefficient b(1-g) is what
// counts.
const G_PARTICLE = 0.924;

// Diffusion (transport) attenuation, 1/m, per RGB.
//
//   mu = sqrt( 3 a (a + b(1 - g)) )
//
// NOT the beam coefficient c = a + b. The single-scattering albedo here runs
// 0.79-0.93, so by the time light has crossed a wave lip most of what arrives
// has scattered several times and is diffusing rather than travelling in a
// straight line. Beam extinction over the same path is several times too dark
// and, worse, has the wrong hue — it kills green, which is the one channel a
// backlit crest keeps.
export function diffusionAttenuation(type) {
  const { a, b } = JERLOV[type];
  return a.map((av, i) => Math.sqrt(3 * av * (av + b[i] * (1 - G_PARTICLE))));
}
