import i18next from "../i18n/config";
import { AI_PROVIDER_DEFINITIONS } from "./providerRegistry";
import type { AiAssistantToolSettings, AiOpenAiApiMode, AiProviderKind, AiProviderSettings, AiReasoningEffort, EmailProvider, SearchProvider, SmtpSecurity } from "../types";
export { AI_PROVIDER_DEFINITIONS, modelSupportsImageInput } from "./providerRegistry";
export type {
  AiModelOption,
  AiProviderCapability,
  AiProviderDefinition,
  AiProviderModelListStrategy,
  AiProviderSettingsField,
} from "./providerRegistry";

export function getAiProviderDefinition(kind: AiProviderKind) {
  return (
    AI_PROVIDER_DEFINITIONS.find((definition) => definition.kind === kind) ??
    AI_PROVIDER_DEFINITIONS[0]
  );
}

export const DEFAULT_AI_ASSISTANT_TOOLS: AiAssistantToolSettings = {
  webSearch: true,
  webFetch: true,
  shellCommand: true,
  appDataFileSearch: true,
  appDataFileRead: true,
  currentTime: true,
  performanceCounters: true,
  email: false,
  dashboard: true,
  itops: true,
  installer: true,
  screenshots: true,
  connections: true,
  sessions: true,
  tutorial: true,
  manual: true,
  network: true,
  watchdog: true,
  memory: true,
};

export const CUSTOM_AI_INSTRUCTIONS_MAX_LENGTH = 1000;

export function providerDefaultsFor(kind: AiProviderKind): AiProviderSettings {
  const definition = getAiProviderDefinition(kind);
  return {
    providerKind: definition.kind,
    baseUrl: definition.baseUrl,
    model: definition.defaultModel,
    reasoningEffort: definition.defaultReasoningEffort,
    outputLanguage: "",
    customInstructions: "",
    apiMode: "chatCompletions",
    extraHeaders: "",
    allowInsecureTls: false,
    allowInsecureMcpHttp: false,
    showAllModels: false,
    cliExecutionPolicy: "suggestOnly",
    toolPermissionMode: "prompt",
    builtInMcpServerEnabled: true,
    builtInMcpAllowAllDangerous: false,
    useCodexCli: false,
    useClaudeCli: false,
    useCursorCli: definition.kind === "cursor",
    claudeCliPath: "",
    codexCliPath: "",
    cursorCliPath: "",
    disabledSkillNames: [],
    customSkillsEnabled: true,
    tools: DEFAULT_AI_ASSISTANT_TOOLS,
    searchProvider: "scraper",
    searxngUrl: "",
    emailProvider: "resend",
    emailFrom: "",
    mailgunDomain: "",
    smtpHost: "",
    smtpPort: 587,
    smtpUsername: "",
    smtpSecurity: "starttls",
  };
}

export function normalizeAiProviderDraft(draft: AiProviderSettings): AiProviderSettings {
  const definition = getAiProviderDefinition(draft.providerKind);
  const baseUrl = (definition.allowsCustomBaseUrl ? draft.baseUrl : definition.baseUrl).trim();
  const model = draft.model.trim() || definition.defaultModel;
  const reasoningEffort = normalizeReasoningEffort(
    draft.reasoningEffort,
    definition.reasoningEfforts,
    definition.defaultReasoningEffort,
  );

  if (!baseUrl) {
    throw new Error(i18next.t("ai.providerEndpointRequired"));
  }
  if (!model) {
    throw new Error(i18next.t("ai.modelRequired"));
  }
  const customInstructions = (draft.customInstructions ?? "").trim();
  if (customInstructions.length > CUSTOM_AI_INSTRUCTIONS_MAX_LENGTH) {
    throw new Error(
      i18next.t("settings.aiCustomInstructionsTooLong", {
        count: CUSTOM_AI_INSTRUCTIONS_MAX_LENGTH,
      }),
    );
  }

  return {
    ...draft,
    providerKind: definition.kind,
    baseUrl: baseUrl.replace(/\/+$/, ""),
    model,
    reasoningEffort,
    customInstructions,
    apiMode: normalizeApiMode(definition.kind, draft.apiMode),
    extraHeaders: definition.settingsFields.includes("extraHeaders")
      ? (draft.extraHeaders ?? "").trim()
      : "",
    allowInsecureTls: Boolean(draft.allowInsecureTls),
    allowInsecureMcpHttp: Boolean(draft.allowInsecureMcpHttp),
    showAllModels: Boolean(draft.showAllModels),
    cliExecutionPolicy: "suggestOnly",
    toolPermissionMode: draft.toolPermissionMode === "allowAll" ? "allowAll" : "prompt",
    builtInMcpServerEnabled: Boolean(draft.builtInMcpServerEnabled ?? true),
    builtInMcpAllowAllDangerous: Boolean(draft.builtInMcpAllowAllDangerous),
    useCodexCli: definition.kind === "openai" ? Boolean(draft.useCodexCli) : false,
    useClaudeCli: definition.kind === "anthropic" ? Boolean(draft.useClaudeCli) : false,
    useCursorCli: definition.kind === "cursor" ? Boolean(draft.useCursorCli) : false,
    claudeCliPath: draft.claudeCliPath?.trim() ?? "",
    codexCliPath: draft.codexCliPath?.trim() ?? "",
    cursorCliPath: draft.cursorCliPath?.trim() ?? "",
    disabledSkillNames: normalizeDisabledSkillNames(draft.disabledSkillNames),
    customSkillsEnabled: Boolean(draft.customSkillsEnabled ?? true),
    tools: { ...DEFAULT_AI_ASSISTANT_TOOLS, ...(draft.tools ?? {}) },
    searchProvider: normalizeSearchProvider(draft.searchProvider),
    searxngUrl: draft.searxngUrl?.trim() ?? "",
    emailProvider: normalizeEmailProvider(draft.emailProvider),
    emailFrom: draft.emailFrom?.trim() ?? "",
    mailgunDomain: draft.mailgunDomain?.trim() ?? "",
    smtpHost: draft.smtpHost?.trim() ?? "",
    smtpPort: normalizeSmtpPort(draft.smtpPort),
    smtpUsername: draft.smtpUsername?.trim() ?? "",
    smtpSecurity: normalizeSmtpSecurity(draft.smtpSecurity),
  };
}

function normalizeDisabledSkillNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter((item) => /^[a-z0-9-]{1,64}$/.test(item)),
    ),
  ).sort();
}

function normalizeSearchProvider(value: string | undefined): SearchProvider {
  switch (value) {
    case "brave":
      return "brave";
    case "tavily":
      return "tavily";
    case "searxng":
      return "searxng";
    default:
      return "scraper";
  }
}

function normalizeEmailProvider(value: string | undefined): EmailProvider {
  switch (value) {
    case "sendgrid":
      return "sendgrid";
    case "mailgun":
      return "mailgun";
    case "postmark":
      return "postmark";
    case "smtp":
      return "smtp";
    default:
      return "resend";
  }
}

function normalizeSmtpSecurity(value: string | undefined): SmtpSecurity {
  return value === "none" ? "none" : "starttls";
}

function normalizeApiMode(
  providerKind: AiProviderKind,
  value: AiOpenAiApiMode | undefined,
): AiOpenAiApiMode {
  if (providerKind !== "openai-compatible") {
    return "chatCompletions";
  }
  return value === "responses" ? "responses" : "chatCompletions";
}

function normalizeSmtpPort(value: number | undefined): number {
  const port = Number(value);
  if (!Number.isFinite(port)) return 587;
  return Math.max(1, Math.min(65535, Math.round(port)));
}

export function providerNeedsApiKey(settings: AiProviderSettings) {
  if (
    (settings.providerKind === "openai" && settings.useCodexCli) ||
    (settings.providerKind === "anthropic" && settings.useClaudeCli) ||
    (settings.providerKind === "cursor" && settings.useCursorCli)
  ) {
    return false;
  }
  return getAiProviderDefinition(settings.providerKind).requiresApiKey;
}

export function validateAiProviderForChat(
  settings: AiProviderSettings,
  hasApiKey: boolean,
): AiProviderSettings {
  const normalized = normalizeAiProviderDraft(settings);
  const definition = getAiProviderDefinition(normalized.providerKind);
  if (
    (normalized.providerKind === "openai" && normalized.useCodexCli) ||
    (normalized.providerKind === "anthropic" && normalized.useClaudeCli) ||
    (normalized.providerKind === "cursor" && normalized.useCursorCli)
  ) {
    return normalized;
  }
  if (normalized.providerKind === "cursor" && !normalized.useCursorCli) {
    throw new Error(i18next.t("ai.cursorCliRequired"));
  }
  if (definition.kind === "github-copilot" && !hasApiKey) {
    throw new Error(i18next.t("ai.copilotConnectRequired"));
  }
  if (definition.requiresApiKey && !hasApiKey) {
    throw new Error(i18next.t("ai.apiKeyRequired", { provider: definition.label }));
  }
  return normalized;
}

function normalizeReasoningEffort(
  value: AiReasoningEffort | undefined,
  supported: AiReasoningEffort[],
  fallback: AiReasoningEffort,
) {
  const normalized = value ?? fallback;
  return supported.includes(normalized) ? normalized : fallback;
}
