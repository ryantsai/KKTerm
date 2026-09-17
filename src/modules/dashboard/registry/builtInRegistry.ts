import type { ComponentType } from "react";
import type { AccentName, IconName, WidgetPreset } from "../types";
import { AiCodingUsageBody } from "../widgets/AiCodingUsageBody";
import { AppLauncherBody } from "../widgets/AppLauncherBody";
import { ConnectionWidgetBody } from "../widgets/ConnectionWidgetBody";
import { ConvertersBody } from "../widgets/ConvertersBody";
import { GeneratorToolsBody } from "../widgets/GeneratorToolsBody";
import { NetworkToolsBody } from "../widgets/NetworkToolsBody";
import { NetworkProfilesBody } from "../widgets/NetworkProfilesBody";
import { NotesBody } from "../widgets/NotesBody";
import { PcInfoBody } from "../widgets/PcInfoBody";
import type { DashboardWidgetInstance } from "../types";

export interface BuiltInWidgetBodyProps {
  instance: DashboardWidgetInstance;
  isViewActive: boolean;
}

export interface BuiltInWidgetEntry {
  id: string;
  titleKey: string;
  summaryKey: string;
  category: string;
  defaultPreset: WidgetPreset;
  defaultAccent: AccentName;
  defaultIcon: IconName;
  defaultSize: { w: number; h: number };
  Body: ComponentType<BuiltInWidgetBodyProps>;
}

export const BUILT_IN_WIDGETS: BuiltInWidgetEntry[] = [
  {
    id: "aiCodingUsage",
    titleKey: "dashboard.aiCodingUsageTitle",
    summaryKey: "dashboard.aiCodingUsageSummary",
    category: "monitor",
    defaultPreset: "panel",
    defaultAccent: "teal",
    defaultIcon: "Activity",
    defaultSize: { w: 6, h: 4 },
    Body: AiCodingUsageBody,
  },
  {
    id: "appLauncher",
    titleKey: "appLauncher.title",
    summaryKey: "appLauncher.subtitle",
    category: "shortcut",
    defaultPreset: "panel",
    defaultAccent: "blue",
    defaultIcon: "Wrench",
    defaultSize: { w: 4, h: 3 },
    Body: AppLauncherBody,
  },
  {
    id: "connectionPane",
    titleKey: "dashboard.connectionPaneTitle",
    summaryKey: "dashboard.connectionPaneSummary",
    category: "connection",
    defaultPreset: "panel",
    defaultAccent: "teal",
    defaultIcon: "Server",
    defaultSize: { w: 8, h: 5 },
    Body: ConnectionWidgetBody,
  },
  {
    id: "notes",
    titleKey: "dashboard.notesTitle",
    summaryKey: "dashboard.notesSummary",
    category: "note",
    defaultPreset: "ambient",
    defaultAccent: "amber",
    defaultIcon: "Pin",
    defaultSize: { w: 3, h: 3 },
    Body: NotesBody,
  },
  {
    id: "pcInfo",
    titleKey: "dashboard.pcInfoTitle",
    summaryKey: "dashboard.pcInfoSummary",
    category: "monitor",
    defaultPreset: "panel",
    defaultAccent: "slate",
    defaultIcon: "Cpu",
    defaultSize: { w: 5, h: 6 },
    Body: PcInfoBody,
  },
  {
    id: "networkProfiles",
    titleKey: "dashboard.networkProfilesTitle",
    summaryKey: "dashboard.networkProfilesSummary",
    category: "utility",
    defaultPreset: "panel",
    defaultAccent: "sky",
    defaultIcon: "Network",
    defaultSize: { w: 7, h: 5 },
    Body: NetworkProfilesBody,
  },
  {
    id: "networkTools",
    titleKey: "dashboard.networkToolsTitle",
    summaryKey: "dashboard.networkToolsSummary",
    category: "utility",
    defaultPreset: "panel",
    defaultAccent: "sky",
    defaultIcon: "Network",
    defaultSize: { w: 4, h: 5 },
    Body: NetworkToolsBody,
  },
  {
    id: "generatorTools",
    titleKey: "dashboard.generatorToolsTitle",
    summaryKey: "dashboard.generatorToolsSummary",
    category: "utility",
    defaultPreset: "panel",
    defaultAccent: "purple",
    defaultIcon: "Hammer",
    defaultSize: { w: 4, h: 5 },
    Body: GeneratorToolsBody,
  },
  {
    id: "converters",
    titleKey: "dashboard.convertersTitle",
    summaryKey: "dashboard.convertersSummary",
    category: "utility",
    defaultPreset: "panel",
    defaultAccent: "emerald",
    defaultIcon: "Gauge",
    defaultSize: { w: 4, h: 5 },
    Body: ConvertersBody,
  },
];

export function getBuiltInWidget(id: string): BuiltInWidgetEntry | undefined {
  return BUILT_IN_WIDGETS.find((w) => w.id === id);
}
