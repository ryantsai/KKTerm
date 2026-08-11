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
  Globe2,
  HardDrive,
  Images,
  Package,
  RefreshCw,
  Sparkles,
  Trash2,
  type IconComponent,
} from "../../lib/reicon";
import { ModuleHeader, ModuleHeaderLead, ModuleHeaderSpacer, ModuleHeaderTitle, ModuleIconTile } from "../../app/ModuleHeader";
import { SystemCleanerModuleIcon } from "../../app/moduleIdentityIcons";
import { ConfirmSheet } from "../../app/ui/dialog";
import { confirmNativeDialog, invokeCommand, isTauriRuntime, openFilesystemPath } from "../../lib/tauri";
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

type Section = "storage" | "cleanup" | "apps";
type StorageSort = { key: "name" | "size" | "allocated"; direction: "asc" | "desc" };
type MutationKind = "clean" | "uninstall";
type CleanupTone = "accent" | "green" | "amber" | "red";

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

export function SystemCleanerPage({ active, onOpenAssistant }: { active: boolean; onOpenAssistant: () => void }) {
  const { t } = useTranslation();
  const notice = useWorkspaceStore((state) => state.showStatusBarNotice);
  const submitAssistantContextSnippet = useWorkspaceStore((state) => state.submitAssistantContextSnippet);
  const scanActive = useSystemCleanerScanStore((state) => state.active);
  const progress = useSystemCleanerScanStore((state) => state.progress);
  const beginScan = useSystemCleanerScanStore((state) => state.beginScan);
  const updateProgress = useSystemCleanerScanStore((state) => state.updateProgress);
  const finishScan = useSystemCleanerScanStore((state) => state.finishScan);
  const [section, setSection] = useState<Section>("storage");
  const [drives, setDrives] = useState<SystemCleanerDrive[]>([]);
  const [drivesLoaded, setDrivesLoaded] = useState(false);
  const [selectedDrive, setSelectedDrive] = useState("");
  const [overview, setOverview] = useState<SystemCleanerOverview>();
  const [directory, setDirectory] = useState<SystemCleanerDirectoryListing>();
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [mutationKind, setMutationKind] = useState<MutationKind>();
  const [installingScanner, setInstallingScanner] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [confirmCleanup, setConfirmCleanup] = useState(false);
  const [pendingApp, setPendingApp] = useState<SystemCleanerOverview["apps"][number]>();
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
      let scanner = await invokeCommand("system_cleaner_scanner_status", undefined);
      if (!scanner.available) {
        const shouldInstall = await confirmNativeDialog(t("systemCleaner.scannerInstallPrompt"), {
          title: t("systemCleaner.scannerInstallTitle"),
        });
        if (shouldInstall !== true) return;
        setInstallingScanner(true);
        await invokeCommand("installer_load_catalog", {});
        const installed = await installRecipeAndWait(scanner.toolId);
        if (installed.kind === "cancelled") return;
        if (installed.kind === "failed") throw new Error(installed.message);
        scanner = await invokeCommand("system_cleaner_scanner_status", undefined);
        if (!scanner.available) throw new Error(t("systemCleaner.scannerUnavailableAfterInstall"));
      }
    } catch (error) {
      notice(t("systemCleaner.error", { message: String(error) }), { tone: "error" });
      return;
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
      setSelected(next.cleanup
        .filter((item) => item.bytes > 0 && DEFAULT_CLEANUP_IDS.has(item.id))
        .map((item) => item.id));
    } catch (error) {
      notice(t("systemCleaner.error", { message: String(error) }), { tone: "error" });
    } finally {
      unlisten?.();
      finishScan();
    }
  }, [beginScan, finishScan, notice, selectedDrive, t, updateProgress]);

  const selectedBytes = useMemo(() => overview?.cleanup.filter((item) => selected.includes(item.id)).reduce((sum, item) => sum + item.bytes, 0) ?? 0, [overview, selected]);

  const sectionCounts = useMemo<Record<Section, number | undefined>>(() => ({
    storage: overview?.folderCount,
    cleanup: overview?.cleanup.length,
    apps: overview?.apps.length,
  }), [overview]);

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

  async function uninstall() {
    if (!pendingApp) return;
    const app = pendingApp;
    setPendingApp(undefined);
    setMutationKind("uninstall");
    try {
      await invokeCommand("system_cleaner_uninstall", { appId: app.id });
      notice(t("systemCleaner.uninstalled", { name: app.name }), { tone: "success" });
      await scan();
    } catch (error) {
      notice(t("systemCleaner.error", { message: String(error) }), { tone: "error" });
    } finally {
      setMutationKind(undefined);
    }
  }

  function explainApp(app: SystemCleanerOverview["apps"][number]) {
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

  const selectedDriveInfo = drives.find((drive) => drive.path === selectedDrive);

  function selectDrive(path: string) {
    setSelectedDrive(path);
    setOverview(undefined);
    setDirectory(undefined);
    setSelected([]);
  }

  return <main className="system-cleaner-page" data-active={active}>
    <ModuleHeader>
      <ModuleHeaderLead><ModuleIconTile module="system-cleaner"><SystemCleanerModuleIcon size={16} aria-hidden="true" /></ModuleIconTile><ModuleHeaderTitle>{t("systemCleaner.title")}</ModuleHeaderTitle></ModuleHeaderLead>
      <ModuleHeaderSpacer />
      <button type="button" className="toolbar-button" disabled={busy || !selectedDrive} onClick={() => void scan()}><RefreshCw size={15} className={scanActive ? "spin" : ""} />{t("systemCleaner.scan")}</button>
    </ModuleHeader>
    <div className="system-cleaner-shell">
      <nav className="system-cleaner-nav" aria-label={t("systemCleaner.title")}>
        {(["storage", "cleanup", "apps"] as const).map((id) => {
          const Icon = id === "storage" ? HardDrive : id === "cleanup" ? Brush : Box;
          const count = sectionCounts[id];
          return <button type="button" key={id} className={section === id ? "active" : ""} aria-current={section === id ? "page" : undefined} onClick={() => setSection(id)}><Icon size={16} /><span>{t(`systemCleaner.${id}`)}</span>{count !== undefined ? <small>{formatCount(count)}</small> : null}</button>;
        })}
      </nav>
      <section className="system-cleaner-content">
        {scanActive ? <ScanOverlay progress={progress} /> : null}
        {section === "storage" ? <div className="system-cleaner-view system-cleaner-storage-view">
          <StorageToolbar drives={drives} overview={overview} selectedDrive={selectedDrive} selectedDriveInfo={selectedDriveInfo} busy={busy} onSelectDrive={selectDrive} />
          <div className="system-cleaner-storage-body">
            {!overview && !scanActive ? <div className="system-cleaner-empty"><span className="system-cleaner-empty-icon"><HardDrive size={24} /></span><p>{t("systemCleaner.scanHint")}</p><button type="button" className="toolbar-button" disabled={!selectedDrive} onClick={() => void scan()}><RefreshCw size={14} />{t("systemCleaner.scan")}</button></div> : null}
            {overview && directory ? <StorageBrowser directory={directory} loading={directoryLoading} onOpenDirectory={openDirectory} overview={overview} /> : null}
          </div>
        </div> : null}
        {overview && section === "cleanup" ? <CleanupView
          busy={busy}
          cleaning={mutationKind === "clean"}
          items={overview.cleanup}
          selected={selected}
          selectedBytes={selectedBytes}
          onClean={() => setConfirmCleanup(true)}
          onToggle={(id) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])}
        /> : null}
        {overview && section === "apps" ? <AppsView
          apps={overview.apps}
          busy={busy}
          onExplain={explainApp}
          onUninstall={setPendingApp}
        /> : null}
        {!overview && section !== "storage" && !scanActive ? <div className="system-cleaner-empty"><span className="system-cleaner-empty-icon"><RefreshCw size={22} /></span><p>{t("systemCleaner.scanHint")}</p><button type="button" className="toolbar-button" disabled={!selectedDrive} onClick={() => void scan()}><RefreshCw size={14} />{t("systemCleaner.scan")}</button></div> : null}
      </section>
    </div>
    {confirmCleanup ? <ConfirmSheet tone="danger" title={t("systemCleaner.cleanTitle")} message={t("systemCleaner.cleanMessage", { size: formatBytes(selectedBytes) })} confirmLabel={t("systemCleaner.clean", { size: formatBytes(selectedBytes) })} onConfirm={() => { setConfirmCleanup(false); void clean(); }} onCancel={() => setConfirmCleanup(false)} /> : null}
    {pendingApp ? <ConfirmSheet tone="danger" title={t("systemCleaner.uninstallTitle")} message={t("systemCleaner.uninstallMessage", { name: pendingApp.name })} confirmLabel={t("systemCleaner.uninstall")} onConfirm={() => void uninstall()} onCancel={() => setPendingApp(undefined)} /> : null}
  </main>;
}

function CleanupView({
  busy,
  cleaning,
  items,
  onClean,
  onToggle,
  selected,
  selectedBytes,
}: {
  busy: boolean;
  cleaning: boolean;
  items: SystemCleanerOverview["cleanup"];
  onClean: () => void;
  onToggle: (id: string) => void;
  selected: string[];
  selectedBytes: number;
}) {
  const { t } = useTranslation();
  return <div className="system-cleaner-view system-cleaner-cleanup-view">
    <header className="system-cleaner-view-head">
      <div><h2>{t("systemCleaner.cleanup")}</h2><p>{t("systemCleaner.cleanupHeading")}</p></div>
      <strong className="system-cleaner-total">{formatBytes(selectedBytes)}</strong>
    </header>
    <div className="system-cleaner-cleanup-grid">
      {items.map((item) => {
        const checked = selected.includes(item.id);
        const presentation = CLEANUP_PRESENTATION[item.id] ?? { icon: FileText, tone: "accent" as const };
        const Icon = presentation.icon;
        return <article className={`system-cleaner-cleanup-card${checked ? " selected" : ""}`} data-tone={presentation.tone} key={item.id}>
          <label className="system-cleaner-cleanup-card-select">
            <input type="checkbox" checked={checked} disabled={busy || item.bytes === 0} onChange={() => onToggle(item.id)} />
            <span className="system-cleaner-card-icon"><Icon size={20} /></span>
            <span className="system-cleaner-cleanup-card-title">
              <b>{t(`systemCleaner.category.${item.id}`)}</b>
              <strong>{formatBytes(item.bytes)}</strong>
            </span>
          </label>
          <p>{t(`systemCleaner.categoryDescription.${item.id}`)}</p>
          <bdi dir="ltr" title={item.path}>{item.path}</bdi>
        </article>;
      })}
    </div>
    <footer className="system-cleaner-action-bar"><button type="button" className="primary-button" disabled={busy || selectedBytes === 0} onClick={onClean}><Trash2 size={15} />{t("systemCleaner.clean", { size: formatBytes(selectedBytes) })}</button></footer>
    {cleaning ? <div className="system-cleaner-operation-overlay" role="status">
      <SystemCleanerScanOrb size={64} state="working" label={t("systemCleaner.cleaningWorking")} />
      <strong>{t("systemCleaner.cleaningWorking")}</strong>
    </div> : null}
  </div>;
}

function AppsView({
  apps,
  busy,
  onExplain,
  onUninstall,
}: {
  apps: SystemCleanerOverview["apps"];
  busy: boolean;
  onExplain: (app: SystemCleanerOverview["apps"][number]) => void;
  onUninstall: (app: SystemCleanerOverview["apps"][number]) => void;
}) {
  const { t } = useTranslation();
  return <div className="system-cleaner-view system-cleaner-apps-view">
    <header className="system-cleaner-view-head"><div><h2>{t("systemCleaner.apps")}</h2><p>{t("systemCleaner.appsHeading")}</p></div></header>
    <div className="system-cleaner-app-grid">
      {apps.map((app, index) => <article className="system-cleaner-app-card" key={`${app.id}-${app.version}-${index}`}>
        <header>
          <span className="system-cleaner-app-icon"><Package size={20} /></span>
          <div><h3>{app.name}</h3><p>{app.id}</p></div>
        </header>
        <dl><div><dt>{t("systemCleaner.version")}</dt><dd>{app.version}</dd></div></dl>
        <footer>
          <button type="button" className="system-cleaner-ai-explain" disabled={busy} onClick={() => onExplain(app)}><Sparkles size={14} />{t("systemCleaner.aiExplain")}</button>
          <button type="button" className="system-cleaner-uninstall" disabled={busy} onClick={() => onUninstall(app)}><Trash2 size={14} />{t("systemCleaner.uninstall")}</button>
        </footer>
      </article>)}
    </div>
  </div>;
}

function StorageToolbar({
  busy,
  drives,
  onSelectDrive,
  overview,
  selectedDrive,
  selectedDriveInfo,
}: {
  busy: boolean;
  drives: SystemCleanerDrive[];
  onSelectDrive: (path: string) => void;
  overview?: SystemCleanerOverview;
  selectedDrive: string;
  selectedDriveInfo?: SystemCleanerDrive;
}) {
  const { t } = useTranslation();
  const capacity = overview?.diskCapacityBytes ?? selectedDriveInfo?.capacityBytes ?? 0;
  const free = overview?.diskFreeBytes ?? selectedDriveInfo?.freeBytes ?? 0;
  const used = Math.max(0, capacity - free);
  const unaccounted = overview ? Math.max(0, used - overview.totalAllocatedBytes) : 0;
  const detail = overview ? t("systemCleaner.allocationDetail", {
    allocated: formatBytes(overview.totalAllocatedBytes),
    logical: formatBytes(overview.totalBytes),
    unaccounted: formatBytes(unaccounted),
    used: formatBytes(used),
  }) : undefined;

  return <header className="system-cleaner-view-head system-cleaner-storage-toolbar">
    <div className="system-cleaner-storage-title">
      <h2>{t("systemCleaner.storage")}</h2>
      <p title={selectedDrive}>{selectedDrive ? t("systemCleaner.storageHeading", { root: selectedDrive }) : t("systemCleaner.scanHint")}</p>
    </div>
    <label className="system-cleaner-drive-picker">
      <span>{t("systemCleaner.select")}</span>
      <select className="system-cleaner-drive-select" value={selectedDrive} disabled={busy || drives.length === 0} onChange={(event) => onSelectDrive(event.target.value)}>
        {drives.map((drive) => <option value={drive.path} key={drive.path}>{drive.path} · {formatBytes(drive.capacityBytes)}</option>)}
      </select>
    </label>
    {capacity > 0 ? <dl className="system-cleaner-storage-metrics" aria-label={detail} title={detail}>
      <div><dt>{t("systemCleaner.totalSpace")}</dt><dd>{formatBytes(capacity)}</dd></div>
      <div><dt>{t("systemCleaner.usedSpace")}</dt><dd>{formatBytes(used)}</dd></div>
      <div><dt>{t("systemCleaner.freeSpace")}</dt><dd>{formatBytes(free)}</dd></div>
    </dl> : null}
  </header>;
}

function ScanOverlay({ progress }: { progress?: SystemCleanerScanProgress }) {
  const { t } = useTranslation();
  const label = t("systemCleaner.scanning");
  const metadataPercent = progress?.phase === "metadata" && progress.phaseTotal > 0
    ? Math.min(100, Math.round(progress.phaseCompleted / progress.phaseTotal * 100))
    : 0;
  return <div className="system-cleaner-scan-overlay" role="status">
    <SystemCleanerScanOrb size={64} label={label} />
    <strong>{progress?.phase === "metadata"
      ? t("systemCleaner.scanMetadataProgress", { percent: metadataPercent })
      : t("systemCleaner.scanProgress", { files: formatCount(progress?.files ?? 0), size: formatBytes(progress?.bytes ?? 0) })}</strong>
    {progress?.currentPath ? <bdi className="system-cleaner-scan-path" dir="ltr" title={progress.currentPath}>{progress.currentPath}</bdi> : <span>{label}</span>}
  </div>;
}

function StorageBrowser({
  directory,
  loading,
  onOpenDirectory,
  overview,
}: {
  directory: SystemCleanerDirectoryListing;
  loading: boolean;
  onOpenDirectory: (path: string) => void;
  overview: SystemCleanerOverview;
}) {
  const { t } = useTranslation();
  const notice = useWorkspaceStore((state) => state.showStatusBarNotice);
  const [selectedPath, setSelectedPath] = useState<string>();
  const [sort, setSort] = useState<StorageSort>({ key: "allocated", direction: "desc" });
  useEffect(() => setSelectedPath(undefined), [directory.path]);

  const entries = useMemo(() => [...directory.entries].sort((left, right) => {
    const folderOrder = Number(right.isDirectory) - Number(left.isDirectory);
    if (folderOrder !== 0) return folderOrder;
    const direction = sort.direction === "asc" ? 1 : -1;
    if (sort.key === "size") return (left.bytes - right.bytes) * direction;
    if (sort.key === "allocated") return (left.allocatedBytes - right.allocatedBytes) * direction;
    return left.name.localeCompare(right.name, undefined, { numeric: true }) * direction;
  }), [directory.entries, sort]);
  const crumbs = useMemo(() => buildCrumbs(overview.scanRoot, directory.path), [directory.path, overview.scanRoot]);

  function toggleSort(key: StorageSort["key"]) {
    setSort((current) => current.key === key
      ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
      : { key, direction: key === "name" ? "asc" : "desc" });
  }

  function openEntry(entry: SystemCleanerDiskEntry) {
    if (entry.isDirectory) {
      onOpenDirectory(entry.path);
      return;
    }
    void openFilesystemPath(entry.path).catch((error) => {
      notice(t("systemCleaner.error", { message: String(error) }), { tone: "error" });
    });
  }

  function showEntryContextMenu(entry: SystemCleanerDiskEntry, event: ReactMouseEvent) {
    event.preventDefault();
    setSelectedPath(entry.path);
    const items: NativeContextMenuItem[] = [
      {
        kind: "item",
        label: t("common.open"),
        iconSvg: nativeMenuIcons.folderOpen,
        action: () => openEntry(entry),
      },
      { kind: "separator" },
      {
        kind: "item",
        label: t("common.copy"),
        iconSvg: nativeMenuIcons.copy,
        action: () => {
          void invokeCommand("set_local_file_clipboard", {
            request: { operation: "copy", paths: [entry.path] },
          }).catch((error) => {
            notice(t("systemCleaner.error", { message: String(error) }), { tone: "error" });
          });
        },
      },
      {
        kind: "item",
        label: t("sftp.copyPath"),
        iconSvg: nativeMenuIcons.copy,
        action: () => void navigator.clipboard?.writeText(entry.path).catch((error) => {
          notice(t("systemCleaner.error", { message: String(error) }), { tone: "error" });
        }),
      },
    ];
    void showNativeContextMenu(items, { x: event.clientX, y: event.clientY });
  }

  return <div className="system-cleaner-storage-grid">
      <section className="system-cleaner-browser" aria-busy={loading}>
        <div className="system-cleaner-browser-toolbar">
          <span className="system-cleaner-browser-label"><HardDrive size={13} />{t("systemCleaner.folders")}</span>
          <nav className="system-cleaner-crumbs" aria-label={directory.path}>
            {crumbs.map((crumb, index) => <span className="system-cleaner-crumb-segment" key={crumb.path}>{index > 0 ? <ChevronRight size={13} /> : null}<button type="button" className={index === crumbs.length - 1 ? "current" : ""} disabled={loading || index === crumbs.length - 1} onClick={() => onOpenDirectory(crumb.path)}>{crumb.label}</button></span>)}
          </nav>
          <button type="button" className="system-cleaner-icon-button" aria-label={t("systemCleaner.parentFolder")} disabled={loading || !directory.parentPath} onClick={() => directory.parentPath && onOpenDirectory(directory.parentPath)}><ArrowUp size={15} /></button>
        </div>
        <div className="system-cleaner-browser-columns">
          <button type="button" onClick={() => toggleSort("name")}>{t("systemCleaner.name")}{sort.key === "name" ? <ChevronDown className={sort.direction === "asc" ? "ascending" : ""} size={12} /> : null}</button>
          <span>{t("systemCleaner.percentOfFolder")}</span>
          <button type="button" onClick={() => toggleSort("size")}>{t("systemCleaner.size")}{sort.key === "size" ? <ChevronDown className={sort.direction === "asc" ? "ascending" : ""} size={12} /> : null}</button>
          <button type="button" onClick={() => toggleSort("allocated")}>{t("systemCleaner.allocated")}{sort.key === "allocated" ? <ChevronDown className={sort.direction === "asc" ? "ascending" : ""} size={12} /> : null}</button>
        </div>
        <div className="system-cleaner-browser-body">
          {entries.map((entry) => <StorageEntryRow entry={entry} key={entry.path} selected={selectedPath === entry.path} totalAllocatedBytes={directory.totalAllocatedBytes} onOpen={openEntry} onContextMenu={showEntryContextMenu} onSelect={setSelectedPath} />)}
        </div>
        <footer className="system-cleaner-browser-footer"><span>{t("systemCleaner.items", { count: formatCount(entries.length) })}</span><span>{t("systemCleaner.storageTotals", { allocated: formatBytes(directory.totalAllocatedBytes), size: formatBytes(directory.totalBytes) })}</span></footer>
      </section>
      <aside className="system-cleaner-type-pane">
        <h3>{t("systemCleaner.extensions")}</h3>
        <div className="system-cleaner-extension-columns"><span>{t("systemCleaner.extension")}</span><span>{t("systemCleaner.percent")}</span><span>{t("systemCleaner.files")}</span><span>{t("systemCleaner.size")}</span><span>{t("systemCleaner.allocated")}</span></div>
        <div className="system-cleaner-extension-body">{overview.extensions.map((entry) => { const percent = overview.totalAllocatedBytes ? entry.allocatedBytes / overview.totalAllocatedBytes * 100 : 0; return <div className="system-cleaner-extension-row" key={entry.extension}><span>{entry.extension}</span><span><i style={{ width: `${percent}%` }} />{percent.toFixed(1)}%</span><span>{formatCount(entry.files)}</span><strong>{formatBytes(entry.bytes)}</strong><strong>{formatBytes(entry.allocatedBytes)}</strong></div>; })}</div>
      </aside>
  </div>;
}

function StorageEntryRow({
  entry,
  onOpen,
  onContextMenu,
  onSelect,
  selected,
  totalAllocatedBytes,
}: {
  entry: SystemCleanerDiskEntry;
  onOpen: (entry: SystemCleanerDiskEntry) => void;
  onContextMenu: (entry: SystemCleanerDiskEntry, event: ReactMouseEvent) => void;
  onSelect: (path: string) => void;
  selected: boolean;
  totalAllocatedBytes: number;
}) {
  const percent = totalAllocatedBytes ? entry.allocatedBytes / totalAllocatedBytes * 100 : 0;
  const open = () => onOpen(entry);
  return <button
    type="button"
    className={`system-cleaner-browser-row${selected ? " selected" : ""}`}
    onClick={() => onSelect(entry.path)}
    onDoubleClick={open}
    onContextMenu={(event) => onContextMenu(entry, event)}
    onKeyDown={(event) => { if (event.key === "Enter") open(); }}
    title={entry.path}
  >
    <span className="system-cleaner-browser-name"><FileGlyph entry={{ name: entry.name, kind: entry.isDirectory ? "folder" : "file", size: formatBytes(entry.bytes), sizeBytes: entry.bytes, modified: "" }} size={20} /><span>{entry.name}</span>{entry.isDirectory ? <ChevronRight size={12} /> : null}</span>
    <span className="system-cleaner-browser-percent"><i style={{ width: `${percent}%` }} /><span>{percent.toFixed(1)}%</span></span>
    <strong>{formatBytes(entry.bytes)}</strong>
    <strong>{formatBytes(entry.allocatedBytes)}</strong>
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
