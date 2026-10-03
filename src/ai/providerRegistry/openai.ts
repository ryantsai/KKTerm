import { HOSTED_PROVIDER_SETTINGS_FIELDS, STANDARD_REASONING_EFFORTS } from "./shared";
import type { AiProviderDefinition } from "./types";

export const openAiProvider: AiProviderDefinition = {
  kind: "openai",
  label: "OpenAI",
  baseUrl: "https://api.openai.com/v1",
  defaultModel: "gpt-5.6-luna",
  defaultReasoningEffort: "medium",
  reasoningEfforts: [...STANDARD_REASONING_EFFORTS],
  requiresApiKey: true,
  allowsCustomBaseUrl: false,
  allowsCustomModel: true,
  apiKeyLabel: "OpenAI API key",
  apiKeyUrl: "https://platform.openai.com/api-keys",
  modelListStrategy: "openAiCompatible",
  modelOptions: [
    { id: "gpt-5.6-luna", label: "GPT-5.6 Luna", note: "Fastest and lowest cost", supportsImageInput: true },
    { id: "gpt-5.6-terra", label: "GPT-5.6 Terra", note: "Balanced everyday work", supportsImageInput: true },
    { id: "gpt-5.6-sol", label: "GPT-5.6 Sol", note: "Flagship and most capable", supportsImageInput: true },
    { id: "gpt-5.4", label: "GPT-5.4", note: "Coding and professional work", supportsImageInput: true },
    { id: "gpt-5.4-mini", label: "GPT-5.4 Mini", note: "Fast, lower cost", supportsImageInput: true },
    { id: "gpt-6-luna", label: "GPT-6 Luna", supportsImageInput: true },
    { id: "gpt-5.2", label: "GPT-5.2", note: "Previous frontier", supportsImageInput: true },
    { id: "gpt-6-sol", label: "GPT-6 Sol", supportsImageInput: true },
    { id: "gpt-5.2-codex", label: "GPT-5.2 Codex", supportsImageInput: true },
  ],
  settingsFields: HOSTED_PROVIDER_SETTINGS_FIELDS,
  capabilities: ["chat", "imageInput", "streaming", "toolCalling", "mcpReady", "openAiCompatible"],
};
