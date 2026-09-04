import type { AiProviderDefinition } from "./types";

const IMAGE_INPUT_MODEL_PATTERNS = [
  /^gpt-5(?:[.-]|$)/,
  /^claude(?:[.-]|$)/,
  /^gemini(?:[.-]|$)/,
  /^grok-4(?:[.-]|$)/,
  /^grok-4\.\d+(?:[.-]|$)/,
  /(?:^|[-_/])vision(?:[-_/]|$)/,
  /(?:^|[-_/])vl(?:[-_/]|$)/,
  /(?:^|[-_/])multimodal(?:[-_/]|$)/,
  /^gemma3(?::|[-.]|$)/,
  /^llava(?::|[-.]|$)/,
  /^bakllava(?::|[-.]|$)/,
  /^minicpm-v(?::|[-.]|$)/,
  /^qwen\d*(?:[._-]?vl|vl)(?::|[-.]|$)/,
  /^qwen3\.[56](?::|[-.]|$)/,
  /^qwen3\.8(?:-(?:27b|max|flash))?(?::|$)/,
  /^glm-5\.3-flash(?::|$)/,
  /^minimax-m3(?::|$)/,
  /^kimi(?:[._-]?vl|[-_]k)(?::|[-.]|$)/,
  /llama[-_/]3\.2[-_/]\d+b[-_/]vision/,
  /llama[-_/]4[-_/]maverick/,
  /nemotron[-_/]nano[-_/]vl/,
];

const TEXT_ONLY_MODEL_PATTERNS = [
  /^deepseek(?:[-_/]|$)/,
  /(?:^|\/)deepseek(?:[-_/]|$)/,
  /^grok-code(?:[-.]|$)/,
  /^qwen3(?::|[-/]|$)/,
  /^gpt-oss(?:[-.:/]|$)/,
  /^meta\/llama(?:[-.]|$)/,
  /^llama(?:[-.]|$)/,
  /^bytedance\/seed-oss(?:[-.]|$)/,
  /^abacusai\/dracarys(?:[-.]|$)/,
];

function normalizeModelId(model: string) {
  return model.trim().toLowerCase();
}

function stripProviderPrefix(model: string) {
  const parts = model.split("/");
  return parts[parts.length - 1] ?? model;
}

function matchesAny(model: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(model));
}

export function modelSupportsImageInput(
  provider: AiProviderDefinition,
  model: string,
): boolean {
  const normalizedModel = normalizeModelId(model || provider.defaultModel);
  const directOption = provider.modelOptions.find(
    (option) => normalizeModelId(option.id) === normalizedModel,
  );
  if (typeof directOption?.supportsImageInput === "boolean") {
    return directOption.supportsImageInput;
  }

  const unprefixedModel = stripProviderPrefix(normalizedModel);
  if (unprefixedModel.split(":")[0] === "deepseek-v4-flash-vision-exp") {
    return true;
  }

  if (provider.kind === "deepseek") {
    return false;
  }

  if (provider.kind === "anthropic") {
    return true;
  }

  if (matchesAny(normalizedModel, TEXT_ONLY_MODEL_PATTERNS) || matchesAny(unprefixedModel, TEXT_ONLY_MODEL_PATTERNS)) {
    return false;
  }

  if (provider.kind === "openai" || provider.kind === "azure-openai") {
    return normalizedModel.startsWith("gpt-5");
  }

  if (provider.kind === "grok") {
    return normalizedModel.startsWith("grok-4") && !normalizedModel.startsWith("grok-code");
  }

  return (
    matchesAny(normalizedModel, IMAGE_INPUT_MODEL_PATTERNS) ||
    matchesAny(unprefixedModel, IMAGE_INPUT_MODEL_PATTERNS)
  );
}
