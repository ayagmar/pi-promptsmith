import { clearTimeout, setTimeout } from "node:timers";
import type { Api, AssistantMessage, Context, Model } from "@mariozechner/pi-ai";
import { ENHANCER_MAX_OUTPUT_TOKENS } from "./constants.js";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { BorderedLoader } from "@mariozechner/pi-coding-agent";
import { buildPromptContext } from "./context.js";
import { resolveEditorDraft } from "./editor-draft.js";
import { resolveEnhancerModel } from "./model-selection.js";
import { resolveTargetFamily } from "./model-routing.js";
import { buildSentinelReminder, parseEnhancedPrompt } from "./parser.js";
import type { PromptsmithRuntimeState } from "./state.js";
import { buildClaudeStrategyRequest } from "./strategies/claude.js";
import { buildGptStrategyRequest } from "./strategies/gpt.js";
import type { EnhancementPreparation, PromptsmithSettings } from "./types.js";
import {
  detectRuntimeSupport,
  ensureEnhancementEnabled,
  requireNonEmptyDraft,
} from "./validation.js";

export type CompleteOptions = Record<string, unknown> & {
  apiKey?: string;
  signal?: AbortSignal;
  maxTokens?: number;
};

export type CompleteFn = (
  model: Model<Api>,
  context: Context,
  options?: CompleteOptions
) => Promise<AssistantMessage>;

export interface EnhancementServices {
  completeFn: CompleteFn;
  exec: ExtensionAPI["exec"];
  refreshStatus: (ctx: ExtensionContext) => void;
  enhancementTimeoutMs?: number;
  runCancellableTask: (
    ctx: ExtensionContext,
    message: string,
    task: (signal: AbortSignal) => Promise<string | null>
  ) => Promise<string | null>;
}

export async function enhanceEditorDraft(
  ctx: ExtensionContext,
  runtime: PromptsmithRuntimeState,
  services: EnhancementServices
): Promise<void> {
  const support = detectRuntimeSupport(ctx);
  if (!support.interactiveTui) {
    throw new Error(support.reason);
  }

  const settings = runtime.getSettings();
  ensureEnhancementEnabled(settings);

  const draft = await resolveEditorDraft(ctx, services.exec);
  requireNonEmptyDraft(draft);

  if (!runtime.tryStartEnhancement()) {
    throw new Error("Promptsmith is already enhancing the editor draft.");
  }

  services.refreshStatus(ctx);

  try {
    const preparation = await prepareEnhancement(ctx, settings, draft, services);
    runtime.rememberDraftResolution({
      intent: preparation.promptContext.intent,
      effectiveRewriteMode: preparation.promptContext.effectiveRewriteMode,
    });
    const outcome = await services.runCancellableTask(
      ctx,
      `Promptsmith enhancing for ${preparation.resolvedTargetFamily.family} (${preparation.promptContext.effectiveRewriteMode})...`,
      (signal) =>
        generateEnhancedPrompt(
          preparation,
          services.completeFn,
          signal,
          services.enhancementTimeoutMs ?? settings.enhancementTimeoutMs
        )
    );

    if (outcome === null) {
      ctx.ui.notify("Promptsmith enhancement cancelled.", "info");
      return;
    }

    const finalText = settings.previewBeforeReplace
      ? await previewEnhancedPrompt(ctx, outcome)
      : outcome;

    if (finalText === undefined) {
      ctx.ui.notify("Promptsmith preview cancelled. Editor left unchanged.", "info");
      return;
    }

    runtime.undo.store(draft);
    ctx.ui.setEditorText(finalText);
    ctx.ui.notify("Promptsmith enhanced the current draft.", "info");
  } finally {
    runtime.finishEnhancement();
    services.refreshStatus(ctx);
  }
}

async function prepareEnhancement(
  ctx: ExtensionContext,
  settings: PromptsmithSettings,
  draft: string,
  services: Pick<EnhancementServices, "exec">
): Promise<EnhancementPreparation> {
  const resolvedTargetFamily = resolveTargetFamily(settings, ctx.model);
  const enhancerModel = await resolveEnhancerModel(
    settings,
    resolvedTargetFamily.family,
    ctx.model,
    ctx.modelRegistry
  );
  const promptContext = await buildPromptContext({
    ctx,
    draft,
    settings,
    activeModel: ctx.model,
    targetFamily: resolvedTargetFamily.family,
    enhancerModel: enhancerModel.model,
    exec: (command, args) => services.exec(command, args, { cwd: ctx.cwd }),
  });
  const request =
    resolvedTargetFamily.family === "claude"
      ? buildClaudeStrategyRequest(promptContext)
      : buildGptStrategyRequest(promptContext);

  return {
    resolvedTargetFamily,
    enhancerModel,
    promptContext,
    request,
  };
}

export async function runEnhancementWithLoader(
  ctx: ExtensionContext,
  message: string,
  task: (signal: AbortSignal) => Promise<string | null>
): Promise<string | null> {
  let taskError: Error | undefined;

  return ctx.ui
    .custom<string | null>((tui, theme, _keybindings, done) => {
      const loader = new BorderedLoader(tui, theme, message, { cancellable: true });
      loader.onAbort = () => done(null);

      void task(loader.signal)
        .then((result) => {
          if (!loader.signal.aborted) {
            done(result);
          }
        })
        .catch((error: unknown) => {
          if (loader.signal.aborted) {
            done(null);
            return;
          }

          taskError = error instanceof Error ? error : new Error("Promptsmith enhancement failed.");
          done(null);
        });

      return loader;
    })
    .then((result) => {
      if (taskError !== undefined) {
        throw taskError;
      }
      return result;
    });
}

async function generateEnhancedPrompt(
  preparation: EnhancementPreparation,
  completeFn: CompleteFn,
  signal: AbortSignal,
  timeoutMs: number
): Promise<string | null> {
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs);
  const requestSignal = AbortSignal.any([signal, timeoutController.signal]);

  try {
    const primaryResponse = await runCompletion(
      completeFn,
      preparation,
      preparation.request,
      requestSignal,
      signal,
      timeoutController.signal,
      timeoutMs
    );
    if (primaryResponse === null) {
      return null;
    }

    const primaryText = extractTextResponse(primaryResponse);

    try {
      return parseEnhancedPrompt(primaryText);
    } catch (error) {
      if (!isInvalidModelOutputError(error)) {
        throw error;
      }

      const retryResponse = await runCompletion(
        completeFn,
        preparation,
        buildRetryRequest(preparation.request),
        requestSignal,
        signal,
        timeoutController.signal,
        timeoutMs
      );
      if (retryResponse === null) {
        return null;
      }

      return parseEnhancedPrompt(extractTextResponse(retryResponse));
    }
  } catch (error) {
    if (signal.aborted) {
      return null;
    }
    if (timeoutController.signal.aborted) {
      throw createTimeoutError(timeoutMs);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function runCompletion(
  completeFn: CompleteFn,
  preparation: EnhancementPreparation,
  request: Context,
  requestSignal: AbortSignal,
  signal: AbortSignal,
  timeoutSignal: AbortSignal,
  timeoutMs: number
): Promise<AssistantMessage | null> {
  const response = await Promise.race<AssistantMessage | null>([
    completeFn(preparation.enhancerModel.model, request, {
      apiKey: preparation.enhancerModel.apiKey,
      signal: requestSignal,
      maxTokens: Math.min(preparation.enhancerModel.model.maxTokens, ENHANCER_MAX_OUTPUT_TOKENS),
    }),
    waitForAbort(signal, null),
    waitForTimeout(timeoutSignal, timeoutMs),
  ]);

  if (response === null) {
    return null;
  }

  if (response.stopReason === "aborted") {
    if (signal.aborted) {
      return null;
    }
    if (timeoutSignal.aborted) {
      throw createTimeoutError(timeoutMs);
    }
    return null;
  }

  return response;
}

function buildRetryRequest(request: Context): Context {
  const messages = request.messages.slice();
  const lastMessage = messages.at(-1);

  if (lastMessage) {
    const nextContent = Array.isArray(lastMessage.content)
      ? lastMessage.content.map((part) =>
          part.type === "text"
            ? {
                ...part,
                text: `${part.text}\n\nIMPORTANT: Reply with exactly one sentinel block and no surrounding commentary.`,
              }
            : part
        )
      : lastMessage.content;

    messages[messages.length - 1] = {
      ...lastMessage,
      content: nextContent,
    } as (typeof messages)[number];
  }

  return {
    ...request,
    systemPrompt: `${request.systemPrompt}\n${buildSentinelReminder()} Do not add markdown fences, explanations, or any text before or after the sentinel block.`,
    messages,
  };
}

function isInvalidModelOutputError(error: unknown): error is Error {
  return (
    error instanceof Error && error.message.startsWith("Promptsmith received invalid model output:")
  );
}

async function previewEnhancedPrompt(
  ctx: ExtensionContext,
  enhancedPrompt: string
): Promise<string | undefined> {
  return ctx.ui.editor("Review enhanced prompt", enhancedPrompt);
}

function extractTextResponse(response: AssistantMessage): string {
  return response.content
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function waitForAbort<T>(signal: AbortSignal, value: T): Promise<T> {
  if (signal.aborted) {
    return Promise.resolve(value);
  }

  return new Promise<T>((resolve) => {
    signal.addEventListener("abort", () => resolve(value), { once: true });
  });
}

function waitForTimeout(signal: AbortSignal, timeoutMs: number): Promise<never> {
  if (signal.aborted) {
    return Promise.reject(createTimeoutError(timeoutMs));
  }

  return new Promise<never>((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(createTimeoutError(timeoutMs)), { once: true });
  });
}

function createTimeoutError(timeoutMs: number): Error {
  const seconds = Math.floor(timeoutMs / 1_000);
  return new Error(
    `Promptsmith enhancement timed out after ${seconds} seconds. Try again or choose a faster enhancer model.`
  );
}

export function buildEnhancerModeLabel(
  settings: PromptsmithSettings,
  activeModel: Model<Api> | undefined
): string {
  switch (settings.enhancerModelMode) {
    case "active":
      return activeModel
        ? `active (${activeModel.provider}/${activeModel.id})`
        : "active (no model)";
    case "fixed":
      return settings.fixedEnhancerModel
        ? `${settings.fixedEnhancerModel.provider}/${settings.fixedEnhancerModel.id}`
        : "fixed (unconfigured)";
    case "family-linked": {
      const gpt = settings.familyEnhancerModels?.gpt;
      const claude = settings.familyEnhancerModels?.claude;
      return `family-linked (${gpt ? `${gpt.provider}/${gpt.id}` : "gpt:unset"}; ${claude ? `${claude.provider}/${claude.id}` : "claude:unset"})`;
    }
  }
}
