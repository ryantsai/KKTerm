// Hosts page (docs/ITOPS.md Hosts) — one Site's Host inventory. A flat
// toolbar plus the parent/child Host tree: each row shows the Host's kind,
// name, detected remote-access chips from the last connectivity scan, bound
// Connection count, and per-row actions (rescan, add child, bindings, edit,
// delete). Import accepts a pasted hostname list and auto-scans the new rows.

import { useEffect, useMemo, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { ConfirmSheet } from "../../app/ui/dialog";
import { invokeCommand, isTauriRuntime } from "../../lib/tauri";
import { useWorkspaceStore } from "../../store";
import type { Connection, HostScanEvent, SiteHost } from "../../types";
import { flattenConnections } from "../workspace/connections/treeUtils";
import { ItIcon, type ItIconName } from "./icons";
import { HostDialog } from "./HostDialog";
import { HostImportDialog } from "./HostImportDialog";
import { connectionImportEndpoint } from "./hostConnectionImport";
import { HostBindingsDialog } from "./HostBindingsDialog";
import { ItOpsEmptyHint } from "./ItOpsEmptyHint";
import { buildHostTreeRows, childHostsOf, hostDisplayName } from "./hostTree";
import { hostRunStatuses, type HostRunStatus } from "./hostRunStatus";
import { useItOpsStore } from "./state";

const KIND_ICON: Record<SiteHost["kind"], ItIconName> = {
  physical: "server",
  vm: "cube",
  container: "grid",
  other: "network",
};

const RUN_STATUS_ICON: Record<Exclude<HostRunStatus["current"], null>, ItIconName> = {
  pending: "pending",
  running: "spinner",
  ok: "check",
  failed: "xmark",
};

function HostTaskStatus({ status }: { status: HostRunStatus["current"] }) {
  const { t } = useTranslation();
  if (!status) return <span className="it-host-run-status empty">—</span>;
  const label =
    status === "pending"
      ? t("itops.batchRuns.codeQueued")
      : status === "running"
        ? t("itops.batchRuns.codeRunning")
        : status === "ok"
          ? t("itops.batchRuns.statOk")
          : t("itops.batchRuns.statFailed");
  return (
    <span className={`it-host-run-status ${status}`}>
      <ItIcon name={RUN_STATUS_ICON[status]} size={12} />
      {label}
    </span>
  );
}

function HostLastRunStatus({ status }: { status: HostRunStatus["last"] }) {
  const { t } = useTranslation();
  if (!status) return <span className="it-host-run-status empty">—</span>;
  return (
    <span className={`it-host-run-status ${status}`}>
      <ItIcon name={status === "ok" ? "check" : "xmark"} size={12} />
      {status === "ok" ? t("itops.batchRuns.statOk") : t("itops.batchRuns.statFailed")}
    </span>
  );
}

/** Detected remote-access chips for one Host's last scan. */
export function HostScanChips({ host, scanning, connections = [] }: { host: SiteHost; scanning: boolean; connections?: Connection[] }) {
  const { t } = useTranslation();
  if (scanning) {
    return (
      <span className="it-host-chip scanning">
        <ItIcon name="spinner" size={12} />
        {t("itops.hosts.scanning")}
      </span>
    );
  }
  const boundEndpoints = connections
    .filter((connection) => host.connectionIds.includes(connection.id))
    .map(connectionImportEndpoint)
    .filter((endpoint) => endpoint !== null);
  if (!host.scan && boundEndpoints.length === 0) {
    return <span className="it-host-chip muted">{t("itops.hosts.scanPending")}</span>;
  }
  const chips: { key: string; icon: ItIconName; label: string }[] = [];
  // The endpoint names are technical tokens rendered verbatim, like the
  // TransportChip's transport ids.
  for (const endpoint of boundEndpoints) {
    chips.push({
      key: `connection-${endpoint.connectionId}`,
      icon: endpoint.protocol === "SSH" ? "ssh" : endpoint.protocol === "HTTP" || endpoint.protocol === "HTTPS" ? "globe" : "windows",
      label: `${endpoint.protocol} ${endpoint.port}`,
    });
  }
  const addScanPorts = (key: string, icon: ItIconName, label: string, ports: number[]) => {
    for (const port of ports) {
      if (!chips.some((chip) => chip.label.toLocaleLowerCase() === `${label} ${port}`.toLocaleLowerCase())) {
        chips.push({ key: `${key}-${port}`, icon, label: `${label} ${port}` });
      }
    }
  };
  if (host.scan?.ssh) addScanPorts("ssh", "ssh", "SSH", host.scan.sshPorts?.length ? host.scan.sshPorts : [22]);
  if (host.scan?.winrm) addScanPorts("winrm", "windows", "WinRM", host.scan.winrmPorts?.length ? host.scan.winrmPorts : [5985]);
  if (host.scan?.psexec) addScanPorts("psexec", "windows", "PsExec/SMB", host.scan.psexecPorts?.length ? host.scan.psexecPorts : [445]);
  if (host.scan?.https) addScanPorts("https", "globe", "HTTPS", host.scan.httpsPorts?.length ? host.scan.httpsPorts : [443]);
  if (chips.length === 0) {
    return <span className="it-host-chip muted">{t("itops.hosts.scanNone")}</span>;
  }
  return (
    <>
      {chips.map((chip) => (
        <span key={chip.key} className={`it-host-chip ${chip.key}`}>
          <ItIcon name={chip.icon} size={12} />
          {chip.label}
        </span>
      ))}
    </>
  );
}

export function HostsPanel({ siteId }: { siteId: string }) {
  const { t } = useTranslation();
  const showStatusBarNotice = useWorkspaceStore((state) => state.showStatusBarNotice);
  const hosts = useItOpsStore((state) => state.hostsBySite[siteId]);
  const scanningHostIds = useItOpsStore((state) => state.scanningHostIds);
  const loadHosts = useItOpsStore((state) => state.loadHosts);
  const scanHosts = useItOpsStore((state) => state.scanHosts);
  const deleteHost = useItOpsStore((state) => state.deleteHost);
  const applyHostScanEvent = useItOpsStore((state) => state.applyHostScanEvent);
  const requestNewBatchRun = useItOpsStore((state) => state.requestNewBatchRun);
  const activeRun = useItOpsStore((state) => state.activeRun);
  const runHistory = useItOpsStore((state) => state.runHistory);

  const [importOpen, setImportOpen] = useState(false);
  const [editorHost, setEditorHost] = useState<SiteHost | null>(null);
  const [editorParentId, setEditorParentId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [bindingsHost, setBindingsHost] = useState<SiteHost | null>(null);
  const [pendingDelete, setPendingDelete] = useState<SiteHost | null>(null);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [selectedHostIds, setSelectedHostIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    void loadHosts(siteId).catch(() => undefined);
  }, [siteId, loadHosts]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    void invokeCommand("list_connection_tree")
      .then((tree) => setConnections(flattenConnections(tree)))
      .catch(() => setConnections([]));
  }, []);

  const runnableHostIds = useMemo(() => {
    const sshConnectionIds = new Set(
      connections
        .filter((connection) => connection.type === "ssh")
        .map((connection) => connection.id),
    );
    return new Set(
      (hosts ?? [])
        .filter((host) =>
          host.connectionIds.some((id) => sshConnectionIds.has(id)) ||
          (!!host.execution?.credentialId &&
            (host.execution.transport === "winrm" ||
              host.execution.transport === "psexec" ||
              (host.execution.transport === "auto" && !!(host.scan?.winrm || host.scan?.psexec)))),
        )
        .map((host) => host.id),
    );
  }, [connections, hosts]);

  useEffect(() => {
    setSelectedHostIds((current) => {
      const next = new Set([...current].filter((id) => runnableHostIds.has(id)));
      return next.size === current.size && [...next].every((id) => current.has(id)) ? current : next;
    });
  }, [runnableHostIds]);

  // Stream per-host scan results into the store so chips update as they land.
  useEffect(() => {
    if (!isTauriRuntime()) return;
    const unlisten = listen<HostScanEvent>("itops://host-scan", (event) =>
      applyHostScanEvent(event.payload),
    );
    return () => {
      void unlisten.then((dispose) => dispose());
    };
  }, [applyHostScanEvent]);

  function notifyError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    showStatusBarNotice(t("itops.errorNotice", { message }), { tone: "error" });
  }

  function openEditor(host: SiteHost | null, parentId: string | null = null) {
    setEditorHost(host);
    setEditorParentId(parentId);
    setEditorOpen(true);
  }

  async function rescan(hostIds: string[]) {
    try {
      await scanHosts(siteId, hostIds);
    } catch (error) {
      notifyError(error);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    try {
      await deleteHost(siteId, pendingDelete.id);
    } catch (error) {
      notifyError(error);
    } finally {
      setPendingDelete(null);
    }
  }

  const rows = buildHostTreeRows(hosts ?? []);
  const runStatuses = useMemo(
    () => hostRunStatuses(hosts ?? [], siteId, activeRun, runHistory),
    [activeRun, hosts, runHistory, siteId],
  );

  function toggleSelected(id: string) {
    if (!runnableHostIds.has(id)) return;
    setSelectedHostIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllRunnable() {
    setSelectedHostIds((current) =>
      current.size === runnableHostIds.size ? new Set() : new Set(runnableHostIds),
    );
  }

  return (
    <div className="it-hosts it-destination-surface" data-tutorial-id="itops.hostsPanel">
      <div className="it-destination-page-head">
        <div>
          <h2>{t("itops.tabs.hosts")}</h2>
          <p>{t("itops.hosts.pageDescription")}</p>
        </div>
        <span className="it-hosts-selection-count">
          {t("itops.hosts.selectedCount", { count: selectedHostIds.size })}
        </span>
        <button
          type="button"
          className="it-btn primary"
          data-tutorial-id="itops.hostsRunTask"
          disabled={selectedHostIds.size === 0}
          onClick={() => requestNewBatchRun(siteId, { hostIds: [...selectedHostIds] })}
        >
          <ItIcon name="run" size={14} />
          {t("itops.actions.runTask")}
        </button>
      </div>
      <div className="it-hosts-toolbar">
        <label className="it-host-select-all">
          <input
            type="checkbox"
            checked={runnableHostIds.size > 0 && selectedHostIds.size === runnableHostIds.size}
            disabled={runnableHostIds.size === 0}
            onChange={toggleAllRunnable}
          />
          {t("itops.hosts.selectAll")}
        </label>
        <span className="it-hosts-count">
          {t("itops.hosts.hostCount", { count: hosts?.length ?? 0 })}
        </span>
        <span className="it-hosts-sp" />
        <button type="button" className="it-hosts-action" data-tutorial-id="itops.hostsScan" onClick={() => void rescan([])} disabled={!hosts?.length}>
          <ItIcon name="rerun" size={13} />
          {t("itops.hosts.rescanAllAction")}
        </button>
        <button type="button" className="it-hosts-action" onClick={() => openEditor(null)}>
          <ItIcon name="plus" size={13} />
          {t("itops.hosts.addAction")}
        </button>
        <button type="button" className="it-hosts-action primary" data-tutorial-id="itops.hostsImport" onClick={() => setImportOpen(true)}>
          <ItIcon name="download" size={13} />
          {t("itops.hosts.importAction")}
        </button>
      </div>
      {rows.length === 0 ? (
        <ItOpsEmptyHint>
          <Trans
            i18nKey="itops.hosts.empty"
            components={{
              importHosts: <button type="button" onClick={() => setImportOpen(true)} />,
            }}
          />
        </ItOpsEmptyHint>
      ) : (
        <div className="it-hosts-list" role="tree" aria-label={t("itops.tabs.hosts")}>
          <div className="it-host-list-head" aria-hidden="true">
            <span className="it-host-list-head-spacer" />
            <span>{t("itops.hosts.taskStatusColumn")}</span>
            <span>{t("itops.hosts.lastRunStatusColumn")}</span>
            <span className="it-host-list-head-actions" />
          </div>
          {rows.map(({ host, depth }) => {
            const scanning = !!scanningHostIds[host.id];
            const childCount = childHostsOf(hosts ?? [], host.id).length;
            const runStatus = runStatuses.get(host.id) ?? { current: null, last: null };
            return (
              <div
                key={host.id}
                className="it-host-row"
                data-tutorial-id={`itops.host:${host.id}`}
                role="treeitem"
                aria-level={depth + 1}
                style={{ paddingLeft: 10 + depth * 22 }}
              >
                <input
                  type="checkbox"
                  className="it-host-select"
                  checked={selectedHostIds.has(host.id)}
                  disabled={!runnableHostIds.has(host.id)}
                  title={!runnableHostIds.has(host.id) ? t("itops.hosts.noRunnableConnection") : undefined}
                  aria-label={t("itops.hosts.selectHost", { name: hostDisplayName(host) })}
                  onChange={() => toggleSelected(host.id)}
                />
                <span className={`it-host-kind ${host.kind}`} title={t(`itops.hosts.kind.${host.kind}`)}>
                  <ItIcon name={KIND_ICON[host.kind]} size={14} />
                </span>
                <span className="it-host-name">
                  <span className="nm">{hostDisplayName(host)}</span>
                  {host.label.trim() ? <span className="addr">{host.hostname}</span> : null}
                  {childCount > 0 ? (
                    <span className="kids">{t("itops.hosts.childCount", { count: childCount })}</span>
                  ) : null}
                </span>
                <span className="it-host-chips">
                  <HostScanChips host={host} scanning={scanning} connections={connections} />
                </span>
                <HostTaskStatus status={runStatus.current} />
                <HostLastRunStatus status={runStatus.last} />
                <button
                  type="button"
                  className={`it-host-bind${host.connectionIds.length > 0 ? " bound" : ""}`}
                  title={t("itops.hosts.bindingsAction")}
                  onClick={() => setBindingsHost(host)}
                >
                  <ItIcon name="link" size={13} />
                  {host.connectionIds.length > 0 ? host.connectionIds.length : ""}
                </button>
                <span className="it-host-actions">
                  <button
                    type="button"
                    title={t("itops.hosts.rescanAction")}
                    aria-label={t("itops.hosts.rescanAction")}
                    onClick={() => void rescan([host.id])}
                  >
                    <ItIcon name="rerun" size={13} />
                  </button>
                  <button
                    type="button"
                    title={t("itops.hosts.addChildAction")}
                    aria-label={t("itops.hosts.addChildAction")}
                    onClick={() => openEditor(null, host.id)}
                  >
                    <ItIcon name="plus" size={13} />
                  </button>
                  <button
                    type="button"
                    title={t("itops.hosts.editAction")}
                    aria-label={t("itops.hosts.editAction")}
                    onClick={() => openEditor(host)}
                  >
                    <ItIcon name="edit" size={13} />
                  </button>
                  <button
                    type="button"
                    title={t("itops.hosts.deleteAction")}
                    aria-label={t("itops.hosts.deleteAction")}
                    onClick={() => setPendingDelete(host)}
                  >
                    <ItIcon name="trash" size={13} />
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      )}

      {importOpen ? <HostImportDialog siteId={siteId} onClose={() => setImportOpen(false)} /> : null}
      {editorOpen ? (
        <HostDialog
          siteId={siteId}
          host={editorHost}
          defaultParentId={editorParentId}
          onClose={() => setEditorOpen(false)}
        />
      ) : null}
      {bindingsHost ? (
        <HostBindingsDialog
          siteId={siteId}
          host={bindingsHost}
          onClose={() => setBindingsHost(null)}
        />
      ) : null}
      {pendingDelete ? (
        <ConfirmSheet
          tone="danger"
          title={t("itops.hosts.deleteConfirmTitle", { name: hostDisplayName(pendingDelete) })}
          message={t("itops.hosts.deleteConfirmBody")}
          confirmLabel={t("itops.hosts.deleteAction")}
          cancelLabel={t("itops.actions.cancel")}
          onConfirm={() => void confirmDelete()}
          onCancel={() => setPendingDelete(null)}
        />
      ) : null}
    </div>
  );
}
