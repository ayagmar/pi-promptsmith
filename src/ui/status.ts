import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { EXTENSION_COMMAND, EXTENSION_NAME, MAX_STATUS_MODEL_ID_LENGTH } from "../constants.js";
import { formatShortcutKey } from "../shortcut-key.js";
import { buildEnhancerModeLabel } from "../enhance.js";
import { analyzeDraftIntent } from "../intent.js";
import { describeResolvedFamily, resolveTargetFamily } from "../model-routing.js";
import type { PromptsmithRuntimeState } from "../state.js";
import type { PromptsmithStatusSnapshot } from "../types.js";
import { detectRuntimeSupport } from "../validation.js";

export function refreshStatusLine(ctx: ExtensionContext, runtime: PromptsmithRuntimeState): void {
  if (!ctx.hasUI) {
    return;
  }

  if (!runtime.getSettings().statusBarEnabled) {
    ctx.ui.setStatus(EXTENSION_COMMAND, undefined);
    return;
  }

  ctx.ui.setStatus(EXTENSION_COMMAND, buildStatusLine(createStatusSnapshot(ctx, runtime)));
}

export function buildStatusLine(snapshot: PromptsmithStatusSnapshot): string {
  if (!snapshot.settings.enabled) {
    return `${EXTENSION_NAME}: disabled`;
  }

  const busyPrefix = snapshot.busy ? "⏳ " : "";
  const family = snapshot.resolvedTargetFamily
    ? describeResolvedFamily(snapshot.resolvedTargetFamily, snapshot.settings.targetFamilyMode)
    : snapshot.settings.targetFamilyMode;
  const rewriteMode = snapshot.currentDraftResolution
    ? `${snapshot.settings.rewriteMode} → ${snapshot.currentDraftResolution.effectiveRewriteMode}/${snapshot.currentDraftResolution.intent}`
    : snapshot.settings.rewriteMode;
  const undo = snapshot.undoAvailable ? " | undo: ready" : "";
  const lastFailure =
    snapshot.lastEnhancementAttempt?.outcome === "failed" ? " | last: failed" : "";
  return `${busyPrefix}Promptsmith: ${family} | mode: ${rewriteMode} | enhancer: ${truncate(snapshot.enhancerModeLabel)}${undo}${lastFailure}`;
}

export function buildStatusReport(ctx: ExtensionContext, runtime: PromptsmithRuntimeState): string {
  const snapshot = createStatusSnapshot(ctx, runtime);
  const settings = snapshot.settings;
  const activeModel = snapshot.activeModel
    ? `${snapshot.activeModel.provider}/${snapshot.activeModel.id}`
    : "none";
  const resolvedFamily = snapshot.resolvedTargetFamily
    ? `${snapshot.resolvedTargetFamily.family} via ${snapshot.resolvedTargetFamily.source}${snapshot.resolvedTargetFamily.matchedRule ? ` (${snapshot.resolvedTargetFamily.matchedRule})` : ""}`
    : "unresolved";
  const support = detectRuntimeSupport(ctx);
  const currentDraftMode = !support.interactiveTui
    ? "unavailable outside interactive editor mode"
    : snapshot.currentDraftResolution
      ? snapshot.currentDraftResolution.effectiveRewriteMode
      : "unavailable (editor empty)";
  const currentDraftIntent = !support.interactiveTui
    ? "unavailable outside interactive editor mode"
    : snapshot.currentDraftResolution
      ? snapshot.currentDraftResolution.intent
      : "unavailable (editor empty)";
  const lastEnhancement = snapshot.lastEnhancementAttempt;

  return [
    buildStatusLine(snapshot),
    `active model: ${activeModel}`,
    `resolved target family: ${resolvedFamily}`,
    `configured rewrite mode: ${settings.rewriteMode}`,
    `effective rewrite mode: ${currentDraftMode}`,
    `task intent: ${currentDraftIntent}`,
    ...(snapshot.lastDraftResolution
      ? [
          `last analyzed effective rewrite mode: ${snapshot.lastDraftResolution.effectiveRewriteMode}`,
          `last analyzed task intent: ${snapshot.lastDraftResolution.intent}`,
        ]
      : []),
    ...(lastEnhancement
      ? [
          `last enhancement outcome: ${lastEnhancement.outcome}`,
          `last enhancement model: ${lastEnhancement.enhancerModel ? `${lastEnhancement.enhancerModel.provider}/${lastEnhancement.enhancerModel.id}` : "unknown"}`,
          `last enhancement retry: ${describeRetryStatus(lastEnhancement)}`,
          ...(lastEnhancement.detail
            ? [`last enhancement detail: ${formatStatusDetail(lastEnhancement.detail)}`]
            : []),
        ]
      : []),
    `enabled: ${settings.enabled}`,
    `shortcut enabled: ${settings.shortcutEnabled}`,
    `shortcut key: ${formatShortcutKey(settings.shortcutKey)}`,
    `status bar enabled: ${settings.statusBarEnabled}`,
    `include recent conversation: ${settings.includeRecentConversation}`,
    `include project metadata: ${settings.includeProjectMetadata}`,
    `rewrite strength: ${settings.rewriteStrength}`,
    `enhancement timeout: ${Math.floor(settings.enhancementTimeoutMs / 1_000)}s`,
    `preview before replace: ${settings.previewBeforeReplace}`,
    `preserve code blocks: ${settings.preserveCodeBlocks}`,
    `exact model overrides: ${settings.exactModelOverrides.length}`,
    `pattern overrides: ${settings.familyOverrides.length}`,
    `undo available: ${snapshot.undoAvailable}`,
  ].join("\n");
}

function createStatusSnapshot(
  ctx: ExtensionContext,
  runtime: PromptsmithRuntimeState
): PromptsmithStatusSnapshot {
  const settings = runtime.getSettings();
  const support = detectRuntimeSupport(ctx);
  const draft = support.interactiveTui ? ctx.ui.getEditorText().trim() : "";
  const currentDraftResolution = draft
    ? analyzeDraftIntent(draft, settings.rewriteMode)
    : undefined;

  if (currentDraftResolution) {
    runtime.rememberDraftResolution(currentDraftResolution);
  }

  const lastDraftResolution = runtime.getLastDraftResolution();
  const lastEnhancementAttempt = runtime.getLastEnhancementAttempt();

  return {
    settings,
    ...(ctx.model ? { activeModel: { provider: ctx.model.provider, id: ctx.model.id } } : {}),
    resolvedTargetFamily: resolveTargetFamily(settings, ctx.model),
    enhancerModeLabel: buildEnhancerModeLabel(settings, ctx.model),
    busy: runtime.isBusy(),
    undoAvailable: runtime.undo.hasUndo(),
    ...(currentDraftResolution ? { currentDraftResolution } : {}),
    ...(lastDraftResolution ? { lastDraftResolution } : {}),
    ...(lastEnhancementAttempt ? { lastEnhancementAttempt } : {}),
  };
}

function describeRetryStatus(
  snapshot: NonNullable<PromptsmithStatusSnapshot["lastEnhancementAttempt"]>
): string {
  if (snapshot.recoveredAfterRetry) {
    return "recovered after one retry";
  }

  if (snapshot.retryUsed) {
    return "retry used but did not recover";
  }

  return "not needed";
}

function formatStatusDetail(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string): string {
  return value.length <= MAX_STATUS_MODEL_ID_LENGTH
    ? value
    : `${value.slice(0, MAX_STATUS_MODEL_ID_LENGTH - 1)}…`;
}
