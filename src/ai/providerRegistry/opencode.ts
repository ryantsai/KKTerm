import { HOSTED_PROVIDER_SETTINGS_FIELDS, STANDARD_REASONING_EFFORTS } from "./shared";
import type { AiProviderDefinition } from "./types";

export const opencodeProvider: AiProviderDefinition = {
  kind: "opencode",
  label: "OpenCode",
  baseUrl: "https://opencode.ai/zen/go/v1",
  defaultModel: "kimi-k3",
  defaultReasoningEffort: "medium",
  reasoningEfforts: [...STANDARD_REASONING_EFFORTS],
  requiresApiKey: true,
  allowsCustomBaseUrl: false,
  allowsCustomModel: true,
  apiKeyLabel: "OpenCode API key",
  apiKeyUrl: "https://opencode.ai/console",
  modelListStrategy: "openAiCompatible",
  modelOptions: [
    { id: "kimi-k3", label: "Kimi K3", supportsImageInput: false },
    { id: "kimi-k2.6", label: "Kimi K2.6", supportsImageInput: false },
    { id: "kimi-k2.5", label: "Kimi K2.5", supportsImageInput: false },
    { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro", supportsImageInput: false },
    { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash", supportsImageInput: false },
    { id: "glm-5.2", label: "GLM-5.2", supportsImageInput: false },
    { id: "glm-5.1", label: "GLM-5.1", supportsImageInput: false },
    { id: "glm-5", label: "GLM-5", supportsImageInput: false },
    { id: "qwen3.6-plus", label: "Qwen3.6 Plus", supportsImageInput: false },
    { id: "qwen3.5-plus", label: "Qwen3.5 Plus", supportsImageInput: false },
    { id: "mimo-v2.5-pro", label: "MiMo-V2.5-Pro", supportsImageInput: false },
    { id: "mimo-v2.5", label: "MiMo-V2.5", supportsImageInput: false },
  ],
  settingsFields: HOSTED_PROVIDER_SETTINGS_FIELDS,
  capabilities: ["chat", "imageInput", "streaming", "toolCalling", "mcpReady", "openAiCompatible"],
};
