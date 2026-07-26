import * as RadixTabs from "@radix-ui/react-tabs";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "../../../../app/ConfirmDialog";
import { ColorPalettePicker, isHexColor } from "../../../../app/ui/ColorPalettePicker";
import {
  Actions,
  Btn,
  DialogShell,
  DIcon,
  Field,
  Group,
  GRow,
  Sheet,
  Switch,
  TextArea,
  TextInput,
} from "../../../../app/ui/dialog";
import { technicalInputProps } from "../../../../lib/inputBehavior";
import { invokeCommand, isTauriRuntime } from "../../../../lib/tauri";
import { ChevronDown, Layers, Plus, Settings, Terminal, WandSparkles } from "../../../../lib/reicon";
import { getReiconIconComponent } from "../../../../lib/reiconCatalog";
import {
  quickCommandId,
  quickCommandsForTarget,
  selectedQuickCommandBundle,
  useWorkspaceStore,
} from "../../../../store";
import type {
  Connection,
  QuickCommand,
  QuickCommandTarget,
  WorkspaceTab,
} from "../../../../types";
import { ACCENT_PALETTE, resolveAccent } from "../../../dashboard/registry/palette";
import { ICON_NAMES, type IconName } from "../../../dashboard/types";
import { getPaneRenderer, writeInputToPane } from "../../paneRegistry";
import { QuickCommandBundleList } from "./QuickCommandBundles";
import {
  QUICK_COMMAND_LIBRARY,
  QUICK_COMMAND_LIBRARY_CATEGORIES,
  type QuickCommandLibraryEntry,
} from "./quickCommandLibrary";

type QuickCommandDraft = Omit<QuickCommand, "id">;

const DEFAULT_DRAFT: QuickCommandDraft = {
  label: "",
  command: "",
  iconName: "Terminal",
  accentName: "default",
  sendEnter: true,
  confirm: false,
};
function payloadFor(command: QuickCommand) {
  const text = command.command.replace(/\r\n/g, "\n");
  if (!command.sendEnter) {
    return text;
  }
  if (!text.includes("\n")) {
    return `${text}\r`;
  }
  return text
    .split("\n")
    .map((line) => `${line}\r`)
    .join("");
}

function iconFor(name: string) {
  return getReiconIconComponent(name) ?? Terminal;
}

function commandFromLibrary(entry: QuickCommandLibraryEntry, translate: (key: string) => string): QuickCommand {
  return {
    id: quickCommandId(),
    label: translate(entry.labelKey),
    command: entry.command,
    iconName: entry.iconName,
    accentName: entry.accentName,
    sendEnter: entry.sendEnter,
    confirm: entry.confirm,
  };
}

function quickCommandColor(accentName: QuickCommand["accentName"]): string {
  return resolveAccent(accentName).color;
}

function connectionAiContext(connection: Connection | undefined) {
  if (!connection) {
    return "Connection: unknown";
  }
  return [
    `Connection name: ${connection.name}`,
    `Connection type: ${connection.type}`,
    connection.host ? `Host: ${connection.host}` : undefined,
    connection.user ? `User: ${connection.user}` : undefined,
    connection.port ? `Port: ${connection.port}` : undefined,
    connection.localShell ? `Local shell: ${connection.localShell}` : undefined,
    connection.localStartupDirectory ? `Startup directory: ${connection.localStartupDirectory}` : undefined,
    connection.url ? `URL: ${connection.url}` : undefined,
  ]
    .filter(Boolean)
    .join("\n");
}

function sanitizeGeneratedCommand(value: string) {
  return value
    .trim()
    .replace(/^```(?:[A-Za-z0-9_-]+)?\s*/i, "")
    .replace(/```$/i, "")
    .trim()
    .replace(/^\$\s+/, "")
    .trim();
}

export function QuickCommandBar({ tab }: { tab: WorkspaceTab }) {
  const { t } = useTranslation();
  const connectionId = tab.connection?.id;
  // The bar shows the selected Quick Command Bundle when the Connection has
  // one, and the Connection's own unbundled list otherwise.
  const activeBundle = useWorkspaceStore((state) => selectedQuickCommandBundle(state, connectionId));
  const activeBundleId = activeBundle?.id;
  const target = useMemo<QuickCommandTarget | undefined>(() => {
    if (activeBundleId) {
      return { kind: "bundle", bundleId: activeBundleId };
    }
    return connectionId ? { kind: "connection", connectionId } : undefined;
  }, [activeBundleId, connectionId]);
  const quickCommands = useWorkspaceStore((state) => quickCommandsForTarget(state, target));
  const ensureQuickCommandsLoaded = useWorkspaceStore((state) => state.ensureQuickCommandsLoaded);
  const showStatusBarNotice = useWorkspaceStore((state) => state.showStatusBarNotice);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [bundlesDialogOpen, setBundlesDialogOpen] = useState(false);
  const [pendingCommand, setPendingCommand] = useState<QuickCommand | null>(null);

  useEffect(() => {
    ensureQuickCommandsLoaded(connectionId);
  }, [connectionId, ensureQuickCommandsLoaded]);

  function send(command: QuickCommand) {
    const paneId =
      tab.focusedPaneId ??
      tab.panes.find((pane) => pane.kind === undefined || pane.kind === "terminal")?.id;
    if (!paneId || !writeInputToPane(paneId, payloadFor(command))) {
      showStatusBarNotice(t("terminal.quickCommandsNoPane"), { tone: "warning" });
      return;
    }
    getPaneRenderer(paneId)?.focus();
  }

  function run(command: QuickCommand) {
    if (command.confirm) {
      setPendingCommand(command);
      return;
    }
    send(command);
  }

  return (
    <>
      <div className="quick-command-bar" aria-label={t("terminal.quickCommandsBar")}>
        {connectionId ? (
          <button
            className="quick-command-bundle"
            onClick={() => setBundlesDialogOpen(true)}
            title={t("terminal.quickCommandBundleSwitch")}
            type="button"
          >
            <Layers size={13} />
            <span>{activeBundle?.name ?? t("terminal.quickCommandBundleNone")}</span>
            <ChevronDown size={12} />
          </button>
        ) : null}
        {quickCommands.length === 0 ? (
          <button className="quick-command-empty" onClick={() => setDialogOpen(true)} type="button">
            <Plus size={13} />
            {t("terminal.quickCommandsAddFirst")}
          </button>
        ) : (
          quickCommands.map((command) => {
            const Icon = iconFor(command.iconName);
            return (
              <button
                className="quick-command-button"
                key={command.id}
                onClick={() => run(command)}
                style={{ "--quick-command-accent": quickCommandColor(command.accentName) } as CSSProperties}
                title={command.command}
                type="button"
              >
                <Icon size={13} />
                <span>{command.label}</span>
              </button>
            );
          })
        )}
        <button
          className="quick-command-manage"
          onClick={() => setDialogOpen(true)}
          title={t("terminal.quickCommandsManage")}
          type="button"
        >
          <Settings size={13} />
        </button>
      </div>
      {dialogOpen ? (
        <QuickCommandManagerDialog
          bundleName={activeBundle?.name}
          connection={tab.connection}
          target={target}
          onClose={() => setDialogOpen(false)}
          onRunCommand={(command) => {
            setDialogOpen(false);
            run(command);
          }}
        />
      ) : null}
      {bundlesDialogOpen && connectionId ? (
        <QuickCommandBundlesDialog
          connectionId={connectionId}
          onClose={() => setBundlesDialogOpen(false)}
        />
      ) : null}
      {pendingCommand ? (
        <ConfirmDialog
          confirmIcon="send"
          confirmLabel={t("terminal.quickCommandsRun")}
          icon="send"
          message={t("terminal.quickCommandsConfirm", { label: pendingCommand.label })}
          onCancel={() => setPendingCommand(null)}
          onConfirm={() => {
            send(pendingCommand);
            setPendingCommand(null);
          }}
          title={t("terminal.quickCommandsConfirmTitle")}
        />
      ) : null}
    </>
  );
}


/** Switch this Connection between its own Quick Commands and a global bundle,
 *  and create/rename/delete bundles without leaving the Quick Command Bar. */
function QuickCommandBundlesDialog({
  connectionId,
  onClose,
}: {
  connectionId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <DialogShell onBackdrop={onClose}>
      <Sheet
        width={460}
        title={t("terminal.quickCommandBundlesTitle")}
        ariaLabel={t("terminal.quickCommandBundlesTitle")}
        footer={
          <Actions cancel={<Btn onClick={onClose}>{t("terminal.quickCommandsDone")}</Btn>} />
        }
      >
        <p className="kk-dlg-sub kk-qc-intro">
          {t("terminal.quickCommandBundlesSubtitle")}
        </p>
        <QuickCommandBundleList connectionId={connectionId} subdialogZClassName="kk-qc-subdialog" />
      </Sheet>
    </DialogShell>
  );
}

export function QuickCommandManagerDialog({
  bundleName,
  connection,
  target,
  onClose,
  onRunCommand,
}: {
  /** Set when the edited list is a global bundle, so the dialog can say so. */
  bundleName?: string;
  connection: Connection | undefined;
  target: QuickCommandTarget | undefined;
  onClose: () => void;
  onRunCommand?: (command: QuickCommand) => void;
}) {
  const { t } = useTranslation();
  const quickCommands = useWorkspaceStore((state) => quickCommandsForTarget(state, target));
  const moveQuickCommand = useWorkspaceStore((state) => state.moveQuickCommand);
  const reorderQuickCommand = useWorkspaceStore((state) => state.reorderQuickCommand);
  const removeQuickCommand = useWorkspaceStore((state) => state.removeQuickCommand);
  const [customDialogOpen, setCustomDialogOpen] = useState(false);
  const [presetDialogOpen, setPresetDialogOpen] = useState(false);
  const [editingCommand, setEditingCommand] = useState<QuickCommand | null>(null);
  const [draggingCommandId, setDraggingCommandId] = useState<string | null>(null);
  const [dragOverCommandId, setDragOverCommandId] = useState<string | null>(null);
  const dragOverCommandIdRef = useRef<string | null>(null);

  useEffect(() => {
    dragOverCommandIdRef.current = dragOverCommandId;
  }, [dragOverCommandId]);

  useEffect(() => {
    if (!draggingCommandId) {
      return;
    }
    const activeDraggingCommandId = draggingCommandId;

    function onPointerMove(event: PointerEvent) {
      const element = document.elementFromPoint(event.clientX, event.clientY);
      const row = element instanceof Element ? element.closest<HTMLElement>(".kk-qc-row") : null;
      const targetCommandId = row?.dataset.commandId ?? null;
      if (targetCommandId && targetCommandId !== activeDraggingCommandId) {
        setDragOverCommandId(targetCommandId);
      } else {
        setDragOverCommandId(null);
      }
    }

    function onPointerUp() {
      const targetCommandId = dragOverCommandIdRef.current;
      if (targetCommandId && targetCommandId !== activeDraggingCommandId) {
        reorderQuickCommand(target, activeDraggingCommandId, targetCommandId);
      }
      setDraggingCommandId(null);
      setDragOverCommandId(null);
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [draggingCommandId, reorderQuickCommand, target]);

  function openCustomDialog(command: QuickCommand | null = null) {
    setEditingCommand(command);
    setCustomDialogOpen(true);
    setPresetDialogOpen(false);
  }

  function openPresetDialog() {
    setPresetDialogOpen(true);
    setCustomDialogOpen(false);
  }

  function startReorderDrag(event: ReactPointerEvent, commandId: string) {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDraggingCommandId(commandId);
    setDragOverCommandId(null);
  }

  return (
    <>
      <DialogShell onBackdrop={onClose}>
        <Sheet
          width={500}
          title={t("terminal.quickCommandsTitle")}
          ariaLabel={t("terminal.quickCommandsManage")}
          footer={
            <Actions
              extraLeft={
                <>
                  <Btn kind="primary" icon="plus" onClick={() => openCustomDialog()}>
                    {t("terminal.quickCommandsAddCommand")}
                  </Btn>
                  <Btn icon="library" onClick={openPresetDialog}>
                    {t("terminal.quickCommandsLibraryAction")}
                  </Btn>
                </>
              }
              cancel={<Btn onClick={onClose}>{t("terminal.quickCommandsDone")}</Btn>}
            />
          }
        >
          <p className="kk-dlg-sub kk-qc-intro">
            {bundleName
              ? t("terminal.quickCommandsBundleSubtitle", { name: bundleName })
              : t("terminal.quickCommandsManageSubtitle")}
          </p>
          {quickCommands.length === 0 ? (
            <p className="kk-qc-muted">{t("terminal.quickCommandsEmpty")}</p>
          ) : (
            <div className="kk-qc-list">
              {quickCommands.map((command, index) => {
                const Icon = iconFor(command.iconName);
                return (
                  <div
                    className={[
                      "kk-qc-row",
                      dragOverCommandId === command.id ? "drag-over" : "",
                      draggingCommandId === command.id ? "dragging" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    data-command-id={command.id}
                    key={command.id}
                  >
                    <span
                      className="kk-qc-grip"
                      onPointerDown={(event) => startReorderDrag(event, command.id)}
                      aria-hidden="true"
                    >
                      <DIcon name="grip" size={15} />
                    </span>
                    <span
                      className="kk-qc-chip"
                      style={{ "--quick-command-accent": quickCommandColor(command.accentName) } as CSSProperties}
                    >
                      <Icon size={15} />
                    </span>
                    <button className="kk-qc-main" onClick={() => openCustomDialog(command)} type="button">
                      <span className="kk-ql">{command.label}</span>
                      <code>{command.command}</code>
                    </button>
                    <div className="kk-qc-acts">
                      <button
                        className="kk-iconbtn"
                        onClick={() => moveQuickCommand(target, command.id, -1)}
                        disabled={index === 0}
                        type="button"
                        aria-label={t("terminal.quickCommandsMoveUp", { label: command.label })}
                        title={t("terminal.quickCommandsMoveUp", { label: command.label })}
                      >
                        <DIcon name="arrowup" size={14} />
                      </button>
                      <button
                        className="kk-iconbtn"
                        onClick={() => moveQuickCommand(target, command.id, 1)}
                        disabled={index === quickCommands.length - 1}
                        type="button"
                        aria-label={t("terminal.quickCommandsMoveDown", { label: command.label })}
                        title={t("terminal.quickCommandsMoveDown", { label: command.label })}
                      >
                        <DIcon name="arrowdown" size={14} />
                      </button>
                      <button
                        className="kk-iconbtn danger"
                        onClick={() => removeQuickCommand(target, command.id)}
                        type="button"
                        aria-label={t("terminal.quickCommandsDelete", { label: command.label })}
                        title={t("terminal.quickCommandsDelete", { label: command.label })}
                      >
                        <DIcon name="trash" size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Sheet>
      </DialogShell>
      {customDialogOpen ? (
        <CustomCommandDialog
          command={editingCommand}
          connection={connection}
          target={target}
          onClose={() => {
            setCustomDialogOpen(false);
            setEditingCommand(null);
          }}
        />
      ) : null}
      {presetDialogOpen ? (
        <PresetLibraryDialog
          target={target}
          onClose={() => setPresetDialogOpen(false)}
          onRunCommand={onRunCommand}
        />
      ) : null}
    </>
  );
}

function CustomCommandDialog({
  command: existingCommand,
  connection,
  target,
  onClose,
}: {
  command: QuickCommand | null;
  connection: Connection | undefined;
  target: QuickCommandTarget | undefined;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const addQuickCommand = useWorkspaceStore((state) => state.addQuickCommand);
  const updateQuickCommand = useWorkspaceStore((state) => state.updateQuickCommand);
  const aiProviderSettings = useWorkspaceStore((state) => state.aiProviderSettings);
  const aiProviderHasApiKey = useWorkspaceStore((state) => state.aiProviderHasApiKey);
  const [openPicker, setOpenPicker] = useState<"icon" | "color" | null>(null);
  const [aiPromptOpen, setAiPromptOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiError, setAiError] = useState("");
  const [draft, setDraft] = useState<QuickCommandDraft>(
    existingCommand
      ? {
          label: existingCommand.label,
          command: existingCommand.command,
          iconName: existingCommand.iconName,
          accentName: existingCommand.accentName,
          sendEnter: existingCommand.sendEnter,
          confirm: existingCommand.confirm,
        }
      : DEFAULT_DRAFT,
  );
  const SelectedIcon = iconFor(draft.iconName);
  const selectedAccentColor = quickCommandColor(draft.accentName);
  const commandInputId = useId();
  const canGenerateWithAi = aiProviderHasApiKey && isTauriRuntime();

  async function generateCommandFromAi() {
    const normalizedPrompt = aiPrompt.trim();
    if (!normalizedPrompt || aiGenerating) {
      return;
    }
    setAiGenerating(true);
    setAiError("");
    try {
      const response = await invokeCommand("run_ai_agent", {
        request: {
          prompt: [
            "Generate exactly one shell command for a KKTerm Quick Command.",
            "Return only the command text. No markdown, no code fence, no explanation.",
            "The command should fit this Connection context and the user's request.",
            "If a required resource name is unknown, use a clear placeholder such as <service-name>.",
            "",
            "Connection context:",
            connectionAiContext(connection),
            "",
            `User request: ${normalizedPrompt}`,
          ].join("\n"),
          contextLabel: connection ? `${connection.name} Quick Command` : "Quick Command",
          messages: [],
          outputLanguage: aiProviderSettings.outputLanguage,
          allowTools: false,
        },
      });
      const commandText = sanitizeGeneratedCommand(response.content);
      if (commandText) {
        setDraft((current) => ({
          ...current,
          command: commandText,
          label: current.label || normalizedPrompt,
        }));
        setAiPromptOpen(false);
        setAiPrompt("");
      }
    } catch (error) {
      setAiError(t("terminal.quickCommandsAiFailed", { message: error instanceof Error ? error.message : String(error) }));
    } finally {
      setAiGenerating(false);
    }
  }

  function saveDraft() {
    const label = draft.label.trim();
    const commandText = draft.command.trim();
    if (!label || !commandText) {
      return;
    }
    const saved: QuickCommand = {
      ...draft,
      id: existingCommand?.id ?? quickCommandId(),
      label,
      command: commandText,
    };
    if (existingCommand) {
      updateQuickCommand(target, saved);
    } else {
      addQuickCommand(target, saved);
    }
    onClose();
  }

  const previewLabel = draft.label.trim() || t("terminal.quickCommandsLabel");

  return (
    <DialogShell onBackdrop={onClose} zClassName="kk-qc-subdialog">
      <Sheet
        width={460}
        title={existingCommand ? t("terminal.quickCommandsEditTitle") : t("terminal.quickCommandsAddCommand")}
        ariaLabel={existingCommand ? t("terminal.quickCommandsEditTitle") : t("terminal.quickCommandsAddCommand")}
        footer={
          <Actions
            cancel={<Btn onClick={onClose}>{t("common.cancel")}</Btn>}
            primary={
              <Btn kind="primary" icon="check" onClick={saveDraft}>
                {existingCommand ? t("common.save") : t("terminal.quickCommandsCreate")}
              </Btn>
            }
          />
        }
      >
        <div className="kk-picker-row">
          <div className="kk-pk">
            <span>{t("terminal.quickCommandsIcon")}</span>
            <button
              className="kk-pk-trigger"
              onClick={() => setOpenPicker(openPicker === "icon" ? null : "icon")}
              type="button"
              aria-haspopup="menu"
              aria-expanded={openPicker === "icon"}
              aria-label={t("terminal.quickCommandsIcon")}
            >
              <SelectedIcon size={18} />
            </button>
            {openPicker === "icon" ? (
              <div className="kk-icon-grid" role="menu" aria-label={t("terminal.quickCommandsIcon")}>
                {ICON_NAMES.map((name) => {
                  const Icon = iconFor(name);
                  return (
                    <button
                      className={draft.iconName === name ? "active" : ""}
                      key={name}
                      onClick={() => {
                        setDraft({ ...draft, iconName: name as IconName });
                        setOpenPicker(null);
                      }}
                      type="button"
                      aria-label={name}
                    >
                      <Icon size={15} />
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
          <div className="kk-pk">
            <span>{t("terminal.quickCommandsColor")}</span>
            <button
              className="kk-pk-trigger color"
              style={{ background: selectedAccentColor }}
              onClick={() => setOpenPicker(openPicker === "color" ? null : "color")}
              type="button"
              aria-haspopup="menu"
              aria-expanded={openPicker === "color"}
              aria-label={t("terminal.quickCommandsColor")}
            />
            {openPicker === "color" ? (
              <div className="kk-color-grid" role="menu" aria-label={t("terminal.quickCommandsColor")}>
                {ACCENT_PALETTE.map((accent) => (
                  <button
                    className={draft.accentName === accent.name ? "active" : ""}
                    key={accent.name}
                    onClick={() => {
                      setDraft({ ...draft, accentName: accent.name });
                      setOpenPicker(null);
                    }}
                    style={{ background: quickCommandColor(accent.name) }}
                    type="button"
                    aria-label={accent.name}
                  />
                ))}
                <ColorPalettePicker
                  className="kk-custom-color-picker"
                  onChange={(accentName) => setDraft({ ...draft, accentName })}
                  value={isHexColor(draft.accentName) ? draft.accentName : null}
                />
              </div>
            ) : null}
          </div>
          <div className="kk-pk kk-pk-preview">
            <span>{t("settings.colorSchemePreview")}</span>
            <div className="kk-qc-preview">
              <span className="kk-qc-preview-ico" style={{ color: selectedAccentColor }}>
                <SelectedIcon size={15} />
              </span>
              <span className="kk-qc-preview-label">{previewLabel}</span>
            </div>
          </div>
        </div>

        <Field label={t("terminal.quickCommandsLabel")}>
          <TextInput
            value={draft.label}
            onChange={(event) => setDraft({ ...draft, label: event.currentTarget.value })}
          />
        </Field>

        <div className="kk-field">
          <div className="kk-qc-cmd-head">
            <span className="kk-lbl">{t("terminal.quickCommandsCommand")}</span>
            {canGenerateWithAi ? (
              <button
                className="kk-qc-ai-btn"
                onClick={() => {
                  setAiPromptOpen((open) => !open);
                  setAiError("");
                }}
                title={t("terminal.quickCommandsGenerateWithAi")}
                type="button"
                aria-label={t("terminal.quickCommandsGenerateWithAi")}
              >
                <WandSparkles size={13} />
              </button>
            ) : null}
          </div>
          <div className="kk-qc-cmd-wrap">
            <TextArea
              id={commandInputId}
              {...technicalInputProps}
              value={draft.command}
              onChange={(event) => setDraft({ ...draft, command: event.currentTarget.value })}
              rows={3}
            />
            {aiPromptOpen ? (
              <div className="kk-qc-ai-popover" role="dialog" aria-label={t("terminal.quickCommandsGenerateWithAi")}>
                <label className="kk-lbl" htmlFor={`${commandInputId}-ai`}>
                  {t("terminal.quickCommandsAiPromptLabel")}
                </label>
                <input
                  id={`${commandInputId}-ai`}
                  className="kk-inp"
                  {...technicalInputProps}
                  onChange={(event) => setAiPrompt(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void generateCommandFromAi();
                    }
                  }}
                  placeholder={t("terminal.quickCommandsAiPromptPlaceholder")}
                  value={aiPrompt}
                />
                {aiError ? <p className="kk-qc-ai-error">{aiError}</p> : null}
                <div className="kk-qc-ai-actions">
                  <Btn onClick={() => setAiPromptOpen(false)} disabled={aiGenerating} sm>
                    {t("common.cancel")}
                  </Btn>
                  <Btn
                    kind="primary"
                    onClick={() => void generateCommandFromAi()}
                    disabled={!aiPrompt.trim() || aiGenerating}
                    sm
                  >
                    {aiGenerating ? t("terminal.quickCommandsAiGenerating") : t("terminal.quickCommandsAiGenerate")}
                  </Btn>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <Group>
          <GRow
            icon="send"
            label={t("terminal.quickCommandsSendEnterTitle")}
            desc={t("terminal.quickCommandsSendEnterDesc")}
            control={
              <Switch
                on={draft.sendEnter}
                onChange={(sendEnter) => setDraft({ ...draft, sendEnter })}
                ariaLabel={t("terminal.quickCommandsSendEnterTitle")}
              />
            }
          />
          <GRow
            icon="shield"
            label={t("terminal.quickCommandsRequireConfirmTitle")}
            desc={t("terminal.quickCommandsRequireConfirmDesc")}
            control={
              <Switch
                on={draft.confirm}
                onChange={(confirm) => setDraft({ ...draft, confirm })}
                ariaLabel={t("terminal.quickCommandsRequireConfirmTitle")}
              />
            }
          />
        </Group>
      </Sheet>
    </DialogShell>
  );
}

function PresetLibraryDialog({
  target,
  onClose,
  onRunCommand,
}: {
  target: QuickCommandTarget | undefined;
  onClose: () => void;
  onRunCommand?: (command: QuickCommand) => void;
}) {
  const { t } = useTranslation();
  const addQuickCommand = useWorkspaceStore((state) => state.addQuickCommand);
  const [query, setQuery] = useState("");
  const [activeCategoryKey, setActiveCategoryKey] = useState(QUICK_COMMAND_LIBRARY_CATEGORIES[0]?.categoryKey ?? "");
  const [activeSubcategoryKey, setActiveSubcategoryKey] = useState(QUICK_COMMAND_LIBRARY_CATEGORIES[0]?.subcategoryKeys[0] ?? "");

  const filteredLibrary = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return QUICK_COMMAND_LIBRARY;
    }
    return QUICK_COMMAND_LIBRARY.filter((entry) =>
      [
        t(entry.categoryKey),
        t(entry.subcategoryKey),
        t(entry.labelKey),
        entry.command,
        t(entry.descriptionKey),
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery),
    );
  }, [query, t]);

  const activeCategory = useMemo(
    () => QUICK_COMMAND_LIBRARY_CATEGORIES.find((category) => category.categoryKey === activeCategoryKey) ?? QUICK_COMMAND_LIBRARY_CATEGORIES[0],
    [activeCategoryKey],
  );
  const visibleSubcategoryKeys = useMemo(() => {
    const subcategoryKeys = activeCategory?.subcategoryKeys ?? [];
    if (!query.trim()) {
      return subcategoryKeys;
    }
    return subcategoryKeys.filter((subcategoryKey) =>
      filteredLibrary.some((entry) => entry.categoryKey === activeCategory?.categoryKey && entry.subcategoryKey === subcategoryKey),
    );
  }, [activeCategory, filteredLibrary, query]);
  const visibleEntries = filteredLibrary.filter(
    (entry) => entry.categoryKey === activeCategory?.categoryKey && entry.subcategoryKey === activeSubcategoryKey,
  );

  useEffect(() => {
    const firstMatch = filteredLibrary[0];
    if (query.trim() && firstMatch) {
      setActiveCategoryKey(firstMatch.categoryKey);
      setActiveSubcategoryKey(firstMatch.subcategoryKey);
      return;
    }
    if (!activeCategory) {
      return;
    }
    if (!activeCategory.subcategoryKeys.includes(activeSubcategoryKey)) {
      setActiveSubcategoryKey(activeCategory.subcategoryKeys[0] ?? "");
    }
  }, [activeCategory, activeSubcategoryKey, filteredLibrary, query]);

  function selectCategory(categoryKey: string) {
    const category = QUICK_COMMAND_LIBRARY_CATEGORIES.find((item) => item.categoryKey === categoryKey);
    setActiveCategoryKey(categoryKey);
    setActiveSubcategoryKey(category?.subcategoryKeys[0] ?? "");
  }

  return (
    <DialogShell onBackdrop={onClose} zClassName="kk-qc-subdialog">
      <Sheet
        width={720}
        height={640}
        title={t("terminal.quickCommandsLibrary")}
        ariaLabel={t("terminal.quickCommandsLibrary")}
        onClose={onClose}
        className="kk-qc-library-sheet"
      >
        <input
          className="kk-inp"
          aria-label={t("common.search")}
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder={t("terminal.quickCommandsSearch")}
          value={query}
        />
        <RadixTabs.Root value={activeCategory?.categoryKey ?? ""} onValueChange={selectCategory}>
          <RadixTabs.List className="kk-qc-lib-tabs" aria-label={t("terminal.quickCommandLibrary.categoryTabs")}>
            {QUICK_COMMAND_LIBRARY_CATEGORIES.map((category) => (
              <RadixTabs.Trigger className="kk-qc-lib-tab" key={category.categoryKey} value={category.categoryKey}>
                {t(category.categoryKey)}
              </RadixTabs.Trigger>
            ))}
          </RadixTabs.List>
        </RadixTabs.Root>
        {visibleSubcategoryKeys.length > 0 ? (
          <RadixTabs.Root value={activeSubcategoryKey} onValueChange={setActiveSubcategoryKey}>
            <RadixTabs.List className="kk-qc-lib-subtabs" aria-label={t("terminal.quickCommandLibrary.subcategoryTabs")}>
              {visibleSubcategoryKeys.map((subcategoryKey) => (
                <RadixTabs.Trigger className="kk-qc-lib-tab" key={subcategoryKey} value={subcategoryKey}>
                  {t(subcategoryKey)}
                </RadixTabs.Trigger>
              ))}
            </RadixTabs.List>
          </RadixTabs.Root>
        ) : null}
        {visibleEntries.length > 0 ? (
          <div className="kk-qc-lib-list">
            {visibleEntries.map((entry) => {
              const Icon = iconFor(entry.iconName);
              return (
                <article
                  className={entry.confirm ? "kk-qc-lib-entry confirmation" : "kk-qc-lib-entry"}
                  key={entry.libraryId}
                  style={{ "--quick-command-accent": quickCommandColor(entry.accentName) } as CSSProperties}
                >
                  <span className="kk-qc-lib-entry-icon" aria-hidden="true">
                    <Icon size={16} />
                  </span>
                  <div className="kk-qc-lib-entry-content">
                    <span className="kk-qc-lib-entry-title">
                      <strong>{t(entry.labelKey)}</strong>
                      {entry.confirm ? (
                        <span className="kk-qc-confirm-tag">
                          {t("terminal.quickCommandsRequireConfirm")}
                        </span>
                      ) : null}
                    </span>
                    <p>{t(entry.descriptionKey)}</p>
                    <code>{entry.command}</code>
                  </div>
                  <div className="kk-qc-lib-entry-actions">
                    <Btn sm icon="plus" onClick={() => addQuickCommand(target, commandFromLibrary(entry, t))}>
                      {t("terminal.quickCommandsAdd")}
                    </Btn>
                    {onRunCommand ? (
                      <Btn sm icon="send" onClick={() => onRunCommand(commandFromLibrary(entry, t))}>
                        {t("terminal.quickCommandsRun")}
                      </Btn>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <p className="kk-qc-muted">{t("terminal.quickCommandsNoLibraryMatches")}</p>
        )}
      </Sheet>
    </DialogShell>
  );
}
