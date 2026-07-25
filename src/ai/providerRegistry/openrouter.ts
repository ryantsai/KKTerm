import { HOSTED_PROVIDER_SETTINGS_FIELDS, STANDARD_REASONING_EFFORTS } from "./shared";
import type { AiProviderDefinition } from "./types";

export const openRouterProvider: AiProviderDefinition = {
  kind: "openrouter",
  label: "OpenRouter",
  baseUrl: "https://openrouter.ai/api/v1",
  defaultModel: "openai/gpt-5.5",
  defaultReasoningEffort: "medium",
  reasoningEfforts: [...STANDARD_REASONING_EFFORTS],
  requiresApiKey: true,
  allowsCustomBaseUrl: false,
  allowsCustomModel: true,
  apiKeyLabel: "OpenRouter API key",
  apiKeyUrl: "https://openrouter.ai/settings/keys",
  modelListStrategy: "openAiCompatible",
  modelOptions: [
    { id: "openrouter/auto", label: "OpenRouter Auto", supportsImageInput: true },
    { id: "openai/gpt-5.5", label: "OpenAI GPT-5.5", supportsImageInput: true },
    { id: "anthropic/claude-opus-5", label: "Claude Opus 5", supportsImageInput: true },
    { id: "anthropic/claude-sonnet-5", label: "Claude Sonnet 5", supportsImageInput: true },
    { id: "google/gemini-3.6-flash", label: "Gemini 3.6 Flash", supportsImageInput: true },
    { id: "x-ai/grok-4.5", label: "Grok 4.5", supportsImageInput: true },
    { id: "moonshotai/kimi-k3", label: "Kimi K3", supportsImageInput: true },
    { id: "xiaomi/mimo-v2.5", label: "MiMo-V2.5", supportsImageInput: true },
    { id: "z-ai/glm-5.2", label: "GLM-5.2", supportsImageInput: false },
    { id: "deepseek/deepseek-v4-flash", label: "DeepSeek V4 Flash", supportsImageInput: false },
    { id: "deepseek/deepseek-v4-pro", label: "DeepSeek V4 Pro", supportsImageInput: false },
    { id: "minimax/minimax-m3", label: "MiniMax M3", supportsImageInput: true },
  ],
  settingsFields: HOSTED_PROVIDER_SETTINGS_FIELDS,
  capabilities: ["chat", "imageInput", "streaming", "toolCalling", "mcpReady", "openAiCompatible"],
};
