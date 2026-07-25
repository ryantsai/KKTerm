import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Check, ChevronDown, FolderOpen, Link, Plus, RefreshCw, Terminal, Trash2 } from "../../lib/reicon";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { invokeCommand, isTauriRuntime } from "../../lib/tauri";
import { normalizeAvailableTerminal, terminalCustomFontOptions } from "../../lib/customFonts";
import {
  isSystemFontAccessSupported,
  systemFontFamilies,
  systemFontsExcluding,
} from "../../lib/systemFonts";
import {
  getRecommendedFontOptions,
  loadSharedCustomFonts,
  refreshSharedFontCatalog,
  useSystemFontCatalog,
} from "../../lib/fontCatalog";
import { defaultTerminalSettings } from "../../app-defaults";
import { currentPlatform } from "../../lib/platform";
import { useWorkspaceStore } from "../../store";
import {
  DEFAULT_TERMINAL_COLOR_SCHEME_ID,
  resolveTerminalColorScheme,
  TERMINAL_COLOR_SCHEMES,
} from "../workspace/connections/terminal/colorSchemes";
import { QuickCommandManagerDialog } from "../workspace/connections/terminal/QuickCommandBar";
import { QuickCommandBundleList } from "../workspace/connections/terminal/QuickCommandBundles";
import type {
  QuickCommandBundle,
  TerminalCursorStyle,
  TerminalSettings as TerminalSettingsType,
} from "../../types";
import { localShellOptionsForPlatform, resolveAvailableLocalShell } from "../workspace/connections/utils";
import { customShellPresetsForPlatform, findCustomShellPreset } from "./customShellPresets";
import { SettingsSectionHeader, useSettingsSaveRegistration } from "./shared";
import { ToggleSwitch } from "./ToggleSwitch";

function IncludesSshBadge({ label }: { label: string }) {
  return <span className="terminal-ssh-scope-badge">{label}</span>;
}

/** CSS font stack for a font family picked from the custom or system font list. */
function terminalFontCssValue(family: string) {
  return `"${family}", monospace`;
}

function normalizeTerminalSettingsDraft(settings: TerminalSettingsType, t: TFunction): TerminalSettingsType {
  if (!settings.fontFamily.trim()) {
    throw new Error(t("settings.fontFamilyRequired"));
  }
  if (!settings.defaultShell.trim()) {
    throw new Error(t("settings.defaultShellRequired"));
  }
  if (!Number.isFinite(settings.fontSize) || settings.fontSize < 8 || settings.fontSize > 32) {
    throw new Error(t("settings.fontSizeRange"));
  }
  if (!Number.isFinite(settings.lineHeight) || settings.lineHeight < 1 || settings.lineHeight > 2) {
    throw new Error(t("settings.lineHeightRange"));
  }
  if (
    !Number.isFinite(settings.scrollbackLines) ||
    settings.scrollbackLines < 100 ||
    settings.scrollbackLines > 100_000
  ) {
    throw new Error(t("settings.scrollbackRange"));
  }
  if (
    !Number.isFinite(settings.defaultTransparency) ||
    settings.defaultTransparency < 0 ||
    settings.defaultTransparency > 100
  ) {
    throw new Error(t("settings.defaultTransparencyRange"));
  }

  const customShells = (settings.customShells ?? [])
    .map((shell) => ({
      id: shell.id.trim() || makeCustomShellId(),
      name: shell.name.trim(),
      commandLine: shell.commandLine.trim(),
    }))
    .filter((shell) => shell.name && shell.commandLine);

  const hyperlinkRules = (settings.hyperlinkRules ?? [])
    .map((rule) => ({
      id: rule.id.trim() || makeHyperlinkRuleId(),
      pattern: rule.pattern.trim(),
      urlTemplate: rule.urlTemplate.trim(),
    }))
    .filter((rule) => rule.pattern || rule.urlTemplate);
  for (const rule of hyperlinkRules) {
    if (!rule.pattern || !rule.urlTemplate) {
      throw new Error(t("settings.hyperlinkRuleIncomplete"));
    }
    try {
      new RegExp(rule.pattern);
    } catch {
      throw new Error(t("settings.hyperlinkRuleInvalidPattern", { pattern: rule.pattern }));
    }
    if (!/^https?:\/\//.test(rule.urlTemplate)) {
      throw new Error(t("settings.hyperlinkRuleUrlInvalid"));
    }
  }

  const colorScheme = TERMINAL_COLOR_SCHEMES.some((scheme) => scheme.id === settings.colorScheme)
    ? settings.colorScheme
    : DEFAULT_TERMINAL_COLOR_SCHEME_ID;

  return {
    ...settings,
    fontFamily: settings.fontFamily.trim(),
    fontSize: Math.round(settings.fontSize),
    lineHeight: Number(settings.lineHeight.toFixed(2)),
    scrollbackLines: Math.round(settings.scrollbackLines),
    defaultTransparency: Math.round(settings.defaultTransparency),
    useRandomDynamicBackground: settings.useRandomDynamicBackground ?? false,
    defaultShell: resolveAvailableLocalShell(settings.defaultShell, localShellOptionsForPlatform(customShells)),
    customShells,
    colorScheme,
    hyperlinkRules,
  };
}

function makeCustomShellId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `custom-shell-${crypto.randomUUID()}`;
  }
  return `custom-shell-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function makeHyperlinkRuleId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `hyperlink-rule-${crypto.randomUUID()}`;
  }
  return `hyperlink-rule-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function TerminalColorSchemePicker({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const selectedOptionRef = useRef<HTMLButtonElement | null>(null);
  const selectedScheme = resolveTerminalColorScheme(value);

  useEffect(() => {
    if (!open) {
      return;
    }
    const frame = window.requestAnimationFrame(() => selectedOptionRef.current?.focus());
    const closeFromOutside = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      if (target && !rootRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeFromOutside);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", closeFromOutside);
    };
  }, [open]);

  function handleOptionKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    const options = [...(rootRef.current?.querySelectorAll<HTMLButtonElement>("[role='option']") ?? [])];
    const currentIndex = options.indexOf(event.currentTarget);
    let nextIndex: number | null = null;
    if (event.key === "ArrowDown") {
      nextIndex = Math.min(currentIndex + 1, options.length - 1);
    } else if (event.key === "ArrowUp") {
      nextIndex = Math.max(currentIndex - 1, 0);
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = options.length - 1;
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
      return;
    }
    if (nextIndex !== null) {
      event.preventDefault();
      options[nextIndex]?.focus();
    }
  }

  return (
    <div className={`terminal-scheme-picker${open ? " open" : ""}`} ref={rootRef}>
      <button
        aria-controls="settings-terminal-scheme-listbox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={label}
        className="terminal-scheme-picker-trigger"
        onClick={() => setOpen((current) => !current)}
        ref={buttonRef}
        style={{
          backgroundColor: selectedScheme.palette.background,
          color: selectedScheme.palette.foreground,
        }}
        type="button"
      >
        <span>{selectedScheme.name}</span>
        <ChevronDown aria-hidden size={14} />
      </button>
      {open ? (
        <div
          aria-label={label}
          className="terminal-scheme-picker-list"
          id="settings-terminal-scheme-listbox"
          role="listbox"
        >
          {TERMINAL_COLOR_SCHEMES.map((scheme) => {
            const selected = scheme.id === value;
            return (
              <button
                aria-selected={selected}
                className="terminal-scheme-picker-option"
                key={scheme.id}
                onClick={() => {
                  onChange(scheme.id);
                  setOpen(false);
                  buttonRef.current?.focus();
                }}
                onKeyDown={handleOptionKeyDown}
                ref={selected ? selectedOptionRef : undefined}
                role="option"
                style={{
                  backgroundColor: scheme.palette.background,
                  color: scheme.palette.foreground,
                }}
                type="button"
              >
                <span>{scheme.name}</span>
                {selected ? <Check aria-hidden size={14} /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function TerminalSettings() {
  const { t } = useTranslation();
  const terminalSettings = useWorkspaceStore((state) => state.terminalSettings);
  const setTerminalSettings = useWorkspaceStore((state) => state.setTerminalSettings);
  const showStatusBarNotice = useWorkspaceStore((state) => state.showStatusBarNotice);
  const [draft, setDraft] = useState(terminalSettings);
  // Quick Command Bundles save immediately through the workspace store; they are
  // app-global and deliberately outside this page's draft/save cycle.
  const [editingBundle, setEditingBundle] = useState<QuickCommandBundle | null>(null);
  const {
    customFonts,
    systemFonts,
    refreshing: refreshingFonts,
    recommendationsSynced,
  } = useSystemFontCatalog();
  const hasChanges = JSON.stringify(draft) !== JSON.stringify(terminalSettings);
  const defaultShellOptions = localShellOptionsForPlatform(draft.customShells);
  const customShellPresets = customShellPresetsForPlatform(currentPlatform());
  const defaultShellSelectOptions = defaultShellOptions.some((option) => (option.value ?? "") === draft.defaultShell)
    ? defaultShellOptions
    : [
        ...defaultShellOptions,
        {
          label: draft.defaultShell,
          value: draft.defaultShell,
        },
      ];

  useEffect(() => {
    setDraft(terminalSettings);
  }, [terminalSettings]);

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }
    // Listing also registers each custom font with the WebView, so the family
    // names suggested below resolve in the terminal once selected.
    void loadSharedCustomFonts()
      .then((fonts) => {
        const normalized = normalizeAvailableTerminal(terminalSettings, fonts);
        if (normalized === terminalSettings) return;
        setDraft(normalized);
        setTerminalSettings(normalized);
        void invokeCommand("update_terminal_settings", { request: normalized }).catch(() => undefined);
      })
      .catch(() => undefined);
  }, [setTerminalSettings, terminalSettings]);

  async function handleOpenCustomFontsFolder() {
    if (!isTauriRuntime()) {
      return;
    }
    try {
      await invokeCommand("open_custom_fonts_folder");
    } catch (err) {
      showStatusBarNotice(err instanceof Error ? err.message : String(err), { tone: "error" });
    }
  }

  async function handleRefreshSystemFonts() {
    if (!isSystemFontAccessSupported()) {
      showStatusBarNotice(t("settings.systemFontsUnavailable"), { tone: "error" });
      return;
    }
    try {
      await refreshSharedFontCatalog();
      showStatusBarNotice(t("settings.systemFontsRefreshed"), { tone: "success" });
    } catch (err) {
      showStatusBarNotice(err instanceof Error ? err.message : String(err), { tone: "error" });
    }
  }

  async function handleSave() {
    try {
      const nextSettings = normalizeTerminalSettingsDraft(draft, t);
      const saved = isTauriRuntime()
        ? await invokeCommand("update_terminal_settings", { request: nextSettings })
        : nextSettings;
      setTerminalSettings(saved);
      setDraft(saved);
      showStatusBarNotice(t("settings.terminalSaved"), { tone: "success" });
    } catch (err) {
      showStatusBarNotice(err instanceof Error ? err.message : String(err), { tone: "error" });
    }
  }

  function handleAddCustomShell() {
    setDraft((settings) => ({
      ...settings,
      customShells: [
        ...(settings.customShells ?? []),
        {
          id: makeCustomShellId(),
          name: "",
          commandLine: "",
        },
      ],
    }));
  }

  function handleUpdateCustomShell(shellId: string, field: "name" | "commandLine", value: string) {
    setDraft((settings) => ({
      ...settings,
      customShells: (settings.customShells ?? []).map((shell) =>
        shell.id === shellId ? { ...shell, [field]: value } : shell,
      ),
    }));
  }

  function handleCustomShellNameChange(shellId: string, name: string) {
    const preset = findCustomShellPreset(name, currentPlatform());
    setDraft((settings) => ({
      ...settings,
      customShells: (settings.customShells ?? []).map((shell) =>
        shell.id === shellId
          ? {
              ...shell,
              name,
              commandLine: preset?.commandLine ?? shell.commandLine,
            }
          : shell,
      ),
    }));
  }

  function handleAddHyperlinkRule() {
    setDraft((settings) => ({
      ...settings,
      hyperlinkRules: [
        ...(settings.hyperlinkRules ?? []),
        {
          id: makeHyperlinkRuleId(),
          pattern: "",
          urlTemplate: "",
        },
      ],
    }));
  }

  function handleUpdateHyperlinkRule(ruleId: string, field: "pattern" | "urlTemplate", value: string) {
    setDraft((settings) => ({
      ...settings,
      hyperlinkRules: (settings.hyperlinkRules ?? []).map((rule) =>
        rule.id === ruleId ? { ...rule, [field]: value } : rule,
      ),
    }));
  }

  function handleRemoveHyperlinkRule(ruleId: string) {
    setDraft((settings) => ({
      ...settings,
      hyperlinkRules: (settings.hyperlinkRules ?? []).filter((rule) => rule.id !== ruleId),
    }));
  }

  function handleRemoveCustomShell(shellId: string) {
    setDraft((settings) => {
      const removedShell = settings.customShells?.find((shell) => shell.id === shellId);
      const customShells = (settings.customShells ?? []).filter((shell) => shell.id !== shellId);
      const defaultShell =
        removedShell?.commandLine.trim() && settings.defaultShell === removedShell.commandLine.trim()
          ? resolveAvailableLocalShell(undefined, localShellOptionsForPlatform(customShells))
          : settings.defaultShell;
      return {
        ...settings,
        customShells,
        defaultShell,
      };
    });
  }

  const customFontTerminalOptions = terminalCustomFontOptions(customFonts)
    .map((font) => ({
      key: font.path,
      label: font.name,
      value: terminalFontCssValue(font.name),
    }));
  // The terminal font picker only offers monospace families.
  const monospaceSystemFonts = systemFontFamilies(systemFonts, true);
  const terminalFontOptions = getRecommendedFontOptions(
    "terminal",
    undefined,
    recommendationsSynced ? monospaceSystemFonts : undefined,
  );
  const curatedTerminalFontFamilies = terminalFontOptions.flatMap((option) => option.family ? [option.family] : []);
  const systemFontTerminalOptions = systemFontsExcluding(monospaceSystemFonts, [
    ...curatedTerminalFontFamilies,
    ...customFonts.map((font) => font.name),
  ]).map((family) => ({ family, value: terminalFontCssValue(family) }));
  const defaultTerminalFontValue = defaultTerminalSettings.fontFamily;
  const terminalFontMatched =
    draft.fontFamily === defaultTerminalFontValue ||
    terminalFontOptions.some((option) => option.value === draft.fontFamily) ||
    customFontTerminalOptions.some((option) => option.value === draft.fontFamily) ||
    systemFontTerminalOptions.some((option) => option.value === draft.fontFamily);

  useSettingsSaveRegistration({ hasChanges, onSave: handleSave });

  return (
    <section className="settings-card settings-section">
      <SettingsSectionHeader
        icon={<Terminal size={18} />}
        label={t("settings.sectionTerminal")}
        title={t("settings.terminalBehavior")}
      />

      <fieldset className="settings-subsection settings-fieldset">
        <legend>
          {t("settings.terminalText")}
          <IncludesSshBadge label={t("settings.includesSsh")} />
        </legend>
        <div>
          <p className="field-hint">{t("settings.terminalTextHint")}</p>
        </div>
        <div className="form-grid three-columns">
          <label data-tutorial-id="settings.terminalFontFamily">
            <span>{t("settings.fontFamily")}</span>
            <div className="input-with-button font-input-with-button">
              <button
                aria-label={t("settings.refreshSystemFonts")}
                className="toolbar-button"
                disabled={refreshingFonts}
                onClick={() => void handleRefreshSystemFonts()}
                title={t("settings.refreshSystemFonts")}
                type="button"
              >
                <RefreshCw className={refreshingFonts ? "spin" : undefined} size={15} />
              </button>
              <select
                onChange={(event) => {
                  const fontFamily = event.currentTarget.value;
                  setDraft((settings) => ({
                    ...settings,
                    fontFamily,
                  }));
                }}
                value={draft.fontFamily}
              >
                {terminalFontMatched ? null : (
                  <option value={draft.fontFamily}>{draft.fontFamily}</option>
                )}
                {customFontTerminalOptions.length > 0 ? (
                  <optgroup label={t("settings.customFonts")}>
                    {customFontTerminalOptions.map((option) => (
                      <option key={option.key} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
                <optgroup label={t("settings.recommendedFonts")}>
                  {terminalFontOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.labelKey ? t(option.labelKey, option.labelParams) : option.label}
                    </option>
                  ))}
                </optgroup>
                {systemFontTerminalOptions.length > 0 ? (
                  <optgroup label={t("settings.systemFonts")}>
                    {systemFontTerminalOptions.map((option) => (
                      <option key={option.family} value={option.value}>
                        {option.family}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
              </select>
              {isTauriRuntime() ? (
                <button
                  aria-label={t("settings.openCustomFontsFolder")}
                  className="toolbar-button"
                  onClick={() => void handleOpenCustomFontsFolder()}
                  title={t("settings.openCustomFontsFolder")}
                  type="button"
                >
                  <FolderOpen size={15} />
                </button>
              ) : null}
            </div>
            <small className="field-hint">{t("settings.customFontsHint")}</small>
          </label>
          <label data-tutorial-id="settings.terminalFontSize">
            <span>{t("settings.fontSize")}</span>
            <input
              inputMode="numeric"
              max={32}
              min={8}
              onChange={(event) => {
                const fontSize = Number(event.currentTarget.value);
                setDraft((settings) => ({
                  ...settings,
                  fontSize,
                }));
              }}
              type="number"
              value={draft.fontSize}
            />
          </label>
          <label>
            <span>{t("settings.lineHeight")}</span>
            <input
              max={2}
              min={1}
              onChange={(event) => {
                const lineHeight = Number(event.currentTarget.value);
                setDraft((settings) => ({
                  ...settings,
                  lineHeight,
                }));
              }}
              step={0.05}
              type="number"
              value={draft.lineHeight}
            />
          </label>
        </div>
        <div className="form-grid three-columns">
          <label>
            <span>{t("settings.cursorStyle")}</span>
            <select
              onChange={(event) => {
                const cursorStyle = event.currentTarget.value as TerminalCursorStyle;
                setDraft((settings) => ({
                  ...settings,
                  cursorStyle,
                }));
              }}
              value={draft.cursorStyle}
            >
              <option value="block">{t("settings.block")}</option>
              <option value="bar">{t("settings.bar")}</option>
              <option value="underline">{t("settings.underline")}</option>
            </select>
          </label>
          <label className="terminal-color-scheme-setting">
            <span>{t("settings.terminalColorScheme")}</span>
            <TerminalColorSchemePicker
              label={t("settings.terminalColorScheme")}
              onChange={(colorScheme) => {
                setDraft((settings) => ({
                  ...settings,
                  colorScheme,
                }));
              }}
              value={draft.colorScheme}
            />
            <small className="field-hint">{t("settings.terminalColorSchemeHint")}</small>
          </label>
        </div>
      </fieldset>

      <fieldset className="settings-subsection settings-fieldset">
        <legend>{t("settings.terminalSession")}</legend>
        <div>
          <p className="field-hint">{t("settings.terminalSessionHint")}</p>
        </div>
        <div className="form-grid three-columns">
          <label data-tutorial-id="settings.defaultShell">
            <span>{t("settings.defaultShell")}</span>
            <select
              onChange={(event) => {
                const defaultShell = event.currentTarget.value;
                setDraft((settings) => ({
                  ...settings,
                  defaultShell,
                }));
              }}
              value={draft.defaultShell}
            >
              {defaultShellSelectOptions.map((option) => (
                <option key={option.value ?? option.label} value={option.value ?? ""}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label data-tutorial-id="settings.scrollbackLines">
            <span>{t("settings.scrollbackLines")}</span>
            <input
              inputMode="numeric"
              max={100000}
              min={100}
              onChange={(event) => {
                const scrollbackLines = Number(event.currentTarget.value);
                setDraft((settings) => ({
                  ...settings,
                  scrollbackLines,
                }));
              }}
              step={100}
              type="number"
              value={draft.scrollbackLines}
            />
            <small className="field-hint">{t("settings.scrollbackHint")}</small>
          </label>
          <label>
            <span>{t("settings.defaultTransparency")}</span>
            <input
              inputMode="numeric"
              max={100}
              min={0}
              onChange={(event) => {
                const defaultTransparency = Number(event.currentTarget.value);
                setDraft((settings) => ({
                  ...settings,
                  defaultTransparency,
                }));
              }}
              type="number"
              value={draft.defaultTransparency}
            />
            <small className="field-hint">{t("settings.defaultTransparencyHint")}</small>
          </label>
        </div>
        <div className="settings-toggle-list">
          <label className="settings-toggle-row">
            <ToggleSwitch
              checked={draft.useRandomDynamicBackground}
              onChange={(checked) =>
                setDraft((settings) => ({ ...settings, useRandomDynamicBackground: checked }))
              }
            />
            <span>
              <strong>{t("settings.randomDynamicBackgroundOnCreate")}</strong>
              <small>{t("settings.randomDynamicBackgroundOnCreateHint")}</small>
            </span>
          </label>
          <label className="settings-toggle-row">
            <ToggleSwitch
              checked={draft.autoRecordSessions}
              onChange={(checked) =>
                setDraft((settings) => ({ ...settings, autoRecordSessions: checked }))
              }
            />
            <span>
              <strong>
                {t("settings.autoRecordSessions")}
                <IncludesSshBadge label={t("settings.includesSsh")} />
              </strong>
              <small>{t("settings.autoRecordSessionsHint")}</small>
            </span>
          </label>
        </div>
      </fieldset>

      <fieldset className="settings-subsection settings-fieldset">
        <legend>{t("settings.customShells")}</legend>
        <div>
          <p className="field-hint">{t("settings.customShellsHint")}</p>
        </div>
        <div className="settings-toggle-list">
          <datalist id="terminal-custom-shell-presets">
            {customShellPresets.map((preset) => (
              <option key={preset.name} value={preset.name} />
            ))}
          </datalist>
          {(draft.customShells ?? []).map((shell) => (
            <div className="settings-custom-shell-row" key={shell.id}>
              <Terminal size={16} aria-hidden />
              <div className="settings-custom-shell-fields">
                <label>
                  <span>{t("settings.customShellName")}</span>
                  <input
                    list="terminal-custom-shell-presets"
                    onChange={(event) => handleCustomShellNameChange(shell.id, event.currentTarget.value)}
                    placeholder={t("settings.customShellNamePlaceholder")}
                    value={shell.name}
                  />
                </label>
                <label>
                  <span>{t("settings.customShellCommandLine")}</span>
                  <input
                    onChange={(event) => handleUpdateCustomShell(shell.id, "commandLine", event.currentTarget.value)}
                    placeholder={t("settings.customShellCommandLinePlaceholder")}
                    value={shell.commandLine}
                  />
                </label>
              </div>
              <button
                aria-label={t("settings.removeCustomShell", { name: shell.name || t("settings.customShell") })}
                className="toolbar-button"
                onClick={() => handleRemoveCustomShell(shell.id)}
                title={t("settings.removeCustomShell", { name: shell.name || t("settings.customShell") })}
                type="button"
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
          <button
            className="toolbar-button settings-inline-add-button"
            onClick={handleAddCustomShell}
            type="button"
          >
            <Plus size={15} />
            {t("settings.addCustomShell")}
          </button>
        </div>
      </fieldset>

      <fieldset className="settings-subsection settings-fieldset">
        <legend>
          {t("settings.terminalIntegrations")}
          <IncludesSshBadge label={t("settings.includesSsh")} />
        </legend>
        <div>
          <p className="field-hint">{t("settings.terminalIntegrationsHint")}</p>
        </div>
        <div className="settings-toggle-list">
          <label className="settings-toggle-row">
            <ToggleSwitch
              checked={draft.enableInlineImages}
              onChange={(checked) =>
                setDraft((settings) => ({ ...settings, enableInlineImages: checked }))
              }
            />
            <span>
              <strong>{t("settings.enableInlineImages")}</strong>
              <small>{t("settings.enableInlineImagesHint")}</small>
            </span>
          </label>
          <label className="settings-toggle-row">
            <ToggleSwitch
              checked={draft.allowTerminalNotifications}
              onChange={(checked) =>
                setDraft((settings) => ({ ...settings, allowTerminalNotifications: checked }))
              }
            />
            <span>
              <strong>{t("settings.allowTerminalNotifications")}</strong>
              <small>{t("settings.allowTerminalNotificationsHint")}</small>
            </span>
          </label>
        </div>
      </fieldset>

      <fieldset className="settings-subsection settings-fieldset">
        <legend>
          {t("settings.hyperlinkRules")}
          <IncludesSshBadge label={t("settings.includesSsh")} />
        </legend>
        <div>
          <p className="field-hint">{t("settings.hyperlinkRulesHint")}</p>
        </div>
        <div className="settings-toggle-list">
          {(draft.hyperlinkRules ?? []).map((rule) => (
            <div className="settings-custom-shell-row" key={rule.id}>
              <Link size={16} aria-hidden />
              <div className="settings-custom-shell-fields">
                <label>
                  <span>{t("settings.hyperlinkRulePattern")}</span>
                  <input
                    onChange={(event) => handleUpdateHyperlinkRule(rule.id, "pattern", event.currentTarget.value)}
                    placeholder="[A-Z]+-\d+"
                    value={rule.pattern}
                  />
                </label>
                <label>
                  <span>{t("settings.hyperlinkRuleUrl")}</span>
                  <input
                    onChange={(event) => handleUpdateHyperlinkRule(rule.id, "urlTemplate", event.currentTarget.value)}
                    placeholder="https://tracker.example.com/browse/$0"
                    value={rule.urlTemplate}
                  />
                </label>
              </div>
              <button
                aria-label={t("settings.removeHyperlinkRule", { pattern: rule.pattern || t("settings.hyperlinkRule") })}
                className="toolbar-button"
                onClick={() => handleRemoveHyperlinkRule(rule.id)}
                title={t("settings.removeHyperlinkRule", { pattern: rule.pattern || t("settings.hyperlinkRule") })}
                type="button"
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
          <button
            className="toolbar-button settings-inline-add-button"
            onClick={handleAddHyperlinkRule}
            type="button"
          >
            <Plus size={15} />
            {t("settings.addHyperlinkRule")}
          </button>
        </div>
      </fieldset>

      <fieldset className="settings-subsection settings-fieldset">
        <legend>{t("settings.quickCommandBundles")}</legend>
        <div>
          <p className="field-hint">{t("settings.quickCommandBundlesHint")}</p>
        </div>
        <div className="settings-quick-command-bundles kk-surface">
          <QuickCommandBundleList onEditCommands={setEditingBundle} />
        </div>
      </fieldset>

      <fieldset className="settings-subsection settings-fieldset">
        <legend>{t("settings.terminalClipboard")}</legend>
        <div>
          <p className="field-hint">{t("settings.terminalClipboardHint")}</p>
        </div>
        <div className="settings-toggle-list">
          <label className="settings-toggle-row">
            <ToggleSwitch
              checked={draft.copyOnSelect}
              onChange={(checked) =>
                setDraft((settings) => ({ ...settings, copyOnSelect: checked }))
              }
            />
            <span>
              <strong>
                {t("settings.copyOnSelect")}
                <IncludesSshBadge label={t("settings.includesSsh")} />
              </strong>
              <small>{t("settings.copyOnSelectHint")}</small>
            </span>
          </label>
          <label className="settings-toggle-row">
            <ToggleSwitch
              checked={draft.allowOsc52Clipboard}
              onChange={(checked) =>
                setDraft((settings) => ({ ...settings, allowOsc52Clipboard: checked }))
              }
            />
            <span>
              <strong>{t("settings.allowLocalOsc52Clipboard")}</strong>
            </span>
          </label>
          <label className="settings-toggle-row">
            <ToggleSwitch
              checked={draft.confirmMultilinePaste}
              onChange={(checked) =>
                setDraft((settings) => ({ ...settings, confirmMultilinePaste: checked }))
              }
            />
            <span>
              <strong>
                {t("settings.confirmMultilinePaste")}
                <IncludesSshBadge label={t("settings.includesSsh")} />
              </strong>
            </span>
          </label>
          <label className="settings-toggle-row">
            <ToggleSwitch
              checked={draft.rightClickPaste}
              onChange={(checked) =>
                setDraft((settings) => ({ ...settings, rightClickPaste: checked }))
              }
            />
            <span>
              <strong>
                {t("settings.rightClickPaste")}
                <IncludesSshBadge label={t("settings.includesSsh")} />
              </strong>
              <small>{t("settings.rightClickPasteHint")}</small>
            </span>
          </label>
        </div>
      </fieldset>

      {editingBundle ? (
        <QuickCommandManagerDialog
          bundleName={editingBundle.name}
          connection={undefined}
          target={{ kind: "bundle", bundleId: editingBundle.id }}
          onClose={() => setEditingBundle(null)}
        />
      ) : null}
    </section>
  );
}
