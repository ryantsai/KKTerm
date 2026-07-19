import type { ActivityRailItemId } from "../types";

export type ActivityRailModuleId = Exclude<ActivityRailItemId, "dontSleep">;

type ActivityRailModuleVisibility = {
  showWorkspaceOnRail: boolean;
  showDashboardOnRail: boolean;
  showInstallerOnRail: boolean;
  showScreenshotsOnRail: boolean;
  showItOps: boolean;
};

export const DEFAULT_ACTIVITY_RAIL_ORDER: ActivityRailItemId[] = [
  "workspace",
  "dashboard",
  "installer",
  "screenshots",
  "itops",
  "dontSleep",
];

const ACTIVITY_RAIL_ITEM_IDS = new Set<string>(DEFAULT_ACTIVITY_RAIL_ORDER);
const ACTIVITY_RAIL_MODULE_IDS = new Set<ActivityRailItemId>([
  "workspace",
  "dashboard",
  "installer",
  "screenshots",
  "itops",
]);
const ACTIVITY_RAIL_MODULE_VISIBILITY: Record<
  ActivityRailModuleId,
  keyof ActivityRailModuleVisibility
> = {
  workspace: "showWorkspaceOnRail",
  dashboard: "showDashboardOnRail",
  installer: "showInstallerOnRail",
  screenshots: "showScreenshotsOnRail",
  itops: "showItOps",
};

export function normalizeActivityRailOrder(order: readonly string[] | undefined) {
  const known = (order ?? []).filter(
    (id, index, values): id is ActivityRailItemId =>
      ACTIVITY_RAIL_ITEM_IDS.has(id) && values.indexOf(id) === index,
  );
  return [...known, ...DEFAULT_ACTIVITY_RAIL_ORDER.filter((id) => !known.includes(id))];
}

export function reorderActivityRailItems(
  order: readonly string[] | undefined,
  draggedId: ActivityRailItemId,
  targetId: ActivityRailItemId,
) {
  const next = normalizeActivityRailOrder(order);
  const from = next.indexOf(draggedId);
  const to = next.indexOf(targetId);
  if (from === to) return next;
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

export function activityRailModuleOrder(order: readonly string[] | undefined) {
  return normalizeActivityRailOrder(order).filter(
    (id): id is ActivityRailModuleId => ACTIVITY_RAIL_MODULE_IDS.has(id),
  );
}

export function canHideActivityRailModule(
  settings: ActivityRailModuleVisibility,
  moduleId: ActivityRailModuleId,
) {
  return Object.entries(ACTIVITY_RAIL_MODULE_VISIBILITY).some(
    ([id, setting]) => id !== moduleId && settings[setting],
  );
}
