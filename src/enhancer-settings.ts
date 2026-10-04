import { type ModelRef, type PromptsmithFamily, type PromptsmithSettings } from "./types.js";

export function setActiveEnhancerModelMode(settings: PromptsmithSettings): PromptsmithSettings {
  const next = { ...settings, enhancerModelMode: "active" as const };
  delete next.fixedEnhancerModel;
  delete next.familyEnhancerModels;
  return next;
}

export function setFixedEnhancerModel(
  settings: PromptsmithSettings,
  modelRef: ModelRef
): PromptsmithSettings {
  return {
    ...setActiveEnhancerModelMode(settings),
    enhancerModelMode: "fixed",
    fixedEnhancerModel: modelRef,
  };
}

// Fixed mode needs the fixed model, so clearing it falls back to the active model.
// Family models picked in the meantime are kept for a later family-linked setup.
export function clearFixedEnhancerModel(settings: PromptsmithSettings): PromptsmithSettings {
  const next: PromptsmithSettings = {
    ...settings,
    enhancerModelMode:
      settings.enhancerModelMode === "fixed" ? "active" : settings.enhancerModelMode,
  };
  delete next.fixedEnhancerModel;
  return next;
}

// One family model is kept on its own until the other family has a model too.
// Only then does the enhancer switch to family-linked mode, so the current mode
// (and its fixed model) keeps working in between.
export function setFamilyEnhancerModel(
  settings: PromptsmithSettings,
  family: PromptsmithFamily,
  modelRef: ModelRef
): PromptsmithSettings {
  const familyEnhancerModels = {
    ...(settings.familyEnhancerModels ?? {}),
    [family]: modelRef,
  };
  if (!familyEnhancerModels.gpt || !familyEnhancerModels.claude) {
    return { ...settings, familyEnhancerModels };
  }

  const next: PromptsmithSettings = {
    ...settings,
    enhancerModelMode: "family-linked",
    familyEnhancerModels,
  };
  delete next.fixedEnhancerModel;
  return next;
}

// Family-linked mode needs both models, so clearing one falls back to the active
// model while the other family keeps its selection.
export function clearFamilyEnhancerModel(
  settings: PromptsmithSettings,
  family: PromptsmithFamily
): PromptsmithSettings {
  const familyEnhancerModels = { ...(settings.familyEnhancerModels ?? {}) };
  delete familyEnhancerModels[family];

  const next: PromptsmithSettings = {
    ...settings,
    enhancerModelMode:
      settings.enhancerModelMode === "family-linked" ? "active" : settings.enhancerModelMode,
    familyEnhancerModels,
  };
  if (!familyEnhancerModels.gpt && !familyEnhancerModels.claude) {
    delete next.familyEnhancerModels;
  }
  return next;
}
