// Bind Connections to one IT Ops Host. A Host may bind several Connections at
// once — e.g. its SSH terminal plus an HTTPS URL Connection to its management
// interface. Mirrors RackItemBindingsDialog's multi-select pattern.

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Actions, Btn, DialogShell, Sheet, TextInput } from "../../app/ui/dialog";
import { invokeCommand, isTauriRuntime } from "../../lib/tauri";
import { useWorkspaceStore } from "../../store";
import type {
  Connection,
  ConnectionPasswordCredentialEntry,
  ItopsTransport,
  SiteHost,
  WindowsExecutionContext,
} from "../../types";
import { flattenConnections } from "../workspace/connections/treeUtils";
import { useItOpsStore } from "./state";

export function HostBindingsDialog({
  siteId,
  host,
  onClose,
}: {
  siteId: string;
  host: SiteHost;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const showStatusBarNotice = useWorkspaceStore((state) => state.showStatusBarNotice);
  const updateHost = useItOpsStore((state) => state.updateHost);
  const setHostExecution = useItOpsStore((state) => state.setHostExecution);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [selected, setSelected] = useState(() => new Set(host.connectionIds));
  const [credentials, setCredentials] = useState<ConnectionPasswordCredentialEntry[]>([]);
  const [transport, setTransport] = useState<ItopsTransport>(host.execution?.transport ?? "auto");
  const [credentialId, setCredentialId] = useState(host.execution?.credentialId ?? "");
  const [newCredentialLabel, setNewCredentialLabel] = useState("");
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [winrmUseTls, setWinrmUseTls] = useState(host.execution?.winrmUseTls ?? false);
  const [winrmPort, setWinrmPort] = useState(
    host.execution?.winrmPort?.toString() ?? "",
  );
  const [acceptInvalidCerts, setAcceptInvalidCerts] = useState(
    host.execution?.winrmAcceptInvalidCerts ?? false,
  );
  const [psexecContext, setPsexecContext] = useState<WindowsExecutionContext>(
    host.execution?.psexecContext ?? "system",
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    // A Site can reference Connections from any Workspace, so Host bindings
    // must use the full tree rather than the active Workspace's sidebar tree.
    void invokeCommand("list_connection_tree")
      .then((tree) => setConnections(flattenConnections(tree)))
      .catch(() => setConnections([]));
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    void invokeCommand("list_connection_password_credentials")
      .then(setCredentials)
      .catch(() => setCredentials([]));
  }, []);

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  async function save() {
    setBusy(true);
    try {
      let savedCredentialId = credentialId;
      await updateHost(siteId, host.id, {
        hostname: host.hostname,
        label: host.label,
        kind: host.kind,
        parentHostId: host.parentHostId ?? null,
        connectionIds: [...selected],
        notes: host.notes,
      });
      if (credentialId === "__new__") {
        const created = await invokeCommand("create_standalone_connection_password_credential", {
          request: {
            label: newCredentialLabel,
            username: newUsername,
            secret: newPassword,
          },
        });
        savedCredentialId = created.id;
      }
      await setHostExecution(siteId, host.id, {
        transport,
        credentialId: savedCredentialId || null,
        winrmUseTls,
        winrmPort: winrmPort.trim() ? Number(winrmPort) : null,
        winrmAcceptInvalidCerts: acceptInvalidCerts,
        psexecContext,
      });
      onClose();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showStatusBarNotice(t("itops.errorNotice", { message }), { tone: "error" });
      setBusy(false);
    }
  }

  const requiresCredential = transport === "winrm" || transport === "psexec";
  const newCredentialValid =
    credentialId === "__new__" &&
    newCredentialLabel.trim() !== "" &&
    newUsername.trim() !== "" &&
    newPassword !== "";
  const savedCredentialValid = credentials.some(
    (credential) => credential.id === credentialId && credential.secretExists,
  );
  const credentialValid =
    credentialId === ""
      ? !requiresCredential
      : newCredentialValid || savedCredentialValid;
  const parsedWinrmPort = winrmPort.trim() ? Number(winrmPort) : null;
  const winrmPortValid =
    parsedWinrmPort === null ||
    (Number.isInteger(parsedWinrmPort) && parsedWinrmPort >= 1 && parsedWinrmPort <= 65535);

  return (
    <DialogShell onBackdrop={onClose} zClassName="itops-page">
      <Sheet
        width={680}
        title={t("itops.hosts.bindingsTitle")}
        ariaLabel={t("itops.hosts.bindingsTitle")}
        footer={
          <Actions
            cancel={<Btn onClick={onClose}>{t("itops.actions.cancel")}</Btn>}
            primary={
              <Btn kind="primary" disabled={busy || !credentialValid || !winrmPortValid} onClick={() => void save()}>
                {t("itops.actions.save")}
              </Btn>
            }
          />
        }
      >
        <p className="hg-dlg-help">{t("itops.hosts.bindingsHint")}</p>
        <div className="connection-binding-list standalone">
          {connections.length === 0 ? (
            <div className="hg-dlg-empty">{t("itops.sites.noConnections")}</div>
          ) : (
            connections.map((connection) => (
              <label className="connection-binding-row" key={connection.id}>
                <input
                  type="checkbox"
                  checked={selected.has(connection.id)}
                  onChange={() => toggle(connection.id)}
                />
                <span>{connection.name}</span>
                <small>{connection.host}</small>
              </label>
            ))
          )}
        </div>
        <section className="it-host-execution-settings">
          <h3>{t("itops.hosts.executionHeading")}</h3>
          <p className="hg-dlg-help">{t("itops.hosts.executionHint")}</p>
          <label>
            <span>{t("itops.hosts.executionTransportLabel")}</span>
            <select value={transport} onChange={(event) => setTransport(event.target.value as ItopsTransport)}>
              <option value="auto">{t("itops.hosts.executionTransportAuto")}</option>
              <option value="ssh">SSH</option>
              <option value="winrm">WinRM</option>
              <option value="psexec">PsExec</option>
            </select>
          </label>
          <label>
            <span>{t("itops.hosts.executionCredentialLabel")}</span>
            <select value={credentialId} onChange={(event) => setCredentialId(event.target.value)}>
              <option value="">{t("itops.hosts.executionCredentialNone")}</option>
              {credentials.filter((credential) => credential.secretExists).map((credential) => (
                <option key={credential.id} value={credential.id}>
                  {credential.label} · {credential.username}
                </option>
              ))}
              <option value="__new__">{t("itops.hosts.executionCredentialNew")}</option>
            </select>
          </label>
          {credentialId === "__new__" ? (
            <div className="it-host-new-credential">
              <TextInput value={newCredentialLabel} onChange={(event) => setNewCredentialLabel(event.target.value)} placeholder={t("itops.hosts.executionCredentialNamePlaceholder")} />
              <TextInput value={newUsername} onChange={(event) => setNewUsername(event.target.value)} placeholder={t("itops.hosts.executionUsernamePlaceholder")} />
              <TextInput type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder={t("itops.hosts.executionPasswordPlaceholder")} />
            </div>
          ) : null}
          {transport === "winrm" || transport === "auto" ? (
            <div className="it-host-winrm-options">
              <label className="it-host-checkbox"><input type="checkbox" checked={winrmUseTls} onChange={(event) => setWinrmUseTls(event.target.checked)} />{t("itops.hosts.winrmUseTls")}</label>
              <label><span>{t("itops.hosts.winrmPortLabel")}</span><TextInput inputMode="numeric" value={winrmPort} onChange={(event) => setWinrmPort(event.target.value.replace(/\D/g, "").slice(0, 5))} placeholder={winrmUseTls ? "5986" : "5985"} /></label>
              {winrmUseTls ? <label className="it-host-checkbox"><input type="checkbox" checked={acceptInvalidCerts} onChange={(event) => setAcceptInvalidCerts(event.target.checked)} />{t("itops.hosts.winrmInvalidCerts")}</label> : null}
              <p className="hg-dlg-help">{t("itops.hosts.winrmContextHint")}</p>
            </div>
          ) : null}
          {transport === "psexec" ? (
            <label>
              <span>{t("itops.hosts.psexecContextLabel")}</span>
              <select value={psexecContext} onChange={(event) => setPsexecContext(event.target.value as WindowsExecutionContext)}>
                <option value="system">{t("itops.hosts.psexecContextSystem")}</option>
                <option value="elevated">{t("itops.hosts.psexecContextElevated")}</option>
                <option value="user">{t("itops.hosts.psexecContextUser")}</option>
                <option value="limited">{t("itops.hosts.psexecContextLimited")}</option>
              </select>
              <small>{t("itops.hosts.psexecContextHint")}</small>
            </label>
          ) : null}
        </section>
      </Sheet>
    </DialogShell>
  );
}
