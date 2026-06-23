import { useState } from "react";
import { Fingerprint, KeyRound, Layers, LockKeyhole, Settings2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { technicalInputProps } from "../../../../lib/inputBehavior";
import type { Connection, SshCompressionMode, SshSettings, StoredCredentialSummary } from "../../../../types";
import { defaultPortForConnectionType } from "../utils";
import { PasswordCredentialSelect, PasswordField } from "./ConnectionPasswordFields";

export function SshConnectionFields({
  authMethod,
  hasStoredConnectionPassword,
  hasStoredConnectionPassphrase,
  initialConnection,
  isEditMode,
  keyPassphraseDraft,
  keyPath,
  matchingPasswordCredentials,
  onAuthMethodChange,
  onBrowseKeyFile,
  onBrowseRemoteStartupDirectory,
  onKeyPathChange,
  onOpenKeyEmailDialog,
  onPortDraftChange,
  onSelectedPasswordCredentialIdChange,
  onStartupDirectoryChange,
  portDraft,
  selectedPasswordCredentialId,
  sshSettings,
  startupDirectory,
}: {
  authMethod: "keyFile" | "password" | "agent";
  hasStoredConnectionPassword: boolean;
  hasStoredConnectionPassphrase: boolean;
  initialConnection?: Connection;
  isEditMode: boolean;
  keyPassphraseDraft: string;
  keyPath: string;
  matchingPasswordCredentials: StoredCredentialSummary[];
  onAuthMethodChange: (authMethod: "keyFile" | "password" | "agent") => void;
  onBrowseKeyFile: () => void;
  onBrowseRemoteStartupDirectory: () => void;
  onKeyPathChange: (keyPath: string) => void;
  onOpenKeyEmailDialog: () => void;
  onPortDraftChange: (port: string) => void;
  onSelectedPasswordCredentialIdChange: (credentialId: string) => void;
  onStartupDirectoryChange: (directory: string) => void;
  portDraft: string;
  selectedPasswordCredentialId: string;
  sshSettings: SshSettings;
  startupDirectory: string;
}) {
  const { t } = useTranslation();

  return (
    <>
      <label>
        <span>{t("connections.nameOptional")}</span>
        <input name="name" defaultValue={initialConnection?.name ?? ""} placeholder={t("connections.connectionName")} />
      </label>

      <div className="connection-endpoint-fields">
        <label className="endpoint-host-input">
          <span>{t("connections.host")}*</span>
          <input
            name="host"
            {...technicalInputProps}
            defaultValue={initialConnection?.host ?? ""}
            placeholder={t("connections.exampleHost")}
            required
          />
        </label>
        <label className="endpoint-port-input">
          <span>{t("connections.port")}</span>
          <input
            key="port-ssh"
            name="port"
            onChange={(event) => onPortDraftChange(event.currentTarget.value)}
            value={portDraft}
            inputMode="numeric"
            min="1"
            max="65535"
            type="number"
            placeholder={String(defaultPortForConnectionType("ssh", sshSettings))}
          />
        </label>
      </div>

      <div className="connection-auth-fields">
        <label className="auth-user-input">
          <span>{`${t("connections.user")}*`}</span>
          <input
            key="user-ssh"
            name="user"
            {...technicalInputProps}
            defaultValue={initialConnection?.user ?? sshSettings.defaultUser}
            placeholder={t("connections.admin")}
            required
          />
        </label>
        <div className="auth-mode-row">
          <span id="ssh-auth-method-label">{t("connections.auth")}*</span>
          <input name="authMethod" type="hidden" value={authMethod} />
          <div
            className="auth-method-selector"
            data-auth-method={authMethod}
            role="tablist"
            aria-label={t("connections.auth")}
            aria-labelledby="ssh-auth-method-label"
          >
            <button
              type="button"
              role="tab"
              aria-selected={authMethod === "keyFile"}
              className={authMethod === "keyFile" ? "active" : ""}
              onClick={() => onAuthMethodChange("keyFile")}
            >
              <KeyRound size={15} aria-hidden />
              <span>{t("connections.keyFile")}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={authMethod === "password"}
              className={authMethod === "password" ? "active" : ""}
              onClick={() => onAuthMethodChange("password")}
            >
              <LockKeyhole size={15} aria-hidden />
              <span>{t("connections.password")}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={authMethod === "agent"}
              className={authMethod === "agent" ? "active" : ""}
              onClick={() => onAuthMethodChange("agent")}
            >
              <Fingerprint size={15} aria-hidden />
              <span>{t("connections.sshAgent")}</span>
            </button>
          </div>
        </div>
        {authMethod === "password" ? (
          <>
            <PasswordField
              hasStoredSecret={isEditMode && hasStoredConnectionPassword}
              label={t("connections.passwordLabel")}
              name="password"
              placeholder={isEditMode ? t("connections.leaveBlankPassword") : t("connections.passwordOptionalHint")}
            />
            <PasswordCredentialSelect
              credentials={matchingPasswordCredentials}
              onChange={onSelectedPasswordCredentialIdChange}
              selectedCredentialId={selectedPasswordCredentialId}
            />
          </>
        ) : authMethod === "keyFile" ? (
          <>
            <label>
              <span>{t("connections.keyPath")}</span>
              <div className="input-with-button ssh-key-input-actions">
                <input
                  name="keyPath"
                  {...technicalInputProps}
                  onChange={(event) => onKeyPathChange(event.currentTarget.value)}
                  placeholder={t("connections.keyPathExample")}
                  value={keyPath}
                />
                <button className="toolbar-button" onClick={onBrowseKeyFile} type="button">
                  {t("connections.browse")}
                </button>
                <button className="toolbar-button" onClick={onOpenKeyEmailDialog} type="button">
                  <KeyRound size={15} />
                  {t("settings.generateSshKey")}
                </button>
              </div>
            </label>
            <PasswordField
              hasStoredSecret={isEditMode && hasStoredConnectionPassphrase}
              initialValue={keyPassphraseDraft}
              label={t("connections.keyPassphraseOptional")}
              name="keyPassphrase"
              placeholder={isEditMode ? t("connections.leaveBlankPassphrase") : t("connections.keyPassphraseHint")}
            />
          </>
        ) : null}
        <label>
          <span>{t("connections.sshStartupDirectory")}</span>
          <div className="input-with-button">
            <input
              name="localStartupDirectory"
              {...technicalInputProps}
              onChange={(event) => onStartupDirectoryChange(event.currentTarget.value)}
              placeholder={t("connections.sshStartupDirectoryPlaceholder")}
              value={startupDirectory}
            />
            <button className="toolbar-button" onClick={onBrowseRemoteStartupDirectory} type="button">
              {t("connections.browse")}
            </button>
          </div>
        </label>
      </div>
    </>
  );
}


export function SshConnectionOptions({
  initialConnection,
  onInheritsSettingsDefaultsChange,
  sshInheritsSettingsDefaults,
  sshSettings,
}: {
  initialConnection?: Connection;
  onInheritsSettingsDefaultsChange: (inheritsSettingsDefaults: boolean) => void;
  sshInheritsSettingsDefaults: boolean;
  sshSettings: SshSettings;
}) {
  const { t } = useTranslation();
  const [sshSocksProxyDraft, setSshSocksProxyDraft] = useState(
    initialConnection?.sshSocksProxy ?? sshSettings.defaultSshSocksProxy ?? "",
  );
  const [sshSocksProxyUsernameDraft, setSshSocksProxyUsernameDraft] = useState(
    initialConnection?.sshSocksProxyUsername ?? sshSettings.defaultSshSocksProxyUsername ?? "",
  );
  const [proxyJumpDraft, setProxyJumpDraft] = useState(
    initialConnection?.proxyJump ?? sshSettings.defaultProxyJump ?? "",
  );
  const [useTmuxSessionsDraft, setUseTmuxSessionsDraft] = useState(
    initialConnection?.useTmuxSessions ?? sshSettings.defaultUseTmuxSessions,
  );
  const [sshCompressionDraft, setSshCompressionDraft] = useState<SshCompressionMode>(
    initialConnection?.sshCompression ?? sshSettings.defaultSshCompression ?? "fast",
  );
  const displayedSshSocksProxy = sshInheritsSettingsDefaults
    ? sshSettings.defaultSshSocksProxy ?? ""
    : sshSocksProxyDraft;
  const displayedSshSocksProxyUsername = sshInheritsSettingsDefaults
    ? sshSettings.defaultSshSocksProxyUsername ?? ""
    : sshSocksProxyUsernameDraft;
  const displayedProxyJump = sshInheritsSettingsDefaults ? sshSettings.defaultProxyJump ?? "" : proxyJumpDraft;
  const displayedUseTmuxSessions = sshInheritsSettingsDefaults
    ? sshSettings.defaultUseTmuxSessions
    : useTmuxSessionsDraft;
  const displayedSshCompression = sshInheritsSettingsDefaults
    ? sshSettings.defaultSshCompression ?? "fast"
    : sshCompressionDraft;
  const hasProxyJumpOverride = !sshInheritsSettingsDefaults && proxyJumpDraft.trim().length > 0;
  const hasSocksProxyOverride = !sshInheritsSettingsDefaults && sshSocksProxyDraft.trim().length > 0;
  const hasDisplayedSocksProxy = displayedSshSocksProxy.trim().length > 0;

  return (
    <fieldset className="connection-session-fields connection-specific-options">
      <legend>{t("connections.sshOptions")}</legend>
      <div className="connection-specific-options-panel">
        <label className="connection-session-toggle">
          <Settings2 className="option-glyph" size={17} aria-hidden />
          <span>{t("connections.inheritSettingsDefaults")}</span>
          <input
            name="sshSocksProxyInheritDefaults"
            type="checkbox"
            checked={sshInheritsSettingsDefaults}
            onChange={(event) => onInheritsSettingsDefaultsChange(event.currentTarget.checked)}
          />
        </label>
        <div className="connection-option-fields">
          <label className="connection-proxy-row">
            <span>{t("connections.sshSocksProxyOptional")}</span>
            <input
              disabled={sshInheritsSettingsDefaults || hasProxyJumpOverride}
              name="sshSocksProxy"
              onChange={(event) => setSshSocksProxyDraft(event.currentTarget.value)}
              placeholder={t("settings.sshSocksProxyPlaceholder")}
              value={displayedSshSocksProxy}
            />
          </label>
          <label className="connection-proxy-row">
            <span>{t("connections.sshSocksProxyUsernameOptional")}</span>
            <input
              autoComplete="username"
              disabled={sshInheritsSettingsDefaults || hasProxyJumpOverride || !hasDisplayedSocksProxy}
              name="sshSocksProxyUsername"
              onChange={(event) => setSshSocksProxyUsernameDraft(event.currentTarget.value)}
              value={displayedSshSocksProxyUsername}
            />
          </label>
          <label className="connection-proxy-row">
            <span>{t("connections.sshSocksProxyPasswordOptional")}</span>
            <input
              autoComplete="new-password"
              disabled={sshInheritsSettingsDefaults || hasProxyJumpOverride || !hasDisplayedSocksProxy}
              name="sshSocksProxyPassword"
              placeholder={t("connections.sshSocksProxyPasswordPlaceholder")}
              type="password"
            />
          </label>
          <label className="connection-proxy-row">
            <span>{t("connections.proxyJumpOptional")}</span>
            <input
              disabled={sshInheritsSettingsDefaults || hasSocksProxyOverride}
              name="proxyJump"
              onChange={(event) => setProxyJumpDraft(event.currentTarget.value)}
              placeholder={t("connections.jumpInternal")}
              value={displayedProxyJump}
            />
          </label>
        </div>
        <label className="connection-proxy-row">
          <span>{t("connections.sshCompression")}</span>
          <select
            disabled={sshInheritsSettingsDefaults}
            name="sshCompression"
            onChange={(event) => setSshCompressionDraft(event.currentTarget.value as SshCompressionMode)}
            value={displayedSshCompression}
          >
            <option value="fast">{t("settings.sshCompressionFast")}</option>
            <option value="off">{t("settings.sshCompressionOff")}</option>
          </select>
        </label>
        <label className="connection-session-toggle">
          <Layers className="option-glyph" size={17} aria-hidden />
          <span>{t("connections.useTmux")}</span>
          <input
            checked={displayedUseTmuxSessions}
            disabled={sshInheritsSettingsDefaults}
            name="useTmuxSessions"
            onChange={(event) => setUseTmuxSessionsDraft(event.currentTarget.checked)}
            type="checkbox"
          />
        </label>
      </div>
    </fieldset>
  );
}
