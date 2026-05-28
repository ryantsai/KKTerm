// Installer Helper Module page. Shell + section grouping + lifecycle.
//
// Lifecycle:
//   * Mount: load catalog (uses 1h disk cache), subscribe to progress events,
//     load toolState. If hasInitialScanned is false, kick off detect_all and
//     mark scanned. Subsequent visits use the in-memory cache.
//   * "Refresh" button: re-run detect_all + reload toolState.
//   * "Check for updates" button: call installer_check_latest_versions for
//     every currently-installed tool.
//   * Unmount: keep the in-memory store; do NOT reset detected state (so
//     visiting the Module again is instant).

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { invokeCommand, isTauriRuntime } from "../../lib/tauri";
import { useWorkspaceStore } from "../../store";
import { useInstallerStore } from "./state";
import { isWslFeature } from "./dag";
import { InstallerConfirmDialog } from "./InstallerConfirmDialog";
import {
  PROGRESS_EVENT_NAME,
  type ProgressEvent,
  type Recipe,
} from "./types";
import { installRecipeAndWait } from "./progress";
import { ToolRow } from "./ToolRow";
import "./installer.css";

export function InstallerPage({ active }: { active: boolean }) {
  const { t } = useTranslation();
  const showStatusBarNotice = useWorkspaceStore(
    (state) => state.showStatusBarNotice,
  );
  const catalog = useInstallerStore((s) => s.catalog);
  const detected = useInstallerStore((s) => s.detected);
  const toolState = useInstallerStore((s) => s.toolState);
  const scanning = useInstallerStore((s) => s.scanning);
  const hasInitialScanned = useInstallerStore((s) => s.hasInitialScanned);
  const setCatalog = useInstallerStore((s) => s.setCatalog);
  const setDetected = useInstallerStore((s) => s.setDetected);
  const setToolStates = useInstallerStore((s) => s.setToolStates);
  const setScanning = useInstallerStore((s) => s.setScanning);
  const markInitialScanned = useInstallerStore((s) => s.markInitialScanned);
  const markWslJustEnabled = useInstallerStore((s) => s.markWslJustEnabled);
  const applyProgress = useInstallerStore((s) => s.applyProgress);
  const beginInFlight = useInstallerStore((s) => s.beginInFlight);

  const [updateAllConfirm, setUpdateAllConfirm] = useState<null | {
    items: string[];
    uacEstimate: number;
  }>(null);

  // Subscribe to progress events once per app session.
  useEffect(() => {
    if (!isTauriRuntime()) return;
    let unsubscribed = false;
    let unlisten: (() => void) | undefined;
    listen<ProgressEvent>(PROGRESS_EVENT_NAME, (event) => {
      if (unsubscribed) return;
      applyProgress(event.payload);
      // After a terminal event, re-detect that tool so the row moves
      // between Installed / Available immediately.
      if (
        event.payload.kind === "completed" ||
        event.payload.kind === "failed" ||
        event.payload.kind === "cancelled"
      ) {
        const toolId = event.payload.toolId;
        // If the just-completed tool is the WSL feature, set the session
        // reboot-gating flag so Docker (and anything else needing WSL)
        // is disabled until KKTerm restarts.
        if (event.payload.kind === "completed") {
          const catalogSnapshot = useInstallerStore.getState().catalog;
          const completedRecipe = catalogSnapshot?.recipes.find(
            (r) => r.id === toolId,
          );
          if (completedRecipe && isWslFeature(completedRecipe)) {
            markWslJustEnabled();
          }
        }
        void invokeCommand("installer_redetect", { toolId })
          .then((next) => {
            useInstallerStore.getState().setOneDetected(toolId, next);
          })
          .catch(() => {
            // Re-detection failure is non-fatal; user can hit Refresh.
          });
      }
    }).then((u) => {
      if (unsubscribed) {
        u();
        return;
      }
      unlisten = u;
    });
    return () => {
      unsubscribed = true;
      unlisten?.();
    };
  }, [applyProgress, markWslJustEnabled]);

  // Load catalog + initial detect when the Module first becomes active.
  useEffect(() => {
    if (!active || !isTauriRuntime()) return;
    if (catalog) return; // already loaded
    void (async () => {
      try {
        const loaded = await invokeCommand("installer_load_catalog", {});
        setCatalog(loaded);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        showStatusBarNotice(message, { tone: "error" });
      }
      try {
        const states = await invokeCommand("installer_get_state");
        setToolStates(states);
      } catch {
        // Empty toolState is fine on first run.
      }
    })();
  }, [active, catalog, setCatalog, setToolStates, showStatusBarNotice, t]);

  useEffect(() => {
    if (!active || !catalog || hasInitialScanned || scanning) return;
    if (!isTauriRuntime()) return;
    setScanning(true);
    void (async () => {
      try {
        const next = await invokeCommand("installer_detect_all");
        setDetected(next);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        showStatusBarNotice(message, { tone: "error" });
      } finally {
        setScanning(false);
        markInitialScanned();
      }
    })();
  }, [
    active,
    catalog,
    hasInitialScanned,
    markInitialScanned,
    scanning,
    setDetected,
    setScanning,
    showStatusBarNotice,
  ]);

  async function handleRefresh() {
    if (!isTauriRuntime()) return;
    setScanning(true);
    try {
      const next = await invokeCommand("installer_detect_all");
      setDetected(next);
      const states = await invokeCommand("installer_get_state");
      setToolStates(states);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showStatusBarNotice(message, { tone: "error" });
    } finally {
      setScanning(false);
    }
  }

  async function handleCheckUpdates() {
    if (!isTauriRuntime() || !catalog) return;
    const installedIds = catalog.recipes
      .filter((r) => detected[r.id]?.installed)
      .map((r) => r.id);
    if (installedIds.length === 0) return;
    try {
      await invokeCommand("installer_check_latest_versions", {
        toolIds: installedIds,
      });
      const states = await invokeCommand("installer_get_state");
      setToolStates(states);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showStatusBarNotice(message, { tone: "error" });
    }
  }

  const sections = groupRecipes(catalog?.recipes ?? [], detected, toolState);
  const updateAllRecipes = sections.updates.filter(
    (recipe) => !(toolState[recipe.id]?.pinned ?? false),
  );

  function openUpdateAllConfirm() {
    if (!catalog || updateAllRecipes.length === 0) return;
    const items = updateAllRecipes.map((r) => r.name);
    // UAC heuristic for "Update all": each updateable recipe contributes
    // its own per-recipe UAC estimate (without pinned-version flags). We
    // import the heuristic from dag.ts indirectly by re-running the same
    // logic via resolveInstallPlan with no detected map — but here we
    // already know the recipes will all install fresh, so just count via
    // a small inline scan.
    const uacEstimate = updateAllRecipes.reduce((sum, r) => {
      if (r.provider.kind === "windowsFeature") return sum + 1;
      if (r.provider.kind === "winget") {
        const id = r.provider.id.toLowerCase();
        return id.includes("docker.dockerdesktop") ? sum + 1 : sum;
      }
      if (r.provider.kind === "githubRelease") {
        return r.provider.layout === "zip" ? sum : sum + 1;
      }
      return sum;
    }, 0);
    setUpdateAllConfirm({ items, uacEstimate });
  }

  async function confirmUpdateAll() {
    if (!isTauriRuntime()) {
      setUpdateAllConfirm(null);
      return;
    }
    const queue = updateAllRecipes;
    setUpdateAllConfirm(null);
    for (const recipe of queue) {
      beginInFlight(recipe.id, "install");
      try {
        const terminalEvent = await installRecipeAndWait(recipe.id, {});
        if (terminalEvent.kind === "cancelled") {
          break;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        showStatusBarNotice(message, { tone: "error" });
        break;
      }
    }
  }

  return (
    <section
      className="installer-page"
      aria-label={t("installer.title")}
      data-active={active ? "true" : "false"}
    >
      <header className="installer-page__header">
        <div>
          <h1>{t("installer.title")}</h1>
          <p className="installer-page__subtitle">{t("installer.subtitle")}</p>
        </div>
        <div className="installer-page__actions">
          <button
            type="button"
            className="installer-button"
            onClick={() => void handleRefresh()}
            disabled={scanning || !catalog}
          >
            {t("installer.refresh")}
          </button>
          <button
            type="button"
            className="installer-button"
            onClick={() => void handleCheckUpdates()}
            disabled={scanning || !catalog || sections.installed.length === 0}
          >
            {t("installer.checkUpdates")}
          </button>
          <button
            type="button"
            className="installer-button primary"
            data-tutorial-id="installer.updateAll"
            onClick={openUpdateAllConfirm}
            disabled={scanning || !catalog || updateAllRecipes.length === 0}
          >
            {t("installer.updateAll")}
          </button>
        </div>
      </header>

      {!catalog ? (
        <div className="installer-empty">{t("installer.empty.loading")}</div>
      ) : scanning && !hasInitialScanned ? (
        <div className="installer-empty">{t("installer.status.scanning")}</div>
      ) : (
        <>
          {sections.updates.length > 0 ? (
            <RecipeSection
              titleKey="installer.section.updates"
              recipes={sections.updates}
            />
          ) : null}
          <RecipeSection
            titleKey="installer.section.installed"
            recipes={sections.installed}
          />
          <RecipeSection
            titleKey="installer.section.available"
            recipes={sections.available}
          />
        </>
      )}
      {updateAllConfirm ? (
        <InstallerConfirmDialog
          title={t("installer.confirm.updateAllTitle")}
          body={t("installer.confirm.updateAllBody", {
            count: updateAllConfirm.items.length,
          })}
          items={updateAllConfirm.items}
          footer={
            updateAllConfirm.uacEstimate > 0
              ? t("installer.confirm.uacFooter", {
                  count: updateAllConfirm.uacEstimate,
                })
              : undefined
          }
          confirmLabel={t("installer.confirm.updateAllConfirm")}
          onConfirm={() => void confirmUpdateAll()}
          onCancel={() => setUpdateAllConfirm(null)}
        />
      ) : null}
    </section>
  );
}

function RecipeSection({
  titleKey,
  recipes,
}: {
  titleKey: string;
  recipes: Recipe[];
}) {
  const { t } = useTranslation();
  if (recipes.length === 0) return null;
  return (
    <section className="installer-section">
      <h2 className="installer-section__title">{t(titleKey)}</h2>
      <div className="installer-section__rows">
        {recipes.map((recipe) => (
          <ToolRow key={recipe.id} recipe={recipe} />
        ))}
      </div>
    </section>
  );
}

interface GroupedRecipes {
  installed: Recipe[];
  available: Recipe[];
  updates: Recipe[];
}

function groupRecipes(
  recipes: Recipe[],
  detected: Record<string, ReturnType<typeof Object>>,
  toolState: Record<string, { latestVersionSeen: string | null }>,
): GroupedRecipes {
  const installed: Recipe[] = [];
  const available: Recipe[] = [];
  const updates: Recipe[] = [];
  for (const recipe of recipes) {
    const det = detected[recipe.id];
    if (!det) {
      available.push(recipe);
      continue;
    }
    if (det.installed) {
      const latest = toolState[recipe.id]?.latestVersionSeen;
      if (
        latest &&
        det.installedVersion &&
        latest !== det.installedVersion
      ) {
        updates.push(recipe);
      } else {
        installed.push(recipe);
      }
    } else {
      available.push(recipe);
    }
  }
  return { installed, available, updates };
}
