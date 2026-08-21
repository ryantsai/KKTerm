import { ICON_PICKER_NAMES, VALID_ICON_NAMES } from "../../lib/reiconNames";

export type WidgetKind = "builtIn" | "script";

/**
 * Render-time strictness for AI-created script-widget layout. See
 * `docs/DASHBOARD.md` → "Layout Enforcement" and `permissions.ts`
 * (`layoutEnforcementCss`).
 */
export type WidgetLayoutEnforcement = "strict" | "moderate" | "low";

export const WIDGET_PRESETS = [
  "panel", "ambient", "hero",
] as const;
export type WidgetPreset = (typeof WIDGET_PRESETS)[number];

export const DEFAULT_WIDGET_PRESENTATION_BY_PRESET = {
  panel: { hideTitle: false },
  ambient: { hideTitle: true },
  hero: { hideTitle: false },
} as const satisfies Record<WidgetPreset, { hideTitle: boolean }>;

export function defaultWidgetPresentationForPreset<T extends WidgetPreset>(preset: T) {
  return DEFAULT_WIDGET_PRESENTATION_BY_PRESET[preset];
}

const TRANSLUCENT_BUILT_IN_WIDGET_IDS = new Set(["appLauncher", "connectionPane"]);

export function defaultBodyOpacityForInstance(instance: {
  kind: WidgetKind;
  sourceId: string;
}): number {
  if (instance.kind === "builtIn" && TRANSLUCENT_BUILT_IN_WIDGET_IDS.has(instance.sourceId)) {
    return 70;
  }
  return 100;
}

export function effectiveBodyOpacity(instance: {
  kind: WidgetKind;
  sourceId: string;
  bodyOpacity?: number | null;
}): number {
  return instance.bodyOpacity ?? defaultBodyOpacityForInstance(instance);
}

export const ACCENT_NAMES = [
  "default", "blue", "indigo", "teal", "green", "amber", "red", "purple", "pink",
  "slate", "cyan", "orange", "rose", "emerald", "sky",
] as const;
export type AccentName = (typeof ACCENT_NAMES)[number] | `#${string}`;

export const ICON_NAMES = ICON_PICKER_NAMES;
export type MaterialIconName = `material:${string}`;
export type IconName = (typeof VALID_ICON_NAMES)[number] | MaterialIconName;

export const GRID_DENSITIES = ["compact", "default", "roomy"] as const;
export type GridDensity = (typeof GRID_DENSITIES)[number];

export const BACKGROUND_FITS = ["fill", "fit", "stretch", "tile", "center"] as const;
export type BackgroundFit = (typeof BACKGROUND_FITS)[number];

export interface GradientColorStop {
  color: string;
  offset: number;
}

export type DashboardBackground =
  | { kind: "preset"; preset: string }
  | { kind: "image"; file: string; fit: BackgroundFit; dim: number }
  | { kind: "video"; file: string; fit: BackgroundFit; dim: number }
  | { kind: "dynamic"; dynamic: string }
  | { kind: "customGradient"; stops: GradientColorStop[]; angle: number };

export interface DashboardView {
  id: string;
  title: string;
  sortOrder: number;
  gridDensity: GridDensity;
  background: DashboardBackground | null;
  tabColor: string | null;
}

export interface DashboardWidgetInstance {
  id: string;
  viewId: string;
  kind: WidgetKind;
  sourceId: string;
  preset: WidgetPreset;
  accentName: AccentName;
  iconName: IconName;
  customTitle: string | null;
  glass?: boolean;
  hideTitle?: boolean;
  bodyOpacity?: number | null;
  settingsValuesJson: string;
  gridX: number;
  gridY: number;
  gridW: number;
  gridH: number;
  sortOrder: number;
}

export interface DashboardCustomWidget {
  id: string;
  title: string;
  summary: string;
  category: string;
  bodyJson: string;
  settingsSchemaJson: string;
  createdBy: "user" | "agent" | "imported";
  createdAt: string;
}

export interface DashboardLoadState {
  views: DashboardView[];
  instances: DashboardWidgetInstance[];
  customWidgets: DashboardCustomWidget[];
}

export interface InstancePatch {
  preset?: WidgetPreset;
  accentName?: AccentName;
  iconName?: IconName;
  customTitle?: string | null;
  glass?: boolean;
  hideTitle?: boolean;
  bodyOpacity?: number | null;
  settingsValuesJson?: string;
  gridX?: number;
  gridY?: number;
  gridW?: number;
  gridH?: number;
}

export interface ViewPatch {
  title?: string;
  gridDensity?: GridDensity;
  sortOrder?: number;
  background?: DashboardBackground | null;
  tabColor?: string | null;
}

export interface CustomWidgetPatch {
  title?: string;
  summary?: string;
  category?: string;
  bodyJson?: string;
  settingsSchemaJson?: string;
}

export interface LayoutEntry {
  id: string;
  gridX: number;
  gridY: number;
  gridW: number;
  gridH: number;
}

export type ScriptLifecycleKind = "static" | "periodic" | "animation" | "realtime";

export interface ScriptLifecycle {
  kind: ScriptLifecycleKind;
  minTickMs?: number;
}

export interface ScriptBody {
  source: string;
  permissions: { network: boolean; networkTools?: boolean; pollSeconds?: number };
  htmlShim?: string;
  libraries?: string[];
  /// Declared runtime lifecycle. `animation` arms a stall watchdog in the
  /// host; other kinds are reserved for future invariants. Absent ⇒ static.
  lifecycle?: ScriptLifecycle;
}

export type WidgetSettingsField =
  | {
      type: "text";
      key: string;
      label: string;
      placeholder?: string;
      defaultValue?: string;
    }
  | {
      type: "number";
      key: string;
      label: string;
      min?: number;
      max?: number;
      step?: number;
      defaultValue?: number;
    }
  | {
      type: "boolean";
      key: string;
      label: string;
      defaultValue?: boolean;
    }
  | {
      type: "select";
      key: string;
      label: string;
      options: { label: string; value: string }[];
      defaultValue?: string;
    }
  | {
      type: "secret";
      key: string;
      label: string;
      placeholder?: string;
    };

export interface WidgetSettingsSchema {
  fields: WidgetSettingsField[];
}

export interface WidgetSecretRef {
  type: "secretRef";
  ownerId: string;
  hasSecret: boolean;
  updatedAt?: string;
}
