import { useEffect, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { Keyboard, RotateCcw, X } from "../../lib/reicon";
import { useTranslation } from "react-i18next";
import { invokeCommand, isTauriRuntime } from "../../lib/tauri";
import { useWorkspaceStore } from "../../store";
import {
  WORKSPACE_SHORTCUT_ACTIONS,
  bindingFromKeyboardEvent,
  conflictingWorkspaceShortcutAction,
  type WorkspaceShortcutActionId,
  type WorkspaceShortcutOverrides,
  type WorkspaceShortcutScope,
} from "../workspace/keymap";
import { SettingsSectionHeader, useSettingsSaveRegistration } from "./shared";
import { ScreenshotShortcutRows } from "./ScreenshotShortcutRows";
import {
  screenshotSettingsHaveChanges,
  useScreenshotSettingsDraft,
} from "./screenshotSettingsDraft";

function overridesEqual(a: WorkspaceShortcutOverrides, b: WorkspaceShortcutOverrides) {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  return aKeys.length === bKeys.length && aKeys.every((key) => key in b && a[key] === b[key]);
}

export function ShortcutsSettings() {
  const { t } = useTranslation();
  const generalSettings = useWorkspaceStore((state) => state.generalSettings);
  const setGeneralSettings = useWorkspaceStore((state) => state.setGeneralSettings);
  const showStatusBarNotice = useWorkspaceStore((state) => state.showStatusBarNotice);
  const screenshotSaved = useScreenshotSettingsDraft((state) => state.saved);
  const screenshotDraft = useScreenshotSettingsDraft((state) => state.draft);
  const useDirectxSaved = useScreenshotSettingsDraft((state) => state.useDirectxSaved);
  const useDirectxDraft = useScreenshotSettingsDraft((state) => state.useDirectxDraft);
  const loadScreenshotSettings = useScreenshotSettingsDraft((state) => state.load);
  const saveScreenshotSettings = useScreenshotSettingsDraft((state) => state.save);
  const [draft, setDraft] = useState<WorkspaceShortcutOverrides>(
    generalSettings.workspaceShortcuts,
  );
  const [recordingActionId, setRecordingActionId] = useState<WorkspaceShortcutActionId | null>(
    null,
  );
  const [conflictNotice, setConflictNotice] = useState<string | null>(null);
  const workspaceHasChanges = !overridesEqual(draft, generalSettings.workspaceShortcuts);
  const screenshotHasChanges = screenshotSettingsHaveChanges({
    saved: screenshotSaved,
    draft: screenshotDraft,
    useDirectxSaved,
    useDirectxDraft,
  });
  const hasChanges = workspaceHasChanges || screenshotHasChanges;

  useEffect(() => {
    setDraft(generalSettings.workspaceShortcuts);
  }, [generalSettings]);

  useEffect(() => {
    void loadScreenshotSettings().catch((error) => {
      showStatusBarNotice(error instanceof Error ? error.message : String(error), {
        tone: "error",
      });
    });
  }, [loadScreenshotSettings, showStatusBarNotice]);

  function effectiveBinding(actionId: WorkspaceShortcutActionId) {
    const action = WORKSPACE_SHORTCUT_ACTIONS.find((entry) => entry.id === actionId);
    const override = draft[actionId];
    return override !== undefined ? override : (action?.defaultBinding ?? null);
  }

  function setOverride(actionId: WorkspaceShortcutActionId, binding: string | null) {
    const action = WORKSPACE_SHORTCUT_ACTIONS.find((entry) => entry.id === actionId);
    setDraft((current) => {
      const next = { ...current };
      if (binding === (action?.defaultBinding ?? null)) {
        delete next[actionId];
      } else {
        next[actionId] = binding;
      }
      return next;
    });
  }

  function stopRecording() {
    setRecordingActionId(null);
    setConflictNotice(null);
  }

  function handleRecordingKeyDown(
    event: ReactKeyboardEvent<HTMLButtonElement>,
    actionId: WorkspaceShortcutActionId,
  ) {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") {
      stopRecording();
      return;
    }
    const binding = bindingFromKeyboardEvent(event.nativeEvent);
    if (!binding) {
      return;
    }
    const conflict = conflictingWorkspaceShortcutAction(binding, draft, actionId);
    if (conflict) {
      setConflictNotice(t("settings.shortcutConflict", { action: t(conflict.labelKey) }));
      return;
    }
    setOverride(actionId, binding);
    stopRecording();
  }

  async function handleSave() {
    try {
      const savedScreenshotChanges = await saveScreenshotSettings();
      if (workspaceHasChanges) {
        const currentSettings = useWorkspaceStore.getState().generalSettings;
        const request = { ...currentSettings, workspaceShortcuts: draft };
        const saved = isTauriRuntime()
          ? await invokeCommand("update_general_settings", { request })
          : request;
        setGeneralSettings(saved);
        setDraft(saved.workspaceShortcuts);
      }
      if (workspaceHasChanges || savedScreenshotChanges) {
        showStatusBarNotice(t("settings.shortcutsSaved"), { tone: "success" });
      }
    } catch (saveError) {
      showStatusBarNotice(
        saveError instanceof Error ? saveError.message : String(saveError),
        { tone: "error" },
      );
    }
  }

  useSettingsSaveRegistration({ hasChanges, onSave: handleSave });

  function renderRows(scope: WorkspaceShortcutScope) {
    return WORKSPACE_SHORTCUT_ACTIONS.filter((action) => action.scope === scope).map((action) => {
      const binding = effectiveBinding(action.id);
      const overridden = action.id in draft;
      const recording = recordingActionId === action.id;
      return (
        <div className="shortcut-row" key={action.id}>
          <span className="shortcut-row-label">{t(action.labelKey)}</span>
          <span className="shortcut-row-controls">
            <button
              className={`shortcut-binding-button${recording ? " recording" : ""}${binding ? "" : " unbound"}`}
              onBlur={() => {
                if (recording) {
                  stopRecording();
                }
              }}
              onClick={() => {
                setRecordingActionId(action.id);
                setConflictNotice(null);
              }}
              onKeyDown={(event) => {
                if (recording) {
                  handleRecordingKeyDown(event, action.id);
                }
              }}
              type="button"
            >
              {recording
                ? t("settings.shortcutPressKeys")
                : (binding ?? t("settings.shortcutNotSet"))}
            </button>
            {binding ? (
              <button
                aria-label={t("settings.shortcutClear")}
                className="shortcut-icon-button"
                onClick={() => setOverride(action.id, null)}
                title={t("settings.shortcutClear")}
                type="button"
              >
                <X size={13} />
              </button>
            ) : null}
            {overridden ? (
              <button
                aria-label={t("settings.shortcutReset")}
                className="shortcut-icon-button"
                onClick={() =>
                  setDraft((current) => {
                    const next = { ...current };
                    delete next[action.id];
                    return next;
                  })
                }
                title={t("settings.shortcutReset")}
                type="button"
              >
                <RotateCcw size={13} />
              </button>
            ) : null}
          </span>
        </div>
      );
    });
  }

  return (
    <section className="settings-card settings-section" data-tutorial-id="settings.shortcuts">
      <SettingsSectionHeader
        actions={
          <button
            className="toolbar-button"
            disabled={Object.keys(draft).length === 0}
            onClick={() => {
              stopRecording();
              setDraft({});
            }}
            type="button"
          >
            <RotateCcw size={14} />
            {t("settings.shortcutResetAll")}
          </button>
        }
        icon={<Keyboard size={18} />}
        label={t("settings.sectionShortcuts")}
        title={t("settings.sectionShortcuts")}
      />
      <p className="field-hint">{t("settings.shortcutsHint")}</p>
      {conflictNotice ? <p className="shortcut-conflict-notice">{conflictNotice}</p> : null}
      <fieldset className="settings-subsection settings-fieldset">
        <legend>{t("settings.workspaceTabs")}</legend>
        <div className="shortcut-list">{renderRows("workspace")}</div>
      </fieldset>
      <fieldset className="settings-subsection settings-fieldset">
        <legend>{t("settings.sectionTerminal")}</legend>
        <div className="shortcut-list">{renderRows("terminal")}</div>
      </fieldset>
      <fieldset className="settings-subsection settings-fieldset">
        <legend>{t("settings.sectionScreenshots")}</legend>
        <div>
          <p className="field-hint">{t("settings.screenshotsShortcutsHint")}</p>
        </div>
        <div className="shortcut-list">
          <ScreenshotShortcutRows />
        </div>
      </fieldset>
      <fieldset className="settings-subsection settings-fieldset">
        <legend>{t("settings.screenshotsEditorShortcuts")}</legend>
        <div>
          <p className="field-hint">{t("settings.screenshotsEditorShortcutsHint")}</p>
        </div>
        <div className="shortcut-list">{renderRows("screenshotEditor")}</div>
      </fieldset>
    </section>
  );
}
