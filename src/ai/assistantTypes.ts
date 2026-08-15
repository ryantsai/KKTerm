import type { AssistantToolCallStatus } from "./streamMessage";

export type AssistantChatMessage = {
  id: string;
  role: "assistant" | "user";
  content: string;
  reasoningContent?: string;
  textAttachments?: AssistantTextAttachment[];
  imageAttachments?: AssistantImageAttachment[];
  fileAttachments?: AssistantFileAttachment[];
  intent?: AssistantPromptIntent;
  createdAt: string;
  toolCalls?: AssistantToolCallStatus[];
  skillNames?: string[];
  runManifest?: AssistantRunManifest;
  workStartedAt?: string;
  workCompletedAt?: string;
  isStreaming?: boolean;
};

export type AssistantChatThread = {
  id: string;
  title: string;
  contextLabel: string;
  messages: AssistantChatMessage[];
  createdAt: string;
  updatedAt: string;
  /** Cached history-list preview; full messages load only when a saved thread opens. */
  preview?: string;
};

export type AssistantPromptIntent = "chat" | "extensionCreation" | "createWidget" | "watchdog";

export type AssistantRunManifestStep = {
  id: string;
  label: string;
  status: "pending" | "running" | "completed" | "blocked";
  detail?: string;
};

export type AssistantRunManifest = {
  runId: string;
  goal: string;
  scope: string;
  definitionOfDone: string;
  verificationStatus: "pending" | "passed" | "failed";
  steps: AssistantRunManifestStep[];
  updatedAt: string;
  /**
   * "model" when the assistant published this plan via the update_plan tool.
   * Absent for manifests the panel synthesizes; the panel never overwrites a
   * model-provided plan with a synthesized one.
   */
  source?: "model";
};

export type AssistantTextAttachment = {
  id: string;
  sourceLabel: string;
  text: string;
  capturedAt: string;
};

export type AssistantImageAttachment = {
  id: string;
  sourceLabel: string;
  imageDataUrl: string;
  width: number;
  height: number;
};

export type AssistantFileAttachment = {
  id: string;
  sourceLabel: string;
  dataUrl: string;
  mimeType: string;
  size: number;
};

export type ScreenshotRegionState = {
  bounds: DOMRect;
  pointerId?: number;
  start?: { x: number; y: number };
  current?: { x: number; y: number };
};

export type AssistantLiveToolRequest = {
  requestId: string;
  toolName: string;
  args?: Record<string, unknown>;
};

export type AssistantToolApprovalRequest = {
  requestId: string;
  toolName: string;
  args?: Record<string, unknown>;
  /**
   * Backend keyword heuristic flagged this call's command payload as risky
   * (destructive/service-disrupting/credential-touching). Session allows must
   * not auto-approve these; they always re-prompt.
   */
  riskElevated?: boolean;
  /** Human-readable reasons the call was flagged risky, shown on the card. */
  riskNotes?: string[];
};

export type PendingToolApproval = AssistantToolApprovalRequest & {
  status: "pending" | "approved" | "allowedSession" | "denied";
};

export type ToolApprovalAction = "" | "allow" | "allowSession" | "deny";

export interface AssistantPageContext {
  contextKind?: "dashboard" | "itops" | "settings" | "customModule";
  contextLabel: string;
  connectionLabel: string;
  sourceLabel: string;
  text: string;
}
