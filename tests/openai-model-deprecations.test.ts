import assert from "node:assert/strict";
import test from "node:test";
import { getAiProviderDefinition, modelSupportsImageInput } from "../src/ai/providers";
import { selectModelOptionsForProvider } from "../src/ai/providerModelOptions";
import { openAiProvider } from "../src/ai/providerRegistry/openai";
import { githubCopilotProvider } from "../src/ai/providerRegistry/githubCopilot";
import { OPENAI_MODEL_DEPRECATIONS, isDeprecatedProviderModel } from "../src/ai/providerRegistry/deprecations";

const deprecatedIds = Object.keys(OPENAI_MODEL_DEPRECATIONS);
const refreshedModels = [...deprecatedIds, "gpt-5.1-mini", "gpt-6-luna", "gpt-6-sol"]
  .map((id) => ({ id, label: id }));

test("OpenAI suggestions withdraw exact deprecated IDs and include official replacements", () => {
  const provider = getAiProviderDefinition("openai");
  for (const definition of [provider, openAiProvider]) {
    for (const id of deprecatedIds) {
      assert.ok(!definition.modelOptions.some((model) => model.id === id));
    }
    for (const id of ["gpt-6-luna", "gpt-6-sol"]) {
      assert.ok(definition.modelOptions.some((model) => model.id === id));
      assert.equal(modelSupportsImageInput(definition, id), true);
    }
  }
  assert.equal(provider.defaultModel, "gpt-5.6-luna");
  for (const showAllModels of [false, true]) {
    const models = selectModelOptionsForProvider({ provider, customModel: "", refreshedModels, showAllModels });
    assert.ok(!models.some((model) => deprecatedIds.includes(model.id)));
    for (const id of ["gpt-6-luna", "gpt-6-sol"]) {
      assert.ok(models.some((model) => model.id === id));
    }
  }
});

test("saved/custom deprecated selections remain explicit and are never rewritten", () => {
  const provider = getAiProviderDefinition("openai");
  for (const customModel of deprecatedIds) {
    for (const showAllModels of [false, true]) {
      const models = selectModelOptionsForProvider({ provider, customModel, refreshedModels, showAllModels });
      assert.equal(models.filter((model) => model.id === customModel).length, 1);
      assert.equal(models[0].id, customModel);
    }
  }
});

test("deprecation policy is exact and exclusive to the OpenAI provider", () => {
  assert.equal(isDeprecatedProviderModel("openai", " GPT-5.1 "), true);
  assert.equal(isDeprecatedProviderModel("openai", "gpt-5.1-mini"), false);
  assert.equal(isDeprecatedProviderModel("openai", "my-gpt-5.1-deployment"), false);
  assert.equal(OPENAI_MODEL_DEPRECATIONS["gpt-5.4-nano"].replacement, "gpt-6-luna");
  assert.equal(OPENAI_MODEL_DEPRECATIONS["gpt-5.3-codex"].replacement, "gpt-6-sol");
  assert.equal(OPENAI_MODEL_DEPRECATIONS["gpt-5.1"].replacement, "gpt-6-sol");
  for (const policy of Object.values(OPENAI_MODEL_DEPRECATIONS)) {
    assert.equal(policy.shutdownDate, "2027-04-01");
  }
  for (const kind of ["azure-openai", "github-copilot", "openai-compatible"] as const) {
    for (const id of deprecatedIds) assert.equal(isDeprecatedProviderModel(kind, id), false);
    const provider = getAiProviderDefinition(kind);
    const models = selectModelOptionsForProvider({ provider, customModel: "", refreshedModels, showAllModels: true });
    for (const id of deprecatedIds) assert.ok(models.some((model) => model.id === id));
  }
  const copilot = getAiProviderDefinition("github-copilot");
  for (const provider of [copilot, githubCopilotProvider]) {
    assert.ok(provider.modelOptions.some((model) => model.id === "gpt-5.1-mini"));
  }
  const copilotModels = selectModelOptionsForProvider({ provider: copilot, customModel: "", refreshedModels, showAllModels: false });
  assert.ok(copilotModels.some((model) => model.id === "gpt-5.3-codex"));
  assert.ok(copilotModels.some((model) => model.id === "gpt-5.1-mini"));
  const allOpenAi = selectModelOptionsForProvider({ provider: getAiProviderDefinition("openai"), customModel: "", refreshedModels, showAllModels: true });
  assert.ok(allOpenAi.some((model) => model.id === "gpt-5.1-mini"));
});
