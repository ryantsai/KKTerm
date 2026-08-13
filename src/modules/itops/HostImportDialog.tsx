// Import Hosts from either a pasted hostname list or existing Connections.
// The Connection preview stages one row per normalized host and shows every
// protocol/port that will be bound to that Host.

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Actions, Btn, DialogShell, Sheet, TextArea } from "../../app/ui/dialog";
import { invokeCommand, isTauriRuntime } from "../../lib/tauri";
import { useWorkspaceStore } from "../../store";
import type { Connection } from "../../types";
import { flattenConnections } from "../workspace/connections/treeUtils";
import { groupConnectionImports } from "./hostConnectionImport";
import { parseHostnameList } from "./hostTree";
import { useItOpsStore } from "./state";

type ImportSource = "list" | "connections";

export function HostImportDialog({ siteId, onClose }: { siteId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const showStatusBarNotice = useWorkspaceStore((state) => state.showStatusBarNotice);
  const importHosts = useItOpsStore((state) => state.importHosts);
  const importHostsFromConnections = useItOpsStore((state) => state.importHostsFromConnections);
  const [source, setSource] = useState<ImportSource>("connections");
  const [text, setText] = useState("");
  const [connections, setConnections] = useState<Connection[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    void invokeCommand("list_connection_tree")
      .then((tree) => {
        const next = flattenConnections(tree);
        setConnections(next);
        setSelected(new Set(next.map((connection) => connection.id)));
      })
      .catch(() => setConnections([]));
  }, []);

  const hostnames = parseHostnameList(text);
  const groups = useMemo(() => groupConnectionImports(connections), [connections]);
  const selectedGroups = groups.filter((group) =>
    group.endpoints.some((endpoint) => selected.has(endpoint.connectionId)),
  );
  const importCount = source === "list" ? hostnames.filter(Boolean).length : selectedGroups.length;

  function toggleGroup(connectionIds: string[]) {
    setSelected((current) => {
      const next = new Set(current);
      const allSelected = connectionIds.every((id) => next.has(id));
      for (const id of connectionIds) {
        if (allSelected) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }

  async function submit() {
    setBusy(true);
    try {
      const result =
        source === "list"
          ? await importHosts(siteId, hostnames)
          : await importHostsFromConnections(siteId, [...selected]);
      showStatusBarNotice(
        t("itops.hosts.importedNotice", {
          count: result.created,
          updated: result.updated,
          skipped: result.skipped,
        }),
        { tone: result.hosts.length > 0 ? "success" : "warning" },
      );
      onClose();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showStatusBarNotice(t("itops.errorNotice", { message }), { tone: "error" });
      setBusy(false);
    }
  }

  return (
    <DialogShell onBackdrop={onClose} zClassName="itops-page">
      <Sheet
        width={620}
        title={t("itops.hosts.importTitle")}
        ariaLabel={t("itops.hosts.importTitle")}
        footer={
          <Actions
            cancel={<Btn onClick={onClose}>{t("itops.actions.cancel")}</Btn>}
            primary={
              <Btn kind="primary" disabled={busy || importCount === 0} onClick={() => void submit()}>
                {t("itops.hosts.importSubmit", { count: importCount })}
              </Btn>
            }
          />
        }
      >
        <div className="it-host-import-source" role="tablist" aria-label={t("itops.hosts.importSourceLabel")}>
          <button type="button" role="tab" aria-selected={source === "connections"} className={source === "connections" ? "active" : ""} onClick={() => setSource("connections")}>
            {t("itops.hosts.importSourceConnections")}
          </button>
          <button type="button" role="tab" aria-selected={source === "list"} className={source === "list" ? "active" : ""} onClick={() => setSource("list")}>
            {t("itops.hosts.importSourceList")}
          </button>
        </div>
        {source === "list" ? (
          <>
            <p className="hg-dlg-help">{t("itops.hosts.importHint")}</p>
            <TextArea
              rows={10}
              className="mono"
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder={t("itops.hosts.importPlaceholder")}
              autoFocus
            />
          </>
        ) : (
          <>
            <p className="hg-dlg-help">{t("itops.hosts.importConnectionsHint")}</p>
            <div className="it-host-import-groups">
              {groups.length === 0 ? (
                <div className="hg-dlg-empty">{t("itops.hosts.importConnectionsEmpty")}</div>
              ) : groups.map((group) => {
                const ids = group.endpoints.map((endpoint) => endpoint.connectionId);
                const checked = ids.every((id) => selected.has(id));
                return (
                  <label className="it-host-import-group" key={group.key}>
                    <input type="checkbox" checked={checked} onChange={() => toggleGroup(ids)} />
                    <span className="it-host-import-name">{group.hostname}</span>
                    <span className="it-host-import-endpoints">
                      {group.endpoints.map((endpoint) => (
                        <span key={endpoint.connectionId}>{endpoint.protocol} {endpoint.port}</span>
                      ))}
                    </span>
                  </label>
                );
              })}
            </div>
            <p className="hg-dlg-help">{t("itops.hosts.importDedupHint", { count: selectedGroups.length })}</p>
          </>
        )}
      </Sheet>
    </DialogShell>
  );
}
