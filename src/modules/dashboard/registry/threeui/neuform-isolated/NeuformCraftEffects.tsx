import { useMemo, type CSSProperties } from "react";

import emberStormSource from "./sources/aeonix-ember-storm.html?raw";
import fluidSource from "./sources/aura-ui-fluid.html?raw";
import neonSource from "./sources/glassblown-neon.html?raw";
import julianVanceNebulaSource from "./sources/julian-vance-nebula.html?raw";
import engravedCertificateSource from "./sources/kinetic-lathe-certificate.html?raw";
import luminaWeaversClothSource from "./sources/lumina-weavers-cloth.html?raw";
import nexusUnifiedFlowSource from "./sources/nexus-unified-flow.html?raw";

type FocusRole = "background" | "ui";
type EffectMode = "dark" | "light";

type FocusTarget = {
  selector: string;
  role: FocusRole;
  width?: string;
};

type EffectDefinition = {
  title: string;
  source: string;
  background: string | ((mode: EffectMode) => string);
  targets: readonly FocusTarget[];
  presentation?: "animated-typography" | "woven-cloth-label";
};

export type NeuformCraftEffectProps = {
  mode?: EffectMode;
  hue?: number;
  saturation?: number;
  brightness?: number;
  className?: string;
  style?: CSSProperties;
};

export const NEUFORM_CRAFT_DEFAULTS = {
  hue: 0,
  saturation: 1,
  brightness: 1,
} as const;

const EFFECTS = {
  neon: {
    title: "Animated neon typography",
    source: neonSource,
    background: (mode) => (mode === "light" ? "#f4f4f2" : "#090909"),
    targets: [{ selector: "#board", role: "ui", width: "1040px" }],
    presentation: "animated-typography",
  },
  luminaWeaversCloth: {
    title: "Woven Cloth kinetic textile",
    source: luminaWeaversClothSource,
    background: "#16090b",
    targets: [{ selector: "body > div.fixed.inset-0.overflow-hidden.z-0", role: "background" }],
    presentation: "woven-cloth-label",
  },
  julianVanceNebula: {
    title: "Julian Vance nebula background",
    source: julianVanceNebulaSource,
    background: "#09090b",
    targets: [{ selector: "#bg-canvas", role: "background" }],
  },
  fluid: {
    title: "Aura UI fluid background",
    source: fluidSource,
    background: "#030306",
    targets: [{ selector: "#bg-canvas", role: "background" }],
  },
  nexusUnifiedFlow: {
    title: "Nexus unified halftone flow",
    source: nexusUnifiedFlowSource,
    background: "#000000",
    targets: [{ selector: "#glcanvas", role: "background" }],
  },
  emberStorm: {
    title: "Aeonix ember storm",
    source: emberStormSource,
    background: "#080503",
    targets: [{ selector: "#gl", role: "background" }],
  },
  engravedCertificate: {
    title: "Kinetic Lathe certificate",
    source: engravedCertificateSource,
    background: "#ded6c2",
    targets: [{ selector: "#cert", role: "ui", width: "720px" }],
  },
} as const satisfies Record<string, EffectDefinition>;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function replaceRequired(source: string, authored: string, focused: string) {
  if (!source.includes(authored)) {
    throw new Error(`Neuform source adapter could not find: ${authored}`);
  }
  return source.replace(authored, focused);
}

function animatedTypographySource(source: string) {
  return [
    [
      "return { t0: after + 5.6 + frnd() * 7.2, dur: total, segs: segs };",
      "return { t0: after + 1.25 + frnd() * 1.75, dur: total, segs: segs };",
    ],
    ["if (!ev) ev = nextEvent(4.2);", "if (!ev) ev = nextEvent(0.55);"],
    [
      "cap = Math.min((W - W * 0.12) / blockW, (H - H * 0.18) / blockH);",
      "cap = Math.min((W - W * 0.20) / blockW, (H - H * 0.28) / blockH);",
    ],
    ["var y0 = (H - blockH * cap) * 0.48;", "var y0 = (H - blockH * cap) / 2;"],
  ].reduce(
    (adapted, [authored, focused]) => replaceRequired(adapted, authored, focused),
    source,
  );
}

function wovenClothLabelSource(source: string) {
  return [
    ["x.fillText('L W', W/2, 190);", "x.fillText('W C', W/2, 190);"],
    ["x.fillText('· KYOTO ·', W/2, 246);", "x.fillText('· WOVEN CLOTH ·', W/2, 246);"],
    ["x.fillText('LUMINA', W/2, 400);", "x.fillText('WOVEN', W/2, 400);"],
    ["x.fillText('WEAVERS', W/2, 520);", "x.fillText('CLOTH', W/2, 520);"],
    [
      "x.fillText('K I N E T I C   T E X T I L E S   ·   2 0 2 4', W/2, 626);",
      "x.fillText('T E X T I L E   S I M U L A T I O N', W/2, 626);",
    ],
  ].reduce(
    (adapted, [authored, focused]) => replaceRequired(adapted, authored, focused),
    source,
  );
}

function resolveBackground(definition: EffectDefinition, mode: EffectMode) {
  return typeof definition.background === "function" ? definition.background(mode) : definition.background;
}

function buildFocusedDocument(definition: EffectDefinition, mode: EffectMode) {
  const targetJson = JSON.stringify(definition.targets).replace(/</g, "\\u003c");
  const background = resolveBackground(definition, mode);
  const monochromeFilter = mode === "light"
    ? "grayscale(1) invert(1) contrast(1.08)"
    : "grayscale(1) contrast(1.08)";
  const presentationStyle = definition.presentation === "animated-typography"
    ? `
@keyframes sf-neon-type-breathe {
  0%, 100% { transform: translate3d(0, 3px, 0) scale(0.988); opacity: 0.88; }
  45% { transform: translate3d(0, -3px, 0) scale(1); opacity: 1; }
  68% { transform: translate3d(0, 0, 0) scale(0.996); opacity: 0.96; }
}
#board { overflow: visible !important; }
#neon {
  transform-origin: 50% 52%;
  animation: sf-neon-type-breathe 5.6s cubic-bezier(0.22, 1, 0.36, 1) infinite;
  filter: ${monochromeFilter};
  will-change: transform, opacity;
}
@media (prefers-reduced-motion: reduce) {
  #neon { animation: none !important; transform: none !important; opacity: 1 !important; }
}
`
    : "";
  const focusStyle = `<style data-threeui-focus>
html, body { width: 100% !important; height: 100% !important; min-height: 0 !important; margin: 0 !important; padding: 0 !important; overflow: hidden !important; background: ${background} !important; }
body { position: relative !important; display: flex !important; align-items: center !important; justify-content: center !important; }
body > * { visibility: hidden !important; }
body[data-threeui-ready] > [data-threeui-role] { visibility: visible !important; }
[data-threeui-residual] { display: none !important; }
[data-threeui-role="background"] { position: fixed !important; inset: 0 !important; width: 100% !important; height: 100% !important; max-width: none !important; max-height: none !important; z-index: 0 !important; opacity: 1 !important; pointer-events: none !important; }
[data-threeui-role="ui"] { position: relative !important; z-index: 1 !important; width: min(calc(100% - 32px), var(--threeui-target-width, 1040px)) !important; max-width: none !important; max-height: calc(100% - 32px) !important; margin: auto !important; overflow: auto !important; opacity: 1 !important; transform: none !important; filter: none !important; flex: none !important; box-sizing: border-box !important; }
${presentationStyle}
</style>`;
  const focusScript = `<script data-threeui-focus>
(function () {
  var isolated = false;
  function isolate() {
    if (isolated) return;
    var specs = ${targetJson};
    var roots = [];
    specs.forEach(function (spec) {
      var element = document.querySelector(spec.selector);
      if (!element) return;
      element.setAttribute('data-threeui-role', spec.role);
      if (spec.width) element.style.setProperty('--threeui-target-width', spec.width);
      if (!roots.some(function (root) { return root.contains(element); })) roots.push(element);
    });
    if (!roots.length) return;
    isolated = true;
    roots.forEach(function (root) { document.body.appendChild(root); });
    Array.from(document.body.children).forEach(function (element) {
      if (roots.indexOf(element) !== -1) return;
      element.setAttribute('data-threeui-residual', '');
      element.setAttribute('aria-hidden', 'true');
      if ('inert' in element) element.inert = true;
    });
    document.body.setAttribute('data-threeui-ready', '');
    requestAnimationFrame(function () { window.dispatchEvent(new Event('resize')); });
  }
  function scheduleIsolation() { setTimeout(isolate, 100); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scheduleIsolation, { once: true });
  else scheduleIsolation();
  window.addEventListener('load', isolate, { once: true });
})();
</script>`;
  const presentedSource = definition.presentation === "animated-typography"
    ? animatedTypographySource(definition.source)
    : definition.presentation === "woven-cloth-label"
      ? wovenClothLabelSource(definition.source)
      : definition.source;
  return presentedSource
    .replace(/<\/head>/i, `${focusStyle}</head>`)
    .replace(/<\/body>/i, `${focusScript}</body>`);
}

function NeuformCraftEffect({
  definition,
  mode = "dark",
  hue = NEUFORM_CRAFT_DEFAULTS.hue,
  saturation = NEUFORM_CRAFT_DEFAULTS.saturation,
  brightness = NEUFORM_CRAFT_DEFAULTS.brightness,
  className,
  style,
}: NeuformCraftEffectProps & { definition: EffectDefinition }) {
  const safeMode: EffectMode = mode === "light" ? "light" : "dark";
  const background = resolveBackground(definition, safeMode);
  const source = useMemo(() => buildFocusedDocument(definition, safeMode), [definition, safeMode]);
  const safeHue = clamp(hue, -180, 180);
  const safeSaturation = clamp(saturation, 0, 2);
  const safeBrightness = clamp(brightness, 0.35, 1.65);
  const filter = safeHue === 0 && safeSaturation === 1 && safeBrightness === 1
    ? undefined
    : `hue-rotate(${safeHue}deg) saturate(${safeSaturation}) brightness(${safeBrightness})`;

  return (
    <iframe
      className={className}
      data-mode={safeMode}
      title={definition.title}
      srcDoc={source}
      sandbox="allow-scripts"
      loading="eager"
      style={{
        display: "block",
        width: "100%",
        height: "100%",
        border: 0,
        background,
        filter,
        ...style,
      }}
    />
  );
}

function createEffectComponent(definition: EffectDefinition) {
  return function EffectComponent(props: NeuformCraftEffectProps) {
    return <NeuformCraftEffect {...props} definition={definition} />;
  };
}

export const NeonTypography = createEffectComponent(EFFECTS.neon);
export const WovenCloth = createEffectComponent(EFFECTS.luminaWeaversCloth);
export const NebulaBackground = createEffectComponent(EFFECTS.julianVanceNebula);
export const FluidFieldBackground = createEffectComponent(EFFECTS.fluid);
export const HalftoneFlow = createEffectComponent(EFFECTS.nexusUnifiedFlow);
export const EmberStorm = createEffectComponent(EFFECTS.emberStorm);
export const EngravedCertificate = createEffectComponent(EFFECTS.engravedCertificate);
