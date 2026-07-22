import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Actions,
  Btn,
  DialogShell,
  Field,
  Group,
  GRow,
  Sheet,
  Switch,
  TextInput,
  type DialogIconName,
} from "../../app/ui/dialog";
import { invokeCommand, selectSelectiveExportFile } from "../../lib/tauri";
import { flushDurableUiState } from "../../lib/durableUiState";
import { useWorkspaceStore } from "../../store";

/// Categories offered for selective export, in display order. Each group maps to
/// one or more backend segments understood by `export_selective_database`; the
/// grouping is a UI concern only — the bundle still carries the individual
/// segments, so bundles stay compatible across app versions. Workspaces and
/// Connections always travel together (a Connection is meaningless without its
/// Workspace), and MCP Servers ride along with the rest of Settings.
export const EXPORT_GROUPS: { id: string; icon: DialogIconName; segments: string[] }[] = [
  { id: "workspacesConnections", icon: "server", segments: ["workspaces", "connections"] },
  { id: "dashboards", icon: "dashboard", segments: ["dashboards"] },
  { id: "itops", icon: "network", segments: ["itops"] },
  { id: "assistant", icon: "bot", segments: ["assistant"] },
  { id: "settings", icon: "gear", segments: ["settings", "mcpServers"] },
];

function defaultExportFilename() {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `kkterm-export-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.kkbackup`;
}

export function SelectiveExportDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const showStatusBarNotice = useWorkspaceStore((s) => s.showStatusBarNotice);
  const [selected, setSelected] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(EXPORT_GROUPS.map((group) => [group.id, true])),
  );
  const [includeCredentials, setIncludeCredentials] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [passphraseConfirm, setPassphraseConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  const connectionsSelected = Boolean(selected.workspacesConnections);
  const chosenSegments = EXPORT_GROUPS
    .filter((group) => selected[group.id])
    .flatMap((group) => group.segments);
  const passphraseValid = !includeCredentials || (passphrase.length > 0 && passphrase === passphraseConfirm);
  const canExport =
    !busy
    && chosenSegments.length > 0
    && (!includeCredentials || connectionsSelected)
    && passphraseValid;

  async function handleExport() {
    if (!canExport) return;
    setBusy(true);
    try {
      const path = await selectSelectiveExportFile({
        title: t("settings.selectiveExport"),
        filterName: t("settings.selectiveBackupFilter"),
        defaultFilename: defaultExportFilename(),
      });
      if (!path) {
        setBusy(false);
        return;
      }
      await flushDurableUiState();
      const info = await invokeCommand("export_selective_database", {
        path,
        segments: chosenSegments,
        includeCredentials,
        passphrase: includeCredentials ? passphrase : null,
      });
      showStatusBarNotice(t("settings.selectiveExportComplete", { filename: info.filename }), {
        tone: "success",
      });
      onClose();
    } catch (error) {
      showStatusBarNotice(error instanceof Error ? error.message : String(error), { tone: "error" });
      setBusy(false);
    }
  }

  return (
    <DialogShell onBackdrop={onClose}>
      <Sheet
        width={520}
        title={t("settings.selectiveExport")}
        footer={
          <Actions
            primary={
              <Btn kind="primary" icon="download" onClick={() => void handleExport()} disabled={!canExport}>
                {t("settings.selectiveExport")}
              </Btn>
            }
            cancel={<Btn onClick={onClose}>{t("common.cancel")}</Btn>}
          />
        }
      >
        <Group title={t("settings.selectiveExportPickHint")}>
          {EXPORT_GROUPS.map((group) => (
            <GRow
              key={group.id}
              icon={group.icon}
              label={t(`settings.segment_${group.id}`)}
              desc={t(`settings.segmentDesc_${group.id}`)}
              control={
                <Switch
                  on={Boolean(selected[group.id])}
                  ariaLabel={t(`settings.segment_${group.id}`)}
                  onChange={(next) => setSelected((prev) => ({ ...prev, [group.id]: next }))}
                />
              }
            />
          ))}
        </Group>

        <Group title={t("settings.selectiveCredentials")}>
          <GRow
            icon="key"
            label={t("settings.includeCredentials")}
            desc={t("settings.includeCredentialsHint")}
            control={
              <Switch
                on={includeCredentials}
                disabled={!connectionsSelected}
                ariaLabel={t("settings.includeCredentials")}
                onChange={setIncludeCredentials}
              />
            }
          />
        </Group>

        {includeCredentials && (
          <>
            <p className="kk-dlg-warn">{t("settings.includeCredentialsWarning")}</p>
            <Field label={t("settings.exportPassphrase")} req>
              <TextInput
                type="password"
                value={passphrase}
                onChange={(event) => setPassphrase(event.currentTarget.value)}
              />
            </Field>
            <Field
              label={t("settings.exportPassphraseConfirm")}
              hint={
                passphrase && passphraseConfirm && passphrase !== passphraseConfirm
                  ? t("settings.exportPassphraseMismatch")
                  : undefined
              }
            >
              <TextInput
                type="password"
                value={passphraseConfirm}
                onChange={(event) => setPassphraseConfirm(event.currentTarget.value)}
              />
            </Field>
          </>
        )}
      </Sheet>
    </DialogShell>
  );
}
