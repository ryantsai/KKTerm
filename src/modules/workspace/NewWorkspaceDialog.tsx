import { Pencil, Save, Search, SquareCheck, SquareX } from "../../lib/reicon";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { IconLibraryPicker } from "../../app/IconLibraryPicker";
import { LegacyDialogActions } from "../../app/ui/dialog";
import { dialogButtonAria } from "../../lib/aria";
import { brandIconUrlForId } from "../../lib/brandIconUrls";
import { BRAND_ICON_ENTRIES, brandIconRefForId } from "../../lib/brandIcons";
import { useImeCompositionGuard } from "../../lib/ime";
import { invokeCommand } from "../../lib/tauri";
import type { Connection, Workspace } from "../../types";
import { ConnectionIconBackgroundPicker, ConnectionIconColorPicker } from "./connections/ConnectionIconBackgroundPicker";
import { ConnectionIcon } from "./connections/ConnectionIcon";
import { flattenConnections } from "./connections/treeUtils";
import { connectionTypeLabel } from "./connections/utils";
import {
  filterWorkspaceImportConnections,
  getWorkspaceImportTypeOptions,
  nextWorkspaceImportSelection,
  type WorkspaceImportTypeFilter,
} from "./newWorkspaceImportModel";
import { WORKSPACE_ICON_NAMES, WorkspaceIcon, workspaceIconSupportsForegroundColor } from "./workspaceIcons";

interface ImportGroup {
  workspaceId: string;
  workspaceName: string;
  connections: Connection[];
}

/**
 * New Workspace wizard: pick a name and icon, optionally copy-import Connections
 * from existing Workspaces. On success the caller receives the created Workspace
 * and is expected to refresh the Workspace list and activate it.
 */
export function NewWorkspaceDialog({
  workspace,
  workspaces,
  onClose,
  onCreated,
  onSaved,
}: {
  workspace?: Workspace;
  workspaces: Workspace[];
  onClose: () => void;
  onCreated?: (workspace: Workspace) => void;
  onSaved?: (workspace: Workspace) => void;
}) {
  const { t } = useTranslation();
  const isEditMode = Boolean(workspace);
  const [name, setName] = useState(workspace?.name ?? "");
  const [icon, setIcon] = useState<string | null>(workspace?.icon ?? WORKSPACE_ICON_NAMES[0]);
  const [iconColor, setIconColor] = useState<string | null>(workspace?.iconColor ?? null);
  const [iconBackgroundColor, setIconBackgroundColor] = useState<string | null>(
    workspace?.iconBackgroundColor ?? null,
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [importGroups, setImportGroups] = useState<ImportGroup[]>([]);
  const [selectedImportWorkspaceId, setSelectedImportWorkspaceId] = useState("");
  const [importSearch, setImportSearch] = useState("");
  const [importType, setImportType] = useState<WorkspaceImportTypeFilter>("all");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const imeGuard = useImeCompositionGuard();

  useEffect(() => {
    if (isEditMode) {
      return;
    }
    let disposed = false;
    async function loadImportCandidates() {
      const groups: ImportGroup[] = [];
      for (const workspace of workspaces) {
        try {
          const tree = await invokeCommand("list_connection_tree", {
            workspaceId: workspace.id,
          });
          const connections = flattenConnections(tree);
          if (connections.length > 0) {
            groups.push({
              workspaceId: workspace.id,
              workspaceName: workspace.isDefault
                ? t("workspace.defaultWorkspace")
                : workspace.name,
              connections,
            });
          }
        } catch {
          // A failed tree read just omits that Workspace from the picker.
        }
      }
      if (!disposed) {
        setImportGroups(groups);
      }
    }
    void loadImportCandidates();
    return () => {
      disposed = true;
    };
  }, [isEditMode, workspaces, t]);

  const canSave = useMemo(() => name.trim().length > 0 && !submitting, [name, submitting]);
  const selectedImportGroup = useMemo(
    () =>
      importGroups.find((group) => group.workspaceId === selectedImportWorkspaceId) ??
      importGroups[0] ??
      null,
    [importGroups, selectedImportWorkspaceId],
  );
  const importTypeOptions = useMemo(
    () =>
      selectedImportGroup
        ? getWorkspaceImportTypeOptions(selectedImportGroup.connections)
        : [],
    [selectedImportGroup],
  );
  const visibleImportConnections = useMemo(
    () =>
      selectedImportGroup
        ? filterWorkspaceImportConnections(selectedImportGroup.connections, {
            query: importSearch,
            type: importType,
          })
        : [],
    [importSearch, importType, selectedImportGroup],
  );
  const visibleImportIds = useMemo(
    () => visibleImportConnections.map((connection) => connection.id),
    [visibleImportConnections],
  );

  useEffect(() => {
    if (importGroups.length === 0) {
      setSelectedImportWorkspaceId("");
      setSelectedIds(new Set());
      return;
    }
    if (!importGroups.some((group) => group.workspaceId === selectedImportWorkspaceId)) {
      setSelectedImportWorkspaceId(importGroups[0].workspaceId);
      setSelectedIds(new Set());
    }
  }, [importGroups, selectedImportWorkspaceId]);

  useEffect(() => {
    if (importTypeOptions.length > 0 && !importTypeOptions.includes(importType)) {
      setImportType("all");
    }
  }, [importType, importTypeOptions]);

  function toggleConnection(connectionId: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(connectionId)) {
        next.delete(connectionId);
      } else {
        next.add(connectionId);
      }
      return next;
    });
  }

  function handleImportWorkspaceChange(workspaceId: string) {
    setSelectedImportWorkspaceId(workspaceId);
    setSelectedIds(new Set());
    setImportSearch("");
    setImportType("all");
  }

  function setVisibleSelection(select: boolean) {
    setSelectedIds((current) =>
      nextWorkspaceImportSelection(current, visibleImportIds, select),
    );
  }

  async function handleSave() {
    if (!canSave) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      if (workspace) {
        const updated = await invokeCommand("rename_workspace", {
          request: {
            id: workspace.id,
            name: name.trim(),
            icon,
            iconColor,
            iconBackgroundColor,
          },
        });
        onSaved?.(updated);
        return;
      }
      const created = await invokeCommand("create_workspace", {
          request: {
            name: name.trim(),
            icon,
            iconColor,
            iconBackgroundColor,
            importConnectionIds:
            selectedIds.size > 0 ? Array.from(selectedIds) : undefined,
        },
      });
      onCreated?.(created);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setSubmitting(false);
    }
  }

  return createPortal(
    <div className="dialog-backdrop connection-dialog-backdrop" role="presentation">
      <div
        aria-label={isEditMode ? t("workspace.editWorkspace") : t("workspace.newWorkspace")}
        aria-modal="true"
        className="connection-dialog new-workspace-dialog"
        role="dialog"
      >
        <header className="connection-dialog-header compact">
          <div>
            <p className="connection-dialog-eyebrow">
              {isEditMode ? t("workspace.editWorkspace") : t("workspace.newWorkspace")}
            </p>
          </div>
        </header>

        <div className="new-workspace-body">
          <div className="connection-type-summary new-workspace-summary">
            <WorkspaceIconPicker
              backgroundColor={iconBackgroundColor}
              color={iconColor}
              icon={icon}
              name={name || workspace?.name || t("workspace.newWorkspace")}
              onChange={setIcon}
              onColorChange={setIconColor}
            />
            <div className="connection-icon-palettes">
              <ConnectionIconBackgroundPicker
                color={iconBackgroundColor}
                onChange={setIconBackgroundColor}
              />
            </div>
          </div>

          <div className="connection-dialog-fields new-workspace-fields">
            <label className="new-workspace-field">
              <span>
                {t("workspace.workspaceName")}
                <span aria-hidden="true" className="required-marker">*</span>
              </span>
              <input
                autoFocus
                className="connection-dialog-input"
                onCompositionEnd={imeGuard.onCompositionEnd}
                onCompositionStart={imeGuard.onCompositionStart}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (imeGuard.shouldSuppressAction(event.nativeEvent)) {
                    return;
                  }
                  if (event.key === "Enter") {
                    void handleSave();
                  }
                }}
                placeholder={t("workspace.workspaceNamePlaceholder")}
                type="text"
                value={name}
              />
            </label>
          </div>

          {!isEditMode && importGroups.length > 0 ? (
            <fieldset className="new-workspace-group">
              <legend>{t("workspace.importConnections")}</legend>
              <p className="field-hint">{t("workspace.importConnectionsHint")}</p>
              {importGroups.length > 1 ? (
                <label className="new-workspace-field">
                  <span>{t("workspace.importFromWorkspace")}</span>
                  <select
                    onChange={(event) => handleImportWorkspaceChange(event.target.value)}
                    value={selectedImportGroup?.workspaceId ?? ""}
                  >
                    {importGroups.map((group) => (
                      <option key={group.workspaceId} value={group.workspaceId}>
                        {group.workspaceName}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              <div className="new-workspace-import-tools">
                <div className="new-workspace-selection-actions">
                  <button
                    aria-label={t("workspace.selectAllConnections")}
                    className="icon-button new-workspace-selection-button"
                    disabled={visibleImportIds.length === 0}
                    onClick={() => setVisibleSelection(true)}
                    type="button"
                  >
                    <SquareCheck aria-hidden="true" size={16} />
                  </button>
                  <button
                    aria-label={t("workspace.deselectAllConnections")}
                    className="icon-button new-workspace-selection-button"
                    disabled={visibleImportIds.length === 0}
                    onClick={() => setVisibleSelection(false)}
                    type="button"
                  >
                    <SquareX aria-hidden="true" size={16} />
                  </button>
                </div>
                <label className="search-box new-workspace-import-search">
                  <Search size={14} />
                  <input
                    aria-label={t("workspace.searchConnections")}
                    onChange={(event) => setImportSearch(event.target.value)}
                    placeholder={t("workspace.searchConnections")}
                    type="search"
                    value={importSearch}
                  />
                </label>
                <label className="new-workspace-type-filter">
                  <span>{t("workspace.filterConnectionTypes")}</span>
                  <select
                    onChange={(event) =>
                      setImportType(event.target.value as WorkspaceImportTypeFilter)
                    }
                    value={importType}
                  >
                    {importTypeOptions.map((typeOption) => (
                      <option key={typeOption} value={typeOption}>
                        {typeOption === "all"
                          ? t("workspace.allConnectionTypes")
                          : connectionTypeLabel(typeOption)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="new-workspace-import-list">
                {visibleImportConnections.length > 0 ? (
                  visibleImportConnections.map((connection) => (
                    <label className="new-workspace-import-row" key={connection.id}>
                      <input
                        checked={selectedIds.has(connection.id)}
                        onChange={() => toggleConnection(connection.id)}
                        type="checkbox"
                      />
                      <ConnectionIcon
                        iconBackgroundColor={connection.iconBackgroundColor}
                        iconDataUrl={connection.iconDataUrl}
                        localShell={connection.localShell}
                        size={16}
                        type={connection.type}
                      />
                      <strong>{connection.name}</strong>
                      <small>{connectionTypeLabel(connection.type)}</small>
                    </label>
                  ))
                ) : (
                  <p className="new-workspace-import-empty">
                    {t("workspace.noImportConnections")}
                  </p>
                )}
              </div>
            </fieldset>
          ) : null}

          {error ? <div className="settings-error">{error}</div> : null}
        </div>

        <LegacyDialogActions
          primary={<button
            className="approve-button"
            disabled={!canSave}
            onClick={() => void handleSave()}
            type="button"
          >
            <Save size={15} />
            {isEditMode ? t("common.save") : t("workspace.createWorkspace")}
          </button>}
          cancel={<button className="toolbar-button" onClick={onClose} type="button">
            {t("common.cancel")}
          </button>}
        />
      </div>
    </div>,
    document.body,
  );
}

function WorkspaceIconPicker({
  backgroundColor,
  color,
  icon,
  name,
  onChange,
  onColorChange,
}: {
  backgroundColor: string | null;
  color: string | null;
  icon: string | null;
  name: string;
  onChange: (icon: string | null) => void;
  onColorChange?: (color: string | null) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const supportsForeground = workspaceIconSupportsForegroundColor(icon);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (rootRef.current && !rootRef.current.contains(target)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div className="new-workspace-icon-editor" ref={rootRef}>
      <button
        aria-label={t("workspace.editWorkspaceIcon")}
        className="connection-icon-edit-button new-workspace-icon-edit-button"
        onClick={() => setOpen((current) => !current)}
        type="button"
        {...dialogButtonAria(open)}
      >
        <WorkspaceIcon backgroundColor={backgroundColor} color={color} icon={icon} name={name} size={26} />
        <span className="connection-icon-edit-glyph" aria-hidden="true">
          <Pencil size={12} />
        </span>
      </button>
      {open ? (
        <div
          aria-label={t("workspace.iconPickerLabel")}
          className="connection-icon-popover new-workspace-icon-popover"
          role="dialog"
        >
          <div className="connection-icon-picker-section">
            <IconLibraryPicker
              className="new-workspace-icon-library-picker"
              defaultOption={{
                value: null,
                label: name,
                keywords: ["letter", "workspace"],
                icon: <WorkspaceIcon backgroundColor={backgroundColor} color={color} icon={null} name={name} size={19} />,
              }}
              iconNames={WORKSPACE_ICON_NAMES}
              staticOptions={BRAND_ICON_ENTRIES.flatMap((entry) => {
                const url = brandIconUrlForId(entry.id);
                return url
                  ? [{
                      value: brandIconRefForId(entry.id),
                      label: entry.label,
                      keywords: entry.keywords,
                      icon: <img alt="" aria-hidden="true" draggable={false} src={url} />,
                    }]
                  : [];
              })}
              onSelect={(nextIcon) => {
                onChange(nextIcon);
                // Keep the popover open for foreground-capable icons so the
                // user can recolor in one flow; close it for image icons.
                if (!(onColorChange && workspaceIconSupportsForegroundColor(nextIcon))) {
                  setOpen(false);
                }
              }}
              searchPlaceholder={t("common.searchForMore")}
              value={icon}
            />
            {onColorChange && supportsForeground ? (
              <div className="connection-icon-picker-section connection-icon-foreground-section">
                <p>{t("connections.iconForeground")}</p>
                <ConnectionIconColorPicker color={color} kind="foreground" onChange={onColorChange} />
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
