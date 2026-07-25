import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { useTranslation } from "react-i18next";
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  getStraightPath,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Actions, ConfirmSheet, Btn, DialogShell, Field, Segmented, TextArea, TextInput } from "../../app/ui/dialog";
import { invokeCommand } from "../../lib/tauri";
import { useWorkspaceStore } from "../../store";
import type { BatchTask, ItopsTask, PlaybookStep, TaskOperatingSystem } from "../../types";
import { ItIcon, IT_ACCENTS, type ItIconName } from "./icons";
import { ItOpsEmptyHint } from "./ItOpsEmptyHint";
import { useItOpsStore } from "./state";
import { TASK_OPERATING_SYSTEMS, normalizeTaskOperatingSystems, taskDisplayName, taskOsLabel } from "./taskCatalog";

type TaskMode = "script" | "playbook";
type EditorStep = PlaybookStep & { id: string; kind: "command" | "sudo" | "ai" };

function newId(prefix: string): string {
  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${id}`;
}

function commandStep(): EditorStep {
  return { id: newId("step"), kind: "command", name: "", send: "", expect: "", timeoutSeconds: null, secretOwnerId: null };
}

function sudoStep(): EditorStep {
  return {
    id: newId("step"),
    kind: "sudo",
    name: "",
    send: "",
    expect: "KKTerm sudo password: ",
    timeoutSeconds: 30,
    secretOwnerId: newId("itops-sudo"),
    aiInstruction: null,
  };
}

function aiStep(): EditorStep {
  return {
    id: newId("step"),
    kind: "ai",
    name: "",
    send: "",
    expect: null,
    timeoutSeconds: 120,
    secretOwnerId: null,
    aiInstruction: "",
  };
}

function normalizeStep(step: PlaybookStep): EditorStep {
  return {
    ...step,
    id: step.id || newId("step"),
    kind: step.kind === "sudo" || step.kind === "ai" ? step.kind : "command",
    secretOwnerId: step.secretOwnerId ?? null,
    aiInstruction: step.aiInstruction ?? null,
  };
}

interface TaskNodeData extends Record<string, unknown> {
  icon: ItIconName;
  color: string;
  label: string;
  sub: string;
  selected: boolean;
  source: boolean;
  target: boolean;
  mono: boolean;
}

function TaskNode({ data }: NodeProps<Node<TaskNodeData>>) {
  return (
    <div className={`au-node pb-node${data.selected ? " sel" : ""}${data.mono ? " mono" : ""}`}>
      {data.target ? <Handle type="target" position={Position.Left} className="au-handle" /> : null}
      <span className="au-node-ic" style={{ background: data.color }}><ItIcon name={data.icon} size={15} /></span>
      <span className="au-node-tx"><span className="au-node-lab">{data.label}</span><span className="au-node-sub">{data.sub}</span></span>
      {data.source ? <Handle type="source" position={Position.Right} className="au-handle" /> : null}
    </div>
  );
}

interface TaskEdgeData extends Record<string, unknown> {
  insertIndex: number;
  onInsert: (index: number, kind: EditorStep["kind"]) => void;
  label: string;
  optionLabels: Record<EditorStep["kind"], string>;
}

function TaskEdge({ id, sourceX, sourceY, targetX, targetY, markerEnd, data }: EdgeProps<Edge<TaskEdgeData>>) {
  const [open, setOpen] = useState(false);
  const controlRef = useRef<HTMLDivElement>(null);
  const [path, labelX, labelY] = getStraightPath({ sourceX, sourceY, targetX, targetY });

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!controlRef.current?.contains(event.target as globalThis.Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePress);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const kinds: EditorStep["kind"][] = ["command", "sudo", "ai"];
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} className="au-edge" />
      <EdgeLabelRenderer>
        <div
          ref={controlRef}
          className="pb-edge-control nodrag nopan"
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
        >
          <button
            type="button"
            className="pb-edge-add nodrag nopan"
            aria-label={data?.label}
            title={data?.label}
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={(event) => { event.stopPropagation(); setOpen((current) => !current); }}
          >+</button>
          {open && data ? (
            <div className="pb-edge-picker nodrag nopan" role="menu" aria-label={data.label} onClick={(event) => event.stopPropagation()}>
              {kinds.map((kind) => (
                <button
                  key={kind}
                  type="button"
                  role="menuitem"
                  onClick={(event) => {
                    event.stopPropagation();
                    data.onInsert(data.insertIndex, kind);
                    setOpen(false);
                  }}
                >
                  <span className={`pb-edge-picker-icon ${kind}`}>
                    <ItIcon name={kind === "sudo" ? "ssh" : kind === "ai" ? "bot" : "code"} size={14} />
                  </span>
                  {data.optionLabels[kind]}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

function SudoCredentialInput({ ownerId, stored, drafts, onValidityChange, placeholder }: {
  ownerId: string;
  stored: boolean;
  drafts: MutableRefObject<Record<string, string>>;
  onValidityChange: (valid: boolean) => void;
  placeholder: string;
}) {
  const [value, setValue] = useState(() => drafts.current[ownerId] ?? "");
  return <TextInput type="password" value={value} placeholder={placeholder} onChange={(event) => {
    const next = event.currentTarget.value;
    const wasValid = stored || value.trim().length > 0;
    const isValid = stored || next.trim().length > 0;
    drafts.current[ownerId] = next;
    setValue(next);
    if (wasValid !== isValid) onValidityChange(isValid);
  }} />;
}

function ApplicableOsPicker({ value, onChange }: { value: TaskOperatingSystem[]; onChange: (next: TaskOperatingSystem[]) => void }) {
  const { t } = useTranslation();
  function toggle(os: TaskOperatingSystem) {
    if (os === "any") {
      onChange(["any"]);
      return;
    }
    const withoutAny = value.filter((entry) => entry !== "any");
    const next = withoutAny.includes(os)
      ? withoutAny.filter((entry) => entry !== os)
      : [...withoutAny, os];
    onChange(normalizeTaskOperatingSystems(next));
  }
  return (
    <div className="pb-os-picker" role="group" aria-label={t("itops.tasks.applicableOsLabel")}>
      {TASK_OPERATING_SYSTEMS.map((os) => (
        <button key={os} type="button" role="checkbox" aria-checked={value.includes(os)} className={value.includes(os) ? "active" : ""} onClick={() => toggle(os)}>
          {taskOsLabel(t, os)}
        </button>
      ))}
    </div>
  );
}

const taskNodeTypes = { task: TaskNode };
const taskEdgeTypes = { insert: TaskEdge };

function TaskEditor({ task, onClose }: { task: ItopsTask | null; onClose: () => void }) {
  const { t } = useTranslation();
  const createTask = useItOpsStore((state) => state.createTask);
  const updateTask = useItOpsStore((state) => state.updateTask);
  const showStatusBarNotice = useWorkspaceStore((state) => state.showStatusBarNotice);
  const initialMode: TaskMode = task?.task.kind ?? "script";
  const script = task?.task.kind === "script" ? task.task : null;
  const [name, setName] = useState(task?.name ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [applicableOs, setApplicableOs] = useState<TaskOperatingSystem[]>(() =>
    normalizeTaskOperatingSystems(task?.applicableOs ?? ["any"]),
  );
  const [mode, setMode] = useState<TaskMode>(initialMode);
  const [body, setBody] = useState(script?.body ?? "");
  const [shell, setShell] = useState(script?.shell ?? "");
  const [steps, setSteps] = useState<EditorStep[]>(() => task?.task.kind === "playbook" ? task.task.steps.map(normalizeStep) : [commandStep()]);
  const [selectedId, setSelectedId] = useState(() => steps[0]?.id ?? "start");
  const secretDrafts = useRef<Record<string, string>>({});
  const [secretDraftValidity, setSecretDraftValidity] = useState<Record<string, boolean>>({});
  const [secretPresence, setSecretPresence] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const selectedStep = steps.find((step) => step.id === selectedId) ?? null;

  useEffect(() => {
    const ownerIds = steps
      .filter((step) => step.kind === "sudo")
      .map((step) => step.secretOwnerId)
      .filter((ownerId): ownerId is string => !!ownerId);
    for (const ownerId of ownerIds) {
      if (ownerId in secretPresence) continue;
      void invokeCommand("secret_exists", { request: { kind: "itopsTaskSecret", ownerId } })
        .then((result) => setSecretPresence((current) => ({ ...current, [ownerId]: result.exists })))
        .catch(() => setSecretPresence((current) => ({ ...current, [ownerId]: false })));
    }
  }, [secretPresence, steps]);

  const ready = useMemo(() => {
    if (!name.trim() || busy) return false;
    if (mode === "script") return body.trim().length > 0;
    if (steps.length === 0) return false;
    return steps.every((step) => {
      if (step.kind === "command") return step.send.trim().length > 0;
      if (step.kind === "ai") return !!step.aiInstruction?.trim();
      const ownerId = step.secretOwnerId ?? "";
      return !!ownerId && (secretPresence[ownerId] || secretDraftValidity[ownerId]);
    });
  }, [body, busy, mode, name, secretDraftValidity, secretPresence, steps]);

  const nodes = useMemo<Node<TaskNodeData>[]>(() => {
    const list: Node<TaskNodeData>[] = [{
      id: "start", type: "task", position: { x: 0, y: 150 }, draggable: false,
      data: { icon: "run", color: IT_ACCENTS.green, label: t("itops.tasks.startNode"), sub: t("itops.tasks.startNodeSub"), selected: selectedId === "start", source: true, target: false, mono: false },
    }];
    steps.forEach((step, index) => {
      const isSudo = step.kind === "sudo";
      const isAi = step.kind === "ai";
      const ownerId = step.secretOwnerId ?? "";
      list.push({
        id: step.id, type: "task", position: { x: 266 + index * 266, y: 150 }, draggable: false,
        data: {
          icon: isSudo ? "ssh" : isAi ? "bot" : "code",
          color: isSudo ? IT_ACCENTS.orange : isAi ? IT_ACCENTS.purple : IT_ACCENTS.blue,
          label: step.name.trim() || (isSudo ? t("itops.tasks.sudoNode") : isAi ? t("itops.tasks.aiNode") : t("itops.tasks.commandNode")),
          sub: isSudo ? (secretPresence[ownerId] ? t("itops.tasks.credentialStored") : t("itops.tasks.credentialRequired")) : isAi ? (step.aiInstruction?.trim() || t("itops.tasks.aiUnset")) : (step.send.trim() || t("itops.tasks.commandUnset")),
          selected: selectedId === step.id, source: true, target: true, mono: step.kind === "command",
        },
      });
    });
    list.push({
      id: "end", type: "task", position: { x: 266 + steps.length * 266, y: 150 }, draggable: false,
      data: { icon: "stop", color: IT_ACCENTS.teal, label: t("itops.tasks.endNode"), sub: t("itops.tasks.endNodeSub"), selected: selectedId === "end", source: false, target: true, mono: false },
    });
    return list;
  }, [secretPresence, selectedId, steps, t]);

  function insertStepAt(index: number, kind: EditorStep["kind"]) {
    const next = kind === "sudo" ? sudoStep() : kind === "ai" ? aiStep() : commandStep();
    setSteps((current) => [...current.slice(0, index), next, ...current.slice(index)]);
    setSelectedId(next.id);
  }

  const edges = useMemo<Edge<TaskEdgeData>[]>(() => {
    const ids = ["start", ...steps.map((step) => step.id), "end"];
    return ids.slice(0, -1).map((source, index) => ({
      id: `task-edge-${index}`,
      source,
      target: ids[index + 1],
      type: "insert",
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
      data: {
        insertIndex: index,
        onInsert: insertStepAt,
        label: t("itops.tasks.addNode"),
        optionLabels: {
          command: t("itops.tasks.addCommand"),
          sudo: t("itops.tasks.addSudo"),
          ai: t("itops.tasks.addAi"),
        },
      },
    }));
  }, [steps, t]);

  function updateSelected(patch: Partial<EditorStep>) {
    if (!selectedStep) return;
    setSteps((current) => current.map((step) => step.id === selectedStep.id ? { ...step, ...patch } : step));
  }

  const scriptLineCount = Math.max(body.split("\n").length, 16);

  function addStep(kind: EditorStep["kind"]) {
    const next = kind === "sudo" ? sudoStep() : kind === "ai" ? aiStep() : commandStep();
    setSteps((current) => [...current, next]);
    setSelectedId(next.id);
  }

  async function storePendingSecrets(storedOwnerIds: string[]): Promise<void> {
    const activeOwnerIds = new Set(
      steps
        .filter((step) => step.kind === "sudo")
        .map((step) => step.secretOwnerId)
        .filter((ownerId): ownerId is string => !!ownerId),
    );
    for (const [ownerId, secret] of Object.entries(secretDrafts.current)) {
      if (!activeOwnerIds.has(ownerId) || !secret.trim()) continue;
      await invokeCommand("store_secret", { request: { kind: "itopsTaskSecret", ownerId, secret } });
      storedOwnerIds.push(ownerId);
      setSecretPresence((current) => ({ ...current, [ownerId]: true }));
    }
  }

  async function save() {
    if (!ready) return;
    setBusy(true);
    const storedOwnerIds: string[] = [];
    const next: BatchTask = mode === "script"
      ? { kind: "script", body, shell: shell.trim() || null }
      : {
          kind: "playbook",
          name: name.trim(),
          steps: steps.map((step) => ({
            id: step.id,
            kind: step.kind,
            name: step.name.trim(),
            send: step.kind === "command" ? step.send : "",
            expect: step.expect?.trim() || null,
            timeoutSeconds: step.timeoutSeconds ?? null,
            secretOwnerId: step.kind === "sudo" ? step.secretOwnerId : null,
            aiInstruction: step.kind === "ai" ? step.aiInstruction?.trim() || null : null,
          })),
        };
    try {
      await storePendingSecrets(storedOwnerIds);
      if (task) await updateTask(task.id, name, description, applicableOs, next);
      else await createTask(name, description, applicableOs, next);
      showStatusBarNotice(t("itops.tasks.savedNotice", { name: name.trim() }), { tone: "success" });
      onClose();
    } catch (error) {
      if (!task) {
        await Promise.allSettled(
          storedOwnerIds.map((ownerId) =>
            invokeCommand("delete_secret", { request: { kind: "itopsTaskSecret", ownerId } }),
          ),
        );
      }
      const message = error instanceof Error ? error.message : String(error);
      showStatusBarNotice(t("itops.errorNotice", { message }), { tone: "error" });
      setBusy(false);
    }
  }

  return (
    <DialogShell onBackdrop={onClose}>
      <div className="au-editor pb-editor kk-surface" role="dialog" aria-modal="true" aria-label={task ? t("itops.tasks.editTitle") : t("itops.tasks.newTitle")}>
        <div className="au-editor-head">
          <span className="au-editor-tile"><ItIcon name="book" size={17} /></span>
          <strong className="pb-editor-title">{task ? t("itops.tasks.editTitle") : t("itops.tasks.newTitle")}</strong>
          <label className="pb-editor-name"><span>{t("itops.tasks.nameLabel")}</span><input className="au-editor-name" value={name} placeholder={t("itops.tasks.namePlaceholder")} onChange={(event) => setName(event.currentTarget.value)} /></label>
          <Segmented value={mode} onChange={(value) => setMode(value as TaskMode)} options={[{ value: "script", label: t("itops.tasks.kind.script") }, { value: "playbook", label: t("itops.tasks.kind.playbook") }]} />
        </div>
        <div className="pb-os-field">
          <div><strong>{t("itops.tasks.applicableOsLabel")}</strong><span>{t("itops.tasks.applicableOsHint")}</span></div>
          <ApplicableOsPicker value={applicableOs} onChange={setApplicableOs} />
        </div>
        {mode === "script" ? (
          <div className="pb-script-editor">
            <div className="pb-script-meta">
              <Field label={t("itops.tasks.descriptionLabel")}><TextInput value={description} onChange={(event) => setDescription(event.currentTarget.value)} /></Field>
              <Field label={t("itops.tasks.shellLabel")}><TextInput mono value={shell} placeholder={t("itops.tasks.shellPlaceholder")} onChange={(event) => setShell(event.currentTarget.value)} /></Field>
            </div>
            <div className="pb-script-main">
              <span className="pb-script-label">{t("itops.tasks.scriptLabel")}<span aria-hidden="true">*</span></span>
              <div className="pb-code-editor">
                <div className="pb-code-gutter" aria-hidden="true">
                  {Array.from({ length: scriptLineCount }, (_, index) => <span key={index}>{index + 1}</span>)}
                </div>
                <TextArea className="mono pb-script-body" value={body} spellCheck={false} onChange={(event) => setBody(event.currentTarget.value)} />
              </div>
            </div>
          </div>
        ) : (
          <div className="au-editor-body">
            <div className="au-canvas pb-canvas">
              <ReactFlow nodes={nodes} edges={edges} nodeTypes={taskNodeTypes} edgeTypes={taskEdgeTypes} onNodeClick={(_event, node) => setSelectedId(node.id)} onPaneClick={() => setSelectedId("")} nodesConnectable={false} nodesDraggable={false} edgesFocusable={false} deleteKeyCode={null} fitView proOptions={{ hideAttribution: true }}>
                <Background variant={BackgroundVariant.Dots} gap={18} size={1} /><Controls showInteractive={false} />
              </ReactFlow>
              <div className="pb-add-node"><span>{t("itops.tasks.addNode")}</span><Btn sm icon="plus" onClick={() => addStep("command")}>{t("itops.tasks.addCommand")}</Btn><Btn sm icon="plus" onClick={() => addStep("sudo")}>{t("itops.tasks.addSudo")}</Btn><Btn sm icon="plus" onClick={() => addStep("ai")}>{t("itops.tasks.addAi")}</Btn></div>
            </div>
            <aside className="au-side"><div className="au-side-in">
              {selectedStep ? (
                <>
                  <div className="pb-side-heading"><span className={`pb-side-icon ${selectedStep.kind}`}><ItIcon name={selectedStep.kind === "sudo" ? "ssh" : selectedStep.kind === "ai" ? "bot" : "code"} size={16} /></span><div><div className="au-side-title">{selectedStep.kind === "sudo" ? t("itops.tasks.sudoNode") : selectedStep.kind === "ai" ? t("itops.tasks.aiNode") : t("itops.tasks.commandNode")}</div><p className="au-side-hint">{selectedStep.kind === "sudo" ? t("itops.tasks.sudoNodeHint") : selectedStep.kind === "ai" ? t("itops.tasks.aiNodeHint") : t("itops.tasks.commandNodeHint")}</p></div></div>
                  <Field label={t("itops.batchRuns.stepNameLabel")}><TextInput value={selectedStep.name} placeholder={t("itops.batchRuns.stepNamePlaceholder")} onChange={(event) => updateSelected({ name: event.currentTarget.value })} /></Field>
                  {selectedStep.kind === "command" ? <Field label={t("itops.tasks.commandLabel")} req><TextArea className="mono" rows={5} value={selectedStep.send} spellCheck={false} placeholder={t("itops.tasks.commandPlaceholder")} onChange={(event) => updateSelected({ send: event.currentTarget.value })} /></Field> : null}
                  {selectedStep.kind === "ai" ? <><Field label={t("itops.tasks.aiInstructionLabel")} req hint={t("itops.tasks.aiInstructionHint")}><TextArea rows={6} value={selectedStep.aiInstruction ?? ""} placeholder={t("itops.tasks.aiInstructionPlaceholder")} onChange={(event) => updateSelected({ aiInstruction: event.currentTarget.value })} /></Field><div className="pb-ai-contract"><strong>{t("itops.tasks.aiDecisionHeading")}</strong><span><code>continue</code>{t("itops.tasks.aiDecisionContinue")}</span><span><code>success</code>{t("itops.tasks.aiDecisionSuccess")}</span><span><code>fail</code>{t("itops.tasks.aiDecisionFail")}</span></div><p className="au-side-hint">{t("itops.tasks.aiInputHint")}</p></> : null}
                  {selectedStep.kind === "sudo" ? (
                    <>
                      <Field label={t("itops.tasks.promptLabel")} req hint={t("itops.tasks.promptHint")}><TextInput mono value={selectedStep.expect ?? ""} onChange={(event) => updateSelected({ expect: event.currentTarget.value })} /></Field>
                      <Field label={t("itops.tasks.credentialLabel")} req hint={t("itops.tasks.credentialHint")}>
                        <SudoCredentialInput ownerId={selectedStep.secretOwnerId ?? ""} stored={!!secretPresence[selectedStep.secretOwnerId ?? ""]} drafts={secretDrafts} placeholder={secretPresence[selectedStep.secretOwnerId ?? ""] ? t("itops.tasks.credentialStoredPlaceholder") : t("itops.tasks.credentialPlaceholder")} onValidityChange={(valid) => setSecretDraftValidity((current) => ({ ...current, [selectedStep.secretOwnerId ?? ""]: valid }))} />
                      </Field>
                      <div className={`pb-secret-state ${secretPresence[selectedStep.secretOwnerId ?? ""] ? "stored" : "missing"}`}><ItIcon name={secretPresence[selectedStep.secretOwnerId ?? ""] ? "check" : "alert"} size={13} />{secretPresence[selectedStep.secretOwnerId ?? ""] ? t("itops.tasks.credentialStoredDetail") : t("itops.tasks.credentialMissingDetail")}</div>
                      <p className="au-side-hint">{t("itops.tasks.sudoCacheHint")}</p>
                    </>
                  ) : selectedStep.kind === "command" ? <Field label={t("itops.batchRuns.stepExpectLabel")} hint={t("itops.batchRuns.stepExpectHint")}><TextInput mono value={selectedStep.expect ?? ""} onChange={(event) => updateSelected({ expect: event.currentTarget.value })} /></Field> : null}
                  <Field label={t("itops.batchRuns.stepTimeoutLabel")}><TextInput type="number" min={1} value={selectedStep.timeoutSeconds == null ? "" : String(selectedStep.timeoutSeconds)} placeholder={t("itops.batchRuns.stepTimeoutPlaceholder")} onChange={(event) => { const raw = event.currentTarget.value; updateSelected({ timeoutSeconds: raw ? Number(raw) : null }); }} /></Field>
                  <Btn kind="danger" icon="trash" onClick={() => { setSteps((current) => current.filter((step) => step.id !== selectedStep.id)); setSelectedId("start"); }}>{t("itops.tasks.removeNode")}</Btn>
                </>
              ) : <><div className="au-side-title">{t("itops.tasks.workflowHeading")}</div><p className="au-side-hint">{t("itops.tasks.workflowHint")}</p><Field label={t("itops.tasks.descriptionLabel")}><TextArea rows={4} value={description} onChange={(event) => setDescription(event.currentTarget.value)} /></Field></>}
            </div></aside>
          </div>
        )}
        <div className="pb-editor-foot">
          <Actions
            cancel={<Btn onClick={onClose}>{t("itops.actions.cancel")}</Btn>}
            primary={<Btn kind="primary" icon="check" onClick={() => void save()} disabled={!ready}>{t("itops.actions.save")}</Btn>}
          />
        </div>
      </div>
    </DialogShell>
  );
}

function taskKind(task: ItopsTask): "script" | "playbook" {
  return task.task.kind;
}

export function TaskLibrary({ onOpenRunHistory }: { onOpenRunHistory: (siteId: string) => void }) {
  const { t } = useTranslation();
  const tasks = useItOpsStore((state) => state.tasks);
  const loaded = useItOpsStore((state) => state.tasksLoaded);
  const loadTasks = useItOpsStore((state) => state.loadTasks);
  const createTask = useItOpsStore((state) => state.createTask);
  const removeTask = useItOpsStore((state) => state.removeTask);
  const runHistory = useItOpsStore((state) => state.runHistory);
  const historyLoaded = useItOpsStore((state) => state.historyLoaded);
  const loadRunHistory = useItOpsStore((state) => state.loadRunHistory);
  const showStatusBarNotice = useWorkspaceStore((state) => state.showStatusBarNotice);
  const [query, setQuery] = useState("");
  const [osFilter, setOsFilter] = useState<TaskOperatingSystem>("any");
  const [editor, setEditor] = useState<ItopsTask | null | undefined>(undefined);
  const [pendingDelete, setPendingDelete] = useState<ItopsTask | null>(null);

  useEffect(() => { if (!loaded) void loadTasks(); }, [loaded, loadTasks]);
  useEffect(() => { if (!historyLoaded) void loadRunHistory(); }, [historyLoaded, loadRunHistory]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return tasks.filter((task) => {
      const matchesOs = osFilter === "any" || task.applicableOs.includes("any") || task.applicableOs.includes(osFilter);
      const haystack = `${taskDisplayName(t, task)} ${task.description} ${task.applicableOs.map((os) => taskOsLabel(t, os)).join(" ")}`.toLowerCase();
      return matchesOs && (!needle || haystack.includes(needle));
    });
  }, [osFilter, query, t, tasks]);
  const taskStats = useMemo(() => {
    const stats = new Map<string, { executions: number; failures: number; lastSiteId: string | null }>();
    for (const run of runHistory) {
      if (!run.taskId) continue;
      const current = stats.get(run.taskId) ?? { executions: 0, failures: 0, lastSiteId: null };
      current.executions += 1;
      current.failures += run.report.failed;
      current.lastSiteId ??= run.siteId ?? null;
      stats.set(run.taskId, current);
    }
    return stats;
  }, [runHistory]);

  async function confirmDelete() {
    if (!pendingDelete) return;
    const task = pendingDelete;
    setPendingDelete(null);
    try {
      await removeTask(task.id);
      showStatusBarNotice(t("itops.tasks.deletedNotice", { name: task.name }), { tone: "success" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showStatusBarNotice(t("itops.errorNotice", { message }), { tone: "error" });
    }
  }

  async function duplicateBuiltin(task: ItopsTask) {
    try {
      const name = t("itops.tasks.duplicateName", { name: taskDisplayName(t, task) });
      const created = await createTask(name, task.description, task.applicableOs, task.task);
      setEditor(created);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showStatusBarNotice(t("itops.errorNotice", { message }), { tone: "error" });
    }
  }

  return (
    <div className="it-task-library-page it-destination-surface" data-tutorial-id="itops.taskLibrary">
      <div className="it-destination-page-head">
        <div>
          <h2>{t("itops.tasks.heading")}</h2>
          <p>{t("itops.tasks.pageDescription")}</p>
        </div>
        <button type="button" className="it-btn primary" data-tutorial-id="itops.taskLibraryNew" onClick={() => setEditor(null)}>
          <ItIcon name="plus" size={14} />
          {t("itops.tasks.newTitle")}
        </button>
      </div>
      <div className="it-task-table-shell">
        <div className="it-task-toolbar"><label className="it-task-search">
            <ItIcon name="search" size={13} />
            <input value={query} placeholder={t("itops.tasks.searchPlaceholder")} onChange={(event) => setQuery(event.currentTarget.value)} />
        </label><div className="it-task-os-filter" role="group" aria-label={t("itops.tasks.applicableOsLabel")}>
          {TASK_OPERATING_SYSTEMS.map((os) => <button key={os} type="button" className={osFilter === os ? "active" : ""} onClick={() => setOsFilter(os)}>{taskOsLabel(t, os)}</button>)}
        </div></div>
        {filtered.length ? <div className="it-task-table" role="table">
          <div className="it-task-table-head" role="row">
            <span>{t("itops.tasks.columnName")}</span><span>{t("itops.tasks.columnType")}</span><span>{t("itops.tasks.columnOs")}</span><span>{t("itops.tasks.columnExecutions")}</span><span>{t("itops.tasks.columnFailures")}</span><span>{t("itops.tasks.columnHistory")}</span><span>{t("itops.tasks.columnActions")}</span>
          </div>
          {filtered.map((task) => {
            const stats = taskStats.get(task.id) ?? { executions: 0, failures: 0, lastSiteId: null };
            return <div key={task.id} className="it-task-table-row" data-tutorial-id={`itops.task:${task.id}`} role="row">
              <span className="it-task-table-name"><span className="it-task-row-icon"><ItIcon name={taskKind(task) === "script" ? "code" : "book"} size={15} /></span><span><strong>{taskDisplayName(t, task)}{task.builtInKey ? <em>{t("itops.tasks.builtInBadge")}</em> : null}</strong><small>{task.description || t("itops.tasks.noDescription")}</small></span></span>
              <span>{t(`itops.tasks.kind.${taskKind(task)}`)}</span>
              <span className="it-task-os-list">{task.applicableOs.map((os) => <small key={os}>{taskOsLabel(t, os)}</small>)}</span>
              <span className="it-task-number">{stats.executions}</span>
              <span className={stats.failures ? "it-task-number failed" : "it-task-number"}>{stats.failures}</span>
              <span><button type="button" className="it-task-history-link" disabled={!stats.lastSiteId} onClick={() => stats.lastSiteId && onOpenRunHistory(stats.lastSiteId)}>{t("itops.tasks.viewHistory")}</button></span>
              <span className="it-task-row-actions">{task.builtInKey ? <button type="button" className="it-icon-btn" aria-label={t("itops.tasks.duplicateBuiltin")} onClick={() => void duplicateBuiltin(task)}><ItIcon name="plus" size={14} /></button> : <><button type="button" className="it-icon-btn" aria-label={t("itops.actions.edit")} onClick={() => setEditor(task)}><ItIcon name="edit" size={14} /></button><button type="button" className="it-icon-btn" aria-label={t("itops.actions.delete")} onClick={() => setPendingDelete(task)}><ItIcon name="trash" size={14} /></button></>}</span>
            </div>;
          })}
        </div> : loaded ? <ItOpsEmptyHint>{t("itops.tasks.emptyBody")}</ItOpsEmptyHint> : null}
      </div>

      {editor !== undefined ? <TaskEditor task={editor} onClose={() => setEditor(undefined)} /> : null}
      {pendingDelete ? <ConfirmSheet tone="danger" title={t("itops.tasks.deleteTitle")} message={t("itops.tasks.deleteBody", { name: pendingDelete.name })} confirmLabel={t("itops.actions.delete")} confirmIcon="trash" onConfirm={() => void confirmDelete()} onCancel={() => setPendingDelete(null)} /> : null}
    </div>
  );
}
