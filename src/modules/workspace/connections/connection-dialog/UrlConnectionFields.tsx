import { Database, Settings2 } from "../../../../lib/reicon";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { technicalInputProps } from "../../../../lib/inputBehavior";
import type { Connection } from "../../../../types";
import { useWorkspaceStore } from "../../../../store";
import { globalWebviewProxy, splitUrlProxy, type UrlProxyMode } from "../webview/urlProxy";
import { COMMON_URL_USER_AGENTS } from "../webview/urlUserAgents";
import { PasswordField } from "./ConnectionPasswordFields";

export function UrlConnectionFields({
  hasStoredUrlPassword,
  initialConnection,
  isEditMode,
}: {
  hasStoredUrlPassword: boolean;
  initialConnection?: Connection;
  isEditMode: boolean;
}) {
  const { t } = useTranslation();

  return (
    <>
      <label>
        <span>{t("connections.nameOptional")}</span>
        <input name="name" defaultValue={initialConnection?.name ?? ""} placeholder={t("connections.connectionName")} />
      </label>
      <div className="connection-endpoint-fields">
        <label className="endpoint-wide-input">
          <span>{t("connections.url")}*</span>
          <input
            name="url"
            {...technicalInputProps}
            defaultValue={initialConnection?.url ?? ""}
            placeholder={t("connections.urlPlaceholder")}
            required
          />
        </label>
      </div>
      <div className="connection-auth-fields">
        <label>
          <span>{t("connections.credentialUser")}</span>
          <input
            name="urlCredentialUsername"
            {...technicalInputProps}
            defaultValue={initialConnection?.urlCredentialUsername ?? ""}
            placeholder={t("connections.optionalUsername")}
          />
        </label>
        <PasswordField
          hasStoredSecret={isEditMode && hasStoredUrlPassword}
          label={t("connections.password")}
          name="urlPassword"
          placeholder={isEditMode ? t("connections.leaveBlankPassword") : t("connections.storedInKeychain")}
        />
      </div>
    </>
  );
}

export function UrlConnectionOptions({ initialConnection }: { initialConnection?: Connection }) {
  const { t } = useTranslation();
  const urlSettings = useWorkspaceStore((state) => state.urlSettings);
  const generalSettings = useWorkspaceStore((state) => state.generalSettings);
  const [inheritsDefaults, setInheritsDefaults] = useState(initialConnection?.urlProxyInheritDefaults ?? true);
  const initialProxy = splitUrlProxy(initialConnection?.urlProxy);
  // When inheriting, the URL Session follows the global app proxy. The webview
  // mode dropdown only models direct/http/socks5, so system and "No Proxy" both
  // display as direct here; the actual behavior is resolved by resolveUrlProxy.
  const inheritedProxy = splitUrlProxy(globalWebviewProxy(generalSettings));
  const [proxyMode, setProxyMode] = useState<UrlProxyMode>(initialProxy.mode);
  const [proxyHost, setProxyHost] = useState(initialProxy.host);
  const [proxyPort, setProxyPort] = useState(initialProxy.port);
  const [dataPartitionDraft, setDataPartitionDraft] = useState(initialConnection?.dataPartition ?? "");
  const [userAgentDraft, setUserAgentDraft] = useState(initialConnection?.urlUserAgent ?? "");
  const displayedProxy = inheritsDefaults ? inheritedProxy : { mode: proxyMode, host: proxyHost, port: proxyPort };
  const displayedDataPartition = inheritsDefaults ? (urlSettings.defaultDataPartition ?? "") : dataPartitionDraft;
  const displayedUserAgent = inheritsDefaults ? (urlSettings.defaultUserAgent ?? "") : userAgentDraft;

  return (
    <fieldset className="connection-session-fields connection-specific-options">
      <legend>{t("connections.urlOptions")}</legend>
      <div className="connection-specific-options-panel">
        <label className="connection-session-toggle">
          <Settings2 className="option-glyph" size={17} aria-hidden />
          <span>{t("connections.inheritSettingsDefaults")}</span>
          <input
            checked={inheritsDefaults}
            name="urlProxyInheritDefaults"
            onChange={(event) => setInheritsDefaults(event.currentTarget.checked)}
            type="checkbox"
          />
        </label>
        <div className="connection-option-fields">
          <label className="connection-proxy-row">
            <Database className="option-glyph" size={17} aria-hidden />
            <span>{t("connections.dataPartition")}</span>
            <input
              {...technicalInputProps}
              disabled={inheritsDefaults}
              name="dataPartition"
              onChange={(event) => setDataPartitionDraft(event.currentTarget.value)}
              placeholder={t("connections.default")}
              value={displayedDataPartition}
            />
          </label>
          <label className="connection-proxy-row">
            <span>{t("settings.urlUserAgent")}</span>
            <input
              {...technicalInputProps}
              disabled={inheritsDefaults}
              list="connection-url-user-agent-presets"
              name="urlUserAgent"
              onChange={(event) => setUserAgentDraft(event.currentTarget.value)}
              placeholder={t("settings.urlUserAgentDefaultPlaceholder")}
              value={displayedUserAgent}
            />
          </label>
          <datalist id="connection-url-user-agent-presets">
            {COMMON_URL_USER_AGENTS.map((preset) => (
              <option key={preset.id} label={t(preset.labelKey)} value={preset.value} />
            ))}
          </datalist>
          <label className="connection-proxy-row">
            <span>{t("settings.urlProxyMode")}</span>
            <select
              disabled={inheritsDefaults}
              name="urlProxyMode"
              onChange={(event) => setProxyMode(event.currentTarget.value as UrlProxyMode)}
              value={displayedProxy.mode}
            >
              <option value="direct">{t("settings.urlProxyDirect")}</option>
              <option value="http">{t("settings.urlProxyHttp")}</option>
              <option value="socks5">{t("settings.urlProxySocks5")}</option>
            </select>
          </label>
          <label className="connection-proxy-row">
            <span>{t("settings.urlProxyHost")}</span>
            <input
              {...technicalInputProps}
              disabled={inheritsDefaults || displayedProxy.mode === "direct"}
              name="urlProxyHost"
              onChange={(event) => setProxyHost(event.currentTarget.value)}
              placeholder={t("settings.urlProxyHostPlaceholder")}
              required={!inheritsDefaults && displayedProxy.mode !== "direct"}
              value={displayedProxy.host}
            />
          </label>
          <label className="connection-proxy-row">
            <span>{t("settings.urlProxyPort")}</span>
            <input
              {...technicalInputProps}
              disabled={inheritsDefaults || displayedProxy.mode === "direct"}
              inputMode="numeric"
              max={65535}
              min={1}
              name="urlProxyPort"
              onChange={(event) => setProxyPort(event.currentTarget.value)}
              placeholder={displayedProxy.mode === "socks5" ? "1080" : "3128"}
              required={!inheritsDefaults && displayedProxy.mode !== "direct"}
              type="number"
              value={displayedProxy.port}
            />
          </label>
        </div>
      </div>
    </fieldset>
  );
}
