import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import {
  DEFAULT_ENHANCEMENT_TIMEOUT_MS,
  DEFAULT_SETTINGS,
  MAX_ENHANCEMENT_TIMEOUT_MS,
  MIN_ENHANCEMENT_TIMEOUT_MS,
} from "./constants.js";
import { normalize } from "./model-routing.js";
import { validateShortcutKey } from "./shortcut-key.js";
import {
  type ExactModelOverride,
  type FamilyEnhancerModels,
  type FamilyOverride,
  type ModelRef,
  type PromptsmithDraftResolution,
  type PromptsmithEnhancementAttempt,
  type PromptsmithSettings,
} from "./types.js";
import { UndoManager } from "./undo.js";

export class PromptsmithRuntimeState {
  private settings: PromptsmithSettings = cloneSettings(DEFAULT_SETTINGS);
  private busy = false;
  private lastDraftResolution: PromptsmithDraftResolution | undefined;
  private lastEnhancementAttempt: PromptsmithEnhancementAttempt | undefined;
  readonly undo = new UndoManager();

  constructor(private readonly settingsPath = getGlobalSettingsPath()) {}

  getSettings(): PromptsmithSettings {
    return cloneSettings(this.settings);
  }

  replaceSettings(settings: PromptsmithSettings): void {
    this.settings = cloneSettings(settings);
    this.lastDraftResolution = undefined;
  }

  persistSettings(settings: PromptsmithSettings): void {
    const nextSettings = cloneSettings(settings);
    writeSettingsToDisk(this.settingsPath, nextSettings);
    this.replaceSettings(nextSettings);
  }

  /** Reloads the saved settings. Returns a warning when the file exists but is unusable. */
  restoreSettings(): string | undefined {
    const restored = readSettingsFromDisk(this.settingsPath);
    this.replaceSettings(restored.settings ?? cloneSettings(DEFAULT_SETTINGS));
    this.busy = false;
    this.lastEnhancementAttempt = undefined;
    this.undo.clear();
    return restored.warning;
  }

  getLastDraftResolution(): PromptsmithDraftResolution | undefined {
    return this.lastDraftResolution ? { ...this.lastDraftResolution } : undefined;
  }

  rememberDraftResolution(resolution: PromptsmithDraftResolution): void {
    this.lastDraftResolution = { ...resolution };
  }

  getLastEnhancementAttempt(): PromptsmithEnhancementAttempt | undefined {
    return this.lastEnhancementAttempt
      ? {
          ...this.lastEnhancementAttempt,
          ...(this.lastEnhancementAttempt.enhancerModel
            ? { enhancerModel: { ...this.lastEnhancementAttempt.enhancerModel } }
            : {}),
        }
      : undefined;
  }

  rememberEnhancementAttempt(attempt: PromptsmithEnhancementAttempt): void {
    this.lastEnhancementAttempt = {
      ...attempt,
      ...(attempt.enhancerModel ? { enhancerModel: { ...attempt.enhancerModel } } : {}),
    };
  }

  isBusy(): boolean {
    return this.busy;
  }

  tryStartEnhancement(): boolean {
    if (this.busy) return false;
    this.busy = true;
    return true;
  }

  finishEnhancement(): void {
    this.busy = false;
  }
}

// getAgentDir() honors PI_CODING_AGENT_DIR; it is ~/.pi/agent by default.
export function getGlobalSettingsPath(): string {
  return join(getAgentDir(), "promptsmith-settings.json");
}

function readSettingsFromDisk(path: string): {
  settings?: PromptsmithSettings;
  warning?: string;
} {
  const fallback = "Promptsmith is using its default settings until you save one.";
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") {
      return {};
    }
    return { warning: `Promptsmith could not read ${path}: ${describeError(error)}. ${fallback}` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return { warning: `Promptsmith could not parse ${path}: ${describeError(error)}. ${fallback}` };
  }

  const settings = sanitizeSettings(parsed);
  return settings
    ? { settings }
    : {
        warning: `Promptsmith does not recognize the settings in ${path} (expected version ${DEFAULT_SETTINGS.version}). ${fallback}`,
      };
}

export function sanitizeSettings(value: unknown): PromptsmithSettings | undefined {
  if (!isRecord(value)) return undefined;
  if (value.version !== DEFAULT_SETTINGS.version) return undefined;

  const fixedEnhancerModel = sanitizeModelRef(value.fixedEnhancerModel);
  const familyEnhancerModels = sanitizeFamilyEnhancerModels(value.familyEnhancerModels);

  return {
    version: DEFAULT_SETTINGS.version,
    enabled: readBoolean(value.enabled, DEFAULT_SETTINGS.enabled),
    shortcutEnabled: readBoolean(value.shortcutEnabled, DEFAULT_SETTINGS.shortcutEnabled),
    shortcutKey: readShortcutKey(value.shortcutKey),
    targetFamilyMode: readTargetFamilyMode(value.targetFamilyMode),
    fallbackFamily: readFamily(value.fallbackFamily, DEFAULT_SETTINGS.fallbackFamily),
    exactModelOverrides: sanitizeExactOverrides(value.exactModelOverrides),
    familyOverrides: sanitizeFamilyOverrides(value.familyOverrides),
    enhancerModelMode: readEnhancerModelMode(value.enhancerModelMode),
    ...(fixedEnhancerModel ? { fixedEnhancerModel } : {}),
    ...(familyEnhancerModels ? { familyEnhancerModels } : {}),
    includeRecentConversation: readBoolean(
      value.includeRecentConversation,
      DEFAULT_SETTINGS.includeRecentConversation
    ),
    includeProjectMetadata: readBoolean(
      value.includeProjectMetadata,
      DEFAULT_SETTINGS.includeProjectMetadata
    ),
    statusBarEnabled: readBoolean(value.statusBarEnabled, DEFAULT_SETTINGS.statusBarEnabled),
    rewriteStrength: readRewriteStrength(value.rewriteStrength),
    rewriteMode: readRewriteMode(value.rewriteMode),
    previewBeforeReplace: readBoolean(
      value.previewBeforeReplace,
      DEFAULT_SETTINGS.previewBeforeReplace
    ),
    autoSendEnhancedPrompt: readBoolean(
      value.autoSendEnhancedPrompt,
      DEFAULT_SETTINGS.autoSendEnhancedPrompt
    ),
    autoSendBusyBehavior: readAutoSendBusyBehavior(value.autoSendBusyBehavior),
    preserveCodeBlocks: readBoolean(value.preserveCodeBlocks, DEFAULT_SETTINGS.preserveCodeBlocks),
    enhancementTimeoutMs: readEnhancementTimeoutMs(value.enhancementTimeoutMs),
  };
}

export function cloneSettings(settings: PromptsmithSettings): PromptsmithSettings {
  return {
    ...settings,
    exactModelOverrides: settings.exactModelOverrides.map((entry) => ({ ...entry })),
    familyOverrides: settings.familyOverrides.map((entry) => ({ ...entry })),
    ...(settings.fixedEnhancerModel
      ? { fixedEnhancerModel: { ...settings.fixedEnhancerModel } }
      : {}),
    ...(settings.familyEnhancerModels
      ? {
          familyEnhancerModels: {
            ...(settings.familyEnhancerModels.gpt
              ? { gpt: { ...settings.familyEnhancerModels.gpt } }
              : {}),
            ...(settings.familyEnhancerModels.claude
              ? { claude: { ...settings.familyEnhancerModels.claude } }
              : {}),
          },
        }
      : {}),
  };
}

// Write a sibling temp file and rename it over the settings file, so a crash or a
// full disk mid-write cannot leave a truncated file behind.
function writeSettingsToDisk(path: string, settings: PromptsmithSettings): void {
  mkdirSync(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(tempPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
    renameSync(tempPath, path);
  } catch (error) {
    rmSync(tempPath, { force: true });
    throw error;
  }
}

function sanitizeExactOverrides(value: unknown): ExactModelOverride[] {
  if (!Array.isArray(value)) return [];
  const exactOverrides = value.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const ref = sanitizeModelRef(entry);
    const family = readFamily(entry.family, undefined);
    return ref && family ? [{ ...ref, family }] : [];
  });
  return dedupeExactOverrides(exactOverrides);
}

function sanitizeFamilyOverrides(value: unknown): FamilyOverride[] {
  if (!Array.isArray(value)) return [];
  const familyOverrides = value.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const family = readFamily(entry.family, undefined);
    const pattern = typeof entry.pattern === "string" ? entry.pattern.trim() : "";
    return family && pattern ? [{ pattern, family }] : [];
  });
  return dedupeFamilyOverrides(familyOverrides);
}

function sanitizeModelRef(value: unknown): ModelRef | undefined {
  if (!isRecord(value)) return undefined;
  const provider = typeof value.provider === "string" ? value.provider.trim() : "";
  const id = typeof value.id === "string" ? value.id.trim() : "";
  if (!provider || !id) return undefined;
  return { provider, id };
}

function dedupeExactOverrides(overrides: ExactModelOverride[]): ExactModelOverride[] {
  const seen = new Set<string>();
  const deduped: ExactModelOverride[] = [];

  for (const entry of [...overrides].reverse()) {
    const key = `${normalize(entry.provider)}/${normalize(entry.id)}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.unshift(entry);
  }

  return deduped;
}

function dedupeFamilyOverrides(overrides: FamilyOverride[]): FamilyOverride[] {
  const seen = new Set<string>();
  const deduped: FamilyOverride[] = [];

  for (const entry of [...overrides].reverse()) {
    const key = normalize(entry.pattern);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.unshift(entry);
  }

  return deduped;
}

function sanitizeFamilyEnhancerModels(value: unknown): FamilyEnhancerModels | undefined {
  if (!isRecord(value)) return undefined;
  const gpt = sanitizeModelRef(value.gpt);
  const claude = sanitizeModelRef(value.claude);
  if (!gpt && !claude) return undefined;
  return {
    ...(gpt ? { gpt } : {}),
    ...(claude ? { claude } : {}),
  };
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readFamily<TFallback extends string | undefined>(
  value: unknown,
  fallback: TFallback
): "gpt" | "claude" | TFallback {
  return value === "gpt" || value === "claude" ? value : fallback;
}

function readShortcutKey(value: unknown): string {
  if (typeof value !== "string") {
    return DEFAULT_SETTINGS.shortcutKey;
  }

  return validateShortcutKey(value).normalized ?? DEFAULT_SETTINGS.shortcutKey;
}

function readTargetFamilyMode(value: unknown): PromptsmithSettings["targetFamilyMode"] {
  return value === "auto" || value === "gpt" || value === "claude"
    ? value
    : DEFAULT_SETTINGS.targetFamilyMode;
}

function readEnhancerModelMode(value: unknown): PromptsmithSettings["enhancerModelMode"] {
  return value === "active" || value === "fixed" || value === "family-linked"
    ? value
    : DEFAULT_SETTINGS.enhancerModelMode;
}

function readRewriteStrength(value: unknown): PromptsmithSettings["rewriteStrength"] {
  return value === "light" || value === "balanced" || value === "strong"
    ? value
    : DEFAULT_SETTINGS.rewriteStrength;
}

function readRewriteMode(value: unknown): PromptsmithSettings["rewriteMode"] {
  return value === "auto" || value === "plain" || value === "execution-contract"
    ? value
    : DEFAULT_SETTINGS.rewriteMode;
}

function readAutoSendBusyBehavior(value: unknown): PromptsmithSettings["autoSendBusyBehavior"] {
  return value === "steer" || value === "followUp" ? value : DEFAULT_SETTINGS.autoSendBusyBehavior;
}

function readEnhancementTimeoutMs(value: unknown): number {
  if (!Number.isInteger(value)) {
    return DEFAULT_ENHANCEMENT_TIMEOUT_MS;
  }

  const timeoutMs = Number(value);
  if (timeoutMs < MIN_ENHANCEMENT_TIMEOUT_MS || timeoutMs > MAX_ENHANCEMENT_TIMEOUT_MS) {
    return DEFAULT_ENHANCEMENT_TIMEOUT_MS;
  }

  return timeoutMs;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
