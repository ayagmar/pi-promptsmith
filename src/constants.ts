import type { PromptsmithSettings } from "./types.js";

export const EXTENSION_NAME = "pi-promptsmith";
export const EXTENSION_COMMAND = "promptsmith";
// Avoid Pi built-ins and common extension collisions.
export const DEFAULT_SHORTCUT_KEY = "alt+p";

export const SETTINGS_VERSION = 1;
export const SENTINEL_OPEN = "<promptsmith-enhanced-prompt>";
export const SENTINEL_CLOSE = "</promptsmith-enhanced-prompt>";

export const MAX_STATUS_MODEL_ID_LENGTH = 28;
export const ESTIMATED_FIXED_PROMPT_OVERHEAD_TOKENS = 1_200;
export const MAX_PROJECT_METADATA_TOKENS = 80;
export const MAX_RECENT_CONVERSATION_TOKENS = 800;
export const MAX_CONVERSATION_MESSAGES = 4;
export const DEFAULT_OUTPUT_RESERVE_TOKENS = 1_024;
export const MAX_OUTPUT_RESERVE_TOKENS = 2_048;
export const ENHANCER_MAX_OUTPUT_TOKENS = 1_200;
export const MIN_ENHANCEMENT_TIMEOUT_MS = 5_000;
export const DEFAULT_ENHANCEMENT_TIMEOUT_MS = 45_000;
export const MAX_ENHANCEMENT_TIMEOUT_MS = 300_000;

export const DEFAULT_SETTINGS: PromptsmithSettings = {
  version: SETTINGS_VERSION,
  enabled: true,
  shortcutEnabled: true,
  shortcutKey: DEFAULT_SHORTCUT_KEY,
  targetFamilyMode: "auto",
  fallbackFamily: "gpt",
  exactModelOverrides: [],
  familyOverrides: [],
  enhancerModelMode: "active",
  includeRecentConversation: false,
  includeProjectMetadata: false,
  statusBarEnabled: false,
  rewriteStrength: "balanced",
  rewriteMode: "auto",
  previewBeforeReplace: false,
  preserveCodeBlocks: true,
  enhancementTimeoutMs: DEFAULT_ENHANCEMENT_TIMEOUT_MS,
};

export const HELP_LINES = [
  `/${EXTENSION_COMMAND}`,
  `/${EXTENSION_COMMAND} undo`,
  `/${EXTENSION_COMMAND} status`,
  `/${EXTENSION_COMMAND} settings`,
  `/${EXTENSION_COMMAND} reset-settings`,
  `/${EXTENSION_COMMAND} enable|disable`,
  `/${EXTENSION_COMMAND} family auto|gpt|claude`,
  `/${EXTENSION_COMMAND} mode auto|plain|execution-contract`,
  `/${EXTENSION_COMMAND} enhancer-model active`,
  `/${EXTENSION_COMMAND} enhancer-model fixed <provider>/<id>`,
  `/${EXTENSION_COMMAND} enhancer-model family-linked <gpt-provider>/<gpt-id> <claude-provider>/<claude-id>`,
  `/${EXTENSION_COMMAND} map active <gpt|claude>`,
  `/${EXTENSION_COMMAND} map set <provider>/<id> <gpt|claude>`,
  `/${EXTENSION_COMMAND} map add <pattern> <gpt|claude>`,
  `/${EXTENSION_COMMAND} map remove <pattern>`,
  `/${EXTENSION_COMMAND} conversation on|off`,
  `/${EXTENSION_COMMAND} project-metadata on|off`,
  `/${EXTENSION_COMMAND} status-bar on|off`,
  `/${EXTENSION_COMMAND} strength light|balanced|strong`,
  `/${EXTENSION_COMMAND} preview on|off`,
  `/${EXTENSION_COMMAND} preserve-code on|off`,
  `/${EXTENSION_COMMAND} timeout <seconds>`,
].join("\n");
