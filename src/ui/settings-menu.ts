import type { SelectDialogItem } from "./select-dialog.js";
import { formatShortcutKey } from "../shortcut-key.js";
import type { ModelRef, PromptsmithAutoSendBusyBehavior, PromptsmithSettings } from "../types.js";

export type SettingsMenuOptionId =
  | "enabled"
  | "shortcutEnabled"
  | "statusBarEnabled"
  | "targetFamilyMode"
  | "fallbackFamily"
  | "enhancerModelMode"
  | "fixedEnhancerModel"
  | "gptEnhancerModel"
  | "claudeEnhancerModel"
  | "includeRecentConversation"
  | "includeProjectMetadata"
  | "enhancementTimeoutMs"
  | "rewriteStrength"
  | "rewriteMode"
  | "previewBeforeReplace"
  | "autoSendEnhancedPrompt"
  | "autoSendBusyBehavior"
  | "preserveCodeBlocks"
  | "exactModelOverrides"
  | "familyOverrides"
  | "reset"
  | "done";

export const TARGET_FAMILY_OPTIONS = [
  "auto — match the current model family",
  "gpt — always rewrite in GPT-style",
  "claude — always rewrite in Claude-style",
] as const;

export const ENHANCER_MODEL_OPTIONS = [
  "active — use the currently selected Pi model",
  "fixed — always use one specific model",
  "family-linked — use one model for GPT-style and another for Claude-style",
] as const;

export const REWRITE_STRENGTH_OPTIONS = [
  "light — small cleanup, fastest",
  "balanced — default trade-off",
  "strong — more restructuring",
] as const;

export const REWRITE_MODE_OPTIONS = [
  "auto — infer task vs plain rewrite",
  "plain — plain prompt rewrite",
  "execution-contract — execution contract",
] as const;

export const AUTO_SEND_BUSY_BEHAVIOR_OPTIONS = [
  "steer — send after the current tool batch",
  "follow-up — wait until Pi becomes idle",
] as const;

export const FAMILY_OPTIONS = [
  "gpt — direct, concise, sectioned",
  "claude — explicit, strongly structured, XML-friendly",
] as const;

export function buildSettingsMenuOptions(
  settings: PromptsmithSettings
): Partial<Record<SettingsMenuOptionId, SelectDialogItem>> {
  return {
    enabled: createSettingsMenuItem(
      "enabled",
      "Prompt enhancement",
      onOff(settings.enabled),
      "Master switch for /promptsmith and the keyboard shortcut."
    ),
    shortcutEnabled: createSettingsMenuItem(
      "shortcutEnabled",
      "Keyboard shortcut",
      `${onOff(settings.shortcutEnabled)} · ${formatShortcutKey(settings.shortcutKey)}`,
      "Run Promptsmith directly from the editor. Change the key combo or turn it off."
    ),
    statusBarEnabled: createSettingsMenuItem(
      "statusBarEnabled",
      "Footer status bar",
      onOff(settings.statusBarEnabled),
      "Show compact live Promptsmith status in the footer."
    ),
    targetFamilyMode: createSettingsMenuItem(
      "targetFamilyMode",
      "Prompt style target",
      describeTargetFamilyMode(settings),
      "Choose GPT-style versus Claude-style output."
    ),
    fallbackFamily: createSettingsMenuItem(
      "fallbackFamily",
      "Unknown-model default style",
      settings.fallbackFamily.toUpperCase(),
      "Used when auto routing has no matching model rule."
    ),
    enhancerModelMode: createSettingsMenuItem(
      "enhancerModelMode",
      "Enhancer model choice",
      describeEnhancerMode(settings),
      "Choose which model performs the rewrite."
    ),
    fixedEnhancerModel: createSettingsMenuItem(
      "fixedEnhancerModel",
      "Fixed enhancer model",
      formatModelRef(settings.fixedEnhancerModel),
      "Used only when enhancer model choice is set to fixed."
    ),
    gptEnhancerModel: createSettingsMenuItem(
      "gptEnhancerModel",
      "GPT-style enhancer model",
      formatModelRef(settings.familyEnhancerModels?.gpt),
      "Used only when enhancer model choice is family-linked."
    ),
    claudeEnhancerModel: createSettingsMenuItem(
      "claudeEnhancerModel",
      "Claude-style enhancer model",
      formatModelRef(settings.familyEnhancerModels?.claude),
      "Used only when enhancer model choice is family-linked."
    ),
    includeRecentConversation: createSettingsMenuItem(
      "includeRecentConversation",
      "Recent chat context",
      onOff(settings.includeRecentConversation),
      "More thread-aware rewrites, but usually slower."
    ),
    includeProjectMetadata: createSettingsMenuItem(
      "includeProjectMetadata",
      "Project metadata",
      onOff(settings.includeProjectMetadata),
      "Include cwd and git branch when available."
    ),
    enhancementTimeoutMs: createSettingsMenuItem(
      "enhancementTimeoutMs",
      "Enhancement timeout",
      formatTimeoutSeconds(settings.enhancementTimeoutMs),
      "Abort slow rewrites automatically."
    ),
    rewriteStrength: createSettingsMenuItem(
      "rewriteStrength",
      "Rewrite strength",
      capitalize(settings.rewriteStrength),
      "How aggressively Promptsmith rewrites the draft."
    ),
    rewriteMode: createSettingsMenuItem(
      "rewriteMode",
      "Rewrite mode",
      describeRewriteMode(settings),
      "Choose plain rewrite versus execution-contract output."
    ),
    previewBeforeReplace: createSettingsMenuItem(
      "previewBeforeReplace",
      "Review before replacing editor",
      onOff(settings.previewBeforeReplace),
      "Open a review step before overwriting the current draft."
    ),
    autoSendEnhancedPrompt: createSettingsMenuItem(
      "autoSendEnhancedPrompt",
      "Auto-send refined prompt",
      onOff(settings.autoSendEnhancedPrompt),
      "After refinement, submit the final prompt immediately instead of leaving it in the editor."
    ),
    ...(settings.autoSendEnhancedPrompt
      ? {
          autoSendBusyBehavior: createSettingsMenuItem(
            "autoSendBusyBehavior",
            "Auto-send while busy",
            describeAutoSendBusyBehavior(settings.autoSendBusyBehavior),
            "When Pi is already running, choose whether the refined prompt interrupts next or waits as a follow-up."
          ),
        }
      : {}),
    preserveCodeBlocks: createSettingsMenuItem(
      "preserveCodeBlocks",
      "Keep code blocks unchanged",
      onOff(settings.preserveCodeBlocks),
      "Preserve fenced code blocks when possible."
    ),
    exactModelOverrides: createSettingsMenuItem(
      "exactModelOverrides",
      "Exact model style rules",
      String(settings.exactModelOverrides.length),
      "Route specific models to GPT or Claude style."
    ),
    familyOverrides: createSettingsMenuItem(
      "familyOverrides",
      "Pattern style rules",
      String(settings.familyOverrides.length),
      "Route model patterns like openai/* or kimi-*."
    ),
    reset: {
      value: "reset",
      label: "Reset saved settings",
      description: "Restore Promptsmith settings to defaults.",
    },
    done: {
      value: "done",
      label: "Done",
      description: "Close Promptsmith settings.",
    },
  };
}

export function describeSelectedTargetFamilyMode(
  value: PromptsmithSettings["targetFamilyMode"]
): string | undefined {
  switch (value) {
    case "auto":
      return TARGET_FAMILY_OPTIONS[0];
    case "gpt":
      return TARGET_FAMILY_OPTIONS[1];
    case "claude":
      return TARGET_FAMILY_OPTIONS[2];
  }
}

export function describeSelectedEnhancerMode(
  value: PromptsmithSettings["enhancerModelMode"]
): string | undefined {
  switch (value) {
    case "active":
      return ENHANCER_MODEL_OPTIONS[0];
    case "fixed":
      return ENHANCER_MODEL_OPTIONS[1];
    case "family-linked":
      return ENHANCER_MODEL_OPTIONS[2];
  }
}

export function describeSelectedStrength(
  value: PromptsmithSettings["rewriteStrength"]
): string | undefined {
  switch (value) {
    case "light":
      return REWRITE_STRENGTH_OPTIONS[0];
    case "balanced":
      return REWRITE_STRENGTH_OPTIONS[1];
    case "strong":
      return REWRITE_STRENGTH_OPTIONS[2];
  }
}

export function describeSelectedRewriteMode(
  value: PromptsmithSettings["rewriteMode"]
): string | undefined {
  switch (value) {
    case "auto":
      return REWRITE_MODE_OPTIONS[0];
    case "plain":
      return REWRITE_MODE_OPTIONS[1];
    case "execution-contract":
      return REWRITE_MODE_OPTIONS[2];
  }
}

export function describeSelectedAutoSendBusyBehavior(
  value: PromptsmithAutoSendBusyBehavior
): string | undefined {
  switch (value) {
    case "steer":
      return AUTO_SEND_BUSY_BEHAVIOR_OPTIONS[0];
    case "followUp":
      return AUTO_SEND_BUSY_BEHAVIOR_OPTIONS[1];
  }
}

export function parseLabeledTargetFamilyMode(
  value: string | undefined
): PromptsmithSettings["targetFamilyMode"] | undefined {
  if (value?.startsWith("auto")) return "auto";
  if (value?.startsWith("gpt")) return "gpt";
  if (value?.startsWith("claude")) return "claude";
  return undefined;
}

export function parseLabeledEnhancerMode(
  value: string | undefined
): PromptsmithSettings["enhancerModelMode"] | undefined {
  if (value?.startsWith("active")) return "active";
  if (value?.startsWith("fixed")) return "fixed";
  if (value?.startsWith("family-linked")) return "family-linked";
  return undefined;
}

export function parseLabeledStrength(
  value: string | undefined
): PromptsmithSettings["rewriteStrength"] | undefined {
  if (value?.startsWith("light")) return "light";
  if (value?.startsWith("balanced")) return "balanced";
  if (value?.startsWith("strong")) return "strong";
  return undefined;
}

export function parseLabeledRewriteMode(
  value: string | undefined
): PromptsmithSettings["rewriteMode"] | undefined {
  if (value?.startsWith("auto")) return "auto";
  if (value?.startsWith("plain")) return "plain";
  if (value?.startsWith("execution-contract")) return "execution-contract";
  return undefined;
}

export function parseLabeledAutoSendBusyBehavior(
  value: string | undefined
): PromptsmithAutoSendBusyBehavior | undefined {
  if (value?.startsWith("steer")) return "steer";
  if (value?.startsWith("follow-up")) return "followUp";
  return undefined;
}

function createSettingsMenuItem(
  value: SettingsMenuOptionId,
  label: string,
  currentValue: string,
  description: string
): SelectDialogItem {
  return {
    value,
    label: `${label} · ${currentValue}`,
    description,
  };
}

function formatModelRef(modelRef: ModelRef | undefined): string {
  return modelRef ? `${modelRef.provider}/${modelRef.id}` : "Unset";
}

function onOff(value: boolean): string {
  return value ? "On" : "Off";
}

function capitalize(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

export function formatTimeoutSeconds(timeoutMs: number): string {
  return `${Math.floor(timeoutMs / 1_000)}s`;
}

function describeTargetFamilyMode(settings: PromptsmithSettings): string {
  switch (settings.targetFamilyMode) {
    case "auto":
      return "Auto (match current model)";
    case "gpt":
      return "Force GPT-style";
    case "claude":
      return "Force Claude-style";
  }
}

function describeEnhancerMode(settings: PromptsmithSettings): string {
  switch (settings.enhancerModelMode) {
    case "active":
      return "Active model";
    case "fixed":
      return "Fixed model";
    case "family-linked":
      return "Family-linked models";
  }
}

function describeRewriteMode(settings: PromptsmithSettings): string {
  switch (settings.rewriteMode) {
    case "auto":
      return "Auto (infer task vs plain rewrite)";
    case "plain":
      return "Plain prompt rewrite";
    case "execution-contract":
      return "Execution contract";
  }
}

function describeAutoSendBusyBehavior(value: PromptsmithAutoSendBusyBehavior): string {
  return value === "followUp" ? "Follow-up" : "Steer";
}
