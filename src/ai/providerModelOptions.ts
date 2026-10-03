import { isDeprecatedProviderModel } from "./providerRegistry/deprecations";
import type { AiProviderKind } from "../types";
import type { AiModelOption, AiProviderDefinition } from "./providerRegistry";

type ProviderModelOption = {
  id: string;
  label: string;
  recommended?: boolean;
  supportsImageInput?: boolean | null;
};

type ModelSelectionInput = {
  customModel: string;
  provider: AiProviderDefinition;
  refreshedModels: ProviderModelOption[];
  showAllModels: boolean;
};

export type DisplayModelOption = ProviderModelOption & {
  custom: true;
};

const OPENROUTER_MODEL_COLLATOR = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

function compareModelsByNameDescending(
  left: ProviderModelOption,
  right: ProviderModelOption,
) {
  const byLabel = OPENROUTER_MODEL_COLLATOR.compare(right.label, left.label);
  if (byLabel !== 0) return byLabel;
  return OPENROUTER_MODEL_COLLATOR.compare(right.id, left.id);
}

export function sortModelOptionsForProvider<T extends ProviderModelOption>(
  _providerKind: AiProviderKind,
  models: T[],
) {
  return [...models].sort(compareModelsByNameDescending);
}

function normalizeModelId(model: string) {
  return model.trim().toLowerCase();
}

function mergeModelMetadata<T extends ProviderModelOption>(
  model: T,
  providerModelLookup: Map<string, AiModelOption>,
): T {
  const providerModel = providerModelLookup.get(normalizeModelId(model.id));
  return {
    ...model,
    label: providerModel?.label ?? model.label,
    recommended: providerModel?.recommended ?? model.recommended,
    supportsImageInput: providerModel?.supportsImageInput ?? model.supportsImageInput,
  };
}

function uniqueModelOptions<T extends ProviderModelOption>(models: T[]) {
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const model of models) {
    const normalizedId = normalizeModelId(model.id);
    if (seen.has(normalizedId)) continue;
    seen.add(normalizedId);
    unique.push(model);
  }
  return unique;
}

export function selectModelOptionsForProvider({
  customModel,
  provider,
  refreshedModels,
  showAllModels,
}: ModelSelectionInput): ProviderModelOption[] {
  const providerModelLookup = new Map(
    provider.modelOptions.map((model) => [normalizeModelId(model.id), model]),
  );
  const customModelId = customModel.trim();
  // Withdraw deprecated OpenAI suggestions, including IDs returned by refresh.
  // Explicit saved/custom selections are reinserted below without migration.
  const isSuggestedModel = (model: ProviderModelOption) =>
    !isDeprecatedProviderModel(provider.kind, model.id);
  const sortedProviderModels = sortModelOptionsForProvider(
    provider.kind, provider.modelOptions.filter(isSuggestedModel),
  );
  const sortedRefreshedModels = sortModelOptionsForProvider(provider.kind, refreshedModels.filter(isSuggestedModel)).map(
    (model) => mergeModelMetadata(model, providerModelLookup),
  );
  const refreshedModelsAreAuthoritative =
    provider.kind === "github-copilot" && sortedRefreshedModels.length > 0;
  const refreshedModelIds = new Set(
    sortedRefreshedModels.map((model) => normalizeModelId(model.id)),
  );

  let displayModels: ProviderModelOption[];
  if (showAllModels) {
    displayModels = [
      ...(sortedRefreshedModels.length > 0 ? sortedRefreshedModels : sortedProviderModels),
      ...sortedProviderModels,
    ];
  } else if (refreshedModelsAreAuthoritative) {
    displayModels = [
      ...provider.modelOptions.filter((model) => model.id === "auto"),
      ...sortedProviderModels.filter(
        (model) => model.id !== "auto" && refreshedModelIds.has(normalizeModelId(model.id)),
      ),
    ];
  } else {
    displayModels = sortedProviderModels.filter((model) => model.recommended);
  }

  const customModelOption =
    customModelId &&
    !displayModels.some((model) => normalizeModelId(model.id) === normalizeModelId(customModelId))
      ? [
          {
            id: customModelId,
            label: customModelId,
            custom: true as const,
          },
        ]
      : [];

  return uniqueModelOptions([...customModelOption, ...displayModels]);
}
