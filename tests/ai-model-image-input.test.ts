import assert from "node:assert/strict";
import test from "node:test";
import { getAiProviderDefinition, modelSupportsImageInput } from "../src/ai/providers";

test("image input recognizes provider prefixes and tags without enabling text-only siblings", () => {
  for (const [provider, model, supportsImages] of [
    ["ollama", "qwen3.8:27b", true],
    ["openrouter", "qwen/qwen3.8-max", true],
    ["openrouter", "qwen/qwen3.8-2.4t-a95b", false],
    ["openai-compatible", "z-ai/glm-5.3-flash", true],
    ["openai-compatible", "z-ai/glm-5.3", false],
    ["ollama", "glm-5.3-flash:cloud", true],
    ["ollama", "minimax-m3:cloud", true],
    ["ollama-cloud", "minimax-m2.7", false],
    ["deepseek", "deepseek-v4-flash-vision-exp", true],
    ["openai-compatible", "deepseek/deepseek-v4-flash-vision-exp", true],
    ["openai-compatible", "deepseek/deepseek-v4-flash", false],
    ["openai-compatible", "deepseek/deepseek-v4-pro", false],
  ] as const) {
    assert.equal(
      modelSupportsImageInput(getAiProviderDefinition(provider), model),
      supportsImages,
      `${provider}/${model}`,
    );
  }
});
