import { useEffect, useState } from "react";
import { FolderOpen } from "../../lib/reicon";
import { useTranslation } from "react-i18next";
import { currentPlatform } from "../../lib/platform";
import { invokeCommand, isTauriRuntime } from "../../lib/tauri";
import { useWorkspaceStore } from "../../store";
import type { SftpSettings } from "../../types";
import {
  fileExplorerTerminalOptionsForPlatform,
  resolveFileExplorerTerminalOption,
} from "../workspace/connections/sftp/fileExplorerTerminalOptions";
import { SettingsSectionHeader, useSettingsSaveRegistration } from "./shared";

export function FileExplorerSettings() {
  const { t } = useTranslation();
  const sftpSettings = useWorkspaceStore((state) => state.sftpSettings);
  const terminalSettings = useWorkspaceStore((state) => state.terminalSettings);
  const macAppStoreBuild = useWorkspaceStore(
    (state) => state.appModeInfo.macAppStoreBuild === true,
  );
  const setSftpSettings = useWorkspaceStore((state) => state.setSftpSettings);
  const showStatusBarNotice = useWorkspaceStore((state) => state.showStatusBarNotice);
  const [draft, setDraft] = useState<SftpSettings>(sftpSettings);
  const options = fileExplorerTerminalOptionsForPlatform(
    terminalSettings.customShells,
    currentPlatform(),
  );
  const selectedTerminal = resolveFileExplorerTerminalOption(
    {
      shell: draft.fileExplorerTerminalShell,
      elevated: draft.fileExplorerTerminalElevated,
    },
    options,
  );
  const hasChanges =
    draft.fileExplorerOpenMode !== sftpSettings.fileExplorerOpenMode ||
    (!macAppStoreBuild && (
      draft.fileExplorerTerminalShell !== sftpSettings.fileExplorerTerminalShell ||
      draft.fileExplorerTerminalElevated !== sftpSettings.fileExplorerTerminalElevated
    ));

  useEffect(() => {
    setDraft(sftpSettings);
  }, [sftpSettings]);

  async function handleSave() {
    try {
      const request: SftpSettings = {
        ...useWorkspaceStore.getState().sftpSettings,
        fileExplorerOpenMode: draft.fileExplorerOpenMode,
        fileExplorerTerminalShell: macAppStoreBuild
          ? sftpSettings.fileExplorerTerminalShell
          : selectedTerminal.shell,
        fileExplorerTerminalElevated: macAppStoreBuild
          ? sftpSettings.fileExplorerTerminalElevated
          : selectedTerminal.elevated,
      };
      const saved = isTauriRuntime()
        ? await invokeCommand("update_sftp_settings", { request })
        : request;
      setSftpSettings(saved);
      setDraft(saved);
      showStatusBarNotice(t("settings.fileExplorerSaved"), { tone: "success" });
    } catch (error) {
      showStatusBarNotice(error instanceof Error ? error.message : String(error), {
        tone: "error",
      });
    }
  }

  useSettingsSaveRegistration({ hasChanges, onSave: handleSave });

  return (
    <section className="settings-card settings-section" data-tutorial-id="settings.fileExplorer">
      <SettingsSectionHeader
        icon={<FolderOpen size={18} />}
        label={t("settings.fileExplorer")}
        title={t("settings.fileExplorer")}
      />
      <fieldset className="settings-subsection settings-fieldset">
        <legend>{t("settings.fileExplorer")}</legend>
        <div className="form-grid">
          <label>
            <span>{t("settings.fileExplorerOpenMode")}</span>
            <select
              value={draft.fileExplorerOpenMode}
              onChange={(event) => {
                const fileExplorerOpenMode = event.target.value as SftpSettings["fileExplorerOpenMode"];
                setDraft((state) => ({
                  ...state,
                  fileExplorerOpenMode,
                }));
              }}
            >
              <option value="external">{t("settings.fileExplorerOpenModeExternal")}</option>
              <option value="inlineEditor">{t("settings.fileExplorerOpenModeInlineEditor")}</option>
            </select>
            <small className="field-hint">{t("settings.fileExplorerOpenModeHint")}</small>
          </label>
          {macAppStoreBuild ? null : (
            <label>
              <span>{t("settings.fileExplorerTerminal")}</span>
              <select
                value={selectedTerminal.id}
                onChange={(event) => {
                  const option = options.find((entry) => entry.id === event.currentTarget.value);
                  if (!option) {
                    return;
                  }
                  setDraft((state) => ({
                    ...state,
                    fileExplorerTerminalShell: option.shell,
                    fileExplorerTerminalElevated: option.elevated,
                  }));
                }}
              >
                {options.map((option) => (
                  <option key={option.id} value={option.id}>{option.label}</option>
                ))}
              </select>
              <small className="field-hint">{t("settings.fileExplorerTerminalHint")}</small>
            </label>
          )}
        </div>
      </fieldset>
    </section>
  );
}
