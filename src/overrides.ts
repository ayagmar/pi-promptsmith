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
