import { Check, ChevronUp, Folder, RefreshCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { DialogPortal } from "../../../../app/DialogPortal";
import { LegacyDialogActions } from "../../../../app/ui/dialog";
import { sftpBrowserCommands } from "../../../../lib/fileBrowserCommands";
import { technicalInputProps } from "../../../../lib/inputBehavior";
import { invokeCommand, isTauriRuntime } from "../../../../lib/tauri";
import { useWorkspaceStore } from "../../../../store";
import type { Connection } from "../../../../types";
import { confirmTrustedSshHostKey, resolveSshSocksProxyRequest, uniqueRuntimeId, usesNativeSshHostKeyVerification } from "../utils";

function parentRemotePath(path: string) {
  const trimmed = path.trim();
  if (!trimmed || trimmed === "." || trimmed === "/" || /^[A-Za-z]:[\\/]?$/.test(trimmed)) {
    return trimmed || ".";
  }
  const normalized = trimmed.replace(/[\\/]+$/g, "");
  const separator = normalized.includes("\\") && !normalized.includes("/") ? "\\" : "/";
  const index = normalized.lastIndexOf(separator);
  if (index <= 0) {
    return separator === "\\" ? normalized : "/";
  }
  return normalized.slice(0, index);
}

function joinRemoteDirectory(basePath: string, childName: string) {
  const trimmed = basePath.trim();
  if (!trimmed || trimmed === ".") {
    return childName;
  }
  const separator = trimmed.includes("\\") && !trimmed.includes("/") ? "\\" : "/";
  if (trimmed.endsWith("/") || trimmed.endsWith("\\")) {
    return `${trimmed}${childName}`;
  }
  return `${trimmed}${separator}${childName}`;
}

export function RemoteDirectoryPickerDialog({
  connection,
  initialPath,
  onCancel,
  onSelect,
}: {
  connection: Connection;
  initialPath: string;
  onCancel: () => void;
  onSelect: (path: string) => void;
}) {
  const { t } = useTranslation();
  const sshSettings = useWorkspaceStore((state) => state.sshSettings);
  const showStatusBarNotice = useWorkspaceStore((state) => state.showStatusBarNotice);
  const commands = useMemo(() => sftpBrowserCommands(connection), [connection]);
  const sessionIdRef = useRef<string | null>(null);
  const [path, setPath] = useState(initialPath.trim() || ".");
  const [pathDraft, setPathDraft] = useState(initialPath.trim() || ".");
  const [folders, setFolders] = useState<string[]>([]);
  const [status, setStatus] = useState(t("sftp.openingSftp"));
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!isTauriRuntime()) {
      setStatus(t("sftp.tauriUnavailable"));
      setIsLoading(false);
      return;
    }

    let disposed = false;
    const requestedSessionId = uniqueRuntimeId(`${connection.id}-remote-picker`);
    sessionIdRef.current = requestedSessionId;

    (async () => {
      try {
        if (commands.capabilities.verifySshHostKey && usesNativeSshHostKeyVerification(connection)) {
          const preview = await invokeCommand("inspect_ssh_host_key", {
            request: {
              host: connection.host,
              port: connection.port,
              ...resolveSshSocksProxyRequest(connection, sshSettings),
            },
          });
          await confirmTrustedSshHostKey(preview);
        }

        setStatus(t("sftp.openingSftp"));
        const result = await commands.startSession({
          sessionId: requestedSessionId,
          path: initialPath.trim() || ".",
        });
        if (disposed) {
          void commands.closeSession(result.sessionId);
          return;
        }
        sessionIdRef.current = result.sessionId;
        setPath(result.path);
        setPathDraft(result.path);
        setFolders(
          result.entries
            .filter((entry) => entry.kind === "folder")
            .map((entry) => entry.name)
            .sort((a, b) => a.localeCompare(b)),
        );
        setStatus(t("connections.remoteDirectoryPickerConnected"));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!disposed) {
          setStatus(message);
          setFolders([]);
          showStatusBarNotice(message, { tone: "error" });
        }
      } finally {
        if (!disposed) {
          setIsLoading(false);
        }
      }
    })();

    return () => {
      disposed = true;
      const sessionId = sessionIdRef.current;
      if (sessionId) {
        void commands.closeSession(sessionId);
      }
      sessionIdRef.current = null;
    };
  }, [commands, connection, initialPath, showStatusBarNotice, sshSettings, t]);

  const openDirectory = async (nextPath: string) => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) {
      return;
    }
    setIsLoading(true);
    setStatus(t("sftp.openingFolder"));
    try {
      const result = await commands.listDirectory({ sessionId, path: nextPath });
      setPath(result.path);
      setPathDraft(result.path);
      setFolders(
        result.entries
          .filter((entry) => entry.kind === "folder")
          .map((entry) => entry.name)
          .sort((a, b) => a.localeCompare(b)),
      );
      setStatus(t("connections.remoteDirectoryPickerConnected"));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(message);
      showStatusBarNotice(message, { tone: "error" });
    } finally {
      setIsLoading(false);
    }
  };

  const handlePathSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void openDirectory(pathDraft.trim() || ".");
  };

  return (
    <DialogPortal>
      <div className="dialog-backdrop connection-dialog-backdrop" role="presentation">
        <div className="connection-dialog remote-directory-picker-dialog">
          <header className="connection-dialog-header compact">
            <div>
              <p className="connection-dialog-eyebrow">{t("connections.remoteDirectoryPickerTitle")}</p>
            </div>
          </header>

          <div className="remote-directory-picker-body">
            <form className="remote-directory-picker-path-row" onSubmit={handlePathSubmit}>
              <label>
                <span>{t("connections.remoteDirectoryPickerPath")}</span>
                <input
                  {...technicalInputProps}
                  value={pathDraft}
                  onChange={(event) => setPathDraft(event.currentTarget.value)}
                />
              </label>
              <button className="toolbar-button" disabled={isLoading} type="submit">
                <RefreshCcw size={15} />
                {t("connections.remoteDirectoryPickerOpen")}
              </button>
            </form>

            <div className="remote-directory-picker-list" aria-busy={isLoading}>
              <button
                className="remote-directory-picker-row"
                disabled={isLoading}
                type="button"
                onClick={() => void openDirectory(parentRemotePath(path))}
              >
                <ChevronUp size={16} />
                <span>{t("connections.remoteDirectoryPickerParent")}</span>
              </button>
              {folders.map((folder) => (
                <button
                  className="remote-directory-picker-row"
                  disabled={isLoading}
                  key={folder}
                  type="button"
                  onClick={() => void openDirectory(joinRemoteDirectory(path, folder))}
                >
                  <Folder size={16} />
                  <span>{folder}</span>
                </button>
              ))}
              {!isLoading && folders.length === 0 ? (
                <p className="remote-directory-picker-empty">{t("connections.remoteDirectoryPickerEmpty")}</p>
              ) : null}
            </div>

            <p className="remote-directory-picker-status">{isLoading ? t("sftp.loading") : status}</p>
          </div>

          <LegacyDialogActions
            primary={
              <button className="approve-button" disabled={isLoading} type="button" onClick={() => onSelect(path)}>
                <Check size={15} />
                {t("connections.remoteDirectoryPickerSelect")}
              </button>
            }
            cancel={
              <button className="toolbar-button" type="button" onClick={onCancel}>
                {t("connections.cancel")}
              </button>
            }
          />
        </div>
      </div>
    </DialogPortal>
  );
}
