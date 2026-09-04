import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Key, Link, Plus, Trash2 } from "../../lib/reicon";
import { Actions, ConfirmSheet } from "../../app/ui/dialog";
import { invokeCommand, isTauriRuntime } from "../../lib/tauri";
import { useWorkspaceStore } from "../../store";
import type {
  ConnectionPasswordCredentialEntry,
  StoredCredentialSummary,
} from "../../types";
import { SavedCredentialConvertDialog } from "./SavedCredentialConvertDialog";
import { SavedCredentialEditDialog } from "./SavedCredentialEditDialog";
import { SavedCredentialMergeDialog } from "./SavedCredentialMergeDialog";
import { SavedCredentialUsageDialog } from "./SavedCredentialUsageDialog";
import {
  filterSavedCredentials,
  mergeEligibility,
  sortSavedCredentials,
} from "./savedCredentialsModel";

export function SavedCredentialsManager({
  legacyCredentials,
  onDeleteLegacy,
  onChanged,
}: {
  /** Legacy per-Connection password rows from `list_stored_credentials`. */
  legacyCredentials: StoredCredentialSummary[];
  onDeleteLegacy: (credential: StoredCredentialSummary) => void;
  /** Reload the surrounding Settings data after any credential change. */
  onChanged: () => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const showStatusBarNotice = useWorkspaceStore((state) => state.showStatusBarNotice);
  const [credentials, setCredentials] = useState<ConnectionPasswordCredentialEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [selecting, setSelecting] = useState(false);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const selectionId = useId();
  const firstSelectionRef = useRef<HTMLInputElement>(null);
  const mergeButtonRef = useRef<HTMLButtonElement>(null);
  const createButtonRef = useRef<HTMLButtonElement>(null);
  const [editTarget, setEditTarget] = useState<ConnectionPasswordCredentialEntry | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [usageTarget, setUsageTarget] = useState<ConnectionPasswordCredentialEntry | null>(null);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ConnectionPasswordCredentialEntry | null>(null);
  const [convertTarget, setConvertTarget] = useState<StoredCredentialSummary | null>(null);

  async function load() {
    if (!isTauriRuntime()) {
      setCredentials([]);
      return;
    }
    setLoading(true);
    try {
      const next = await invokeCommand("list_connection_password_credentials", undefined);
      setCredentials(next);
      if (next.length < 2) setSelecting(false);
      setSelection((current) => {
        if (next.length < 2) return new Set();
        const ids = new Set(next.map((credential) => credential.id));
        return new Set([...current].filter((id) => ids.has(id)));
      });
    } catch (error) {
      showStatusBarNotice(error instanceof Error ? error.message : String(error), { tone: "error" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selecting) firstSelectionRef.current?.focus();
  }, [selecting]);

  async function changed() {
    await load();
    await onChanged();
  }

  const visible = useMemo(
    () => filterSavedCredentials(sortSavedCredentials(credentials), query),
    [credentials, query],
  );
  const selectedCredentials = useMemo(
    () => credentials.filter((credential) => selection.has(credential.id)),
    [credentials, selection],
  );
  const merge = mergeEligibility(selectedCredentials);

  async function deleteCredential(credential: ConnectionPasswordCredentialEntry) {
    try {
      await invokeCommand("delete_stored_credential", {
        request: { kind: "connectionPassword", ownerId: credential.id },
      });
      window.dispatchEvent(new CustomEvent("kkterm:connection-tree-invalidated"));
      showStatusBarNotice(t("settings.credentialDeleted"), { tone: "success" });
      await changed();
    } catch (error) {
      showStatusBarNotice(error instanceof Error ? error.message : String(error), { tone: "error" });
    }
  }

  function toggleSelection(credentialId: string, checked: boolean) {
    setSelection((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(credentialId);
      } else {
        next.delete(credentialId);
      }
      return next;
    });
  }

  function finishSelection() {
    setSelecting(false);
    setSelection(new Set());
    requestAnimationFrame(() => {
      (mergeButtonRef.current ?? createButtonRef.current)?.focus();
    });
  }

  return (
    <div className="settings-credential-manager">
      <div className="settings-credential-group settings-saved-credentials">
        <div className="settings-credential-manager-header">
          <h3>{t("settings.savedCredentials")}</h3>
          <div className="settings-credential-manager-actions">
            {selecting ? (
              <Actions primary={
                <button
                  className="primary-button"
                  disabled={!merge.ok}
                  aria-describedby={`${selectionId}-hint`}
                  type="button"
                  onClick={() => setMergeOpen(true)}
                >
                  <Link size={15} aria-hidden="true" />
                  {t("settings.savedCredentialMergeSelected", { count: selection.size })}
                </button>
              } cancel={
                <button className="secondary-button" type="button" onClick={finishSelection}>
                  {t("common.cancel")}
                </button>
              } />
            ) : credentials.length > 1 ? (
              <button
                className="secondary-button"
                disabled={visible.length === 0}
                ref={mergeButtonRef}
                type="button"
                onClick={() => setSelecting(true)}
              >
                {t("settings.savedCredentialMergeTitle")}
              </button>
            ) : null}
            {!selecting ? (
              <button
                className="secondary-button"
                ref={createButtonRef}
                type="button"
                onClick={() => setCreateOpen(true)}
              >
                <Plus size={15} aria-hidden="true" />
                {t("settings.savedCredentialNew")}
              </button>
            ) : null}
          </div>
        </div>
        <p className="field-hint" id={`${selectionId}-hint`}>
          {t(selecting ? "settings.savedCredentialMergeSelectionHint" : "settings.savedCredentialsHint")}
        </p>
        {credentials.length > 1 ? (
          <input
            aria-label={t("settings.savedCredentialsSearch")}
            className="settings-credential-search"
            placeholder={t("settings.savedCredentialsSearch")}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
        ) : null}
        {credentials.length === 0 ? (
          <p className="settings-empty-state">
            {loading ? t("common.loading") : t("settings.savedCredentialsEmpty")}
          </p>
        ) : visible.length === 0 ? (
          <p className="settings-empty-state">{t("settings.savedCredentialsEmpty")}</p>
        ) : (
          <ul
            className="settings-saved-credential-list"
            aria-label={t("settings.savedCredentials")}
            onKeyDown={(event) => {
              if (selecting && !mergeOpen && event.key === "Escape") {
                event.stopPropagation();
                finishSelection();
              }
            }}
          >
            {visible.map((credential, index) => {
              const inputId = `${selectionId}-${credential.id}`;
              const summary = (
                <>
                  <strong>{credential.label}</strong>
                  <span>{credential.username || "—"}</span>
                  {!credential.secretExists ? (
                    <small>{t("settings.credentialMissingSecret")}</small>
                  ) : null}
                </>
              );
              return (
                <li
                  className={`settings-saved-credential-item${selection.has(credential.id) ? " is-selected" : ""}`}
                  key={credential.id}
                >
                  {selecting ? (
                    <label className="settings-saved-credential-select">
                      <input
                        aria-label={t("settings.savedCredentialMergeSelect", { label: credential.label })}
                        checked={selection.has(credential.id)}
                        id={inputId}
                        ref={index === 0 ? firstSelectionRef : undefined}
                        type="checkbox"
                        onChange={(event) => toggleSelection(credential.id, event.currentTarget.checked)}
                      />
                    </label>
                  ) : (
                    <span className="settings-saved-credential-icon" aria-hidden="true">
                      <Key size={18} />
                    </span>
                  )}
                  {selecting ? (
                    <label className="settings-saved-credential-name" htmlFor={inputId}>
                      {summary}
                    </label>
                  ) : (
                    <button
                      className="settings-saved-credential-name"
                      type="button"
                      onClick={() => setEditTarget(credential)}
                    >
                      {summary}
                    </button>
                  )}
                  <button
                    aria-label={t("settings.savedCredentialUsageTitle", { label: credential.label })}
                    className="settings-saved-credential-count"
                    title={t("settings.savedCredentialUsedBy", { count: credential.usageCount })}
                    type="button"
                    onClick={() => setUsageTarget(credential)}
                  >
                    <Link size={14} aria-hidden="true" />
                    {credential.usageCount}
                  </button>
                  {!selecting ? (
                    <button
                      aria-label={t("settings.deleteCredential")}
                      className="settings-icon-danger-button"
                      type="button"
                      onClick={() => setDeleteTarget(credential)}
                    >
                      <Trash2 size={16} aria-hidden="true" />
                    </button>
                  ) : <span aria-hidden="true" />}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {legacyCredentials.length > 0 ? (
        <div className="settings-credential-group">
          <h3>{t("settings.perConnectionPasswords")}</h3>
          <p className="field-hint">{t("settings.perConnectionPasswordsHint")}</p>
          <div
            className="settings-saved-credential-grid is-legacy"
            role="grid"
            aria-label={t("settings.perConnectionPasswords")}
          >
            <div className="settings-saved-credential-grid-header" role="row">
              <span role="columnheader">{t("settings.savedCredentialName")}</span>
              <span role="columnheader">{t("settings.credentialColumnDetails")}</span>
              <span role="columnheader">{t("settings.savedCredentialUsername")}</span>
              <span aria-hidden="true" />
            </div>
            {legacyCredentials.map((credential) => (
              <div className="settings-saved-credential-grid-row" key={credential.id} role="row">
                <div className="settings-saved-credential-grid-cell is-name" role="gridcell">
                  <strong title={credential.label}>{credential.label}</strong>
                  {!credential.exists ? (
                    <small>{t("settings.credentialMissingSecret")}</small>
                  ) : null}
                </div>
                <div className="settings-saved-credential-grid-cell" role="gridcell">
                  <span title={credential.detail}>{credential.detail || "—"}</span>
                </div>
                <div className="settings-saved-credential-grid-cell" role="gridcell">
                  <span title={credential.username}>{credential.username || "—"}</span>
                </div>
                <div
                  className="settings-saved-credential-grid-actions is-legacy"
                  role="gridcell"
                >
                  <button
                    className="secondary-button"
                    disabled={!credential.exists}
                    type="button"
                    onClick={() => setConvertTarget(credential)}
                  >
                    {t("settings.savedCredentialConvert")}
                  </button>
                  <button
                    aria-label={t("settings.deleteCredential")}
                    className="settings-icon-danger-button"
                    type="button"
                    onClick={() => onDeleteLegacy(credential)}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {createOpen ? (
        <SavedCredentialEditDialog
          credential={null}
          onCancel={() => setCreateOpen(false)}
          onSaved={() => {
            setCreateOpen(false);
            void changed();
          }}
        />
      ) : null}
      {editTarget ? (
        <SavedCredentialEditDialog
          credential={editTarget}
          onCancel={() => setEditTarget(null)}
          onSaved={() => {
            setEditTarget(null);
            void changed();
          }}
        />
      ) : null}
      {usageTarget ? (
        <SavedCredentialUsageDialog
          credential={usageTarget}
          onChanged={changed}
          onClose={() => setUsageTarget(null)}
        />
      ) : null}
      {mergeOpen && merge.ok ? (
        <SavedCredentialMergeDialog
          selected={selectedCredentials}
          onCancel={() => setMergeOpen(false)}
          onMerged={async () => {
            setMergeOpen(false);
            await changed();
            finishSelection();
          }}
        />
      ) : null}
      {convertTarget ? (
        <SavedCredentialConvertDialog
          credentials={credentials}
          legacy={convertTarget}
          onCancel={() => setConvertTarget(null)}
          onConverted={() => {
            setConvertTarget(null);
            void changed();
          }}
        />
      ) : null}
      {deleteTarget ? (
        <ConfirmSheet
          tone="danger"
          title={t("settings.deleteCredential")}
          message={
            deleteTarget.usageCount > 0
              ? t("settings.savedCredentialDeleteUsed", { count: deleteTarget.usageCount })
              : t("settings.deleteCredentialConfirmBody")
          }
          confirmLabel={t("common.delete")}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => {
            const credential = deleteTarget;
            setDeleteTarget(null);
            void deleteCredential(credential);
          }}
        />
      ) : null}
    </div>
  );
}
