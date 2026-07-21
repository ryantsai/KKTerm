import { useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  Actions,
  Btn,
  DialogShell,
  Field,
  Sheet,
  TextInput,
} from "../../app/ui/dialog";
import type { RuntimePlatform } from "../../lib/platform";
import type { EncryptedSecretStoreWizardMode } from "./credentialStorageModel";

export function EncryptedSecretStoreDialog({
  busy,
  error,
  initialMode,
  initialResetExisting = false,
  encryptedStoreExists,
  launchPrompt,
  platform,
  onCancel,
  onSubmit,
}: {
  busy: boolean;
  error: string | null;
  initialMode: EncryptedSecretStoreWizardMode;
  initialResetExisting?: boolean;
  encryptedStoreExists: boolean | null | undefined;
  launchPrompt: boolean;
  platform: RuntimePlatform;
  onCancel: () => void;
  onSubmit: (request: {
    password: string;
    createIfMissing: boolean;
    resetExisting?: boolean;
  }) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<EncryptedSecretStoreWizardMode>(initialMode);
  const [resetExisting, setResetExisting] = useState(initialResetExisting);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [resetAttempted, setResetAttempted] = useState(false);
  const formRef = useRef<HTMLFormElement | null>(null);
  const createIfMissing = mode === "create";
  const showResetRecovery = Boolean(error && encryptedStoreExists && !createIfMissing);
  const displayedError = validationError ?? (!createIfMissing || resetAttempted ? error : null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedPassword = password.trim();
    if (!trimmedPassword) {
      setValidationError(t("settings.encryptedSecretStorePasswordRequired"));
      return;
    }
    if (createIfMissing && password !== confirmPassword) {
      setValidationError(t("settings.encryptedSecretStorePasswordMismatch"));
      return;
    }
    setValidationError(null);
    if (resetExisting) {
      setResetAttempted(true);
    }
    await onSubmit({ password: trimmedPassword, createIfMissing, resetExisting });
  }

  function startResetFlow() {
    setMode("create");
    setResetExisting(true);
    setPassword("");
    setConfirmPassword("");
    setValidationError(null);
    setResetAttempted(false);
  }

  return (
    <DialogShell>
      <Sheet
        title={
          launchPrompt
            ? t("settings.encryptedSecretStoreSetupRequiredTitle")
            : t("settings.encryptedSecretStoreSetupTitle")
        }
        width={460}
        footer={
          <Actions
            primary={
              <Btn
                disabled={busy}
                kind={resetExisting ? "danger" : "primary"}
                onClick={() => formRef.current?.requestSubmit()}
              >
                {resetExisting
                  ? t("settings.encryptedSecretStoreResetAction")
                  : createIfMissing
                  ? t("settings.encryptedSecretStoreCreateAction")
                  : t("settings.encryptedSecretStoreUnlockAction")}
              </Btn>
            }
            cancel={
              <Btn disabled={busy} onClick={onCancel}>
                {launchPrompt
                  ? t("settings.encryptedSecretStoreLater")
                  : t("common.cancel")}
              </Btn>
            }
          />
        }
      >
        <form ref={formRef} onSubmit={(event) => void handleSubmit(event)}>
          <p className="field-hint settings-security-note">
            {platform === "linux"
              ? t("settings.encryptedSecretStoreLinuxSafety")
              : t("settings.encryptedSecretStoreSecurityTradeoff")}
          </p>
          <p className="field-hint">
            {resetExisting
              ? t("settings.encryptedSecretStoreResetBody")
              : createIfMissing
              ? t("settings.encryptedSecretStoreCreateBody")
              : t("settings.encryptedSecretStoreSetupBody")}
          </p>
          {createIfMissing ? (
            <p className="field-hint">
              {t("settings.encryptedSecretStorePasswordGuidance")}
            </p>
          ) : null}
          {!createIfMissing ? (
            <p className="field-hint">
              {t("settings.encryptedSecretStoreEnvironmentHint")}
            </p>
          ) : null}
          <div className="encrypted-secret-store-password-fields">
            <Field label={t("settings.encryptedSecretStorePassword")} req>
              <TextInput
                autoFocus
                autoComplete={createIfMissing ? "new-password" : "current-password"}
                disabled={busy}
                type="password"
                value={password}
                onChange={(event) => setPassword(event.currentTarget.value)}
              />
            </Field>
            {createIfMissing ? (
              <Field label={t("settings.encryptedSecretStoreConfirmPassword")} req>
                <TextInput
                  autoComplete="new-password"
                  disabled={busy}
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.currentTarget.value)}
                />
              </Field>
            ) : null}
          </div>
          {resetExisting ? (
            <p className="field-hint settings-dialog-warning">
              {t("settings.encryptedSecretStoreResetWarning")}
            </p>
          ) : null}
          {displayedError ? (
            <p className="field-hint settings-dialog-error" role="alert">
              {displayedError}
            </p>
          ) : null}
          {showResetRecovery ? (
            <button
              className="secondary-button"
              disabled={busy}
              type="button"
              onClick={startResetFlow}
            >
              {t("settings.encryptedSecretStoreResetOffer")}
            </button>
          ) : null}
        </form>
      </Sheet>
    </DialogShell>
  );
}
