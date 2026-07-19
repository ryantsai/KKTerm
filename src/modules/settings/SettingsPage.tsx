import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import {
  Bot,
  Coffee,
  FolderOpen,
  Info,
  Keyboard,
  KeyRound,
  Gauge,
  LayoutDashboard,
  Monitor,
  Globe,
  Network,
  Palette,
  Save,
  Search,
  Server,
  Settings as SettingsIcon,
  Terminal,
  Waypoints,
  X,
  type LucideIcon,
} from "../../lib/reicon";
import { useTranslation } from "react-i18next";
import { LegacyDialogActions } from "../../app/ui/dialog";
import { ModuleIconTile, type ModuleKind } from "../../app/ModuleHeader";
import { InstallHelperModuleIcon, ScreenshotsModuleIcon } from "../../app/moduleIdentityIcons";
import { AI_PROVIDER_SECRET_OWNER_ID } from "../../lib/settings";
import { supportsInstallerHelper, supportsRdp } from "../../lib/platform";
import { AboutSettings } from "./AboutSettings";
import { AiSettings } from "./AiSettings";
import { AppearanceSettings } from "./AppearanceSettings";
import { DashboardSettings } from "./DashboardSettings";
import { DontSleepSettings } from "./DontSleepSettings";
import { CredentialsSettings } from "./CredentialsSettings";
import { GeneralSettings } from "./GeneralSettings";
import { FileExplorerSettings } from "./FileExplorerSettings";
import { InstallerSettings } from "./InstallerSettings";
import { ProxySettings } from "./ProxySettings";
import { RdpSettings } from "./RdpSettings";
import { ScreenshotsSettings } from "./ScreenshotsSettings";
import { ShortcutsSettings } from "./ShortcutsSettings";
import { SshSettings } from "./SshSettings";
import { TerminalSettings as TerminalSettingsPage } from "./TerminalSettings";
import { UrlSettings } from "./UrlSettings";
import { VncSettings } from "./VncSettings";
import { WorkspaceSettings } from "./WorkspaceSettings";
import {
  buildSettingsAssistantContext,
  type SettingsAssistantContext,
  type SettingsSectionId,
} from "./settingsAssistantContext";
import {
  SettingsSaveProvider,
  type SettingsSaveRegistration,
} from "./shared";
import {
  buildSettingsSearchResults,
  SETTINGS_SEARCH_KEYS,
  settingsSearchTextMatchScore,
} from "./settingsSearch";

export { AI_PROVIDER_SECRET_OWNER_ID };

const SETTINGS_SECTION_IDS: readonly SettingsSectionId[] = [
  "general-settings",
  "appearance-settings",
  "dashboard-settings",
  "workspace-settings",
  "file-explorer-settings",
  "installer-settings",
  "credentials-settings",
  "assistant-settings",
  "ssh-settings",
  "terminal-settings",
  "url-settings",
  "rdp-settings",
  "vnc-settings",
  "screenshots-settings",
  "dont-sleep-settings",
  "shortcuts-settings",
  "proxy-settings",
  "about-settings",
];

// Each section gets a colored icon chip, macOS System Settings style. Colors are
// the design language's vivid Apple-system palette; `requires` gates a section to
// platforms that support it.
type SettingsNavItem = {
  id: SettingsSectionId;
  Icon: LucideIcon;
  color: string;
  labelKey: string;
  module?: ModuleKind;
  requires?: "installer" | "rdp";
};

type PendingSettingsSearchTarget = {
  sectionId: SettingsSectionId;
  key?: string;
  label: string;
};

const SETTINGS_NAV: readonly SettingsNavItem[] = [
  { id: "general-settings", Icon: SettingsIcon, color: "#8e8e93", labelKey: "settings.sectionGeneral" },
  { id: "appearance-settings", Icon: Palette, color: "#ff2d55", labelKey: "settings.sectionAppearance" },
  { id: "workspace-settings", Icon: LayoutDashboard, color: "#5e5ce6", labelKey: "settings.sectionWorkspace", module: "workspace" },
  { id: "file-explorer-settings", Icon: FolderOpen, color: "#14b8a6", labelKey: "settings.fileExplorer" },
  { id: "dashboard-settings", Icon: Gauge, color: "#0a84ff", labelKey: "settings.sectionDashboard", module: "dashboard" },
  { id: "installer-settings", Icon: InstallHelperModuleIcon, color: "#ff9f0a", labelKey: "settings.sectionInstaller", module: "installer", requires: "installer" },
  { id: "credentials-settings", Icon: KeyRound, color: "#34c759", labelKey: "settings.sectionCredentials" },
  { id: "assistant-settings", Icon: Bot, color: "#bf5af2", labelKey: "settings.sectionAiAssistant" },
  { id: "ssh-settings", Icon: Server, color: "#30b0c7", labelKey: "settings.sectionSsh" },
  { id: "terminal-settings", Icon: Terminal, color: "#1c1c1e", labelKey: "settings.sectionTerminal" },
  { id: "url-settings", Icon: Globe, color: "#32ade6", labelKey: "settings.sectionUrl" },
  { id: "rdp-settings", Icon: Monitor, color: "#5856d6", labelKey: "settings.sectionRdp", requires: "rdp" },
  { id: "vnc-settings", Icon: Network, color: "#5ac8fa", labelKey: "settings.sectionVnc" },
  { id: "screenshots-settings", Icon: ScreenshotsModuleIcon, color: "#ff9500", labelKey: "settings.sectionScreenshots", module: "screenshots" },
  { id: "dont-sleep-settings", Icon: Coffee, color: "#ac8e68", labelKey: "settings.sectionDontSleep" },
  { id: "shortcuts-settings", Icon: Keyboard, color: "#ff6482", labelKey: "settings.sectionShortcuts" },
  { id: "proxy-settings", Icon: Waypoints, color: "#00c7be", labelKey: "settings.proxy" },
  { id: "about-settings", Icon: Info, color: "#64748b", labelKey: "settings.sectionAbout" },
];

export function SettingsPage({
  activeSectionId,
  onActiveSectionChange,
  onAssistantContextChange,
  onBack,
  onResetLayout,
}: {
  activeSectionId: SettingsSectionId;
  onActiveSectionChange: (sectionId: SettingsSectionId) => void;
  onAssistantContextChange: (context: SettingsAssistantContext) => void;
  onBack: () => void;
  onResetLayout: () => void;
}) {
  const { i18n, t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSearchResultKey, setSelectedSearchResultKey] = useState<string | null>(null);
  const [pendingSearchTarget, setPendingSearchTarget] =
    useState<PendingSettingsSearchTarget | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const settingsContentRef = useRef<HTMLElement>(null);
  const highlightedSearchTargetRef = useRef<HTMLElement | null>(null);
  const highlightTimeoutRef = useRef<number | null>(null);
  const [saveRegistrations, setSaveRegistrations] = useState<
    Partial<Record<SettingsSectionId, SettingsSaveRegistration>>
  >({});
  const [visitedSectionIds, setVisitedSectionIds] = useState<Set<SettingsSectionId>>(
    () => new Set([activeSectionId]),
  );
  const [unsavedQuitDialogOpen, setUnsavedQuitDialogOpen] = useState(false);
  const installerSupported = supportsInstallerHelper();
  const rdpSupported = supportsRdp();
  const availableSettingsNav = useMemo(() => SETTINGS_NAV.filter((item) =>
    item.requires === "installer"
      ? installerSupported
      : item.requires === "rdp"
        ? rdpSupported
        : true,
  ), [installerSupported, rdpSupported]);
  // `resolvedLanguage` can remain English after a locale bundle is loaded
  // dynamically. Search English as an alias, but render results in the user's
  // actual selected UI language.
  const activeLanguage = i18n.language || "en";
  const searchResults = useMemo(() => buildSettingsSearchResults({
    activeLanguage,
    query: searchQuery,
    sections: availableSettingsNav.map(({ id, labelKey }) => ({
      id,
      labelKey,
      searchKeys: SETTINGS_SEARCH_KEYS[id],
    })),
    translate: (key, language) => String(i18n.getFixedT(language)(key)),
  }), [activeLanguage, availableSettingsNav, i18n, searchQuery]);
  const assistantContext = useMemo(
    () => buildSettingsAssistantContext(activeSectionId, (key, fallback) => t(key, fallback)),
    [activeSectionId, t],
  );
  const registerSaveState = useCallback((sectionId: string, registration: SettingsSaveRegistration) => {
    setSaveRegistrations((current) => ({
      ...current,
      [sectionId as SettingsSectionId]: registration,
    }));
  }, []);
  const clearHighlightedSearchTarget = useCallback(() => {
    highlightedSearchTargetRef.current?.classList.remove("settings-search-target-highlight");
    highlightedSearchTargetRef.current = null;
    if (highlightTimeoutRef.current !== null) {
      window.clearTimeout(highlightTimeoutRef.current);
      highlightTimeoutRef.current = null;
    }
  }, []);
  const dirtyRegistrations = SETTINGS_SECTION_IDS
    .map((sectionId) => saveRegistrations[sectionId])
    .filter((registration): registration is SettingsSaveRegistration =>
      Boolean(registration?.hasChanges && registration.onSave),
    );
  const hasUnsavedChanges = dirtyRegistrations.length > 0;

  useEffect(() => {
    if (
      (activeSectionId === "installer-settings" && !installerSupported) ||
      (activeSectionId === "rdp-settings" && !rdpSupported)
    ) {
      onActiveSectionChange("general-settings");
    }
  }, [activeSectionId, installerSupported, onActiveSectionChange, rdpSupported]);

  useEffect(() => {
    onAssistantContextChange(assistantContext);
  }, [assistantContext, onAssistantContextChange]);

  useEffect(() => {
    setVisitedSectionIds((current) => {
      if (current.has(activeSectionId)) {
        return current;
      }
      const next = new Set(current);
      next.add(activeSectionId);
      return next;
    });
  }, [activeSectionId]);

  useEffect(() => {
    if (!pendingSearchTarget || pendingSearchTarget.sectionId !== activeSectionId) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const panel = settingsContentRef.current?.querySelector<HTMLElement>(
        `[data-settings-section-id="${pendingSearchTarget.sectionId}"]`,
      );
      if (!panel) {
        return;
      }
      const textTarget = findSettingsSearchTextTarget(panel, pendingSearchTarget.label);
      const highlightTarget = textTarget
        ? settingsSearchHighlightTarget(textTarget, panel)
        : panel.querySelector<HTMLElement>(".settings-card") ?? panel;

      clearHighlightedSearchTarget();
      highlightTarget.classList.add("settings-search-target-highlight");
      highlightedSearchTargetRef.current = highlightTarget;
      highlightTarget.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
        block: "center",
        inline: "nearest",
      });
      highlightTimeoutRef.current = window.setTimeout(
        clearHighlightedSearchTarget,
        2200,
      );
      setPendingSearchTarget(null);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [activeSectionId, clearHighlightedSearchTarget, pendingSearchTarget]);

  useEffect(() => clearHighlightedSearchTarget, [clearHighlightedSearchTarget]);

  async function handleSaveAllDirty({ quitAfter = false }: { quitAfter?: boolean } = {}) {
    const registrationsToSave = SETTINGS_SECTION_IDS
      .map((sectionId) => saveRegistrations[sectionId])
      .filter((registration): registration is SettingsSaveRegistration =>
        Boolean(registration?.hasChanges && registration.onSave),
      );

    for (const registration of registrationsToSave) {
      await registration.onSave?.();
    }

    if (quitAfter) {
      onBack();
    }
  }

  function requestCloseSettings() {
    if (hasUnsavedChanges) {
      setUnsavedQuitDialogOpen(true);
      return;
    }
    onBack();
  }

  function handleQuitWithoutSaving() {
    setUnsavedQuitDialogOpen(false);
    onBack();
  }

  function handleSearchResultClick(
    sectionId: SettingsSectionId,
    result: { key?: string; label: string },
  ) {
    setSelectedSearchResultKey(result.key ? `${sectionId}:${result.key}` : null);
    setPendingSearchTarget({ sectionId, ...result });
    onActiveSectionChange(sectionId);
  }

  function clearSearch() {
    setSearchQuery("");
    setSelectedSearchResultKey(null);
    searchInputRef.current?.focus();
  }

  function renderSettingsSection(sectionId: SettingsSectionId, children: ReactNode) {
    const shouldMount = visitedSectionIds.has(sectionId) || activeSectionId === sectionId;
    return (
      <SettingsSaveProvider
        key={sectionId}
        onRegister={registerSaveState}
        sectionId={sectionId}
      >
        <div
          className="settings-section-panel"
          data-settings-section-id={sectionId}
          hidden={activeSectionId !== sectionId}
        >
          {shouldMount ? children : null}
        </div>
      </SettingsSaveProvider>
    );
  }

  function handleBackdropClick(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) {
      requestCloseSettings();
    }
  }

  return (
    <div
      className="settings-backdrop"
      onClick={handleBackdropClick}
      role="presentation"
    >
      <main
        aria-label={t("settings.title")}
        aria-modal="true"
        className="settings-popup settings-page"
        role="dialog"
      >
        <header className="settings-page-header">
          <div>
            <p className="panel-label">{t("settings.title")}</p>
          </div>
          <div className="settings-page-actions">
            {hasUnsavedChanges ? (
              <>
                <span className="settings-unsaved-label">
                  {t("settings.changesNotSaved")}
                </span>
                <button
                  className="toolbar-button settings-page-save-button"
                  onClick={() => void handleSaveAllDirty()}
                  type="button"
                >
                  <Save size={15} />
                  {t("settings.save")}
                </button>
              </>
            ) : null}
          </div>
          <button
            aria-label={t("common.close")}
            className="connection-dialog-close"
            type="button"
            onClick={requestCloseSettings}
          >
            <X size={16} />
          </button>
        </header>

        <div className="settings-layout">
          <aside className="settings-nav" aria-label={t("settings.sectionsNav")}>
            <div className="settings-search-box">
              <Search aria-hidden="true" size={15} />
              <input
                aria-label={t("common.search")}
                onChange={(event) => {
                  setSearchQuery(event.target.value);
                  setSelectedSearchResultKey(null);
                }}
                placeholder={t("common.search")}
                ref={searchInputRef}
                type="search"
                value={searchQuery}
              />
              {searchQuery ? (
                <button
                  aria-label={t("common.clear")}
                  className="settings-search-clear"
                  onClick={clearSearch}
                  type="button"
                >
                  <X size={13} />
                </button>
              ) : null}
            </div>
            {searchQuery.trim() ? (
              <div className="settings-search-results" aria-live="polite">
                {searchResults.length > 0 ? searchResults.map((result) => {
                  const item = availableSettingsNav.find(({ id }) => id === result.id)!;
                  return (
                    <div className="settings-search-result-group" key={result.id}>
                      <button
                        className={settingsNavItemClass(result.id, activeSectionId)}
                        onClick={() => handleSearchResultClick(result.id, {
                          label: result.label,
                        })}
                        type="button"
                      >
                        <SettingsNavIcon item={item} />
                        <span>{result.label}</span>
                      </button>
                      {result.matches.map((match) => (
                        <button
                          className={`settings-search-hit${selectedSearchResultKey === `${result.id}:${match.key}` ? " active" : ""}`}
                          key={match.key}
                          onClick={() => handleSearchResultClick(result.id, match)}
                          type="button"
                        >
                          {match.label}
                        </button>
                      ))}
                    </div>
                  );
                }) : (
                  <p className="settings-search-empty">{t("settings.searchNoResults")}</p>
                )}
              </div>
            ) : availableSettingsNav.map((item) => (
              <button
                key={item.id}
                className={settingsNavItemClass(item.id, activeSectionId)}
                onClick={() => onActiveSectionChange(item.id)}
                type="button"
              >
                <SettingsNavIcon item={item} />
                <span>{t(item.labelKey)}</span>
              </button>
            ))}
          </aside>

          <section
            className="settings-content"
            aria-label={t("settings.settingsContent")}
            ref={settingsContentRef}
          >
            {renderSettingsSection("general-settings", <GeneralSettings />)}
            {renderSettingsSection(
              "appearance-settings",
              <AppearanceSettings onResetLayout={onResetLayout} />,
            )}
            {renderSettingsSection("dashboard-settings", <DashboardSettings />)}
            {renderSettingsSection("workspace-settings", <WorkspaceSettings />)}
            {renderSettingsSection("file-explorer-settings", <FileExplorerSettings />)}
            {installerSupported
              ? renderSettingsSection("installer-settings", <InstallerSettings />)
              : null}
            {renderSettingsSection("credentials-settings", <CredentialsSettings />)}
            {renderSettingsSection("assistant-settings", <AiSettings />)}
            {renderSettingsSection("ssh-settings", <SshSettings />)}
            {renderSettingsSection("terminal-settings", <TerminalSettingsPage />)}
            {renderSettingsSection("url-settings", <UrlSettings />)}
            {rdpSupported ? renderSettingsSection("rdp-settings", <RdpSettings />) : null}
            {renderSettingsSection("vnc-settings", <VncSettings />)}
            {renderSettingsSection("screenshots-settings", <ScreenshotsSettings />)}
            {renderSettingsSection("dont-sleep-settings", <DontSleepSettings />)}
            {renderSettingsSection("shortcuts-settings", <ShortcutsSettings />)}
            {renderSettingsSection("proxy-settings", <ProxySettings />)}
            {renderSettingsSection("about-settings", <AboutSettings />)}
          </section>
        </div>
      </main>
      {unsavedQuitDialogOpen ? (
        <div className="dialog-backdrop connection-dialog-backdrop" role="presentation">
          <section
            aria-labelledby="settings-unsaved-quit-title"
            aria-modal="true"
            className="connection-dialog settings-unsaved-dialog"
            role="dialog"
          >
            <header className="connection-dialog-header">
              <h2 id="settings-unsaved-quit-title">{t("settings.unsavedQuitTitle")}</h2>
            </header>
            <div className="connection-dialog-body">
              <p>{t("settings.unsavedQuitBody")}</p>
            </div>
            <LegacyDialogActions
              as="footer"
              extraLeft={<button
                className="secondary-button danger-button"
                onClick={handleQuitWithoutSaving}
                type="button"
              >
                {t("settings.quitWithoutSaving")}
              </button>}
              primary={<button
                className="primary-button"
                onClick={() => void handleSaveAllDirty({ quitAfter: true })}
                type="button"
              >
                <Save size={15} />
                {t("settings.saveAndQuit")}
              </button>}
              cancel={<button
                className="secondary-button"
                onClick={() => setUnsavedQuitDialogOpen(false)}
                type="button"
              >
                {t("common.cancel")}
              </button>}
            />
          </section>
        </div>
      ) : null}
    </div>
  );
}

function settingsNavItemClass(sectionId: SettingsSectionId, activeSectionId: SettingsSectionId) {
  return `settings-nav-item${sectionId === activeSectionId ? " active" : ""}`;
}

function SettingsNavIcon({ item }: { item: SettingsNavItem }) {
  const { Icon, color, module } = item;
  return module ? (
    <ModuleIconTile compact module={module}>
      <Icon size={14} />
    </ModuleIconTile>
  ) : (
    <span className="settings-nav-icon" style={{ background: color }}>
      <Icon size={14} />
    </span>
  );
}

function findSettingsSearchTextTarget(root: HTMLElement, label: string) {
  const candidates = root.querySelectorAll<HTMLElement>(
    "legend, label, button, option, h2, h3, strong, small, p, [aria-label]",
  );
  let bestTarget: HTMLElement | null = null;
  let bestScore = 0;
  for (const candidate of candidates) {
    const values = [candidate.textContent ?? "", candidate.getAttribute("aria-label") ?? ""];
    const score = Math.max(...values.map((value) =>
      settingsSearchTextMatchScore(label, value),
    ));
    if (score > bestScore) {
      bestTarget = candidate;
      bestScore = score;
    }
    if (bestScore === 3) {
      break;
    }
  }
  return bestTarget;
}

function settingsSearchHighlightTarget(target: HTMLElement, root: HTMLElement) {
  const container = target.closest<HTMLElement>([
    ".settings-toggle-row",
    ".settings-summary-item",
    ".settings-list-row",
    ".settings-reset-layout",
    ".settings-data-actions",
    ".shortcut-row",
    ".theme-card",
    ".mcp-server-row",
    ".assistant-skill-row",
    "fieldset.settings-subsection",
    "label",
    "button",
    ".settings-card",
  ].join(", "));
  return container && root.contains(container) ? container : target;
}
