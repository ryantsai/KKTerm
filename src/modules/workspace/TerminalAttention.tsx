import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import { RailTooltip } from "../../app/RailTooltip";
import { Bell } from "../../lib/reicon";
import { focusCurrentWebview, isTauriRuntime } from "../../lib/tauri";
import { DEFAULT_WORKSPACE_ID, useWorkspaceStore } from "../../store";
import { getPaneRenderer } from "./paneRegistry";
import {
  setTerminalWindowFocused,
  isTerminalWindowFocused,
  terminalAttentionTargets,
  useTerminalAttentionStore,
} from "./terminalAttentionState";

/** Remains mounted when the Status Bar is hidden, including during app switching. */
export function TerminalAttentionLifecycle() {
  useEffect(() => {
    let frame = 0;
    const acknowledgeFocused = () => {
      if (!isTerminalWindowFocused()) return;
      const { pending, clear } = useTerminalAttentionStore.getState();
      for (const paneId of Object.keys(pending)) {
        if (getPaneRenderer(paneId)?.hasFocus()) clear(paneId, pending[paneId]);
      }
    };
    const onFocus = () => {
      setTerminalWindowFocused(true);
      acknowledgeFocused();
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(acknowledgeFocused);
    };
    const onBlur = () => {
      setTerminalWindowFocused(false);
      cancelAnimationFrame(frame);
    };
    setTerminalWindowFocused(document.hasFocus());
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    const nativeListener = isTauriRuntime()
      ? listen<boolean>("kkterm://main-window-focus-changed", ({ payload }) => payload ? onFocus() : onBlur())
      : null;
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
      cancelAnimationFrame(frame);
      void nativeListener?.then((unlisten) => unlisten());
    };
  }, []);
  return null;
}

export function TerminalAttentionBadge({ paneId, tabId, connectionId, childConnectionId }: {
  paneId?: string;
  tabId?: string;
  connectionId?: string;
  childConnectionId?: string;
}) {
  const { t } = useTranslation();
  const pending = useTerminalAttentionStore((state) => state.pending);
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const active = useWorkspaceStore((state) => terminalAttentionTargets(state.tabs, pending).some(({ tab, pane }) => {
    if (paneId) return pane.id === paneId;
    if (tabId) return tab.id === tabId;
    if ((tab.workspaceId ?? DEFAULT_WORKSPACE_ID) !== activeWorkspaceId) return false;
    if (childConnectionId) return pane.childConnectionId === childConnectionId;
    return pane.connection?.id === connectionId || tab.childConnectionGroupParentId === connectionId;
  }));
  return active ? (
    <span className="terminal-attention-badge" role="img" aria-label={t("terminal.attentionPending")}>
      <Bell size={12} aria-hidden="true" />
    </span>
  ) : null;
}

export function TerminalAttentionStatusButtons({ onOpenWorkspace }: { onOpenWorkspace: () => void }) {
  const { t } = useTranslation();
  const pending = useTerminalAttentionStore((state) => state.pending);
  const tabs = useWorkspaceStore((state) => state.tabs);
  const workspaces = useWorkspaceStore((state) => state.workspaces);

  function focusTerminal(paneId: string) {
    const store = useWorkspaceStore.getState();
    const target = terminalAttentionTargets(store.tabs, useTerminalAttentionStore.getState().pending)
      .find(({ pane }) => pane.id === paneId);
    if (!target) return;
    // Reveal the exact existing Pane, even in another Workspace or a maximized split.
    useWorkspaceStore.setState({ tabs: store.tabs.map((tab) => tab.id === target.tab.id
      ? { ...tab, focusedPaneId: paneId, maximizedPaneId: undefined } : tab) });
    store.activateTab(target.tab.id);
    onOpenWorkspace();
    requestAnimationFrame(() => {
      const focus = () => {
        const current = useWorkspaceStore.getState();
        if (current.activeTabId !== target.tab.id
          || current.tabs.find((tab) => tab.id === target.tab.id)?.focusedPaneId !== paneId) return;
        const renderer = getPaneRenderer(paneId);
        renderer?.focus();
        if (isTerminalWindowFocused() && renderer?.hasFocus()) {
          useTerminalAttentionStore.getState().clear(paneId, pending[paneId]);
        }
      };
      focus();
      if (isTauriRuntime()) {
        void focusCurrentWebview().then(focus).catch(() => undefined);
      }
    });
  }

  return terminalAttentionTargets(tabs, pending).map(({ tab, pane }) => {
    const workspace = workspaces.find((entry) => entry.id === (tab.workspaceId ?? DEFAULT_WORKSPACE_ID));
    const label = t("terminal.attentionFocus", {
      name: pane.toolbarTitle || pane.title || pane.connection?.name,
      tab: tab.displayTitle || tab.title,
      workspace: workspace?.name ?? "",
    });
    return (
      <button key={pane.id} type="button" className="status-bar-action"
        aria-label={label} onClick={() => focusTerminal(pane.id)}
        data-tutorial-id="terminal.attention">
        <Bell size={14} aria-hidden="true" />
        <RailTooltip label={label} />
      </button>
    );
  });
}
