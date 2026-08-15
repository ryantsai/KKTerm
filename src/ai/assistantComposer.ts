// Composer-side helpers for the Assistant Panel: intent resolution and
// labels, chat-message and run-manifest construction, attachment capture
// (image compression, file reading), and stream-event debug logging.
// Extracted verbatim from AssistantPanel.tsx; behavior must not change.
import type { useTranslation } from "react-i18next";
import i18next from "../i18n/config";
import { isMacPlatform } from "../lib/platform";
import type { AiStreamEvent } from "../lib/tauri";
import { aiProviderSecretOwnerId } from "../lib/settings";
import { resolveCreateWidgetFollowupPrompt } from "./widgetFollowupPrompt";
import type { AssistantToolCallStatus } from "./streamMessage";
import type {
  AssistantChatMessage,
  AssistantFileAttachment,
  AssistantImageAttachment,
  AssistantPromptIntent,
  AssistantRunManifest,
  AssistantRunManifestStep,
  AssistantTextAttachment,
} from "./assistantTypes";

export const ASSISTANT_IMAGE_MAX_EDGE = 1280;
export const ASSISTANT_IMAGE_JPEG_QUALITY = 0.72;
export const ASSISTANT_FILE_MAX_BYTES = 10 * 1024 * 1024;
export const ASSISTANT_COMPOSER_MAC_IME_ENTER_GRACE_MS = 100;

type AssistantComposerKeyboardEvent = Pick<
  KeyboardEvent,
  "isComposing" | "key" | "keyCode"
>;

/**
 * Keep IME candidate confirmation inside the composer. macOS WebKit can emit
 * compositionend before the Enter keydown that committed the candidate, so a
 * short post-composition grace period covers that reversed event order.
 */
export function shouldSuppressAssistantComposerEnter(
  event: AssistantComposerKeyboardEvent,
  compositionActive = false,
  compositionEndedAt = 0,
  now = Date.now(),
  isMac = isMacPlatform(),
) {
  if (event.key !== "Enter") {
    return false;
  }

  const timeSinceCompositionEnd = now - compositionEndedAt;
  const followsMacCompositionEnd =
    isMac &&
    compositionEndedAt > 0 &&
    timeSinceCompositionEnd >= 0 &&
    timeSinceCompositionEnd < ASSISTANT_COMPOSER_MAC_IME_ENTER_GRACE_MS;

  return compositionActive || event.isComposing || event.keyCode === 229 || followsMacCompositionEnd;
}

export function resolveAssistantOutputLanguage(outputLanguage: string): string | undefined {
  if (!outputLanguage) {
    const uiCode = i18next.language || "en";
    const name = i18next.t(`languages.${uiCode}`);
    return name && name !== `languages.${uiCode}` ? name : undefined;
  }
  return outputLanguage;
}

export function assistantQuickCommandId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? `quick-${crypto.randomUUID()}`
    : `quick-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createAssistantChatMessage(
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

export function createAssistantRunManifest(
  goal: string,
  intent: AssistantPromptIntent,
  toolCalls?: AssistantToolCallStatus[],
): AssistantRunManifest {
  const scopeByIntent: Record<AssistantPromptIntent, string> = {
    chat: "assistant.chat",
    extensionCreation: "assistant.extensionCreation",
    createWidget: "assistant.dashboardWidget",
    watchdog: "assistant.watchdog",
  };
  const hasToolErrors = (toolCalls ?? []).some(
    (toolCall) => toolCall.status === "completed" && Boolean(toolCall.error?.trim()),
  );
  const hasRunningTools = (toolCalls ?? []).some((toolCall) => toolCall.status === "running");
  const verificationStatus = hasToolErrors ? "failed" : hasRunningTools ? "pending" : "passed";
  const steps: AssistantRunManifestStep[] = [
    {
      id: "plan",
      label: "Plan response",
      status: "completed",
    },
    {
      id: "verify",
      label: "Verify tool outcomes",
      status: hasToolErrors ? "blocked" : hasRunningTools ? "running" : "completed",
      detail: hasToolErrors ? "One or more tool calls reported an error." : undefined,
    },
  ];
  return {
    runId: `assistant-run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    goal: goal.trim(),
    scope: scopeByIntent[intent],
    definitionOfDone: "Provide response with completed verification step or explicit blocker.",
    verificationStatus,
    steps,
    updatedAt: new Date().toISOString(),
  };
}

export function assistantAgentIntent(
  intent: AssistantPromptIntent,
): "chat" | "extensionCreation" {
  return intent === "extensionCreation" ? "extensionCreation" : "chat";
}

export function assistantPromptForIntent(
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

export function assistantIntentLabel(
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

export function sampleRandom<T>(arr: T[], n: number): T[] {
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

export function assistantIntentExamples(
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

export function assistantIntentPlaceholder(
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

export function assistantIntentForPrompt(
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

export function formatAssistantMessageTime(value: string) {
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

export function readImageFileAsDataUrl(file: File): Promise<string> {
  return readFileAsDataUrl(file);
}

export function readFileAsDataUrl(file: File): Promise<string> {
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

export async function compressImageDataUrl(dataUrl: string) {
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

export async function createImageAttachment(
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

export function logAssistantStreamEvent(event: AiStreamEvent) {
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

export function createAiProviderSecretRequestMarkdown(
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
