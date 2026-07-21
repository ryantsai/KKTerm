import { useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Actions, Btn, DialogShell, Field, Sheet, TextInput } from "../../app/ui/dialog";
import { KeyRound } from "../../lib/reicon";

export function EncryptedSecretStoreChangePasswordDialog({
  busy,
  onCancel,
  onSubmit,
}: {
  busy: boolean;
  onCancel: () => void;
  onSubmit: (request: { currentPassword: string; newPassword: string }) => Promise<void>;
}) {
  const { t } = useTranslation();
  const formRef = useRef<HTMLFormElement | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!currentPassword.trim() || !newPassword.trim()) {
      setValidationError(t("settings.encryptedSecretStorePasswordRequired"));
      return;
    }
    if (newPassword !== confirmPassword) {
      setValidationError(t("settings.encryptedSecretStorePasswordMismatch"));
      return;
    }
    setValidationError(null);
    await onSubmit({
      currentPassword: currentPassword.trim(),
      newPassword: newPassword.trim(),
    });
  }

  return (
    <DialogShell>
      <Sheet
        title={t("settings.encryptedSecretStoreChangePasswordAction")}
        width={460}
        footer={
          <Actions
            primary={
              <Btn
                disabled={busy}
                kind="primary"
                onClick={() => formRef.current?.requestSubmit()}
              >
                <KeyRound size={15} />
                {t("settings.encryptedSecretStoreChangePasswordAction")}
              </Btn>
            }
            cancel={
              <Btn disabled={busy} onClick={onCancel}>
                {t("common.cancel")}
              </Btn>
            }
          />
        }
      >
        <form ref={formRef} onSubmit={(event) => void handleSubmit(event)}>
          <p className="field-hint">{t("settings.encryptedSecretStoreChangePasswordBody")}</p>
          <div className="encrypted-secret-store-password-fields">
            <Field label={t("settings.encryptedSecretStoreCurrentPassword")} req>
              <TextInput
                autoFocus
                autoComplete="current-password"
                disabled={busy}
                type="password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.currentTarget.value)}
              />
            </Field>
            <Field label={t("settings.encryptedSecretStoreNewPassword")} req>
              <TextInput
                autoComplete="new-password"
                disabled={busy}
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.currentTarget.value)}
              />
            </Field>
            <Field label={t("settings.encryptedSecretStoreConfirmNewPassword")} req>
              <TextInput
                autoComplete="new-password"
                disabled={busy}
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.currentTarget.value)}
              />
            </Field>
          </div>
          {validationError ? (
            <p className="field-hint settings-dialog-error" role="alert">
              {validationError}
            </p>
          ) : null}
        </form>
      </Sheet>
    </DialogShell>
  );
}
