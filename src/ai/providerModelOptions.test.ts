import {
  selectModelOptionsForProvider,
  sortModelOptionsForProvider,
} from "./providerModelOptions";
import { defaultAiProviderSettings } from "../app-defaults";
import { getAiProviderDefinition } from "./providers";

const sorted = sortModelOptionsForProvider("openai", [
  { id: "gpt-5.4-mini", label: "GPT-5.4 Mini" },
  { id: "gpt-5.5", label: "GPT-5.5" },
  { id: "claude-sonnet-4.6", label: "Claude Sonnet 4.6" },
  { id: "gpt-5.4", label: "GPT-5.4" },
]).map((model) => model.id);

const expected = ["gpt-5.5", "gpt-5.4-mini", "gpt-5.4", "claude-sonnet-4.6"];

if (JSON.stringify(sorted) !== JSON.stringify(expected)) {
  throw new Error(`Models should sort by label descending, got: ${sorted.join(", ")}`);
}

const source = [
  { id: "a", label: "A" },
  { id: "b", label: "B" },
];
const result = sortModelOptionsForProvider("ollama", source);

if (result === source) {
  throw new Error("Model sorting should not mutate or return the source list.");
}

const openAiDefinition = getAiProviderDefinition("openai");
if (openAiDefinition.defaultModel !== "gpt-5.6-luna") {
  throw new Error(`OpenAI should default to GPT-5.6 Luna, got: ${openAiDefinition.defaultModel}`);
}
if (defaultAiProviderSettings.model !== openAiDefinition.defaultModel) {
  throw new Error("Fresh-install and OpenAI provider defaults should stay aligned.");
}

const recommendedOpenAiModelIds = openAiDefinition.modelOptions
  .filter((model) => model.recommended)
  .map((model) => model.id);
for (const modelId of ["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol"]) {
  if (!recommendedOpenAiModelIds.includes(modelId)) {
    throw new Error(`OpenAI curated models should include ${modelId}.`);
  }
}
if (recommendedOpenAiModelIds.some((modelId) => modelId.startsWith("gpt-5.5"))) {
  throw new Error("OpenAI curated models should no longer include GPT-5.5 models.");
}

const anthropicDefinition = getAiProviderDefinition("anthropic");
if (anthropicDefinition.defaultModel !== "claude-sonnet-5") {
  throw new Error(`Anthropic should default to Claude Sonnet 5, got: ${anthropicDefinition.defaultModel}`);
}
if (!anthropicDefinition.modelOptions.some((model) => model.id === "claude-sonnet-5" && model.recommended)) {
  throw new Error("Anthropic curated models should recommend Claude Sonnet 5.");
}
if (!anthropicDefinition.modelOptions.some((model) => model.id === "claude-opus-5" && model.recommended)) {
  throw new Error("Anthropic curated models should include Claude Opus 5.");
}

const grokDefinition = getAiProviderDefinition("grok");
if (!grokDefinition.modelOptions.some((model) => model.id === "grok-4.5" && model.recommended)) {
  throw new Error("Grok curated models should include Grok 4.5.");
}

const openRouterDefinition = getAiProviderDefinition("openrouter");
for (const modelId of [
  "openrouter/auto",
  "anthropic/claude-opus-5",
  "google/gemini-3.6-flash",
  "x-ai/grok-4.5",
  "moonshotai/kimi-k3",
  "xiaomi/mimo-v2.5",
  "z-ai/glm-5.2",
  "deepseek/deepseek-v4-flash",
]) {
  if (!openRouterDefinition.modelOptions.some((model) => model.id === modelId && model.recommended)) {
    throw new Error(`OpenRouter curated models should recommend ${modelId}.`);
  }
}

const zaiDefinition = getAiProviderDefinition("zai");
if (zaiDefinition.defaultModel !== "glm-5.2") {
  throw new Error(`Z.ai should default to GLM-5.2, got: ${zaiDefinition.defaultModel}`);
}
if (!zaiDefinition.modelOptions.some((model) => model.id === "glm-5.2" && model.recommended)) {
  throw new Error("Z.ai curated models should recommend GLM-5.2.");
}

const moonshotDefinition = getAiProviderDefinition("moonshot");
if (moonshotDefinition.defaultModel !== "kimi-k3") {
  throw new Error(`Moonshot AI should default to Kimi K3, got: ${moonshotDefinition.defaultModel}`);
}
if (!moonshotDefinition.modelOptions.some((model) => model.id === "kimi-k3" && model.recommended)) {
  throw new Error("Moonshot AI curated models should recommend Kimi K3.");
}

const opencodeDefinition = getAiProviderDefinition("opencode");
if (opencodeDefinition.defaultModel !== "kimi-k3") {
  throw new Error(`OpenCode should default to Kimi K3, got: ${opencodeDefinition.defaultModel}`);
}
if (!opencodeDefinition.modelOptions.some((model) => model.id === "kimi-k3" && model.recommended)) {
  throw new Error("OpenCode curated models should include Kimi K3.");
}

const cursorDefinition = getAiProviderDefinition("cursor");
if (
  cursorDefinition.defaultModel !== "auto" ||
  cursorDefinition.modelOptions.length !== 1 ||
  cursorDefinition.modelOptions[0]?.id !== "auto"
) {
  throw new Error("Cursor should curate only Auto because account model ids are dynamic.");
}

const curatedOpenAiModels = selectModelOptionsForProvider({
  customModel: "",
  provider: openAiDefinition,
  refreshedModels: [
    { id: "unlisted-lab-model", label: "Unlisted Lab Model" },
    { id: "gpt-5.4-mini", label: "GPT-5.4 Mini" },
  ],
  showAllModels: false,
});

if (curatedOpenAiModels.some((model) => model.id === "unlisted-lab-model")) {
  throw new Error("Curated model list should hide refreshed non-curated models.");
}

if (!curatedOpenAiModels.some((model) => model.id === "gpt-5.4-mini")) {
  throw new Error("Curated model list should include recommended provider defaults.");
}

const allOpenAiModels = selectModelOptionsForProvider({
  customModel: "",
  provider: openAiDefinition,
  refreshedModels: [
    { id: "unlisted-lab-model", label: "Unlisted Lab Model" },
    { id: "gpt-5.4-mini", label: "GPT-5.4 Mini" },
  ],
  showAllModels: true,
});

if (!allOpenAiModels.some((model) => model.id === "unlisted-lab-model")) {
  throw new Error("Show All Models should include refreshed non-curated models.");
}

const copilotDefinition = getAiProviderDefinition("github-copilot");
const copilotModels = selectModelOptionsForProvider({
  customModel: "",
  provider: copilotDefinition,
  refreshedModels: [
    { id: "account-enabled-model", label: "Account Enabled Model" },
    { id: "gpt-5.4-mini", label: "GPT-5.4 Mini" },
    { id: "gpt-5.1-mini", label: "GPT-5.1 Mini" },
  ],
  showAllModels: false,
});

if (!copilotModels.some((model) => model.id === "auto")) {
  throw new Error("GitHub Copilot model selectors should include Auto.");
}

if (copilotModels.some((model) => model.id === "account-enabled-model")) {
  throw new Error("GitHub Copilot should hide refreshed account models that are not curated.");
}

if (!copilotModels.some((model) => model.id === "gpt-5.1-mini")) {
  throw new Error("GitHub Copilot should show curated models that are available to the signed-in account.");
}

if (copilotModels.some((model) => model.id === "gpt-5.5")) {
  throw new Error("GitHub Copilot should not show stale curated models after account models refresh.");
}

const customModelOptions = selectModelOptionsForProvider({
  customModel: "my-private-model",
  provider: openAiDefinition,
  refreshedModels: [],
  showAllModels: false,
});

if (customModelOptions[0]?.id !== "my-private-model") {
  throw new Error("Custom model IDs should appear in model selectors even when Show All is off.");
}
