import { useCallback, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import { Box, Brush, ChevronRight, HardDrive, RefreshCw, Trash2 } from "../../lib/reicon";
import { ModuleHeader, ModuleHeaderLead, ModuleHeaderSpacer, ModuleHeaderTitle, ModuleIconTile } from "../../app/ModuleHeader";
import { SystemCleanerModuleIcon } from "../../app/moduleIdentityIcons";
import { ConfirmSheet } from "../../app/ui/dialog";
import { invokeCommand, isTauriRuntime } from "../../lib/tauri";
import { useWorkspaceStore } from "../../store";
import type { SystemCleanerOverview, SystemCleanerScanProgress } from "./types";
import "./systemCleaner.css";

type Section = "storage" | "cleanup" | "apps";

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
  const [section, setSection] = useState<Section>("storage");
  const [overview, setOverview] = useState<SystemCleanerOverview>();
  const [progress, setProgress] = useState<SystemCleanerScanProgress>();
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [confirmCleanup, setConfirmCleanup] = useState(false);
  const [pendingApp, setPendingApp] = useState<SystemCleanerOverview["apps"][number]>();

  const scan = useCallback(async () => {
    if (!isTauriRuntime()) return;
    setBusy(true);
    setProgress({ files: 0, folders: 0, bytes: 0, currentPath: "", elapsedMs: 0 });
    let unlisten: (() => void) | undefined;
    try {
      unlisten = await listen<SystemCleanerScanProgress>("system-cleaner://scan-progress", ({ payload }) => setProgress(payload));
      const next = await invokeCommand("system_cleaner_scan");
      setOverview(next);
      setSelected(next.cleanup.filter((item) => item.bytes > 0).map((item) => item.id));
      setProgress(undefined);
    } catch (error) {
      notice(t("systemCleaner.error", { message: String(error) }), { tone: "error" });
    } finally {
      unlisten?.();
      setBusy(false);
    }
  }, [notice, t]);

  const selectedBytes = useMemo(() => overview?.cleanup.filter((item) => selected.includes(item.id)).reduce((sum, item) => sum + item.bytes, 0) ?? 0, [overview, selected]);

  const sectionCounts = useMemo<Record<Section, number | undefined>>(() => ({
    storage: overview?.folderCount,
    cleanup: overview?.cleanup.length,
    apps: overview?.apps.length,
  }), [overview]);

  async function clean() {
    setBusy(true);
    try {
      const freed = await invokeCommand("system_cleaner_clean", { ids: selected });
      notice(t("systemCleaner.cleaned", { size: formatBytes(freed) }), { tone: "success" });
      await scan();
    } catch (error) { notice(t("systemCleaner.error", { message: String(error) }), { tone: "error" }); setBusy(false); }
  }

  async function uninstall() {
    if (!pendingApp) return;
    const app = pendingApp;
    setPendingApp(undefined);
    setBusy(true);
    try {
      await invokeCommand("system_cleaner_uninstall", { appId: app.id });
      notice(t("systemCleaner.uninstalled", { name: app.name }), { tone: "success" });
      await scan();
    } catch (error) { notice(t("systemCleaner.error", { message: String(error) }), { tone: "error" }); setBusy(false); }
  }

  const capacity = overview?.diskCapacityBytes ?? 0;
  const used = capacity ? capacity - (overview?.diskFreeBytes ?? 0) : overview?.totalBytes ?? 0;

  return <main className="system-cleaner-page" data-active={active}>
    <ModuleHeader>
      <ModuleHeaderLead><ModuleIconTile module="system-cleaner"><SystemCleanerModuleIcon size={16} aria-hidden="true" /></ModuleIconTile><ModuleHeaderTitle>{t("systemCleaner.title")}</ModuleHeaderTitle></ModuleHeaderLead>
      <ModuleHeaderSpacer />
      <button type="button" className="toolbar-button" disabled={busy} onClick={() => void scan()}><RefreshCw size={15} className={busy ? "spin" : ""} />{t("systemCleaner.scan")}</button>
    </ModuleHeader>
    <div className="system-cleaner-scanbar">
      <label><span>{t("systemCleaner.select")}</span><select disabled><option>{overview?.scanRoot ?? "C:\\"}</option></select></label>
      <div className="system-cleaner-scan-status">
        <span>{busy ? t("systemCleaner.scanProgress", { files: formatCount(progress?.files ?? 0), size: formatBytes(progress?.bytes ?? 0) }) : overview ? t("systemCleaner.scanComplete", { seconds: (overview.elapsedMs / 1000).toFixed(1) }) : t("systemCleaner.scanHint")}</span>
        <div className={`system-cleaner-progress${busy ? " active" : overview ? " complete" : ""}`}><i /></div>
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
        {!overview ? <div className="system-cleaner-empty"><span className="system-cleaner-empty-icon">{busy ? <RefreshCw size={24} className="spin" /> : <HardDrive size={24} />}</span><p>{busy ? progress?.currentPath || t("systemCleaner.scanning") : t("systemCleaner.scanHint")}</p>{!busy ? <button type="button" className="toolbar-button" onClick={() => void scan()}><RefreshCw size={14} />{t("systemCleaner.scan")}</button> : null}</div> : null}
        {overview && section === "storage" ? <div className="system-cleaner-view system-cleaner-storage-view"><header className="system-cleaner-view-head"><div><h2>{t("systemCleaner.storage")}</h2><p title={overview.scanRoot}>{t("systemCleaner.storageHeading", { root: overview.scanRoot })}</p></div><strong className="system-cleaner-total">{formatBytes(overview.totalBytes)}</strong></header><div className="system-cleaner-storage-grid">
          <div className="system-cleaner-pane"><h3>{t("systemCleaner.folders")}</h3><div className="system-cleaner-table"><header><span>{t("systemCleaner.folder")}</span><span>{t("systemCleaner.percent")}</span><span>{t("systemCleaner.size")}</span></header>{overview.largest.map((entry) => { const percent = overview.totalBytes ? entry.bytes / overview.totalBytes * 100 : 0; return <div className="system-cleaner-storage-row" key={entry.path}><span title={entry.path}><ChevronRight size={13} />{entry.path}</span><span><i style={{ width: `${percent}%` }} />{percent.toFixed(1)}%</span><strong>{formatBytes(entry.bytes)}</strong></div>; })}</div></div>
          <div className="system-cleaner-pane"><h3>{t("systemCleaner.extensions")}</h3><div className="system-cleaner-table"><header><span>{t("systemCleaner.extension")}</span><span>{t("systemCleaner.percent")}</span><span>{t("systemCleaner.files")}</span><span>{t("systemCleaner.size")}</span></header>{overview.extensions.map((entry) => { const percent = overview.totalBytes ? entry.bytes / overview.totalBytes * 100 : 0; return <div className="system-cleaner-extension-row" key={entry.extension}><span>{entry.extension}</span><span><i style={{ width: `${percent}%` }} />{percent.toFixed(1)}%</span><span>{formatCount(entry.files)}</span><strong>{formatBytes(entry.bytes)}</strong></div>; })}</div></div>
        </div></div> : null}
        {overview && section === "cleanup" ? <div className="system-cleaner-view system-cleaner-cleanup-view"><header className="system-cleaner-view-head"><div><h2>{t("systemCleaner.cleanup")}</h2><p>{t("systemCleaner.cleanupHeading")}</p></div><strong className="system-cleaner-total">{formatBytes(selectedBytes)}</strong></header><div className="system-cleaner-list system-cleaner-cleanup-list">{overview.cleanup.map((item) => { const checked = selected.includes(item.id); return <label className={`system-cleaner-row${checked ? " selected" : ""}`} key={item.id}><input type="checkbox" checked={checked} onChange={() => setSelected((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id])} /><span><b>{t(`systemCleaner.category.${item.id}`)}</b><small title={item.path}>{item.path}</small></span><strong>{formatBytes(item.bytes)}</strong></label>; })}</div><footer className="system-cleaner-action-bar"><button type="button" className="primary-button" disabled={busy || selectedBytes === 0} onClick={() => setConfirmCleanup(true)}><Trash2 size={15} />{t("systemCleaner.clean", { size: formatBytes(selectedBytes) })}</button></footer></div> : null}
        {overview && section === "apps" ? <div className="system-cleaner-view"><header className="system-cleaner-view-head"><div><h2>{t("systemCleaner.apps")}</h2><p>{t("systemCleaner.appsHeading")}</p></div></header><div className="system-cleaner-list system-cleaner-app-list">{overview.apps.map((app, index) => <div className="system-cleaner-row" key={`${app.id}-${app.version}-${index}`}><span><b>{app.name}</b><small>{app.id} · {app.version}</small></span><button type="button" className="system-cleaner-uninstall" onClick={() => setPendingApp(app)}>{t("systemCleaner.uninstall")}</button></div>)}</div></div> : null}
      </section>
    </div>
    {confirmCleanup ? <ConfirmSheet tone="danger" title={t("systemCleaner.cleanTitle")} message={t("systemCleaner.cleanMessage", { size: formatBytes(selectedBytes) })} confirmLabel={t("systemCleaner.clean", { size: formatBytes(selectedBytes) })} onConfirm={() => { setConfirmCleanup(false); void clean(); }} onCancel={() => setConfirmCleanup(false)} /> : null}
    {pendingApp ? <ConfirmSheet tone="danger" title={t("systemCleaner.uninstallTitle")} message={t("systemCleaner.uninstallMessage", { name: pendingApp.name })} confirmLabel={t("systemCleaner.uninstall")} onConfirm={() => void uninstall()} onCancel={() => setPendingApp(undefined)} /> : null}
  </main>;
}
