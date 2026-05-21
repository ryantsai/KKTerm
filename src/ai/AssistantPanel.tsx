import { ConnectionIcon } from "../connections/ConnectionIcon";
import type { TutorialHighlightRequest } from "../app/TutorialOverlay";
import {
  normalizeTutorialNavigationTarget,
  tutorialNavigationForTarget,
} from "../app/tutorialNavigationModel";
import { workspaceKindLabel } from "../connections/utils";
import { inspectActiveSshSystemContext } from "../terminal/TerminalWorkspace";
import { readFromClipboard, writeToClipboard } from "../lib/clipboard";
import {
  Bot,
  Camera,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  FileImage,
  Hand,
  KeyRound,
  LoaderCircle,
  PanelRight,
  Plus,
  RefreshCw,
  ScrollText,
  SendHorizontal,
  Settings,
  ShieldAlert,
  Square,
  Terminal,
  X,
} from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
  ChangeEvent,
  ClipboardEvent,
  FormEvent,
  KeyboardEvent,
  MouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { ariaChecked, ariaExpanded, dialogButtonAria, menuButtonAria } from "../lib/aria";
import { showNativeContextMenu } from "../lib/nativeContextMenu";
import { invokeCommand, isTauriRuntime, openExternalUrl } from "../lib/tauri";
import type {
  AiProviderModelOption,
  AiStreamEvent,
  AssistantChatThreadRecord,
  CaptureScreenshotRequest,
} from "../lib/tauri";
import {
  getAiProviderDefinition,
  modelSupportsImageInput,
  normalizeAiProviderDraft,
  validateAiProviderForChat,
} from "./providers";
import {
  selectModelOptionsForProvider,
  sortModelOptionsForProvider,
} from "./providerModelOptions";
import {
  applyAssistantStreamEventToMessage,
  assistantWorkPanelShouldShowThinkingStep,
  completeAssistantStreamMessageFromResponse,
  latestRunningAssistantToolCall,
  type AssistantToolCallStatus,
} from "./streamMessage";
import { useWorkspaceStore } from "../store";
import { useDashboardStore } from "../dashboard/state/dashboardStore";
import {
  getFileBrowserController,
  getPaneRenderer,
  getRemoteDesktopController,
  sendTextToRdpPane,
  writeInputToPane,
} from "../workspace/paneRegistry";
import i18next from "../i18n/config";
import { prepareAssistantTerminalInput } from "./terminalCommandSend";
import { marked, type Tokens } from "marked";
import { Channel } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { aiProviderSecretOwnerId } from "../lib/settings";
import {
  parseAssistantSecretRequests,
  secretRequestStorageNotice,
  type AssistantSecretRequest,
} from "./secretRequest";
import { scrollAssistantChatToBottom } from "./assistantScroll";
import type { AiToolPermissionMode } from "../types";
import { resolveCreateWidgetFollowupPrompt } from "./widgetFollowupPrompt";

function resolveAssistantOutputLanguage(outputLanguage: string): string | undefined {
  if (!outputLanguage) {
    const uiCode = i18next.language || "en";
    const name = i18next.t(`languages.${uiCode}`);
    return name && name !== `languages.${uiCode}` ? name : undefined;
  }
  return outputLanguage;
}

type AssistantChatMessage = {
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
  workStartedAt?: string;
  workCompletedAt?: string;
  isStreaming?: boolean;
};

type AssistantChatThread = {
  id: string;
  title: string;
  contextLabel: string;
  messages: AssistantChatMessage[];
  createdAt: string;
  updatedAt: string;
};

type AssistantPromptIntent = "chat" | "extensionCreation" | "createWidget" | "watchdog";

type AssistantTextAttachment = {
  id: string;
  sourceLabel: string;
  text: string;
  capturedAt: string;
};

type AssistantImageAttachment = {
  id: string;
  sourceLabel: string;
  imageDataUrl: string;
  width: number;
  height: number;
};

type AssistantFileAttachment = {
  id: string;
  sourceLabel: string;
  dataUrl: string;
  mimeType: string;
  size: number;
};

type ScreenshotRegionState = {
  bounds: DOMRect;
  pointerId?: number;
  start?: { x: number; y: number };
  current?: { x: number; y: number };
};

type AssistantLiveToolRequest = {
  requestId: string;
  toolName: string;
  args?: Record<string, unknown>;
};

type AssistantToolApprovalRequest = {
  requestId: string;
  toolName: string;
  args?: Record<string, unknown>;
};

type PendingToolApproval = AssistantToolApprovalRequest & {
  status: "pending" | "approved" | "allowedSession" | "denied";
};

type ToolApprovalAction = "" | "allow" | "allowSession" | "deny";

export interface AssistantPageContext {
  contextKind?: "dashboard" | "settings";
  contextLabel: string;
  connectionLabel: string;
  sourceLabel: string;
  text: string;
}

const ASSISTANT_IMAGE_MAX_EDGE = 1280;
const ASSISTANT_IMAGE_JPEG_QUALITY = 0.72;
const ASSISTANT_FILE_MAX_BYTES = 10 * 1024 * 1024;

function randomAssistantWaitingPhrase() {
  const phrases = i18next.t("ai.waitingPhrases", { returnObjects: true }) as readonly string[];
  if (!Array.isArray(phrases) || phrases.length === 0) {
    return i18next.t("ai.chargingBeacon");
  }
  return phrases[Math.floor(Math.random() * phrases.length)] ?? i18next.t("ai.chargingBeacon");
}

function maxMeasuredTextWidth(node: HTMLDivElement | null) {
  if (!node) {
    return 0;
  }

  return Array.from(node.children).reduce((max, child) => {
    return Math.max(max, child.getBoundingClientRect().width);
  }, 0);
}

function createAssistantChatMessage(
  role: AssistantChatMessage["role"],
  content: string,
  intent?: AssistantPromptIntent,
  textAttachments?: AssistantTextAttachment[],
  imageAttachments?: AssistantImageAttachment[],
  fileAttachments?: AssistantFileAttachment[],
  reasoningContent?: string,
): AssistantChatMessage {
  return {
    id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    content,
    reasoningContent,
    textAttachments,
    imageAttachments,
    fileAttachments,
    intent,
    createdAt: new Date().toISOString(),
  };
}

function createAssistantChatThreadId() {
  return `assistant-chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function assistantThreadTitle(messages: AssistantChatMessage[]) {
  const firstUserMessage = messages.find((message) => message.role === "user");
  const title = firstUserMessage?.content.trim().replace(/\s+/g, " ") || i18next.t("ai.newChat");
  return title.length > 56 ? `${title.slice(0, 53)}...` : title;
}

function assistantThreadPreview(thread: AssistantChatThread) {
  const lastMessage = thread.messages[thread.messages.length - 1];
  const preview = lastMessage?.content.trim().replace(/\s+/g, " ") || i18next.t("ai.noMessages");
  return preview.length > 64 ? `${preview.slice(0, 61)}...` : preview;
}

function assistantAgentIntent(intent: AssistantPromptIntent): "chat" | "extensionCreation" {
  return intent === "extensionCreation" ? "extensionCreation" : "chat";
}

function assistantPromptForIntent(
  intent: AssistantPromptIntent,
  prompt: string,
  previousMessages: readonly AssistantChatMessage[] = [],
) {
  if (intent === "createWidget") {
    return `Create a Dashboard widget for this request:\n${resolveCreateWidgetFollowupPrompt(prompt, previousMessages)}`;
  }
  if (intent === "watchdog") {
    return `Configure or draft a Watchdog for this monitoring request:\n${prompt}`;
  }
  return prompt;
}

function assistantIntentLabel(
  intent: AssistantPromptIntent,
  t: ReturnType<typeof useTranslation>["t"],
) {
  if (intent === "extensionCreation") {
    return t("ai.extensionDraft");
  }
  if (intent === "createWidget") {
    return t("ai.createWidget");
  }
  if (intent === "watchdog") {
    return t("ai.watchdog");
  }
  return t("ai.title");
}

function sampleRandom<T>(arr: T[], n: number): T[] {
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

function assistantIntentExamples(
  intent: AssistantPromptIntent,
  t: ReturnType<typeof useTranslation>["t"],
) {
  const key =
    intent === "createWidget"
      ? "ai.createWidgetExamples"
      : intent === "watchdog"
        ? "ai.watchdogExamples"
        : undefined;
  if (!key) {
    return [];
  }
  const examples = t(key, { returnObjects: true });
  return Array.isArray(examples) ? examples.map(String) : [];
}

function assistantIntentPlaceholder(
  intent: AssistantPromptIntent,
  t: ReturnType<typeof useTranslation>["t"],
) {
  if (intent === "createWidget") {
    return t("ai.createWidgetPlaceholder");
  }
  if (intent === "watchdog") {
    return t("ai.watchdogPlaceholder");
  }
  return t("ai.composerPlaceholder");
}

function sanitizeAssistantThreadTitle(value: string) {
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

function formatAssistantMessageTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const hours = date.getHours();
  const hour12 = hours % 12 || 12;
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const period = hours >= 12 ? i18next.t("common.pm") : i18next.t("common.am");
  return `${hour12}:${minutes} ${period}`;
}

function readImageFileAsDataUrl(file: File): Promise<string> {
  return readFileAsDataUrl(file);
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("image paste did not produce a data URL"));
      }
    });
    reader.addEventListener("error", () => {
      reject(reader.error ?? new Error("failed to read pasted image"));
    });
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => resolve(image));
    image.addEventListener("error", () => reject(new Error("failed to load image")));
    image.src = dataUrl;
  });
}

async function compressImageDataUrl(dataUrl: string) {
  const image = await loadImage(dataUrl);
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    return { dataUrl, width: 0, height: 0 };
  }

  const scale = Math.min(1, ASSISTANT_IMAGE_MAX_EDGE / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    return { dataUrl, width: sourceWidth, height: sourceHeight };
  }

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  return {
    dataUrl: canvas.toDataURL("image/jpeg", ASSISTANT_IMAGE_JPEG_QUALITY),
    width,
    height,
  };
}

async function createImageAttachment(
  sourceLabel: string,
  dataUrl: string,
): Promise<AssistantImageAttachment> {
  const compressed = await compressImageDataUrl(dataUrl);
  return {
    id: `assistant-image-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    sourceLabel,
    imageDataUrl: compressed.dataUrl,
    width: compressed.width,
    height: compressed.height,
  };
}

function normalizeImageAttachments(value: unknown): AssistantImageAttachment[] {
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

function normalizeFileAttachments(value: unknown): AssistantFileAttachment[] {
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

function normalizeTextAttachments(value: unknown): AssistantTextAttachment[] {
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

function sortedAssistantThreads(threads: AssistantChatThread[]) {
  return [...threads].sort(
    (left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
  );
}

function upsertAssistantChatThread(
  threads: AssistantChatThread[],
  thread: AssistantChatThread,
) {
  const withoutThread = threads.filter((item) => item.id !== thread.id);
  return sortedAssistantThreads([thread, ...withoutThread]);
}

function assistantIntentForPrompt(
  activeIntent: AssistantPromptIntent,
  prompt: string,
): AssistantPromptIntent {
  if (activeIntent !== "chat") {
    return activeIntent;
  }

  const normalized = prompt.toLowerCase();
  const asksForExtension =
    /\b(extension|plugin|addon|add-on)\b/.test(normalized) &&
    /\b(create|build|generate|write|draft|scaffold|make)\b/.test(normalized);
  return asksForExtension ? "extensionCreation" : "chat";
}

function readLegacyAssistantChatHistory(): AssistantChatThread[] {
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

function writeLegacyAssistantChatHistory(threads: AssistantChatThread[]) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(ASSISTANT_CHAT_HISTORY_KEY, JSON.stringify(threads));
}

function clearLegacyAssistantChatHistory() {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(ASSISTANT_CHAT_HISTORY_KEY);
}

function assistantChatThreadToRecord(thread: AssistantChatThread): AssistantChatThreadRecord {
  return {
    id: thread.id,
    title: thread.title,
    contextLabel: thread.contextLabel,
    messagesJson: JSON.stringify(thread.messages),
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
  };
}

function assistantChatThreadFromRecord(record: AssistantChatThreadRecord): AssistantChatThread[] {
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

async function loadAssistantChatHistoryFromStorage(): Promise<AssistantChatThread[]> {
  try {
    const records = await invokeCommand("list_assistant_chat_threads", undefined);
    const storedThreads = records.flatMap(assistantChatThreadFromRecord);
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
    const migratedRecords = await invokeCommand("list_assistant_chat_threads", undefined);
    return migratedRecords.flatMap(assistantChatThreadFromRecord);
  } catch (error) {
    console.warn("[kkterm-ai] failed to load SQLite chat history", error);
    return readLegacyAssistantChatHistory();
  }
}

function normalizeAssistantChatThread(value: unknown): AssistantChatThread[] {
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

function normalizeAssistantChatMessage(value: unknown): AssistantChatMessage[] {
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
    },
  ];
}

function normalizeAssistantSkillNames(value: unknown): string[] | undefined {
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

function normalizeAssistantToolCalls(value: unknown): AssistantToolCallStatus[] | undefined {
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

function logAssistantStreamEvent(event: AiStreamEvent) {
  switch (event.type) {
    case "reasoningDelta":
    case "contentDelta":
      console.debug("[kkterm-ai] stream event", {
        type: event.type,
        deltaLength: event.delta.length,
      });
      return;
    case "toolCallStart":
    case "toolCallEnd":
      console.debug("[kkterm-ai] stream event", {
        type: event.type,
        toolId: event.toolId,
        toolName: event.toolName,
      });
      return;
    case "done":
      console.debug("[kkterm-ai] stream event", {
        type: event.type,
        providerKind: event.providerKind,
        model: event.model,
      });
      return;
    case "error":
      console.debug("[kkterm-ai] stream event", {
        type: event.type,
        messageLength: event.message.length,
      });
      return;
  }
}

function normalizeDateString(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

const ASSISTANT_CHAT_HISTORY_KEY = "kkterm.aiAssistant.chatHistory.v1";

function createAiProviderSecretRequestMarkdown(
  label: string,
  provider: string,
  providerKind: string,
) {
  return [
    i18next.t("ai.secretCardAiProviderMessage", { provider }),
    "",
    "```kkterm-secret-request",
    JSON.stringify({
      kind: "aiApiKey",
      ownerId: aiProviderSecretOwnerId(providerKind),
      label,
      description: i18next.t("ai.secretCardAiProviderDescription", { provider }),
    }),
    "```",
  ].join("\n");
}

export function AssistantPanel({
  collapsed,
  onOpenSettings,
  onTutorialRequest,
  onToggleCollapsed,
  pageContext,
}: {
  collapsed: boolean;
  onOpenSettings: () => void;
  onTutorialRequest: (
    request: TutorialHighlightRequest,
  ) => Promise<{ ok: boolean; error?: string }>;
  onToggleCollapsed: () => void;
  pageContext?: AssistantPageContext;
}) {
  const { t } = useTranslation();
  const activeTab = useWorkspaceStore((state) =>
    state.tabs.find((tab) => tab.id === state.activeTabId),
  );
  const requestRdpPreCapture = useWorkspaceStore((state) => state.requestRdpPreCapture);
  const assistantContextSnippet = useWorkspaceStore((state) => state.assistantContextSnippet);
  const setAssistantContextSnippet = useWorkspaceStore(
    (state) => state.setAssistantContextSnippet,
  );
  const clearAssistantContextSnippet = useWorkspaceStore(
    (state) => state.clearAssistantContextSnippet,
  );
  const showStatusBarNotice = useWorkspaceStore((state) => state.showStatusBarNotice);
  const aiProviderSettings = useWorkspaceStore((state) => state.aiProviderSettings);
  const setAiProviderSettings = useWorkspaceStore((state) => state.setAiProviderSettings);
  const aiProviderHasApiKey = useWorkspaceStore((state) => state.aiProviderHasApiKey);
  const setAssistantWorking = useWorkspaceStore((state) => state.setAssistantWorking);
  const [prompt, setPrompt] = useState(() => sessionStorage.getItem("ai-chat-draft") ?? "");
  const [messages, setMessages] = useState<AssistantChatMessage[]>([]);
  const [currentThreadId, setCurrentThreadId] = useState(createAssistantChatThreadId);
  const [currentThreadTitle, setCurrentThreadTitle] = useState<string | undefined>();
  const [chatHistory, setChatHistory] = useState<AssistantChatThread[]>(() =>
    isTauriRuntime() ? [] : readLegacyAssistantChatHistory(),
  );
  const [showAllChats, setShowAllChats] = useState(false);
  const [chatError, setChatError] = useState("");
  const [isSendingPrompt, setIsSendingPrompt] = useState(false);
  const [pendingToolApprovals, setPendingToolApprovals] = useState<PendingToolApproval[]>([]);
  const [assistantIntent, setAssistantIntent] = useState<AssistantPromptIntent>("chat");
  const [displayedIntentExamples, setDisplayedIntentExamples] = useState<string[]>([]);
  const [addContextMenuOpen, setAddContextMenuOpen] = useState(false);
  const [permissionMenuOpen, setPermissionMenuOpen] = useState(false);
  const [pastedImageContexts, setPastedImageContexts] = useState<AssistantImageAttachment[]>([]);
  const [fileContexts, setFileContexts] = useState<AssistantFileAttachment[]>([]);
  const [imagePasteRejected, setImagePasteRejected] = useState(false);
  const [screenshotRegionState, setScreenshotRegionState] =
    useState<ScreenshotRegionState | null>(null);
  const activeComposerIntent = assistantIntent === "chat" ? undefined : assistantIntent;
  const activeComposerIntentLabel = activeComposerIntent
    ? assistantIntentLabel(activeComposerIntent, t)
    : "";
  const [refreshedModelOptions, setRefreshedModelOptions] = useState<AiProviderModelOption[]>([]);
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const chatLogRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const addContextMenuRef = useRef<HTMLDivElement | null>(null);
  const permissionMenuRef = useRef<HTMLDivElement | null>(null);
  const permissionWidthMeasureRef = useRef<HTMLDivElement | null>(null);
  const modelSelectRef = useRef<HTMLSelectElement | null>(null);
  const modelWidthMeasureRef = useRef<HTMLDivElement | null>(null);
  const regionTargetRef = useRef<HTMLDivElement | null>(null);
  const regionSelectionRef = useRef<HTMLDivElement | null>(null);
  const activeAssistantRequestIdRef = useRef(0);
  const allowedToolApprovalsForCurrentChatRef = useRef<Set<string>>(new Set());
  const forceChatScrollToBottomRef = useRef(false);
  const wasCollapsedRef = useRef(collapsed);
  const workspaceContextLabel = activeTab
    ? `${activeTab.title} - ${workspaceKindLabel(activeTab)}`
    : t("ai.noActiveSession");
  const workspaceConnectionLabel = activeTab?.connection
    ? `${activeTab.connection.user}@${activeTab.connection.host}`
    : t("ai.workspace");
  const contextLabel = pageContext?.contextLabel ?? workspaceContextLabel;
  const connectionLabel = pageContext?.connectionLabel ?? workspaceConnectionLabel;
  const pageContextPayload =
    pageContext && pageContext.text.trim()
      ? {
          sourceLabel: pageContext.sourceLabel,
          text: pageContext.text,
        }
      : undefined;
  const dashboardToolsEnabled =
    pageContext?.contextKind === "dashboard" && Boolean(aiProviderSettings.tools?.dashboard);
  const providerDefinition = getAiProviderDefinition(aiProviderSettings.providerKind);
  const assistantModelOptions = useMemo(
    () =>
      selectModelOptionsForProvider({
        customModel: aiProviderSettings.model,
        provider: providerDefinition,
        refreshedModels: refreshedModelOptions,
        showAllModels: aiProviderSettings.showAllModels,
      }),
    [
      aiProviderSettings.model,
      aiProviderSettings.showAllModels,
      providerDefinition,
      refreshedModelOptions,
    ],
  );
  const currentModel = aiProviderSettings.model || providerDefinition.defaultModel;
  const currentToolPermissionMode = aiProviderSettings.toolPermissionMode ?? "prompt";
  const modelOptionIds = useMemo(
    () => new Set(assistantModelOptions.map((model) => model.id)),
    [assistantModelOptions],
  );
  const hasCustomModel = currentModel.trim().length > 0 && !modelOptionIds.has(currentModel);
  const toolPermissionLabels = useMemo(
    () => [t("ai.toolPermissionPrompt"), t("ai.toolPermissionAllowAll")],
    [t],
  );
  const modelSelectLabels = useMemo(
    () => [
      ...(hasCustomModel ? [currentModel] : []),
      ...assistantModelOptions.map((model) => model.label),
    ],
    [assistantModelOptions, currentModel, hasCustomModel],
  );
  const currentModelSupportsImageInput = modelSupportsImageInput(
    providerDefinition,
    currentModel,
  );
  const assistantScreenshotContext =
    assistantContextSnippet?.kind === "screenshot"
      ? {
          sourceLabel: assistantContextSnippet.sourceLabel,
          dataUrl: assistantContextSnippet.imageDataUrl,
        }
      : undefined;
  const hasPendingImageContext = pastedImageContexts.length > 0 || Boolean(assistantScreenshotContext);
  const showImageNotSupportedNotice =
    !currentModelSupportsImageInput && (hasPendingImageContext || imagePasteRejected);
  const activeTerminalPaneId =
    !pageContext && activeTab?.kind === "terminal"
      ? activeTab.focusedPaneId ?? activeTab.panes[0]?.id
      : undefined;
  const activeFocusedPane =
    activeTab?.kind === "terminal"
      ? activeTab.panes.find((pane) => pane.id === activeTerminalPaneId) ?? activeTab.panes[0]
      : undefined;
  const activeFocusedTerminalPane =
    activeFocusedPane?.kind === undefined || activeFocusedPane?.kind === "terminal"
      ? activeFocusedPane
      : undefined;
  const canAttachTerminalBuffer =
    Boolean(activeFocusedTerminalPane) &&
    (!activeFocusedTerminalPane?.connection ||
      activeFocusedTerminalPane.connection.type === "local" ||
      activeFocusedTerminalPane.connection.type === "ssh");
  const activeRdpPaneId =
    !pageContext && activeTab?.kind === "remoteDesktop" && activeTab.connection?.type === "rdp"
      ? activeTab.focusedPaneId ?? activeTab.panes[0]?.id
      : undefined;
  const sortedChatHistory = useMemo(() => sortedAssistantThreads(chatHistory), [chatHistory]);
  const recentChatHistory = sortedChatHistory.slice(0, 5);
  const shouldShowChatHistory = messages.length === 0 && !prompt.trim() && !isSendingPrompt;
  const shouldShowPreStreamWaiting =
    isSendingPrompt && !messages.some((message) => message.role === "assistant" && message.isStreaming);
  const streamingMessageIndex = messages.findIndex((message) => message.isStreaming);

  useEffect(() => {
    if (
      !isTauriRuntime() ||
      !providerDefinition.modelListStrategy ||
      (providerDefinition.requiresApiKey && !aiProviderHasApiKey)
    ) {
      setRefreshedModelOptions([]);
      return;
    }

    let disposed = false;
    void invokeCommand("list_ai_provider_models", {
      request: {
        providerKind: aiProviderSettings.providerKind,
        baseUrl: aiProviderSettings.baseUrl,
        allowInsecureTls: aiProviderSettings.allowInsecureTls,
      },
    })
      .then((models) => {
        if (disposed) return;
        setRefreshedModelOptions(
          sortModelOptionsForProvider(aiProviderSettings.providerKind, models),
        );
      })
      .catch(() => {
        if (!disposed) setRefreshedModelOptions([]);
      });

    return () => {
      disposed = true;
    };
  }, [
    aiProviderHasApiKey,
    aiProviderSettings.allowInsecureTls,
    aiProviderSettings.baseUrl,
    aiProviderSettings.providerKind,
    providerDefinition.modelListStrategy,
    providerDefinition.requiresApiKey,
  ]);

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    let disposed = false;
    void loadAssistantChatHistoryFromStorage().then((threads) => {
      if (!disposed) {
        setChatHistory(threads);
      }
    });

    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) {
      writeLegacyAssistantChatHistory(chatHistory);
    }
  }, [chatHistory]);

  useEffect(() => {
    setAssistantWorking(isSendingPrompt);
    return () => setAssistantWorking(false);
  }, [isSendingPrompt, setAssistantWorking]);

  useEffect(() => {
    const wasCollapsed = wasCollapsedRef.current;
    wasCollapsedRef.current = collapsed;
    if (!wasCollapsed || collapsed || isSendingPrompt) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      composerTextareaRef.current?.focus();
    });

    return () => window.cancelAnimationFrame(frame);
  }, [collapsed, isSendingPrompt]);

  useEffect(() => {
    if (currentModelSupportsImageInput) {
      setImagePasteRejected(false);
    }
  }, [currentModelSupportsImageInput]);

  useEffect(() => {
    if (prompt) {
      sessionStorage.setItem("ai-chat-draft", prompt);
    } else {
      sessionStorage.removeItem("ai-chat-draft");
    }
  }, [prompt]);

  useLayoutEffect(() => {
    if (!forceChatScrollToBottomRef.current) {
      return;
    }

    scrollAssistantChatToBottom(chatLogRef.current);
    const frame = window.requestAnimationFrame(() => {
      scrollAssistantChatToBottom(chatLogRef.current);
      if (!isSendingPrompt && !shouldShowPreStreamWaiting) {
        forceChatScrollToBottomRef.current = false;
      }
    });

    return () => window.cancelAnimationFrame(frame);
  }, [isSendingPrompt, messages, pendingToolApprovals, shouldShowPreStreamWaiting]);

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<AssistantLiveToolRequest>("assistant-live-tool-request", (event) => {
      if (disposed) {
        return;
      }
      void completeAssistantLiveTool(event.payload);
    }).then((dispose) => {
      if (disposed) {
        dispose();
        return;
      }
      unlisten = dispose;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<AssistantToolApprovalRequest>("assistant-tool-approval-request", (event) => {
      if (disposed) {
        return;
      }
      const request = event.payload;
      const normalizedToolName = normalizeAssistantToolName(request.toolName);
      if (
        normalizedToolName &&
        allowedToolApprovalsForCurrentChatRef.current.has(normalizedToolName)
      ) {
        setPendingToolApprovals((current) => [
          ...current.filter((item) => item.requestId !== request.requestId),
          { ...request, status: "allowedSession" },
        ]);
        void completeAssistantToolApproval(request.requestId, true, {
          allowSession: true,
          toolName: request.toolName,
        });
        forceChatScrollToBottomRef.current = true;
        return;
      }
      setPendingToolApprovals((current) => [
        ...current.filter((item) => item.requestId !== request.requestId),
        { ...request, status: "pending" },
      ]);
      forceChatScrollToBottomRef.current = true;
    }).then((dispose) => {
      if (disposed) {
        dispose();
        return;
      }
      unlisten = dispose;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!addContextMenuOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const node = addContextMenuRef.current;
      if (node && !node.contains(event.target as Node)) {
        setAddContextMenuOpen(false);
      }
    };

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setAddContextMenuOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [addContextMenuOpen]);

  useEffect(() => {
    if (!permissionMenuOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const node = permissionMenuRef.current;
      if (node && !node.contains(event.target as Node)) {
        setPermissionMenuOpen(false);
      }
    };

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setPermissionMenuOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [permissionMenuOpen]);

  function handleSendCodeToTerminal(code: string) {
    if (activeTerminalPaneId) {
      const data = prepareAssistantTerminalInput(code);
      writeInputToPane(activeTerminalPaneId, data);
      return;
    }

    if (activeRdpPaneId) {
      const trimmed = code.replace(/\r?\n$/, "");
      const send = sendTextToRdpPane(activeRdpPaneId, trimmed, true);
      if (send) {
        send.catch((error) => {
          setChatError(error instanceof Error ? error.message : String(error));
        });
      }
    }
  }

  function handleChatSubmit(event: FormEvent) {
    event.preventDefault();
    void submitAssistantPrompt();
  }

  function handleStopAssistantPrompt() {
    if (!isSendingPrompt) {
      return;
    }

    activeAssistantRequestIdRef.current += 1;
    setIsSendingPrompt(false);
    setChatError("");
    pendingToolApprovals
      .filter((request) => request.status === "pending")
      .forEach((request) => {
        void completeAssistantToolApproval(request.requestId, false);
      });
    window.requestAnimationFrame(() => {
      composerTextareaRef.current?.focus();
    });
  }

  function handleNewChat() {
    if (isSendingPrompt) {
      return;
    }
    saveCurrentChat();
    setMessages([]);
    setCurrentThreadId(createAssistantChatThreadId());
    setCurrentThreadTitle(undefined);
    setPrompt("");
    setChatError("");
    setPastedImageContexts([]);
    setFileContexts([]);
    setImagePasteRejected(false);
    setAssistantIntent("chat");
    setPendingToolApprovals([]);
    allowedToolApprovalsForCurrentChatRef.current.clear();
    setDisplayedIntentExamples([]);
    setShowAllChats(false);
  }

  function saveCurrentChat() {
    if (messages.length === 0) {
      return;
    }
    saveChatMessages(messages, currentThreadTitle ?? assistantThreadTitle(messages));
  }

  function saveChatMessages(nextMessages: AssistantChatMessage[], title: string) {
    if (nextMessages.length === 0) {
      return;
    }
    const now = new Date().toISOString();
    const thread: AssistantChatThread = {
      id: currentThreadId,
      title,
      contextLabel,
      messages: nextMessages,
      createdAt: nextMessages[0]?.createdAt ?? now,
      updatedAt: nextMessages[nextMessages.length - 1]?.createdAt ?? now,
    };
    setChatHistory((current) => upsertAssistantChatThread(current, thread));
    if (isTauriRuntime()) {
      void invokeCommand("upsert_assistant_chat_thread", {
        request: assistantChatThreadToRecord(thread),
      }).catch((error) => {
        setChatError(error instanceof Error ? error.message : String(error));
      });
    }
  }

  function appendLocalAssistantMessage(content: string, intent?: AssistantPromptIntent) {
    const assistantMessage = createAssistantChatMessage("assistant", content, intent ?? assistantIntent);
    const nextMessages = [...messages, assistantMessage];
    const title = currentThreadTitle ?? assistantThreadTitle(nextMessages);
    setMessages(nextMessages);
    setCurrentThreadTitle(title);
    saveChatMessages(nextMessages, title);
  }

  function resumeChat(thread: AssistantChatThread) {
    if (isSendingPrompt) {
      return;
    }
    saveCurrentChat();
    setCurrentThreadId(thread.id);
    setCurrentThreadTitle(thread.title);
    setMessages(thread.messages);
    setPrompt("");
    setChatError("");
    setPastedImageContexts([]);
    setFileContexts([]);
    setImagePasteRejected(false);
    setAssistantIntent("chat");
    setPendingToolApprovals([]);
    allowedToolApprovalsForCurrentChatRef.current.clear();
    setDisplayedIntentExamples([]);
    setShowAllChats(false);
  }

  function deleteChat(threadId: string) {
    setChatHistory((current) => current.filter((thread) => thread.id !== threadId));
    if (isTauriRuntime()) {
      void invokeCommand("delete_assistant_chat_thread", { threadId }).catch((error) => {
        setChatError(error instanceof Error ? error.message : String(error));
      });
    }
    if (threadId === currentThreadId) {
      setMessages([]);
      setCurrentThreadId(createAssistantChatThreadId());
      setCurrentThreadTitle(undefined);
      setPrompt("");
      setChatError("");
      setPastedImageContexts([]);
      setFileContexts([]);
      setImagePasteRejected(false);
      setAssistantIntent("chat");
      setPendingToolApprovals([]);
      allowedToolApprovalsForCurrentChatRef.current.clear();
      setDisplayedIntentExamples([]);
    }
  }

  async function handleCopyMessage(message: AssistantChatMessage) {
    const parsed = parseAssistantSecretRequests(message.content);
    const attachmentText =
      message.textAttachments
        ?.map((attachment) => `${attachment.sourceLabel}\n\n${attachment.text}`)
        .join("\n\n") ?? "";
    await writeToClipboard(
      attachmentText ? `${parsed.markdown}\n\n${attachmentText}` : parsed.markdown,
    );
  }

  async function handleCopyCode(code: string) {
    await writeToClipboard(code);
  }

  async function handleModelChange(model: string) {
    const previousSettings = aiProviderSettings;
    const nextSettings = normalizeAiProviderDraft({
      ...previousSettings,
      model,
    });
    setAiProviderSettings(nextSettings);
    setChatError("");

    if (!isTauriRuntime()) {
      return;
    }

    try {
      const saved = await invokeCommand("update_ai_provider_settings", {
        request: nextSettings,
      });
      setAiProviderSettings(saved);
    } catch (error) {
      setAiProviderSettings(previousSettings);
      setChatError(error instanceof Error ? error.message : String(error));
    }
  }

  async function completeAssistantLiveTool(request: AssistantLiveToolRequest) {
    let result: unknown;
    try {
      result = await runAssistantLiveTool(request.toolName, request.args ?? {});
    } catch (error) {
      result = { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    try {
      await invokeCommand("complete_assistant_live_tool_request", {
        completion: {
          requestId: request.requestId,
          result: JSON.stringify(result),
        },
      });
    } catch (error) {
      setChatError(error instanceof Error ? error.message : String(error));
    }
  }

  async function completeAssistantToolApproval(
    requestId: string,
    approved: boolean,
    options?: { allowSession?: boolean; toolName?: string },
  ) {
    if (options?.allowSession) {
      const toolName = normalizeAssistantToolName(
        options.toolName ?? pendingToolApprovals.find((item) => item.requestId === requestId)?.toolName,
      );
      if (toolName) {
        allowedToolApprovalsForCurrentChatRef.current.add(toolName);
      }
    }
    setPendingToolApprovals((current) =>
      current.map((item) =>
        item.requestId === requestId
          ? {
              ...item,
              status: options?.allowSession ? "allowedSession" : approved ? "approved" : "denied",
            }
          : item,
      ),
    );
    try {
      await invokeCommand("complete_assistant_tool_approval_request", {
        completion: { requestId, approved },
      });
    } catch (error) {
      setChatError(error instanceof Error ? error.message : String(error));
    }
  }

  async function runAssistantLiveTool(toolName: string, args: Record<string, unknown>) {
    switch (toolName) {
      case "tutorial_highlight":
        return assistantTutorialHighlight(args);
      case "session_state":
        return assistantSessionState();
      case "session_terminal_read_buffer":
        return assistantTerminalReadBuffer(args);
      case "session_terminal_send_text":
        return assistantTerminalSendText(args);
      case "session_remote_desktop_screenshot":
        return assistantRemoteDesktopScreenshot(args);
      case "session_remote_desktop_send_text":
        return assistantRemoteDesktopSendText(args);
      case "session_remote_desktop_keypress":
        return assistantRemoteDesktopKeyPress(args);
      case "session_remote_desktop_mouse_click":
        return assistantRemoteDesktopMouseClick(args);
      case "session_file_browser_list":
        return assistantFileBrowserList(args);
      case "session_file_browser_create_folder":
        return assistantFileBrowserCreateFolder(args);
      case "session_file_browser_rename":
        return assistantFileBrowserRename(args);
      case "session_file_browser_delete":
        return assistantFileBrowserDelete(args);
      default:
        return { ok: false, error: `Unknown live Session tool: ${toolName}` };
    }
  }

  async function assistantTutorialHighlight(args: Record<string, unknown>) {
    const targetId = typeof args.targetId === "string" ? args.targetId.trim() : "";
    const title = typeof args.title === "string" ? args.title.trim() : "";
    const body = typeof args.body === "string" ? args.body.trim() : "";
    if (!targetId || !title || !body) {
      return { ok: false, error: t("ai.tutorialInvalidRequest") };
    }
    const navigation =
      normalizeTutorialNavigationTarget(args.navigation) ??
      normalizeTutorialNavigationTarget(args) ??
      tutorialNavigationForTarget(targetId);
    return onTutorialRequest({ targetId, title, body, navigation });
  }

  function assistantSessionState() {
    const state = useWorkspaceStore.getState();
    return {
      ok: true,
      activeTabId: state.activeTabId,
      tabs: state.tabs.map((tab) => ({
        id: tab.id,
        title: tab.title,
        kind: tab.kind,
        active: tab.id === state.activeTabId,
        focusedPaneId: tab.focusedPaneId,
        connection: tab.connection
          ? {
              id: tab.connection.id,
              name: tab.connection.name,
              type: tab.connection.type,
              host: tab.connection.host,
              user: tab.connection.user,
            }
          : null,
        panes: tab.panes.map((pane) => ({
          id: pane.id,
          kind: pane.kind ?? "terminal",
          title: pane.title,
          hasTerminalBuffer: Boolean(getPaneRenderer(pane.id)),
          hasRemoteDesktopController: Boolean(getRemoteDesktopController(pane.id)),
        })),
        fileBrowser: tab.kind === "sftp" || tab.kind === "ftp"
          ? getFileBrowserController(tab.id)?.snapshot() ?? null
          : null,
      })),
    };
  }

  function activeTerminalPaneIdForLiveTool(paneId: unknown) {
    if (typeof paneId === "string" && paneId.trim()) {
      return paneId.trim();
    }
    const state = useWorkspaceStore.getState();
    const tab = state.tabs.find((entry) => entry.id === state.activeTabId);
    if (!tab || tab.kind !== "terminal") {
      return "";
    }
    return tab.focusedPaneId ?? tab.panes[0]?.id ?? "";
  }

  function activeRemoteDesktopPaneIdForLiveTool(paneId: unknown) {
    if (typeof paneId === "string" && paneId.trim()) {
      return paneId.trim();
    }
    const state = useWorkspaceStore.getState();
    const tab = state.tabs.find((entry) => entry.id === state.activeTabId);
    if (!tab || tab.kind !== "remoteDesktop") {
      return "";
    }
    return tab.focusedPaneId ?? tab.panes[0]?.id ?? "";
  }

  function activeFileBrowserTabIdForLiveTool(tabId: unknown) {
    if (typeof tabId === "string" && tabId.trim()) {
      return tabId.trim();
    }
    const state = useWorkspaceStore.getState();
    const tab = state.tabs.find((entry) => entry.id === state.activeTabId);
    if (!tab || (tab.kind !== "sftp" && tab.kind !== "ftp")) {
      return "";
    }
    return tab.id;
  }

  function assistantTerminalReadBuffer(args: Record<string, unknown>) {
    const paneId = activeTerminalPaneIdForLiveTool(args.paneId);
    const renderer = paneId ? getPaneRenderer(paneId) : undefined;
    if (!paneId || !renderer) {
      return { ok: false, error: "No active terminal Pane is available." };
    }
    const maxChars =
      typeof args.maxChars === "number" && Number.isFinite(args.maxChars)
        ? Math.max(1, Math.min(50_000, Math.trunc(args.maxChars)))
        : 20_000;
    const text = renderer.getBufferText();
    return {
      ok: true,
      paneId,
      text: text.length > maxChars ? text.slice(text.length - maxChars) : text,
      truncated: text.length > maxChars,
    };
  }

  function assistantTerminalSendText(args: Record<string, unknown>) {
    const paneId = activeTerminalPaneIdForLiveTool(args.paneId);
    const text = typeof args.text === "string" ? args.text : "";
    if (!paneId || !text) {
      return { ok: false, error: "Terminal paneId and text are required." };
    }
    const data = args.pressEnter === false ? text : prepareAssistantTerminalInput(text);
    const sent = writeInputToPane(paneId, data);
    return sent ? { ok: true, paneId } : { ok: false, error: "Terminal Pane is not writable." };
  }

  async function assistantRemoteDesktopScreenshot(args: Record<string, unknown>) {
    const paneId = activeRemoteDesktopPaneIdForLiveTool(args.paneId);
    const controller = paneId ? getRemoteDesktopController(paneId) : undefined;
    if (!paneId || !controller) {
      return { ok: false, error: "No active remote desktop Session is available." };
    }
    const screenshot = await controller.captureScreenshot();
    return { ok: true, paneId, screenshot };
  }

  async function assistantRemoteDesktopSendText(args: Record<string, unknown>) {
    const paneId = activeRemoteDesktopPaneIdForLiveTool(args.paneId);
    const controller = paneId ? getRemoteDesktopController(paneId) : undefined;
    const text = typeof args.text === "string" ? args.text : "";
    if (!paneId || !controller || !text) {
      return { ok: false, error: "Remote desktop paneId and text are required." };
    }
    await controller.sendText(text, args.pressEnter !== false);
    return { ok: true, paneId, kind: controller.kind };
  }

  async function assistantRemoteDesktopKeyPress(args: Record<string, unknown>) {
    const paneId = activeRemoteDesktopPaneIdForLiveTool(args.paneId);
    const controller = paneId ? getRemoteDesktopController(paneId) : undefined;
    const key = typeof args.key === "string" ? args.key : "";
    if (!paneId || !controller || !key) {
      return { ok: false, error: "Remote desktop paneId and key are required." };
    }
    await controller.keyPress(key);
    return { ok: true, paneId, kind: controller.kind, key };
  }

  async function assistantRemoteDesktopMouseClick(args: Record<string, unknown>) {
    const paneId = activeRemoteDesktopPaneIdForLiveTool(args.paneId);
    const controller = paneId ? getRemoteDesktopController(paneId) : undefined;
    if (!paneId || !controller?.mouseClick) {
      return { ok: false, error: "No active remote desktop Session is available for mouse input." };
    }
    const x = typeof args.x === "number" ? Math.max(0, Math.trunc(args.x)) : 0;
    const y = typeof args.y === "number" ? Math.max(0, Math.trunc(args.y)) : 0;
    const button = args.button === "right" || args.button === "middle" ? args.button : "left";
    await controller.mouseClick(x, y, button);
    return { ok: true, paneId, x, y, button };
  }

  async function assistantFileBrowserList(args: Record<string, unknown>) {
    const tabId = activeFileBrowserTabIdForLiveTool(args.tabId);
    const controller = tabId ? getFileBrowserController(tabId) : undefined;
    if (!tabId || !controller) {
      return { ok: false, error: "No active SFTP/FTP file browser Session is available." };
    }
    const path = typeof args.path === "string" ? args.path : null;
    const listing = await controller.list(path);
    return { ok: true, tabId, kind: controller.kind, listing };
  }

  async function assistantFileBrowserCreateFolder(args: Record<string, unknown>) {
    const tabId = activeFileBrowserTabIdForLiveTool(args.tabId);
    const controller = tabId ? getFileBrowserController(tabId) : undefined;
    const parentPath = typeof args.parentPath === "string" ? args.parentPath : "";
    const name = typeof args.name === "string" ? args.name : "";
    if (!tabId || !controller || !parentPath || !name) {
      return { ok: false, error: "File browser tabId, parentPath, and name are required." };
    }
    const result = await controller.createFolder(parentPath, name);
    return { ok: true, tabId, kind: controller.kind, result };
  }

  async function assistantFileBrowserRename(args: Record<string, unknown>) {
    const tabId = activeFileBrowserTabIdForLiveTool(args.tabId);
    const controller = tabId ? getFileBrowserController(tabId) : undefined;
    const path = typeof args.path === "string" ? args.path : "";
    const newName = typeof args.newName === "string" ? args.newName : "";
    if (!tabId || !controller || !path || !newName) {
      return { ok: false, error: "File browser tabId, path, and newName are required." };
    }
    const result = await controller.rename(path, newName);
    return { ok: true, tabId, kind: controller.kind, result };
  }

  async function assistantFileBrowserDelete(args: Record<string, unknown>) {
    const tabId = activeFileBrowserTabIdForLiveTool(args.tabId);
    const controller = tabId ? getFileBrowserController(tabId) : undefined;
    const path = typeof args.path === "string" ? args.path : "";
    if (!tabId || !controller || !path) {
      return { ok: false, error: "File browser tabId and path are required." };
    }
    const result = await controller.deletePath(path);
    return { ok: true, tabId, kind: controller.kind, result };
  }

  async function handleToolPermissionModeChange(toolPermissionMode: AiToolPermissionMode) {
    setPermissionMenuOpen(false);
    if (toolPermissionMode === currentToolPermissionMode) {
      return;
    }

    const previousSettings = aiProviderSettings;
    const nextSettings = normalizeAiProviderDraft({
      ...previousSettings,
      toolPermissionMode,
    });
    setAiProviderSettings(nextSettings);
    setChatError("");

    if (!isTauriRuntime()) {
      return;
    }

    try {
      const saved = await invokeCommand("update_ai_provider_settings", {
        request: nextSettings,
      });
      setAiProviderSettings(saved);
    } catch (error) {
      setAiProviderSettings(previousSettings);
      setChatError(error instanceof Error ? error.message : String(error));
    }
  }

  function handleAddFiles() {
    setAddContextMenuOpen(false);
    fileInputRef.current?.click();
  }

  async function handleFileInputChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    if (files.length === 0) {
      return;
    }

    try {
      const imageAttachments: AssistantImageAttachment[] = [];
      const fileAttachments: AssistantFileAttachment[] = [];
      for (const file of files) {
        if (file.size > ASSISTANT_FILE_MAX_BYTES) {
          showStatusBarNotice(t("ai.fileTooLarge", { name: file.name }), { tone: "warning" });
          continue;
        }
        const dataUrl = await readFileAsDataUrl(file);
        if (file.type.startsWith("image/")) {
          imageAttachments.push(await createImageAttachment(file.name, dataUrl));
          continue;
        }
        fileAttachments.push({
          id: `assistant-file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          sourceLabel: file.name,
          dataUrl,
          mimeType: file.type || "application/octet-stream",
          size: file.size,
        });
      }
      if (imageAttachments.length > 0) {
        setPastedImageContexts((current) => [...current, ...imageAttachments]);
      }
      if (fileAttachments.length > 0) {
        setFileContexts((current) => [...current, ...fileAttachments]);
      }
      setImagePasteRejected(false);
    } catch (error) {
      setChatError(error instanceof Error ? error.message : String(error));
    } finally {
      composerTextareaRef.current?.focus();
    }
  }

  function handleOpenAssistantLink(url: string) {
    openExternalUrl(url).catch((error) => {
      setChatError(error instanceof Error ? error.message : String(error));
    });
  }

  function handleAddScreenshot() {
    setAddContextMenuOpen(false);
    if (activeTab?.kind === "remoteDesktop" && activeTab.connection?.type === "rdp") {
      requestRdpPreCapture();
    }
    setScreenshotRegionState({ bounds: appViewportBounds() });
  }

  function handleSelectAssistantIntent(intent: AssistantPromptIntent) {
    setAssistantIntent(intent);
    setAddContextMenuOpen(false);
    const all = assistantIntentExamples(intent, t);
    setDisplayedIntentExamples(sampleRandom(all, 3));
    window.requestAnimationFrame(() => {
      composerTextareaRef.current?.focus();
    });
  }

  function handleClearAssistantIntent() {
    setAssistantIntent("chat");
    setDisplayedIntentExamples([]);
    window.requestAnimationFrame(() => {
      composerTextareaRef.current?.focus();
    });
  }

  function handleUseIntentExample(example: string) {
    setPrompt(example);
    window.requestAnimationFrame(() => {
      composerTextareaRef.current?.focus();
    });
  }

  async function handleAddTerminalBuffer() {
    setAddContextMenuOpen(false);
    const pane = activeFocusedTerminalPane;
    if (!pane) {
      return;
    }

    let text = "";
    if (pane.connection?.type === "ssh" && pane.tmuxSessionId) {
      try {
        text = await invokeCommand("capture_tmux_pane", {
          request: {
            host: pane.connection.host,
            user: pane.connection.user,
            port: pane.connection.port,
            keyPath: pane.connection.keyPath,
            proxyJump: pane.connection.proxyJump,
            authMethod: pane.connection.authMethod,
            secretOwnerId: pane.connection.id,
            tmuxSessionId: pane.tmuxSessionId,
            bufferLines: useWorkspaceStore.getState().sshSettings.bufferLines,
          },
        });
      } catch {
        text = getPaneRenderer(pane.id)?.getBufferText() ?? "";
      }
    } else {
      text = getPaneRenderer(pane.id)?.getBufferText() ?? "";
    }

    const trimmed = text.trim();
    if (!trimmed) {
      composerTextareaRef.current?.focus();
      return;
    }
    const sourceLabel = pane.connection
      ? `${pane.connection.name} ${t("terminal.terminalBuffer")}`
      : `${pane.title} ${t("terminal.terminalBuffer")}`;
    setAssistantContextSnippet({
      id: `terminal-buffer-${Date.now()}`,
      kind: "text",
      sourceLabel,
      text: trimmed,
      capturedAt: new Date().toISOString(),
    });
    composerTextareaRef.current?.focus();
  }

  async function generateThreadTitleFromProvider(
    userPrompt: string,
    requestIntent: AssistantPromptIntent,
  ) {
    const response = await invokeCommand("run_ai_agent", {
      request: {
        prompt:
          "Create a concise chat title for this user request. Return only the title, no quotes, no markdown, maximum 8 words.\n\nUser request:\n" +
          userPrompt,
        contextLabel,
        intent: assistantAgentIntent(requestIntent),
        messages: [],
        pageContext: pageContextPayload,
        allowTools: false,
        outputLanguage: resolveAssistantOutputLanguage(aiProviderSettings.outputLanguage),
      },
    });
    return sanitizeAssistantThreadTitle(response.content);
  }

  async function submitAssistantPrompt() {
    const normalizedPrompt = prompt.trim();
    if (!normalizedPrompt || isSendingPrompt) {
      return;
    }
    const requestIntent = assistantIntentForPrompt(assistantIntent, normalizedPrompt);
    setAssistantIntent(requestIntent);
    const textAttachments: AssistantTextAttachment[] =
      assistantContextSnippet?.kind === "text"
        ? [
            {
              id: assistantContextSnippet.id,
              sourceLabel: assistantContextSnippet.sourceLabel,
              text: assistantContextSnippet.text,
              capturedAt: assistantContextSnippet.capturedAt,
            },
          ]
        : [];
    let imageAttachments: AssistantImageAttachment[] = [];
    if (currentModelSupportsImageInput) {
      imageAttachments = [...pastedImageContexts];
      if (assistantScreenshotContext) {
        try {
          imageAttachments = [
            ...imageAttachments,
            await createImageAttachment(
              assistantScreenshotContext.sourceLabel,
              assistantScreenshotContext.dataUrl,
            ),
          ];
        } catch (error) {
          setChatError(error instanceof Error ? error.message : String(error));
          return;
        }
      }
    }
    const userMessage = createAssistantChatMessage(
      "user",
      normalizedPrompt,
      requestIntent,
      textAttachments.length > 0 ? textAttachments : undefined,
      imageAttachments.length > 0 ? imageAttachments : undefined,
      fileContexts.length > 0 ? fileContexts : undefined,
    );
    const previousMessages = messages;
    const nextMessages = [...previousMessages, userMessage];
    forceChatScrollToBottomRef.current = true;
    const isFirstThreadMessage = previousMessages.length === 0;
    const fallbackTitle = currentThreadTitle ?? assistantThreadTitle(nextMessages);
    try {
      validateAiProviderForChat(aiProviderSettings, aiProviderHasApiKey);
    } catch (error) {
      const providerErrorMessage = error instanceof Error ? error.message : String(error);
      const missingProviderKey =
        providerDefinition.requiresApiKey && !aiProviderHasApiKey;
      const assistantMessage = createAssistantChatMessage(
        "assistant",
        missingProviderKey
          ? createAiProviderSecretRequestMarkdown(
              providerDefinition.apiKeyLabel,
              providerDefinition.label,
              aiProviderSettings.providerKind,
            )
          : `${t("ai.providerError")}: ${providerErrorMessage}`,
        requestIntent,
      );
      const failedMessages = [...nextMessages, assistantMessage];
      setMessages(failedMessages);
      setCurrentThreadTitle(fallbackTitle);
      saveChatMessages(failedMessages, fallbackTitle);
      setPrompt("");
      setPastedImageContexts([]);
      setFileContexts([]);
      setImagePasteRejected(false);
      if (assistantContextSnippet) {
        clearAssistantContextSnippet();
      }
      setChatError("");
      return;
    }

    const history = previousMessages.map((message) => ({
      role: message.role,
      content: message.content,
      reasoningContent: message.reasoningContent,
    }));
    setMessages(nextMessages);
    setCurrentThreadTitle(fallbackTitle);
    saveChatMessages(nextMessages, fallbackTitle);
    setPrompt("");
    setPastedImageContexts([]);
    setFileContexts([]);
    setImagePasteRejected(false);
    if (assistantContextSnippet) {
      clearAssistantContextSnippet();
    }
    setChatError("");
    setPendingToolApprovals([]);
    setIsSendingPrompt(true);
    const requestId = activeAssistantRequestIdRef.current + 1;
    activeAssistantRequestIdRef.current = requestId;
    const workStartedAt = new Date().toISOString();
    let threadTitle = fallbackTitle;
    try {
      if (isFirstThreadMessage) {
        const generatedTitle = await generateThreadTitleFromProvider(normalizedPrompt, requestIntent);
        if (activeAssistantRequestIdRef.current !== requestId) {
          return;
        }
        if (generatedTitle) {
          threadTitle = generatedTitle;
          setCurrentThreadTitle(generatedTitle);
          saveChatMessages(nextMessages, generatedTitle);
        }
      }

      const systemContext = await inspectActiveSshSystemContext(activeTab);
      if (activeAssistantRequestIdRef.current !== requestId) {
        return;
      }

      const streamingMessage = createAssistantChatMessage(
        "assistant",
        "",
        requestIntent,
      );
      streamingMessage.isStreaming = true;
      streamingMessage.workStartedAt = workStartedAt;
      let streamingMessageSnapshot = streamingMessage;
      const messagesWithStreaming = [...nextMessages, streamingMessage];
      setMessages(messagesWithStreaming);

      const channel = new Channel<AiStreamEvent>();
      channel.onmessage = (event: AiStreamEvent) => {
        if (activeAssistantRequestIdRef.current !== requestId) {
          return;
        }
        logAssistantStreamEvent(event);
        if (event.type === "toolCallEnd" && isDashboardMutatingTool(event.toolName)) {
          if (event.error) {
            useWorkspaceStore.getState().showStatusBarNotice(
              `${event.toolName} failed: ${event.error}`,
              { tone: "error", durationMs: 8_000 },
            );
          } else {
            void useDashboardStore.getState().load();
          }
        }
        streamingMessageSnapshot = {
          ...streamingMessageSnapshot,
          ...applyAssistantStreamEventToMessage(streamingMessageSnapshot, event, {
            errorPrefix: t("ai.errorPrefix"),
            now: () => new Date().toISOString(),
            workStartedAt,
          }),
        };
        setMessages((current) =>
          current.map((message) =>
            message.id === streamingMessage.id ? streamingMessageSnapshot : message,
          ),
        );
      };

      const response = await invokeCommand("run_ai_agent_streaming", {
        channel,
        request: {
          prompt: assistantPromptForIntent(requestIntent, normalizedPrompt, previousMessages),
          contextLabel,
          intent: assistantAgentIntent(requestIntent),
          selectedOutput: textAttachments[0]?.text,
          pageContext: pageContextPayload,
          screenshots: imageAttachments.map((attachment) => ({
            sourceLabel: attachment.sourceLabel,
            dataUrl: attachment.imageDataUrl,
          })),
          files: fileContexts.map((attachment) => ({
            sourceLabel: attachment.sourceLabel,
            dataUrl: attachment.dataUrl,
            mimeType: attachment.mimeType,
          })),
          systemContext,
          messages: history,
          outputLanguage: resolveAssistantOutputLanguage(aiProviderSettings.outputLanguage),
        },
      });

      if (activeAssistantRequestIdRef.current !== requestId) {
        return;
      }

      const completedAt = new Date().toISOString();
      streamingMessageSnapshot = completeAssistantStreamMessageFromResponse(
        streamingMessageSnapshot,
        response,
      );
      streamingMessageSnapshot = {
        ...streamingMessageSnapshot,
        isStreaming: false,
        workCompletedAt: completedAt,
        toolCalls: (streamingMessageSnapshot.toolCalls ?? []).map((tc) =>
          tc.status === "running" ? { ...tc, status: "completed", endedAt: completedAt } : tc,
        ),
      };
      setMessages((current) =>
        current.map((message) =>
          message.id === streamingMessage.id ? streamingMessageSnapshot : message,
        ),
      );
      saveChatMessages([...nextMessages, streamingMessageSnapshot], threadTitle);
    } catch (error) {
      if (activeAssistantRequestIdRef.current !== requestId) {
        return;
      }

      const message = error instanceof Error ? error.message : String(error);
      setChatError(message);
      const failedMessages = [
        ...nextMessages,
        createAssistantChatMessage("assistant", `${t("ai.errorPrefix")}: ${message}`, requestIntent),
      ];
      setMessages(failedMessages);
      saveChatMessages(failedMessages, threadTitle);
    } finally {
      if (activeAssistantRequestIdRef.current === requestId) {
        setIsSendingPrompt(false);
      }
    }
  }

  function denyAssistantToolApproval(request: PendingToolApproval) {
    activeAssistantRequestIdRef.current += 1;
    setIsSendingPrompt(false);
    setChatError("");
    const completedAt = new Date().toISOString();
    setMessages((current) =>
      current.map((message) =>
        message.isStreaming
          ? {
              ...message,
              isStreaming: false,
              workCompletedAt: completedAt,
              toolCalls: (message.toolCalls ?? []).map((toolCall) =>
                toolCall.status === "running"
                  ? { ...toolCall, status: "completed", endedAt: completedAt }
                  : toolCall,
              ),
            }
          : message,
      ),
    );
    void completeAssistantToolApproval(request.requestId, false);
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter") {
      return;
    }

    if (event.ctrlKey) {
      event.preventDefault();
      const textarea = event.currentTarget;
      const selectionStart = textarea.selectionStart;
      const selectionEnd = textarea.selectionEnd;
      const nextPrompt = `${prompt.slice(0, selectionStart)}\n${prompt.slice(selectionEnd)}`;
      const nextCaret = selectionStart + 1;
      setPrompt(nextPrompt);
      window.requestAnimationFrame(() => {
        composerTextareaRef.current?.setSelectionRange(nextCaret, nextCaret);
      });
      return;
    }

    if (event.metaKey || event.shiftKey || event.altKey) {
      return;
    }

    event.preventDefault();
    void submitAssistantPrompt();
  }

  async function handleComposerPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const clipboardFiles = Array.from(event.clipboardData.files).filter((file) =>
      file.type.startsWith("image/"),
    );
    const imageFiles =
      clipboardFiles.length > 0
        ? clipboardFiles
        : Array.from(event.clipboardData.items).flatMap((item) => {
            if (!item.type.startsWith("image/")) {
              return [];
            }
            const file = item.getAsFile();
            return file ? [file] : [];
          });
    if (imageFiles.length === 0) {
      return;
    }

    event.preventDefault();
    if (!currentModelSupportsImageInput) {
      setImagePasteRejected(true);
      return;
    }

    try {
      const attachments = await Promise.all(
        imageFiles.map(async (imageFile, index) => {
          const dataUrl = await readImageFileAsDataUrl(imageFile);
          const attachment = await createImageAttachment(t("ai.pastedImageSource"), dataUrl);
          return imageFiles.length === 1
            ? attachment
            : {
                ...attachment,
                sourceLabel: t("ai.pastedImageSourceWithNumber", { number: index + 1 }),
              };
        }),
      );
      setPastedImageContexts((current) => [...current, ...attachments]);
      setImagePasteRejected(false);
    } catch (error) {
      setImagePasteRejected(true);
      setChatError(error instanceof Error ? error.message : String(error));
    }
  }

  function insertTextIntoComposer(textarea: HTMLTextAreaElement, text: string) {
    const selectionStart = textarea.selectionStart;
    const selectionEnd = textarea.selectionEnd;
    const nextPrompt = `${textarea.value.slice(0, selectionStart)}${text}${textarea.value.slice(selectionEnd)}`;
    const nextCaret = selectionStart + text.length;
    setPrompt(nextPrompt);
    window.requestAnimationFrame(() => {
      composerTextareaRef.current?.focus();
      composerTextareaRef.current?.setSelectionRange(nextCaret, nextCaret);
    });
  }

  function deleteComposerSelection(textarea: HTMLTextAreaElement) {
    insertTextIntoComposer(textarea, "");
  }

  async function handleComposerContextMenu(event: MouseEvent<HTMLTextAreaElement>) {
    event.preventDefault();
    event.stopPropagation();

    const textarea = event.currentTarget;
    const hasSelection = textarea.selectionStart !== textarea.selectionEnd;
    const opened = await showNativeContextMenu(
      [
        {
          kind: "item",
          label: t("common.copy"),
          disabled: !hasSelection,
          action: () => {
            const selectedText = textarea.value.slice(textarea.selectionStart, textarea.selectionEnd);
            if (selectedText) {
              void writeToClipboard(selectedText);
            }
            textarea.focus();
          },
        },
        {
          kind: "item",
          label: t("common.cut"),
          disabled: !hasSelection || textarea.disabled,
          action: () => {
            const selectedText = textarea.value.slice(textarea.selectionStart, textarea.selectionEnd);
            if (selectedText) {
              void writeToClipboard(selectedText);
              deleteComposerSelection(textarea);
            }
          },
        },
        {
          kind: "item",
          label: t("common.paste"),
          disabled: textarea.disabled,
          action: () => {
            void readFromClipboard().then((text) => {
              if (text) {
                insertTextIntoComposer(textarea, text);
              } else {
                textarea.focus();
              }
            });
          },
        },
      ],
      { x: event.clientX, y: event.clientY },
    );

    if (!opened) {
      textarea.focus();
    }
  }

  async function captureAssistantScreenshot(rect: CaptureScreenshotRequest) {
    if (!isTauriRuntime()) {
      showStatusBarNotice(t("workspace.screenshotsRequireRuntime"), { tone: "warning" });
      return;
    }

    try {
      await waitForScreenshotSurface();
      const screenshot = await invokeCommand("capture_screenshot_for_assistant", {
        request: rect,
      });
      setAssistantContextSnippet({
        id: `assistant-screenshot-${Date.now()}`,
        kind: "screenshot",
        sourceLabel: t("workspace.screenshot"),
        imageDataUrl: screenshot.dataUrl,
        width: screenshot.width,
        height: screenshot.height,
        capturedAt: new Date().toISOString(),
      });
      showStatusBarNotice(t("workspace.sentToAi"), { tone: "success" });
    } catch (error) {
      showStatusBarNotice(
        t("workspace.screenshotCaptureError", {
          message: error instanceof Error ? error.message : String(error),
        }),
        { tone: "error" },
      );
    } finally {
      composerTextareaRef.current?.focus();
    }
  }

  function handleScreenshotRegionPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (
      !screenshotRegionState ||
      !pointInBounds(event.clientX, event.clientY, screenshotRegionState.bounds)
    ) {
      return;
    }
    const point = clampPointToBounds(
      event.clientX,
      event.clientY,
      screenshotRegionState.bounds,
    );
    event.currentTarget.setPointerCapture(event.pointerId);
    setScreenshotRegionState({
      ...screenshotRegionState,
      pointerId: event.pointerId,
      start: point,
      current: point,
    });
  }

  function handleScreenshotRegionPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (
      !screenshotRegionState?.start ||
      screenshotRegionState.pointerId !== event.pointerId
    ) {
      return;
    }
    setScreenshotRegionState({
      ...screenshotRegionState,
      current: clampPointToBounds(
        event.clientX,
        event.clientY,
        screenshotRegionState.bounds,
      ),
    });
  }

  function handleScreenshotRegionPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (
      !screenshotRegionState?.start ||
      screenshotRegionState.pointerId !== event.pointerId
    ) {
      return;
    }
    const current = clampPointToBounds(
      event.clientX,
      event.clientY,
      screenshotRegionState.bounds,
    );
    const rect = rectFromPoints(screenshotRegionState.start, current);
    setScreenshotRegionState(null);
    if (rect.width < 4 || rect.height < 4) {
      return;
    }
    void captureAssistantScreenshot(rect);
  }

  function handleScreenshotRegionKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      setScreenshotRegionState(null);
      composerTextareaRef.current?.focus();
    }
  }

  const screenshotSelectionRect =
    screenshotRegionState?.start && screenshotRegionState.current
      ? rectFromPoints(screenshotRegionState.start, screenshotRegionState.current)
      : null;

  useLayoutEffect(() => {
    const labelWidth = maxMeasuredTextWidth(permissionWidthMeasureRef.current);
    const wrapper = permissionMenuRef.current;
    if (wrapper && labelWidth > 0) {
      wrapper.style.setProperty("--assistant-permission-control-width", `${Math.ceil(labelWidth + 59)}px`);
      wrapper.style.setProperty("--assistant-permission-menu-width", `${Math.ceil(labelWidth + 72)}px`);
    }

    const modelWidth = maxMeasuredTextWidth(modelWidthMeasureRef.current);
    const select = modelSelectRef.current;
    if (select && modelWidth > 0) {
      select.style.setProperty("--assistant-model-select-width", `${Math.ceil(modelWidth + 38)}px`);
    }
  }, [modelSelectLabels, toolPermissionLabels]);

  useLayoutEffect(() => {
    const node = regionTargetRef.current;
    if (!node || !screenshotRegionState) {
      return;
    }

    node.style.height = `${screenshotRegionState.bounds.height}px`;
    node.style.left = `${screenshotRegionState.bounds.left}px`;
    node.style.top = `${screenshotRegionState.bounds.top}px`;
    node.style.width = `${screenshotRegionState.bounds.width}px`;
  }, [
    screenshotRegionState?.bounds.height,
    screenshotRegionState?.bounds.left,
    screenshotRegionState?.bounds.top,
    screenshotRegionState?.bounds.width,
  ]);

  useLayoutEffect(() => {
    const node = regionSelectionRef.current;
    if (!node || !screenshotSelectionRect) {
      return;
    }

    node.style.height = `${screenshotSelectionRect.height}px`;
    node.style.left = `${screenshotSelectionRect.x}px`;
    node.style.top = `${screenshotSelectionRect.y}px`;
    node.style.width = `${screenshotSelectionRect.width}px`;
  }, [
    screenshotSelectionRect?.height,
    screenshotSelectionRect?.width,
    screenshotSelectionRect?.x,
    screenshotSelectionRect?.y,
  ]);

  useEffect(() => {
    if (!screenshotRegionState) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      regionTargetRef.current?.parentElement?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [screenshotRegionState]);

  return (
    <aside className="assistant-panel">
      <div className="assistant-topbar">
        <h2>{t("ai.title")}</h2>
        <button
          aria-label={t("ai.refresh")}
          className="assistant-toolbar-button"
          title={t("ai.refresh")}
          type="button"
        >
          <RefreshCw size={16} />
        </button>
        <button
          aria-label={t("ai.settings")}
          className="assistant-toolbar-button"
          onClick={onOpenSettings}
          title={t("ai.settings")}
          type="button"
        >
          <Settings size={16} />
        </button>
        <button
          aria-label={t("ai.newAiChat")}
          className="assistant-toolbar-button"
          disabled={isSendingPrompt}
          onClick={handleNewChat}
          title={t("ai.newChat")}
          type="button"
        >
          <Plus size={16} />
        </button>
        <button
          aria-label={t("ai.collapsePanel")}
          className="assistant-toolbar-button"
          onClick={onToggleCollapsed}
          title={t("ai.collapsePanel")}
          type="button"
        >
          <PanelRight size={17} />
        </button>
      </div>

      <div className="assistant-context active-session-hint">
        {!pageContext && activeTab?.connection ? (
          <ConnectionIcon
            localShell={activeTab.connection.localShell}
            size={32}
            type={activeTab.connection.type}
          />
        ) : (
          <Bot size={16} />
        )}
        <span>
          <strong>{contextLabel}</strong>
          <small>{connectionLabel}</small>
        </span>
      </div>

      {assistantIntent === "extensionCreation" ? (
        <div className="assistant-context assistant-extension-context">
          <Plus size={16} />
          <span>
            <strong>{t("ai.extensionDraft")}</strong>
            <small>{t("ai.extensionReviewOnly")}</small>
          </span>
        </div>
      ) : null}

      {pageContext?.contextKind === "dashboard" && !dashboardToolsEnabled ? (
        <div className="assistant-context assistant-dashboard-tools-context">
          <Bot size={16} />
          <span>
            <strong>{t("ai.dashboardToolsDisabledTitle")}</strong>
            <small>{t("ai.dashboardToolsDisabledHint")}</small>
          </span>
        </div>
      ) : null}

      {shouldShowChatHistory ? (
        <section className={`assistant-tasks${showAllChats ? " assistant-chat-history-panel" : ""}`}>
          <header>
            <span>{showAllChats ? t("ai.allChats") : t("ai.chats")}</span>
            {showAllChats ? (
              <button
                className="assistant-toolbar-button"
                onClick={() => setShowAllChats(false)}
                type="button"
                aria-label={t("ai.closeChatHistory")}
                title={t("ai.close")}
              >
                <X size={15} />
              </button>
            ) : (
              <button
                className="assistant-view-all-button"
                disabled={sortedChatHistory.length === 0}
                onClick={() => setShowAllChats(true)}
                type="button"
              >
                {t("ai.viewAll")}({sortedChatHistory.length})
              </button>
            )}
          </header>
          {showAllChats ? (
            <div className="assistant-chat-history-list">
              {sortedChatHistory.map((thread) => (
                <div className="assistant-chat-history-row-wrap" key={thread.id}>
                  <button
                    className="assistant-chat-history-row"
                    onClick={() => resumeChat(thread)}
                    type="button"
                  >
                    <strong>{thread.title}</strong>
                    <span>{assistantThreadPreview(thread)}</span>
                    <small>{formatAssistantMessageTime(thread.updatedAt)}</small>
                  </button>
                  <button
                    aria-label={t("ai.deleteChat", { title: thread.title })}
                    className="assistant-chat-history-delete"
                    onClick={() => deleteChat(thread.id)}
                    title={t("ai.deleteChat", { title: thread.title })}
                    type="button"
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}
            </div>
          ) : recentChatHistory.length > 0 ? (
            recentChatHistory.map((thread) => (
              <button
                className="assistant-task-row"
                key={thread.id}
                onClick={() => resumeChat(thread)}
                type="button"
              >
                <span>{thread.title}</span>
                <small>{formatAssistantMessageTime(thread.updatedAt)}</small>
              </button>
            ))
          ) : (
            <p>{t("ai.noChatsYet")}</p>
          )}
        </section>
      ) : null}

      <div
        className={`assistant-chat-log${showAllChats && shouldShowChatHistory ? " assistant-chat-log-condensed" : ""}`}
        ref={chatLogRef}
      >
        {messages.map((message, index) => (
          <div className="assistant-chat-timeline-item" key={message.id}>
            {index === streamingMessageIndex ? (
              <AssistantToolApprovalCards
                approvals={pendingToolApprovals}
                onAllow={(request) =>
                  void completeAssistantToolApproval(request.requestId, true)
                }
                onAllowSession={(request) =>
                  void completeAssistantToolApproval(request.requestId, true, {
                    allowSession: true,
                    toolName: request.toolName,
                  })
                }
                onDeny={denyAssistantToolApproval}
              />
            ) : null}
            <AssistantMessageView
              message={message}
              onCopyCode={handleCopyCode}
              onCopyMessage={handleCopyMessage}
              onOpenLink={handleOpenAssistantLink}
              onSendCode={handleSendCodeToTerminal}
              onSecretStored={(request) =>
                appendLocalAssistantMessage(
                  t("ai.secretCardStoredMessage", { label: request.label }),
                  message.intent,
                )
              }
            />
          </div>
        ))}
        {streamingMessageIndex < 0 ? (
          <AssistantToolApprovalCards
            approvals={pendingToolApprovals}
            onAllow={(request) =>
              void completeAssistantToolApproval(request.requestId, true)
            }
            onAllowSession={(request) =>
              void completeAssistantToolApproval(request.requestId, true, {
                allowSession: true,
                toolName: request.toolName,
              })
            }
            onDeny={denyAssistantToolApproval}
          />
        ) : null}
        {shouldShowPreStreamWaiting ? (
          <article className="assistant-message assistant-waiting" aria-live="polite">
            <span className="assistant-spinner" aria-hidden="true" />
            <span>{t("ai.preparingResponse")}</span>
          </article>
        ) : null}
      </div>

      {chatError ? <p className="form-error">{chatError}</p> : null}

      <form className="assistant-chat-composer" onSubmit={handleChatSubmit}>
        {assistantContextSnippet ? (
          <section className="assistant-selection-context">
            <header>
              <span>{assistantContextSnippet.sourceLabel}</span>
              <button
                className="row-action"
                aria-label={t("ai.clearContext")}
                onClick={clearAssistantContextSnippet}
                title={t("ai.clearContext")}
                type="button"
              >
                <X size={13} />
              </button>
            </header>
            {assistantContextSnippet.kind === "screenshot" ? (
              <div className="assistant-screenshot-context">
                <img alt={assistantContextSnippet.sourceLabel} src={assistantContextSnippet.imageDataUrl} />
                <small>
                  {assistantContextSnippet.width} x {assistantContextSnippet.height}
                </small>
              </div>
            ) : (
              <pre>
                <code>{assistantContextSnippet.text}</code>
              </pre>
            )}
          </section>
        ) : null}
        {pastedImageContexts.length > 0 ? (
          <section className="assistant-selection-context">
            <header>
              <span>{t("ai.pastedImages", { count: pastedImageContexts.length })}</span>
              <button
                className="row-action"
                aria-label={t("ai.clearContext")}
                onClick={() => {
                  setPastedImageContexts([]);
                  setImagePasteRejected(false);
                }}
                title={t("ai.clearContext")}
                type="button"
              >
                <X size={13} />
              </button>
            </header>
            <div className="assistant-attachment-preview-grid">
              {pastedImageContexts.map((image) => (
                <figure className="assistant-attachment-preview" key={image.id}>
                  <img alt={image.sourceLabel} src={image.imageDataUrl} />
                  <figcaption>
                    <span>{image.sourceLabel}</span>
                    <small>
                      {image.width} x {image.height}
                    </small>
                  </figcaption>
                  <button
                    aria-label={t("ai.removeImageAttachment", { label: image.sourceLabel })}
                    className="assistant-attachment-remove"
                    onClick={() =>
                      setPastedImageContexts((current) =>
                        current.filter((attachment) => attachment.id !== image.id),
                      )
                    }
                    title={t("ai.removeImageAttachment", { label: image.sourceLabel })}
                    type="button"
                  >
                    <X size={12} />
                  </button>
                </figure>
              ))}
            </div>
          </section>
        ) : null}
        {fileContexts.length > 0 ? (
          <section className="assistant-selection-context">
            <header>
              <span>{t("ai.attachedFiles", { count: fileContexts.length })}</span>
              <button
                className="row-action"
                aria-label={t("ai.clearContext")}
                onClick={() => setFileContexts([])}
                title={t("ai.clearContext")}
                type="button"
              >
                <X size={13} />
              </button>
            </header>
            <div className="assistant-file-attachment-list">
              {fileContexts.map((file) => (
                <div className="assistant-file-attachment" key={file.id}>
                  <FileImage size={14} />
                  <span>{file.sourceLabel}</span>
                  <small>{formatBytes(file.size)}</small>
                  <button
                    aria-label={t("ai.removeFileAttachment", { label: file.sourceLabel })}
                    className="assistant-attachment-remove"
                    onClick={() =>
                      setFileContexts((current) =>
                        current.filter((attachment) => attachment.id !== file.id),
                      )
                    }
                    title={t("ai.removeFileAttachment", { label: file.sourceLabel })}
                    type="button"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          </section>
        ) : null}
        {showImageNotSupportedNotice ? (
          <p className="assistant-image-support-notice" role="status">
            {t("ai.imageInputNotSupported")}
          </p>
        ) : null}
        {activeComposerIntent ? (
          <section
            aria-label={t("ai.selectedIntent")}
            className="assistant-intent-composer"
            data-intent={activeComposerIntent}
          >
            <div className="assistant-intent-chip" data-intent={activeComposerIntent}>
              {activeComposerIntent === "watchdog" ? <Eye size={14} /> : <Plus size={14} />}
              <span>{activeComposerIntentLabel}</span>
              <button
                aria-label={t("ai.clearIntent", { intent: activeComposerIntentLabel })}
                onClick={handleClearAssistantIntent}
                type="button"
              >
                <X size={12} />
              </button>
            </div>
            {displayedIntentExamples.length > 0 ? (
              <div className="assistant-intent-examples">
                {displayedIntentExamples.map((example, i) => (
                  <button
                    className="assistant-intent-example-bubble"
                    key={i}
                    onClick={() => handleUseIntentExample(example)}
                    type="button"
                  >
                    {example}
                  </button>
                ))}
              </div>
            ) : null}
          </section>
        ) : null}
        <textarea
          ref={composerTextareaRef}
          onKeyDown={handleComposerKeyDown}
          onPaste={(event) => void handleComposerPaste(event)}
          onContextMenu={(event) => void handleComposerContextMenu(event)}
          onChange={(event) => setPrompt(event.currentTarget.value)}
          disabled={isSendingPrompt}
          placeholder={assistantIntentPlaceholder(assistantIntent, t)}
          rows={3}
          value={prompt}
        />
        <div className="assistant-composer-footer">
          <div className="assistant-add-menu-wrapper" ref={addContextMenuRef}>
            <input
              aria-label={t("ai.addFiles")}
              ref={fileInputRef}
              accept="image/*,.pdf,.txt,.log,.md,.json,.jsonl,.csv,.tsv,.yaml,.yml,.xml,.toml,.ini,.conf"
              className="sr-only"
              multiple
              onChange={(event) => void handleFileInputChange(event)}
              tabIndex={-1}
              type="file"
            />
            <button
              {...menuButtonAria(addContextMenuOpen)}
              className="assistant-plus-button"
              disabled={isSendingPrompt}
              onClick={() => setAddContextMenuOpen((open) => !open)}
              onMouseEnter={() => {
                if (
                  activeTab?.kind === "remoteDesktop" &&
                  activeTab.connection?.type === "rdp"
                ) {
                  requestRdpPreCapture();
                }
              }}
              type="button"
              aria-label={t("ai.addContext")}
              title={t("ai.addContext")}
            >
              <Plus size={18} />
            </button>
            {addContextMenuOpen ? (
              <div className="assistant-add-menu" role="menu" aria-label={t("ai.addContext")}>
                <button
                  className="assistant-add-menu-item"
                  onClick={handleAddFiles}
                  role="menuitem"
                  type="button"
                >
                  <FileImage size={15} />
                  {t("ai.addFiles")}
                </button>
                <button
                  className="assistant-add-menu-item"
                  onClick={handleAddScreenshot}
                  role="menuitem"
                  type="button"
                >
                  <Camera size={15} />
                  {t("ai.addScreenshot")}
                </button>
                <button
                  {...ariaChecked(assistantIntent === "createWidget")}
                  className="assistant-add-menu-item"
                  onClick={() => handleSelectAssistantIntent("createWidget")}
                  role="menuitemradio"
                  type="button"
                >
                  <Plus size={15} />
                  {t("ai.createWidget")}
                </button>
                <button
                  {...ariaChecked(assistantIntent === "watchdog")}
                  className="assistant-add-menu-item"
                  onClick={() => handleSelectAssistantIntent("watchdog")}
                  role="menuitemradio"
                  type="button"
                >
                  <Eye size={15} />
                  {t("ai.watchdog")}
                </button>
                {canAttachTerminalBuffer ? (
                  <button
                    className="assistant-add-menu-item"
                    onClick={() => void handleAddTerminalBuffer()}
                    role="menuitem"
                    type="button"
                  >
                    <ScrollText size={15} />
                    {t("ai.addTerminalBuffer")}
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
          <div className="assistant-permission-menu-wrapper" ref={permissionMenuRef}>
            <button
              {...menuButtonAria(permissionMenuOpen)}
              aria-label={t("ai.toolPermissionMode")}
              className="assistant-permission-button"
              data-mode={currentToolPermissionMode}
              disabled={isSendingPrompt}
              onClick={() => setPermissionMenuOpen((open) => !open)}
              title={t("ai.toolPermissionMode")}
              type="button"
            >
              {currentToolPermissionMode === "allowAll" ? (
                <ShieldAlert size={15} />
              ) : (
                <Hand size={15} />
              )}
              <span>
                {currentToolPermissionMode === "allowAll"
                  ? toolPermissionLabels[1]
                  : toolPermissionLabels[0]}
              </span>
              <ChevronDown size={14} />
            </button>
            {permissionMenuOpen ? (
              <div className="assistant-permission-menu" role="menu" aria-label={t("ai.toolPermissionMode")}>
                <button
                  {...ariaChecked(currentToolPermissionMode === "prompt")}
                  className="assistant-permission-menu-item"
                  onClick={() => void handleToolPermissionModeChange("prompt")}
                  role="menuitemradio"
                  type="button"
                >
                  <Hand size={16} />
                  <span>{toolPermissionLabels[0]}</span>
                  {currentToolPermissionMode === "prompt" ? <Check size={16} /> : null}
                </button>
                <button
                  {...ariaChecked(currentToolPermissionMode === "allowAll")}
                  className="assistant-permission-menu-item"
                  data-mode="allowAll"
                  onClick={() => void handleToolPermissionModeChange("allowAll")}
                  role="menuitemradio"
                  type="button"
                >
                  <ShieldAlert size={16} />
                  <span>{toolPermissionLabels[1]}</span>
                  {currentToolPermissionMode === "allowAll" ? <Check size={16} /> : null}
                </button>
              </div>
            ) : null}
          </div>
          <select
            aria-label={t("settings.model")}
            className="assistant-model-select"
            disabled={isSendingPrompt}
            onChange={(event) => void handleModelChange(event.currentTarget.value)}
            ref={modelSelectRef}
            title={t("settings.model")}
            value={currentModel}
          >
            {hasCustomModel ? <option value={currentModel}>{currentModel}</option> : null}
            {assistantModelOptions.map((model) => (
              <option key={model.id} value={model.id}>
                {model.label}
              </option>
            ))}
          </select>
          <div
            aria-hidden="true"
            className="assistant-control-measurer assistant-permission-measurer"
            ref={permissionWidthMeasureRef}
          >
            {toolPermissionLabels.map((label, index) => (
              <span key={`${label}-${index}`}>{label}</span>
            ))}
          </div>
          <div
            aria-hidden="true"
            className="assistant-control-measurer assistant-model-measurer"
            ref={modelWidthMeasureRef}
          >
            {modelSelectLabels.map((label, index) => (
              <span key={`${label}-${index}`}>{label}</span>
            ))}
          </div>
          <button
            aria-label={isSendingPrompt ? t("ai.stopMessage") : t("ai.sendMessage")}
            className="assistant-send-button"
            data-state={isSendingPrompt ? "stopping" : "sending"}
            disabled={!isSendingPrompt && !prompt.trim()}
            onClick={isSendingPrompt ? handleStopAssistantPrompt : undefined}
            title={isSendingPrompt ? t("ai.stopMessage") : t("ai.sendMessage")}
            type={isSendingPrompt ? "button" : "submit"}
          >
            {isSendingPrompt ? <Square fill="currentColor" size={13} /> : <SendHorizontal size={18} />}
          </button>
        </div>
      </form>
      {screenshotRegionState ? (
        <div
          aria-label={t("workspace.selectRegion")}
          className="screenshot-region-overlay"
          onKeyDown={handleScreenshotRegionKeyDown}
          onPointerDown={handleScreenshotRegionPointerDown}
          onPointerMove={handleScreenshotRegionPointerMove}
          onPointerUp={handleScreenshotRegionPointerUp}
          role="application"
          tabIndex={-1}
        >
          <div className="screenshot-region-target" ref={regionTargetRef} />
          {screenshotSelectionRect ? (
            <div className="screenshot-region-selection" ref={regionSelectionRef} />
          ) : null}
        </div>
      ) : null}
    </aside>
  );
}

function AssistantToolApprovalCards({
  approvals,
  onAllow,
  onAllowSession,
  onDeny,
}: {
  approvals: PendingToolApproval[];
  onAllow: (request: PendingToolApproval) => void;
  onAllowSession: (request: PendingToolApproval) => void;
  onDeny: (request: PendingToolApproval) => void;
}) {
  return (
    <>
      {approvals.map((request) => (
        <AssistantToolApprovalCard
          key={request.requestId}
          request={request}
          onAllow={() => onAllow(request)}
          onAllowSession={() => onAllowSession(request)}
          onDeny={() => onDeny(request)}
        />
      ))}
    </>
  );
}

function AssistantToolApprovalCard({
  onAllow,
  onAllowSession,
  onDeny,
  request,
}: {
  onAllow: () => void;
  onAllowSession: () => void;
  onDeny: () => void;
  request: PendingToolApproval;
}) {
  const { t } = useTranslation();
  const [selectedAction, setSelectedAction] = useState<ToolApprovalAction>("");
  const isPending = request.status === "pending";
  const argsPreview = formatToolApprovalArgs(request.args);
  const toolLabel = humanizeAssistantToolName(request.toolName);
  // Watchdog approvals piggyback on this same modal but render a config
  // summary instead of the raw args blob — the user is being asked to
  // approve a behavioral plan, not a single tool call.
  const watchdogConfig = extractWatchdogApprovalConfig(request);

  function handleApprovalActionChange(event: ChangeEvent<HTMLSelectElement>) {
    const action = event.currentTarget.value as ToolApprovalAction;
    setSelectedAction(action);
    if (action === "allow") {
      onAllow();
      return;
    }
    if (action === "allowSession") {
      onAllowSession();
      return;
    }
    if (action === "deny") {
      onDeny();
    }
  }

  if (!isPending) {
    return (
      <article className="assistant-message assistant">
        <div className="assistant-message-content">
          <section className="assistant-tool-approval-card assistant-tool-approval-summary" aria-live="polite">
            <span aria-hidden="true">
              {request.status === "denied" ? <X size={14} /> : <Check size={14} />}
            </span>
            <strong>{toolApprovalStatusLabel(request.status, t)}</strong>
            <small>{t("ai.toolApprovalTool", { tool: toolLabel })}</small>
          </section>
        </div>
      </article>
    );
  }

  return (
    <article className="assistant-message assistant">
      <div className="assistant-message-content">
        <section className="assistant-tool-approval-card" aria-live="polite">
          <header>
            <ShieldAlert size={15} />
            <div>
              <strong>{t("ai.toolApprovalTitle")}</strong>
              <small>
                {t("ai.toolApprovalTool", {
                  tool: toolLabel,
                })}
              </small>
            </div>
          </header>
          {watchdogConfig ? (
            <WatchdogApprovalBody config={watchdogConfig} />
          ) : (
            <>
              <p>{t("ai.toolApprovalBody")}</p>
              {argsPreview ? (
                <details>
                  <summary>{t("ai.toolApprovalDetails")}</summary>
                  <pre>
                    <code>{argsPreview}</code>
                  </pre>
                </details>
              ) : null}
            </>
          )}
          <footer>
            <span>{t("ai.toolApprovalWaiting")}</span>
            <label className="assistant-tool-approval-action">
              <select
                aria-label={t("ai.toolApprovalSelectAction")}
                disabled={!isPending}
                onChange={handleApprovalActionChange}
                value={selectedAction}
              >
                <option value="">{t("ai.toolApprovalSelectAction")}</option>
                <option value="allow">{t("ai.toolApprovalAllow")}</option>
                <option value="allowSession">{t("ai.toolApprovalAllowSession")}</option>
                <option value="deny">{t("ai.toolApprovalDeny")}</option>
              </select>
            </label>
          </footer>
        </section>
      </div>
    </article>
  );
}

function toolApprovalStatusLabel(
  status: PendingToolApproval["status"],
  t: ReturnType<typeof useTranslation>["t"],
) {
  if (status === "allowedSession") {
    return t("ai.toolApprovalAllowedSession");
  }
  if (status === "approved") {
    return t("ai.toolApprovalApproved");
  }
  return t("ai.toolApprovalDenied");
}

function formatToolApprovalArgs(args: Record<string, unknown> | undefined) {
  if (!args || Object.keys(args).length === 0) {
    return "";
  }
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return "";
  }
}

/// Detect a watchdog-creation approval and surface its config. Returns null
/// for any other tool so the generic approval body renders normally.
function extractWatchdogApprovalConfig(
  request: PendingToolApproval,
): WatchdogApprovalConfig | null {
  if (request.toolName !== "watchdog_create") {
    return null;
  }
  const config = request.args?.config as unknown;
  if (!config || typeof config !== "object") {
    return null;
  }
  const c = config as Record<string, unknown>;
  const action = c.action as Record<string, unknown> | undefined;
  if (action?.kind !== "aiIntervene") {
    // Only aiIntervene actions hit the approval bridge in the first place,
    // but defensively bail if a notify slipped through.
    return null;
  }
  return {
    name: typeof c.name === "string" ? c.name : "",
    target: c.target as Record<string, unknown> | undefined,
    trigger: c.trigger as Record<string, unknown> | undefined,
    pollMs: typeof c.pollMs === "number" ? c.pollMs : 0,
    stop: c.stop as Record<string, unknown> | undefined,
    goal: typeof action.goal === "string" ? action.goal : "",
    allowedTools: Array.isArray(action.allowedTools)
      ? (action.allowedTools as unknown[]).filter((v): v is string => typeof v === "string")
      : [],
    maxInterventions:
      typeof action.maxInterventions === "number" ? action.maxInterventions : 0,
    suppressionMs:
      typeof action.suppressionMs === "number" ? action.suppressionMs : 0,
  };
}

interface WatchdogApprovalConfig {
  name: string;
  target: Record<string, unknown> | undefined;
  trigger: Record<string, unknown> | undefined;
  pollMs: number;
  stop: Record<string, unknown> | undefined;
  goal: string;
  allowedTools: string[];
  maxInterventions: number;
  suppressionMs: number;
}

function WatchdogApprovalBody({ config }: { config: WatchdogApprovalConfig }) {
  const { t } = useTranslation();
  const targetSummary = summarizeWatchdogTarget(config.target);
  const triggerSummary = summarizeWatchdogTrigger(config.trigger);
  const stopSummary = summarizeWatchdogStop(config.stop);
  return (
    <div className="watchdog-approval-body">
      <p className="watchdog-approval-lede">
        {t("ai.watchdogApproval.lede", { name: config.name || "(unnamed)" })}
      </p>
      <dl className="watchdog-approval-fields">
        <Field label={t("ai.watchdogApproval.target")} value={targetSummary} />
        <Field label={t("ai.watchdogApproval.trigger")} value={triggerSummary} />
        <Field
          label={t("ai.watchdogApproval.poll")}
          value={`${(config.pollMs / 1000).toFixed(1)}s`}
        />
        <Field label={t("ai.watchdogApproval.stop")} value={stopSummary} />
      </dl>
      <div className="watchdog-approval-goal">
        <strong>{t("ai.watchdogApproval.goal")}</strong>
        <p>{config.goal}</p>
      </div>
      <div className="watchdog-approval-tools">
        <strong>
          {t("ai.watchdogApproval.allowedTools", {
            count: config.allowedTools.length,
          })}
        </strong>
        <ul>
          {config.allowedTools.map((tool) => (
            <li key={tool}>
              <code>{tool}</code>
            </li>
          ))}
        </ul>
        <small>{t("ai.watchdogApproval.allowedToolsCaveat")}</small>
      </div>
      <p className="watchdog-approval-caps">
        {t("ai.watchdogApproval.caps", {
          max: config.maxInterventions,
          suppression: Math.round(config.suppressionMs / 1000),
        })}
      </p>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}

function summarizeWatchdogTarget(target: Record<string, unknown> | undefined): string {
  if (!target) return "—";
  const kind = target.kind;
  if (kind === "performanceCounter") {
    return `performance counter · ${String(target.metric ?? "")}`;
  }
  if (kind === "sshSessionOutputSilence") {
    return `ssh session silence · ${String(target.sessionId ?? "")}`;
  }
  if (kind === "ping") {
    return `ping · ${String(target.host ?? "")}`;
  }
  if (kind === "tcpReachable") {
    return `tcp · ${String(target.host ?? "")}:${String(target.port ?? "")}`;
  }
  if (kind === "mock") {
    return "mock (testing)";
  }
  return String(kind ?? "—");
}

function summarizeWatchdogTrigger(trigger: Record<string, unknown> | undefined): string {
  if (!trigger) return "—";
  const pred = trigger.predicate as Record<string, unknown> | undefined;
  if (!pred) return "—";
  const op = String(pred.op ?? "?");
  const value = pred.value ?? pred.ms ?? "?";
  const sustained = trigger.sustainedForMs;
  const base = `${op} ${String(value)}`;
  if (typeof sustained === "number" && sustained > 0) {
    return `${base} for ${Math.round(sustained / 1000)}s`;
  }
  return base;
}

function summarizeWatchdogStop(stop: Record<string, unknown> | undefined): string {
  if (!stop) return "—";
  const kind = stop.kind;
  if (kind === "untilCanceled") return "until canceled";
  if (kind === "afterFirstTrigger") return "after first trigger";
  if (kind === "afterTriggerCount") return `after ${String(stop.n ?? "?")} triggers`;
  if (kind === "afterPollCount") return `after ${String(stop.n ?? "?")} polls`;
  if (kind === "afterDuration") {
    const ms = typeof stop.ms === "number" ? stop.ms : 0;
    return `after ${Math.round(ms / 1000)}s`;
  }
  return String(kind ?? "—");
}

function AssistantMessageView({
  message,
  onCopyCode,
  onCopyMessage,
  onOpenLink,
  onSecretStored,
  onSendCode,
}: {
  message: AssistantChatMessage;
  onCopyCode: (code: string) => void;
  onCopyMessage: (message: AssistantChatMessage) => void;
  onOpenLink: (url: string) => void;
  onSecretStored: (request: AssistantSecretRequest) => void;
  onSendCode: (code: string) => void;
}) {
  const { t } = useTranslation();
  const userMessageLineCount = message.role === "user" ? message.content.split(/\r?\n/).length : 0;
  const shouldTruncateUserMessage = message.role === "user" && userMessageLineCount > 10;
  const canSendCode = message.intent !== "extensionCreation";
  const [isUserMessageExpanded, setIsUserMessageExpanded] = useState(false);
  const [previewImage, setPreviewImage] = useState<AssistantImageAttachment | null>(null);
  const secretRequestContent = useMemo(
    () => parseAssistantSecretRequests(message.content),
    [message.content],
  );

  useEffect(() => {
    if (!previewImage) {
      return;
    }

    function handlePreviewKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        setPreviewImage(null);
      }
    }

    window.addEventListener("keydown", handlePreviewKeyDown);
    return () => window.removeEventListener("keydown", handlePreviewKeyDown);
  }, [previewImage]);

  return (
    <article className={`assistant-message ${message.role}`}>
      <div className="assistant-message-content">
        <div
          className={`assistant-message-bubble${shouldTruncateUserMessage && !isUserMessageExpanded ? " assistant-message-bubble-truncated" : ""}`}
        >
          {message.role === "user" && message.intent && message.intent !== "chat" ? (
            <span className="assistant-message-intent-label" data-intent={message.intent}>
              {assistantIntentLabel(message.intent, t)}
            </span>
          ) : null}
          {message.textAttachments?.length ? (
            <div className="assistant-message-text-attachments">
              {message.textAttachments.map((attachment) => (
                <figure className="assistant-message-text-attachment" key={attachment.id}>
                  <figcaption>{attachment.sourceLabel}</figcaption>
                  <pre>
                    <code>{attachment.text}</code>
                  </pre>
                </figure>
              ))}
            </div>
          ) : null}
          {message.imageAttachments?.length ? (
            <div className="assistant-message-attachments">
              {message.imageAttachments.map((image) => (
                <figure className="assistant-message-attachment" key={image.id}>
                  <button
                    {...dialogButtonAria(previewImage?.id === image.id)}
                    aria-label={t("ai.openImagePreview", { label: image.sourceLabel })}
                    className="assistant-message-attachment-button"
                    onClick={() => setPreviewImage(image)}
                    title={t("ai.openImagePreview", { label: image.sourceLabel })}
                    type="button"
                  >
                    <img alt={image.sourceLabel} src={image.imageDataUrl} />
                  </button>
                  <figcaption>
                    {image.sourceLabel} · {image.width} x {image.height}
                  </figcaption>
                </figure>
              ))}
            </div>
          ) : null}
          {message.fileAttachments?.length ? (
            <div className="assistant-message-file-attachments">
              {message.fileAttachments.map((file) => (
                <div className="assistant-message-file-attachment" key={file.id}>
                  <FileImage size={13} />
                  <span>{file.sourceLabel}</span>
                  <small>{formatBytes(file.size)}</small>
                </div>
              ))}
            </div>
          ) : null}
          {message.role === "assistant" ? <AssistantWorkPanel message={message} /> : null}
          <MarkdownContent
            canSendCode={canSendCode}
            content={secretRequestContent.markdown}
            onCopyCode={onCopyCode}
            onOpenLink={onOpenLink}
            onSendCode={onSendCode}
          />
          {message.role === "assistant" && secretRequestContent.requests.length > 0 ? (
            <div className="assistant-secret-card-stack">
              {secretRequestContent.requests.map((request) => (
                <AssistantSecretEntryCard
                  key={secretRequestStorageNotice(request)}
                  request={request}
                  onStored={onSecretStored}
                />
              ))}
            </div>
          ) : null}
        </div>
        <div className="assistant-message-actions">
          <time dateTime={message.createdAt}>{formatAssistantMessageTime(message.createdAt)}</time>
          <button
            aria-label={t("ai.copyMessage")}
            onClick={() => onCopyMessage(message)}
            title={t("ai.copyMessage")}
            type="button"
          >
            <Copy size={10} />
          </button>
        </div>
      </div>
      {shouldTruncateUserMessage ? (
        <button
          className="assistant-message-expand"
          onClick={() => setIsUserMessageExpanded((expanded) => !expanded)}
          type="button"
        >
          {isUserMessageExpanded ? t("ai.showLess") : t("ai.more")}
        </button>
      ) : null}
      {previewImage ? (
        <div
          className="assistant-image-preview-backdrop"
          onClick={() => setPreviewImage(null)}
          role="presentation"
        >
          <div
            aria-label={t("ai.imagePreviewTitle", { label: previewImage.sourceLabel })}
            className="assistant-image-preview-dialog"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <header>
              <div>
                <strong>{previewImage.sourceLabel}</strong>
                <small>
                  {previewImage.width} x {previewImage.height}
                </small>
              </div>
              <button
                aria-label={t("ai.close")}
                className="assistant-toolbar-button"
                onClick={() => setPreviewImage(null)}
                title={t("ai.close")}
                type="button"
              >
                <X size={15} />
              </button>
            </header>
            <img alt={previewImage.sourceLabel} src={previewImage.imageDataUrl} />
          </div>
        </div>
      ) : null}
    </article>
  );
}

function AssistantSecretEntryCard({
  onStored,
  request,
}: {
  onStored: (request: AssistantSecretRequest) => void;
  request: AssistantSecretRequest;
}) {
  const { t } = useTranslation();
  const setAiProviderHasApiKey = useWorkspaceStore((state) => state.setAiProviderHasApiKey);
  const showStatusBarNotice = useWorkspaceStore((state) => state.showStatusBarNotice);
  const [secret, setSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [saving, setSaving] = useState(false);
  const [stored, setStored] = useState(false);
  const [error, setError] = useState("");
  const canSave = secret.trim().length > 0 && !saving && !stored;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canSave) {
      return;
    }

    setSaving(true);
    setError("");
    try {
      await storeAssistantSecretRequest(request, secret.trim());
      setSecret("");
      setStored(true);
      if (request.kind === "aiApiKey") {
        setAiProviderHasApiKey(true);
      }
      if (request.kind === "widgetSecret") {
        await useDashboardStore.getState().load();
      }
      showStatusBarNotice(t("ai.secretCardStoredStatus", { label: request.label }), {
        tone: "success",
      });
      onStored(request);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="assistant-secret-card" onSubmit={(event) => void handleSubmit(event)}>
      <header>
        <KeyRound size={15} />
        <div>
          <strong>{request.label}</strong>
          <small>{request.description ?? t("ai.secretCardDefaultDescription")}</small>
        </div>
      </header>
      <p>{t("ai.secretCardPrivacy")}</p>
      <label>
        <span>{t("ai.secretCardInputLabel")}</span>
        <div className="assistant-secret-input-row">
          <input
            autoComplete="off"
            disabled={saving || stored}
            onChange={(event) => setSecret(event.currentTarget.value)}
            placeholder={request.placeholder ?? t("ai.secretCardPlaceholder")}
            type={showSecret ? "text" : "password"}
            value={secret}
          />
          <button
            aria-label={showSecret ? t("ai.secretCardHide") : t("ai.secretCardShow")}
            className="assistant-secret-icon-button"
            disabled={saving || stored}
            onClick={() => setShowSecret((show) => !show)}
            title={showSecret ? t("ai.secretCardHide") : t("ai.secretCardShow")}
            type="button"
          >
            {showSecret ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
      </label>
      <footer>
        <span aria-live="polite">
          {stored ? t("ai.secretCardStoredInline") : error}
        </span>
        <button className="toolbar-button" disabled={!canSave} type="submit">
          {saving ? <LoaderCircle size={14} /> : <KeyRound size={14} />}
          {stored ? t("ai.secretCardSaved") : t("ai.secretCardSave")}
        </button>
      </footer>
    </form>
  );
}

async function storeAssistantSecretRequest(
  request: AssistantSecretRequest,
  secret: string,
) {
  if (!isTauriRuntime()) {
    throw new Error(i18next.t("ai.secretCardRuntimeRequired"));
  }

  if (request.kind === "widgetSecret") {
    await storeWidgetSecretRequest(request, secret);
    return;
  }

  await invokeCommand("store_secret", {
    request: {
      kind: request.kind,
      ownerId: request.ownerId,
      secret,
    },
  });
}

async function storeWidgetSecretRequest(
  request: AssistantSecretRequest,
  secret: string,
) {
  if (!request.instanceId || !request.fieldKey) {
    throw new Error(i18next.t("ai.secretCardInvalidWidgetRequest"));
  }

  const state = await invokeCommand("dashboard_load_state", undefined);
  const instance = state.instances.find((item) => item.id === request.instanceId);
  if (!instance) {
    throw new Error(i18next.t("ai.secretCardMissingWidget"));
  }

  const currentValues = parseObjectJson(instance.settingsValuesJson);
  const nextValues = {
    ...currentValues,
    [request.fieldKey]: {
      type: "secretRef",
      ownerId: request.ownerId,
      hasSecret: true,
      updatedAt: new Date().toISOString(),
    },
  };

  await invokeCommand("store_secret", {
    request: {
      kind: request.kind,
      ownerId: request.ownerId,
      secret,
    },
  });

  try {
    await invokeCommand("dashboard_update_instance", {
      id: request.instanceId,
      patch: { settingsValuesJson: JSON.stringify(nextValues) },
    });
  } catch (error) {
    await invokeCommand("delete_secret", {
      request: {
        kind: request.kind,
        ownerId: request.ownerId,
      },
    }).catch(() => undefined);
    throw error;
  }
}

function parseObjectJson(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 KB";
  }
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function appViewportBounds() {
  return new DOMRect(0, 0, window.innerWidth, window.innerHeight);
}

function rectFromPoints(
  start: { x: number; y: number },
  current: { x: number; y: number },
): CaptureScreenshotRequest {
  const x = Math.min(start.x, current.x);
  const y = Math.min(start.y, current.y);
  return {
    x: Math.max(0, Math.round(x)),
    y: Math.max(0, Math.round(y)),
    width: Math.max(1, Math.round(Math.abs(current.x - start.x))),
    height: Math.max(1, Math.round(Math.abs(current.y - start.y))),
  };
}

function pointInBounds(x: number, y: number, bounds: DOMRect) {
  return x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom;
}

function clampPointToBounds(x: number, y: number, bounds: DOMRect) {
  return {
    x: Math.min(Math.max(x, bounds.left), bounds.right),
    y: Math.min(Math.max(y, bounds.top), bounds.bottom),
  };
}

async function waitForScreenshotSurface() {
  await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
  await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
  await new Promise<void>((resolve) => window.setTimeout(resolve, 90));
}

function toolCallLabel(
  toolName: string | undefined,
  status: AssistantToolCallStatus["status"],
  t: ReturnType<typeof useTranslation>["t"],
): string {
  const normalizedToolName = normalizeAssistantToolName(toolName);
  if (!normalizedToolName) {
    return status === "running" ? t("ai.toolCallRunning") : t("ai.toolCallComplete");
  }
  const runningLabels: Record<string, string> = {
    web_search: t("ai.toolWebSearch"),
    web_fetch: t("ai.toolWebFetch"),
    shell_command: t("ai.toolShellCommand"),
    app_data_file_search: t("ai.toolFileSearch"),
    app_data_file_read: t("ai.toolFileRead"),
    performance_counters: t("ai.toolPerformanceCounters"),
    send_email: t("ai.toolEmail"),
    current_time: t("ai.toolCurrentTime"),
    request_secret_entry: t("ai.toolSecretRequest"),
    dashboard_load_state: t("ai.toolDashboard"),
    dashboard_create_view: t("ai.toolDashboard"),
    dashboard_update_view: t("ai.toolDashboard"),
    dashboard_remove_view: t("ai.toolDashboard"),
    dashboard_reorder_views: t("ai.toolDashboard"),
    dashboard_add_instance: t("ai.toolDashboard"),
    dashboard_update_instance: t("ai.toolDashboard"),
    dashboard_read_widget_secret: t("ai.toolDashboard"),
    dashboard_remove_instance: t("ai.toolDashboard"),
    dashboard_apply_layout: t("ai.toolDashboard"),
    dashboard_create_widget: t("ai.toolDashboard"),
    dashboard_create_custom_widget: t("ai.toolDashboard"),
    dashboard_update_custom_widget: t("ai.toolDashboard"),
    dashboard_remove_custom_widget: t("ai.toolDashboard"),
    dashboard_reset: t("ai.toolDashboard"),
    connection_list: t("ai.toolConnections"),
    connection_create: t("ai.toolConnections"),
    connection_open: t("ai.toolConnections"),
    connection_update: t("ai.toolConnections"),
    connection_delete: t("ai.toolConnections"),
    session_state: t("ai.toolSessions"),
    session_terminal_read_buffer: t("ai.toolSessions"),
    session_terminal_send_text: t("ai.toolSessions"),
    session_remote_desktop_screenshot: t("ai.toolSessions"),
    session_remote_desktop_send_text: t("ai.toolSessions"),
    session_remote_desktop_keypress: t("ai.toolSessions"),
    session_remote_desktop_mouse_click: t("ai.toolSessions"),
    session_file_browser_list: t("ai.toolSessions"),
    session_file_browser_create_folder: t("ai.toolSessions"),
    session_file_browser_rename: t("ai.toolSessions"),
    session_file_browser_delete: t("ai.toolSessions"),
    tutorial_highlight: t("ai.toolTutorial"),
  };
  const completedLabels: Record<string, string> = {
    web_search: t("ai.toolWebSearchDone"),
    web_fetch: t("ai.toolWebFetchDone"),
    shell_command: t("ai.toolShellCommandDone"),
    app_data_file_search: t("ai.toolFileSearchDone"),
    app_data_file_read: t("ai.toolFileReadDone"),
    performance_counters: t("ai.toolPerformanceCountersDone"),
    send_email: t("ai.toolEmailDone"),
    current_time: t("ai.toolCurrentTimeDone"),
    request_secret_entry: t("ai.toolSecretRequestDone"),
    dashboard_load_state: t("ai.toolDashboardDone"),
    dashboard_create_view: t("ai.toolDashboardDone"),
    dashboard_update_view: t("ai.toolDashboardDone"),
    dashboard_remove_view: t("ai.toolDashboardDone"),
    dashboard_reorder_views: t("ai.toolDashboardDone"),
    dashboard_add_instance: t("ai.toolDashboardDone"),
    dashboard_update_instance: t("ai.toolDashboardDone"),
    dashboard_read_widget_secret: t("ai.toolDashboardDone"),
    dashboard_remove_instance: t("ai.toolDashboardDone"),
    dashboard_apply_layout: t("ai.toolDashboardDone"),
    dashboard_create_widget: t("ai.toolDashboardDone"),
    dashboard_create_custom_widget: t("ai.toolDashboardDone"),
    dashboard_update_custom_widget: t("ai.toolDashboardDone"),
    dashboard_remove_custom_widget: t("ai.toolDashboardDone"),
    dashboard_reset: t("ai.toolDashboardDone"),
    connection_list: t("ai.toolConnectionsDone"),
    connection_create: t("ai.toolConnectionsDone"),
    connection_open: t("ai.toolConnectionsDone"),
    connection_update: t("ai.toolConnectionsDone"),
    connection_delete: t("ai.toolConnectionsDone"),
    session_state: t("ai.toolSessionsDone"),
    session_terminal_read_buffer: t("ai.toolSessionsDone"),
    session_terminal_send_text: t("ai.toolSessionsDone"),
    session_remote_desktop_screenshot: t("ai.toolSessionsDone"),
    session_remote_desktop_send_text: t("ai.toolSessionsDone"),
    session_remote_desktop_keypress: t("ai.toolSessionsDone"),
    session_remote_desktop_mouse_click: t("ai.toolSessionsDone"),
    session_file_browser_list: t("ai.toolSessionsDone"),
    session_file_browser_create_folder: t("ai.toolSessionsDone"),
    session_file_browser_rename: t("ai.toolSessionsDone"),
    session_file_browser_delete: t("ai.toolSessionsDone"),
    tutorial_highlight: t("ai.toolTutorialDone"),
  };
  const labels = status === "running" ? runningLabels : completedLabels;
  return labels[normalizedToolName] ?? normalizedToolName;
}

function isDashboardMutatingTool(toolName: unknown) {
  const normalizedToolName = normalizeAssistantToolName(toolName);
  if (!normalizedToolName) {
    return false;
  }
  return normalizedToolName.startsWith("dashboard_") && normalizedToolName !== "dashboard_load_state";
}

function AssistantWorkPanel({ message }: { message: AssistantChatMessage }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [waitingPhrase, setWaitingPhrase] = useState(randomAssistantWaitingPhrase);
  const [waitingDots, setWaitingDots] = useState(0);
  const wasStreamingRef = useRef(Boolean(message.isStreaming));
  const reasoningContent = message.reasoningContent?.trim() ?? "";
  const toolCalls = message.toolCalls ?? [];
  const skillNames = message.skillNames ?? [];
  const hasWork =
    Boolean(reasoningContent) ||
    toolCalls.length > 0 ||
    skillNames.length > 0 ||
    Boolean(message.isStreaming);
  const shouldShowThinkingStep = assistantWorkPanelShouldShowThinkingStep(message);

  useEffect(() => {
    setExpanded(false);
    wasStreamingRef.current = Boolean(message.isStreaming);
  }, [message.id]);

  useEffect(() => {
    if (wasStreamingRef.current && !message.isStreaming) {
      setExpanded(false);
    }
    wasStreamingRef.current = Boolean(message.isStreaming);
  }, [message.isStreaming]);

  useEffect(() => {
    if (!message.isStreaming) {
      setWaitingDots(0);
      return;
    }

    const interval = window.setInterval(() => {
      setWaitingDots((current) => (current + 1) % 4);
    }, 300);

    return () => {
      window.clearInterval(interval);
    };
  }, [message.isStreaming]);

  useEffect(() => {
    if (!message.isStreaming) {
      return;
    }

    setWaitingPhrase(randomAssistantWaitingPhrase());
    const interval = window.setInterval(() => {
      setWaitingPhrase(randomAssistantWaitingPhrase());
    }, 3000);

    return () => {
      window.clearInterval(interval);
    };
  }, [message.isStreaming]);

  if (!hasWork) {
    return null;
  }

  const duration =
    message.workStartedAt && message.workCompletedAt
      ? formatAssistantWorkDuration(message.workStartedAt, message.workCompletedAt, t)
      : "";
  const latestToolCall = latestRunningAssistantToolCall(message);
  const label =
    latestToolCall
      ? t("ai.toolCallUsing", {
          tool: humanizeAssistantToolName(latestToolCall.toolName),
        })
      : skillNames.length > 0
        ? t("ai.skillInvoked", { skills: skillNames.map(humanizeAssistantToolName).join(", ") })
      : message.isStreaming
        ? waitingPhrase || t("ai.chargingBeacon")
        : t("ai.workedFor", { duration: duration || t("ai.workDurationUnderSecond") });
  const thinkingStatus = message.isStreaming ? "running" : "completed";

  return (
    <section className="assistant-work-panel">
      <button
        {...ariaExpanded(expanded)}
        className="assistant-work-toggle"
        onClick={() => setExpanded((e) => !e)}
        type="button"
      >
        <span
          className={
            latestToolCall
              ? "assistant-work-tool-label"
              : skillNames.length > 0
                ? "assistant-work-skill-label"
                : undefined
          }
        >
          {label}
          {message.isStreaming ? (
            <span className="assistant-waiting-dots" aria-hidden="true">
              {".".repeat(waitingDots)}
            </span>
          ) : null}
        </span>
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>
      {expanded ? (
        <div className="assistant-work-timeline">
          {shouldShowThinkingStep ? (
            <div className="assistant-work-step" data-state={thinkingStatus}>
              <span className="assistant-work-step-icon" aria-hidden="true">
                {message.isStreaming ? <LoaderCircle size={13} /> : null}
              </span>
              <div>
                <strong>{t("ai.thinkingStep")}</strong>
                {reasoningContent ? (
                  <div className="assistant-work-reasoning">
                    <MarkdownContent
                      canSendCode={false}
                      content={reasoningContent}
                      onCopyCode={(code) => {
                        void writeToClipboard(code);
                      }}
                      onOpenLink={(url) => {
                        void openExternalUrl(url);
                      }}
                      onSendCode={() => undefined}
                    />
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
          {skillNames.map((skillName) => (
            <div className="assistant-work-step" data-state="skill" key={skillName}>
              <span className="assistant-work-step-icon" aria-hidden="true" />
              <div>
                <strong>{t("ai.skillInvoked", { skills: humanizeAssistantToolName(skillName) })}</strong>
              </div>
            </div>
          ))}
          {toolCalls.map((toolCall) => (
            <div className="assistant-work-step" data-state={toolCall.status} key={toolCall.toolId}>
              <span className="assistant-work-step-icon" aria-hidden="true">
                {toolCall.status === "running" ? <LoaderCircle size={13} /> : null}
              </span>
              <div>
                <strong>{toolCallLabel(toolCall.toolName, toolCall.status, t)}</strong>
                <small>
                  {toolCall.status === "running" ? t("ai.toolCallRunning") : t("ai.toolCallComplete")}
                </small>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function humanizeAssistantToolName(toolName: string | undefined) {
  return normalizeAssistantToolName(toolName)?.replace(/[_-]+/g, " ") ?? "";
}

function normalizeAssistantToolName(toolName: unknown) {
  return typeof toolName === "string" && toolName.trim() ? toolName.trim() : undefined;
}

function formatAssistantWorkDuration(
  startedAt: string,
  completedAt: string,
  t: ReturnType<typeof useTranslation>["t"],
) {
  const started = new Date(startedAt).getTime();
  const completed = new Date(completedAt).getTime();
  if (Number.isNaN(started) || Number.isNaN(completed) || completed <= started) {
    return t("ai.workDurationUnderSecond");
  }
  const totalSeconds = Math.max(1, Math.round((completed - started) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) {
    return t("ai.workDurationSeconds", { count: seconds });
  }
  return t("ai.workDurationMinutesSeconds", { minutes, seconds });
}

function externalAssistantLinkUrl(href: string | null) {
  if (!href) {
    return undefined;
  }
  try {
    const url = new URL(href);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function MarkdownContent({
  canSendCode,
  content,
  onCopyCode,
  onOpenLink,
  onSendCode,
}: {
  canSendCode: boolean;
  content: string;
  onCopyCode: (code: string) => void;
  onOpenLink: (url: string) => void;
  onSendCode: (code: string) => void;
}) {
  const { t } = useTranslation();
  const tokens = useMemo(() => {
    const lexed = marked.lexer(content);
    return lexed.filter((tok) => tok.type !== "space");
  }, [content]);

  function handleMarkdownClick(event: MouseEvent<HTMLDivElement>) {
    const link = (event.target as Element | null)?.closest("a");
    if (!link) {
      return;
    }
    const href = link.getAttribute("href");
    const externalUrl = externalAssistantLinkUrl(href);
    event.preventDefault();
    event.stopPropagation();
    if (externalUrl) {
      onOpenLink(externalUrl);
    }
  }

  return (
    <div className="markdown-content" onClick={handleMarkdownClick}>
      {tokens.map((token, index) => {
        if (token.type === "code") {
          const codeToken = token as Tokens.Code;
          const lang = codeToken.lang || "";
          const code = codeToken.text;
          return (
            <div className="markdown-code-block" key={`code-${index}`}>
              <div className="markdown-code-toolbar">
                <span>{lang || t("ai.code")}</span>
                <div className="markdown-code-actions">
                  <button
                    className="assistant-code-send"
                    onClick={() => onCopyCode(code)}
                    type="button"
                  >
                    <Copy size={13} />
                    {t("ai.copy")}
                  </button>
                  <button
                    className="assistant-code-send"
                    disabled={!canSendCode}
                    onClick={() => onSendCode(code)}
                    title={
                      canSendCode
                        ? t("ai.sendToTerminal")
                        : t("ai.extensionReviewTooltip")
                    }
                    type="button"
                  >
                    <Terminal size={13} />
                    {t("ai.send")}
                  </button>
                </div>
              </div>
              <pre>
                <code>{code}</code>
              </pre>
            </div>
          );
        }
        const html = marked.parse(token.raw, { async: false }) as string;
        return (
          <div
            key={`md-${index}`}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        );
      })}
    </div>
  );
}
