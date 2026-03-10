import { SENTINEL_CLOSE, SENTINEL_OPEN } from "./constants.js";

export function parseEnhancedPrompt(responseText: string): string {
  const pattern = /<promptsmith-enhanced-prompt>([\s\S]*?)<\/promptsmith-enhanced-prompt>/g;
  const matches = [...responseText.matchAll(pattern)];

  if (matches.length !== 1) {
    throw new Error(
      "Promptsmith received invalid model output: expected exactly one sentinel block."
    );
  }

  const match = matches[0];
  if (!match) {
    throw new Error("Promptsmith received invalid model output: missing sentinel block.");
  }

  const before = responseText.slice(0, match.index ?? 0).trim();
  const after = responseText.slice((match.index ?? 0) + match[0].length).trim();
  if (before || after) {
    throw new Error(
      "Promptsmith received invalid model output: unexpected text outside the sentinel block."
    );
  }

  const extracted = normalizePromptText(match[1] ?? "");
  if (!extracted.trim()) {
    throw new Error("Promptsmith received an empty enhanced prompt.");
  }

  return extracted;
}

export function buildSentinelReminder(): string {
  return `Return exactly one ${SENTINEL_OPEN}...${SENTINEL_CLOSE} block and nothing else.`;
}

function normalizePromptText(text: string): string {
  return text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .trim();
}
