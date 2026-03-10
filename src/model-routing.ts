import type { Api, Model } from "@mariozechner/pi-ai";
import type { PromptsmithSettings, ResolvedTargetFamily } from "./types.js";

export function resolveTargetFamily(
  settings: PromptsmithSettings,
  activeModel: Model<Api> | undefined
): ResolvedTargetFamily {
  if (settings.targetFamilyMode !== "auto") {
    return { family: settings.targetFamilyMode, source: "forced" };
  }

  if (!activeModel) {
    return { family: settings.fallbackFamily, source: "fallback" };
  }

  const provider = normalize(activeModel.provider);
  const id = normalize(activeModel.id);
  const providerAndId = `${provider}/${id}`;

  const exact = settings.exactModelOverrides.find(
    (entry) => normalize(entry.provider) === provider && normalize(entry.id) === id
  );
  if (exact) {
    return {
      family: exact.family,
      source: "exact-override",
      matchedRule: `${exact.provider}/${exact.id}`,
    };
  }

  const pattern = settings.familyOverrides.find((entry) =>
    matchesPattern(entry.pattern, providerAndId, id)
  );
  if (pattern) {
    return { family: pattern.family, source: "pattern-override", matchedRule: pattern.pattern };
  }

  const builtin = resolveBuiltinFamily(provider, id);
  if (builtin) {
    return builtin;
  }

  return { family: settings.fallbackFamily, source: "fallback" };
}

export function matchesPattern(pattern: string, providerAndId: string, id: string): boolean {
  const normalizedPattern = normalize(pattern);
  if (!normalizedPattern) return false;

  const candidates = normalizedPattern.includes("/") ? [providerAndId] : [id, providerAndId];
  return candidates.some((candidate) => globToRegExp(normalizedPattern).test(candidate));
}

export function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function resolveBuiltinFamily(provider: string, id: string): ResolvedTargetFamily | undefined {
  if (provider === "openai" || id.startsWith("gpt") || /^o[1-9]/.test(id)) {
    return { family: "gpt", source: "builtin", matchedRule: "openai/gpt*" };
  }

  if (
    provider === "anthropic" ||
    provider === "moonshot" ||
    id.startsWith("claude") ||
    id.startsWith("kimi")
  ) {
    return { family: "claude", source: "builtin", matchedRule: "anthropic|moonshot|claude*|kimi*" };
  }

  return undefined;
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
  return new RegExp(`^${escaped.replace(/\*/g, ".*")}$`, "i");
}

export function describeResolvedFamily(
  resolved: ResolvedTargetFamily,
  mode: PromptsmithSettings["targetFamilyMode"]
): string {
  return mode === "auto" ? `auto→${resolved.family}` : resolved.family;
}
