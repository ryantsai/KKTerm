import { HIGH_REASONING_EFFORTS, HOSTED_PROVIDER_SETTINGS_FIELDS } from "./shared";
import type { AiProviderDefinition } from "./types";

export const deepSeekProvider: AiProviderDefinition = {
  kind: "deepseek",
  label: "DeepSeek",
  baseUrl: "https://api.deepseek.com/v1",
  defaultModel: "deepseek-v4-flash",
  defaultReasoningEffort: "high",
  reasoningEfforts: [...HIGH_REASONING_EFFORTS],
  requiresApiKey: true,
  allowsCustomBaseUrl: false,
  allowsCustomModel: true,
  apiKeyLabel: "DeepSeek API key",
  apiKeyUrl: "https://platform.deepseek.com/api_keys",
  modelListStrategy: "openAiCompatible",
  modelOptions: [
    { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash", note: "Fast current model", supportsImageInput: false },
    { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro", note: "Most capable", supportsImageInput: false },
    { id: "deepseek-chat", label: "DeepSeek Chat", note: "Legacy V4 Flash alias", supportsImageInput: false },
    { id: "deepseek-reasoner", label: "DeepSeek Reasoner", note: "Legacy reasoning alias", supportsImageInput: false },
  ],
  settingsFields: HOSTED_PROVIDER_SETTINGS_FIELDS,
  capabilities: ["chat", "imageInput", "streaming", "toolCalling", "openAiCompatible"],
};
