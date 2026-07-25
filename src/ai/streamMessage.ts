import type { AiStreamEvent } from "../lib/tauri";
import type { AgentRunResponse } from "../lib/tauri";
import type { AssistantRunManifest, AssistantRunManifestStep } from "./assistantTypes";

export type AssistantToolCallStatus = {
  toolId: string;
  toolName: string;
  status: "running" | "completed";
  error?: string;
  startedAt: string;
  endedAt?: string;
};

export type AssistantStreamMessage = {
  content: string;
  reasoningContent?: string;
  toolCalls?: AssistantToolCallStatus[];
  skillNames?: string[];
  runManifest?: AssistantRunManifest;
  workStartedAt?: string;
  workCompletedAt?: string;
  isStreaming?: boolean;
};

export function applyAssistantStreamEventToMessage(
  message: AssistantStreamMessage,
  event: AiStreamEvent,
  options: {
    errorPrefix: string;
    now: () => string;
    workStartedAt: string;
  },
): AssistantStreamMessage {
  const msg: AssistantStreamMessage = { ...message };
  switch (event.type) {
    case "reasoningDelta":
      msg.reasoningContent = (msg.reasoningContent ?? "") + event.delta;
      break;
    case "contentDelta":
      msg.content += event.delta;
      break;
    case "toolCallStart": {
      const startedToolId = streamEventString(event, "toolId", "tool_id");
      const startedToolName = streamEventString(event, "toolName", "tool_name");
      msg.workStartedAt = msg.workStartedAt ?? options.workStartedAt;
      if (!startedToolId || !startedToolName) {
        break;
      }
      msg.toolCalls = [
        ...(msg.toolCalls ?? []).filter((tc) => tc.toolId !== startedToolId),
        {
          toolId: startedToolId,
          toolName: startedToolName,
          status: "running",
          startedAt: options.now(),
        },
      ];
      break;
    }
    case "skillInvocation": {
      const skillName = streamEventString(event, "skillName", "skill_name");
      if (!skillName) {
        break;
      }
      msg.workStartedAt = msg.workStartedAt ?? options.workStartedAt;
      msg.skillNames = Array.from(new Set([...(msg.skillNames ?? []), skillName]));
      break;
    }
    case "toolCallEnd": {
      const endedToolId = streamEventString(event, "toolId", "tool_id");
      const endedToolName = streamEventString(event, "toolName", "tool_name");
      if (!endedToolId) {
        break;
      }
      msg.toolCalls = (msg.toolCalls ?? []).map((tc) =>
        tc.toolId === endedToolId
          ? {
              ...tc,
              toolName: endedToolName ?? tc.toolName,
              status: "completed",
              ...(event.error ? { error: event.error } : {}),
              endedAt: options.now(),
            }
          : tc,
      );
      break;
    }
    case "planUpdate": {
      const steps: AssistantRunManifestStep[] = (Array.isArray(event.steps) ? event.steps : [])
        .filter((step) => step && typeof step.id === "string" && typeof step.label === "string")
        .map((step) => ({
          id: step.id,
          label: step.label,
          status:
            step.status === "running" || step.status === "completed" || step.status === "blocked"
              ? step.status
              : "pending",
          detail: typeof step.detail === "string" && step.detail.trim() ? step.detail : undefined,
        }));
      if (steps.length === 0) {
        break;
      }
      msg.workStartedAt = msg.workStartedAt ?? options.workStartedAt;
      msg.runManifest = {
        runId:
          msg.runManifest?.runId ??
          `assistant-run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        goal:
          typeof event.goal === "string" && event.goal.trim()
            ? event.goal.trim()
            : msg.runManifest?.goal ?? "",
        scope: msg.runManifest?.scope ?? "assistant.chat",
        definitionOfDone:
          msg.runManifest?.definitionOfDone ??
          "Complete every plan step or report the blocker.",
        verificationStatus: steps.some((step) => step.status === "blocked")
          ? "failed"
          : steps.every((step) => step.status === "completed")
            ? "passed"
            : "pending",
        steps,
        updatedAt: options.now(),
        source: "model",
      };
      break;
    }
    case "done":
      msg.isStreaming = false;
      msg.workCompletedAt = options.now();
      msg.toolCalls = (msg.toolCalls ?? []).map((tc) =>
        tc.status === "running"
          ? { ...tc, status: "completed", endedAt: options.now() }
          : tc,
      );
      break;
    case "error":
      msg.isStreaming = false;
      msg.workCompletedAt = options.now();
      if (!msg.content) {
        msg.content = `${options.errorPrefix}: ${event.message}`;
      }
      break;
  }
  return msg;
}

export function completeAssistantStreamMessageFromResponse<T extends AssistantStreamMessage>(
  message: T,
  response: AgentRunResponse,
): T {
  return {
    ...message,
    content: preserveSecretRequestDirectives(message.content, response.content),
    reasoningContent: message.reasoningContent?.trim()
      ? message.reasoningContent
      : response.reasoningContent,
  };
}

export function latestRunningAssistantToolCall(message: AssistantStreamMessage) {
  const toolCalls = message.toolCalls ?? [];
  for (let index = toolCalls.length - 1; index >= 0; index -= 1) {
    const toolCall = toolCalls[index];
    if (
      toolCall.status === "running" &&
      typeof toolCall.toolName === "string" &&
      toolCall.toolName.trim()
    ) {
      return toolCall;
    }
  }
  return undefined;
}

export type AssistantWorkPanelStatusKind = "tool" | "skill" | "waiting" | "completed";

export function assistantWorkPanelStatusKind(
  message: AssistantStreamMessage,
): AssistantWorkPanelStatusKind {
  if (!message.isStreaming) {
    return "completed";
  }
  if (latestRunningAssistantToolCall(message)) {
    return "tool";
  }
  if ((message.skillNames?.length ?? 0) > 0) {
    return "skill";
  }
  return "waiting";
}

export function assistantWorkPanelShouldShowThinkingStep(message: AssistantStreamMessage) {
  return Boolean(message.reasoningContent?.trim());
}

const SECRET_REQUEST_FENCE = /```kkterm-secret-request\s*\n[\s\S]*?```/g;

function preserveSecretRequestDirectives(streamedContent: string, finalContent: string) {
  const directives = streamedContent.match(SECRET_REQUEST_FENCE) ?? [];
  const missingDirectives = directives.filter((directive) => !finalContent.includes(directive));
  if (missingDirectives.length === 0) {
    return finalContent;
  }
  return [finalContent.trimEnd(), ...missingDirectives].filter(Boolean).join("\n\n");
}

function streamEventString(event: AiStreamEvent, camelKey: string, snakeKey: string) {
  const record = event as unknown as Record<string, unknown>;
  const value = record[camelKey] ?? record[snakeKey];
  return typeof value === "string" && value.trim() ? value : undefined;
}
