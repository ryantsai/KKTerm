import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Actions,
  Btn,
  DialogShell,
  Field,
  Group,
  GRow,
  Select,
  Sheet,
  TextInput,
} from "../../app/ui/dialog";
import { useDashboardStore } from "../dashboard/state/dashboardStore";
import { reloadDurableUiStatePrefix } from "../../lib/durableUiState";
import { invokeCommand, selectSettingsBackupImportFile } from "../../lib/tauri";
import type { CredentialSecretStoreStatus, SelectiveManifest } from "../../types";
import { useWorkspaceStore } from "../../store";
import { EXPORT_GROUPS } from "./SelectiveExportDialog";

type SegmentAction = "skip" | "add" | "replace";
type ImportKind = "selective" | "full";

function fileNameFromPath(path: string) {
  return path.split(/[/\\]/).pop() ?? path;
}

export function SelectiveImportDialog({
  onClose,
  onFullImport,
}: {
  onClose: () => void;
  onFullImport: (path: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const showStatusBarNotice = useWorkspaceStore((s) => s.showStatusBarNotice);
  const closeAllTabs = useWorkspaceStore((s) => s.closeAllTabs);
  const loadDashboard = useDashboardStore((s) => s.load);
  const [path, setPath] = useState<string | null>(null);
  const [importKind, setImportKind] = useState<ImportKind | null>(null);
  const [manifest, setManifest] = useState<SelectiveManifest | null>(null);
  const [actions, setActions] = useState<Record<string, SegmentAction>>({});
  const [passphrase, setPassphrase] = useState("");
  const [encryptedStorePassword, setEncryptedStorePassword] = useState("");
  const [machineStore, setMachineStore] = useState<CredentialSecretStoreStatus | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleChooseFile() {
    setBusy(true);
    try {
      const chosen = await selectSettingsBackupImportFile({
        title: t("settings.importSettings"),
        filterName: t("settings.settingsBackupFilter"),
      });
      if (!chosen) {
        setBusy(false);
        return;
      }
      setPath(chosen);
      setPassphrase("");
      setEncryptedStorePassword("");
      // Fetched outside the inspect try/catch so a status failure is not
      // misread as "this is a full .zip backup". Used to decide whether
      // importing credentials must set up or unlock this machine's encrypted
      // database before the secrets can be written.
      setMachineStore(await invokeCommand("credential_secret_store_status", undefined));
      try {
        const inspected = await invokeCommand("inspect_selective_database", { path: chosen });
        const initial: Record<string, SegmentAction> = {};
        for (const segment of inspected.segments) {
          initial[segment] = "add";
        }
        if (inspected.encrypted) {
          initial.credentials = "add";
        }
        setImportKind("selective");
        setManifest(inspected);
        setActions(initial);
      } catch (inspectError) {
        if (!chosen.toLowerCase().endsWith(".zip")) {
          throw inspectError;
        }
        setImportKind("full");
        setManifest(null);
        setActions({});
      }
    } catch (error) {
      showStatusBarNotice(error instanceof Error ? error.message : String(error), { tone: "error" });
    }
    setBusy(false);
  }

  async function handleImport() {
    if (!path || !importKind || busy) return;
    setBusy(true);
    try {
      if (importKind === "full") {
        await onFullImport(path);
        onClose();
        return;
      }
      if (!manifest) {
        setBusy(false);
        return;
      }
      const replacesPresentSegment = (segment: string) =>
        manifest.segments.includes(segment) && actions[segment] === "replace";
      const replacesWorkspaceData =
        replacesPresentSegment("workspaces") || replacesPresentSegment("connections");
      if (replacesWorkspaceData || replacesPresentSegment("settings")) {
        closeAllTabs();
      }
      const result = await invokeCommand("import_selective_database", {
        path,
        actions,
        passphrase: manifest.encrypted ? passphrase : null,
        // The backend ignores this unless the import must set up or unlock this
        // machine's encrypted database, so an empty value is safe to send.
        encryptedStorePassword: encryptedStorePassword.length > 0 ? encryptedStorePassword : null,
      });
      const importedSettings = result.applied.includes("settings");
      const importedConnections = result.applied.includes("connections");
      if (importedConnections || result.applied.includes("workspaces")) {
        window.dispatchEvent(new CustomEvent("kkterm:connection-tree-invalidated"));
      }
      if (result.applied.includes("dashboards")) {
        await reloadDurableUiStatePrefix("kkterm.dashboard.notes.");
        await loadDashboard();
      }
      if (result.applied.includes("itops")) {
        window.dispatchEvent(new CustomEvent("kkterm:itops-invalidated"));
      }
      if (result.applied.includes("assistant")) {
        window.dispatchEvent(new CustomEvent("kkterm:assistant-history-invalidated"));
      }
      showStatusBarNotice(t("settings.selectiveImportComplete", { count: result.applied.length }), {
        tone: "success",
      });
      onClose();
      // Settings rows feed many in-memory stores; a reload is the safe way to
      // re-read them all, mirroring the full settings import.
      if (importedSettings) {
        closeAllTabs();
        window.setTimeout(() => window.location.reload(), 250);
      }
    } catch (error) {
      showStatusBarNotice(error instanceof Error ? error.message : String(error), { tone: "error" });
      setBusy(false);
    }
  }

  // A group's action drives every backend segment it owns. Setting all of them
  // together (even ones absent from this bundle) keeps the "replace Workspaces
  // ⇒ replace Connections" backend rule satisfied; absent segments carry no
  // data, so the import loop simply skips them.
  function updateGroupAction(segments: string[], action: SegmentAction) {
    setActions((prev) => {
      const next = { ...prev };
      for (const segment of segments) {
        next[segment] = action;
      }
      return next;
    });
  }

  const actionOptions = [
    { value: "skip", label: t("settings.importActionSkip") },
    { value: "add", label: t("settings.importActionAdd") },
    { value: "replace", label: t("settings.importActionReplace") },
  ];
  const selectiveManifest = importKind === "selective" ? manifest : null;
  // Only show the groups this bundle actually carries, in the export display
  // order. A group appears if any of its segments is present.
  const presentGroups = selectiveManifest
    ? EXPORT_GROUPS.filter((group) =>
        group.segments.some((segment) => selectiveManifest.segments.includes(segment)),
      )
    : [];
  const groupActionValue = (segments: string[]): SegmentAction => {
    const present = segments.find((segment) => selectiveManifest?.segments.includes(segment));
    return (present && actions[present]) || "add";
  };
  const passphraseNeeded = Boolean(selectiveManifest?.encrypted) && actions.credentials !== "skip";
  // Importing the Settings group adopts the bundle's secret-store selection when
  // it carries one; otherwise (and when Settings is not imported) the passwords
  // land in the store this machine already uses. Mirrors the backend's
  // `resolve_target_secret_store`.
  const settingsImported =
    Boolean(selectiveManifest?.segments.includes("settings")) && actions.settings !== "skip";
  const targetStore =
    settingsImported && selectiveManifest?.credentialStore
      ? selectiveManifest.credentialStore
      : machineStore?.selectedStore;
  const targetIsFile = targetStore === "file";
  const encryptedStoreReady =
    machineStore?.selectedStore === "file" && machineStore.unlocked === true;
  // A master password is required only when the passwords are headed for the
  // encrypted database and it is not already set up and unlocked on this machine.
  const encryptedSetupNeeded = passphraseNeeded && Boolean(targetIsFile) && !encryptedStoreReady;
  const canImport =
    Boolean(importKind) &&
    !busy &&
    (!passphraseNeeded || passphrase.length > 0) &&
    (!encryptedSetupNeeded || encryptedStorePassword.length > 0);

  return (
    <DialogShell onBackdrop={onClose}>
      <Sheet
        width={540}
        title={t("settings.importSettings")}
        footer={
          <Actions
            primary={
              <Btn
                kind="primary"
                icon="upload"
                onClick={() => void handleImport()}
                disabled={!canImport}
              >
                {t("settings.importSettings")}
              </Btn>
            }
            cancel={<Btn onClick={onClose}>{t("common.cancel")}</Btn>}
          />
        }
      >
        {!importKind ? (
          <Field label={t("settings.importBackupFileHint")}>
            <Btn icon="folder" onClick={() => void handleChooseFile()} disabled={busy}>
              {t("settings.selectiveImportChooseFile")}
            </Btn>
          </Field>
        ) : importKind === "full" && path ? (
          <>
            <Group title={t("settings.fullBackupImport")}>
              <GRow
                icon="package"
                label={fileNameFromPath(path)}
                desc={t("settings.fullBackupImportHint")}
              />
            </Group>
            <p className="kk-dlg-warn">{t("settings.fullBackupCustomModulesWarning")}</p>
            <p className="kk-dlg-warn">{t("settings.importSettingsConfirm")}</p>
          </>
        ) : selectiveManifest ? (
          <>
            <Group title={t("settings.selectiveImportActionsHint")}>
              {presentGroups.map((group) => (
                <GRow
                  key={group.id}
                  icon={group.icon}
                  label={t(`settings.segment_${group.id}`)}
                  control={
                    <Select
                      options={actionOptions}
                      value={groupActionValue(group.segments)}
                      onChange={(event) =>
                        updateGroupAction(group.segments, event.currentTarget.value as SegmentAction)
                      }
                    />
                  }
                />
              ))}
              {selectiveManifest.encrypted && (
                <GRow
                  icon="key"
                  label={t("settings.segment_credentials")}
                  desc={t("settings.includeCredentialsHint")}
                  control={
                    <Select
                      options={actionOptions}
                      value={actions.credentials ?? "add"}
                      onChange={(event) => {
                        const credentials = event.currentTarget.value as SegmentAction;
                        setActions((prev) => ({ ...prev, credentials }));
                      }}
                    />
                  }
                />
              )}
            </Group>
            {passphraseNeeded && (
              <Field label={t("settings.importPassphrase")} req>
                <TextInput
                  type="password"
                  value={passphrase}
                  onChange={(event) => setPassphrase(event.currentTarget.value)}
                />
              </Field>
            )}
            {encryptedSetupNeeded && (
              <Field
                label={t("settings.importEncryptedStorePassword")}
                hint={t("settings.importEncryptedStorePasswordHint")}
                req
              >
                <TextInput
                  type="password"
                  value={encryptedStorePassword}
                  onChange={(event) => setEncryptedStorePassword(event.currentTarget.value)}
                />
              </Field>
            )}
            <p className="kk-dlg-warn">{t("settings.selectiveImportWarning")}</p>
          </>
        ) : null}
      </Sheet>
    </DialogShell>
  );
}
