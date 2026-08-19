import { Clipboard, HardDrive, Layers, Monitor, Palette, Printer, Scaling, Settings2, Shield, Zap } from "../../../../lib/reicon";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { technicalInputProps } from "../../../../lib/inputBehavior";
import { isWindowsPlatform } from "../../../../lib/platform";
import {
  RDP_REMOTE_RESOLUTION_FIXED,
  type Connection,
  type RdpSettings,
  type SshSettings,
  type StoredCredentialSummary,
} from "../../../../types";
import { defaultPortForConnectionType } from "../utils";
import { PasswordCredentialModeFields } from "./ConnectionPasswordFields";
import { RdpLocalResourceSelector } from "../remote-desktop/RdpLocalResourceSelector";
import { normalizeRdpDriveSelection, normalizeRdpSharedLocalFolders } from "../remote-desktop/rdpLocalResources";

export function RdpConnectionFields({
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
            key="port-rdp"
            name="port"
            onChange={(event) => onPortDraftChange(event.currentTarget.value)}
            value={portDraft}
            inputMode="numeric"
            min="1"
            max="65535"
            type="number"
            placeholder={String(defaultPortForConnectionType("rdp", sshSettings))}
          />
        </label>
      </div>
      <div className="connection-auth-fields">
        <label>
          <span>{`${t("connections.user")}*`}</span>
          <input
            key="user-rdp"
            name="user"
            {...technicalInputProps}
            defaultValue={initialConnection?.user ?? ""}
            placeholder={t("connections.domainAdmin")}
            required
          />
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

export function RdpConnectionOptions({
  initialConnection,
  onInheritsSettingsDefaultsChange,
  rdpInheritsSettingsDefaults,
  rdpSettings,
}: {
  initialConnection?: Connection;
  onInheritsSettingsDefaultsChange: (inheritsSettingsDefaults: boolean) => void;
  rdpInheritsSettingsDefaults: boolean;
  rdpSettings: RdpSettings;
}) {
  const { t } = useTranslation();
  const [redirectDrives, setRedirectDrives] = useState(
    initialConnection?.rdpOptions?.redirectDrives ?? rdpSettings.redirectDrives,
  );
  const [driveSelection, setDriveSelection] = useState(() =>
    normalizeRdpDriveSelection(initialConnection?.rdpOptions?.driveSelection ?? rdpSettings.driveSelection),
  );
  const [sharedLocalFolders, setSharedLocalFolders] = useState(() => normalizeRdpSharedLocalFolders(
    initialConnection?.rdpOptions?.sharedLocalFolders ?? rdpSettings.sharedLocalFolders,
    initialConnection?.rdpOptions?.sharedLocalFolder ?? rdpSettings.sharedLocalFolder,
  ));
  const effectiveRedirectDrives = rdpInheritsSettingsDefaults ? rdpSettings.redirectDrives : redirectDrives;
  const effectiveDriveSelection = rdpInheritsSettingsDefaults
    ? normalizeRdpDriveSelection(rdpSettings.driveSelection)
    : driveSelection;
  const effectiveSharedLocalFolders = rdpInheritsSettingsDefaults
    ? normalizeRdpSharedLocalFolders(rdpSettings.sharedLocalFolders, rdpSettings.sharedLocalFolder)
    : sharedLocalFolders;
  const usesWindowsDriveMapping = isWindowsPlatform();
  // Printer redirection is an RDP ActiveX property; the macOS/Linux IronRDP
  // canvas path has no printer backend, so the toggle would be a no-op there.
  const supportsPrinterRedirection = isWindowsPlatform();
  const effectiveRedirectPrinters = rdpInheritsSettingsDefaults
    ? rdpSettings.redirectPrinters
    : initialConnection?.rdpOptions?.redirectPrinters ?? rdpSettings.redirectPrinters;

  return (
      <fieldset className="connection-session-fields connection-specific-options">
        <legend>{t("connections.rdpOptions")}</legend>
        <div className="connection-specific-options-panel">
          <label className="connection-session-toggle">
            <Settings2 className="option-glyph" size={17} aria-hidden />
            <span>{t("connections.inheritSettingsDefaults")}</span>
            <input
              name="rdpInheritDefaults"
              type="checkbox"
              checked={rdpInheritsSettingsDefaults}
              onChange={(event) => onInheritsSettingsDefaultsChange(event.currentTarget.checked)}
            />
          </label>
          <div className="connection-option-fields">
            <label>
              <Palette className="option-glyph" size={17} aria-hidden />
              <span>{t("settings.colorDepth")}</span>
              <select
                disabled={rdpInheritsSettingsDefaults}
                name="rdpColorDepth"
                defaultValue={initialConnection?.rdpOptions?.colorDepth ?? rdpSettings.colorDepth}
              >
                <option value={32}>{t("settings.rdpColorDepth32")}</option>
                <option value={24}>{t("settings.rdpColorDepth24")}</option>
                <option value={16}>{t("settings.rdpColorDepth16")}</option>
                <option value={15}>{t("settings.rdpColorDepth15")}</option>
              </select>
            </label>
            <label>
              <Zap className="option-glyph" size={17} aria-hidden />
              <span>{t("settings.performanceFlags")}</span>
              <select
                disabled={rdpInheritsSettingsDefaults}
                name="rdpPerformanceProfile"
                defaultValue={initialConnection?.rdpOptions?.performanceProfile ?? rdpSettings.performanceProfile}
              >
                <option value="balanced">{t("settings.rdpPerformanceBalanced")}</option>
                <option value="quality">{t("settings.rdpPerformanceQuality")}</option>
                <option value="speed">{t("settings.rdpPerformanceSpeed")}</option>
              </select>
            </label>
            <label>
              <Scaling className="option-glyph" size={17} aria-hidden />
              <span>{t("settings.remoteDesktopViewMode")}</span>
              <select
                disabled={rdpInheritsSettingsDefaults}
                name="rdpViewMode"
                defaultValue={initialConnection?.rdpOptions?.viewMode ?? rdpSettings.viewMode}
              >
                <option value="fit">{t("settings.remoteDesktopViewModeFit")}</option>
                <option value="stretch">{t("settings.remoteDesktopViewModeStretch")}</option>
                <option value="actualSize">{t("settings.remoteDesktopViewModeActualSize")}</option>
                <option value="fitWidth">{t("settings.remoteDesktopViewModeFitWidth")}</option>
                <option value="fitHeight">{t("settings.remoteDesktopViewModeFitHeight")}</option>
              </select>
            </label>
            <label>
              <Monitor className="option-glyph" size={17} aria-hidden />
              <span>{t("settings.rdpRemoteResolution")}</span>
              <select
                disabled={rdpInheritsSettingsDefaults}
                name="rdpRemoteResolution"
                defaultValue={initialConnection?.rdpOptions?.remoteResolution ?? rdpSettings.remoteResolution}
              >
                <option value="automatic">{t("settings.rdpRemoteResolutionAutomatic")}</option>
                {RDP_REMOTE_RESOLUTION_FIXED.map((value) => (
                  <option key={value} value={value}>
                    {value.replace("x", "×")}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="connection-session-fields">
            <label className="connection-session-toggle">
              <Shield className="option-glyph" size={17} aria-hidden />
              <span>{t("settings.rdpAdministrativeSession")}</span>
              <input
                disabled={rdpInheritsSettingsDefaults}
                name="rdpAdministrativeSession"
                type="checkbox"
                defaultChecked={
                  initialConnection?.rdpOptions?.administrativeSession ?? rdpSettings.administrativeSession
                }
              />
            </label>
            <label className="connection-session-toggle">
              <Clipboard className="option-glyph" size={17} aria-hidden />
              <span>{t("settings.rdpRedirectClipboard")}</span>
              <input
                disabled={rdpInheritsSettingsDefaults}
                name="rdpRedirectClipboard"
                type="checkbox"
                defaultChecked={initialConnection?.rdpOptions?.redirectClipboard ?? rdpSettings.redirectClipboard}
              />
            </label>
            <div className="rdp-connection-local-resource">
              <label className="connection-session-toggle">
                <HardDrive className="option-glyph" size={17} aria-hidden />
                <span>
                  {t(usesWindowsDriveMapping ? "settings.rdpRedirectDrives" : "settings.rdpShareLocalFolders")}
                </span>
                <input
                  checked={effectiveRedirectDrives}
                  disabled={rdpInheritsSettingsDefaults}
                  name="rdpRedirectDrives"
                  onChange={(event) => setRedirectDrives(event.currentTarget.checked)}
                  type="checkbox"
                />
              </label>
              <input name="rdpDriveSelection" type="hidden" value={JSON.stringify(effectiveDriveSelection)} />
              <input name="rdpSharedLocalFolders" type="hidden" value={JSON.stringify(effectiveSharedLocalFolders)} />
              {effectiveRedirectDrives ? (
                <RdpLocalResourceSelector
                  disabled={rdpInheritsSettingsDefaults}
                  driveSelection={effectiveDriveSelection}
                  sharedLocalFolders={effectiveSharedLocalFolders}
                  onDriveSelectionChange={setDriveSelection}
                  onSharedLocalFoldersChange={setSharedLocalFolders}
                />
              ) : null}
            </div>
            {supportsPrinterRedirection ? (
              <label className="connection-session-toggle">
                <Printer className="option-glyph" size={17} aria-hidden />
                <span>{t("settings.rdpRedirectPrinters")}</span>
                <input
                  disabled={rdpInheritsSettingsDefaults}
                  name="rdpRedirectPrinters"
                  type="checkbox"
                  defaultChecked={initialConnection?.rdpOptions?.redirectPrinters ?? rdpSettings.redirectPrinters}
                />
              </label>
            ) : (
              // Keep a Windows-only override intact when the Connection is edited
              // on macOS or Linux, where the toggle is not rendered.
              <input
                name="rdpRedirectPrinters"
                type="hidden"
                value={effectiveRedirectPrinters ? "on" : ""}
              />
            )}
            <label className="connection-session-toggle">
              <Layers className="option-glyph" size={17} aria-hidden />
              <span>{t("settings.bitmapCache")}</span>
              <input
                disabled={rdpInheritsSettingsDefaults}
                name="rdpBitmapCache"
                type="checkbox"
                defaultChecked={initialConnection?.rdpOptions?.bitmapCache ?? rdpSettings.bitmapCache}
              />
            </label>
          </div>
        </div>
      </fieldset>
  );
}
