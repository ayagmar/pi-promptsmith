import type { Api, Model } from "@mariozechner/pi-ai";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { DEFAULT_SETTINGS } from "../constants.js";
import {
  clearFamilyEnhancerModel,
  clearFixedEnhancerModel,
  setActiveEnhancerModelMode,
  setFamilyEnhancerModel,
  setFixedEnhancerModel,
} from "../enhancer-settings.js";
import { parseModelRef } from "../model-selection.js";
import { normalize } from "../model-routing.js";
import {
  removeExactModelOverride,
  removeFamilyOverride,
  upsertExactModelOverride,
  upsertFamilyOverride,
} from "../overrides.js";
import { cloneSettings } from "../state.js";
import type { PromptsmithRuntimeState } from "../state.js";
import { DEFAULT_SHORTCUT_KEY } from "../constants.js";
import { formatShortcutKey, isDefaultShortcutConfigured } from "../shortcut-key.js";
import type { ModelRef, PromptsmithFamily, PromptsmithSettings } from "../types.js";
import { parseEnhancementTimeoutSeconds } from "../validation.js";
import { openSelectDialog, type SelectDialogItem } from "./select-dialog.js";
import { captureShortcutKey } from "./shortcut-capture.js";
import {
  AUTO_SEND_BUSY_BEHAVIOR_OPTIONS,
  describeSelectedAutoSendBusyBehavior,
  describeSelectedEnhancerMode,
  describeSelectedRewriteMode,
  describeSelectedStrength,
  describeSelectedTargetFamilyMode,
  ENHANCER_MODEL_OPTIONS,
  FAMILY_OPTIONS,
  formatTimeoutSeconds,
  parseLabeledAutoSendBusyBehavior,
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
}

type SettingsChange = PromptsmithSettings | ((current: PromptsmithSettings) => PromptsmithSettings);

type SettingsMessage = string | ((next: PromptsmithSettings) => string);

export async function runSettingsAction(
  choice: Exclude<SettingsMenuOptionId, "done">,
  options: SettingsActionContext
): Promise<void> {
  const { ctx, runtime, services } = options;
  const settings = runtime.getSettings();

  switch (choice) {
    case "enabled":
      persistSettings(
        ctx,
        runtime,
        services,
        (latest) => ({ ...latest, enabled: !latest.enabled }),
        (next) => `Promptsmith is now ${next.enabled ? "on" : "off"}.`
      );
      return;
    case "shortcutEnabled": {
      const shortcutChoice = await selectOption(
        ctx,
        "Keyboard shortcut",
        [
          "Change keybinding",
          `${settings.shortcutEnabled ? "Turn shortcut off" : "Turn shortcut on"}`,
          ...(!isDefaultShortcutConfigured(settings) ? ["Reset to Alt+P"] : []),
          "Back",
        ],
        "Back"
      );

      switch (shortcutChoice) {
        case undefined:
        case "Back":
          return;
        case "Change keybinding": {
          const shortcutKey = await captureShortcutKey(ctx, {
            currentValue: settings.shortcutKey,
          });
          if (!shortcutKey) {
            return;
          }
          persistSettings(
            ctx,
            runtime,
            services,
            (latest) => ({ ...latest, shortcutEnabled: true, shortcutKey }),
            `Keyboard shortcut set to ${formatShortcutKey(shortcutKey)}.`
          );
          return;
        }
        case "Turn shortcut off":
        case "Turn shortcut on":
          persistSettings(
            ctx,
            runtime,
            services,
            (latest) => ({ ...latest, shortcutEnabled: !latest.shortcutEnabled }),
            (next) => `Keyboard shortcut is now ${next.shortcutEnabled ? "on" : "off"}.`
          );
          return;
        case "Reset to Alt+P":
          persistSettings(
            ctx,
            runtime,
            services,
            (latest) => ({ ...latest, shortcutKey: DEFAULT_SHORTCUT_KEY }),
            "Keyboard shortcut reset to Alt+P."
          );
          return;
        default:
          return;
      }
    }
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
          (latest) => ({ ...latest, targetFamilyMode: nextMode }),
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
          (latest) => ({ ...latest, fallbackFamily: family }),
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
          (latest) =>
            nextMode === "active"
              ? setActiveEnhancerModelMode(latest)
              : { ...latest, enhancerModelMode: nextMode },
          `Enhancer model choice set to ${nextMode}.`
        );
      }
      return;
    }
    case "fixedEnhancerModel": {
      const modelRef = await chooseModelRef(ctx, "Choose the fixed enhancer model", {
        allowClear: true,
      });
      if (modelRef === null) {
        persistSettings(
          ctx,
          runtime,
          services,
          (latest) => clearFixedEnhancerModel(latest),
          "Fixed enhancer model cleared."
        );
      } else if (modelRef) {
        persistSettings(
          ctx,
          runtime,
          services,
          (latest) => setFixedEnhancerModel(latest, modelRef),
          `Fixed enhancer model set to ${modelRef.provider}/${modelRef.id}.`
        );
      }
      return;
    }
    case "gptEnhancerModel": {
      const modelRef = await chooseModelRef(ctx, "Choose the model used for GPT-style rewrites", {
        allowClear: true,
      });
      if (modelRef === null) {
        persistSettings(
          ctx,
          runtime,
          services,
          (latest) => clearFamilyEnhancerModel(latest, "gpt"),
          "GPT-style enhancer model cleared."
        );
      } else if (modelRef) {
        persistSettings(
          ctx,
          runtime,
          services,
          (latest) => setFamilyEnhancerModel(latest, "gpt", modelRef),
          `GPT-style enhancer model set to ${modelRef.provider}/${modelRef.id}.`
        );
      }
      return;
    }
    case "claudeEnhancerModel": {
      const modelRef = await chooseModelRef(
        ctx,
        "Choose the model used for Claude-style rewrites",
        {
          allowClear: true,
        }
      );
      if (modelRef === null) {
        persistSettings(
          ctx,
          runtime,
          services,
          (latest) => clearFamilyEnhancerModel(latest, "claude"),
          "Claude-style enhancer model cleared."
        );
      } else if (modelRef) {
        persistSettings(
          ctx,
          runtime,
          services,
          (latest) => setFamilyEnhancerModel(latest, "claude", modelRef),
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
        (latest) => ({
          ...latest,
          includeRecentConversation: !latest.includeRecentConversation,
        }),
        (next) =>
          next.includeRecentConversation
            ? "Recent chat context enabled. Rewrites may be slower but more aware of the thread."
            : "Recent chat context disabled for faster rewrites."
      );
      return;
    case "includeProjectMetadata":
      persistSettings(
        ctx,
        runtime,
        services,
        (latest) => ({ ...latest, includeProjectMetadata: !latest.includeProjectMetadata }),
        (next) => `Project metadata is now ${next.includeProjectMetadata ? "on" : "off"}.`
      );
      return;
    case "statusBarEnabled":
      persistSettings(
        ctx,
        runtime,
        services,
        (latest) => ({ ...latest, statusBarEnabled: !latest.statusBarEnabled }),
        (next) => `Status bar is now ${next.statusBarEnabled ? "on" : "off"}.`
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
        (latest) => ({ ...latest, enhancementTimeoutMs: timeoutMs }),
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
          (latest) => ({ ...latest, rewriteStrength: nextStrength }),
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
          (latest) => ({ ...latest, rewriteMode: nextRewriteMode }),
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
        (latest) => ({ ...latest, previewBeforeReplace: !latest.previewBeforeReplace }),
        (next) => `Review before replace is now ${next.previewBeforeReplace ? "on" : "off"}.`
      );
      return;
    case "autoSendEnhancedPrompt":
      persistSettings(
        ctx,
        runtime,
        services,
        (latest) => ({ ...latest, autoSendEnhancedPrompt: !latest.autoSendEnhancedPrompt }),
        (next) => `Auto-send refined prompt is now ${next.autoSendEnhancedPrompt ? "on" : "off"}.`
      );
      return;
    case "autoSendBusyBehavior": {
      const behavior = await selectOption(
        ctx,
        "Choose auto-send behavior while Pi is busy",
        AUTO_SEND_BUSY_BEHAVIOR_OPTIONS,
        describeSelectedAutoSendBusyBehavior(settings.autoSendBusyBehavior)
      );
      const nextBehavior = parseLabeledAutoSendBusyBehavior(behavior);
      if (nextBehavior) {
        persistSettings(
          ctx,
          runtime,
          services,
          (latest) => ({ ...latest, autoSendBusyBehavior: nextBehavior }),
          `Auto-send while busy now uses ${nextBehavior === "followUp" ? "follow-up" : "steer"}.`
        );
      }
      return;
    }
    case "preserveCodeBlocks":
      persistSettings(
        ctx,
        runtime,
        services,
        (latest) => ({ ...latest, preserveCodeBlocks: !latest.preserveCodeBlocks }),
        (next) => `Code block preservation is now ${next.preserveCodeBlocks ? "on" : "off"}.`
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
  change: SettingsChange,
  message: SettingsMessage
): void {
  const next = typeof change === "function" ? change(runtime.getSettings()) : change;
  const successMessage = typeof message === "function" ? message(next) : message;

  try {
    runtime.persistSettings(next);
    services.refreshStatus(ctx);
    ctx.ui.notify(successMessage, "info");
  } catch (error) {
    services.refreshStatus(ctx);
    const detail = error instanceof Error ? error.message : String(error);
    ctx.ui.notify(`Failed to save Promptsmith settings. ${detail}`, "error");
  }
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
        if (modelRef) {
          const family = await selectFamily(ctx, "Choose the prompt style for this model");
          if (family) {
            persistSettings(
              ctx,
              runtime,
              services,
              (latest) => upsertExactModelOverride(latest, modelRef, family),
              `Mapped ${modelRef.provider}/${modelRef.id} to ${family}.`
            );
          }
        }
        break;
      }
      case "Remove rule": {
        const exactRuleOptions = settings.exactModelOverrides.map((entry) => ({
          label: `${entry.provider}/${entry.id} → ${entry.family}`,
          value: `${entry.provider}/${entry.id}`,
        }));
        const selected = await selectOption(ctx, "Remove exact model style rule", exactRuleOptions);
        if (selected) {
          const selectedEntry = settings.exactModelOverrides.find(
            (entry) => normalize(`${entry.provider}/${entry.id}`) === normalize(selected)
          );
          if (!selectedEntry) {
            break;
          }
          persistSettings(
            ctx,
            runtime,
            services,
            (latest) => removeExactModelOverride(latest, selectedEntry),
            `Removed the rule for ${selected}.`
          );
        }
        break;
      }
      default:
        if (choice?.startsWith("Map active model") && ctx.model) {
          const activeModel = { provider: ctx.model.provider, id: ctx.model.id };
          const family = await selectFamily(ctx, "Choose the prompt style for the active model");
          if (family) {
            persistSettings(
              ctx,
              runtime,
              services,
              (latest) => upsertExactModelOverride(latest, activeModel, family),
              `Mapped ${activeModel.provider}/${activeModel.id} to ${family}.`
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
        persistSettings(
          ctx,
          runtime,
          services,
          (latest) => upsertFamilyOverride(latest, trimmedPattern, family),
          `Pattern ${trimmedPattern} now routes to ${family}.`
        );
        break;
      }
      case "Remove rule": {
        const patternRuleOptions = settings.familyOverrides.map((entry) => ({
          label: `${entry.pattern} → ${entry.family}`,
          value: entry.pattern,
        }));
        const selected = await selectOption(ctx, "Remove pattern style rule", patternRuleOptions);
        if (selected) {
          persistSettings(
            ctx,
            runtime,
            services,
            (latest) => removeFamilyOverride(latest, selected),
            `Removed the rule ${selected}.`
          );
        }
        break;
      }
      default:
        break;
    }
  }
}

async function chooseModelRef(
  ctx: ExtensionContext,
  title: string,
  options?: { allowClear?: boolean }
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
      ...(options?.allowClear
        ? [{ value: "Clear", label: "Clear", description: "Remove the saved model selection" }]
        : []),
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
