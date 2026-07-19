import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AssistantPanel } from "./ai/AssistantPanel";
import type { AssistantPageContext } from "./ai/AssistantPanel";
import { ActivityRail } from "./app/ActivityRail";
import type { ActivePage } from "./app/ActivityRail";
import {
  baseModulePageForPersistence,
  loadStoredActivePage,
  persistActivePage,
  shouldExpandConnectionPanelOnLaunch,
  type BaseModulePage,
} from "./app/appNavigationPersistence";
import { AppUpdatePrompt } from "./app/AppUpdatePrompt";
import { TitleBar } from "./app/TitleBar";
import {
  findTutorialTargetElement,
  TutorialOverlay,
  type TutorialHighlightRequest,
} from "./app/TutorialOverlay";
import {
  useAppliedColorScheme,
  useAppShellAppearance,
  useDebugFrontendHeartbeat,
  useFrontendLaunchTimestamp,
  useGlobalContextMenuSuppression,
  useHostUsagePolling,
} from "./app/appShellEffects";
import {
  PanelResizeHandle,
  useWorkspaceChromeLayout,
} from "./app/workspaceChromeLayout";
import { ConnectionSidebar } from "./modules/workspace/connections/ConnectionSidebar";
import { useDashboardStore } from "./modules/dashboard/state/dashboardStore";
import { useDashboardBackendInvalidation } from "./modules/dashboard/state/invalidation";
import { useItOpsBackendInvalidation } from "./modules/itops/invalidation";
import { useScreenshotCaptureBridge } from "./modules/screenshots/captureBridge";
import { useItOpsStore } from "./modules/itops/state";
import {
  loadSiteTreeCollapsed,
  saveSiteTreeCollapsed,
} from "./modules/itops/siteTreeState";
import {
  tutorialSurfaceKindForTarget,
  type TutorialSurfaceKind,
} from "./app/tutorialNavigationModel";
import { ariaHidden } from "./lib/aria";
import { currentPlatform, supportsInstallerHelper } from "./lib/platform";
import { useBootstrapSettings } from "./lib/settings";
import { CREDENTIAL_UNLOCK_REQUIRED_EVENT, invokeCommand } from "./lib/tauri";
import type { CredentialUnlockRequestDetail } from "./lib/credentialUnlock";
import { EncryptedSecretStoreDialog } from "./modules/settings/EncryptedSecretStoreDialog";
import type { SettingsAssistantContext } from "./modules/settings/settingsAssistantContext";
import type { SettingsSectionId } from "./modules/settings/settingsAssistantContext";
import { useWorkspaceStore } from "./store";
import type { WorkspaceTab } from "./types";
import { StatusBar } from "./modules/workspace/StatusBar";
import { TabStrip, WorkspaceCanvas } from "./modules/workspace/WorkspaceCanvas";
import "@xterm/xterm/css/xterm.css";
import "./App.css";

const DashboardPage = lazy(() =>
  import("./modules/dashboard/DashboardPage").then(({ DashboardPage }) => ({
    default: DashboardPage,
  })),
);
const InstallerPage = lazy(() =>
  import("./modules/installer/InstallerPage").then(({ InstallerPage }) => ({
    default: InstallerPage,
  })),
);
const ItOpsPage = lazy(() =>
  import("./modules/itops/ItOpsPage").then(({ ItOpsPage }) => ({
    default: ItOpsPage,
  })),
);
const ScreenshotsPage = lazy(() =>
  import("./modules/screenshots/ScreenshotsPage").then(({ ScreenshotsPage }) => ({
    default: ScreenshotsPage,
  })),
);
const SettingsPage = lazy(() =>
  import("./modules/settings/SettingsPage").then(({ SettingsPage }) => ({
    default: SettingsPage,
  })),
);

function App() {
  const { t } = useTranslation();
  const launchPageRef = useRef<BaseModulePage | null>(null);
  if (launchPageRef.current === null) {
    const storedPage = loadStoredActivePage();
    launchPageRef.current =
      storedPage === "installer" && !supportsInstallerHelper() ? "workspace" : storedPage;
  }
  const [activePage, setActivePage] = useState<ActivePage>(launchPageRef.current);
  const [dashboardMounted, setDashboardMounted] = useState(
    () => activePage === "dashboard",
  );
  const [installerMounted, setInstallerMounted] = useState(
    () => activePage === "installer",
  );
  const [itopsMounted, setItopsMounted] = useState(() => activePage === "itops");
  const [screenshotsMounted, setScreenshotsMounted] = useState(
    () => activePage === "screenshots",
  );
  const [activeSettingsSectionId, setActiveSettingsSectionId] =
    useState<SettingsSectionId>("general-settings");
  const previousBasePageRef = useRef<BaseModulePage>(launchPageRef.current);
  const [credentialUnlockDialogOpen, setCredentialUnlockDialogOpen] = useState(false);
  const [credentialUnlockStoreExists, setCredentialUnlockStoreExists] =
    useState<boolean | undefined>(undefined);
  const [credentialUnlockBusy, setCredentialUnlockBusy] = useState(false);
  const [credentialUnlockError, setCredentialUnlockError] = useState<string | null>(null);
  const credentialUnlockCompletionsRef = useRef<Array<(unlocked: boolean) => void>>([]);

  function isOverlayPage(page: ActivePage): page is "settings" {
    return page === "settings";
  }

  function navigateToPage(page: ActivePage) {
    if (page === "installer" && !supportsInstallerHelper()) {
      page = "workspace";
    }
    const currentBasePage: BaseModulePage = isOverlayPage(activePage)
      ? previousBasePageRef.current
      : activePage;
    const basePage = baseModulePageForPersistence(
      page,
      currentBasePage,
    );
    if (page === "dashboard") {
      setDashboardMounted(true);
    }
    if (page === "installer") {
      setInstallerMounted(true);
    }
    if (page === "itops") {
      setItopsMounted(true);
    }
    if (page === "screenshots") {
      setScreenshotsMounted(true);
    }
    if (isOverlayPage(page) && !isOverlayPage(activePage)) {
      previousBasePageRef.current = activePage;
    }
    persistActivePage(basePage);
    setActivePage(page);
  }

  function openAssistantPanel() {
    expandAiPanel();
  }

  function openDashboardView(viewId: string) {
    useDashboardStore.getState().setActiveView(viewId);
    navigateToPage("dashboard");
  }

  function openDashboardPage(viewId?: string) {
    if (viewId) {
      useDashboardStore.getState().setActiveView(viewId);
    }
    navigateToPage("dashboard");
  }

  function navigateForTutorial(request: TutorialHighlightRequest) {
    const navigation = request.navigation;
    if (!navigation) {
      return;
    }
    if (navigation.settingsSectionId) {
      setActiveSettingsSectionId(navigation.settingsSectionId);
    }
    if (navigation.page === "itops" && (navigation.itopsSiteId || navigation.itopsDestination)) {
      useItOpsStore.getState().requestNavigation({
        siteId: navigation.itopsSiteId,
        destination: navigation.itopsDestination,
      });
    }
    navigateToPage(navigation.page);
  }

  // A tutorial target inside a Tab surface (terminal/SFTP/webview/remote desktop)
  // is only in the DOM when a Tab of that kind is active. Activate a matching
  // open Tab if needed; return false when no such Tab is open so the assistant
  // can say so instead of highlighting a control that isn't there.
  function activateWorkspaceTabForSurface(surfaceKind: TutorialSurfaceKind) {
    const store = useWorkspaceStore.getState();
    const matchesSurface = (kind: WorkspaceTab["kind"]) =>
      surfaceKind === "sftp" ? kind === "sftp" || kind === "ftp" : kind === surfaceKind;
    const active = store.tabs.find((tab) => tab.id === store.activeTabId);
    if (active && matchesSurface(active.kind)) {
      return true;
    }
    const match = store.tabs.find((tab) => matchesSurface(tab.kind));
    if (!match) {
      return false;
    }
    store.activateTab(match.id);
    return true;
  }

  const [dashboardAssistantContext, setDashboardAssistantContext] =
    useState<AssistantPageContext>();
  const [itOpsAssistantContext, setItOpsAssistantContext] =
    useState<AssistantPageContext>();
  const [itOpsSiteTreeCollapsed, setItOpsSiteTreeCollapsed] =
    useState(loadSiteTreeCollapsed);
  const [settingsAssistantContext, setSettingsAssistantContext] =
    useState<SettingsAssistantContext>();
  const [tutorialHighlightRequest, setTutorialHighlightRequest] =
    useState<TutorialHighlightRequest>();
  const appearanceSettings = useWorkspaceStore((state) => state.appearanceSettings);
  const appliedColorScheme = useAppliedColorScheme(appearanceSettings.colorScheme);
  const hideTopTabButtons = useWorkspaceStore((state) => state.generalSettings.hideTopTabButtons);
  const statusBarEnabled = useWorkspaceStore((state) => state.generalSettings.statusBarEnabled);
  const showItOps = useWorkspaceStore((state) => state.generalSettings.showItOps);
  const showScreenshotsOnRail = useWorkspaceStore(
    (state) => state.generalSettings.showScreenshotsOnRail,
  );
  const resetAllLayouts = useWorkspaceStore((state) => state.resetAllLayouts);
  const appShellRef = useRef<HTMLDivElement | null>(null);
  const {
    aiPanelLayout,
    aiPanelAnimating,
    connectionPanelLayout,
    connectionPanelAnimating,
    expandConnectionPanel,
    expandAiPanel,
    handleAiPanelResize,
    handleConnectionPanelResize,
    panelAnimating,
    resetWorkspaceChromeLayout,
    toggleAiPanel,
    toggleConnectionPanel,
  } = useWorkspaceChromeLayout(
    resetAllLayouts,
    appShellRef,
    shouldExpandConnectionPanelOnLaunch(launchPageRef.current),
  );

  const { generalSettingsReady } = useBootstrapSettings();
  useDashboardBackendInvalidation();
  useItOpsBackendInvalidation();
  useScreenshotCaptureBridge();
  useDebugFrontendHeartbeat();
  useFrontendLaunchTimestamp();
  useHostUsagePolling();
  useGlobalContextMenuSuppression();
  useAppShellAppearance({
    aiPanelLayout,
    aiPanelAnimating,
    appliedColorScheme,
    appShellRef,
    appearanceSettings,
    connectionPanelLayout,
    connectionPanelAnimating,
  });

  useEffect(() => {
    const credentialUnlockCompletions = credentialUnlockCompletionsRef.current;

    function openCredentialUnlockPrompt(event: Event) {
      const completion = (event as CustomEvent<CredentialUnlockRequestDetail>).detail?.complete;
      if (completion) {
        credentialUnlockCompletions.push(completion);
      }
      setCredentialUnlockError(null);
      setCredentialUnlockDialogOpen(true);
      void invokeCommand("credential_secret_store_status", undefined)
        .then((status) => setCredentialUnlockStoreExists(status.encryptedStoreExists))
        .catch(() => setCredentialUnlockStoreExists(undefined));
    }

    window.addEventListener(CREDENTIAL_UNLOCK_REQUIRED_EVENT, openCredentialUnlockPrompt);
    return () => {
      window.removeEventListener(CREDENTIAL_UNLOCK_REQUIRED_EVENT, openCredentialUnlockPrompt);
      for (const complete of credentialUnlockCompletions.splice(0)) {
        complete(false);
      }
    };
  }, []);

  function completeCredentialUnlockRequests(unlocked: boolean) {
    for (const complete of credentialUnlockCompletionsRef.current.splice(0)) {
      complete(unlocked);
    }
  }

  async function configureCredentialUnlockStore(request: {
    password: string;
    createIfMissing: boolean;
    resetExisting?: boolean;
  }) {
    try {
      setCredentialUnlockBusy(true);
      setCredentialUnlockError(null);
      await invokeCommand("configure_encrypted_file_secret_store", { request });
      setCredentialUnlockDialogOpen(false);
      setCredentialUnlockStoreExists(true);
      window.dispatchEvent(new CustomEvent("kkterm:credential-store-status-changed"));
      completeCredentialUnlockRequests(true);
    } catch (error) {
      setCredentialUnlockError(error instanceof Error ? error.message : String(error));
    } finally {
      setCredentialUnlockBusy(false);
    }
  }

  function assistantPageContext() {
    if (activePage === "dashboard") {
      return dashboardAssistantContext;
    }
    if (activePage === "settings") {
      return settingsAssistantContext;
    }
    if (activePage === "itops") {
      return itOpsAssistantContext;
    }
    return undefined;
  }

  function shouldRevealConnectionPanelForTutorial(targetId: string) {
    return targetId.trim().startsWith("connections.");
  }

  function shouldRevealItOpsSiteTreeForTutorial(targetId: string) {
    return targetId.trim() === "itops.sitesTree";
  }

  async function handleTutorialRequest(request: TutorialHighlightRequest) {
    navigateForTutorial(request);
    if (shouldRevealConnectionPanelForTutorial(request.targetId)) {
      expandConnectionPanel();
    }
    if (shouldRevealItOpsSiteTreeForTutorial(request.targetId)) {
      setItOpsSiteTreeCollapsed(false);
    }
    const surfaceKind = tutorialSurfaceKindForTarget(request.targetId);
    if (surfaceKind && !activateWorkspaceTabForSurface(surfaceKind)) {
      return { ok: false, error: t("ai.tutorialSurfaceNotOpen") };
    }
    const target = await waitForTutorialTarget(request.targetId);
    if (!target) {
      return { ok: false, error: t("ai.tutorialTargetNotFound") };
    }
    setTutorialHighlightRequest(request);
    return { ok: true };
  }

  // The IT Ops Module shows by default, but users can hide it. If it gets
  // turned off while it is the active (or last-active) page, fall back to the
  // Workspace so the user is never stranded on a Module they can't navigate to.
  useEffect(() => {
    if (showItOps) {
      return;
    }
    if (previousBasePageRef.current === "itops") {
      previousBasePageRef.current = "workspace";
    }
    if (activePage === "itops") {
      persistActivePage("workspace");
      setActivePage("workspace");
    }
  }, [showItOps, activePage]);

  // Same stranding guard as IT Ops: hiding the Screenshots Module while it is
  // the active (or last-active) page falls back to the Workspace.
  useEffect(() => {
    if (showScreenshotsOnRail) {
      return;
    }
    if (previousBasePageRef.current === "screenshots") {
      previousBasePageRef.current = "workspace";
    }
    if (activePage === "screenshots") {
      persistActivePage("workspace");
      setActivePage("workspace");
    }
  }, [showScreenshotsOnRail, activePage]);

  useEffect(() => {
    saveSiteTreeCollapsed(itOpsSiteTreeCollapsed);
  }, [itOpsSiteTreeCollapsed]);

  const visibleBasePage = isOverlayPage(activePage)
    ? previousBasePageRef.current
    : activePage;

  return (
    <div
      className="app-root"
      data-platform={currentPlatform()}
      data-color-scheme={appliedColorScheme}
      data-selected-color-scheme={appearanceSettings.colorScheme}
    >
      <TitleBar
        activePage={activePage}
        aiPanelCollapsed={aiPanelLayout.collapsed}
        connectionPanelCollapsed={connectionPanelLayout.collapsed}
        itOpsSiteTreeCollapsed={itOpsSiteTreeCollapsed}
        onToggleAiPanel={toggleAiPanel}
        onToggleConnectionPanel={toggleConnectionPanel}
        onToggleItOpsSiteTree={() =>
          setItOpsSiteTreeCollapsed((collapsed) => !collapsed)
        }
      />
      <div
        ref={appShellRef}
        className={`app-shell ${panelAnimating ? "panel-animating" : ""} ${
          activePage === "settings" ? "settings-mode" : ""
        } ${
          connectionPanelLayout.collapsed ? "connections-collapsed" : ""
        } ${aiPanelLayout.collapsed ? "ai-assist-collapsed" : ""} ${
          statusBarEnabled ? "" : "status-bar-hidden"
        }`}
      >
      <ActivityRail
        key="activity-rail"
        activePage={activePage}
        connectionsCollapsed={connectionPanelLayout.collapsed}
        onConnectionsToggle={toggleConnectionPanel}
        onNavigate={navigateToPage}
      />
      <div key="workspace-page" className="workspace-page" {...ariaHidden(visibleBasePage !== "workspace")}>
        <div className="connection-panel-slot">
          <ConnectionSidebar
            onExternalOpenConnection={() => navigateToPage("workspace")}
            onRevealPanel={expandConnectionPanel}
            onTogglePanel={toggleConnectionPanel}
          />
        </div>
        {connectionPanelLayout.collapsed ? (
          <div className="connection-collapsed-separator" aria-hidden="true" />
        ) : (
          <PanelResizeHandle
            ariaLabel={t("app.resizeConnections")}
            dataTutorialId="app.connectionsResize"
            side="left"
            onPointerDown={handleConnectionPanelResize}
          />
        )}
        <main className={`workspace${hideTopTabButtons ? " workspace-tabs-hidden" : ""}`}>
          {hideTopTabButtons ? null : <TabStrip />}
          <WorkspaceCanvas
            onOpenAssistant={openAssistantPanel}
            workspaceActive={visibleBasePage === "workspace"}
          />
        </main>
      </div>
      <PanelResizeHandle
        key="ai-resize-handle"
        ariaLabel={t("app.resizeAiAssistant")}
        dataTutorialId="app.aiAssistantResize"
        side="right"
        collapsed={aiPanelLayout.collapsed}
        collapsedLabel={t("app.aiAssistant")}
        showCollapsedTab={false}
        onClick={aiPanelLayout.collapsed ? expandAiPanel : undefined}
        onPointerDown={handleAiPanelResize}
      />
      <div className="assistant-panel-slot">
        <AssistantPanel
          key="assistant-panel"
          collapsed={aiPanelLayout.collapsed}
          onOpenDashboard={openDashboardPage}
          onOpenSettings={() => navigateToPage("settings")}
          onOpenWorkspace={() => navigateToPage("workspace")}
          onTogglePanel={toggleAiPanel}
          onTutorialRequest={handleTutorialRequest}
          pageContext={assistantPageContext()}
        />
      </div>
      <Suspense fallback={null}>
      {activePage === "settings" ? (
        <SettingsPage
          key="settings-page"
          activeSectionId={activeSettingsSectionId}
          onBack={() => setActivePage(previousBasePageRef.current)}
          onActiveSectionChange={setActiveSettingsSectionId}
          onAssistantContextChange={setSettingsAssistantContext}
          onResetLayout={resetWorkspaceChromeLayout}
        />
      ) : null}
      {dashboardMounted ? (
        <DashboardPage
          key="dashboard-page"
          dashboardActive={visibleBasePage === "dashboard"}
          onAssistantContextChange={setDashboardAssistantContext}
        />
      ) : null}
      {installerMounted ? (
        <InstallerPage key="installer-page" active={visibleBasePage === "installer"} />
      ) : null}
      {itopsMounted ? (
        <ItOpsPage
          key="itops-page"
          active={visibleBasePage === "itops"}
          siteTreeCollapsed={itOpsSiteTreeCollapsed}
          onAssistantContextChange={setItOpsAssistantContext}
          onShowWorkspace={() => navigateToPage("workspace")}
        />
      ) : null}
      {screenshotsMounted ? (
        <ScreenshotsPage
          key="screenshots-page"
          active={visibleBasePage === "screenshots"}
        />
      ) : null}
      </Suspense>
      <TutorialOverlay
        key="tutorial-overlay"
        onDismiss={() => setTutorialHighlightRequest(undefined)}
        request={tutorialHighlightRequest}
      />
      {credentialUnlockDialogOpen ? (
        <EncryptedSecretStoreDialog
          busy={credentialUnlockBusy}
          encryptedStoreExists={credentialUnlockStoreExists}
          error={credentialUnlockError}
          initialMode={credentialUnlockStoreExists === false ? "create" : "unlock"}
          launchPrompt={false}
          platform={currentPlatform()}
          onCancel={() => {
            setCredentialUnlockDialogOpen(false);
            setCredentialUnlockError(null);
            completeCredentialUnlockRequests(false);
          }}
          onSubmit={configureCredentialUnlockStore}
        />
      ) : null}
      {statusBarEnabled ? (
        <StatusBar
          key="status-bar"
          onOpenAssistant={openAssistantPanel}
          onOpenDashboardView={openDashboardView}
          installerActive={visibleBasePage === "installer"}
        />
      ) : null}
      <AppUpdatePrompt key="app-update-prompt" settingsReady={generalSettingsReady} />
      </div>
    </div>
  );
}

function waitForTutorialTarget(targetId: string) {
  return new Promise<HTMLElement | undefined>((resolve) => {
    let attempts = 0;

    function check() {
      const target = findTutorialTargetElement(targetId);
      if (target || attempts >= 12) {
        resolve(target);
        return;
      }
      attempts += 1;
      window.requestAnimationFrame(check);
    }

    check();
  });
}

export default App;
