import { KeyRound, RefreshCw, Trash2 } from "../../lib/reicon";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AI_PROVIDER_SECRET_OWNER_ID,
  aiProviderSecretOwnerId,
} from "../../lib/settings";
import { currentPlatform } from "../../lib/platform";
import { invokeCommand, isTauriRuntime } from "../../lib/tauri";
import { useWorkspaceStore } from "../../store";
import type {
  KeychainStatus,
  SecretStoreKind,
  StoredCredentialKind,
  StoredCredentialSummary,
  UrlCredentialSummary,
} from "../../types";
import { CredentialDeleteConfirmDialog } from "./CredentialDeleteConfirmDialog";
import { EncryptedSecretStoreChangePasswordDialog } from "./EncryptedSecretStoreChangePasswordDialog";
import { EncryptedSecretStoreDialog } from "./EncryptedSecretStoreDialog";
import {
  credentialStorageSelectionAction,
  encryptedDatabaseSecurityReminderKey,
  encryptedSecretStoreInitialMode,
  normalizeAvailableSecretStores,
  normalizeSecretStoreKind,
} from "./credentialStorageModel";
import { groupCredentialsByKind, groupCredentialsForSettings } from "./credentialGroups";
import { SavedCredentialsManager } from "./SavedCredentialsManager";
import { isLegacyConnectionPasswordRow } from "./savedCredentialsModel";
import { SettingsSectionHeader, useSettingsSaveRegistration } from "./shared";
import { UrlCredentialManager } from "./UrlCredentialManager";

function credentialKindKey(kind: StoredCredentialKind) {
  switch (kind) {
    case "connectionPassword":
      return "settings.credentialKindConnectionPassword";
    case "urlPassword":
      return "settings.credentialKindUrlPassword";
    case "aiApiKey":
      return "settings.credentialKindAiApiKey";
    case "emailApiKey":
      return "settings.credentialKindEmailApiKey";
    case "emailSmtpPassword":
      return "settings.credentialKindEmailSmtpPassword";
    case "widgetSecret":
      return "settings.credentialKindWidgetSecret";
    default:
      return "settings.credentialKindConnectionPassword";
  }
}

function credentialDescriptionKey(credential: StoredCredentialSummary) {
  if (!credential.exists) {
    return "settings.credentialMissingSecret";
  }
  switch (credential.kind) {
    case "aiApiKey":
    case "emailApiKey":
      return "settings.credentialSavedApiKey";
    case "emailSmtpPassword":
      return "settings.credentialSavedPassword";
    case "widgetSecret":
      return "settings.credentialSavedSecret";
    case "connectionPassword":
    case "urlPassword":
      return "settings.credentialSavedPassword";
    default:
      return "settings.credentialSavedPassword";
  }
}

export function CredentialsSettings() {
  const { t } = useTranslation();
  const showStatusBarNotice = useWorkspaceStore((state) => state.showStatusBarNotice);
  const credentialSettings = useWorkspaceStore((state) => state.credentialSettings);
  const portableMode = useWorkspaceStore((state) => state.appModeInfo.mode === "portable");
  const setCredentialSettings = useWorkspaceStore((state) => state.setCredentialSettings);
  const aiProviderSettings = useWorkspaceStore((state) => state.aiProviderSettings);
  const setAiProviderHasApiKey = useWorkspaceStore((state) => state.setAiProviderHasApiKey);
  const [credentials, setCredentials] = useState<StoredCredentialSummary[]>([]);
  const [urlCredentials, setUrlCredentials] = useState<UrlCredentialSummary[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<StoredCredentialSummary | null>(null);
  const [draft, setDraft] = useState(credentialSettings);
  const [secretStatus, setSecretStatus] = useState<KeychainStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [encryptedStoreDialogOpen, setEncryptedStoreDialogOpen] = useState(false);
  const [encryptedStoreReset, setEncryptedStoreReset] = useState(false);
  const [encryptedStoreBusy, setEncryptedStoreBusy] = useState(false);
  const [encryptedStoreError, setEncryptedStoreError] = useState<string | null>(null);
  const [changePasswordDialogOpen, setChangePasswordDialogOpen] = useState(false);
  const [changePasswordBusy, setChangePasswordBusy] = useState(false);
  const hasChanges = JSON.stringify(draft) !== JSON.stringify(credentialSettings);

  const { storedCredentials, widgetCredentials } = useMemo(
    () => groupCredentialsForSettings(credentials),
    [credentials],
  );
  const nonUrlStoredCredentials = useMemo(
    () =>
      storedCredentials.filter(
        (credential) => credential.kind !== "urlPassword" && credential.kind !== "connectionPassword",
      ),
    [storedCredentials],
  );
  const legacyConnectionPasswords = useMemo(
    () => storedCredentials.filter(isLegacyConnectionPasswordRow),
    [storedCredentials],
  );
  const storedCredentialGroups = useMemo(
    () => groupCredentialsByKind(nonUrlStoredCredentials),
    [nonUrlStoredCredentials],
  );
  const selectedSecretStore = normalizeSecretStoreKind(draft.secretStore);
  const platform = currentPlatform();
  const securityReminderKey = encryptedDatabaseSecurityReminderKey({
    platform,
    selectedStore: selectedSecretStore,
  });
  const availableSecretStores = useMemo(
    () => normalizeAvailableSecretStores(secretStatus?.availableStores, selectedSecretStore),
    [secretStatus?.availableStores, selectedSecretStore],
  );

  async function load() {
    if (!isTauriRuntime()) {
      setCredentials([]);
      setUrlCredentials([]);
      return;
    }
    setLoading(true);
    try {
      const nextStatus = await invokeCommand("keychain_status", undefined);
      setSecretStatus(nextStatus);
      try {
        const [nextCredentials, nextUrlCredentials] = await Promise.all([
          invokeCommand("list_stored_credentials", undefined),
          invokeCommand("list_url_credentials", undefined),
        ]);
        setCredentials(nextCredentials);
        setUrlCredentials(nextUrlCredentials);
      } catch (error) {
        setCredentials([]);
        setUrlCredentials([]);
        showStatusBarNotice(error instanceof Error ? error.message : String(error), {
          tone: "error",
        });
      }
    } catch (error) {
      showStatusBarNotice(error instanceof Error ? error.message : String(error), { tone: "error" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // Load once on mount; `load` is recreated each render and must not retrigger the effect.
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setDraft(credentialSettings);
  }, [credentialSettings]);

  async function handleSave() {
    try {
      const saved = isTauriRuntime()
        ? await invokeCommand("update_credential_settings", { request: draft })
        : draft;
      setCredentialSettings(saved);
      setDraft(saved);
      showStatusBarNotice(t("settings.credentialStorageSaved"), { tone: "success" });
      await load();
    } catch (error) {
      showStatusBarNotice(error instanceof Error ? error.message : String(error), { tone: "error" });
    }
  }

  useSettingsSaveRegistration({ hasChanges, onSave: handleSave });

  async function configureEncryptedStore(request: {
    password: string;
    createIfMissing: boolean;
    resetExisting?: boolean;
  }) {
    try {
      setEncryptedStoreBusy(true);
      setEncryptedStoreError(null);
      const result = isTauriRuntime()
        ? await invokeCommand("configure_encrypted_file_secret_store", { request })
        : {
            settings: {
              secretStore: "file" as const,
            },
            status: {
              available: true,
              service: "com.kkterm.app",
              backend: t("settings.credentialStorageFile"),
              selectedStore: "file" as const,
              availableStores: ["os" as const, "file" as const],
              encryptedStoreExists: true,
            },
          };
      setCredentialSettings(result.settings);
      setDraft(result.settings);
      setSecretStatus(result.status);
      setEncryptedStoreDialogOpen(false);
      showStatusBarNotice(t("settings.encryptedSecretStoreConfigured"), { tone: "success" });
      await load();
    } catch (error) {
      setEncryptedStoreError(error instanceof Error ? error.message : String(error));
    } finally {
      setEncryptedStoreBusy(false);
    }
  }

  function closeEncryptedStoreDialog() {
    setEncryptedStoreDialogOpen(false);
    setEncryptedStoreReset(false);
    setEncryptedStoreError(null);
  }

  function openEncryptedStoreDialog(resetExisting = false) {
    setEncryptedStoreError(null);
    setEncryptedStoreReset(resetExisting);
    setEncryptedStoreDialogOpen(true);
  }

  async function changeEncryptedStorePassword(request: {
    currentPassword: string;
    newPassword: string;
  }) {
    try {
      setChangePasswordBusy(true);
      const status = isTauriRuntime()
        ? await invokeCommand("change_encrypted_file_secret_store_password", { request })
        : {
            available: true,
            service: "com.kkterm.app",
            backend: t("settings.credentialStorageFile"),
            selectedStore: "file" as const,
            availableStores: ["os" as const, "file" as const],
            encryptedStoreExists: true,
          };
      setSecretStatus(status);
      setChangePasswordDialogOpen(false);
      showStatusBarNotice(t("settings.encryptedSecretStorePasswordChanged"), { tone: "success" });
    } catch (error) {
      showStatusBarNotice(error instanceof Error ? error.message : String(error), { tone: "error" });
    } finally {
      setChangePasswordBusy(false);
    }
  }

  async function deleteCredential(credential: StoredCredentialSummary) {
    try {
      await invokeCommand("delete_stored_credential", {
        request: {
          kind: credential.kind,
          ownerId: credential.ownerId,
        },
      });
      if (credential.kind === "aiApiKey") {
        const [providerPresence, legacyPresence] = await Promise.all([
          invokeCommand("secret_exists", {
            request: {
              kind: "aiApiKey",
              ownerId: aiProviderSecretOwnerId(aiProviderSettings.providerKind),
            },
          }),
          invokeCommand("secret_exists", {
            request: {
              kind: "aiApiKey",
              ownerId: AI_PROVIDER_SECRET_OWNER_ID,
            },
          }),
        ]);
        setAiProviderHasApiKey(providerPresence.exists || legacyPresence.exists);
      }
      if (credential.kind === "urlPassword" || credential.kind === "connectionPassword") {
        window.dispatchEvent(new CustomEvent("kkterm:connection-tree-invalidated"));
      }
      showStatusBarNotice(t("settings.credentialDeleted"), { tone: "success" });
      await load();
    } catch (error) {
      showStatusBarNotice(error instanceof Error ? error.message : String(error), { tone: "error" });
    }
  }

  return (
    <section className="settings-card settings-section">
      <SettingsSectionHeader
        actions={
          <button className="toolbar-button" disabled={loading} onClick={() => void load()} type="button">
            <RefreshCw size={15} />
            {t("common.refresh")}
          </button>
        }
        icon={<KeyRound size={18} />}
        label={t("settings.sectionCredentials")}
        title={t("settings.credentialsTitle")}
      />

      <fieldset
        className="settings-subsection settings-fieldset"
        data-tutorial-id="settings.credentialStorage"
      >
        <legend>{t("settings.credentialStorage")}</legend>
        <p className="field-hint">{t("settings.credentialStorageHint")}</p>
        <div className="form-grid">
          <label>
            <span>{t("settings.credentialStorageBackend")}</span>
            <select
              disabled={availableSecretStores.length <= 1}
              onChange={(event) => {
                const secretStore = normalizeSecretStoreKind(event.currentTarget.value);
                if (
                  credentialStorageSelectionAction({
                    currentStore: normalizeSecretStoreKind(credentialSettings.secretStore),
                    nextStore: secretStore,
                    secretStatus,
                  }) === "setup-file"
                ) {
                  openEncryptedStoreDialog();
                  return;
                }
                setDraft((settings) => ({
                  ...settings,
                  secretStore,
                }));
              }}
              value={selectedSecretStore}
            >
              {availableSecretStores.map((store) => (
                <option key={store} value={store}>
                  {t(secretStoreLabelKey(store, portableMode))}
                </option>
              ))}
            </select>
            <small className="field-hint">
              {secretStatus?.available
                ? t("settings.credentialStorageActive", { backend: secretStatus.backend })
                : t("settings.credentialStorageUnavailable", {
                    error: secretStatus?.backend ?? t("settings.credentialStorageUnknownStatus"),
                  })}
            </small>
          </label>
          {selectedSecretStore === "file" ? (
            <div className="encrypted-secret-store-settings-actions">
              {secretStatus?.encryptedStoreExists ? (
                <>
                  {!secretStatus.available ? (
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => openEncryptedStoreDialog()}
                    >
                      {t("settings.encryptedSecretStoreUnlockAction")}
                    </button>
                  ) : null}
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => setChangePasswordDialogOpen(true)}
                  >
                    {t("settings.encryptedSecretStoreChangePasswordAction")}
                  </button>
                  <button
                    className="secondary-button danger"
                    type="button"
                    onClick={() => openEncryptedStoreDialog(true)}
                  >
                    {t("settings.encryptedSecretStoreResetAction")}
                  </button>
                </>
              ) : (
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => openEncryptedStoreDialog()}
                >
                  {t("settings.encryptedSecretStoreSetupAction")}
                </button>
              )}
            </div>
          ) : null}
        </div>
        <p className="field-hint settings-security-note">{t(securityReminderKey)}</p>
        {portableMode && selectedSecretStore === "os" ? (
          <p className="kk-dlg-warn">{t("settings.portableCredentialStorageOsWarning")}</p>
        ) : null}
        <p className="field-hint">{t("settings.credentialStorageSwitchNote")}</p>
      </fieldset>

      <fieldset
        className="settings-subsection settings-fieldset"
        data-tutorial-id="settings.credentialsStored"
      >
        <legend>{t("settings.credentialsStored")}</legend>
        <p className="field-hint">{t("settings.credentialsHint")}</p>
        <div className="settings-list" aria-label={t("settings.credentialsStored")}>
          <SavedCredentialsManager
            legacyCredentials={legacyConnectionPasswords}
            onChanged={load}
            onDeleteLegacy={setDeleteTarget}
          />
          <div className="settings-credential-group">
            <h3>{t("settings.savedWebsitePasswords")}</h3>
            {loading && urlCredentials.length === 0 ? (
              <p className="settings-empty-state">{t("common.loading")}</p>
            ) : (
              <UrlCredentialManager credentials={urlCredentials} onChanged={load} />
            )}
          </div>
          {storedCredentialGroups.map(({ kind, rows }) => (
            <div className="settings-credential-group" key={kind}>
              <h3>{t(credentialKindKey(kind))}</h3>
              <CredentialGrid
                ariaLabel={t(credentialKindKey(kind))}
                credentials={rows}
                onDelete={setDeleteTarget}
              />
            </div>
          ))}
        </div>
      </fieldset>

      <fieldset
        className="settings-subsection settings-fieldset"
        data-tutorial-id="settings.widgetCredentialsStored"
      >
        <legend>{t("settings.widgetCredentialsStored")}</legend>
        <p className="field-hint">{t("settings.widgetCredentialsHint")}</p>
        {widgetCredentials.length === 0 ? (
          <p className="settings-empty-state">
            {loading ? t("common.loading") : t("settings.widgetCredentialsEmpty")}
          </p>
        ) : (
          <CredentialGrid
            ariaLabel={t("settings.widgetCredentialsStored")}
            credentials={widgetCredentials}
            onDelete={setDeleteTarget}
          />
        )}
      </fieldset>

      {deleteTarget ? (
        <CredentialDeleteConfirmDialog
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => {
            const credential = deleteTarget;
            setDeleteTarget(null);
            void deleteCredential(credential);
          }}
        />
      ) : null}
      {encryptedStoreDialogOpen ? (
        <EncryptedSecretStoreDialog
          busy={encryptedStoreBusy}
          encryptedStoreExists={secretStatus?.encryptedStoreExists}
          error={encryptedStoreError}
          initialMode={
            encryptedStoreReset
              ? "create"
              : encryptedSecretStoreInitialMode({
                  encryptedStoreExists: secretStatus?.encryptedStoreExists,
                })
          }
          initialResetExisting={encryptedStoreReset}
          launchPrompt={false}
          platform={platform}
          onCancel={closeEncryptedStoreDialog}
          onSubmit={configureEncryptedStore}
        />
      ) : null}
      {changePasswordDialogOpen ? (
        <EncryptedSecretStoreChangePasswordDialog
          busy={changePasswordBusy}
          onCancel={() => setChangePasswordDialogOpen(false)}
          onSubmit={changeEncryptedStorePassword}
        />
      ) : null}
    </section>
  );
}

function secretStoreLabelKey(store: SecretStoreKind, portableMode = false) {
  switch (store) {
    case "file":
      return portableMode
        ? "settings.credentialStorageFilePortable"
        : "settings.credentialStorageFile";
    case "os":
    default:
      return "settings.credentialStorageOs";
  }
}

function CredentialGrid({
  ariaLabel,
  credentials,
  onDelete,
}: {
  ariaLabel: string;
  credentials: StoredCredentialSummary[];
  onDelete: (credential: StoredCredentialSummary) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="settings-secret-credential-grid" role="grid" aria-label={ariaLabel}>
      <div className="settings-secret-credential-grid-header" role="row">
        <span role="columnheader">{t("settings.credentialColumnName")}</span>
        <span role="columnheader">{t("settings.credentialColumnDetails")}</span>
        <span role="columnheader">{t("settings.credentialColumnStatus")}</span>
        <span aria-hidden="true" />
      </div>
      {credentials.map((credential) => (
        <div className="settings-secret-credential-grid-row" key={credential.id} role="row">
          <div className="settings-secret-credential-grid-cell" role="gridcell">
            <strong title={credential.label}>{credential.label}</strong>
          </div>
          <div className="settings-secret-credential-grid-cell" role="gridcell">
            <span title={credential.detail ?? undefined}>{credential.detail || "—"}</span>
          </div>
          <div className="settings-secret-credential-grid-cell" role="gridcell">
            <span>{t(credentialDescriptionKey(credential))}</span>
          </div>
          <div className="settings-secret-credential-grid-actions" role="gridcell">
            <button
              aria-label={t("settings.deleteCredential")}
              className="settings-icon-danger-button"
              type="button"
              onClick={() => void onDelete(credential)}
            >
              <Trash2 size={16} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
