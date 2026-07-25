import { HIGH_REASONING_EFFORTS, HOSTED_PROVIDER_SETTINGS_FIELDS } from "./shared";
import type { AiProviderDefinition } from "./types";

export const zaiProvider: AiProviderDefinition = {
  kind: "zai",
  label: "Z.ai",
  baseUrl: "https://api.z.ai/api/paas/v4",
  defaultModel: "glm-5.2",
  defaultReasoningEffort: "high",
  reasoningEfforts: [...HIGH_REASONING_EFFORTS],
  requiresApiKey: true,
  allowsCustomBaseUrl: false,
  allowsCustomModel: true,
  apiKeyLabel: "Z.ai API key",
  apiKeyUrl: "https://z.ai/manage-apikey/apikey-list",
  modelListStrategy: "openAiCompatible",
  modelOptions: [
    { id: "glm-5.2", label: "GLM-5.2", supportsImageInput: false },
    { id: "glm-5.1", label: "GLM-5.1", supportsImageInput: false },
    { id: "glm-5v-turbo", label: "GLM-5V-Turbo", supportsImageInput: true },
    { id: "glm-5-turbo", label: "GLM-5-Turbo", supportsImageInput: false },
    { id: "glm-4.7-flash", label: "GLM-4.7 Flash", supportsImageInput: false },
  ],
  settingsFields: HOSTED_PROVIDER_SETTINGS_FIELDS,
  capabilities: ["chat", "imageInput", "streaming", "toolCalling", "mcpReady", "openAiCompatible"],
};
