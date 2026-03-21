import { SENTINEL_CLOSE, SENTINEL_OPEN } from "./constants.js";

export type InvalidModelOutputReason =
  | "missing-sentinel-block"
  | "multiple-sentinel-blocks"
  | "text-outside-sentinel-block"
  | "empty-enhanced-prompt";

const INVALID_MODEL_OUTPUT_PREFIX = "Promptsmith received invalid model output";

export class PromptsmithInvalidModelOutputError extends Error {
  constructor(readonly reason: InvalidModelOutputReason) {
    super(`${INVALID_MODEL_OUTPUT_PREFIX}: ${describeInvalidModelOutputReason(reason)}.`);
    this.name = "PromptsmithInvalidModelOutputError";
  }
}

export function parseEnhancedPrompt(responseText: string): string {
  const escapedOpen = escapeRegExp(SENTINEL_OPEN);
  const escapedClose = escapeRegExp(SENTINEL_CLOSE);
  const pattern = new RegExp(`${escapedOpen}([\\s\\S]*?)${escapedClose}`, "g");
  const matches = [...responseText.matchAll(pattern)];

  if (matches.length === 0) {
    throw new PromptsmithInvalidModelOutputError("missing-sentinel-block");
  }

  if (matches.length > 1) {
    throw new PromptsmithInvalidModelOutputError("multiple-sentinel-blocks");
  }

  const match = matches[0];
  if (!match) {
    throw new PromptsmithInvalidModelOutputError("missing-sentinel-block");
  }

  const before = responseText.slice(0, match.index ?? 0).trim();
  const after = responseText.slice((match.index ?? 0) + match[0].length).trim();
  if (before || after) {
    throw new PromptsmithInvalidModelOutputError("text-outside-sentinel-block");
  }

  const extracted = normalizePromptText(match[1] ?? "");
  if (!extracted.trim()) {
    throw new PromptsmithInvalidModelOutputError("empty-enhanced-prompt");
  }

  return extracted;
}

export function buildSentinelReminder(): string {
  return `Return exactly one ${SENTINEL_OPEN}...${SENTINEL_CLOSE} block and nothing else.`;
}

export function isInvalidModelOutputError(
  error: unknown
): error is PromptsmithInvalidModelOutputError {
  return error instanceof PromptsmithInvalidModelOutputError;
}

export function describeInvalidModelOutputReason(reason: InvalidModelOutputReason): string {
  switch (reason) {
    case "missing-sentinel-block":
      return "missing sentinel block";
    case "multiple-sentinel-blocks":
      return "multiple sentinel blocks";
    case "text-outside-sentinel-block":
      return "unexpected text outside the sentinel block";
    case "empty-enhanced-prompt":
      return "empty enhanced prompt";
  }
}

function normalizePromptText(text: string): string {
  return text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
