import { useCallback, useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from "react";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import {
  AppWindow,
  ArrowUp,
  Bug,
  ChevronDown,
  ChevronRight,
  Clock,
  Eye,
  FileText,
  Gauge,
  Globe2,
  HardDrive,
  Images,
  Package,
  RefreshCw,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  type IconComponent,
} from "../../lib/reicon";
import { ModuleHeader, ModuleHeaderLead, ModuleHeaderSpacer, ModuleHeaderTitle, ModuleIconTile } from "../../app/ModuleHeader";
import { SystemCleanerModuleIcon } from "../../app/moduleIdentityIcons";
import { ConfirmSheet } from "../../app/ui/dialog";
import { invokeCommand, isTauriRuntime, openFilesystemPath } from "../../lib/tauri";
import { showNativeContextMenu, type NativeContextMenuItem } from "../../lib/nativeContextMenu";
import { nativeMenuIcons } from "../../lib/nativeMenuIcons";
import { useWorkspaceStore } from "../../store";
import { FileGlyph } from "../workspace/connections/sftp/finderGlyphs";
import { SystemCleanerScanOrb } from "./SystemCleanerScanOrb";
import { useSystemCleanerScanStore } from "./scanState";
import type { SystemCleanerNavigationSection } from "../../app/tutorialNavigationModel";
import type {
  SystemCleanerDirectoryListing,
  SystemCleanerAppxPackage,
  SystemCleanerCleanupPlan,
  SystemCleanerCleanupResult,
  SystemCleanerDiskEntry,
  SystemCleanerDrive,
  SystemCleanerHistoryRecord,
  SystemCleanerOverview,
  SystemCleanerRecipeCatalogEntry,
  SystemCleanerScanProgress,
  SystemCleanerWindowsMaintenanceStatus,
} from "./types";
import "./systemCleaner.css";

type StorageSort = { key: "name" | "size" | "allocated"; direction: "asc" | "desc" };
type MutationKind = "plan" | "clean" | "delete-review" | "uninstall";
type CleanupTone = "accent" | "green" | "amber" | "red";
type CleanupSafety = "safe" | "review" | "risky";
type CleanerApp = SystemCleanerOverview["apps"][number];

const CLEANUP_PRESENTATION: Record<string, { icon: IconComponent; tone: CleanupTone }> = {
  "temp": { icon: Clock, tone: "accent" },
  "windows-temp": { icon: AppWindow, tone: "amber" },
  "browser-cache": { icon: Globe2, tone: "green" },
  "chrome-cache": { icon: Globe2, tone: "accent" },
  "firefox-cache": { icon: Globe2, tone: "amber" },
  "shader-cache": { icon: Sparkles, tone: "green" },
  "thumbnail-cache": { icon: Images, tone: "accent" },
  "crash-dumps": { icon: Bug, tone: "red" },
  "error-reports": { icon: FileText, tone: "amber" },
};

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = units[0];
  for (let index = 1; value >= 1024 && index < units.length; index += 1) {
    value /= 1024;
    unit = units[index];
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${unit}`;
};

const formatCount = (value: number) => new Intl.NumberFormat().format(value);

function cleanupSafety(item: SystemCleanerRecipeCatalogEntry): CleanupSafety {
  return item.safety;
}

function defaultCleanupSelection(items: SystemCleanerOverview["cleanup"]) {
  return items.filter((item) => item.bytes > 0 && item.defaultSelected).map((item) => item.id);
}

function recipeTitle(t: ReturnType<typeof useTranslation>["t"], item: SystemCleanerRecipeCatalogEntry) {
  return t(`systemCleaner.category.${item.id}`);
}

function recipeDescription(t: ReturnType<typeof useTranslation>["t"], item: SystemCleanerRecipeCatalogEntry) {
  return t(`systemCleaner.categoryDescription.${item.id}`);
}

function matchesQuery(query: string, ...values: string[]) {
  const normalized = query.trim().toLocaleLowerCase();
  return normalized.length === 0 || values.some((value) => value.toLocaleLowerCase().includes(normalized));
}

export function SystemCleanerPage({ active, onOpenAssistant, tutorialNavigation }: {
  active: boolean;
  onOpenAssistant: () => void;
  tutorialNavigation?: { section: SystemCleanerNavigationSection; requestId: number };
}) {
  const { t } = useTranslation();
  const notice = useWorkspaceStore((state) => state.showStatusBarNotice);
  const submitAssistantContextSnippet = useWorkspaceStore((state) => state.submitAssistantContextSnippet);
  const scanActive = useSystemCleanerScanStore((state) => state.active);
  const progress = useSystemCleanerScanStore((state) => state.progress);
  const beginScan = useSystemCleanerScanStore((state) => state.beginScan);
  const updateProgress = useSystemCleanerScanStore((state) => state.updateProgress);
  const finishScan = useSystemCleanerScanStore((state) => state.finishScan);
  const [query, setQuery] = useState("");
  const [drives, setDrives] = useState<SystemCleanerDrive[]>([]);
  const [drivesLoaded, setDrivesLoaded] = useState(false);
  const [selectedDrive, setSelectedDrive] = useState("");
  const [overview, setOverview] = useState<SystemCleanerOverview>();
  const [directory, setDirectory] = useState<SystemCleanerDirectoryListing>();
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [mutationKind, setMutationKind] = useState<MutationKind>();
  const [selected, setSelected] = useState<string[]>([]);
  const [selectedReviewPaths, setSelectedReviewPaths] = useState<string[]>([]);
  const [selectedAppIds, setSelectedAppIds] = useState<string[]>([]);
  const [cleanupPlan, setCleanupPlan] = useState<SystemCleanerCleanupPlan>();
  const [cleanupResult, setCleanupResult] = useState<SystemCleanerCleanupResult>();
  const [confirmCleanup, setConfirmCleanup] = useState(false);
  const [confirmReviewDelete, setConfirmReviewDelete] = useState(false);
  const [pendingApps, setPendingApps] = useState<CleanerApp[]>([]);
  const busy = scanActive || mutationKind !== undefined;
  void tutorialNavigation;

  useEffect(() => {
    if (!active || drivesLoaded || !isTauriRuntime()) return;
    let cancelled = false;
    void invokeCommand("system_cleaner_list_drives")
      .then((next) => {
        if (cancelled) return;
        setDrives(next);
        setSelectedDrive((current) => current || next[0]?.path || "");
      })
      .catch((error) => {
        if (!cancelled) notice(t("systemCleaner.error", { message: String(error) }), { tone: "error" });
      })
      .finally(() => {
        if (!cancelled) setDrivesLoaded(true);
      });
    return () => { cancelled = true; };
  }, [active, drivesLoaded, notice, t]);

  const scan = useCallback(async () => {
    if (!isTauriRuntime() || !selectedDrive) return;
    beginScan();
    let unlisten: (() => void) | undefined;
    try {
      unlisten = await listen<SystemCleanerScanProgress>("system-cleaner://scan-progress", ({ payload }) => updateProgress(payload));
      const next = await invokeCommand("system_cleaner_scan", { root: selectedDrive });
      setOverview(next);
      setSelectedDrive(next.scanRoot);
      setDirectory({
        path: next.scanRoot,
        totalBytes: next.totalBytes,
        totalAllocatedBytes: next.totalAllocatedBytes,
        entries: next.largest,
      });
      setSelected(defaultCleanupSelection(next.cleanup));
      setSelectedReviewPaths([]);
      setSelectedAppIds([]);
    } catch (error) {
      notice(t("systemCleaner.error", { message: String(error) }), { tone: "error" });
    } finally {
      unlisten?.();
      finishScan();
    }
  }, [beginScan, finishScan, notice, selectedDrive, t, updateProgress]);

  const selectedBytes = useMemo(() => overview?.cleanup.filter((item) => selected.includes(item.id)).reduce((sum, item) => sum + item.bytes, 0) ?? 0, [overview, selected]);
  const reclaimableBytes = useMemo(() => overview?.cleanup.filter((item) => cleanupSafety(item) === "safe").reduce((sum, item) => sum + item.bytes, 0) ?? 0, [overview]);
  const selectedApps = useMemo(() => overview?.apps.filter((app) => selectedAppIds.includes(app.id)) ?? [], [overview, selectedAppIds]);
  const selectedReviewFiles = useMemo(() => {
    const byPath = new Map(overview?.recommendations.flatMap((category) => category.files).map((file) => [file.path, file]) ?? []);
    return selectedReviewPaths.flatMap((path) => byPath.get(path) ?? []);
  }, [overview, selectedReviewPaths]);
  const selectedReviewBytes = useMemo(() => selectedReviewFiles.reduce((sum, file) => sum + file.allocatedBytes, 0), [selectedReviewFiles]);

  const openDirectory = useCallback(async (path: string) => {
    if (directoryLoading || scanActive) return;
    setDirectoryLoading(true);
    try {
      setDirectory(await invokeCommand("system_cleaner_list_directory", { path }));
    } catch (error) {
      notice(t("systemCleaner.error", { message: String(error) }), { tone: "error" });
    } finally {
      setDirectoryLoading(false);
    }
  }, [directoryLoading, notice, scanActive, t]);

  async function prepareCleanup() {
    setMutationKind("plan");
    try {
      const plan = await invokeCommand("system_cleaner_build_cleanup_plan", { ids: selected });
      setCleanupPlan(plan);
      setCleanupResult(undefined);
      if (plan.items.length === 0) {
        notice(t("systemCleaner.previewEmpty"), { tone: "info" });
      } else {
        setConfirmCleanup(true);
      }
    } catch (error) {
      notice(t("systemCleaner.error", { message: String(error) }), { tone: "error" });
    } finally {
      setMutationKind(undefined);
    }
  }

  async function clean(retryPaths?: string[]) {
    if (!cleanupPlan) return;
    setMutationKind("clean");
    try {
      const result = await invokeCommand("system_cleaner_execute_cleanup_plan", {
        token: cleanupPlan.token,
        retryPaths,
      });
      setCleanupResult(result);
      notice(t("systemCleaner.cleanedWithItems", {
        count: result.deletedItems,
        size: formatBytes(result.freedBytes),
        skipped: result.skipped.length,
      }), { tone: result.skipped.length > 0 ? "warning" : "success" });
      await scan();
    } catch (error) {
      notice(t("systemCleaner.error", { message: String(error) }), { tone: "error" });
    } finally {
      setMutationKind(undefined);
    }
  }

  async function deleteReviewFiles() {
    setMutationKind("delete-review");
    try {
      const freed = await invokeCommand("system_cleaner_delete_review_files", { paths: selectedReviewFiles.map((file) => file.path) });
      notice(t("systemCleaner.reviewDeleted", { size: formatBytes(freed) }), { tone: "success" });
      await scan();
    } catch (error) {
      notice(t("systemCleaner.error", { message: String(error) }), { tone: "error" });
    } finally {
      setMutationKind(undefined);
    }
  }

  async function uninstallPending() {
    if (pendingApps.length === 0) return;
    const apps = pendingApps;
    setPendingApps([]);
    setMutationKind("uninstall");
    try {
      for (const app of apps) {
        await invokeCommand("system_cleaner_uninstall", { appId: app.id });
      }
      notice(apps.length === 1
        ? t("systemCleaner.uninstalled", { name: apps[0].name })
        : t("systemCleaner.uninstalledCount", { count: apps.length }), { tone: "success" });
      setSelectedAppIds([]);
      await scan();
    } catch (error) {
      notice(t("systemCleaner.error", { message: String(error) }), { tone: "error" });
    } finally {
      setMutationKind(undefined);
    }
  }

  function explainApp(app: CleanerApp) {
    submitAssistantContextSnippet({
      id: `system-cleaner-app-${Date.now()}`,
      kind: "text",
      sourceLabel: app.name,
      text: JSON.stringify({ name: app.name, packageId: app.id, version: app.version }, null, 2),
      capturedAt: new Date().toISOString(),
    }, t("systemCleaner.aiExplainPrompt", { name: app.name }));
    onOpenAssistant();
    notice(t("workspace.sentToAi"), { tone: "success" });
  }

  function selectDrive(path: string) {
    setSelectedDrive(path);
    setOverview(undefined);
    setDirectory(undefined);
    setSelected([]);
    setSelectedReviewPaths([]);
    setSelectedAppIds([]);
    setCleanupPlan(undefined);
    setCleanupResult(undefined);
  }

  const pendingAppCount = pendingApps.length;
  return <main className="system-cleaner-page" data-active={active} data-tutorial-id="systemCleaner.page">
    <ModuleHeader>
      <ModuleHeaderLead><ModuleIconTile module="system-cleaner"><SystemCleanerModuleIcon size={16} aria-hidden="true" /></ModuleIconTile><ModuleHeaderTitle>{t("systemCleaner.title")}</ModuleHeaderTitle></ModuleHeaderLead>
      <label className="system-cleaner-header-drive">
        <HardDrive size={14} aria-hidden="true" />
        <select aria-label={t("systemCleaner.select")} value={selectedDrive} disabled={busy || drives.length === 0} onChange={(event) => selectDrive(event.currentTarget.value)}>
          {drives.map((drive) => <option value={drive.path} key={drive.path}>{drive.path}</option>)}
        </select>
        <ChevronDown size={12} aria-hidden="true" />
      </label>
      <ModuleHeaderSpacer />
      {overview ? <label className="system-cleaner-search" data-tutorial-id="systemCleaner.search"><Search size={14} aria-hidden="true" /><input value={query} placeholder={t("common.search")} aria-label={t("common.search")} onChange={(event) => setQuery(event.currentTarget.value)} /></label> : null}
      <button type="button" className="toolbar-button" data-tutorial-id="systemCleaner.scan" disabled={busy || !selectedDrive} onClick={() => void scan()}><RefreshCw size={15} className={scanActive ? "spin" : ""} />{t("systemCleaner.scan")}</button>
    </ModuleHeader>
    <section className="system-cleaner-content" data-tutorial-id="systemCleaner.content">
      {scanActive ? <ScanOverlay progress={progress} /> : null}
      <div className="system-cleaner-overview-page" data-tutorial-id="systemCleaner.overview">
        <DriveOverview
          busy={busy}
          drives={drives}
          overview={overview}
          selectedDrive={selectedDrive}
          onScan={() => void scan()}
          onSelectDrive={selectDrive}
        />
        {!overview && !scanActive ? <section className="system-cleaner-empty-state">
          <span className="system-cleaner-empty-icon"><Gauge size={24} /></span>
          <div><h2>{t("systemCleaner.overview")}</h2><p>{t("systemCleaner.scanHint")}</p></div>
          <button type="button" className="primary-button" disabled={!selectedDrive} onClick={() => void scan()}><RefreshCw size={14} />{t("systemCleaner.scan")}</button>
        </section> : null}
        {overview && directory ? <>
          <ScanSummary overview={overview} reclaimableBytes={reclaimableBytes} />
          <div className="system-cleaner-overview-sections">
            <article className="system-cleaner-workbench-section system-cleaner-storage-section" data-tutorial-id="systemCleaner.storage">
              <StorageView directory={directory} loading={directoryLoading} overview={overview} query={query} onOpenDirectory={openDirectory} />
            </article>
            <article className="system-cleaner-workbench-section" data-tutorial-id="systemCleaner.cleanup">
              <CleanupView
                busy={busy}
                cleaning={mutationKind === "clean"}
                items={overview.cleanup}
                query={query}
                selected={selected}
                selectedBytes={selectedBytes}
                cleanupPlan={cleanupPlan}
                cleanupResult={cleanupResult}
                onClean={() => void prepareCleanup()}
                onCancel={() => void invokeCommand("system_cleaner_cancel_cleanup")}
                onRetry={() => void clean(cleanupResult?.skipped.map((item) => item.path))}
                onReset={() => { setCleanupPlan(undefined); setCleanupResult(undefined); setSelected(defaultCleanupSelection(overview.cleanup)); }}
                onToggle={(id) => { setCleanupPlan(undefined); setCleanupResult(undefined); setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]); }}
                onToggleSafe={(checked) => setSelected((current) => {
                  const safeIds = overview.cleanup.filter((item) => item.bytes > 0 && cleanupSafety(item) === "safe").map((item) => item.id);
                  setCleanupPlan(undefined);
                  setCleanupResult(undefined);
                  return checked ? Array.from(new Set([...current, ...safeIds])) : current.filter((id) => !safeIds.includes(id));
                })}
              />
            </article>
            <article className="system-cleaner-workbench-section" data-tutorial-id="systemCleaner.recommendations">
              <RecommendationsView
                busy={busy}
                deleting={mutationKind === "delete-review"}
                categories={overview.recommendations}
                query={query}
                selectedPaths={selectedReviewPaths}
                selectedBytes={selectedReviewBytes}
                onDelete={() => setConfirmReviewDelete(true)}
                onToggle={(path) => setSelectedReviewPaths((current) => current.includes(path) ? current.filter((item) => item !== path) : [...current, path])}
              />
            </article>
            <article className="system-cleaner-workbench-section" data-tutorial-id="systemCleaner.apps">
              <AppsView
                apps={overview.apps}
                busy={busy}
                query={query}
                selectedIds={selectedAppIds}
                onExplain={explainApp}
                onToggle={(id) => setSelectedAppIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])}
                onUninstall={(app) => setPendingApps([app])}
                onUninstallSelected={() => setPendingApps(selectedApps)}
              />
            </article>
          </div>
        </> : null}
        <SystemToolsView />
      </div>
    </section>
    {confirmCleanup && cleanupPlan ? <ConfirmSheet tone="danger" title={t("systemCleaner.cleanTitle")} message={cleanupPlan.blockedProcesses.length > 0
      ? t("systemCleaner.cleanPlanBlockedMessage", { count: cleanupPlan.items.length, size: formatBytes(cleanupPlan.totalBytes), processes: cleanupPlan.blockedProcesses.join(", ") })
      : t("systemCleaner.cleanPlanMessage", { count: cleanupPlan.items.length, size: formatBytes(cleanupPlan.totalBytes) })} confirmLabel={t("systemCleaner.clean", { size: formatBytes(cleanupPlan.totalBytes) })} onConfirm={() => { setConfirmCleanup(false); void clean(); }} onCancel={() => setConfirmCleanup(false)} /> : null}
    {confirmReviewDelete ? <ConfirmSheet tone="danger" title={t("systemCleaner.deleteReviewTitle")} message={t("systemCleaner.deleteReviewMessage", { count: selectedReviewFiles.length, size: formatBytes(selectedReviewBytes) })} confirmLabel={t("systemCleaner.deleteSelected", { count: selectedReviewFiles.length })} onConfirm={() => { setConfirmReviewDelete(false); void deleteReviewFiles(); }} onCancel={() => setConfirmReviewDelete(false)} /> : null}
    {pendingAppCount > 0 ? <ConfirmSheet
      tone="danger"
      title={pendingAppCount === 1 ? t("systemCleaner.uninstallTitle") : t("systemCleaner.uninstallSelectionTitle")}
      message={pendingAppCount === 1 ? t("systemCleaner.uninstallMessage", { name: pendingApps[0].name }) : t("systemCleaner.uninstallSelectionMessage", { count: pendingAppCount })}
      confirmLabel={pendingAppCount === 1 ? t("systemCleaner.uninstall") : t("systemCleaner.uninstallSelected", { count: pendingAppCount })}
      onConfirm={() => void uninstallPending()}
      onCancel={() => setPendingApps([])}
    /> : null}
  </main>;
}

function DriveOverview({ busy, drives, onScan, onSelectDrive, overview, selectedDrive }: {
  busy: boolean;
  drives: SystemCleanerDrive[];
  onScan: () => void;
  onSelectDrive: (path: string) => void;
  overview?: SystemCleanerOverview;
  selectedDrive: string;
}) {
  const { t } = useTranslation();
  return <section className="system-cleaner-drive-overview" data-tutorial-id="systemCleaner.drive">
    <header><div><span>{t("systemCleaner.storage")}</span><h2>{selectedDrive || "—"}</h2></div><button type="button" className="toolbar-button" disabled={busy || !selectedDrive} onClick={onScan}><RefreshCw size={14} />{t("systemCleaner.scan")}</button></header>
    <div className="system-cleaner-drive-grid">{drives.map((drive) => {
      const selected = drive.path === selectedDrive;
      const capacity = selected && overview ? overview.diskCapacityBytes : drive.capacityBytes;
      const free = selected && overview ? overview.diskFreeBytes : drive.freeBytes;
      const used = Math.max(0, capacity - free);
      const usedPercent = capacity > 0 ? Math.min(100, used / capacity * 100) : 0;
      return <button type="button" className={`system-cleaner-drive-choice${selected ? " selected" : ""}`} aria-pressed={selected} disabled={busy} key={drive.path} onClick={() => onSelectDrive(drive.path)}>
        <span className="system-cleaner-drive-choice-head"><HardDrive size={17} /><strong>{drive.path}</strong>{selected ? <i /> : null}</span>
        <span className="system-cleaner-drive-meter"><i style={{ width: `${usedPercent}%` }} /></span>
        <span className="system-cleaner-drive-choice-detail"><b>{formatBytes(used)}</b><small>{t("systemCleaner.freeSpace")} {formatBytes(free)}</small></span>
      </button>;
    })}</div>
  </section>;
}

function ScanSummary({ overview, reclaimableBytes }: {
  overview?: SystemCleanerOverview;
  reclaimableBytes: number;
}) {
  const { t } = useTranslation();
  if (!overview) return null;
  const capacity = overview.diskCapacityBytes;
  const free = overview.diskFreeBytes;
  const used = Math.max(0, capacity - free);
  const elapsedSeconds = Math.max(.1, overview.elapsedMs / 1000).toFixed(1);
  return <section className="system-cleaner-scan-summary">
    <header><h2>{t("systemCleaner.overview")}</h2><p>{t("systemCleaner.scanComplete", { seconds: elapsedSeconds })} · {t("systemCleaner.items", { count: formatCount(overview.fileCount) })}</p></header>
    <div className="system-cleaner-metric-grid">
      <Metric label={t("systemCleaner.usedSpace")} value={formatBytes(used)} detail={`${(used / Math.max(1, overview.diskCapacityBytes) * 100).toFixed(1)}%`} />
      <Metric label={t("systemCleaner.freeSpace")} value={formatBytes(overview.diskFreeBytes)} detail={`${(overview.diskFreeBytes / Math.max(1, overview.diskCapacityBytes) * 100).toFixed(1)}%`} />
      <Metric label={t("systemCleaner.cleanupHeading")} value={formatBytes(reclaimableBytes)} detail={t("systemCleaner.safeCategories", { count: overview.cleanup.filter((item) => cleanupSafety(item) === "safe").length })} accent />
      <Metric label={t("systemCleaner.appsHeading")} value={formatCount(overview.apps.length)} detail={t("systemCleaner.apps")} />
    </div>
  </section>;
}

function Metric({ accent, detail, label, value }: { accent?: boolean; detail: string; label: string; value: string }) {
  return <article className={`system-cleaner-metric${accent ? " accent" : ""}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}

function CleanupView({ busy, cleaning, cleanupPlan, cleanupResult, items, onCancel, onClean, onReset, onRetry, onToggle, onToggleSafe, query, selected, selectedBytes }: {
  busy: boolean;
  cleaning: boolean;
  cleanupPlan?: SystemCleanerCleanupPlan;
  cleanupResult?: SystemCleanerCleanupResult;
  items: SystemCleanerOverview["cleanup"];
  onCancel: () => void;
  onClean: () => void;
  onReset: () => void;
  onRetry: () => void;
  onToggle: (id: string) => void;
  onToggleSafe: (checked: boolean) => void;
  query: string;
  selected: string[];
  selectedBytes: number;
}) {
  const { t } = useTranslation();
  const visibleItems = items.filter((item) => matchesQuery(query, recipeTitle(t, item), recipeDescription(t, item), item.displayPath, item.source));
  const safeItems = items.filter((item) => item.bytes > 0 && cleanupSafety(item) === "safe");
  const allSafeSelected = safeItems.length > 0 && safeItems.every((item) => selected.includes(item.id));
  return <div className="system-cleaner-view system-cleaner-cleanup-view">
    <header className="system-cleaner-section-head"><h2>{t("systemCleaner.cleanup")}</h2><p>{t("systemCleaner.selectedCategories", { count: selected.length, total: items.length })}</p><label className="system-cleaner-select-safe"><input type="checkbox" checked={allSafeSelected} disabled={busy} onChange={(event) => onToggleSafe(event.currentTarget.checked)} />{t("systemCleaner.selectAllSafe")}</label></header>
    <div className="system-cleaner-cleanup-groups">
      {(["safe", "review", "risky"] as const).map((safety) => {
        const group = visibleItems.filter((item) => cleanupSafety(item) === safety);
        if (group.length === 0) return null;
        const bytes = group.reduce((sum, item) => sum + item.bytes, 0);
        const renderedGroup = group.slice(0, 500);
        return <section className="system-cleaner-cleanup-group" key={safety}>
          <header><SafetyBadge safety={safety} /><strong>{t(`systemCleaner.safety.${safety}`)}</strong><span>{formatBytes(bytes)}</span></header>
          <div>{renderedGroup.map((item) => {
            const checked = selected.includes(item.id);
            const presentation = CLEANUP_PRESENTATION[item.id] ?? { icon: FileText, tone: "accent" as const };
            const Icon = presentation.icon;
            return <label className={`system-cleaner-cleanup-row${checked ? " selected" : ""}`} data-tone={presentation.tone} key={item.id}>
              <input type="checkbox" checked={checked} disabled={busy || (item.builtIn && item.bytes === 0)} onChange={() => onToggle(item.id)} />
              <span className="system-cleaner-row-icon"><Icon size={17} /></span>
              <span className="system-cleaner-cleanup-name"><strong>{recipeTitle(t, item)}</strong><bdi dir="ltr" title={item.displayPath}>{item.displayPath}</bdi></span>
              <span className="system-cleaner-cleanup-description">{recipeDescription(t, item)}{item.runningProcesses.length > 0 ? ` · ${t("systemCleaner.processRunning", { processes: item.runningProcesses.join(", ") })}` : ""}</span>
              <strong className="system-cleaner-row-size">{formatBytes(item.bytes)}</strong>
            </label>;
          })}{group.length > renderedGroup.length ? <p className="system-cleaner-recipe-truncated">{t("systemCleaner.recipeRowsTruncated", { count: group.length - renderedGroup.length })}</p> : null}</div>
        </section>;
      })}
    </div>
    {cleanupPlan ? <CleanupPlanPreview plan={cleanupPlan} result={cleanupResult} onRetry={onRetry} /> : null}
    <footer className="system-cleaner-action-bar"><div><span>{t("systemCleaner.selectedCategories", { count: selected.length, total: items.length })}</span><strong>{formatBytes(selectedBytes)}</strong></div><button type="button" className="toolbar-button" disabled={busy} onClick={onReset}><RotateCcw size={14} />{t("systemCleaner.resetDefaults")}</button><button type="button" className="primary-button" disabled={busy || selected.length === 0} onClick={onClean}><Eye size={15} />{t("systemCleaner.previewCleanup")}</button></footer>
    {cleaning ? <div className="system-cleaner-operation-overlay" role="status"><SystemCleanerScanOrb size={64} state="working" label={t("systemCleaner.cleaningWorking")} /><strong>{t("systemCleaner.cleaningWorking")}</strong><button type="button" className="toolbar-button" onClick={onCancel}>{t("common.cancel")}</button></div> : null}
  </div>;
}

function CleanupPlanPreview({ onRetry, plan, result }: { onRetry: () => void; plan: SystemCleanerCleanupPlan; result?: SystemCleanerCleanupResult }) {
  const { t } = useTranslation();
  const skippedPaths = new Set(result?.skipped.map((item) => item.path) ?? []);
  return <section className="system-cleaner-plan-preview">
    <header><div><strong>{t("systemCleaner.previewTitle")}</strong><span>{t("systemCleaner.previewSummary", { count: plan.items.length, size: formatBytes(plan.totalBytes), excluded: plan.excludedItems })}</span></div>{result && result.skipped.length > 0 ? <button type="button" className="toolbar-button" onClick={onRetry}><RotateCcw size={14} />{t("systemCleaner.retrySkipped", { count: result.skipped.length })}</button> : null}</header>
    {plan.blockedProcesses.length > 0 ? <p className="system-cleaner-plan-warning">{t("systemCleaner.closeAppsWarning", { processes: plan.blockedProcesses.join(", ") })}</p> : null}
    <div>{plan.items.slice(0, 500).map((item) => <div className={skippedPaths.has(item.path) ? "skipped" : ""} key={`${item.recipeId}-${item.path}`}><bdi dir="ltr" title={item.path}>{item.path}</bdi><strong>{formatBytes(item.bytes)}</strong></div>)}</div>
    {plan.items.length > 500 ? <small>{t("systemCleaner.previewTruncated", { count: plan.items.length - 500 })}</small> : null}
  </section>;
}

type MaintenanceAction = "recycleBin" | "deliveryOptimization" | "componentCleanup";

function SystemToolsView() {
  const { t } = useTranslation();
  const notice = useWorkspaceStore((state) => state.showStatusBarNotice);
  const [history, setHistory] = useState<SystemCleanerHistoryRecord[]>([]);
  const [appx, setAppx] = useState<SystemCleanerAppxPackage[]>([]);
  const [maintenance, setMaintenance] = useState<SystemCleanerWindowsMaintenanceStatus>();
  const [loading, setLoading] = useState(false);
  const [pendingAppx, setPendingAppx] = useState<SystemCleanerAppxPackage>();
  const [pendingMaintenance, setPendingMaintenance] = useState<MaintenanceAction>();

  const refresh = useCallback(async () => {
    if (!isTauriRuntime()) return;
    setLoading(true);
    try {
      const [runs, packages, status] = await Promise.all([
        invokeCommand("system_cleaner_history", { limit: 100 }),
        invokeCommand("system_cleaner_list_appx_packages", undefined),
        invokeCommand("system_cleaner_windows_maintenance_status", undefined),
      ]);
      setHistory(runs);
      setAppx(packages);
      setMaintenance(status);
    } catch (error) {
      notice(t("systemCleaner.error", { message: String(error) }), { tone: "error" });
    } finally {
      setLoading(false);
    }
  }, [notice, t]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function loadAppx() {
    setLoading(true);
    try {
      const [packages, status] = await Promise.all([
        invokeCommand("system_cleaner_list_appx_packages", undefined),
        invokeCommand("system_cleaner_windows_maintenance_status", undefined),
      ]);
      setAppx(packages);
      setMaintenance(status);
    } catch (error) {
      notice(t("systemCleaner.error", { message: String(error) }), { tone: "error" });
    } finally {
      setLoading(false);
    }
  }

  async function runMaintenance() {
    if (!pendingMaintenance) return;
    const action = pendingMaintenance;
    setPendingMaintenance(undefined);
    setLoading(true);
    try {
      if (action === "recycleBin") {
        const freed = await invokeCommand("system_cleaner_empty_recycle_bin", undefined);
        notice(t("systemCleaner.recycleBinCleaned", { size: formatBytes(freed) }), { tone: "success" });
      } else if (action === "deliveryOptimization") {
        await invokeCommand("system_cleaner_clear_delivery_optimization", undefined);
        notice(t("systemCleaner.deliveryOptimizationCleaned"), { tone: "success" });
      } else {
        await invokeCommand("system_cleaner_start_component_cleanup", undefined);
        notice(t("systemCleaner.componentCleanupCompleted"), { tone: "success" });
      }
      await loadAppx();
    } catch (error) {
      notice(t("systemCleaner.error", { message: String(error) }), { tone: "error" });
    } finally {
      setLoading(false);
    }
  }

  async function removeAppx() {
    if (!pendingAppx) return;
    const app = pendingAppx;
    setPendingAppx(undefined);
    setLoading(true);
    try {
      await invokeCommand("system_cleaner_remove_appx_package", { packageFullName: app.packageFullName });
      notice(t("systemCleaner.appxRemoved", { name: app.name }), { tone: "success" });
      await loadAppx();
    } catch (error) {
      notice(t("systemCleaner.error", { message: String(error) }), { tone: "error" });
    } finally {
      setLoading(false);
    }
  }

  return <article className="system-cleaner-system-tools" aria-busy={loading}>
    <header className="system-cleaner-section-head"><h2>{t("systemCleaner.windowsMaintenance")}</h2><p>{t("systemCleaner.windowsMaintenanceDescription")}</p></header>
    <div className="system-cleaner-system-tools-grid">
      <WindowsMaintenance loading={loading} status={maintenance} onRun={setPendingMaintenance} />
      <AppxList apps={appx} loading={loading} onRefresh={() => void loadAppx()} onRemove={setPendingAppx} />
      <HistoryList history={history} />
    </div>
    {pendingAppx ? <ConfirmSheet tone="danger" title={t("systemCleaner.appxRemoveTitle")} message={t("systemCleaner.appxRemoveMessage", { name: pendingAppx.name, packageId: pendingAppx.packageFullName })} confirmLabel={t("systemCleaner.appxRemove")} onConfirm={() => void removeAppx()} onCancel={() => setPendingAppx(undefined)} /> : null}
    {pendingMaintenance ? <ConfirmSheet tone={pendingMaintenance === "recycleBin" ? "danger" : "info"} title={t(`systemCleaner.maintenanceConfirm.${pendingMaintenance}.title`)} message={t(`systemCleaner.maintenanceConfirm.${pendingMaintenance}.message`, { count: maintenance?.recycleBinItems ?? 0, size: formatBytes(maintenance?.recycleBinBytes ?? 0) })} confirmLabel={t(`systemCleaner.maintenanceConfirm.${pendingMaintenance}.confirm`)} onConfirm={() => void runMaintenance()} onCancel={() => setPendingMaintenance(undefined)} /> : null}
  </article>;
}

function HistoryList({ history }: { history: SystemCleanerHistoryRecord[] }) {
  const { t } = useTranslation();
  return <section className="system-cleaner-management-panel"><header><div><h3>{t("systemCleaner.cleanupHistory")}</h3><p>{t("systemCleaner.cleanupHistoryDescription")}</p></div></header><div className="system-cleaner-history-list">{history.length > 0 ? history.map((run) => <article key={run.id}><span className={`system-cleaner-history-status ${run.status}`} /><div><strong>{t(`systemCleaner.historyStatus.${run.status}`)}</strong><time dateTime={run.completedAt}>{new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(run.completedAt))}</time></div><span>{t("systemCleaner.historyItems", { deleted: run.deletedItems, skipped: run.skippedItems })}</span><strong>{formatBytes(run.freedBytes)}</strong></article>) : <p>{t("systemCleaner.noCleanupHistory")}</p>}</div></section>;
}

function AppxList({ apps, loading, onRefresh, onRemove }: { apps: SystemCleanerAppxPackage[]; loading: boolean; onRefresh: () => void; onRemove: (app: SystemCleanerAppxPackage) => void }) {
  const { t } = useTranslation();
  return <section className="system-cleaner-management-panel"><header><div><h3>{t("systemCleaner.windowsApps")}</h3><p>{t("systemCleaner.windowsAppsDescription")}</p></div><button type="button" className="toolbar-button" disabled={loading} onClick={onRefresh}><RefreshCw size={14} className={loading ? "spin" : ""} />{t("common.refresh")}</button></header><div className="system-cleaner-appx-list">{apps.map((app) => <article key={app.packageFullName}><span><strong>{app.name}</strong><bdi dir="ltr" title={app.packageFullName}>{app.packageFullName}</bdi></span><small>{app.version}</small><button type="button" className="system-cleaner-uninstall" onClick={() => onRemove(app)}>{t("systemCleaner.appxRemove")}</button></article>)}</div></section>;
}

function WindowsMaintenance({ loading, onRun, status }: { loading: boolean; onRun: (action: MaintenanceAction) => void; status?: SystemCleanerWindowsMaintenanceStatus }) {
  const { t } = useTranslation();
  const actions: Array<{ id: MaintenanceAction; enabled: boolean; detail: string }> = [
    { id: "recycleBin", enabled: (status?.recycleBinItems ?? 0) > 0, detail: t("systemCleaner.recycleBinDetail", { count: status?.recycleBinItems ?? 0, size: formatBytes(status?.recycleBinBytes ?? 0) }) },
    { id: "deliveryOptimization", enabled: status?.deliveryOptimizationAvailable ?? false, detail: t("systemCleaner.deliveryOptimizationDescription") },
    { id: "componentCleanup", enabled: status?.componentCleanupAvailable ?? false, detail: t("systemCleaner.componentCleanupDescription") },
  ];
  return <section className="system-cleaner-management-panel"><header><div><h3>{t("systemCleaner.windowsMaintenance")}</h3><p>{t("systemCleaner.windowsMaintenanceDescription")}</p></div></header><div className="system-cleaner-maintenance-list">{actions.map((action) => <article key={action.id}><span><strong>{t(`systemCleaner.maintenanceAction.${action.id}`)}</strong><small>{action.detail}</small></span><button type="button" className="toolbar-button" disabled={loading || !action.enabled} onClick={() => onRun(action.id)}>{t("systemCleaner.runMaintenance")}</button></article>)}</div></section>;
}

function RecommendationsView({ busy, categories, deleting, onDelete, onToggle, query, selectedBytes, selectedPaths }: {
  busy: boolean;
  categories: SystemCleanerOverview["recommendations"];
  deleting: boolean;
  onDelete: () => void;
  onToggle: (path: string) => void;
  query: string;
  selectedBytes: number;
  selectedPaths: string[];
}) {
  const { t } = useTranslation();
  const notice = useWorkspaceStore((state) => state.showStatusBarNotice);
  const visibleCategories = categories.map((category) => ({
    ...category,
    files: category.files.filter((file) => matchesQuery(query, file.name, file.path, t(`systemCleaner.recommendation.${category.id}`))),
  }));
  const visibleCount = visibleCategories.reduce((sum, category) => sum + category.files.length, 0);

  function openReviewFile(path: string) {
    void openFilesystemPath(path).catch((error) => notice(t("systemCleaner.error", { message: String(error) }), { tone: "error" }));
  }

  return <div className="system-cleaner-view system-cleaner-recommendations-view">
    <header className="system-cleaner-section-head"><h2>{t("systemCleaner.recommendations")}</h2><p>{t("systemCleaner.recommendationSummary", { count: visibleCount })}</p></header>
    <div className="system-cleaner-recommendation-groups">
      {visibleCategories.map((category) => <section className="system-cleaner-recommendation-group" key={category.id}>
        <header><span className="system-cleaner-row-icon"><Clock size={17} /></span><div><strong>{t(`systemCleaner.recommendation.${category.id}`)}</strong><p>{t(`systemCleaner.recommendationDescription.${category.id}`)}</p></div><span>{formatBytes(category.bytes)}</span></header>
        {category.files.length > 0 ? <div className="system-cleaner-review-table">
          <div className="system-cleaner-review-columns"><span /><span>{t("systemCleaner.name")}</span><span>{t("systemCleaner.lastChanged")}</span><span>{t("systemCleaner.size")}</span><span /></div>
          {category.files.map((file) => {
            const checked = selectedPaths.includes(file.path);
            return <label className={`system-cleaner-review-row${checked ? " selected" : ""}`} key={`${category.id}-${file.path}`}>
              <input type="checkbox" checked={checked} disabled={busy} onChange={() => onToggle(file.path)} />
              <span className="system-cleaner-review-name"><FileText size={16} /><span><strong>{file.name}</strong><bdi dir="ltr" title={file.path}>{file.path}</bdi></span></span>
              <time dateTime={new Date(file.modifiedUnixMs).toISOString()}>{new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(file.modifiedUnixMs)}</time>
              <strong className="system-cleaner-row-size">{formatBytes(file.allocatedBytes)}</strong>
              <button type="button" className="system-cleaner-ai-explain" disabled={busy} onClick={(event) => { event.preventDefault(); openReviewFile(file.path); }}>{t("common.open")}</button>
            </label>;
          })}
        </div> : <p className="system-cleaner-no-recommendations">{t("systemCleaner.noRecommendations")}</p>}
      </section>)}
    </div>
    <footer className="system-cleaner-action-bar"><div><span>{t("systemCleaner.selectedReviewFiles", { count: selectedPaths.length, size: formatBytes(selectedBytes) })}</span><strong>{formatBytes(selectedBytes)}</strong></div><button type="button" className="system-cleaner-uninstall primary" disabled={busy || selectedPaths.length === 0} onClick={onDelete}><Trash2 size={15} />{t("systemCleaner.deleteSelected", { count: selectedPaths.length })}</button></footer>
    {deleting ? <div className="system-cleaner-operation-overlay" role="status"><SystemCleanerScanOrb size={64} state="working" label={t("systemCleaner.deletingReviewFiles")} /><strong>{t("systemCleaner.deletingReviewFiles")}</strong></div> : null}
  </div>;
}

function AppsView({ apps, busy, onExplain, onToggle, onUninstall, onUninstallSelected, query, selectedIds }: {
  apps: CleanerApp[];
  busy: boolean;
  onExplain: (app: CleanerApp) => void;
  onToggle: (id: string) => void;
  onUninstall: (app: CleanerApp) => void;
  onUninstallSelected: () => void;
  query: string;
  selectedIds: string[];
}) {
  const { t } = useTranslation();
  const filtered = apps.filter((app) => matchesQuery(query, app.name, app.id, app.version));
  return <div className="system-cleaner-view system-cleaner-apps-view">
    <header className="system-cleaner-section-head"><h2>{t("systemCleaner.apps")}</h2><p>{t("systemCleaner.items", { count: formatCount(filtered.length) })}</p></header>
    <section className="system-cleaner-app-table">
      <div className="system-cleaner-app-columns"><span /><span>{t("systemCleaner.name")}</span><span>{t("systemCleaner.packageId")}</span><span>{t("systemCleaner.version")}</span><span /></div>
      <div className="system-cleaner-app-body">{filtered.map((app, index) => <div className={`system-cleaner-app-row${selectedIds.includes(app.id) ? " selected" : ""}`} key={`${app.id}-${app.version}-${index}`}>
        <input type="checkbox" checked={selectedIds.includes(app.id)} disabled={busy} aria-label={app.name} onChange={() => onToggle(app.id)} />
        <span className="system-cleaner-app-name"><Package size={17} /><strong>{app.name}</strong></span>
        <bdi dir="ltr" title={app.id}>{app.id}</bdi>
        <span className="system-cleaner-app-version">{app.version}</span>
        <span className="system-cleaner-app-actions"><button type="button" className="system-cleaner-ai-explain" disabled={busy} onClick={() => onExplain(app)}><Sparkles size={14} />{t("systemCleaner.aiExplain")}</button><button type="button" className="system-cleaner-uninstall" disabled={busy} onClick={() => onUninstall(app)}><Trash2 size={14} />{t("systemCleaner.uninstall")}</button></span>
      </div>)}</div>
      <footer><span>{t("systemCleaner.items", { count: formatCount(filtered.length) })}</span><span>{t("systemCleaner.uninstallUacNote")}</span></footer>
    </section>
    <footer className="system-cleaner-action-bar"><div><span>{t("systemCleaner.selectedApps", { count: selectedIds.length })}</span></div><button type="button" className="system-cleaner-uninstall primary" disabled={busy || selectedIds.length === 0} onClick={onUninstallSelected}><Trash2 size={15} />{t("systemCleaner.uninstallSelected", { count: selectedIds.length })}</button></footer>
  </div>;
}

function StorageView({ directory, loading, onOpenDirectory, overview, query }: {
  directory: SystemCleanerDirectoryListing;
  loading: boolean;
  onOpenDirectory: (path: string) => void;
  overview: SystemCleanerOverview;
  query: string;
}) {
  const { t } = useTranslation();
  return <div className="system-cleaner-view system-cleaner-storage-view"><header className="system-cleaner-section-head"><h2>{t("systemCleaner.storage")}</h2><p>{t("systemCleaner.storageHeading", { root: directory.path })}</p></header><StorageBrowser directory={directory} loading={loading} onOpenDirectory={onOpenDirectory} overview={overview} query={query} /></div>;
}

function ScanOverlay({ progress }: { progress?: SystemCleanerScanProgress }) {
  const { t } = useTranslation();
  const label = t("systemCleaner.scanning");
  return <div className="system-cleaner-scan-overlay" role="status"><SystemCleanerScanOrb size={64} label={label} /><strong>{t("systemCleaner.scanProgress", { files: formatCount(progress?.files ?? 0), size: formatBytes(progress?.bytes ?? 0) })}</strong>{progress?.currentPath ? <bdi className="system-cleaner-scan-path" dir="ltr" title={progress.currentPath}>{progress.currentPath}</bdi> : <span>{label}</span>}</div>;
}

function StorageBrowser({ directory, loading, onOpenDirectory, overview, query }: {
  directory: SystemCleanerDirectoryListing;
  loading: boolean;
  onOpenDirectory: (path: string) => void;
  overview: SystemCleanerOverview;
  query: string;
}) {
  const { t } = useTranslation();
  const notice = useWorkspaceStore((state) => state.showStatusBarNotice);
  const [selectedPath, setSelectedPath] = useState<string>();
  const [sort, setSort] = useState<StorageSort>({ key: "allocated", direction: "desc" });
  useEffect(() => setSelectedPath(undefined), [directory.path]);

  const entries = useMemo(() => directory.entries.filter((entry) => matchesQuery(query, entry.name, entry.path)).sort((left, right) => {
    const folderOrder = Number(right.isDirectory) - Number(left.isDirectory);
    if (folderOrder !== 0) return folderOrder;
    const direction = sort.direction === "asc" ? 1 : -1;
    if (sort.key === "size") return (left.bytes - right.bytes) * direction;
    if (sort.key === "allocated") return (left.allocatedBytes - right.allocatedBytes) * direction;
    return left.name.localeCompare(right.name, undefined, { numeric: true }) * direction;
  }), [directory.entries, query, sort]);
  const crumbs = useMemo(() => buildCrumbs(overview.scanRoot, directory.path), [directory.path, overview.scanRoot]);

  function toggleSort(key: StorageSort["key"]) {
    setSort((current) => current.key === key ? { key, direction: current.direction === "asc" ? "desc" : "asc" } : { key, direction: key === "name" ? "asc" : "desc" });
  }

  function openEntry(entry: SystemCleanerDiskEntry) {
    if (entry.isDirectory) {
      onOpenDirectory(entry.path);
      return;
    }
    void openFilesystemPath(entry.path).catch((error) => notice(t("systemCleaner.error", { message: String(error) }), { tone: "error" }));
  }

  function showEntryContextMenu(entry: SystemCleanerDiskEntry, event: ReactMouseEvent) {
    event.preventDefault();
    setSelectedPath(entry.path);
    const items: NativeContextMenuItem[] = [
      { kind: "item", label: t("common.open"), iconSvg: nativeMenuIcons.folderOpen, action: () => openEntry(entry) },
      { kind: "separator" },
      { kind: "item", label: t("common.copy"), iconSvg: nativeMenuIcons.copy, action: () => { void invokeCommand("set_local_file_clipboard", { request: { operation: "copy", paths: [entry.path] } }).catch((error) => notice(t("systemCleaner.error", { message: String(error) }), { tone: "error" })); } },
      { kind: "item", label: t("sftp.copyPath"), iconSvg: nativeMenuIcons.copy, action: () => void navigator.clipboard?.writeText(entry.path).catch((error) => notice(t("systemCleaner.error", { message: String(error) }), { tone: "error" })) },
    ];
    void showNativeContextMenu(items, { x: event.clientX, y: event.clientY });
  }

  return <section className="system-cleaner-browser" aria-busy={loading}>
    <div className="system-cleaner-browser-toolbar"><nav className="system-cleaner-crumbs" aria-label={directory.path}>{crumbs.map((crumb, index) => <span className="system-cleaner-crumb-segment" key={crumb.path}>{index > 0 ? <ChevronRight size={13} /> : null}<button type="button" className={index === crumbs.length - 1 ? "current" : ""} disabled={loading || index === crumbs.length - 1} onClick={() => onOpenDirectory(crumb.path)}>{crumb.label}</button></span>)}</nav><button type="button" className="system-cleaner-icon-button" aria-label={t("systemCleaner.parentFolder")} disabled={loading || !directory.parentPath} onClick={() => directory.parentPath && onOpenDirectory(directory.parentPath)}><ArrowUp size={15} /></button></div>
    <div className="system-cleaner-browser-columns"><button type="button" onClick={() => toggleSort("name")}>{t("systemCleaner.name")}{sort.key === "name" ? <ChevronDown className={sort.direction === "asc" ? "ascending" : ""} size={12} /> : null}</button><span>{t("systemCleaner.percentOfFolder")}</span><button type="button" onClick={() => toggleSort("size")}>{t("systemCleaner.size")}{sort.key === "size" ? <ChevronDown className={sort.direction === "asc" ? "ascending" : ""} size={12} /> : null}</button><button type="button" onClick={() => toggleSort("allocated")}>{t("systemCleaner.allocated")}{sort.key === "allocated" ? <ChevronDown className={sort.direction === "asc" ? "ascending" : ""} size={12} /> : null}</button></div>
    <div className="system-cleaner-browser-body">{entries.map((entry) => <StorageEntryRow entry={entry} key={entry.path} selected={selectedPath === entry.path} totalAllocatedBytes={directory.totalAllocatedBytes} onOpen={openEntry} onContextMenu={showEntryContextMenu} onSelect={setSelectedPath} />)}</div>
    <footer className="system-cleaner-browser-footer"><span>{t("systemCleaner.items", { count: formatCount(entries.length) })}</span><span>{t("systemCleaner.storageTotals", { allocated: formatBytes(directory.totalAllocatedBytes), size: formatBytes(directory.totalBytes) })}</span></footer>
  </section>;
}

function SafetyBadge({ safety }: { safety: CleanupSafety }) {
  const { t } = useTranslation();
  return <span className={`system-cleaner-safety ${safety}`}><i />{t(`systemCleaner.safety.${safety}`)}</span>;
}

function StorageEntryRow({ entry, onOpen, onContextMenu, onSelect, selected, totalAllocatedBytes }: {
  entry: SystemCleanerDiskEntry;
  onOpen: (entry: SystemCleanerDiskEntry) => void;
  onContextMenu: (entry: SystemCleanerDiskEntry, event: ReactMouseEvent) => void;
  onSelect: (path: string) => void;
  selected: boolean;
  totalAllocatedBytes: number;
}) {
  const percent = totalAllocatedBytes ? entry.allocatedBytes / totalAllocatedBytes * 100 : 0;
  const open = () => onOpen(entry);
  return <button type="button" className={`system-cleaner-browser-row${selected ? " selected" : ""}`} onClick={() => onSelect(entry.path)} onDoubleClick={open} onContextMenu={(event) => onContextMenu(entry, event)} onKeyDown={(event) => { if (event.key === "Enter") open(); }} title={entry.path}>
    <span className="system-cleaner-browser-name"><FileGlyph entry={{ name: entry.name, kind: entry.isDirectory ? "folder" : "file", size: formatBytes(entry.bytes), sizeBytes: entry.bytes, modified: "" }} size={20} /><span>{entry.name}</span>{entry.isDirectory ? <ChevronRight size={12} /> : null}</span>
    <span className="system-cleaner-browser-percent"><i style={{ width: `${percent}%` }} /><span>{percent.toFixed(1)}%</span></span>
    <strong>{formatBytes(entry.bytes)}</strong><strong>{formatBytes(entry.allocatedBytes)}</strong>
  </button>;
}

function buildCrumbs(root: string, path: string) {
  const separator = root.includes("\\") ? "\\" : "/";
  const relative = path.slice(root.length).replace(/^[\\/]+/, "");
  const parts = relative ? relative.split(/[\\/]+/) : [];
  const crumbs = [{ label: root, path: root }];
  let current = root.replace(/[\\/]+$/, "");
  for (const part of parts) {
    current = `${current}${separator}${part}`;
    crumbs.push({ label: part, path: current });
  }
  return crumbs;
}
