import { HOSTED_PROVIDER_SETTINGS_FIELDS, STANDARD_REASONING_EFFORTS } from "./shared";
import type { AiProviderDefinition } from "./types";

export const moonshotProvider: AiProviderDefinition = {
  kind: "moonshot",
  label: "Moonshot AI",
  baseUrl: "https://api.moonshot.ai/v1",
  defaultModel: "kimi-k3",
  defaultReasoningEffort: "medium",
  reasoningEfforts: [...STANDARD_REASONING_EFFORTS],
  requiresApiKey: true,
  allowsCustomBaseUrl: false,
  allowsCustomModel: true,
  apiKeyLabel: "Moonshot AI API key",
  apiKeyUrl: "https://platform.kimi.ai/console/api-keys",
  modelListStrategy: "openAiCompatible",
  modelOptions: [
    { id: "kimi-k3", label: "Kimi K3", supportsImageInput: true },
    { id: "kimi-k2.7-code", label: "Kimi K2.7 Code", supportsImageInput: true },
    { id: "kimi-k2.7-code-highspeed", label: "Kimi K2.7 Code High-Speed", supportsImageInput: true },
    { id: "kimi-k2.6", label: "Kimi K2.6", supportsImageInput: true },
  ],
  settingsFields: HOSTED_PROVIDER_SETTINGS_FIELDS,
  capabilities: ["chat", "imageInput", "streaming", "toolCalling", "mcpReady", "openAiCompatible"],
};
