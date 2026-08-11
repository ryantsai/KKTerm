import { getAiProviderDefinition, providerDefaultsFor, validateAiProviderForChat } from "./providers";
import { defaultAiAssistantToolSettings } from "../app-defaults";

function assertToolsDefaultOnExceptEmail(label: string, tools: Record<string, boolean>) {
  const disabledDefaultTools = Object.entries(tools)
    .filter(([toolId, enabled]) => toolId !== "email" && !enabled)
    .map(([toolId]) => toolId);
  if (disabledDefaultTools.length > 0) {
    throw new Error(
      `${label} AI assistant tools should default on except email; disabled defaults: ${disabledDefaultTools.join(", ")}`,
    );
  }
  if (tools.email) {
    throw new Error(`${label} email AI assistant tool should stay off by default.`);
  }
}

const copilotSettings = providerDefaultsFor("github-copilot");

assertToolsDefaultOnExceptEmail("Provider", providerDefaultsFor("openai").tools);
assertToolsDefaultOnExceptEmail("App", defaultAiAssistantToolSettings);
if (providerDefaultsFor("openai").searchProvider !== "exa") {
  throw new Error("AI providers should default web search to Exa.");
}
const duckDuckGoSettings = validateAiProviderForChat(
  { ...providerDefaultsFor("openai"), searchProvider: "scraper" },
  true,
);
if (duckDuckGoSettings.searchProvider !== "scraper") {
  throw new Error("An explicitly selected DuckDuckGo search provider should be preserved.");
}

try {
  validateAiProviderForChat(copilotSettings, false);
  throw new Error("GitHub Copilot should require device sign-in before chat.");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (!message.includes("Connect GitHub Copilot")) {
    throw Object.assign(
      new Error(`GitHub Copilot should fail with the connection requirement, got: ${message}`),
      { cause: error },
    );
  }
}

validateAiProviderForChat(copilotSettings, true);

const cursorSettings = providerDefaultsFor("cursor");
if (!cursorSettings.useCursorCli) {
  throw new Error("Cursor should default to its required local CLI backend.");
}
if (getAiProviderDefinition("cursor").requiresApiKey) {
  throw new Error("Cursor should use the CLI's cached authentication instead of an API key.");
}
validateAiProviderForChat(cursorSettings, false);
try {
  validateAiProviderForChat({ ...cursorSettings, useCursorCli: false }, false);
  throw new Error("Cursor should require its CLI backend before chat.");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (!message.includes("Enable Cursor Agent CLI")) {
    throw Object.assign(
      new Error(`Cursor should fail with the CLI requirement, got: ${message}`),
      { cause: error },
    );
  }
}

const ollamaDefinition = getAiProviderDefinition("ollama");
if (ollamaDefinition.modelListStrategy !== "ollamaTags" || !ollamaDefinition.strictModelList) {
  throw new Error("Ollama should refresh from native tags and treat pulled models as strict.");
}
if (ollamaDefinition.requiresApiKey) {
  throw new Error("Local Ollama should keep the API key optional (vanilla localhost needs no auth).");
}
if (
  !ollamaDefinition.settingsFields.includes("apiKey") ||
  !ollamaDefinition.settingsFields.includes("extraHeaders")
) {
  throw new Error(
    "Local Ollama should expose optional API key and extra header fields for proxied/self-hosted endpoints.",
  );
}
// No key supplied: still valid, because the key is optional for local Ollama.
validateAiProviderForChat(providerDefaultsFor("ollama"), false);
// Custom headers entered against Ollama should be preserved (not stripped like hosted providers).
const ollamaSettings = validateAiProviderForChat(
  {
    ...providerDefaultsFor("ollama"),
    extraHeaders: " x-proxy-key=secret ",
  },
  false,
);
if (ollamaSettings.extraHeaders !== "x-proxy-key=secret") {
  throw new Error(`Local Ollama extra headers should be trimmed and kept, got: ${ollamaSettings.extraHeaders}`);
}

const ollamaCloudDefinition = getAiProviderDefinition("ollama-cloud");
if (ollamaCloudDefinition.modelListStrategy !== "ollamaTags") {
  throw new Error("Ollama Cloud should refresh models from the native tags endpoint.");
}
if (ollamaCloudDefinition.baseUrl !== "https://ollama.com/v1") {
  throw new Error(
    `Ollama Cloud should target the direct cloud endpoint, got: ${ollamaCloudDefinition.baseUrl}`,
  );
}
if (!ollamaCloudDefinition.requiresApiKey || ollamaCloudDefinition.allowsCustomBaseUrl) {
  throw new Error("Ollama Cloud should require a bearer API key against the fixed cloud endpoint.");
}
if (!ollamaCloudDefinition.settingsFields.includes("apiKey")) {
  throw new Error("Ollama Cloud should expose the API key field.");
}
validateAiProviderForChat(providerDefaultsFor("ollama-cloud"), true);

const opencodeDefinition = getAiProviderDefinition("opencode");
if (opencodeDefinition.baseUrl !== "https://opencode.ai/zen/go/v1") {
  throw new Error(`OpenCode should use the Go OpenAI-compatible base URL, got: ${opencodeDefinition.baseUrl}`);
}
if (opencodeDefinition.modelListStrategy !== "openAiCompatible") {
  throw new Error("OpenCode should refresh from the OpenAI-compatible models endpoint.");
}

const compatibleDefinition = getAiProviderDefinition("openai-compatible");
if (!compatibleDefinition.settingsFields.includes("extraHeaders")) {
  throw new Error("OpenAI Compatible should expose the extra headers settings field.");
}
if (!compatibleDefinition.settingsFields.includes("apiMode")) {
  throw new Error("OpenAI Compatible should expose the API mode settings field.");
}

const compatibleSettings = validateAiProviderForChat(
  {
    ...providerDefaultsFor("openai-compatible"),
    baseUrl: "https://gateway.example/v1",
    apiMode: "responses",
    extraHeaders: ' sid=1, "env"="3" ',
  },
  true,
);
if (compatibleSettings.extraHeaders !== 'sid=1, "env"="3"') {
  throw new Error(`OpenAI Compatible extra headers should be trimmed, got: ${compatibleSettings.extraHeaders}`);
}
if (compatibleSettings.apiMode !== "responses") {
  throw new Error(`OpenAI Compatible API mode should persist responses, got: ${compatibleSettings.apiMode}`);
}

const hostedSettings = validateAiProviderForChat(
  {
    ...providerDefaultsFor("openai"),
    apiMode: "responses",
    extraHeaders: "sid=1",
  },
  true,
);
if (hostedSettings.extraHeaders !== "") {
  throw new Error("Hosted providers should not carry OpenAI Compatible extra headers.");
}
if (hostedSettings.apiMode !== "chatCompletions") {
  throw new Error("Hosted providers should normalize API mode back to Chat Completions.");
}
