import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_ACTIVITY_RAIL_ORDER,
  normalizeActivityRailOrder,
  reorderActivityRailItems,
} from "../src/app/activityRailOrder";
import * as activityRailOrder from "../src/app/activityRailOrder";

test("Activity Rail order defaults and repairs incomplete saved values", () => {
  assert.deepEqual(DEFAULT_ACTIVITY_RAIL_ORDER, [
    "workspace",
    "dashboard",
    "installer",
    "screenshots",
    "itops",
    "dontSleep",
  ]);
  assert.deepEqual(normalizeActivityRailOrder(["dontSleep", "workspace", "unknown"]), [
    "dontSleep",
    "workspace",
    "dashboard",
    "installer",
    "screenshots",
    "itops",
  ]);
});

test("Activity Rail items can be dragged into a new persisted order", () => {
  assert.deepEqual(
    reorderActivityRailItems(DEFAULT_ACTIVITY_RAIL_ORDER, "dontSleep", "dashboard"),
    ["workspace", "dontSleep", "dashboard", "installer", "screenshots", "itops"],
  );
});

test("Activity Rail keeps connected Connections after ordered Modules", () => {
  assert.equal(typeof activityRailOrder.activityRailModuleOrder, "function");
  assert.deepEqual(
    activityRailOrder.activityRailModuleOrder?.([
      "dontSleep",
      "itops",
      "workspace",
      "dashboard",
      "installer",
    ]),
    ["itops", "workspace", "dashboard", "installer", "screenshots"],
  );
});

test("Activity Rail requires at least one visible Module", () => {
  assert.equal(typeof activityRailOrder.canHideActivityRailModule, "function");
  assert.equal(
    activityRailOrder.canHideActivityRailModule?.(
      {
        showWorkspaceOnRail: true,
        showDashboardOnRail: false,
        showInstallerOnRail: false,
        showScreenshotsOnRail: false,
        showItOps: false,
      },
      "workspace",
    ),
    false,
  );
  assert.equal(
    activityRailOrder.canHideActivityRailModule?.(
      {
        showWorkspaceOnRail: true,
        showDashboardOnRail: true,
        showInstallerOnRail: false,
        showScreenshotsOnRail: false,
        showItOps: false,
      },
      "workspace",
    ),
    true,
  );
});
