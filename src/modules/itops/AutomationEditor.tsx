// Automation node editor (docs/ITOPS.md) — an n8n-style visual canvas over the
// closed trigger → condition → action[] model. The structure is fixed (no
// free-form DAG, per docs/ITOPS.md), but each part is a draggable node wired
// left-to-right; selecting a node edits it in the side panel. A "Test" button
// samples the trigger once and dry-runs the actions (itops_test_automation).
//
// Built on @xyflow/react. Nodes are controlled (positions live in `positions`
// state, updated on drag) so editing a field never resets the layout.

import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { Btn, DialogShell, Field, Select, TextArea, TextInput } from "../../app/ui/dialog";
import { useWorkspaceStore } from "../../store";
import type {
  Automation,
  AutomationAction,
  AutomationTestResult,
  NotifyLevel,
} from "../../types";
import type { PerformanceMetric, PredicateOp, WatchdogConfig } from "../../watchdog/types";
import { ItIcon, IT_ACCENTS, type ItIconName } from "./icons";
import { useItOpsStore } from "./state";

const METRICS: PerformanceMetric[] = [
  "cpuPercent",
  "ramPercent",
  "commitPercent",
  "diskFreePercent",
  "diskUsedPercent",
  "networkDownBytesPerSec",
  "networkUpBytesPerSec",
  "appWorkingSetBytes",
  "appPrivateBytes",
  "handleCount",
  "processCount",
  "threadCount",
];

type Op = "gt" | "lt" | "gte" | "lte" | "eq" | "ne";
const OPS: { value: Op; label: string }[] = [
  { value: "gt", label: ">" },
  { value: "lt", label: "<" },
  { value: "gte", label: "≥" },
  { value: "lte", label: "≤" },
  { value: "eq", label: "=" },
  { value: "ne", label: "≠" },
];

type ActionKind = AutomationAction["kind"];
const ACTION_KINDS: ActionKind[] = ["notify", "popup", "email", "webhook", "runBatch"];
const NOTIFY_LEVELS: NotifyLevel[] = ["inApp", "toast", "sound"];
const HTTP_METHODS = ["POST", "GET", "PUT", "PATCH", "DELETE"];

type TriggerType =
  | "mock"
  | "performanceCounter"
  | "schedule"
  | "logFile"
  | "ping"
  | "tcpReachable"
  | "sshSessionOutputSilence"
  | "outputMatch";
// Trigger types whose firing is a sampled value compared by an editable
// condition; schedule / logFile fire on a match and carry no condition node.
const CONDITIONAL: TriggerType[] = ["mock", "performanceCounter", "ping", "tcpReachable"];

const ACTION_ICON: Record<ActionKind, ItIconName> = {
  notify: "bell",
  popup: "popup",
  email: "mail",
  webhook: "webhook",
  runBatch: "run",
};
const ACTION_COLOR: Record<ActionKind, string> = {
  notify: IT_ACCENTS.blue,
  popup: IT_ACCENTS.teal,
  email: IT_ACCENTS.green,
  webhook: IT_ACCENTS.indigo,
  runBatch: IT_ACCENTS.orange,
};

interface EditorState {
  name: string;
  /** Durable Site binding; "" = unbound. */
  siteId: string;
  triggerType: TriggerType;
  metric: PerformanceMetric;
  mockStep: string;
  op: Op;
  threshold: string;
  pollSeconds: string;
  cron: string;
  logPath: string;
  logPattern: string;
  host: string;
  port: string;
  sessionId: string;
  sessionPattern: string;
  silenceSeconds: string;
  actions: AutomationAction[];
}

function defaultState(defaultSiteId = ""): EditorState {
  return {
    name: "",
    siteId: defaultSiteId,
    triggerType: "performanceCounter",
    metric: "diskUsedPercent",
    mockStep: "1",
    op: "gt",
    threshold: "85",
    pollSeconds: "60",
    cron: "0 3 * * *",
    logPath: "",
    logPattern: "",
    host: "",
    port: "",
    sessionId: "",
    sessionPattern: "",
    silenceSeconds: "120",
    actions: [{ kind: "notify", level: "toast" }],
  };
}

// Reconstruct editor state from a saved Automation so it can be edited.
function fromAutomation(automation: Automation): EditorState {
  const base = defaultState();
  base.name = automation.name;
  base.siteId = automation.siteId ?? "";
  base.actions = automation.actions.length > 0 ? automation.actions : [];
  base.pollSeconds = String(Math.max(1, Math.round(automation.config.pollMs / 1000)));
  const target = automation.config.target;
  const predicate = automation.config.trigger.predicate;
  const readOp = (): Op =>
    predicate.op === "gt" ||
    predicate.op === "lt" ||
    predicate.op === "gte" ||
    predicate.op === "lte" ||
    predicate.op === "eq" ||
    predicate.op === "ne"
      ? predicate.op
      : "gt";
  const readValue = (): string =>
    "value" in predicate && typeof predicate.value === "number" ? String(predicate.value) : "0";
  switch (target.kind) {
    case "mock":
      base.triggerType = "mock";
      base.mockStep = String(target.step ?? 1);
      base.op = readOp();
      base.threshold = readValue();
      break;
    case "performanceCounter":
      base.triggerType = "performanceCounter";
      base.metric = target.metric;
      base.op = readOp();
      base.threshold = readValue();
      break;
    case "schedule":
      base.triggerType = "schedule";
      base.cron = target.cron;
      break;
    case "logFile":
      base.triggerType = "logFile";
      base.logPath = target.path;
      base.logPattern = target.pattern;
      break;
    case "ping":
      base.triggerType = "ping";
      base.host = target.host;
      base.port = target.port != null ? String(target.port) : "";
      base.op = readOp();
      base.threshold = readValue();
      break;
    case "tcpReachable":
      base.triggerType = "tcpReachable";
      base.host = target.host;
      base.port = String(target.port);
      base.op = readOp();
      base.threshold = readValue();
      break;
    case "sshSessionOutputSilence":
      base.triggerType = "sshSessionOutputSilence";
      base.sessionId = target.sessionId;
      base.silenceSeconds =
        predicate.op === "silenceFor" ? String(Math.max(1, predicate.ms / 1000)) : "120";
      break;
    case "outputMatch":
      base.triggerType = "outputMatch";
      base.sessionId = target.sessionId;
      base.sessionPattern = target.pattern;
      break;
  }
  return base;
}

function hasCondition(triggerType: TriggerType): boolean {
  return CONDITIONAL.includes(triggerType);
}

function isValid(state: EditorState): boolean {
  if (state.name.trim().length === 0) return false;
  const poll = Number(state.pollSeconds);
  const threshold = Number(state.threshold);
  const pollOk = Number.isFinite(poll) && poll >= 1;
  switch (state.triggerType) {
    case "mock":
      return pollOk && Number.isFinite(threshold) && Number.isFinite(Number(state.mockStep));
    case "performanceCounter":
      return pollOk && Number.isFinite(threshold);
    case "ping":
      return pollOk && Number.isFinite(threshold) && state.host.trim().length > 0;
    case "tcpReachable": {
      const port = Number(state.port);
      return (
        pollOk &&
        Number.isFinite(threshold) &&
        state.host.trim().length > 0 &&
        Number.isInteger(port) &&
        port >= 1 &&
        port <= 65535
      );
    }
    case "schedule":
      return state.cron.trim().split(/\s+/).length === 5;
    case "logFile":
      return state.logPath.trim().length > 0 && state.logPattern.length > 0;
    case "sshSessionOutputSilence": {
      const silence = Number(state.silenceSeconds);
      return (
        pollOk &&
        state.sessionId.trim().length > 0 &&
        Number.isFinite(silence) &&
        silence >= 1
      );
    }
    case "outputMatch":
      return pollOk && state.sessionId.trim().length > 0 && state.sessionPattern.length > 0;
  }
}

// Turn editor state into the durable WatchdogConfig the backend stores.
function buildConfig(state: EditorState, existing?: WatchdogConfig): WatchdogConfig {
  const threshold = Number(state.threshold);
  const pollMs = Math.max(500, Math.round(Number(state.pollSeconds) * 1000));
  const predicate: PredicateOp = { op: state.op, value: threshold } as PredicateOp;
  let target: WatchdogConfig["target"];
  let trigger: WatchdogConfig["trigger"];
  let poll = pollMs;
  switch (state.triggerType) {
    case "mock":
      target = { kind: "mock", step: Number(state.mockStep) };
      trigger = { predicate };
      break;
    case "performanceCounter":
      target = { kind: "performanceCounter", metric: state.metric };
      trigger = { predicate };
      break;
    case "ping":
      target = {
        kind: "ping",
        host: state.host.trim(),
        port: state.port.trim() ? Number(state.port) : undefined,
      };
      trigger = { predicate };
      break;
    case "tcpReachable":
      target = { kind: "tcpReachable", host: state.host.trim(), port: Number(state.port) };
      trigger = { predicate };
      break;
    case "schedule":
      target = { kind: "schedule", cron: state.cron.trim() };
      trigger = { predicate: { op: "gte", value: 1 } };
      poll = 30_000;
      break;
    case "logFile":
      target = { kind: "logFile", path: state.logPath.trim(), pattern: state.logPattern };
      trigger = { predicate: { op: "gte", value: 1 } };
      poll = 15_000;
      break;
    case "sshSessionOutputSilence":
      target = { kind: "sshSessionOutputSilence", sessionId: state.sessionId.trim() };
      trigger = {
        predicate: { op: "silenceFor", ms: Math.round(Number(state.silenceSeconds) * 1000) },
      };
      break;
    case "outputMatch":
      target = {
        kind: "outputMatch",
        sessionId: state.sessionId.trim(),
        pattern: state.sessionPattern,
      };
      trigger = { predicate: { op: "gte", value: 1 } };
      break;
  }
  return {
    ...existing,
    name: state.name.trim(),
    target,
    trigger: { ...existing?.trigger, ...trigger },
    pollMs: poll,
    stop: existing?.stop ?? { kind: "untilCanceled" },
    notification: existing?.notification ?? "inAppPlusToast",
    action: existing?.action ?? { kind: "notify" },
  };
}

// Monospace sub-label shown under the Trigger node, summarizing its target.
function triggerSubLabel(state: EditorState, t: TFunction): string {
  switch (state.triggerType) {
    case "mock":
      return t("watchdog.detail.targetMock");
    case "performanceCounter":
      return state.metric;
    case "schedule":
      return state.cron;
    case "logFile":
      return state.logPath || t("itops.editor.unset");
    case "ping":
      return state.host || t("itops.editor.unset");
    case "tcpReachable":
      return `${state.host || t("itops.editor.unset")}:${state.port || "?"}`;
    case "sshSessionOutputSilence":
    case "outputMatch":
      return state.sessionId || t("itops.editor.unset");
  }
}

function triggerIcon(triggerType: TriggerType): ItIconName {
  switch (triggerType) {
    case "mock":
      return "gauge";
    case "performanceCounter":
      return "gauge";
    case "schedule":
      return "calendar";
    case "logFile":
      return "book";
    case "ping":
    case "tcpReachable":
    case "sshSessionOutputSilence":
      return "pulse";
    case "outputMatch":
      return "regex";
  }
}

function defaultAction(kind: ActionKind, firstGroupId: string): AutomationAction {
  switch (kind) {
    case "notify":
      return { kind: "notify", level: "toast" };
    case "popup":
      return { kind: "popup", title: "", body: "" };
    case "email":
      return { kind: "email", to: [], subject: "", body: "" };
    case "webhook":
      return { kind: "webhook", url: "", method: "POST", body: null };
    case "runBatch":
      return { kind: "runBatch", siteId: firstGroupId, task: { kind: "script", body: "" } };
  }
}

/* ----------------------------- node views ------------------------------ */

interface FlowNodeData extends Record<string, unknown> {
  icon: ItIconName;
  color: string;
  label: string;
  sub: string;
  selected: boolean;
  source: boolean;
  target: boolean;
  onDelete?: () => void;
  deleteLabel?: string;
}

function NodeCard({ data }: NodeProps) {
  const d = data as FlowNodeData;
  return (
    <div className={`au-node${d.selected ? " sel" : ""}`}>
      {d.target ? <Handle type="target" position={Position.Left} className="au-handle" /> : null}
      <span className="au-node-ic" style={{ background: d.color }}>
        <ItIcon name={d.icon} size={16} sw={1.7} />
      </span>
      <div className="au-node-tx">
        <div className="au-node-lab">{d.label}</div>
        <div className="au-node-sub">{d.sub}</div>
      </div>
      {d.onDelete ? (
        <button
          type="button"
          className="au-node-del"
          onClick={(event) => {
            event.stopPropagation();
            d.onDelete?.();
          }}
          aria-label={d.deleteLabel}
        >
          <ItIcon name="xmark" size={12} />
        </button>
      ) : null}
      {d.source ? <Handle type="source" position={Position.Right} className="au-handle" /> : null}
    </div>
  );
}

const nodeTypes = { card: NodeCard };

export function AutomationEditor({
  automation,
  defaultSiteId,
  onClose,
}: {
  automation: Automation | null;
  /** Site binding preselected for a new Automation opened from its Site page. */
  defaultSiteId?: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const sites = useItOpsStore((state) => state.sites);
  const createAutomation = useItOpsStore((state) => state.createAutomation);
  const updateAutomation = useItOpsStore((state) => state.updateAutomation);
  const testAutomation = useItOpsStore((state) => state.testAutomation);
  const showStatusBarNotice = useWorkspaceStore((state) => state.showStatusBarNotice);
  const firstGroupId = sites[0]?.id ?? "";

  const [state, setState] = useState<EditorState>(() =>
    automation ? fromAutomation(automation) : defaultState(defaultSiteId),
  );
  const [selectedId, setSelectedId] = useState<string>("trigger");
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [busy, setBusy] = useState(false);
  const [testResult, setTestResult] = useState<AutomationTestResult | null>(null);
  const [testing, setTesting] = useState(false);

  const condition = hasCondition(state.triggerType);
  const update = useCallback((patch: Partial<EditorState>) => {
    setState((current) => ({ ...current, ...patch }));
    setTestResult(null);
  }, []);

  const removeAction = useCallback(
    (index: number) => {
      setState((current) => ({
        ...current,
        actions: current.actions.filter((_, i) => i !== index),
      }));
      setSelectedId("trigger");
      setTestResult(null);
    },
    [],
  );

  // Derive the node + edge graph from editor state. Positions come from the
  // drag-tracked `positions` map, falling back to a computed left-to-right layout.
  const nodes = useMemo<Node[]>(() => {
    const at = (id: string, x: number, y: number) => positions[id] ?? { x, y };
    const list: Node[] = [];
    list.push({
      id: "trigger",
      type: "card",
      position: at("trigger", 0, 140),
      data: {
        icon: triggerIcon(state.triggerType),
        color: IT_ACCENTS.orange,
        label: t("itops.editor.triggerNode"),
        sub: triggerSubLabel(state, t),
        selected: selectedId === "trigger",
        source: true,
        target: false,
      } satisfies FlowNodeData,
      draggable: true,
    });
    if (condition) {
      const symbol = OPS.find((entry) => entry.value === state.op)?.label ?? state.op;
      list.push({
        id: "condition",
        type: "card",
        position: at("condition", 250, 140),
        data: {
          icon: "filter",
          color: IT_ACCENTS.teal,
          label: t("itops.editor.conditionNode"),
          sub: `${symbol} ${state.threshold}`,
          selected: selectedId === "condition",
          source: true,
          target: true,
        } satisfies FlowNodeData,
        draggable: true,
      });
    }
    const actionX = condition ? 500 : 250;
    state.actions.forEach((action, index) => {
      const id = `action-${index}`;
      list.push({
        id,
        type: "card",
        position: at(id, actionX, index * 96),
        data: {
          icon: ACTION_ICON[action.kind],
          color: ACTION_COLOR[action.kind],
          label: t(
            `itops.automations.action${action.kind.charAt(0).toUpperCase()}${action.kind.slice(1)}`,
          ),
          sub: actionSummary(action, t),
          selected: selectedId === id,
          source: false,
          target: true,
          onDelete: () => removeAction(index),
          deleteLabel: t("itops.actions.delete"),
        } satisfies FlowNodeData,
        draggable: true,
      });
    });
    return list;
  }, [state, condition, selectedId, positions, removeAction, t]);

  const edges = useMemo<Edge[]>(() => {
    const sourceId = condition ? "condition" : "trigger";
    const list: Edge[] = [];
    if (condition) {
      list.push({ id: "e-trig-cond", source: "trigger", target: "condition", ...EDGE_STYLE });
    }
    state.actions.forEach((_, index) => {
      list.push({
        id: `e-${sourceId}-action-${index}`,
        source: sourceId,
        target: `action-${index}`,
        ...EDGE_STYLE,
      });
    });
    return list;
  }, [state.actions, condition]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setPositions((current) => {
      let next = current;
      for (const change of changes) {
        if (change.type === "position" && change.position) {
          if (next === current) next = { ...current };
          next[change.id] = change.position;
        }
      }
      return next;
    });
  }, []);

  function addAction() {
    setState((current) => ({
      ...current,
      actions: [...current.actions, defaultAction("notify", firstGroupId)],
    }));
    setSelectedId(`action-${state.actions.length}`);
    setTestResult(null);
  }

  async function handleTest() {
    if (!isValid(state)) return;
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testAutomation(buildConfig(state, automation?.config));
      setTestResult(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showStatusBarNotice(t("itops.errorNotice", { message }), { tone: "error" });
    } finally {
      setTesting(false);
    }
  }

  async function handleSave() {
    if (!isValid(state) || busy) return;
    setBusy(true);
    const config = buildConfig(state, automation?.config);
    try {
      const siteId = state.siteId || null;
      if (automation) {
        await updateAutomation(automation.id, state.name.trim(), config, state.actions, siteId);
      } else {
        await createAutomation(state.name.trim(), config, state.actions, true, siteId);
      }
      showStatusBarNotice(t("itops.automations.savedNotice", { name: state.name.trim() }), {
        tone: "success",
      });
      onClose();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showStatusBarNotice(t("itops.errorNotice", { message }), { tone: "error" });
      setBusy(false);
    }
  }

  const canSave = isValid(state) && !busy;

  return (
    <DialogShell onBackdrop={onClose}>
      <div
        className="au-editor kk-surface"
        role="dialog"
        aria-modal="true"
        aria-label={t("itops.editor.title")}
      >
        <div className="au-editor-head">
          <span className="au-editor-tile">
            <ItIcon name="auto" size={17} sw={1.7} />
          </span>
          <input
            className="au-editor-name"
            value={state.name}
            placeholder={t("itops.automations.namePlaceholder")}
            onChange={(event) => update({ name: event.currentTarget.value })}
            aria-label={t("itops.automations.nameLabel")}
          />
          <Select
            className="au-editor-site"
            value={state.siteId}
            aria-label={t("itops.editor.siteLabel")}
            title={t("itops.editor.siteLabel")}
            onChange={(event) => update({ siteId: event.currentTarget.value })}
            options={[
              { value: "", label: t("itops.editor.siteNone") },
              ...sites.map((site) => ({ value: site.id, label: site.name })),
            ]}
          />
          <span className="au-editor-sp" />
          <Btn onClick={() => void handleTest()} disabled={!isValid(state) || testing}>
            <span className="au-btn-ic">
              <ItIcon name="pulse" size={14} />
            </span>
            {testing ? t("itops.editor.testing") : t("itops.editor.test")}
          </Btn>
          <Btn onClick={onClose}>{t("itops.actions.cancel")}</Btn>
          <Btn kind="primary" onClick={() => void handleSave()} disabled={!canSave}>
            {automation ? t("itops.actions.save") : t("itops.actions.create")}
          </Btn>
        </div>

        <div className="au-editor-body">
          <div className="au-canvas">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              onNodeClick={(_event, node) => setSelectedId(node.id)}
              onPaneClick={() => setSelectedId("")}
              nodesConnectable={false}
              edgesFocusable={false}
              deleteKeyCode={null}
              fitView
              proOptions={{ hideAttribution: true }}
            >
              <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
              <Controls showInteractive={false} />
            </ReactFlow>
          </div>

          <div className="au-side">
            <SidePanel
              selectedId={selectedId}
              state={state}
              update={update}
              setState={setState}
              firstGroupId={firstGroupId}
              sites={sites}
              onAddAction={addAction}
              testResult={testResult}
            />
          </div>
        </div>
      </div>
    </DialogShell>
  );
}

const EDGE_STYLE = {
  markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
  className: "au-edge",
} as const;

function actionSummary(action: AutomationAction, t: TFunction): string {
  switch (action.kind) {
    case "notify":
      return action.level;
    case "popup":
      return action.title || t("itops.editor.unset");
    case "email":
      return action.to.length > 0 ? action.to.join(", ") : t("itops.editor.unset");
    case "webhook":
      return action.url ? `${action.method} ${action.url}` : t("itops.editor.unset");
    case "runBatch":
      return t("itops.editor.runBatchSub");
  }
}

/* ----------------------------- side panel ------------------------------ */

function SidePanel({
  selectedId,
  state,
  update,
  setState,
  firstGroupId,
  sites,
  onAddAction,
  testResult,
}: {
  selectedId: string;
  state: EditorState;
  update: (patch: Partial<EditorState>) => void;
  setState: React.Dispatch<React.SetStateAction<EditorState>>;
  firstGroupId: string;
  sites: { id: string; name: string }[];
  onAddAction: () => void;
  testResult: AutomationTestResult | null;
}) {
  const { t } = useTranslation();

  if (selectedId === "trigger") {
    return (
      <div className="au-side-in">
        <div className="au-side-title">{t("itops.editor.triggerNode")}</div>
        <Field label={t("itops.automations.triggerTypeLabel")} req>
          <Select
            value={state.triggerType}
            onChange={(event) => update({ triggerType: event.currentTarget.value as TriggerType })}
            options={[
              { value: "mock", label: t("watchdog.detail.targetMock") },
              { value: "performanceCounter", label: t("itops.automations.triggerPerf") },
              { value: "schedule", label: t("itops.automations.triggerSchedule") },
              { value: "logFile", label: t("itops.automations.triggerLogFile") },
              { value: "ping", label: t("itops.automations.triggerPing") },
              { value: "tcpReachable", label: t("itops.automations.triggerTcp") },
              {
                value: "sshSessionOutputSilence",
                label: t("watchdog.detail.targetSshSilence"),
              },
              {
                value: "outputMatch",
                label: t("watchdog.detail.targetOutputMatch", { pattern: "…" }),
              },
            ]}
          />
        </Field>
        {state.triggerType === "mock" ? (
          <>
            <Field label={t("itops.editor.sampledValue")} req>
              <TextInput
                value={state.mockStep}
                inputMode="decimal"
                onChange={(event) => update({ mockStep: event.currentTarget.value })}
              />
            </Field>
            <Field label={t("itops.automations.pollLabel")} req>
              <TextInput
                value={state.pollSeconds}
                inputMode="numeric"
                onChange={(event) => update({ pollSeconds: event.currentTarget.value })}
              />
            </Field>
          </>
        ) : null}
        {state.triggerType === "performanceCounter" ? (
          <>
            <Field label={t("itops.automations.metricLabel")} req>
              <Select
                value={state.metric}
                onChange={(event) => update({ metric: event.currentTarget.value as PerformanceMetric })}
                options={METRICS.map((value) => ({ value, label: value }))}
              />
            </Field>
            <Field label={t("itops.automations.pollLabel")} req>
              <TextInput
                value={state.pollSeconds}
                inputMode="numeric"
                onChange={(event) => update({ pollSeconds: event.currentTarget.value })}
              />
            </Field>
          </>
        ) : null}
        {state.triggerType === "schedule" ? (
          <Field label={t("itops.automations.cronLabel")} req hint={t("itops.automations.cronHint")}>
            <TextInput
              mono
              value={state.cron}
              placeholder="0 3 * * *"
              onChange={(event) => update({ cron: event.currentTarget.value })}
            />
          </Field>
        ) : null}
        {state.triggerType === "logFile" ? (
          <>
            <Field label={t("itops.automations.logPathLabel")} req>
              <TextInput
                mono
                value={state.logPath}
                placeholder="/var/log/app.log"
                onChange={(event) => update({ logPath: event.currentTarget.value })}
              />
            </Field>
            <Field label={t("itops.automations.patternLabel")} req>
              <TextInput
                value={state.logPattern}
                placeholder={t("itops.automations.patternPlaceholder")}
                onChange={(event) => update({ logPattern: event.currentTarget.value })}
              />
            </Field>
          </>
        ) : null}
        {state.triggerType === "ping" || state.triggerType === "tcpReachable" ? (
          <>
            <Field label={t("itops.editor.hostLabel")} req>
              <TextInput
                mono
                value={state.host}
                placeholder="10.0.0.1"
                onChange={(event) => update({ host: event.currentTarget.value })}
              />
            </Field>
            <Field
              label={t("itops.editor.portLabel")}
              req={state.triggerType === "tcpReachable"}
            >
              <TextInput
                value={state.port}
                inputMode="numeric"
                placeholder={state.triggerType === "tcpReachable" ? "443" : "80"}
                onChange={(event) => update({ port: event.currentTarget.value })}
              />
            </Field>
            <Field label={t("itops.automations.pollLabel")} req>
              <TextInput
                value={state.pollSeconds}
                inputMode="numeric"
                onChange={(event) => update({ pollSeconds: event.currentTarget.value })}
              />
            </Field>
          </>
        ) : null}
        {state.triggerType === "sshSessionOutputSilence" ||
        state.triggerType === "outputMatch" ? (
          <>
            <Field label={t("itops.editor.sessionIdLabel")} req>
              <TextInput
                mono
                value={state.sessionId}
                onChange={(event) => update({ sessionId: event.currentTarget.value })}
              />
            </Field>
            {state.triggerType === "sshSessionOutputSilence" ? (
              <Field label={t("itops.editor.silenceSecondsLabel")} req>
                <TextInput
                  value={state.silenceSeconds}
                  inputMode="numeric"
                  onChange={(event) => update({ silenceSeconds: event.currentTarget.value })}
                />
              </Field>
            ) : (
              <Field label={t("itops.automations.patternLabel")} req>
                <TextInput
                  value={state.sessionPattern}
                  onChange={(event) => update({ sessionPattern: event.currentTarget.value })}
                />
              </Field>
            )}
            <Field label={t("itops.automations.pollLabel")} req>
              <TextInput
                value={state.pollSeconds}
                inputMode="numeric"
                onChange={(event) => update({ pollSeconds: event.currentTarget.value })}
              />
            </Field>
          </>
        ) : null}
      </div>
    );
  }

  if (selectedId === "condition") {
    return (
      <div className="au-side-in">
        <div className="au-side-title">{t("itops.editor.conditionNode")}</div>
        <p className="au-side-hint">{t("itops.editor.conditionHint")}</p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label={t("itops.automations.conditionLabel")} req>
            <Select
              value={state.op}
              onChange={(event) => update({ op: event.currentTarget.value as Op })}
              options={OPS}
            />
          </Field>
          <Field label={t("itops.automations.thresholdLabel")} req>
            <TextInput
              value={state.threshold}
              inputMode="decimal"
              onChange={(event) => update({ threshold: event.currentTarget.value })}
            />
          </Field>
        </div>
      </div>
    );
  }

  if (selectedId.startsWith("action-")) {
    const index = Number(selectedId.slice("action-".length));
    const action = state.actions[index];
    if (!action) return <EmptySide testResult={testResult} onAddAction={onAddAction} actions={state.actions} />;
    const onChange = (next: AutomationAction) =>
      setState((current) => ({
        ...current,
        actions: current.actions.map((existing, i) => (i === index ? next : existing)),
      }));
    return (
      <div className="au-side-in">
        <div className="au-side-title">{t("itops.editor.actionNode")}</div>
        <Field label={t("itops.editor.actionKindLabel")} req>
          <Select
            value={action.kind}
            onChange={(event) => onChange(defaultAction(event.currentTarget.value as ActionKind, firstGroupId))}
            options={ACTION_KINDS.map((kind) => ({
              value: kind,
              label: t(`itops.automations.action${kind.charAt(0).toUpperCase()}${kind.slice(1)}`),
            }))}
          />
        </Field>
        <ActionFields action={action} sites={sites} onChange={onChange} />
      </div>
    );
  }

  return <EmptySide testResult={testResult} onAddAction={onAddAction} actions={state.actions} />;
}

function EmptySide({
  testResult,
  onAddAction,
  actions,
}: {
  testResult: AutomationTestResult | null;
  onAddAction: () => void;
  actions: AutomationAction[];
}) {
  const { t } = useTranslation();
  return (
    <div className="au-side-in">
      {testResult ? <TestResultCard result={testResult} actions={actions} /> : null}
      <button type="button" className="au-act-add" onClick={onAddAction}>
        <ItIcon name="plus" size={14} />
        {t("itops.actions.addAction")}
      </button>
      {!testResult ? <p className="au-side-hint">{t("itops.editor.selectHint")}</p> : null}
    </div>
  );
}

function TestResultCard({
  result,
  actions,
}: {
  result: AutomationTestResult;
  actions: AutomationAction[];
}) {
  const { t } = useTranslation();
  const valueText = result.valueAvailable ? String(result.value) : t("itops.editor.valueUnavailable");
  const note =
    result.note === "schedule"
      ? t("itops.editor.noteSchedule")
      : result.note === "needsSession"
        ? t("itops.editor.noteNeedsSession")
        : null;
  return (
    <div className="au-test">
      <div className="au-test-head">{t("itops.editor.testResult")}</div>
      <div className="au-test-row">
        <span className="k">{t("itops.editor.sampledValue")}</span>
        <span className="v mono">{valueText}</span>
      </div>
      <div className="au-test-row">
        <span className="k">{t("itops.editor.wouldFire")}</span>
        <span className={`au-fire ${result.wouldFire ? "yes" : "no"}`}>
          <ItIcon name={result.wouldFire ? "check" : "xmark"} size={12} sw={2.4} />
          {result.wouldFire ? t("itops.editor.fireYes") : t("itops.editor.fireNo")}
        </span>
      </div>
      {note ? <p className="au-test-note">{note}</p> : null}
      <div className="au-test-acts-label">{t("itops.editor.dryRunActions")}</div>
      <div className="au-test-acts">
        {actions.length === 0 ? (
          <span className="au-test-empty">{t("itops.automations.noActionsHint")}</span>
        ) : (
          actions.map((action, index) => (
            <div key={index} className="au-test-act">
              <span className="ic" style={{ background: ACTION_COLOR[action.kind] }}>
                <ItIcon name={ACTION_ICON[action.kind]} size={11} sw={1.7} />
              </span>
              <span className="tx">{dryRunText(action, t)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function dryRunText(action: AutomationAction, t: TFunction): string {
  switch (action.kind) {
    case "notify":
      return t("itops.editor.dryNotify", { level: action.level });
    case "popup":
      return t("itops.editor.dryPopup", { title: action.title || "—" });
    case "email":
      return t("itops.editor.dryEmail", { to: action.to.join(", ") || "—" });
    case "webhook":
      return t("itops.editor.dryWebhook", { method: action.method, url: action.url || "—" });
    case "runBatch":
      return t("itops.editor.dryRunBatch");
  }
}

function ActionFields({
  action,
  sites,
  onChange,
}: {
  action: AutomationAction;
  sites: { id: string; name: string }[];
  onChange: (next: AutomationAction) => void;
}) {
  const { t } = useTranslation();
  switch (action.kind) {
    case "notify":
      return (
        <Field label={t("itops.editor.levelLabel")}>
          <Select
            value={action.level}
            onChange={(event) => onChange({ kind: "notify", level: event.currentTarget.value as NotifyLevel })}
            options={NOTIFY_LEVELS.map((level) => ({
              value: level,
              label: t(`itops.automations.level${level.charAt(0).toUpperCase()}${level.slice(1)}`),
            }))}
          />
        </Field>
      );
    case "popup":
      return (
        <>
          <Field label={t("itops.automations.popupTitle")}>
            <TextInput
              value={action.title}
              onChange={(event) => onChange({ ...action, title: event.currentTarget.value })}
            />
          </Field>
          <Field label={t("itops.automations.popupBody")}>
            <TextArea
              value={action.body}
              rows={3}
              onChange={(event) => onChange({ ...action, body: event.currentTarget.value })}
            />
          </Field>
        </>
      );
    case "email":
      return (
        <>
          <Field label={t("itops.automations.emailTo")}>
            <TextInput
              value={action.to.join(", ")}
              onChange={(event) =>
                onChange({
                  ...action,
                  to: event.currentTarget.value
                    .split(",")
                    .map((value) => value.trim())
                    .filter((value) => value.length > 0),
                })
              }
            />
          </Field>
          <Field label={t("itops.automations.emailSubject")}>
            <TextInput
              value={action.subject}
              onChange={(event) => onChange({ ...action, subject: event.currentTarget.value })}
            />
          </Field>
          <Field label={t("itops.automations.popupBody")}>
            <TextArea
              value={action.body}
              rows={3}
              onChange={(event) => onChange({ ...action, body: event.currentTarget.value })}
            />
          </Field>
        </>
      );
    case "webhook":
      return (
        <>
          <Field label={t("itops.automations.webhookUrl")}>
            <TextInput
              value={action.url}
              onChange={(event) => onChange({ ...action, url: event.currentTarget.value })}
            />
          </Field>
          <Field label={t("itops.editor.methodLabel")}>
            <Select
              value={action.method}
              onChange={(event) => onChange({ ...action, method: event.currentTarget.value })}
              options={HTTP_METHODS.map((method) => ({ value: method, label: method }))}
            />
          </Field>
          <Field label={t("itops.automations.webhookBody")}>
            <TextArea
              value={action.body ?? ""}
              rows={2}
              onChange={(event) => onChange({ ...action, body: event.currentTarget.value || null })}
            />
          </Field>
        </>
      );
    case "runBatch":
      return (
        <>
          <Field label={t("itops.tabs.sites")}>
            <Select
              value={action.siteId}
              onChange={(event) => onChange({ ...action, siteId: event.currentTarget.value })}
              options={sites.map((group) => ({ value: group.id, label: group.name }))}
            />
          </Field>
          <Field label={t("itops.batchRuns.scriptLabel")}>
            <TextArea
              value={action.task.kind === "script" ? action.task.body : ""}
              rows={3}
              spellCheck={false}
              placeholder={t("itops.batchRuns.scriptPlaceholder")}
              onChange={(event) =>
                onChange({ ...action, task: { kind: "script", body: event.currentTarget.value } })
              }
            />
          </Field>
        </>
      );
  }
}
