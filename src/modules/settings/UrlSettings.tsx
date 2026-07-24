import { Globe, Trash2 } from "../../lib/reicon";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { invokeCommand, isTauriRuntime, selectUrlDownloadFolder } from "../../lib/tauri";
import { technicalInputProps } from "../../lib/inputBehavior";
import { useWorkspaceStore } from "../../store";
import type { UrlCredentialSummary, UrlDataPartitionSummary } from "../../types";
import { SettingsSectionHeader, useSettingsSaveRegistration } from "./shared";
import { ToggleSwitch } from "./ToggleSwitch";
import { UrlCredentialManager } from "./UrlCredentialManager";
import { COMMON_URL_USER_AGENTS } from "../workspace/connections/webview/urlUserAgents";

export function UrlSettings() {
  const { t } = useTranslation();
  const urlSettings = useWorkspaceStore((state) => state.urlSettings);
  const setUrlSettings = useWorkspaceStore((state) => state.setUrlSettings);
  const showStatusBarNotice = useWorkspaceStore((state) => state.showStatusBarNotice);
  const [draft, setDraft] = useState(urlSettings);
  const [credentials, setCredentials] = useState<UrlCredentialSummary[]>([]);
  const [partitions, setPartitions] = useState<UrlDataPartitionSummary[]>([]);
  const hasChanges =
    JSON.stringify({
      ...draft,
      defaultDataPartition: draft.defaultDataPartition?.trim() || undefined,
      defaultUserAgent: draft.defaultUserAgent?.trim() || undefined,
      downloadFolder: draft.downloadFolder?.trim() || undefined,
    }) !==
    JSON.stringify({
      ...urlSettings,
      defaultDataPartition: urlSettings.defaultDataPartition?.trim() || undefined,
      defaultUserAgent: urlSettings.defaultUserAgent?.trim() || undefined,
      downloadFolder: urlSettings.downloadFolder?.trim() || undefined,
    });

  useEffect(() => {
    setDraft(urlSettings);
  }, [urlSettings]);

  async function load() {
    if (!isTauriRuntime()) {
      return;
    }
    try {
      const [credentialRows, partitionRows] = await Promise.all([
        invokeCommand("list_url_credentials", undefined),
        invokeCommand("list_url_data_partitions", undefined),
      ]);
      setCredentials(credentialRows);
      setPartitions(partitionRows);
    } catch (loadError) {
      showStatusBarNotice(loadError instanceof Error ? loadError.message : String(loadError), { tone: "error" });
    }
  }

  useEffect(() => {
    // Load once on mount; `load` is recreated each render and must not retrigger the effect.
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSave() {
    try {
      const request = {
        ...draft,
        defaultDataPartition: draft.defaultDataPartition?.trim() || undefined,
        defaultUserAgent: draft.defaultUserAgent?.trim() || undefined,
        downloadFolder: draft.downloadFolder?.trim() || undefined,
      };
      const saved = isTauriRuntime() ? await invokeCommand("update_url_settings", { request }) : request;
      setUrlSettings(saved);
      setDraft(saved);
      showStatusBarNotice(t("settings.urlSettingsSaved"), { tone: "success" });
    } catch (saveError) {
      showStatusBarNotice(saveError instanceof Error ? saveError.message : String(saveError), { tone: "error" });
    }
  }

  async function browseDownloadFolder() {
    try {
      const selection = await selectUrlDownloadFolder({
        defaultPath: draft.downloadFolder || undefined,
        title: t("settings.urlDownloadFolderBrowse"),
      });
      if (selection) {
        setDraft((settings) => ({ ...settings, downloadFolder: selection }));
      }
    } catch (browseError) {
      showStatusBarNotice(browseError instanceof Error ? browseError.message : String(browseError), { tone: "error" });
    }
  }

  async function clearPartition(name: string) {
    try {
      await invokeCommand("clear_url_data_partition", { name });
      showStatusBarNotice(t("settings.urlDataShardCleared", { name }), { tone: "success" });
      window.dispatchEvent(new CustomEvent("kkterm:connection-tree-invalidated"));
      await load();
    } catch (clearError) {
      showStatusBarNotice(clearError instanceof Error ? clearError.message : String(clearError), { tone: "error" });
    }
  }

  useSettingsSaveRegistration({ hasChanges, onSave: handleSave });

  return (
    <section className="settings-card settings-section">
      <SettingsSectionHeader
        icon={<Globe size={18} />}
        label={t("settings.sectionUrl")}
        title={t("settings.urlDefaults")}
      />

      <fieldset className="settings-subsection settings-fieldset">
        <legend>{t("settings.urlDownloadFolder")}</legend>
        <div>
          <p className="field-hint">{t("settings.urlDownloadFolderHint")}</p>
        </div>
        <div className="form-grid one-column">
          <label>
            <span>{t("settings.urlDownloadFolder")}</span>
            <div className="screenshots-folder-row">
              <input
                {...technicalInputProps}
                onChange={(event) => {
                  const downloadFolder = event.currentTarget.value;
                  setDraft((settings) => ({ ...settings, downloadFolder }));
                }}
                placeholder={t("settings.urlDownloadFolderSystemDefault")}
                value={draft.downloadFolder ?? ""}
              />
              <button
                className="secondary-button"
                onClick={() => void browseDownloadFolder()}
                type="button"
              >
                {t("settings.urlDownloadFolderBrowse")}
              </button>
            </div>
          </label>
        </div>
      </fieldset>

      <fieldset className="settings-subsection settings-fieldset">
        <legend>{t("settings.urlSecurity")}</legend>
        <div>
          <p className="field-hint">{t("settings.urlSecurityHint")}</p>
        </div>
        <div className="settings-toggle-list">
          <label
            className="settings-toggle-row"
            data-tutorial-id="settings.ignoreCertificateErrors"
          >
            <ToggleSwitch
              checked={draft.ignoreCertificateErrors}
              onChange={(checked) =>
                setDraft((settings) => ({ ...settings, ignoreCertificateErrors: checked }))
              }
            />
            <span>
              <strong>{t("settings.ignoreCertificateErrors")}</strong>
              <small>{t("settings.ignoreCertificateErrorsHint")}</small>
            </span>
          </label>
        </div>
      </fieldset>


      <fieldset className="settings-subsection settings-fieldset">
        <legend>{t("settings.urlUserAgent")}</legend>
        <div>
          <p className="field-hint">{t("settings.urlUserAgentHint")}</p>
        </div>
        <div className="form-grid one-column">
          <label>
            <span>{t("settings.urlUserAgentDefault")}</span>
            <input
              {...technicalInputProps}
              list="url-user-agent-presets"
              onChange={(event) => {
                const defaultUserAgent = event.currentTarget.value;
                setDraft((settings) => ({ ...settings, defaultUserAgent }));
              }}
              placeholder={t("settings.urlUserAgentDefaultPlaceholder")}
              value={draft.defaultUserAgent ?? ""}
            />
          </label>
          <datalist id="url-user-agent-presets">
            {COMMON_URL_USER_AGENTS.map((preset) => (
              <option key={preset.id} label={t(preset.labelKey)} value={preset.value} />
            ))}
          </datalist>
        </div>
      </fieldset>

      <fieldset className="settings-subsection settings-fieldset">
        <legend data-tutorial-id="settings.urlSavedPasswords">{t("settings.savedWebsitePasswords")}</legend>
        <div>
          <p className="field-hint">{t("settings.savedWebsitePasswordsHint")}</p>
        </div>
        <UrlCredentialManager credentials={credentials} onChanged={load} />
      </fieldset>

      <fieldset className="settings-subsection settings-fieldset">
        <legend data-tutorial-id="settings.urlDataShards">{t("settings.urlDataShards")}</legend>
        <div>
          <p className="field-hint">{t("settings.urlDataShardsHint")}</p>
        </div>
        <div className="form-grid two-columns">
          <label>
            <span>{t("connections.dataPartition")}</span>
            <input
              {...technicalInputProps}
              onChange={(event) => {
                const defaultDataPartition = event.currentTarget.value;
                setDraft((settings) => ({ ...settings, defaultDataPartition }));
              }}
              placeholder={t("connections.default")}
              value={draft.defaultDataPartition ?? ""}
            />
          </label>
        </div>
        {partitions.length === 0 ? (
          <p className="settings-empty-state">{t("settings.noUrlDataShards")}</p>
        ) : (
          <div className="settings-list" aria-label={t("settings.urlDataShards")}>
            {partitions.map((partition) => (
              <div className="settings-list-row" key={partition.name}>
                <div>
                  <strong>{partition.name}</strong>
                  <span>
                    {t(
                      partition.connectionCount === 1
                        ? "settings.urlDataShardConnectionCount"
                        : "settings.urlDataShardConnectionCountPlural",
                      { count: partition.connectionCount },
                    )}
                  </span>
                </div>
                <button
                  className="secondary-button danger"
                  type="button"
                  onClick={() => void clearPartition(partition.name)}
                >
                  <Trash2 size={15} />
                  {t("settings.clearShard")}
                </button>
              </div>
            ))}
          </div>
        )}
      </fieldset>
    </section>
  );
}
