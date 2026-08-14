// Chat-thread persistence and normalization for the Assistant Panel:
// SQLite-backed history records, the legacy localStorage migration, and the
// defensive normalizers that keep malformed persisted data out of the UI.
// Extracted verbatim from AssistantPanel.tsx; behavior must not change.
import i18next from "../i18n/config";
import { invokeCommand } from "../lib/tauri";
import type {
  AssistantChatThreadRecord,
  AssistantChatThreadSummaryRecord,
} from "../lib/tauri";
import type { AssistantToolCallStatus } from "./streamMessage";
import type {
  AssistantChatMessage,
  AssistantChatThread,
  AssistantFileAttachment,
  AssistantImageAttachment,
  AssistantRunManifest,
  AssistantRunManifestStep,
  AssistantTextAttachment,
} from "./assistantTypes";

export const ASSISTANT_CHAT_HISTORY_KEY = "kkterm.aiAssistant.chatHistory.v1";

export function createAssistantChatThreadId() {
  return `assistant-chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function assistantThreadTitle(messages: AssistantChatMessage[]) {
  const firstUserMessage = messages.find((message) => message.role === "user");
  const title = firstUserMessage?.content.trim().replace(/\s+/g, " ") || i18next.t("ai.newChat");
  return title.length > 56 ? `${title.slice(0, 53)}...` : title;
}

export function assistantThreadPreview(thread: AssistantChatThread) {
  const lastMessage = thread.messages[thread.messages.length - 1];
  const preview = lastMessage?.content.trim().replace(/\s+/g, " ")
    || thread.preview
    || i18next.t("ai.noMessages");
  return preview.length > 64 ? `${preview.slice(0, 61)}...` : preview;
}

export function sanitizeAssistantThreadTitle(value: string) {
  const title = value
    .trim()
    .split(/\r?\n/)[0]
    ?.replace(/^title:\s*/i, "")
    .replace(/^["'`]+|["'`.]+$/g, "")
    .trim();
  if (!title) {
    return "";
  }
  return title.length > 56 ? `${title.slice(0, 53)}...` : title;
}

export function sortedAssistantThreads(threads: AssistantChatThread[]) {
  return [...threads].sort(
    (left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
  );
}

export function upsertAssistantChatThread(
  threads: AssistantChatThread[],
  thread: AssistantChatThread,
) {
  const withoutThread = threads.filter((item) => item.id !== thread.id);
  return sortedAssistantThreads([thread, ...withoutThread]);
}

export function readLegacyAssistantChatHistory(): AssistantChatThread[] {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const rawHistory = window.localStorage.getItem(ASSISTANT_CHAT_HISTORY_KEY);
    if (!rawHistory) {
      return [];
    }
    const parsed = JSON.parse(rawHistory);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.flatMap(normalizeAssistantChatThread);
  } catch {
    return [];
  }
}

export function writeLegacyAssistantChatHistory(threads: AssistantChatThread[]) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(ASSISTANT_CHAT_HISTORY_KEY, JSON.stringify(threads));
}

export function clearLegacyAssistantChatHistory() {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(ASSISTANT_CHAT_HISTORY_KEY);
}

export function assistantChatThreadToRecord(
  thread: AssistantChatThread,
): AssistantChatThreadRecord {
  return {
    id: thread.id,
    title: thread.title,
    contextLabel: thread.contextLabel,
    messagesJson: JSON.stringify(thread.messages),
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
  };
}

export function assistantChatThreadFromRecord(
  record: AssistantChatThreadRecord,
): AssistantChatThread[] {
  let messages: unknown;
  try {
    messages = JSON.parse(record.messagesJson);
  } catch {
    return [];
  }
  return normalizeAssistantChatThread({
    id: record.id,
    title: record.title,
    contextLabel: record.contextLabel,
    messages,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  });
}

export async function loadAssistantChatHistoryFromStorage(): Promise<AssistantChatThread[]> {
  try {
    const records = await invokeCommand("list_assistant_chat_thread_summaries", undefined);
    const storedThreads = records.map(assistantChatThreadFromSummaryRecord);
    const legacyThreads = readLegacyAssistantChatHistory();
    if (legacyThreads.length === 0) {
      return storedThreads;
    }

    await Promise.all(
      legacyThreads.map((thread) =>
        invokeCommand("upsert_assistant_chat_thread", {
          request: assistantChatThreadToRecord(thread),
        }),
      ),
    );
    clearLegacyAssistantChatHistory();
    const migratedRecords = await invokeCommand("list_assistant_chat_thread_summaries", undefined);
    return migratedRecords.map(assistantChatThreadFromSummaryRecord);
  } catch (error) {
    console.warn("[kkterm-ai] failed to load saved chat history", error);
    return readLegacyAssistantChatHistory();
  }
}

export async function loadAssistantChatThreadFromStorage(
  threadId: string,
): Promise<AssistantChatThread | undefined> {
  const record = await invokeCommand("get_assistant_chat_thread", { threadId });
  return assistantChatThreadFromRecord(record)[0];
}

function assistantChatThreadFromSummaryRecord(
  record: AssistantChatThreadSummaryRecord,
): AssistantChatThread {
  return {
    id: record.id,
    title: record.title,
    contextLabel: record.contextLabel,
    messages: [],
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    preview: record.preview,
  };
}

export function normalizeAssistantChatThread(value: unknown): AssistantChatThread[] {
  if (!value || typeof value !== "object") {
    return [];
  }
  const candidate = value as Partial<AssistantChatThread>;
  const messages = Array.isArray(candidate.messages)
    ? candidate.messages.flatMap(normalizeAssistantChatMessage)
    : [];
  if (messages.length === 0) {
    return [];
  }
  const createdAt = normalizeDateString(candidate.createdAt) ?? messages[0].createdAt;
  const updatedAt =
    normalizeDateString(candidate.updatedAt) ?? messages[messages.length - 1].createdAt;
  return [
    {
      id: typeof candidate.id === "string" && candidate.id ? candidate.id : createAssistantChatThreadId(),
      title:
        typeof candidate.title === "string" && candidate.title.trim()
          ? candidate.title.trim()
          : assistantThreadTitle(messages),
      contextLabel:
        typeof candidate.contextLabel === "string" && candidate.contextLabel.trim()
          ? candidate.contextLabel.trim()
          : i18next.t("ai.workspace"),
      messages,
      createdAt,
      updatedAt,
    },
  ];
}

export function normalizeAssistantChatMessage(value: unknown): AssistantChatMessage[] {
  if (!value || typeof value !== "object") {
    return [];
  }
  const candidate = value as Partial<AssistantChatMessage>;
  if (candidate.role !== "assistant" && candidate.role !== "user") {
    return [];
  }
  if (typeof candidate.content !== "string" || !candidate.content.trim()) {
    return [];
  }
  return [
    {
      id: typeof candidate.id === "string" && candidate.id ? candidate.id : `${candidate.role}-${Date.now()}`,
      role: candidate.role,
      content: candidate.content,
      reasoningContent: typeof candidate.reasoningContent === "string" && candidate.reasoningContent ? candidate.reasoningContent : undefined,
      textAttachments: normalizeTextAttachments(candidate.textAttachments),
      imageAttachments: normalizeImageAttachments(candidate.imageAttachments),
      fileAttachments: normalizeFileAttachments(candidate.fileAttachments),
      intent:
        candidate.intent === "chat" ||
        candidate.intent === "extensionCreation" ||
        candidate.intent === "createWidget" ||
        candidate.intent === "watchdog"
          ? candidate.intent
          : undefined,
      createdAt: normalizeDateString(candidate.createdAt) ?? new Date().toISOString(),
      toolCalls: normalizeAssistantToolCalls(candidate.toolCalls),
      skillNames: normalizeAssistantSkillNames(candidate.skillNames),
      workStartedAt: normalizeDateString(candidate.workStartedAt),
      workCompletedAt: normalizeDateString(candidate.workCompletedAt),
      runManifest: normalizeAssistantRunManifest(candidate.runManifest),
    },
  ];
}

export function normalizeAssistantRunManifest(value: unknown): AssistantRunManifest | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const candidate = value as Partial<AssistantRunManifest>;
  if (typeof candidate.goal !== "string" || !candidate.goal.trim()) {
    return undefined;
  }
  if (typeof candidate.scope !== "string" || !candidate.scope.trim()) {
    return undefined;
  }
  if (typeof candidate.definitionOfDone !== "string" || !candidate.definitionOfDone.trim()) {
    return undefined;
  }
  const normalizedStatus =
    candidate.verificationStatus === "failed" ||
    candidate.verificationStatus === "passed" ||
    candidate.verificationStatus === "pending"
      ? candidate.verificationStatus
      : "pending";
  return {
    runId:
      typeof candidate.runId === "string" && candidate.runId
        ? candidate.runId
        : `assistant-run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    goal: candidate.goal.trim(),
    scope: candidate.scope.trim(),
    definitionOfDone: candidate.definitionOfDone.trim(),
    verificationStatus: normalizedStatus,
    steps: Array.isArray(candidate.steps) ? candidate.steps.filter(Boolean) as AssistantRunManifestStep[] : [],
    updatedAt: normalizeDateString(candidate.updatedAt) ?? new Date().toISOString(),
    source: candidate.source === "model" ? "model" : undefined,
  };
}

export function normalizeAssistantSkillNames(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const names = Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter((item) => /^[a-z0-9-]{1,64}$/.test(item)),
    ),
  );
  return names.length > 0 ? names : undefined;
}

export function normalizeAssistantToolCalls(
  value: unknown,
): AssistantToolCallStatus[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const calls: AssistantToolCallStatus[] = value.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }
    const candidate = item as Partial<AssistantToolCallStatus>;
    if (
      typeof candidate.toolId !== "string" ||
      !candidate.toolId ||
      typeof candidate.toolName !== "string" ||
      !candidate.toolName
    ) {
      return [];
    }
    return [
      {
        toolId: candidate.toolId,
        toolName: candidate.toolName,
        status: candidate.status === "running" ? "running" : "completed",
        startedAt: normalizeDateString(candidate.startedAt) ?? new Date().toISOString(),
        endedAt: normalizeDateString(candidate.endedAt),
      },
    ];
  });
  return calls.length > 0 ? calls : undefined;
}

export function normalizeImageAttachments(value: unknown): AssistantImageAttachment[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }
    const candidate = item as Partial<AssistantImageAttachment>;
    if (
      typeof candidate.sourceLabel !== "string" ||
      !candidate.sourceLabel.trim() ||
      typeof candidate.imageDataUrl !== "string" ||
      !candidate.imageDataUrl.startsWith("data:image/")
    ) {
      return [];
    }
    return [
      {
        id:
          typeof candidate.id === "string" && candidate.id
            ? candidate.id
            : `assistant-image-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        sourceLabel: candidate.sourceLabel.trim(),
        imageDataUrl: candidate.imageDataUrl,
        width: typeof candidate.width === "number" ? candidate.width : 0,
        height: typeof candidate.height === "number" ? candidate.height : 0,
      },
    ];
  });
}

export function normalizeFileAttachments(value: unknown): AssistantFileAttachment[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }
    const candidate = item as Partial<AssistantFileAttachment>;
    if (
      typeof candidate.sourceLabel !== "string" ||
      !candidate.sourceLabel.trim() ||
      typeof candidate.dataUrl !== "string" ||
      !candidate.dataUrl.startsWith("data:")
    ) {
      return [];
    }
    return [
      {
        id:
          typeof candidate.id === "string" && candidate.id
            ? candidate.id
            : `assistant-file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        sourceLabel: candidate.sourceLabel.trim(),
        dataUrl: candidate.dataUrl,
        mimeType:
          typeof candidate.mimeType === "string" && candidate.mimeType.trim()
            ? candidate.mimeType.trim()
            : "application/octet-stream",
        size: typeof candidate.size === "number" ? candidate.size : 0,
      },
    ];
  });
}

export function normalizeTextAttachments(value: unknown): AssistantTextAttachment[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }
    const candidate = item as Partial<AssistantTextAttachment>;
    if (
      typeof candidate.sourceLabel !== "string" ||
      !candidate.sourceLabel.trim() ||
      typeof candidate.text !== "string" ||
      !candidate.text.trim()
    ) {
      return [];
    }
    return [
      {
        id:
          typeof candidate.id === "string" && candidate.id
            ? candidate.id
            : `assistant-text-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        sourceLabel: candidate.sourceLabel.trim(),
        text: candidate.text,
        capturedAt: normalizeDateString(candidate.capturedAt) ?? new Date().toISOString(),
      },
    ];
  });
}

export function normalizeDateString(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}
