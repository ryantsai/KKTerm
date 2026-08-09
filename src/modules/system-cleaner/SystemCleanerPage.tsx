import { useCallback, useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import { ArrowUp, Box, Brush, ChevronDown, ChevronRight, HardDrive, RefreshCw, Trash2 } from "../../lib/reicon";
import { ModuleHeader, ModuleHeaderLead, ModuleHeaderSpacer, ModuleHeaderTitle, ModuleIconTile } from "../../app/ModuleHeader";
import { SystemCleanerModuleIcon } from "../../app/moduleIdentityIcons";
import { ConfirmSheet } from "../../app/ui/dialog";
import { invokeCommand, isTauriRuntime } from "../../lib/tauri";
import { useWorkspaceStore } from "../../store";
import { FileGlyph } from "../workspace/connections/sftp/finderGlyphs";
import { SystemCleanerScanOrb } from "./SystemCleanerScanOrb";
import { useSystemCleanerScanStore } from "./scanState";
import type {
  SystemCleanerDirectoryListing,
  SystemCleanerDiskEntry,
  SystemCleanerOverview,
  SystemCleanerScanProgress,
} from "./types";
import "./systemCleaner.css";

type Section = "storage" | "cleanup" | "apps";
type StorageSort = { key: "name" | "size"; direction: "asc" | "desc" };

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

export function SystemCleanerPage({ active }: { active: boolean }) {
  const { t } = useTranslation();
  const notice = useWorkspaceStore((state) => state.showStatusBarNotice);
  const scanActive = useSystemCleanerScanStore((state) => state.active);
  const progress = useSystemCleanerScanStore((state) => state.progress);
  const beginScan = useSystemCleanerScanStore((state) => state.beginScan);
  const updateProgress = useSystemCleanerScanStore((state) => state.updateProgress);
  const finishScan = useSystemCleanerScanStore((state) => state.finishScan);
  const [section, setSection] = useState<Section>("storage");
  const [overview, setOverview] = useState<SystemCleanerOverview>();
  const [directory, setDirectory] = useState<SystemCleanerDirectoryListing>();
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [mutationBusy, setMutationBusy] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [confirmCleanup, setConfirmCleanup] = useState(false);
  const [pendingApp, setPendingApp] = useState<SystemCleanerOverview["apps"][number]>();
  const busy = scanActive || mutationBusy;

  const scan = useCallback(async () => {
    if (!isTauriRuntime()) return;
    beginScan();
    let unlisten: (() => void) | undefined;
    try {
      unlisten = await listen<SystemCleanerScanProgress>("system-cleaner://scan-progress", ({ payload }) => updateProgress(payload));
      const next = await invokeCommand("system_cleaner_scan");
      setOverview(next);
      setDirectory({ path: next.scanRoot, totalBytes: next.totalBytes, entries: next.largest });
      setSelected(next.cleanup.filter((item) => item.bytes > 0).map((item) => item.id));
    } catch (error) {
      notice(t("systemCleaner.error", { message: String(error) }), { tone: "error" });
    } finally {
      unlisten?.();
      finishScan();
    }
  }, [beginScan, finishScan, notice, t, updateProgress]);

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
    setMutationBusy(true);
    try {
      const freed = await invokeCommand("system_cleaner_clean", { ids: selected });
      notice(t("systemCleaner.cleaned", { size: formatBytes(freed) }), { tone: "success" });
      await scan();
    } catch (error) {
      notice(t("systemCleaner.error", { message: String(error) }), { tone: "error" });
    } finally {
      setMutationBusy(false);
    }
  }

  async function uninstall() {
    if (!pendingApp) return;
    const app = pendingApp;
    setPendingApp(undefined);
    setMutationBusy(true);
    try {
      await invokeCommand("system_cleaner_uninstall", { appId: app.id });
      notice(t("systemCleaner.uninstalled", { name: app.name }), { tone: "success" });
      await scan();
    } catch (error) {
      notice(t("systemCleaner.error", { message: String(error) }), { tone: "error" });
    } finally {
      setMutationBusy(false);
    }
  }

  const capacity = overview?.diskCapacityBytes ?? 0;
  const used = capacity ? capacity - (overview?.diskFreeBytes ?? 0) : overview?.totalBytes ?? 0;

  return <main className="system-cleaner-page" data-active={active}>
    <ModuleHeader>
      <ModuleHeaderLead><ModuleIconTile module="system-cleaner"><SystemCleanerModuleIcon size={16} aria-hidden="true" /></ModuleIconTile><ModuleHeaderTitle>{t("systemCleaner.title")}</ModuleHeaderTitle></ModuleHeaderLead>
      <ModuleHeaderSpacer />
      <button type="button" className="toolbar-button" disabled={busy} onClick={() => void scan()}><RefreshCw size={15} className={scanActive ? "spin" : ""} />{t("systemCleaner.scan")}</button>
    </ModuleHeader>
    <div className="system-cleaner-scanbar">
      <div className="system-cleaner-scan-status">
        <span>{scanActive ? t("systemCleaner.scanProgress", { files: formatCount(progress?.files ?? 0), size: formatBytes(progress?.bytes ?? 0) }) : overview ? t("systemCleaner.scanComplete", { seconds: (overview.elapsedMs / 1000).toFixed(1) }) : t("systemCleaner.scanHint")}</span>
        <div className={`system-cleaner-progress${scanActive ? " active" : overview ? " complete" : ""}`}><i /></div>
      </div>
      {overview ? <dl className="system-cleaner-summary">
        <div><dt>{t("systemCleaner.totalSpace")}</dt><dd>{formatBytes(capacity)}</dd></div>
        <div><dt>{t("systemCleaner.usedSpace")}</dt><dd>{formatBytes(used)}</dd></div>
        <div><dt>{t("systemCleaner.freeSpace")}</dt><dd>{formatBytes(overview.diskFreeBytes)}</dd></div>
      </dl> : null}
    </div>
    <div className="system-cleaner-shell">
      <nav className="system-cleaner-nav" aria-label={t("systemCleaner.title")}>
        {(["storage", "cleanup", "apps"] as const).map((id) => {
          const Icon = id === "storage" ? HardDrive : id === "cleanup" ? Brush : Box;
          const count = sectionCounts[id];
          return <button type="button" key={id} className={section === id ? "active" : ""} aria-current={section === id ? "page" : undefined} onClick={() => setSection(id)}><Icon size={16} /><span>{t(`systemCleaner.${id}`)}</span>{count !== undefined ? <small>{formatCount(count)}</small> : null}</button>;
        })}
      </nav>
      <section className="system-cleaner-content">
        {scanActive && section === "storage" ? <ScanOverlay progress={progress} /> : null}
        {!overview && !scanActive ? <div className="system-cleaner-empty"><span className="system-cleaner-empty-icon"><HardDrive size={24} /></span><p>{t("systemCleaner.scanHint")}</p><button type="button" className="toolbar-button" onClick={() => void scan()}><RefreshCw size={14} />{t("systemCleaner.scan")}</button></div> : null}
        {overview && directory && section === "storage" ? <StorageBrowser directory={directory} loading={directoryLoading} onOpenDirectory={openDirectory} overview={overview} /> : null}
        {overview && section === "cleanup" ? <div className="system-cleaner-view system-cleaner-cleanup-view"><header className="system-cleaner-view-head"><div><h2>{t("systemCleaner.cleanup")}</h2><p>{t("systemCleaner.cleanupHeading")}</p></div><strong className="system-cleaner-total">{formatBytes(selectedBytes)}</strong></header><div className="system-cleaner-list system-cleaner-cleanup-list">{overview.cleanup.map((item) => { const checked = selected.includes(item.id); return <label className={`system-cleaner-row${checked ? " selected" : ""}`} key={item.id}><input type="checkbox" checked={checked} onChange={() => setSelected((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id])} /><span><b>{t(`systemCleaner.category.${item.id}`)}</b><small title={item.path}>{item.path}</small></span><strong>{formatBytes(item.bytes)}</strong></label>; })}</div><footer className="system-cleaner-action-bar"><button type="button" className="primary-button" disabled={busy || selectedBytes === 0} onClick={() => setConfirmCleanup(true)}><Trash2 size={15} />{t("systemCleaner.clean", { size: formatBytes(selectedBytes) })}</button></footer></div> : null}
        {overview && section === "apps" ? <div className="system-cleaner-view"><header className="system-cleaner-view-head"><div><h2>{t("systemCleaner.apps")}</h2><p>{t("systemCleaner.appsHeading")}</p></div></header><div className="system-cleaner-list system-cleaner-app-list">{overview.apps.map((app, index) => <div className="system-cleaner-row" key={`${app.id}-${app.version}-${index}`}><span><b>{app.name}</b><small>{app.id} · {app.version}</small></span><button type="button" className="system-cleaner-uninstall" onClick={() => setPendingApp(app)}>{t("systemCleaner.uninstall")}</button></div>)}</div></div> : null}
      </section>
    </div>
    {confirmCleanup ? <ConfirmSheet tone="danger" title={t("systemCleaner.cleanTitle")} message={t("systemCleaner.cleanMessage", { size: formatBytes(selectedBytes) })} confirmLabel={t("systemCleaner.clean", { size: formatBytes(selectedBytes) })} onConfirm={() => { setConfirmCleanup(false); void clean(); }} onCancel={() => setConfirmCleanup(false)} /> : null}
    {pendingApp ? <ConfirmSheet tone="danger" title={t("systemCleaner.uninstallTitle")} message={t("systemCleaner.uninstallMessage", { name: pendingApp.name })} confirmLabel={t("systemCleaner.uninstall")} onConfirm={() => void uninstall()} onCancel={() => setPendingApp(undefined)} /> : null}
  </main>;
}

function ScanOverlay({ progress }: { progress?: SystemCleanerScanProgress }) {
  const { t } = useTranslation();
  const label = t("systemCleaner.scanning");
  return <div className="system-cleaner-scan-overlay" role="status">
    <SystemCleanerScanOrb size={64} label={label} />
    <strong>{t("systemCleaner.scanProgress", { files: formatCount(progress?.files ?? 0), size: formatBytes(progress?.bytes ?? 0) })}</strong>
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
  const [selectedPath, setSelectedPath] = useState<string>();
  const [sort, setSort] = useState<StorageSort>({ key: "size", direction: "desc" });
  useEffect(() => setSelectedPath(undefined), [directory.path]);

  const entries = useMemo(() => [...directory.entries].sort((left, right) => {
    const folderOrder = Number(right.isDirectory) - Number(left.isDirectory);
    if (folderOrder !== 0) return folderOrder;
    const direction = sort.direction === "asc" ? 1 : -1;
    if (sort.key === "size") return (left.bytes - right.bytes) * direction;
    return left.name.localeCompare(right.name, undefined, { numeric: true }) * direction;
  }), [directory.entries, sort]);
  const crumbs = useMemo(() => buildCrumbs(overview.scanRoot, directory.path), [directory.path, overview.scanRoot]);

  function toggleSort(key: StorageSort["key"]) {
    setSort((current) => current.key === key
      ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
      : { key, direction: key === "name" ? "asc" : "desc" });
  }

  return <div className="system-cleaner-view system-cleaner-storage-view">
    <header className="system-cleaner-view-head"><div><h2>{t("systemCleaner.storage")}</h2><p title={overview.scanRoot}>{t("systemCleaner.storageHeading", { root: overview.scanRoot })}</p></div><strong className="system-cleaner-total">{formatBytes(directory.totalBytes)}</strong></header>
    <div className="system-cleaner-storage-grid">
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
        </div>
        <div className="system-cleaner-browser-body">
          {entries.map((entry) => <StorageEntryRow entry={entry} key={entry.path} selected={selectedPath === entry.path} totalBytes={directory.totalBytes} onOpenDirectory={onOpenDirectory} onSelect={setSelectedPath} />)}
        </div>
        <footer className="system-cleaner-browser-footer"><span>{t("systemCleaner.items", { count: formatCount(entries.length) })}</span><span>{formatBytes(directory.totalBytes)}</span></footer>
      </section>
      <aside className="system-cleaner-type-pane">
        <h3>{t("systemCleaner.extensions")}</h3>
        <div className="system-cleaner-extension-columns"><span>{t("systemCleaner.extension")}</span><span>{t("systemCleaner.percent")}</span><span>{t("systemCleaner.files")}</span><span>{t("systemCleaner.size")}</span></div>
        <div className="system-cleaner-extension-body">{overview.extensions.map((entry) => { const percent = overview.totalBytes ? entry.bytes / overview.totalBytes * 100 : 0; return <div className="system-cleaner-extension-row" key={entry.extension}><span>{entry.extension}</span><span><i style={{ width: `${percent}%` }} />{percent.toFixed(1)}%</span><span>{formatCount(entry.files)}</span><strong>{formatBytes(entry.bytes)}</strong></div>; })}</div>
      </aside>
    </div>
  </div>;
}

function StorageEntryRow({
  entry,
  onOpenDirectory,
  onSelect,
  selected,
  totalBytes,
}: {
  entry: SystemCleanerDiskEntry;
  onOpenDirectory: (path: string) => void;
  onSelect: (path: string) => void;
  selected: boolean;
  totalBytes: number;
}) {
  const percent = totalBytes ? entry.bytes / totalBytes * 100 : 0;
  const open = () => { if (entry.isDirectory) onOpenDirectory(entry.path); };
  return <button
    type="button"
    className={`system-cleaner-browser-row${selected ? " selected" : ""}`}
    onClick={() => onSelect(entry.path)}
    onDoubleClick={open}
    onKeyDown={(event) => { if (event.key === "Enter") open(); }}
    title={entry.path}
  >
    <span className="system-cleaner-browser-name"><FileGlyph entry={{ name: entry.name, kind: entry.isDirectory ? "folder" : "file", size: formatBytes(entry.bytes), sizeBytes: entry.bytes, modified: "" }} size={20} /><span>{entry.name}</span>{entry.isDirectory ? <ChevronRight size={12} /> : null}</span>
    <span className="system-cleaner-browser-percent"><i style={{ width: `${percent}%` }} /><span>{percent.toFixed(1)}%</span></span>
    <strong>{formatBytes(entry.bytes)}</strong>
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
