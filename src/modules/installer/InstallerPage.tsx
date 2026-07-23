// Install Helper Module page. Finder/SFTP-style shell + section grouping +
// lifecycle.
//
// Shell (house style, mirrors the SFTP file browser): a slim top bar
// (kind glyph + "Install Helper" + a Checked/Checking status pill, no macOS
// window chrome), a toolbar (sidebar toggle + current-filter crumb + search +
// List/Gallery switch + Refresh + Update All), a left category rail
// (InstallerSidebar) and a List or Gallery content view, with a footer status
// line. The per-tool detail surface stays the app-owned InstallerToolDialog.
//
// Lifecycle:
//   * Mount: load the embedded catalog, subscribe to progress events, and load
//     persisted detection + tool state before deciding whether an automatic
//     sweep is due.
//   * Activation (switching to the Module from another Module): run an
//     interval-gated detection + latest-version sweep. The sweep only runs when
//     the configured interval (General Settings → Install Helper, default once
//     per day) has elapsed since the last completed check; the last-check
//     timestamp is persisted per tool in SQLite and survives app launches.
//     Otherwise the persisted detection and latest-version state is reused.
//   * "Refresh" button (manual check): re-run detection, then check latest
//     versions for every catalog tool regardless of the interval, updating the
//     last-check timestamp.
//   * Unmount: keep the in-memory store; do NOT reset detected state (so
//     visiting the Module again is instant).

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import {
  CircleArrowUp,
  CircleCheck,
  CircleDashed,
  Clock,
  LayoutGrid,
  Layers,
  List as ListIcon,
  RefreshCw,
  Search,
} from "../../lib/reicon";
import type { LucideIcon } from "../../lib/reicon";
import {
  ModuleHeader,
  ModuleHeaderDivider,
  ModuleHeaderLead,
  ModuleHeaderSpacer,
  ModuleHeaderTitle,
  ModuleIconTile,
} from "../../app/ModuleHeader";
import { InstallHelperModuleIcon } from "../../app/moduleIdentityIcons";
import { invokeCommand, isTauriRuntime } from "../../lib/tauri";
import { useWorkspaceStore } from "../../store";
import { useInstallerStore } from "./state";
import { isKnownSelfElevatingWingetRecipe, isWslFeature } from "./dag";
import { InstallerConfirmDialog } from "./InstallerConfirmDialog";
import { InstallerToolDialog } from "./InstallerToolDialog";
import { WslDistroManager } from "./WslDistroManager";
import {
  PROGRESS_EVENT_NAME,
  localizedDescription,
  type ProgressEvent,
  type Recipe,
} from "./types";
import { installRecipeAndWait } from "./progress";
import { ToolRow } from "./ToolRow";
import { InstallerListRow } from "./InstallerListRow";
import {
  InstallerSidebar,
  type InstallerCounts,
  type InstallerNav,
} from "./InstallerSidebar";
import { INSTALLER_CATEGORY_SECTIONS } from "./sections";
import { deriveToolStatus } from "./useToolStatus";
import { recipeSupportsManagedLatestVersion } from "./latestSupport";
import {
  resolveInstallerCheckIntervalSeconds,
  shouldRunInstallerAutomaticCheck,
} from "./checkInterval";
import "./installer.css";

type ViewMode = "list" | "gallery";

const VIEW_MODE_STORAGE_KEY = "kkterm.installerViewMode.v1";

function readViewMode(): ViewMode {
  try {
    return localStorage.getItem(VIEW_MODE_STORAGE_KEY) === "list"
      ? "list"
      : "gallery";
  } catch {
    return "gallery";
  }
}

export function InstallerPage({ active }: { active: boolean }) {
  const { t, i18n } = useTranslation();
  const showStatusBarNotice = useWorkspaceStore(
    (state) => state.showStatusBarNotice,
  );
  const generalSettings = useWorkspaceStore((state) => state.generalSettings);
  const portableMode = useWorkspaceStore((state) => state.appModeInfo.mode === "portable");
  const catalog = useInstallerStore((s) => s.catalog);
  const detected = useInstallerStore((s) => s.detected);
  const toolState = useInstallerStore((s) => s.toolState);
  const inFlight = useInstallerStore((s) => s.inFlight);
  const lastStatus = useInstallerStore((s) => s.lastStatus);
  const checkError = useInstallerStore((s) => s.checkError);
  const scanning = useInstallerStore((s) => s.scanning);
  const checking = useInstallerStore((s) => s.checking);
  const checkingToolIds = useInstallerStore((s) => s.checkingToolIds);
  const setCatalog = useInstallerStore((s) => s.setCatalog);
  const setDetected = useInstallerStore((s) => s.setDetected);
  const setToolStates = useInstallerStore((s) => s.setToolStates);
  const setScanning = useInstallerStore((s) => s.setScanning);
  const markInitialScanned = useInstallerStore((s) => s.markInitialScanned);
  const markWslJustEnabled = useInstallerStore((s) => s.markWslJustEnabled);
  const applyProgress = useInstallerStore((s) => s.applyProgress);
  const beginInFlight = useInstallerStore((s) => s.beginInFlight);
  const openStepperDialog = useInstallerStore((s) => s.openStepperDialog);
  const setSummary = useInstallerStore((s) => s.setSummary);

  const [nav, setNav] = useState<InstallerNav>("all");
  const [query, setQuery] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>(readViewMode);

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
            const completedRecipe = useInstallerStore
              .getState()
              .catalog?.recipes.find((recipe) => recipe.id === toolId);
            if (
              event.payload.kind === "completed" &&
              completedRecipe &&
              recipeSupportsManagedLatestVersion(completedRecipe, next)
            ) {
              // Re-detect before checking so a newly recognized unmanaged
              // source cannot inherit a stale catalog-provider latest value.
              void invokeCommand("installer_check_latest_versions", {
                toolIds: [toolId],
              }).catch(() => {
                // The completed operation remains valid; Refresh can retry
                // this non-fatal metadata lookup.
              });
            }
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

  // Load the embedded catalog when the Module first becomes active. Persisted
  // state is hydrated by the activation effect before it evaluates the gate.
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
    })();
  }, [active, catalog, setCatalog, showStatusBarNotice]);

  // Drive detection + interval-gated auto-check once per activation. The ref
  // resets whenever the Module goes inactive, so switching back to the Module
  // re-evaluates the interval (but the work itself is skipped when still
  // fresh). catalog is a trigger because it loads asynchronously after the
  // Module first becomes active.
  const activationHandled = useRef(false);
  useEffect(() => {
    if (!active) {
      activationHandled.current = false;
      return;
    }
    if (!catalog || !isTauriRuntime()) return;
    if (activationHandled.current) return;
    activationHandled.current = true;
    void (async () => {
      let latest = useInstallerStore.getState();
      if (!latest.hasInitialScanned && !latest.scanning) {
        try {
          const [cached, states] = await Promise.all([
            invokeCommand("installer_load_detection_cache"),
            invokeCommand("installer_get_state"),
          ]);
          if (Object.keys(cached).length > 0) {
            setDetected(cached);
          }
          setToolStates(states);
          latest = useInstallerStore.getState();
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          showStatusBarNotice(message, { tone: "error" });
          markInitialScanned();
          return;
        }
      }

      // Gate the whole automatic sweep after hydrating persisted state. This
      // ordering is what makes the configured interval survive app relaunches.
      if (latest.checking) return;
      const lastCheck = latestTimestamp(
        Object.values(latest.toolState).map((s) => s.lastCheckAt),
      );
      const intervalSeconds = resolveInstallerCheckIntervalSeconds(
        generalSettings.installerCheckIntervalSeconds,
      );
      if (
        !shouldRunInstallerAutomaticCheck({
          lastCheckAt: lastCheck,
          intervalSeconds,
        })
      ) {
        return;
      }

      if (!latest.hasInitialScanned && !latest.scanning) {
        setScanning(true);
        try {
          await invokeCommand("installer_detect_all_streaming");
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          showStatusBarNotice(message, { tone: "error" });
          setScanning(false);
          markInitialScanned();
          return;
        }
      }

      latest = useInstallerStore.getState();
      const toolIds = catalog.recipes
        .filter((recipe) =>
          recipeSupportsManagedLatestVersion(recipe, latest.detected[recipe.id]),
        )
        .map((r) => r.id);
      if (toolIds.length === 0) return;
      try {
        await invokeCommand("installer_check_latest_versions", { toolIds });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        showStatusBarNotice(message, { tone: "error" });
      }
    })();
  }, [
    active,
    catalog,
    generalSettings.installerCheckIntervalSeconds,
    markInitialScanned,
    setDetected,
    setScanning,
    setToolStates,
    showStatusBarNotice,
  ]);

  async function handleRefresh() {
    if (!isTauriRuntime() || !catalog) return;
    setScanning(true);
    try {
      const nextDetected = await invokeCommand("installer_detect_all");
      setDetected(nextDetected);
      const states = await invokeCommand("installer_get_state");
      setToolStates(states);
      const toolIds = catalog.recipes
        .filter((recipe) =>
          recipeSupportsManagedLatestVersion(recipe, nextDetected[recipe.id]),
        )
        .map((r) => r.id);
      if (toolIds.length > 0) {
        await invokeCommand("installer_check_latest_versions", {
          toolIds,
        });
      }
      setScanning(false);
      markInitialScanned();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showStatusBarNotice(message, { tone: "error" });
      setScanning(false);
    }
  }

  // Catalog recipes, ordered and filtered to the visible Install Helper set
  // (section order, then per-section order). One ordered list drives counts,
  // grouping, and the flat List/Gallery views.
  const sectionOfId = useMemo(() => {
    const map = new Map<string, string>();
    for (const recipe of catalog?.recipes ?? []) {
      if (recipe.section !== "internal") map.set(recipe.id, recipe.section);
    }
    return map;
  }, [catalog]);
  const orderedRecipes = useMemo(
    () =>
      INSTALLER_CATEGORY_SECTIONS.flatMap((section) =>
        (catalog?.recipes ?? []).filter(
          (recipe) => recipe.section === section.id,
        ),
      ),
    [catalog],
  );

  const statusFor = useMemo(() => {
    return (recipe: Recipe) =>
      deriveToolStatus(recipe, {
        detected: detected[recipe.id],
        toolState: toolState[recipe.id],
        operation: inFlight[recipe.id]?.operation ?? null,
        latestError: checkError[recipe.id],
        lastFailed: lastStatus[recipe.id]?.kind === "failed",
        scanning,
        checking: checkingToolIds.has(recipe.id),
      });
  }, [
    detected,
    toolState,
    inFlight,
    lastStatus,
    checkError,
    scanning,
    checkingToolIds,
  ]);

  const counts = useMemo<InstallerCounts>(() => {
    let installed = 0;
    let updates = 0;
    let none = 0;
    const byCategory: Record<string, number> = {};
    for (const section of INSTALLER_CATEGORY_SECTIONS) byCategory[section.id] = 0;
    for (const recipe of orderedRecipes) {
      const sectionId = sectionOfId.get(recipe.id);
      if (sectionId) byCategory[sectionId] += 1;
      const st = statusFor(recipe);
      if (st.isInstalled) installed += 1;
      else none += 1;
      if (st.hasUpdate) updates += 1;
    }
    return { all: installed + none, installed, updates, none, byCategory };
  }, [orderedRecipes, sectionOfId, statusFor]);

  const updateAllRecipes = useMemo(
    () =>
      orderedRecipes.filter(
        (recipe) =>
          statusFor(recipe).hasUpdate &&
          !(toolState[recipe.id]?.pinned ?? false),
      ),
    [orderedRecipes, statusFor, toolState],
  );

  const filteredRecipes = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = (recipe: Recipe) =>
      !q ||
      recipe.name.toLowerCase().includes(q) ||
      localizedDescription(recipe, i18n.language).toLowerCase().includes(q);
    const navMatch = (recipe: Recipe) => {
      if (nav.startsWith("sec:")) {
        return sectionOfId.get(recipe.id) === nav.slice(4);
      }
      const st = statusFor(recipe);
      if (nav === "installed") return st.isInstalled;
      if (nav === "updates") return st.hasUpdate;
      if (nav === "none") return !st.isInstalled;
      return true;
    };
    return orderedRecipes.filter(
      (recipe) => matches(recipe) && navMatch(recipe),
    );
  }, [orderedRecipes, query, nav, sectionOfId, statusFor, i18n.language]);

  // Section-grouped headers only make sense across the whole catalog with no
  // search; a status filter or a search reads better as a flat list.
  const grouped =
    !query.trim() &&
    (nav === "all" || nav === "installed" || nav === "none");

  const lastCheckedAt = latestTimestamp([
    ...Object.values(detected).map((state) => state.lastCheckedAt ?? null),
    ...Object.values(toolState).map((state) => state.lastCheckAt),
  ]);
  const lastCheckedText = t("installer.lastChecked", {
    time: lastCheckedAt
      ? formatHeaderTimestamp(lastCheckedAt)
      : t("installer.status.neverChecked"),
  });
  const checkInProgress = scanning || checking;

  // Mirror the footer roll-up into the store so the global app status bar can
  // render it while this Module is the visible page.
  useEffect(() => {
    setSummary({
      all: counts.all,
      installed: counts.installed,
      updates: counts.updates,
      lastCheckedAt,
    });
  }, [setSummary, counts.all, counts.installed, counts.updates, lastCheckedAt]);

  const crumb = navCrumb(nav, t);

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
      if (r.provider.kind === "wslDistro") return sum;
      if (r.provider.kind === "winget") {
        return isKnownSelfElevatingWingetRecipe(r) ? sum + 1 : sum;
      }
      if (r.provider.kind === "githubRelease") {
        return r.provider.layout === "zip" ? sum : sum + 1;
      }
      if (r.provider.kind === "downloadInstaller") {
        return r.id === "antigravity-cli" ? sum : sum + 1;
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
      openStepperDialog(recipe.id);
      beginInFlight(recipe.id, "install");
      try {
        const terminalEvent = await installRecipeAndWait(recipe.id, {});
        if (terminalEvent.kind !== "completed") {
          openStepperDialog(recipe.id);
          break;
        }
      } catch (error) {
        openStepperDialog(recipe.id);
        const message = error instanceof Error ? error.message : String(error);
        showStatusBarNotice(message, { tone: "error" });
        break;
      }
    }
  }

  function changeViewMode(next: ViewMode) {
    setViewMode(next);
    try {
      localStorage.setItem(VIEW_MODE_STORAGE_KEY, next);
    } catch {
      // Persisting the view preference is best-effort.
    }
  }

  return (
    <section
      className="installer-page"
      aria-label={t("installer.title")}
      data-active={active ? "true" : "false"}
    >
      <ModuleHeader className="installer-module-header">
        <ModuleHeaderLead className="installer-topbar__kind">
          <ModuleIconTile module="installer">
            <InstallHelperModuleIcon size={16} aria-hidden="true" />
          </ModuleIconTile>
          <ModuleHeaderTitle as="span">{t("installer.title")}</ModuleHeaderTitle>
        </ModuleHeaderLead>
        <ModuleHeaderDivider />
        <span className="installer-crumb" style={crumb.style}>
          <crumb.Icon size={14} strokeWidth={1.9} aria-hidden="true" />
          {crumb.label}
        </span>
        <ModuleHeaderSpacer />
        <span
          className={`installer-conn-pill${
            checkInProgress ? " installer-conn-pill--busy" : ""
          }`}
        >
          {checkInProgress ? (
            <>
              <span className="installer-page__spinner" aria-hidden="true" />
              {t("installer.checkingForUpdates")}
            </>
          ) : (
            <>
              <Clock size={12} strokeWidth={1.9} aria-hidden="true" />
              {lastCheckedText}
            </>
          )}
        </span>
        <label className="installer-search">
          <Search size={14} strokeWidth={1.9} aria-hidden="true" />
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("installer.search")}
            spellCheck={false}
            aria-label={t("installer.search")}
          />
        </label>
        <div className="installer-segmented" role="tablist">
          <button
            type="button"
            className={viewMode === "list" ? "active" : ""}
            onClick={() => changeViewMode("list")}
            title={t("installer.view.list")}
            aria-label={t("installer.view.list")}
            aria-selected={viewMode === "list"}
          >
            <ListIcon size={15} strokeWidth={1.9} />
          </button>
          <button
            type="button"
            className={viewMode === "gallery" ? "active" : ""}
            onClick={() => changeViewMode("gallery")}
            title={t("installer.view.gallery")}
            aria-label={t("installer.view.gallery")}
            aria-selected={viewMode === "gallery"}
          >
            <LayoutGrid size={15} strokeWidth={1.9} />
          </button>
        </div>
        <button
          type="button"
          className="installer-button"
          onClick={() => void handleRefresh()}
          disabled={scanning || checking || !catalog}
        >
          <RefreshCw size={14} strokeWidth={1.9} aria-hidden="true" />
          {checkInProgress
            ? t("installer.checkingDots")
            : t("installer.refresh")}
        </button>
        <button
          type="button"
          className="installer-button primary"
          data-tutorial-id="installer.updateAll"
          onClick={openUpdateAllConfirm}
          disabled={checkInProgress || !catalog || updateAllRecipes.length === 0}
        >
          <CircleArrowUp size={14} strokeWidth={2} aria-hidden="true" />
          {t("installer.updateAll")}
          {updateAllRecipes.length > 0 ? (
            <span className="installer-button__count">
              {updateAllRecipes.length}
            </span>
          ) : null}
        </button>
      </ModuleHeader>

      <div className="installer-panes">
        <InstallerSidebar
          nav={nav}
          onNavigate={setNav}
          counts={counts}
          collapsed={false}
        />
        <div className="installer-content">
          {portableMode ? (
            <div className="installer-portable-notice">
              {t("installer.portableMachineLocalNotice")}
            </div>
          ) : null}
          {!catalog ? (
            <div className="installer-empty">{t("installer.empty.loading")}</div>
          ) : (
            <InstallerContent
              recipes={filteredRecipes}
              grouped={grouped}
              viewMode={viewMode}
            />
          )}
        </div>
      </div>

      <InstallerToolDialog />
      <WslDistroManager />
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

function InstallerContent({
  recipes,
  grouped,
  viewMode,
}: {
  recipes: Recipe[];
  grouped: boolean;
  viewMode: ViewMode;
}) {
  const { t } = useTranslation();

  if (recipes.length === 0) {
    return (
      <div className="installer-content__scroll">
        <div className="installer-empty installer-empty--inline">
          <Layers size={34} strokeWidth={1.5} aria-hidden="true" />
          <span>{t("installer.empty.noMatches")}</span>
        </div>
      </div>
    );
  }

  if (!grouped) {
    return (
      <div className="installer-content__scroll">
        {viewMode === "list" ? (
          <ListView recipes={recipes} />
        ) : (
          <div className="installer-grid">
            {recipes.map((recipe) => (
              <ToolRow key={recipe.id} recipe={recipe} />
            ))}
          </div>
        )}
      </div>
    );
  }

  const groups = INSTALLER_CATEGORY_SECTIONS.map((section) => ({
    section,
    recipes: recipes.filter((recipe) => recipe.section === section.id),
  })).filter((group) => group.recipes.length > 0);

  return (
    <div className="installer-content__scroll">
      {viewMode === "list" ? (
        <ListView grouped groups={groups} />
      ) : (
        groups.map(({ section, recipes: sectionRecipes }) => (
          <section className="installer-group" key={section.id}>
            <h2
              className="installer-group__title"
              style={{ "--tint": `var(${section.tintVar})` } as CSSProperties}
            >
              <span className="installer-group__glyph">
                <section.Icon size={14} strokeWidth={1.9} aria-hidden="true" />
              </span>
              {t(section.titleKey)}
              <span className="installer-group__count">
                {sectionRecipes.length}
              </span>
            </h2>
            <div className="installer-grid">
              {sectionRecipes.map((recipe) => (
                <ToolRow key={recipe.id} recipe={recipe} />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}

function ListView({
  recipes,
  grouped,
  groups,
}: {
  recipes?: Recipe[];
  grouped?: boolean;
  groups?: Array<{
    section: (typeof INSTALLER_CATEGORY_SECTIONS)[number];
    recipes: Recipe[];
  }>;
}) {
  const { t } = useTranslation();
  return (
    <div className="installer-list">
      <div className="installer-listhead">
        <span>{t("installer.listColumn.name")}</span>
        <span>{t("installer.section.installed")}</span>
        <span>{t("installer.options.versionLatest")}</span>
        <span>{t("installer.listColumn.status")}</span>
        <span className="installer-listhead__action">
          {t("installer.listColumn.action")}
        </span>
      </div>
      {grouped && groups
        ? groups.map(({ section, recipes: sectionRecipes }) => (
            <div className="installer-list__group" key={section.id}>
              <div
                className="installer-list__grouphead"
                style={
                  { "--tint": `var(${section.tintVar})` } as CSSProperties
                }
              >
                <span className="installer-group__glyph">
                  <section.Icon
                    size={13}
                    strokeWidth={1.9}
                    aria-hidden="true"
                  />
                </span>
                {t(section.titleKey)}
                <span className="installer-group__count">
                  {sectionRecipes.length}
                </span>
              </div>
              {sectionRecipes.map((recipe) => (
                <InstallerListRow key={recipe.id} recipe={recipe} />
              ))}
            </div>
          ))
        : (recipes ?? []).map((recipe) => (
            <InstallerListRow key={recipe.id} recipe={recipe} />
          ))}
    </div>
  );
}

function navCrumb(
  nav: InstallerNav,
  t: (key: string) => string,
): { Icon: LucideIcon; label: string; style: CSSProperties } {
  if (nav.startsWith("sec:")) {
    const section = INSTALLER_CATEGORY_SECTIONS.find(
      (s) => s.id === nav.slice(4),
    );
    if (section) {
      return {
        Icon: section.Icon,
        label: t(section.titleKey),
        style: { "--tint": `var(${section.tintVar})` } as CSSProperties,
      };
    }
  }
  if (nav === "installed") {
    return {
      Icon: CircleCheck,
      label: t("installer.section.installed"),
      style: { "--tint": "var(--green)" } as CSSProperties,
    };
  }
  if (nav === "updates") {
    return {
      Icon: CircleArrowUp,
      label: t("installer.sidebar.updates"),
      style: { "--tint": "var(--accent)" } as CSSProperties,
    };
  }
  if (nav === "none") {
    return {
      Icon: CircleDashed,
      label: t("installer.status.notInstalled"),
      style: { "--tint": "var(--text-faint)" } as CSSProperties,
    };
  }
  return {
    Icon: Layers,
    label: t("installer.sidebar.allTools"),
    style: { "--tint": "var(--accent)" } as CSSProperties,
  };
}

function latestTimestamp(
  values: Array<number | null | undefined>,
): number | null {
  const numeric = values.filter(
    (value): value is number => typeof value === "number",
  );
  if (numeric.length === 0) return null;
  return Math.max(...numeric);
}

function formatHeaderTimestamp(seconds: number): string {
  return new Date(seconds * 1000).toLocaleString();
}
