import type { ModelRef, PromptsmithFamily, PromptsmithSettings } from "./types.js";

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

export function clearFixedEnhancerModel(settings: PromptsmithSettings): PromptsmithSettings {
  if (settings.enhancerModelMode === "fixed") {
    return setActiveEnhancerModelMode(settings);
  }

  const next = { ...settings };
  delete next.fixedEnhancerModel;
  return next;
}

export function setFamilyEnhancerModel(
  settings: PromptsmithSettings,
  family: PromptsmithFamily,
  modelRef: ModelRef
): PromptsmithSettings {
  const familyEnhancerModels = {
    ...(settings.familyEnhancerModels ?? {}),
    [family]: modelRef,
  };
  const enhancerModelMode =
    familyEnhancerModels.gpt && familyEnhancerModels.claude
      ? ("family-linked" as const)
      : settings.enhancerModelMode === "fixed"
        ? ("active" as const)
        : settings.enhancerModelMode;
  const next: PromptsmithSettings = {
    ...settings,
    enhancerModelMode,
    familyEnhancerModels,
  };
  delete next.fixedEnhancerModel;
  if (next.enhancerModelMode !== "family-linked") {
    delete next.familyEnhancerModels;
  }
  return next;
}

export function clearFamilyEnhancerModel(
  settings: PromptsmithSettings,
  family: PromptsmithFamily
): PromptsmithSettings {
  if (settings.enhancerModelMode === "family-linked") {
    return setActiveEnhancerModelMode(settings);
  }

  const nextFamilyModels = { ...(settings.familyEnhancerModels ?? {}) };
  delete nextFamilyModels[family];

  if (Object.keys(nextFamilyModels).length === 0) {
    const next = { ...settings };
    delete next.familyEnhancerModels;
    return next;
  }

  return { ...settings, familyEnhancerModels: nextFamilyModels };
}
