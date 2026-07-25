import { anthropicProvider } from "./anthropic";
import { azureOpenAiProvider } from "./azureOpenAi";
import { cursorProvider } from "./cursor";
import { deepSeekProvider } from "./deepseek";
import { geminiProvider } from "./gemini";
import { githubCopilotProvider } from "./githubCopilot";
import { grokProvider } from "./grok";
import { liteLlmProvider } from "./litellm";
import { moonshotProvider } from "./moonshot";
import { nvidiaProvider } from "./nvidia";
import { ollamaProvider } from "./ollama";
import { ollamaCloudProvider } from "./ollamaCloud";
import { opencodeProvider } from "./opencode";
import { openAiCompatibleProvider } from "./openAiCompatible";
import { openAiProvider } from "./openai";
import { openRouterProvider } from "./openrouter";
import { zaiProvider } from "./zai";
import { applyModelCatalog } from "./modelCatalog";
import type { AiProviderDefinition } from "./types";
export { modelSupportsImageInput } from "./imageInput";
export { AI_PROVIDER_MODEL_CATALOG } from "./modelCatalog";

export const AI_PROVIDER_DEFINITIONS: AiProviderDefinition[] = [
  openAiProvider,
  anthropicProvider,
  cursorProvider,
  openRouterProvider,
  zaiProvider,
  moonshotProvider,
  deepSeekProvider,
  geminiProvider,
  grokProvider,
  azureOpenAiProvider,
  liteLlmProvider,
  githubCopilotProvider,
  ollamaProvider,
  ollamaCloudProvider,
  nvidiaProvider,
  opencodeProvider,
  openAiCompatibleProvider,
].map(applyModelCatalog);

export type {
  AiModelOption,
  AiProviderCapability,
  AiProviderDefinition,
  AiProviderModelListStrategy,
  AiProviderSettingsField,
} from "./types";
