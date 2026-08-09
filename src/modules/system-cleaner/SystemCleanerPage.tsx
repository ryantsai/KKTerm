import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Brush, Box, HardDrive, RefreshCw, Trash2 } from "../../lib/reicon";
import { ModuleHeader, ModuleHeaderLead, ModuleHeaderSpacer, ModuleHeaderTitle, ModuleIconTile } from "../../app/ModuleHeader";
import { SystemCleanerModuleIcon } from "../../app/moduleIdentityIcons";
import { ConfirmSheet } from "../../app/ui/dialog";
import { invokeCommand, isTauriRuntime } from "../../lib/tauri";
import { useWorkspaceStore } from "../../store";
import type { SystemCleanerOverview } from "./types";
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

export function SystemCleanerPage({ active }: { active: boolean }) {
  const { t } = useTranslation();
  const notice = useWorkspaceStore((state) => state.showStatusBarNotice);
  const [section, setSection] = useState<Section>("storage");
  const [overview, setOverview] = useState<SystemCleanerOverview>();
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [confirmCleanup, setConfirmCleanup] = useState(false);
  const [pendingApp, setPendingApp] = useState<SystemCleanerOverview["apps"][number]>();

  const scan = useCallback(async () => {
    if (!isTauriRuntime()) return;
    setBusy(true);
    try {
      const next = await invokeCommand("system_cleaner_scan");
      setOverview(next);
      setSelected(next.cleanup.filter((item) => item.bytes > 0).map((item) => item.id));
    } catch (error) {
      notice(t("systemCleaner.error", { message: String(error) }), { tone: "error" });
    } finally { setBusy(false); }
  }, [notice, t]);

  useEffect(() => { if (active && !overview && !busy) void scan(); }, [active, overview, busy, scan]);

  const selectedBytes = useMemo(() => overview?.cleanup.filter((item) => selected.includes(item.id)).reduce((sum, item) => sum + item.bytes, 0) ?? 0, [overview, selected]);

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

  return <main className="system-cleaner-page" data-active={active}>
    <ModuleHeader>
      <ModuleHeaderLead><ModuleIconTile module="system-cleaner"><SystemCleanerModuleIcon size={16} aria-hidden="true" /></ModuleIconTile><ModuleHeaderTitle>{t("systemCleaner.title")}</ModuleHeaderTitle></ModuleHeaderLead>
      <ModuleHeaderSpacer />
      <button className="toolbar-button" disabled={busy} onClick={() => void scan()}><RefreshCw size={15} className={busy ? "spin" : ""} />{t("systemCleaner.scan")}</button>
    </ModuleHeader>
    <div className="system-cleaner-shell">
      <nav className="system-cleaner-nav">
        {(["storage", "cleanup", "apps"] as const).map((id) => {
          const Icon = id === "storage" ? HardDrive : id === "cleanup" ? Brush : Box;
          return <button key={id} className={section === id ? "active" : ""} onClick={() => setSection(id)}><Icon size={17} />{t(`systemCleaner.${id}`)}</button>;
        })}
      </nav>
      <section className="system-cleaner-content">
        {!overview ? <div className="system-cleaner-empty">{busy ? t("systemCleaner.scanning") : t("systemCleaner.scanHint")}</div> : null}
        {overview && section === "storage" ? <><h2>{t("systemCleaner.storageHeading", { root: overview.scanRoot })}</h2><div className="system-cleaner-total">{formatBytes(overview.totalBytes)}</div><div className="system-cleaner-list">{overview.largest.map((entry) => <div className="system-cleaner-row" key={entry.path}><span title={entry.path}>{entry.path}</span><strong>{formatBytes(entry.bytes)}</strong></div>)}</div></> : null}
        {overview && section === "cleanup" ? <><h2>{t("systemCleaner.cleanupHeading")}</h2><div className="system-cleaner-list">{overview.cleanup.map((item) => <label className="system-cleaner-row" key={item.id}><input type="checkbox" checked={selected.includes(item.id)} onChange={() => setSelected((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id])} /><span><b>{t(`systemCleaner.category.${item.id}`)}</b><small>{item.path}</small></span><strong>{formatBytes(item.bytes)}</strong></label>)}</div><button className="primary-button" disabled={busy || selectedBytes === 0} onClick={() => setConfirmCleanup(true)}><Trash2 size={15} />{t("systemCleaner.clean", { size: formatBytes(selectedBytes) })}</button></> : null}
        {overview && section === "apps" ? <><h2>{t("systemCleaner.appsHeading")}</h2><div className="system-cleaner-list">{overview.apps.map((app, index) => <div className="system-cleaner-row" key={`${app.id}-${app.version}-${index}`}><span><b>{app.name}</b><small>{app.id} · {app.version}</small></span><button className="toolbar-button" onClick={() => setPendingApp(app)}>{t("systemCleaner.uninstall")}</button></div>)}</div></> : null}
      </section>
    </div>
    {confirmCleanup ? <ConfirmSheet tone="danger" title={t("systemCleaner.cleanTitle")} message={t("systemCleaner.cleanMessage", { size: formatBytes(selectedBytes) })} confirmLabel={t("systemCleaner.clean", { size: formatBytes(selectedBytes) })} onConfirm={() => { setConfirmCleanup(false); void clean(); }} onCancel={() => setConfirmCleanup(false)} /> : null}
    {pendingApp ? <ConfirmSheet tone="danger" title={t("systemCleaner.uninstallTitle")} message={t("systemCleaner.uninstallMessage", { name: pendingApp.name })} confirmLabel={t("systemCleaner.uninstall")} onConfirm={() => void uninstall()} onCancel={() => setPendingApp(undefined)} /> : null}
  </main>;
}
