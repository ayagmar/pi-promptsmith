import type { Api, Context, Model } from "@mariozechner/pi-ai";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

export type PromptsmithFamily = "gpt" | "claude";
export type PromptsmithTargetFamilyMode = "auto" | PromptsmithFamily;
export type PromptsmithEnhancerModelMode = "active" | "fixed" | "family-linked";
export type PromptsmithRewriteStrength = "light" | "balanced" | "strong";
export type PromptsmithRewriteMode = "auto" | "plain" | "execution-contract";
export type PromptsmithEffectiveRewriteMode = Exclude<PromptsmithRewriteMode, "auto">;
export type PromptsmithTaskIntent =
  | "implement"
  | "debug"
  | "refactor"
  | "review"
  | "research"
  | "docs"
  | "test-fix"
  | "explain"
  | "general";

export interface ModelRef {
  provider: string;
  id: string;
}

export interface ExactModelOverride extends ModelRef {
  family: PromptsmithFamily;
}

export interface FamilyOverride {
  pattern: string;
  family: PromptsmithFamily;
}

export interface FamilyEnhancerModels {
  gpt?: ModelRef;
  claude?: ModelRef;
}

export interface PromptsmithSettings {
  version: 1;
  enabled: boolean;
  shortcutEnabled: boolean;
  shortcutKey: string;
  targetFamilyMode: PromptsmithTargetFamilyMode;
  fallbackFamily: PromptsmithFamily;
  exactModelOverrides: ExactModelOverride[];
  familyOverrides: FamilyOverride[];
  enhancerModelMode: PromptsmithEnhancerModelMode;
  fixedEnhancerModel?: ModelRef;
  familyEnhancerModels?: FamilyEnhancerModels;
  includeRecentConversation: boolean;
  includeProjectMetadata: boolean;
  statusBarEnabled: boolean;
  rewriteStrength: PromptsmithRewriteStrength;
  rewriteMode: PromptsmithRewriteMode;
  previewBeforeReplace: boolean;
  preserveCodeBlocks: boolean;
  enhancementTimeoutMs: number;
}

export interface ResolvedTargetFamily {
  family: PromptsmithFamily;
  source: "forced" | "exact-override" | "pattern-override" | "builtin" | "fallback";
  matchedRule?: string;
}

export interface ResolvedEnhancerModel {
  mode: PromptsmithEnhancerModelMode;
  family: PromptsmithFamily;
  model: Model<Api>;
  apiKey: string;
  label: string;
}

export interface ConversationExcerpt {
  role: "user" | "assistant";
  text: string;
  tokens: number;
  timestamp: number;
}

export interface ProjectMetadata {
  cwd: string;
  gitBranch?: string;
}

export interface PromptsmithContextPayload {
  draft: string;
  activeModel?: ModelRef;
  targetFamily: PromptsmithFamily;
  rewriteStrength: PromptsmithRewriteStrength;
  configuredRewriteMode: PromptsmithRewriteMode;
  effectiveRewriteMode: PromptsmithEffectiveRewriteMode;
  intent: PromptsmithTaskIntent;
  preserveCodeBlocks: boolean;
  recentConversation: ConversationExcerpt[];
  projectMetadata?: ProjectMetadata;
  droppedContext: string[];
}

export interface EnhancementPreparation {
  resolvedTargetFamily: ResolvedTargetFamily;
  enhancerModel: ResolvedEnhancerModel;
  promptContext: PromptsmithContextPayload;
  request: Context;
}

export interface PromptsmithDraftResolution {
  intent: PromptsmithTaskIntent;
  effectiveRewriteMode: PromptsmithEffectiveRewriteMode;
}

export interface PromptsmithStatusSnapshot {
  settings: PromptsmithSettings;
  activeModel?: ModelRef;
  resolvedTargetFamily?: ResolvedTargetFamily;
  enhancerModeLabel: string;
  busy: boolean;
  undoAvailable: boolean;
  currentDraftResolution?: PromptsmithDraftResolution;
  lastDraftResolution?: PromptsmithDraftResolution;
}

export interface PromptsmithRuntimeSupport {
  interactiveTui: boolean;
  reason?: string;
}

export interface ParsedPromptsmithCommand {
  name: string;
  args: string[];
}

export interface BuildPromptContextOptions {
  ctx: ExtensionContext;
  draft: string;
  settings: PromptsmithSettings;
  activeModel: Model<Api> | undefined;
  targetFamily: PromptsmithFamily;
  enhancerModel: Model<Api>;
  exec: (
    command: string,
    args: string[]
  ) => Promise<{ stdout: string; stderr: string; code: number }>;
}
