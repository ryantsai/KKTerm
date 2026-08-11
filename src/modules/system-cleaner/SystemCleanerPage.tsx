import { useCallback, useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from "react";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import {
  AppWindow,
  ArrowUp,
  Box,
  Brush,
  Bug,
  ChevronDown,
  ChevronRight,
  Clock,
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
import { installRecipeAndWait } from "../installer/progress";
import { SystemCleanerScanOrb } from "./SystemCleanerScanOrb";
import { useSystemCleanerScanStore } from "./scanState";
import type {
  SystemCleanerDirectoryListing,
  SystemCleanerDiskEntry,
  SystemCleanerDrive,
  SystemCleanerOverview,
  SystemCleanerScanProgress,
} from "./types";
import "./systemCleaner.css";

type Section = "overview" | "storage" | "cleanup" | "recommendations" | "apps";
type StorageSort = { key: "name" | "size" | "allocated"; direction: "asc" | "desc" };
type MutationKind = "clean" | "delete-review" | "uninstall";
type CleanupTone = "accent" | "green" | "amber" | "red";
type CleanupSafety = "safe" | "review" | "risky";
type CleanerApp = SystemCleanerOverview["apps"][number];

const DEFAULT_CLEANUP_IDS = new Set([
  "temp",
  "windows-temp",
  "browser-cache",
  "chrome-cache",
  "firefox-cache",
  "shader-cache",
  "thumbnail-cache",
]);

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

function cleanupSafety(id: string): CleanupSafety {
  if (id === "crash-dumps") return "risky";
  if (id === "error-reports") return "review";
  return "safe";
}

function defaultCleanupSelection(items: SystemCleanerOverview["cleanup"]) {
  return items.filter((item) => item.bytes > 0 && DEFAULT_CLEANUP_IDS.has(item.id)).map((item) => item.id);
}

function matchesQuery(query: string, ...values: string[]) {
  const normalized = query.trim().toLocaleLowerCase();
  return normalized.length === 0 || values.some((value) => value.toLocaleLowerCase().includes(normalized));
}

export function SystemCleanerPage({ active, onOpenAssistant }: { active: boolean; onOpenAssistant: () => void }) {
  const { t } = useTranslation();
  const notice = useWorkspaceStore((state) => state.showStatusBarNotice);
  const submitAssistantContextSnippet = useWorkspaceStore((state) => state.submitAssistantContextSnippet);
  const scanActive = useSystemCleanerScanStore((state) => state.active);
  const progress = useSystemCleanerScanStore((state) => state.progress);
  const beginScan = useSystemCleanerScanStore((state) => state.beginScan);
  const updateProgress = useSystemCleanerScanStore((state) => state.updateProgress);
  const finishScan = useSystemCleanerScanStore((state) => state.finishScan);
  const [section, setSection] = useState<Section>("overview");
  const [query, setQuery] = useState("");
  const [drives, setDrives] = useState<SystemCleanerDrive[]>([]);
  const [drivesLoaded, setDrivesLoaded] = useState(false);
  const [selectedDrive, setSelectedDrive] = useState("");
  const [overview, setOverview] = useState<SystemCleanerOverview>();
  const [directory, setDirectory] = useState<SystemCleanerDirectoryListing>();
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [mutationKind, setMutationKind] = useState<MutationKind>();
  const [installingScanner, setInstallingScanner] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [selectedReviewPaths, setSelectedReviewPaths] = useState<string[]>([]);
  const [selectedAppIds, setSelectedAppIds] = useState<string[]>([]);
  const [confirmCleanup, setConfirmCleanup] = useState(false);
  const [confirmReviewDelete, setConfirmReviewDelete] = useState(false);
  const [pendingApps, setPendingApps] = useState<CleanerApp[]>([]);
  const busy = scanActive || installingScanner || mutationKind !== undefined;

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
    try {
      const scanner = await invokeCommand("system_cleaner_scanner_status", undefined);
      if (!scanner.available) {
        setInstallingScanner(true);
        await invokeCommand("installer_load_catalog", {});
        await installRecipeAndWait(scanner.toolId);
      }
    } catch {
      // WinDirStat is a best-effort optimization. The scan command falls back
      // to the iterative directory walker when the managed scanner is absent.
    } finally {
      setInstallingScanner(false);
    }
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
  const reclaimableBytes = useMemo(() => overview?.cleanup.filter((item) => cleanupSafety(item.id) === "safe").reduce((sum, item) => sum + item.bytes, 0) ?? 0, [overview]);
  const selectedApps = useMemo(() => overview?.apps.filter((app) => selectedAppIds.includes(app.id)) ?? [], [overview, selectedAppIds]);
  const selectedReviewFiles = useMemo(() => {
    const byPath = new Map(overview?.recommendations.flatMap((category) => category.files).map((file) => [file.path, file]) ?? []);
    return selectedReviewPaths.flatMap((path) => byPath.get(path) ?? []);
  }, [overview, selectedReviewPaths]);
  const selectedReviewBytes = useMemo(() => selectedReviewFiles.reduce((sum, file) => sum + file.allocatedBytes, 0), [selectedReviewFiles]);
  const selectedDriveInfo = drives.find((drive) => drive.path === selectedDrive);

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

  async function clean() {
    setMutationKind("clean");
    try {
      const freed = await invokeCommand("system_cleaner_clean", { ids: selected });
      notice(t("systemCleaner.cleaned", { size: formatBytes(freed) }), { tone: "success" });
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
    setSection("overview");
  }

  function openOverviewFolder(path: string) {
    setSection("storage");
    void openDirectory(path);
  }

  const pendingAppCount = pendingApps.length;
  return <main className="system-cleaner-page" data-active={active}>
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
      {overview ? <label className="system-cleaner-search"><Search size={14} aria-hidden="true" /><input value={query} placeholder={t("common.search")} aria-label={t("common.search")} onChange={(event) => setQuery(event.currentTarget.value)} /></label> : null}
      <button type="button" className="toolbar-button" disabled={busy || !selectedDrive} onClick={() => void scan()}><RefreshCw size={15} className={scanActive ? "spin" : ""} />{t("systemCleaner.scan")}</button>
    </ModuleHeader>
    <div className="system-cleaner-shell">
      <CleanerSidebar
        overview={overview}
        section={section}
        selectedBytes={selectedBytes}
        selectedDrive={selectedDrive}
        selectedDriveInfo={selectedDriveInfo}
        selectedAppCount={selectedAppIds.length}
        selectedReviewCount={selectedReviewPaths.length}
        selectedReviewBytes={selectedReviewBytes}
        onClean={() => setConfirmCleanup(true)}
        onSection={setSection}
      />
      <section className="system-cleaner-content">
        {scanActive ? <ScanOverlay progress={progress} /> : null}
        {!overview && !scanActive ? <div className="system-cleaner-empty"><span className="system-cleaner-empty-icon"><Gauge size={24} /></span><h2>{t("systemCleaner.overview")}</h2><p>{t("systemCleaner.scanHint")}</p><button type="button" className="toolbar-button" disabled={!selectedDrive} onClick={() => void scan()}><RefreshCw size={14} />{t("systemCleaner.scan")}</button></div> : null}
        {overview && section === "overview" ? <OverviewView overview={overview} query={query} reclaimableBytes={reclaimableBytes} onOpenFolder={openOverviewFolder} onSection={setSection} /> : null}
        {overview && directory && section === "storage" ? <StorageView directory={directory} loading={directoryLoading} overview={overview} query={query} onOpenDirectory={openDirectory} /> : null}
        {overview && section === "cleanup" ? <CleanupView
          busy={busy}
          cleaning={mutationKind === "clean"}
          items={overview.cleanup}
          query={query}
          selected={selected}
          selectedBytes={selectedBytes}
          onClean={() => setConfirmCleanup(true)}
          onReset={() => setSelected(defaultCleanupSelection(overview.cleanup))}
          onToggle={(id) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])}
          onToggleSafe={(checked) => setSelected((current) => {
            const safeIds = overview.cleanup.filter((item) => item.bytes > 0 && cleanupSafety(item.id) === "safe").map((item) => item.id);
            return checked ? Array.from(new Set([...current, ...safeIds])) : current.filter((id) => !safeIds.includes(id));
          })}
        /> : null}
        {overview && section === "recommendations" ? <RecommendationsView
          busy={busy}
          deleting={mutationKind === "delete-review"}
          categories={overview.recommendations}
          query={query}
          selectedPaths={selectedReviewPaths}
          selectedBytes={selectedReviewBytes}
          onDelete={() => setConfirmReviewDelete(true)}
          onToggle={(path) => setSelectedReviewPaths((current) => current.includes(path) ? current.filter((item) => item !== path) : [...current, path])}
        /> : null}
        {overview && section === "apps" ? <AppsView
          apps={overview.apps}
          busy={busy}
          query={query}
          selectedIds={selectedAppIds}
          onExplain={explainApp}
          onToggle={(id) => setSelectedAppIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])}
          onUninstall={(app) => setPendingApps([app])}
          onUninstallSelected={() => setPendingApps(selectedApps)}
        /> : null}
      </section>
    </div>
    {confirmCleanup ? <ConfirmSheet tone="danger" title={t("systemCleaner.cleanTitle")} message={t("systemCleaner.cleanMessage", { size: formatBytes(selectedBytes) })} confirmLabel={t("systemCleaner.clean", { size: formatBytes(selectedBytes) })} onConfirm={() => { setConfirmCleanup(false); void clean(); }} onCancel={() => setConfirmCleanup(false)} /> : null}
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

function CleanerSidebar({
  onClean,
  onSection,
  overview,
  section,
  selectedAppCount,
  selectedBytes,
  selectedReviewBytes,
  selectedReviewCount,
  selectedDrive,
  selectedDriveInfo,
}: {
  onClean: () => void;
  onSection: (section: Section) => void;
  overview?: SystemCleanerOverview;
  section: Section;
  selectedAppCount: number;
  selectedBytes: number;
  selectedReviewBytes: number;
  selectedReviewCount: number;
  selectedDrive: string;
  selectedDriveInfo?: SystemCleanerDrive;
}) {
  const { t } = useTranslation();
  const capacity = overview?.diskCapacityBytes ?? selectedDriveInfo?.capacityBytes ?? 0;
  const free = overview?.diskFreeBytes ?? selectedDriveInfo?.freeBytes ?? 0;
  const used = Math.max(0, capacity - free);
  const usedPercent = capacity > 0 ? Math.min(100, used / capacity * 100) : 0;
  const allocationDetail = overview ? t("systemCleaner.allocationDetail", {
    allocated: formatBytes(overview.totalAllocatedBytes),
    logical: formatBytes(overview.totalBytes),
    unaccounted: formatBytes(Math.max(0, used - overview.totalAllocatedBytes)),
    used: formatBytes(used),
  }) : undefined;
  const items: Array<{ id: Section; icon: IconComponent; detail?: string }> = [
    { id: "overview", icon: Gauge },
    { id: "storage", icon: HardDrive, detail: overview ? formatBytes(overview.totalAllocatedBytes) : undefined },
    { id: "cleanup", icon: Brush, detail: overview ? formatBytes(selectedBytes) : undefined },
    { id: "recommendations", icon: Clock, detail: overview ? formatCount(overview.recommendations.reduce((sum, category) => sum + category.files.length, 0)) : undefined },
    { id: "apps", icon: Box, detail: overview ? formatCount(overview.apps.length) : undefined },
  ];
  return <aside className="system-cleaner-sidebar">
    <section className="system-cleaner-drive-card" aria-label={allocationDetail} title={allocationDetail}>
      <header><HardDrive size={15} /><strong title={selectedDrive}>{selectedDrive || "—"}</strong></header>
      <span className="system-cleaner-drive-meter"><i style={{ width: `${usedPercent}%` }} /></span>
      <dl>
        <div><dt>{t("systemCleaner.totalSpace")}</dt><dd>{formatBytes(capacity)}</dd></div>
        <div><dt>{t("systemCleaner.usedSpace")}</dt><dd>{formatBytes(used)}</dd></div>
        <div><dt>{t("systemCleaner.freeSpace")}</dt><dd>{formatBytes(free)}</dd></div>
      </dl>
    </section>
    <span className="system-cleaner-sidebar-label">{t("systemCleaner.title")}</span>
    <nav className="system-cleaner-nav" aria-label={t("systemCleaner.title")}>
      {items.map(({ id, icon: Icon, detail }) => <button type="button" key={id} className={section === id ? "active" : ""} aria-current={section === id ? "page" : undefined} onClick={() => onSection(id)}><Icon size={16} /><span>{t(`systemCleaner.${id}`)}</span>{detail ? <small>{detail}</small> : null}</button>)}
    </nav>
    {overview && section === "storage" ? <FileTypeSummary overview={overview} /> : null}
    {overview && section === "recommendations" ? <section className="system-cleaner-sidebar-summary"><strong>{t("systemCleaner.recommendationsHeading")}</strong><span>{formatCount(overview.recommendations.reduce((sum, category) => sum + category.files.length, 0))}</span>{selectedReviewCount > 0 ? <small>{t("systemCleaner.selectedReviewFiles", { count: selectedReviewCount, size: formatBytes(selectedReviewBytes) })}</small> : null}</section> : null}
    {overview && section === "apps" ? <section className="system-cleaner-sidebar-summary"><strong>{t("systemCleaner.appsHeading")}</strong><span>{formatCount(overview.apps.length)}</span>{selectedAppCount > 0 ? <small>{t("systemCleaner.selectedApps", { count: selectedAppCount })}</small> : null}</section> : null}
    {overview && (section === "overview" || section === "cleanup") ? <section className="system-cleaner-reclaim-card"><span>{t("systemCleaner.cleanupHeading")}</span><strong>{formatBytes(selectedBytes)}</strong><button type="button" disabled={selectedBytes === 0} onClick={onClean}><Trash2 size={14} />{t("systemCleaner.clean", { size: formatBytes(selectedBytes) })}</button></section> : null}
  </aside>;
}

function OverviewView({ overview, query, reclaimableBytes, onOpenFolder, onSection }: {
  overview: SystemCleanerOverview;
  query: string;
  reclaimableBytes: number;
  onOpenFolder: (path: string) => void;
  onSection: (section: Section) => void;
}) {
  const { t } = useTranslation();
  const used = Math.max(0, overview.diskCapacityBytes - overview.diskFreeBytes);
  const folders = overview.largest.filter((entry) => entry.isDirectory && matchesQuery(query, entry.name, entry.path)).slice(0, 10);
  const cleanup = overview.cleanup.filter((item) => matchesQuery(query, t(`systemCleaner.category.${item.id}`), item.path));
  const apps = overview.apps.filter((app) => matchesQuery(query, app.name, app.id, app.version)).slice(0, 6);
  const elapsedSeconds = Math.max(.1, overview.elapsedMs / 1000).toFixed(1);
  return <div className="system-cleaner-view system-cleaner-overview-view">
    <header className="system-cleaner-section-head"><h2>{t("systemCleaner.overview")}</h2><p>{t("systemCleaner.scanComplete", { seconds: elapsedSeconds })} · {t("systemCleaner.items", { count: formatCount(overview.fileCount) })}</p></header>
    <div className="system-cleaner-metric-grid">
      <Metric label={t("systemCleaner.usedSpace")} value={formatBytes(used)} detail={`${(used / Math.max(1, overview.diskCapacityBytes) * 100).toFixed(1)}%`} />
      <Metric label={t("systemCleaner.freeSpace")} value={formatBytes(overview.diskFreeBytes)} detail={`${(overview.diskFreeBytes / Math.max(1, overview.diskCapacityBytes) * 100).toFixed(1)}%`} />
      <Metric label={t("systemCleaner.cleanupHeading")} value={formatBytes(reclaimableBytes)} detail={t("systemCleaner.safeCategories", { count: overview.cleanup.filter((item) => cleanupSafety(item.id) === "safe").length })} accent />
      <Metric label={t("systemCleaner.appsHeading")} value={formatCount(overview.apps.length)} detail={t("systemCleaner.apps")} />
    </div>
    <div className="system-cleaner-overview-grid">
      <section className="system-cleaner-panel system-cleaner-overview-folders">
        <PanelHead title={t("systemCleaner.storageHeading", { root: overview.scanRoot })} action={t("systemCleaner.storage")} onAction={() => onSection("storage")} />
        <div className="system-cleaner-overview-table-head"><span>{t("systemCleaner.folder")}</span><span>{t("systemCleaner.percent")}</span><span>{t("systemCleaner.size")}</span></div>
        <div className="system-cleaner-overview-rows">{folders.map((entry) => {
          const percent = overview.totalAllocatedBytes ? entry.allocatedBytes / overview.totalAllocatedBytes * 100 : 0;
          return <button type="button" key={entry.path} onClick={() => onOpenFolder(entry.path)}><FileGlyph entry={{ name: entry.name, kind: "folder", size: formatBytes(entry.bytes), sizeBytes: entry.bytes, modified: "" }} size={18} /><span>{entry.name}</span><span className="system-cleaner-mini-meter"><i style={{ width: `${percent}%` }} /><small>{percent.toFixed(1)}%</small></span><strong>{formatBytes(entry.allocatedBytes)}</strong></button>;
        })}</div>
      </section>
      <div className="system-cleaner-overview-stack">
        <section className="system-cleaner-panel">
          <PanelHead title={t("systemCleaner.cleanupHeading")} detail={formatBytes(reclaimableBytes)} action={t("systemCleaner.cleanup")} onAction={() => onSection("cleanup")} />
          <div className="system-cleaner-summary-list">{cleanup.map((item) => <div key={item.id}><span className={`system-cleaner-summary-dot ${cleanupSafety(item.id)}`} /><span>{t(`systemCleaner.category.${item.id}`)}</span><strong>{formatBytes(item.bytes)}</strong><SafetyBadge safety={cleanupSafety(item.id)} /></div>)}</div>
        </section>
        <section className="system-cleaner-panel">
          <PanelHead title={t("systemCleaner.appsHeading")} action={t("systemCleaner.apps")} onAction={() => onSection("apps")} />
          <div className="system-cleaner-summary-list">{apps.map((app) => <div key={app.id}><Package size={14} /><span>{app.name}</span><strong>{app.version}</strong></div>)}</div>
        </section>
      </div>
    </div>
  </div>;
}

function Metric({ accent, detail, label, value }: { accent?: boolean; detail: string; label: string; value: string }) {
  return <article className={`system-cleaner-metric${accent ? " accent" : ""}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}

function PanelHead({ action, detail, onAction, title }: { action: string; detail?: string; onAction: () => void; title: string }) {
  return <header className="system-cleaner-panel-head"><strong>{title}</strong>{detail ? <span>{detail}</span> : null}<button type="button" onClick={onAction}>{action}</button></header>;
}

function CleanupView({ busy, cleaning, items, onClean, onReset, onToggle, onToggleSafe, query, selected, selectedBytes }: {
  busy: boolean;
  cleaning: boolean;
  items: SystemCleanerOverview["cleanup"];
  onClean: () => void;
  onReset: () => void;
  onToggle: (id: string) => void;
  onToggleSafe: (checked: boolean) => void;
  query: string;
  selected: string[];
  selectedBytes: number;
}) {
  const { t } = useTranslation();
  const visibleItems = items.filter((item) => matchesQuery(query, t(`systemCleaner.category.${item.id}`), t(`systemCleaner.categoryDescription.${item.id}`), item.path));
  const safeItems = items.filter((item) => item.bytes > 0 && cleanupSafety(item.id) === "safe");
  const allSafeSelected = safeItems.length > 0 && safeItems.every((item) => selected.includes(item.id));
  return <div className="system-cleaner-view system-cleaner-cleanup-view">
    <header className="system-cleaner-section-head"><h2>{t("systemCleaner.cleanup")}</h2><p>{t("systemCleaner.selectedCategories", { count: selected.length, total: items.length })}</p><label className="system-cleaner-select-safe"><input type="checkbox" checked={allSafeSelected} disabled={busy} onChange={(event) => onToggleSafe(event.currentTarget.checked)} />{t("systemCleaner.selectAllSafe")}</label></header>
    <div className="system-cleaner-cleanup-groups">
      {(["safe", "review", "risky"] as const).map((safety) => {
        const group = visibleItems.filter((item) => cleanupSafety(item.id) === safety);
        if (group.length === 0) return null;
        const bytes = group.reduce((sum, item) => sum + item.bytes, 0);
        return <section className="system-cleaner-cleanup-group" key={safety}>
          <header><SafetyBadge safety={safety} /><strong>{t(`systemCleaner.safety.${safety}`)}</strong><span>{formatBytes(bytes)}</span></header>
          <div>{group.map((item) => {
            const checked = selected.includes(item.id);
            const presentation = CLEANUP_PRESENTATION[item.id] ?? { icon: FileText, tone: "accent" as const };
            const Icon = presentation.icon;
            return <label className={`system-cleaner-cleanup-row${checked ? " selected" : ""}`} data-tone={presentation.tone} key={item.id}>
              <input type="checkbox" checked={checked} disabled={busy || item.bytes === 0} onChange={() => onToggle(item.id)} />
              <span className="system-cleaner-row-icon"><Icon size={17} /></span>
              <span className="system-cleaner-cleanup-name"><strong>{t(`systemCleaner.category.${item.id}`)}</strong><bdi dir="ltr" title={item.path}>{item.path}</bdi></span>
              <span className="system-cleaner-cleanup-description">{t(`systemCleaner.categoryDescription.${item.id}`)}</span>
              <strong className="system-cleaner-row-size">{formatBytes(item.bytes)}</strong>
            </label>;
          })}</div>
        </section>;
      })}
    </div>
    <footer className="system-cleaner-action-bar"><div><span>{t("systemCleaner.selectedCategories", { count: selected.length, total: items.length })}</span><strong>{formatBytes(selectedBytes)}</strong></div><button type="button" className="toolbar-button" disabled={busy} onClick={onReset}><RotateCcw size={14} />{t("systemCleaner.resetDefaults")}</button><button type="button" className="primary-button" disabled={busy || selectedBytes === 0} onClick={onClean}><Trash2 size={15} />{t("systemCleaner.clean", { size: formatBytes(selectedBytes) })}</button></footer>
    {cleaning ? <div className="system-cleaner-operation-overlay" role="status"><SystemCleanerScanOrb size={64} state="working" label={t("systemCleaner.cleaningWorking")} /><strong>{t("systemCleaner.cleaningWorking")}</strong></div> : null}
  </div>;
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
  const metadataPercent = progress?.phase === "metadata" && progress.phaseTotal > 0 ? Math.min(100, Math.round(progress.phaseCompleted / progress.phaseTotal * 100)) : 0;
  return <div className="system-cleaner-scan-overlay" role="status"><SystemCleanerScanOrb size={64} label={label} /><strong>{progress?.phase === "metadata" ? t("systemCleaner.scanMetadataProgress", { percent: metadataPercent }) : t("systemCleaner.scanProgress", { files: formatCount(progress?.files ?? 0), size: formatBytes(progress?.bytes ?? 0) })}</strong>{progress?.currentPath ? <bdi className="system-cleaner-scan-path" dir="ltr" title={progress.currentPath}>{progress.currentPath}</bdi> : <span>{label}</span>}</div>;
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

function FileTypeSummary({ overview }: { overview: SystemCleanerOverview }) {
  const { t } = useTranslation();
  return <section className="system-cleaner-file-types"><strong>{t("systemCleaner.extensions")}</strong>{overview.extensions.slice(0, 12).map((entry) => <div key={entry.extension}><i /><span>{entry.extension}</span><b>{formatBytes(entry.allocatedBytes)}</b></div>)}</section>;
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
