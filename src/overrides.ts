import { normalize } from "./model-routing.js";
import type { ModelRef, PromptsmithFamily, PromptsmithSettings } from "./types.js";

export function upsertExactModelOverride(
  settings: PromptsmithSettings,
  modelRef: ModelRef,
  family: PromptsmithFamily
): PromptsmithSettings {
  return {
    ...settings,
    exactModelOverrides: [
      ...settings.exactModelOverrides.filter(
        (entry) =>
          !(
            normalize(entry.provider) === normalize(modelRef.provider) &&
            normalize(entry.id) === normalize(modelRef.id)
          )
      ),
      { ...modelRef, family },
    ],
  };
}

export function removeExactModelOverride(
  settings: PromptsmithSettings,
  modelRef: ModelRef
): PromptsmithSettings {
  return {
    ...settings,
    exactModelOverrides: settings.exactModelOverrides.filter(
      (entry) =>
        !(
          normalize(entry.provider) === normalize(modelRef.provider) &&
          normalize(entry.id) === normalize(modelRef.id)
        )
    ),
  };
}

export function upsertFamilyOverride(
  settings: PromptsmithSettings,
  pattern: string,
  family: PromptsmithFamily
): PromptsmithSettings {
  return {
    ...settings,
    familyOverrides: [
      ...settings.familyOverrides.filter(
        (entry) => normalize(entry.pattern) !== normalize(pattern)
      ),
      { pattern, family },
    ],
  };
}

export function removeFamilyOverride(
  settings: PromptsmithSettings,
  pattern: string
): PromptsmithSettings {
  return {
    ...settings,
    familyOverrides: settings.familyOverrides.filter(
      (entry) => normalize(entry.pattern) !== normalize(pattern)
    ),
  };
}
