import type { AiProviderKind } from "../../types";

// OpenAI API notice dated 2026-10-01. Do not apply to Azure deployments,
// Copilot SDK model IDs, compatible gateways, or similarly named variants.
// Source: https://developers.openai.com/api/docs/deprecations
export const OPENAI_MODEL_DEPRECATIONS = {
  "gpt-5.4-nano": { replacement: "gpt-6-luna", shutdownDate: "2027-04-01" },
  "gpt-5.1": { replacement: "gpt-6-sol", shutdownDate: "2027-04-01" },
  "gpt-5.3-codex": { replacement: "gpt-6-sol", shutdownDate: "2027-04-01" },
} as const;

export function isDeprecatedProviderModel(providerKind: AiProviderKind, modelId: string) {
  return providerKind === "openai" &&
    Object.prototype.hasOwnProperty.call(OPENAI_MODEL_DEPRECATIONS, modelId.trim().toLowerCase());
}
