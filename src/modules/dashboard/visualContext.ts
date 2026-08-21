import type { DashboardBackground, DashboardView } from "./types";

export type DashboardBackgroundTone = "light" | "dark" | "mixed";
export type DashboardVisualColorScheme = "light" | "dark";

export interface DashboardVisualContext {
  colorScheme: DashboardVisualColorScheme;
  backgroundKind: DashboardBackground["kind"] | "app";
  backgroundTone: DashboardBackgroundTone;
  backgroundId?: string;
  requiresOpaqueTextSurface: boolean;
}

const DARK_DYNAMIC_BACKGROUND_IDS = new Set([
  "starfield",
  "nebula",
  "matrix",
  "synthwave",
  "particleCursor",
  "ditherPrismHero",
  "webglLiquid",
  "silkAurora",
  "closingPlasma",
  "animatedGradient",
  "prismGradient",
  "liquidChrome",
  "maelstrom",
  "blackHole",
  "windowRain",
  "spectralCascadeOcean",
]);
const DARK_BACKGROUND_PRESET_IDS = new Set([
  "graphite",
  "midnight",
  "pine",
  "aubergine",
  "ember",
  "harbor",
  "moss",
  "wine",
  "steel",
  "g-twilight",
  "g-midnight",
  "g-harbor",
  "g-ember",
  "g-orchid",
  "g-forest",
  "g-eclipse",
  "g-cobalt",
  "g-nocturne",
]);

/**
 * Relative-luminance test for a CSS color string (`#rgb`, `#rrggbb`, or
 * `rgb()/rgba()`). Returns true for dark colors. Unparseable values are
 * treated as light so we never force a dark widget palette on a guess.
 */
export function isDarkCssColor(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  let r: number;
  let g: number;
  let b: number;
  const hex = trimmed.startsWith("#") ? trimmed.slice(1) : "";
  if (hex.length === 3) {
    r = parseInt(hex[0] + hex[0], 16);
    g = parseInt(hex[1] + hex[1], 16);
    b = parseInt(hex[2] + hex[2], 16);
  } else if (hex.length === 6 || hex.length === 8) {
    r = parseInt(hex.slice(0, 2), 16);
    g = parseInt(hex.slice(2, 4), 16);
    b = parseInt(hex.slice(4, 6), 16);
  } else {
    const match = trimmed.match(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
    if (!match) return false;
    r = Number(match[1]);
    g = Number(match[2]);
    b = Number(match[3]);
  }
  if (![r, g, b].every((n) => Number.isFinite(n))) return false;
  // sRGB relative luminance on a 0..1 scale.
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance < 0.5;
}

/**
 * Tone of the active app color scheme, read from the live `--app-bg` token.
 * Used only for the theme-default (no custom background) case so a widget on a
 * dark scheme (e.g. "purple", "blue-see", "dark") is correctly treated as dark
 * instead of always "light". Falls back to light outside the DOM (tests).
 */
function activeAppColorSchemeTone(): DashboardVisualColorScheme {
  if (typeof window === "undefined" || typeof document === "undefined") return "light";
  const appBg = window.getComputedStyle(document.documentElement).getPropertyValue("--app-bg");
  return isDarkCssColor(appBg) ? "dark" : "light";
}

export function dashboardVisualContextForView(
  view: Pick<DashboardView, "background">,
): DashboardVisualContext {
  const background = view.background;
  if (!background) {
    const tone = activeAppColorSchemeTone();
    return {
      colorScheme: tone,
      backgroundKind: "app",
      backgroundTone: tone,
      requiresOpaqueTextSurface: false,
    };
  }

  if (background.kind === "preset") {
    const tone = DARK_BACKGROUND_PRESET_IDS.has(background.preset) ? "dark" : "light";
    return {
      colorScheme: tone === "dark" ? "dark" : "light",
      backgroundKind: "preset",
      backgroundTone: tone,
      backgroundId: background.preset,
      requiresOpaqueTextSurface: false,
    };
  }

  if (background.kind === "dynamic") {
    const tone = DARK_DYNAMIC_BACKGROUND_IDS.has(background.dynamic) ? "dark" : "mixed";
    return {
      colorScheme: tone === "dark" ? "dark" : "light",
      backgroundKind: "dynamic",
      backgroundTone: tone,
      backgroundId: background.dynamic,
      requiresOpaqueTextSurface: tone === "mixed",
    };
  }

  if (background.kind === "customGradient") {
    const darkCount = background.stops.filter((stop) => isDarkCssColor(stop.color)).length;
    const tone: DashboardBackgroundTone = background.stops.length === 0
      ? "light"
      : darkCount === background.stops.length
        ? "dark"
        : darkCount === 0
          ? "light"
          : "mixed";
    return {
      colorScheme: tone === "dark" ? "dark" : "light",
      backgroundKind: "customGradient",
      backgroundTone: tone,
      requiresOpaqueTextSurface: tone === "mixed",
    };
  }

  return {
    colorScheme: "light",
    backgroundKind: background.kind,
    backgroundTone: "mixed",
    backgroundId: background.file,
    requiresOpaqueTextSurface: true,
  };
}
