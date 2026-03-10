import type { Api, Model } from "@mariozechner/pi-ai";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { DEFAULT_SETTINGS } from "../constants.js";
import { parseModelRef } from "../model-selection.js";
import { cloneSettings } from "../state.js";
import type { PromptsmithRuntimeState } from "../state.js";
import type { ModelRef, PromptsmithFamily, PromptsmithSettings } from "../types.js";
import { parseEnhancementTimeoutSeconds } from "../validation.js";
import { openSelectDialog, type SelectDialogItem } from "./select-dialog.js";
import {
  describeSelectedEnhancerMode,
  describeSelectedRewriteMode,
  describeSelectedStrength,
  describeSelectedTargetFamilyMode,
  ENHANCER_MODEL_OPTIONS,
  FAMILY_OPTIONS,
  formatTimeoutSeconds,
  parseLabeledEnhancerMode,
  parseLabeledRewriteMode,
  parseLabeledStrength,
  parseLabeledTargetFamilyMode,
  REWRITE_MODE_OPTIONS,
  REWRITE_STRENGTH_OPTIONS,
  TARGET_FAMILY_OPTIONS,
  type SettingsMenuOptionId,
} from "./settings-menu.js";

export interface SettingsUiServices {
  refreshStatus: (ctx: ExtensionContext) => void;
}

interface SettingsActionContext {
  ctx: ExtensionContext;
  runtime: PromptsmithRuntimeState;
  services: SettingsUiServices;
  settings: PromptsmithSettings;
}

export async function runSettingsAction(
  choice: Exclude<SettingsMenuOptionId, "done">,
  options: SettingsActionContext
): Promise<void> {
  const { ctx, runtime, services, settings } = options;

  switch (choice) {
    case "enabled":
      persistSettings(
        ctx,
        runtime,
        services,
        { ...settings, enabled: !settings.enabled },
        `Promptsmith is now ${settings.enabled ? "off" : "on"}.`
      );
      return;
    case "shortcutEnabled":
      persistSettings(
        ctx,
        runtime,
        services,
        { ...settings, shortcutEnabled: !settings.shortcutEnabled },
        `Keyboard shortcut is now ${settings.shortcutEnabled ? "off" : "on"}.`
      );
      return;
    case "targetFamilyMode": {
      const mode = await selectOption(
        ctx,
        "Choose prompt style target",
        TARGET_FAMILY_OPTIONS,
        describeSelectedTargetFamilyMode(settings.targetFamilyMode)
      );
      const nextMode = parseLabeledTargetFamilyMode(mode);
      if (nextMode) {
        persistSettings(
          ctx,
          runtime,
          services,
          { ...settings, targetFamilyMode: nextMode },
          `Prompt style target set to ${nextMode}.`
        );
      }
      return;
    }
    case "fallbackFamily": {
      const family = await selectFamily(
        ctx,
        "Choose the default style for models that do not match any routing rule"
      );
      if (family) {
        persistSettings(
          ctx,
          runtime,
          services,
          { ...settings, fallbackFamily: family },
          `Unknown models now default to ${family}.`
        );
      }
      return;
    }
    case "enhancerModelMode": {
      const mode = await selectOption(
        ctx,
        "Choose which model performs the rewrite",
        ENHANCER_MODEL_OPTIONS,
        describeSelectedEnhancerMode(settings.enhancerModelMode)
      );
      const nextMode = parseLabeledEnhancerMode(mode);
      if (nextMode) {
        persistSettings(
          ctx,
          runtime,
          services,
          { ...settings, enhancerModelMode: nextMode },
          `Enhancer model choice set to ${nextMode}.`
        );
      }
      return;
    }
    case "fixedEnhancerModel": {
      const modelRef = await chooseModelRef(ctx, "Choose the fixed enhancer model");
      if (modelRef === null) {
        persistSettings(
          ctx,
          runtime,
          services,
          removeFixedEnhancerModel(settings),
          "Fixed enhancer model cleared."
        );
      } else if (modelRef) {
        persistSettings(
          ctx,
          runtime,
          services,
          { ...settings, fixedEnhancerModel: modelRef },
          `Fixed enhancer model set to ${modelRef.provider}/${modelRef.id}.`
        );
      }
      return;
    }
    case "gptEnhancerModel": {
      const modelRef = await chooseModelRef(ctx, "Choose the model used for GPT-style rewrites");
      if (modelRef === null) {
        persistSettings(
          ctx,
          runtime,
          services,
          updateFamilyEnhancerModel(settings, "gpt", undefined),
          "GPT-style enhancer model cleared."
        );
      } else if (modelRef) {
        persistSettings(
          ctx,
          runtime,
          services,
          updateFamilyEnhancerModel(settings, "gpt", modelRef),
          `GPT-style enhancer model set to ${modelRef.provider}/${modelRef.id}.`
        );
      }
      return;
    }
    case "claudeEnhancerModel": {
      const modelRef = await chooseModelRef(ctx, "Choose the model used for Claude-style rewrites");
      if (modelRef === null) {
        persistSettings(
          ctx,
          runtime,
          services,
          updateFamilyEnhancerModel(settings, "claude", undefined),
          "Claude-style enhancer model cleared."
        );
      } else if (modelRef) {
        persistSettings(
          ctx,
          runtime,
          services,
          updateFamilyEnhancerModel(settings, "claude", modelRef),
          `Claude-style enhancer model set to ${modelRef.provider}/${modelRef.id}.`
        );
      }
      return;
    }
    case "includeRecentConversation":
      persistSettings(
        ctx,
        runtime,
        services,
        { ...settings, includeRecentConversation: !settings.includeRecentConversation },
        settings.includeRecentConversation
          ? "Recent chat context disabled for faster rewrites."
          : "Recent chat context enabled. Rewrites may be slower but more aware of the thread."
      );
      return;
    case "includeProjectMetadata":
      persistSettings(
        ctx,
        runtime,
        services,
        { ...settings, includeProjectMetadata: !settings.includeProjectMetadata },
        `Project metadata is now ${settings.includeProjectMetadata ? "off" : "on"}.`
      );
      return;
    case "statusBarEnabled":
      persistSettings(
        ctx,
        runtime,
        services,
        { ...settings, statusBarEnabled: !settings.statusBarEnabled },
        `Status bar is now ${settings.statusBarEnabled ? "off" : "on"}.`
      );
      return;
    case "enhancementTimeoutMs": {
      const raw = await ctx.ui.input("Enhancement timeout", "Enter seconds between 5 and 300");
      if (!raw?.trim()) {
        return;
      }
      const timeoutMs = parseEnhancementTimeoutSeconds(raw);
      if (timeoutMs === undefined) {
        ctx.ui.notify("Enhancement timeout must be between 5 and 300 seconds.", "error");
        return;
      }
      persistSettings(
        ctx,
        runtime,
        services,
        { ...settings, enhancementTimeoutMs: timeoutMs },
        `Enhancement timeout set to ${formatTimeoutSeconds(timeoutMs)}.`
      );
      return;
    }
    case "rewriteStrength": {
      const strength = await selectOption(
        ctx,
        "Choose rewrite strength",
        REWRITE_STRENGTH_OPTIONS,
        describeSelectedStrength(settings.rewriteStrength)
      );
      const nextStrength = parseLabeledStrength(strength);
      if (nextStrength) {
        persistSettings(
          ctx,
          runtime,
          services,
          { ...settings, rewriteStrength: nextStrength },
          `Rewrite strength set to ${nextStrength}.`
        );
      }
      return;
    }
    case "rewriteMode": {
      const rewriteMode = await selectOption(
        ctx,
        "Choose rewrite mode",
        REWRITE_MODE_OPTIONS,
        describeSelectedRewriteMode(settings.rewriteMode)
      );
      const nextRewriteMode = parseLabeledRewriteMode(rewriteMode);
      if (nextRewriteMode) {
        persistSettings(
          ctx,
          runtime,
          services,
          { ...settings, rewriteMode: nextRewriteMode },
          `Rewrite mode set to ${nextRewriteMode}.`
        );
      }
      return;
    }
    case "previewBeforeReplace":
      persistSettings(
        ctx,
        runtime,
        services,
        { ...settings, previewBeforeReplace: !settings.previewBeforeReplace },
        `Review before replace is now ${settings.previewBeforeReplace ? "off" : "on"}.`
      );
      return;
    case "preserveCodeBlocks":
      persistSettings(
        ctx,
        runtime,
        services,
        { ...settings, preserveCodeBlocks: !settings.preserveCodeBlocks },
        `Code block preservation is now ${settings.preserveCodeBlocks ? "off" : "on"}.`
      );
      return;
    case "exactModelOverrides":
      await manageExactOverrides(ctx, runtime, services);
      return;
    case "familyOverrides":
      await managePatternOverrides(ctx, runtime, services);
      return;
    case "reset":
      resetGlobalSettings(ctx, runtime, services);
      return;
  }
}

export function resetGlobalSettings(
  ctx: ExtensionContext,
  runtime: PromptsmithRuntimeState,
  services: SettingsUiServices
): void {
  persistSettings(
    ctx,
    runtime,
    services,
    cloneSettings(DEFAULT_SETTINGS),
    "Promptsmith settings reset to defaults."
  );
}

function persistSettings(
  ctx: ExtensionContext,
  runtime: PromptsmithRuntimeState,
  services: SettingsUiServices,
  settings: PromptsmithSettings,
  message: string
): void {
  runtime.persistSettings(settings);
  services.refreshStatus(ctx);
  ctx.ui.notify(message, "info");
}

async function manageExactOverrides(
  ctx: ExtensionContext,
  runtime: PromptsmithRuntimeState,
  services: SettingsUiServices
): Promise<void> {
  let done = false;

  while (!done) {
    const settings = runtime.getSettings();
    const menuOptions = [
      ...(ctx.model ? [`Map active model (${ctx.model.provider}/${ctx.model.id})`] : []),
      "Choose model manually",
      ...(settings.exactModelOverrides.length > 0 ? ["Remove rule"] : []),
      "Back",
    ];
    const choice = await selectOption(ctx, "Exact model style rules", menuOptions, "Back");

    switch (choice) {
      case undefined:
      case "Back":
        done = true;
        break;
      case "Choose model manually": {
        const modelRef = await chooseModelRef(ctx, "Choose the model to route");
        if (modelRef && modelRef !== null) {
          const family = await selectFamily(ctx, "Choose the prompt style for this model");
          if (family) {
            const next = upsertExactOverride(settings, modelRef, family);
            persistSettings(
              ctx,
              runtime,
              services,
              next,
              `Mapped ${modelRef.provider}/${modelRef.id} to ${family}.`
            );
          }
        }
        break;
      }
      case "Remove rule": {
        const exactRuleOptions = settings.exactModelOverrides.map(
          (entry) => `${entry.provider}/${entry.id} → ${entry.family}`
        );
        const selected = await selectOption(ctx, "Remove exact model style rule", exactRuleOptions);
        if (selected) {
          const [modelText] = selected.split(" → ");
          if (!modelText) {
            break;
          }
          const modelRef = parseModelRef(modelText);
          if (modelRef) {
            const next = {
              ...settings,
              exactModelOverrides: settings.exactModelOverrides.filter(
                (entry) => !(entry.provider === modelRef.provider && entry.id === modelRef.id)
              ),
            };
            persistSettings(ctx, runtime, services, next, `Removed the rule for ${modelText}.`);
          }
        }
        break;
      }
      default:
        if (choice?.startsWith("Map active model") && ctx.model) {
          const family = await selectFamily(ctx, "Choose the prompt style for the active model");
          if (family) {
            const next = upsertExactOverride(
              settings,
              { provider: ctx.model.provider, id: ctx.model.id },
              family
            );
            persistSettings(
              ctx,
              runtime,
              services,
              next,
              `Mapped ${ctx.model.provider}/${ctx.model.id} to ${family}.`
            );
          }
        }
        break;
    }
  }
}

async function managePatternOverrides(
  ctx: ExtensionContext,
  runtime: PromptsmithRuntimeState,
  services: SettingsUiServices
): Promise<void> {
  let done = false;

  while (!done) {
    const settings = runtime.getSettings();
    const menuOptions = [
      "Add or update rule",
      ...(settings.familyOverrides.length > 0 ? ["Remove rule"] : []),
      "Back",
    ];
    const choice = await selectOption(ctx, "Pattern style rules", menuOptions, "Back");

    switch (choice) {
      case undefined:
      case "Back":
        done = true;
        break;
      case "Add or update rule": {
        const pattern = await ctx.ui.input(
          "Pattern rule",
          "Examples: openai/*, moonshot/*, kimi-*"
        );
        if (!pattern?.trim()) {
          break;
        }
        const family = await selectFamily(ctx, "Choose the prompt style for matching models");
        if (!family) {
          break;
        }
        const trimmedPattern = pattern.trim();
        const next = {
          ...settings,
          familyOverrides: [
            ...settings.familyOverrides.filter((entry) => entry.pattern !== trimmedPattern),
            { pattern: trimmedPattern, family },
          ],
        };
        persistSettings(
          ctx,
          runtime,
          services,
          next,
          `Pattern ${trimmedPattern} now routes to ${family}.`
        );
        break;
      }
      case "Remove rule": {
        const patternRuleOptions = settings.familyOverrides.map(
          (entry) => `${entry.pattern} → ${entry.family}`
        );
        const selected = await selectOption(ctx, "Remove pattern style rule", patternRuleOptions);
        if (selected) {
          const [pattern] = selected.split(" → ");
          if (!pattern) {
            break;
          }
          const next = {
            ...settings,
            familyOverrides: settings.familyOverrides.filter((entry) => entry.pattern !== pattern),
          };
          persistSettings(ctx, runtime, services, next, `Removed the rule ${pattern}.`);
        }
        break;
      }
      default:
        break;
    }
  }
}

function upsertExactOverride(
  settings: PromptsmithSettings,
  modelRef: ModelRef,
  family: PromptsmithFamily
): PromptsmithSettings {
  return {
    ...settings,
    exactModelOverrides: [
      ...settings.exactModelOverrides.filter(
        (entry) => !(entry.provider === modelRef.provider && entry.id === modelRef.id)
      ),
      { ...modelRef, family },
    ],
  };
}

function updateFamilyEnhancerModel(
  settings: PromptsmithSettings,
  family: PromptsmithFamily,
  modelRef: ModelRef | undefined
): PromptsmithSettings {
  const current = settings.familyEnhancerModels ?? {};
  const nextFamilyModels = {
    ...(current.gpt ? { gpt: current.gpt } : {}),
    ...(current.claude ? { claude: current.claude } : {}),
    ...(family === "gpt" && modelRef ? { gpt: modelRef } : {}),
    ...(family === "claude" && modelRef ? { claude: modelRef } : {}),
  };

  if (family === "gpt" && !modelRef) {
    delete nextFamilyModels.gpt;
  }
  if (family === "claude" && !modelRef) {
    delete nextFamilyModels.claude;
  }

  return Object.keys(nextFamilyModels).length > 0
    ? { ...settings, familyEnhancerModels: nextFamilyModels }
    : removeFamilyEnhancerModels(settings);
}

function removeFixedEnhancerModel(settings: PromptsmithSettings): PromptsmithSettings {
  const next = { ...settings };
  delete next.fixedEnhancerModel;
  return next;
}

function removeFamilyEnhancerModels(settings: PromptsmithSettings): PromptsmithSettings {
  const next = { ...settings };
  delete next.familyEnhancerModels;
  return next;
}

async function chooseModelRef(
  ctx: ExtensionContext,
  title: string
): Promise<ModelRef | null | undefined> {
  const models = ctx.modelRegistry
    .getAll()
    .slice()
    .sort((left, right) =>
      `${left.provider}/${left.id}`.localeCompare(`${right.provider}/${right.id}`)
    );

  const selection = await openSelectDialog(ctx, {
    title,
    items: [
      { value: "Clear", label: "Clear", description: "Remove the saved model selection" },
      { value: "Manual entry", label: "Manual entry", description: "Type provider/model-id" },
      ...models.map((model) => {
        const description = buildModelDescription(ctx, model);
        return {
          value: formatModel(model),
          label: formatModel(model),
          ...(description ? { description } : {}),
        };
      }),
    ],
    pageSize: 8,
    searchable: true,
    emptyLabel: "  No matching models",
  });

  if (!selection) {
    return undefined;
  }
  if (selection === "Clear") {
    return null;
  }
  if (selection === "Manual entry") {
    const raw = await ctx.ui.input(title, "provider/model-id");
    if (!raw?.trim()) {
      return undefined;
    }

    const modelRef = parseModelRef(raw);
    if (!modelRef) {
      ctx.ui.notify("Model must use provider/model-id.", "error");
      return undefined;
    }

    return modelRef;
  }

  return parseModelRef(selection);
}

async function selectFamily(
  ctx: ExtensionContext,
  title: string
): Promise<PromptsmithFamily | undefined> {
  const selection = await selectOption(ctx, title, FAMILY_OPTIONS);
  if (selection?.startsWith("gpt")) {
    return "gpt";
  }
  if (selection?.startsWith("claude")) {
    return "claude";
  }
  return undefined;
}

async function selectOption(
  ctx: ExtensionContext,
  title: string,
  options: readonly string[] | SelectDialogItem[],
  initialValue?: string
): Promise<string | undefined> {
  const items: SelectDialogItem[] = options.map((option) =>
    typeof option === "string" ? { value: option, label: option } : option
  );
  return openSelectDialog(ctx, {
    title,
    items,
    ...(initialValue ? { initialValue } : {}),
    pageSize: 10,
    searchable: items.length > 8,
    emptyLabel: "  No matching options",
  });
}

function buildModelDescription(ctx: ExtensionContext, model: Model<Api>): string | undefined {
  const tags: string[] = [];
  if (ctx.model?.provider === model.provider && ctx.model.id === model.id) {
    tags.push("currently selected in Pi");
  }
  if (model.reasoning) {
    tags.push("reasoning");
  }
  if (model.contextWindow) {
    tags.push(`${Math.floor(model.contextWindow / 1_000)}k ctx`);
  }
  return tags.length > 0 ? tags.join(" · ") : undefined;
}

function formatModel(model: Model<Api>): string {
  return `${model.provider}/${model.id}`;
}
