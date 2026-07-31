import { Binary, Eye, Palette, Scaling, Settings2, Users } from "../../../../lib/reicon";
import { useTranslation } from "react-i18next";
import { technicalInputProps } from "../../../../lib/inputBehavior";
import type { Connection, SshSettings, StoredCredentialSummary, VncSettings } from "../../../../types";
import { defaultPortForConnectionType } from "../utils";
import { PasswordCredentialModeFields } from "./ConnectionPasswordFields";

export function VncConnectionFields({
  hasStoredConnectionPassword,
  initialConnection,
  isEditMode,
  matchingPasswordCredentials,
  onPortDraftChange,
  onSelectedPasswordCredentialIdChange,
  portDraft,
  selectedPasswordCredentialId,
  sshSettings,
}: {
  hasStoredConnectionPassword: boolean;
  initialConnection?: Connection;
  isEditMode: boolean;
  matchingPasswordCredentials: StoredCredentialSummary[];
  onPortDraftChange: (port: string) => void;
  onSelectedPasswordCredentialIdChange: (credentialId: string) => void;
  portDraft: string;
  selectedPasswordCredentialId: string;
  sshSettings: SshSettings;
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
            key="port-vnc"
            name="port"
            onChange={(event) => onPortDraftChange(event.currentTarget.value)}
            value={portDraft}
            inputMode="numeric"
            min="1"
            max="65535"
            type="number"
            placeholder={String(defaultPortForConnectionType("vnc", sshSettings))}
          />
        </label>
      </div>
      <div className="connection-auth-fields">
        <label>
          <span>{t("connections.vncUsername")}</span>
          <input
            key="user-vnc"
            name="user"
            {...technicalInputProps}
            defaultValue={initialConnection?.user ?? ""}
            placeholder={t("connections.optionalUsername")}
          />
          <small className="field-hint">{t("connections.vncUsernameHint")}</small>
        </label>
        <PasswordCredentialModeFields
          credentials={matchingPasswordCredentials}
          defaultMode={initialConnection?.passwordCredentialId ? "saved" : "new"}
          hasStoredSecret={isEditMode && hasStoredConnectionPassword}
          label={t("connections.password")}
          placeholder={isEditMode ? t("connections.leaveBlankPassword") : t("connections.storedInKeychain")}
          selectedCredentialId={selectedPasswordCredentialId}
          onSelectedCredentialIdChange={onSelectedPasswordCredentialIdChange}
        />
      </div>
    </>
  );
}

export function VncConnectionOptions({
  initialConnection,
  onInheritsSettingsDefaultsChange,
  vncInheritsSettingsDefaults,
  vncSettings,
}: {
  initialConnection?: Connection;
  onInheritsSettingsDefaultsChange: (inheritsSettingsDefaults: boolean) => void;
  vncInheritsSettingsDefaults: boolean;
  vncSettings: VncSettings;
}) {
  const { t } = useTranslation();

  return (
      <fieldset className="connection-session-fields connection-specific-options">
        <legend>{t("connections.vncOptions")}</legend>
        <div className="connection-specific-options-panel">
          <label className="connection-session-toggle">
            <Settings2 className="option-glyph" size={17} aria-hidden />
            <span>{t("connections.inheritSettingsDefaults")}</span>
            <input
              name="vncInheritDefaults"
              type="checkbox"
              checked={vncInheritsSettingsDefaults}
              onChange={(event) => onInheritsSettingsDefaultsChange(event.currentTarget.checked)}
            />
          </label>
          <div className="connection-option-fields">
            <label>
              <Binary className="option-glyph" size={17} aria-hidden />
              <span>{t("settings.vncPerformancePreset")}</span>
              <select
                disabled={vncInheritsSettingsDefaults}
                name="vncPerformancePreset"
                defaultValue={initialConnection?.vncOptions?.performancePreset ?? vncSettings.performancePreset}
              >
                <option value="auto">{t("settings.vncPresetAuto")}</option>
                <option value="lan">{t("settings.vncPresetLan")}</option>
                <option value="balanced">{t("settings.vncPresetBalanced")}</option>
                <option value="lowBandwidth">{t("settings.vncPresetLowBandwidth")}</option>
                <option value="lossless">{t("settings.vncPresetLossless")}</option>
                <option value="custom">{t("settings.vncPresetCustom")}</option>
              </select>
            </label>
            <label>
              <Scaling className="option-glyph" size={17} aria-hidden />
              <span>{t("settings.remoteDesktopViewMode")}</span>
              <select
                disabled={vncInheritsSettingsDefaults}
                name="vncViewMode"
                defaultValue={initialConnection?.vncOptions?.viewMode ?? vncSettings.viewMode}
              >
                <option value="fit">{t("settings.remoteDesktopViewModeFit")}</option>
                <option value="stretch">{t("settings.remoteDesktopViewModeStretch")}</option>
                <option value="actualSize">{t("settings.remoteDesktopViewModeActualSize")}</option>
                <option value="fitWidth">{t("settings.remoteDesktopViewModeFitWidth")}</option>
                <option value="fitHeight">{t("settings.remoteDesktopViewModeFitHeight")}</option>
              </select>
            </label>
            <label>
              <Binary className="option-glyph" size={17} aria-hidden />
              <span>{t("settings.vncCompressionLevel")}</span>
              <input
                disabled={vncInheritsSettingsDefaults}
                name="vncCompressionLevel"
                type="number"
                min="0"
                max="9"
                defaultValue={initialConnection?.vncOptions?.compressionLevel ?? vncSettings.compressionLevel}
              />
            </label>
            <label>
              <Binary className="option-glyph" size={17} aria-hidden />
              <span>{t("settings.vncJpegQuality")}</span>
              <input
                disabled={vncInheritsSettingsDefaults}
                name="vncJpegQuality"
                type="number"
                min="0"
                max="9"
                defaultValue={initialConnection?.vncOptions?.jpegQuality ?? vncSettings.jpegQuality}
              />
            </label>
            <label>
              <Binary className="option-glyph" size={17} aria-hidden />
              <span>{t("settings.preferredEncoding")}</span>
              <select
                disabled={vncInheritsSettingsDefaults}
                name="vncPreferredEncoding"
                defaultValue={initialConnection?.vncOptions?.preferredEncoding ?? vncSettings.preferredEncoding}
              >
                <option value="tight">{t("settings.vncEncodingTight")}</option>
                <option value="zrle">{t("settings.vncEncodingZrle")}</option>
                <option value="raw">{t("settings.vncEncodingRaw")}</option>
              </select>
            </label>
            <label>
              <Palette className="option-glyph" size={17} aria-hidden />
              <span>{t("settings.colorLevel")}</span>
              <select
                disabled={vncInheritsSettingsDefaults}
                name="vncColorLevel"
                defaultValue={initialConnection?.vncOptions?.colorLevel ?? vncSettings.colorLevel}
              >
                <option value="full">{t("settings.vncColorFull")}</option>
                <option value="256">{t("settings.vncColor256")}</option>
                <option value="64">{t("settings.vncColor64")}</option>
                <option value="8">{t("settings.vncColor8")}</option>
              </select>
            </label>
          </div>
          <div className="connection-session-fields">
            <label className="connection-session-toggle">
              <Binary className="option-glyph" size={17} aria-hidden />
              <span>{t("settings.vncJpegEnabled")}</span>
              <input
                disabled={vncInheritsSettingsDefaults}
                name="vncJpegEnabled"
                type="checkbox"
                defaultChecked={initialConnection?.vncOptions?.jpegEnabled ?? vncSettings.jpegEnabled}
              />
            </label>
            <label className="connection-session-toggle">
              <Users className="option-glyph" size={17} aria-hidden />
              <span>{t("settings.vncSharedSession")}</span>
              <input
                disabled={vncInheritsSettingsDefaults}
                name="vncSharedSession"
                type="checkbox"
                defaultChecked={initialConnection?.vncOptions?.sharedSession ?? vncSettings.sharedSession}
              />
            </label>
            <label className="connection-session-toggle">
              <Eye className="option-glyph" size={17} aria-hidden />
              <span>{t("settings.vncViewOnly")}</span>
              <input
                disabled={vncInheritsSettingsDefaults}
                name="vncViewOnly"
                type="checkbox"
                defaultChecked={initialConnection?.vncOptions?.viewOnly ?? vncSettings.viewOnly}
              />
            </label>
          </div>
        </div>
      </fieldset>
  );
}
