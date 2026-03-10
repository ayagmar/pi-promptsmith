import type { Api, AssistantMessage, Model, UserMessage } from "@mariozechner/pi-ai";
import type { SessionEntry } from "@mariozechner/pi-coding-agent";
import {
  DEFAULT_OUTPUT_RESERVE_TOKENS,
  ESTIMATED_FIXED_PROMPT_OVERHEAD_TOKENS,
  MAX_CONVERSATION_MESSAGES,
  MAX_OUTPUT_RESERVE_TOKENS,
  MAX_PROJECT_METADATA_TOKENS,
  MAX_RECENT_CONVERSATION_TOKENS,
} from "./constants.js";
import { analyzeDraftIntent } from "./intent.js";
import type {
  BuildPromptContextOptions,
  ConversationExcerpt,
  ProjectMetadata,
  PromptsmithContextPayload,
} from "./types.js";

export async function buildPromptContext(
  options: BuildPromptContextOptions
): Promise<PromptsmithContextPayload> {
  const { ctx, draft, settings, activeModel, targetFamily, enhancerModel } = options;
  const safeInputBudget = computeSafeInputBudget(enhancerModel);
  const draftTokens = estimateTextTokens(draft);

  if (draftTokens + ESTIMATED_FIXED_PROMPT_OVERHEAD_TOKENS > safeInputBudget) {
    throw new Error(
      `Promptsmith cannot safely enhance this draft with ${enhancerModel.provider}/${enhancerModel.id} because the editor text is too large.`
    );
  }

  const draftAnalysis = analyzeDraftIntent(draft, settings.rewriteMode);
  let remainingOptionalBudget =
    safeInputBudget - draftTokens - ESTIMATED_FIXED_PROMPT_OVERHEAD_TOKENS;
  const droppedContext: string[] = [];

  let projectMetadata: ProjectMetadata | undefined;
  if (settings.includeProjectMetadata) {
    const candidate = await buildProjectMetadata(ctx.cwd, options.exec);
    const tokens = estimateProjectMetadataTokens(candidate);
    if (tokens <= Math.min(MAX_PROJECT_METADATA_TOKENS, remainingOptionalBudget)) {
      projectMetadata = candidate;
      remainingOptionalBudget -= tokens;
    } else {
      droppedContext.push("project metadata");
    }
  }

  let recentConversation: ConversationExcerpt[] = [];
  const branchEntries = settings.includeRecentConversation ? ctx.sessionManager.getBranch() : [];
  const hasConversationHistory = hasConversationMessages(branchEntries);
  if (settings.includeRecentConversation && remainingOptionalBudget > 0) {
    recentConversation = buildRecentConversationExcerpts(
      branchEntries,
      Math.min(MAX_RECENT_CONVERSATION_TOKENS, remainingOptionalBudget)
    );
    if (recentConversation.length === 0 && hasConversationHistory) {
      droppedContext.push("recent conversation");
    }
  } else if (settings.includeRecentConversation && hasConversationHistory) {
    droppedContext.push("recent conversation");
  }

  return {
    draft,
    ...(activeModel ? { activeModel: { provider: activeModel.provider, id: activeModel.id } } : {}),
    targetFamily,
    rewriteStrength: settings.rewriteStrength,
    configuredRewriteMode: settings.rewriteMode,
    effectiveRewriteMode: draftAnalysis.effectiveRewriteMode,
    intent: draftAnalysis.intent,
    preserveCodeBlocks: settings.preserveCodeBlocks,
    recentConversation,
    ...(projectMetadata ? { projectMetadata } : {}),
    droppedContext,
  };
}

export function buildRecentConversationExcerpts(
  entries: SessionEntry[],
  tokenBudget: number
): ConversationExcerpt[] {
  const selected: ConversationExcerpt[] = [];
  let remainingBudget = tokenBudget;

  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.type !== "message") continue;

    const message = entry.message;
    if (!isConversationMessage(message)) {
      continue;
    }

    const text = extractMessageText(message);
    if (!text) continue;

    const tokens = estimateTextTokens(text);
    if (tokens > remainingBudget && selected.length > 0) {
      continue;
    }
    if (tokens > remainingBudget) {
      break;
    }

    selected.push({ role: message.role, text, tokens, timestamp: message.timestamp });
    remainingBudget -= tokens;

    if (selected.length >= MAX_CONVERSATION_MESSAGES) {
      break;
    }
  }

  return selected.reverse();
}

function extractMessageText(message: UserMessage | AssistantMessage): string {
  if (message.role === "user") {
    if (typeof message.content === "string") {
      return normalizeExcerptText(message.content);
    }

    return normalizeExcerptText(
      message.content
        .filter((part): part is { type: "text"; text: string } => part.type === "text")
        .map((part) => part.text)
        .join("\n")
    );
  }

  if (message.stopReason === "aborted") {
    return "";
  }

  return normalizeExcerptText(
    message.content
      .filter((part): part is { type: "text"; text: string } => part.type === "text")
      .map((part) => part.text)
      .join("\n")
  );
}

type SessionMessage = Extract<SessionEntry, { type: "message" }>["message"];

function isConversationMessage(message: SessionMessage): message is UserMessage | AssistantMessage {
  return message.role === "user" || message.role === "assistant";
}

function hasConversationMessages(entries: SessionEntry[]): boolean {
  return entries.some(
    (entry) =>
      entry?.type === "message" &&
      (entry.message.role === "user" || entry.message.role === "assistant")
  );
}

async function buildProjectMetadata(
  cwd: string,
  exec: BuildPromptContextOptions["exec"]
): Promise<ProjectMetadata> {
  try {
    const result = await exec("git", ["branch", "--show-current"]);
    const branch = result.code === 0 ? result.stdout.trim() : "";
    return branch ? { cwd, gitBranch: branch } : { cwd };
  } catch {
    return { cwd };
  }
}

function estimateProjectMetadataTokens(metadata: ProjectMetadata): number {
  return estimateTextTokens(
    [metadata.cwd, ...(metadata.gitBranch ? [metadata.gitBranch] : [])].join("\n")
  );
}

function computeSafeInputBudget(model: Model<Api>): number {
  const outputReserve = Math.min(
    MAX_OUTPUT_RESERVE_TOKENS,
    Math.max(DEFAULT_OUTPUT_RESERVE_TOKENS, Math.floor(model.maxTokens / 2))
  );
  return Math.max(2048, Math.floor(model.contextWindow * 0.8) - outputReserve);
}

function normalizeExcerptText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .trim()
    .replace(/\n{3,}/g, "\n\n");
}

function estimateTextTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
