import { Bot, ChevronDown, PanelLeft } from "../lib/reicon";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ActivePage } from "./ActivityRail";
import {
  closeMainWindow,
  getAppVersion,
  invokeCommand,
  isMainWindowMaximized,
  listenMainWindowResized,
  minimizeMainWindow,
  toggleMaximizeMainWindow,
} from "../lib/tauri";
import { isWindowsPlatform, usesNativeWindowControls } from "../lib/platform";
import appIconUrl from "../../src-tauri/icons/32x32.png";

const ICON_SIZE = 10;

function MinimizeIcon() {
  return (
    <svg
      width={ICON_SIZE}
      height={ICON_SIZE}
      viewBox="0 0 10 10"
      aria-hidden="true"
    >
      <rect x="0" y="4.5" width="10" height="1" fill="currentColor" />
    </svg>
  );
}

function MaximizeIcon() {
  return (
    <svg
      width={ICON_SIZE}
      height={ICON_SIZE}
      viewBox="0 0 10 10"
      aria-hidden="true"
    >
      <rect
        x="0.5"
        y="0.5"
        width="9"
        height="9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
      />
    </svg>
  );
}

function RestoreIcon() {
  return (
    <svg
      width={ICON_SIZE}
      height={ICON_SIZE}
      viewBox="0 0 10 10"
      aria-hidden="true"
    >
      <rect
        x="0.5"
        y="2.5"
        width="7"
        height="7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
      />
      <path
        d="M 2.5 2.5 L 2.5 0.5 L 9.5 0.5 L 9.5 7.5 L 7.5 7.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      width={ICON_SIZE}
      height={ICON_SIZE}
      viewBox="0 0 10 10"
      aria-hidden="true"
    >
      <line
        x1="1"
        y1="1"
        x2="9"
        y2="9"
        stroke="currentColor"
        strokeWidth="1"
      />
      <line
        x1="9"
        y1="1"
        x2="1"
        y2="9"
        stroke="currentColor"
        strokeWidth="1"
      />
    </svg>
  );
}

export function TitleBar({
  activePage,
  aiPanelCollapsed,
  connectionPanelCollapsed,
  itOpsSiteTreeCollapsed,
  showWorkspaceOpenMenu,
  onToggleAiPanel,
  onToggleConnectionPanel,
  onToggleItOpsSiteTree,
}: {
  activePage: ActivePage;
  aiPanelCollapsed: boolean;
  connectionPanelCollapsed: boolean;
  itOpsSiteTreeCollapsed: boolean;
  showWorkspaceOpenMenu: boolean;
  onToggleAiPanel: () => void;
  onToggleConnectionPanel: () => void;
  onToggleItOpsSiteTree: () => void;
}) {
  const { t } = useTranslation();
  const nativeWindowControls = usesNativeWindowControls();
  const [maximized, setMaximized] = useState(false);
  const [version, setVersion] = useState<string>("");

  useEffect(() => {
    void isMainWindowMaximized().then(setMaximized);
    void getAppVersion().then(setVersion);
    const unlistenPromise = listenMainWindowResized(() => {
      void isMainWindowMaximized().then(setMaximized);
    });
    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  function handleMinimize() {
    void minimizeMainWindow();
  }

  function handleToggleMaximize() {
    void toggleMaximizeMainWindow();
  }

  function handleClose() {
    void closeMainWindow();
  }

  const titleText = version ? `KKTerm v${version}` : "KKTerm";

  return (
    <div
      className={`app-titlebar${
        nativeWindowControls ? " app-titlebar-native-controls" : ""
      }`}
      data-tauri-drag-region
    >
      <div className="app-titlebar-label" data-tauri-drag-region>
        <img
          className="app-titlebar-icon"
          src={appIconUrl}
          alt=""
          aria-hidden="true"
          draggable={false}
          data-tauri-drag-region
        />
        <span className="app-titlebar-title" data-tauri-drag-region>
          {titleText}
        </span>
        {activePage === "workspace" && showWorkspaceOpenMenu && isWindowsPlatform() ? (
          <button
            aria-label={t("app.openFile")}
            className="app-titlebar-open-path-button"
            onClick={() => void invokeCommand("open_launch_file_picker", undefined)}
            title={t("app.openFile")}
            type="button"
          >
            <ChevronDown size={13} strokeWidth={1.8} />
          </button>
        ) : null}
      </div>
      <div className="app-titlebar-controls">
        {activePage === "workspace" ? (
          <button
            type="button"
            className={`app-titlebar-button app-titlebar-panel-button ${
              connectionPanelCollapsed ? "" : "active"
            }`}
            onClick={onToggleConnectionPanel}
            aria-label={t("app.connections")}
            aria-pressed={!connectionPanelCollapsed}
            title={t("app.connections")}
          >
            <PanelLeft size={15} strokeWidth={1.8} />
          </button>
        ) : null}
        {activePage === "itops" ? (
          <button
            type="button"
            className={`app-titlebar-button app-titlebar-panel-button ${
              itOpsSiteTreeCollapsed ? "" : "active"
            }`}
            onClick={onToggleItOpsSiteTree}
            aria-label={t("itops.sites.heading")}
            aria-pressed={!itOpsSiteTreeCollapsed}
            title={t("itops.sites.heading")}
          >
            <PanelLeft size={15} strokeWidth={1.8} />
          </button>
        ) : null}
        <button
          type="button"
          className={`app-titlebar-button app-titlebar-panel-button ${
            aiPanelCollapsed ? "" : "active"
          }`}
          onClick={onToggleAiPanel}
          aria-label={t("app.aiAssistant")}
          aria-pressed={!aiPanelCollapsed}
          title={t("app.aiAssistant")}
        >
          <Bot size={15} strokeWidth={1.8} />
        </button>
        {nativeWindowControls ? null : (
          <>
            <button
              type="button"
              className="app-titlebar-button"
              onClick={handleMinimize}
              aria-label={t("app.titlebar.minimize")}
              title={t("app.titlebar.minimize")}
            >
              <MinimizeIcon />
            </button>
            <button
              type="button"
              className="app-titlebar-button"
              onClick={handleToggleMaximize}
              aria-label={t(
                maximized ? "app.titlebar.restore" : "app.titlebar.maximize",
              )}
              title={t(
                maximized ? "app.titlebar.restore" : "app.titlebar.maximize",
              )}
            >
              {maximized ? <RestoreIcon /> : <MaximizeIcon />}
            </button>
            <button
              type="button"
              className="app-titlebar-button app-titlebar-close"
              onClick={handleClose}
              aria-label={t("app.titlebar.close")}
              title={t("app.titlebar.close")}
            >
              <CloseIcon />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
