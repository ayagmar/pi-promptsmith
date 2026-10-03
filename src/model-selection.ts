import { type Api, type Model } from "@earendil-works/pi-ai";
import { type ModelRegistry } from "@earendil-works/pi-coding-agent";
import {
  type ModelRef,
  type PromptsmithFamily,
  type PromptsmithSettings,
  type ResolvedEnhancerModel,
} from "./types.js";

// Request auth (API keys, headers, base URLs, OAuth refresh) is resolved by
// ctx.modelRegistry at request time, so this only picks the model.
export function resolveEnhancerModel(
  settings: PromptsmithSettings,
  targetFamily: PromptsmithFamily,
  activeModel: Model<Api> | undefined,
  modelRegistry: Pick<ModelRegistry, "find">
): ResolvedEnhancerModel {
  switch (settings.enhancerModelMode) {
    case "active": {
      if (!activeModel) {
        throw new Error(
          "Promptsmith requires an active model when enhancer-model mode is 'active'."
        );
      }
      return {
        mode: "active",
        family: targetFamily,
        model: activeModel,
        label: `active (${activeModel.provider}/${activeModel.id})`,
      };
    }

    case "fixed": {
      const fixedRef = settings.fixedEnhancerModel;
      if (!fixedRef) {
        throw new Error(
          "Promptsmith enhancer-model mode is 'fixed', but no fixed enhancer model is configured."
        );
      }
      return resolveConfiguredModel(modelRegistry, targetFamily, fixedRef, "fixed");
    }

    case "family-linked": {
      const familyRef =
        targetFamily === "gpt"
          ? settings.familyEnhancerModels?.gpt
          : settings.familyEnhancerModels?.claude;
      if (!familyRef) {
        throw new Error(
          `Promptsmith enhancer-model mode is 'family-linked', but no ${targetFamily} enhancer model is configured.`
        );
      }
      return resolveConfiguredModel(modelRegistry, targetFamily, familyRef, "family-linked");
    }

    default:
      throw new Error(
        `Promptsmith received unsupported enhancer-model mode: ${String(settings.enhancerModelMode)}.`
      );
  }
}

export function parseModelRef(value: string): ModelRef | undefined {
  const separatorIndex = value.indexOf("/");
  if (separatorIndex <= 0 || separatorIndex === value.length - 1) {
    return undefined;
  }

  const provider = value.slice(0, separatorIndex).trim();
  const id = value.slice(separatorIndex + 1).trim();
  if (!provider || !id) {
    return undefined;
  }

  return { provider, id };
}

function resolveConfiguredModel(
  modelRegistry: Pick<ModelRegistry, "find">,
  targetFamily: PromptsmithFamily,
  modelRef: ModelRef,
  mode: ResolvedEnhancerModel["mode"]
): ResolvedEnhancerModel {
  const model = modelRegistry.find(modelRef.provider, modelRef.id);
  if (!model) {
    throw new Error(
      `Promptsmith could not find the configured enhancer model ${modelRef.provider}/${modelRef.id}.`
    );
  }

  return {
    mode,
    family: targetFamily,
    model,
    label: `${model.provider}/${model.id}`,
  };
}
