// Quick Command Bundle management, shared by Settings - Terminal and the
// Quick Command Bar. Bundles are app-global: renaming or editing one here
// changes it for every Connection that selected it. The list is presented with
// the shared kk- dialog grammar, so Settings wraps it in a `kk-surface` token
// bridge instead of restyling it.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Actions,
  Btn,
  ConfirmSheet,
  DialogShell,
  DIcon,
  Field,
  Sheet,
  TextInput,
} from "../../../../app/ui/dialog";
import { quickCommandsForConnectionState, useWorkspaceStore } from "../../../../store";
import type { QuickCommandBundle } from "../../../../types";

/** Bundle rows plus create/rename/delete actions.
 *  `connectionId` turns the rows into a selection list for that Connection;
 *  `onEditCommands` adds a per-bundle command editor action. */
export function QuickCommandBundleList({
  connectionId,
  onEditCommands,
  subdialogZClassName,
}: {
  connectionId?: string;
  onEditCommands?: (bundle: QuickCommandBundle) => void;
  subdialogZClassName?: string;
}) {
  const { t } = useTranslation();
  const bundles = useWorkspaceStore((state) => state.quickCommandBundles);
  const selectedBundleId = useWorkspaceStore((state) =>
    connectionId ? state.quickCommandBundleByConnection[connectionId] ?? "" : "",
  );
  const ensureQuickCommandBundlesLoaded = useWorkspaceStore(
    (state) => state.ensureQuickCommandBundlesLoaded,
  );
  const createQuickCommandBundle = useWorkspaceStore((state) => state.createQuickCommandBundle);
  const deleteQuickCommandBundle = useWorkspaceStore((state) => state.deleteQuickCommandBundle);
  const setConnectionQuickCommandBundle = useWorkspaceStore(
    (state) => state.setConnectionQuickCommandBundle,
  );
  const [namingBundle, setNamingBundle] = useState<QuickCommandBundle | "new" | null>(null);
  const [deletingBundle, setDeletingBundle] = useState<QuickCommandBundle | null>(null);

  useEffect(() => {
    ensureQuickCommandBundlesLoaded();
  }, [ensureQuickCommandBundlesLoaded]);

  function createBundle(name: string, copyConnectionCommands: boolean) {
    const commands =
      copyConnectionCommands && connectionId
        ? quickCommandsForConnectionState(useWorkspaceStore.getState(), connectionId)
        : undefined;
    const bundleId = createQuickCommandBundle(name, commands);
    if (connectionId) {
      setConnectionQuickCommandBundle(connectionId, bundleId);
    }
  }

  return (
    <>
      <div className="kk-qc-list">
        {connectionId ? (
          <div className={`kk-qc-row kk-qcb-row${selectedBundleId ? "" : " selected"}`}>
            <span className="kk-qcb-check">
              {selectedBundleId ? null : <DIcon name="check" size={15} />}
            </span>
            <button
              className="kk-qc-main"
              onClick={() => setConnectionQuickCommandBundle(connectionId, "")}
              type="button"
            >
              <span className="kk-ql">{t("terminal.quickCommandBundleNone")}</span>
              <small>{t("terminal.quickCommandBundleNoneDesc")}</small>
            </button>
          </div>
        ) : null}
        {bundles.map((bundle) => (
          <div
            className={`kk-qc-row kk-qcb-row${
              connectionId && selectedBundleId === bundle.id ? " selected" : ""
            }`}
            key={bundle.id}
          >
            {connectionId ? (
              <span className="kk-qcb-check">
                {selectedBundleId === bundle.id ? <DIcon name="check" size={15} /> : null}
              </span>
            ) : null}
            <button
              className="kk-qc-main"
              onClick={() =>
                connectionId
                  ? setConnectionQuickCommandBundle(connectionId, bundle.id)
                  : onEditCommands?.(bundle)
              }
              type="button"
            >
              <span className="kk-ql">{bundle.name}</span>
              <small>
                {t("terminal.quickCommandBundleCount", { count: bundle.commands.length })}
              </small>
            </button>
            <div className="kk-qc-acts">
              {onEditCommands ? (
                <button
                  className="kk-iconbtn"
                  onClick={() => onEditCommands(bundle)}
                  type="button"
                  aria-label={t("terminal.quickCommandBundleEditCommands", { name: bundle.name })}
                  title={t("terminal.quickCommandBundleEditCommands", { name: bundle.name })}
                >
                  <DIcon name="terminal" size={14} />
                </button>
              ) : null}
              <button
                className="kk-iconbtn"
                onClick={() => setNamingBundle(bundle)}
                type="button"
                aria-label={t("terminal.quickCommandBundleRename", { name: bundle.name })}
                title={t("terminal.quickCommandBundleRename", { name: bundle.name })}
              >
                <DIcon name="pencil" size={14} />
              </button>
              <button
                className="kk-iconbtn danger"
                onClick={() => setDeletingBundle(bundle)}
                type="button"
                aria-label={t("terminal.quickCommandBundleDelete", { name: bundle.name })}
                title={t("terminal.quickCommandBundleDelete", { name: bundle.name })}
              >
                <DIcon name="trash" size={14} />
              </button>
            </div>
          </div>
        ))}
        {bundles.length === 0 ? (
          <p className="kk-qc-muted">{t("terminal.quickCommandBundlesEmpty")}</p>
        ) : null}
      </div>
      <div className="kk-qcb-add">
        <Btn icon="plus" onClick={() => setNamingBundle("new")} sm>
          {t("terminal.quickCommandBundleNew")}
        </Btn>
      </div>
      {namingBundle ? (
        <BundleNameDialog
          bundle={namingBundle === "new" ? null : namingBundle}
          canCopyConnectionCommands={Boolean(connectionId)}
          onClose={() => setNamingBundle(null)}
          onCreate={createBundle}
          zClassName={subdialogZClassName}
        />
      ) : null}
      {deletingBundle ? (
        <ConfirmSheet
          tone="danger"
          title={t("terminal.quickCommandBundleDeleteTitle")}
          message={t("terminal.quickCommandBundleDeleteMessage", { name: deletingBundle.name })}
          confirmLabel={t("common.delete")}
          onCancel={() => setDeletingBundle(null)}
          onConfirm={() => {
            deleteQuickCommandBundle(deletingBundle.id);
            setDeletingBundle(null);
          }}
          zClassName={subdialogZClassName}
        />
      ) : null}
    </>
  );
}

function BundleNameDialog({
  bundle,
  canCopyConnectionCommands,
  onClose,
  onCreate,
  zClassName,
}: {
  bundle: QuickCommandBundle | null;
  canCopyConnectionCommands: boolean;
  onClose: () => void;
  onCreate: (name: string, copyConnectionCommands: boolean) => void;
  zClassName?: string;
}) {
  const { t } = useTranslation();
  const renameQuickCommandBundle = useWorkspaceStore((state) => state.renameQuickCommandBundle);
  const [name, setName] = useState(bundle?.name ?? "");
  const [copyConnectionCommands, setCopyConnectionCommands] = useState(false);

  function save() {
    const trimmed = name.trim();
    if (!trimmed) {
      return;
    }
    if (bundle) {
      renameQuickCommandBundle(bundle.id, trimmed);
    } else {
      onCreate(trimmed, copyConnectionCommands);
    }
    onClose();
  }

  return (
    <DialogShell onBackdrop={onClose} zClassName={zClassName}>
      <Sheet
        width={400}
        title={
          bundle
            ? t("terminal.quickCommandBundleRenameTitle")
            : t("terminal.quickCommandBundleNewTitle")
        }
        footer={
          <Actions
            cancel={<Btn onClick={onClose}>{t("common.cancel")}</Btn>}
            primary={
              <Btn kind="primary" icon="check" onClick={save} disabled={!name.trim()}>
                {bundle ? t("common.save") : t("terminal.quickCommandBundleCreate")}
              </Btn>
            }
          />
        }
      >
        <Field label={t("terminal.quickCommandBundleName")}>
          <TextInput
            autoFocus
            onChange={(event) => setName(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                save();
              }
            }}
            placeholder={t("terminal.quickCommandBundleNamePlaceholder")}
            value={name}
          />
        </Field>
        {!bundle && canCopyConnectionCommands ? (
          <label className="kk-qcb-copy">
            <input
              checked={copyConnectionCommands}
              onChange={(event) => setCopyConnectionCommands(event.currentTarget.checked)}
              type="checkbox"
            />
            <span>{t("terminal.quickCommandBundleCopyCurrent")}</span>
          </label>
        ) : null}
      </Sheet>
    </DialogShell>
  );
}
