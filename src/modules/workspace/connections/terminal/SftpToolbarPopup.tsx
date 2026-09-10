import { createContext, lazy, Suspense, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { DialogPortal } from "../../../../app/DialogPortal";
import { Folder } from "../../../../lib/reicon";
import type { Connection, WorkspacePane, WorkspaceTab } from "../../../../types";
import { getPaneRenderer } from "../../paneRegistry";
import { connectionToolbarTitle } from "../utils";
import type { SftpPopupActivity } from "../sftp/sftpPopupActivity";

const SftpWorkspace = lazy(() =>
  import("../sftp/SftpWorkspace").then(({ SftpWorkspace }) => ({ default: SftpWorkspace })),
);

type Browser = {
  paneId: string;
  tab: WorkspaceTab;
  initialRemotePath?: string;
  minimized: boolean;
  activity: SftpPopupActivity;
};
type OpenBrowser = (connection: Connection, paneId: string, resolvePath: () => Promise<string | undefined>) => Promise<void>;
const PopupContext = createContext<{ browsers: Browser[]; openBrowser: OpenBrowser } | null>(null);

/** Keep browsers above the split layout: splitting reparents terminal toolbars. */
export function SftpToolbarPopups({ children, panes, tabId, isActive }: {
  children: ReactNode;
  panes: WorkspacePane[];
  tabId: string;
  isActive: boolean;
}) {
  const { t } = useTranslation();
  const [browsers, setBrowsers] = useState<Browser[]>([]);
  const openRequestIdRef = useRef(0);
  useEffect(() => () => { openRequestIdRef.current += 1; }, []);
  useEffect(() => {
    setBrowsers((current) => {
      const remaining = current.filter((browser) => panes.some((pane) => pane.id === browser.paneId));
      return remaining.length === current.length ? current : remaining;
    });
  }, [panes]);

  async function openBrowser(connection: Connection, paneId: string, resolveInitialRemotePath: () => Promise<string | undefined>) {
    const requestId = ++openRequestIdRef.current;
    if (browsers.some((browser) => browser.paneId === paneId)) {
      setBrowsers((current) => current.map((browser) => ({ ...browser, minimized: browser.paneId !== paneId })));
      return;
    }
    const initialRemotePath = await resolveInitialRemotePath();
    if (requestId !== openRequestIdRef.current) return;
    setBrowsers((current) => [...current.map((browser) => ({ ...browser, minimized: true })), {
      paneId,
      tab: {
        id: `dialog-${tabId}-${paneId}-sftp`,
        title: `${connection.name} SFTP`,
        toolbarTitle: connectionToolbarTitle(connection),
        subtitle: `${connection.user}@${connection.host}`,
        kind: "sftp",
        panes: [],
        connection,
      },
      initialRemotePath,
      minimized: false,
      activity: { pending: false, needsAttention: false },
    }]);
  }

  function dismissBrowser(paneId: string, minimize: boolean) {
    openRequestIdRef.current += 1;
    setBrowsers((current) => minimize
      ? current.map((browser) => browser.paneId === paneId ? { ...browser, minimized: true } : browser)
      : current.filter((browser) => browser.paneId !== paneId));
    const focus = () => getPaneRenderer(paneId)?.focus();
    queueMicrotask(focus);
    window.requestAnimationFrame(focus);
  }

  function updateActivity(paneId: string, activity: SftpPopupActivity) {
    setBrowsers((current) => {
      const browser = current.find((entry) => entry.paneId === paneId);
      if (!browser || (browser.activity.pending === activity.pending && browser.activity.needsAttention === activity.needsAttention)) return current;
      return current.map((entry) => entry === browser ? { ...entry, activity } : entry);
    });
  }

  return <PopupContext.Provider value={{ browsers, openBrowser }}>
    {children}
    {browsers.filter((browser) => panes.some((pane) => pane.id === browser.paneId)).map((browser) => {
      const visible = isActive && !browser.minimized;
      return <DialogPortal key={browser.paneId}>
        <div
          className="dialog-backdrop connection-dialog-backdrop sftp-popup-dialog-backdrop"
          role="presentation"
          style={visible ? undefined : { display: "none" }}
          aria-hidden={!visible}
          inert={!visible}
        >
          <section aria-label={t("terminal.openSftp")} aria-modal="true" className="connection-dialog sftp-popup-dialog" role="dialog">
            <div className="sftp-popup-dialog-body">
              <Suspense fallback={null}>
                <SftpWorkspace
                  isActive={visible}
                  tab={browser.tab}
                  inline
                  onClose={() => dismissBrowser(browser.paneId, false)}
                  onMinimize={() => dismissBrowser(browser.paneId, true)}
                  onPopupActivityChange={(activity) => updateActivity(browser.paneId, activity)}
                  protocolSourceConnection={browser.tab.connection}
                  initialRemotePath={browser.initialRemotePath}
                />
              </Suspense>
            </div>
          </section>
        </div>
      </DialogPortal>;
    })}
  </PopupContext.Provider>;
}

export function SftpToolbarButton({ connection, paneId, resolveInitialRemotePath }: {
  connection: Connection;
  paneId: string;
  resolveInitialRemotePath: () => Promise<string | undefined>;
}) {
  const { t } = useTranslation();
  const popups = useContext(PopupContext);
  const browser = popups?.browsers.find((entry) => entry.paneId === paneId);
  const backgroundActivity = browser?.minimized
    ? browser.activity.needsAttention ? "attention" : browser.activity.pending ? "transferring" : undefined
    : undefined;
  const tooltip = backgroundActivity
    ? t(backgroundActivity === "attention" ? "sftp.backgroundAttention" : "sftp.backgroundTransferring", { host: connection.name })
    : t("terminal.sftp");
  return <button
    className="terminal-pane-action terminal-sftp-button"
    data-transfer-state={backgroundActivity}
    aria-label={backgroundActivity ? tooltip : t("terminal.openSftp")}
    data-tutorial-id="terminal.openSftp"
    onClick={() => void popups?.openBrowser(connection, paneId, resolveInitialRemotePath)}
    title={tooltip}
    type="button"
  >
    <Folder size={13} />
  </button>;
}
