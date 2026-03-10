import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { MAX_ENHANCEMENT_TIMEOUT_MS, MIN_ENHANCEMENT_TIMEOUT_MS } from "./constants.js";
import type { PromptsmithRuntimeSupport, PromptsmithSettings } from "./types.js";

export function detectRuntimeSupport(ctx: ExtensionContext): PromptsmithRuntimeSupport {
  if (!ctx.hasUI) {
    return {
      interactiveTui: false,
      reason: "Promptsmith editor actions require Pi interactive mode.",
    };
  }

  if (ctx.ui.getAllThemes().length === 0) {
    return {
      interactiveTui: false,
      reason:
        "Promptsmith in-place editor enhancement is not supported in RPC mode because Pi cannot read the current editor buffer there.",
    };
  }

  return { interactiveTui: true };
}

export function ensureEnhancementEnabled(settings: PromptsmithSettings): void {
  if (!settings.enabled) {
    throw new Error(
      "Promptsmith is disabled globally. Use /promptsmith enable to turn it back on."
    );
  }
}

export function requireNonEmptyDraft(draft: string): void {
  if (!draft.trim()) {
    throw new Error("Promptsmith needs a non-empty editor draft.");
  }
}

export function parseOnOff(value: string): boolean | undefined {
  if (value === "on") return true;
  if (value === "off") return false;
  return undefined;
}

export function parseEnhancementTimeoutSeconds(value: string): number | undefined {
  if (!/^\d+$/.test(value.trim())) {
    return undefined;
  }

  const seconds = Number.parseInt(value, 10);
  const timeoutMs = seconds * 1_000;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < MIN_ENHANCEMENT_TIMEOUT_MS ||
    timeoutMs > MAX_ENHANCEMENT_TIMEOUT_MS
  ) {
    return undefined;
  }

  return timeoutMs;
}
