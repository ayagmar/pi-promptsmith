import { buildSentinelReminder } from "../parser.js";
import type { PromptsmithContextPayload } from "../types.js";

export function buildSharedSystemPrompt(targetStyle: "GPT-style" | "Claude-style"): string {
  return [
    `You are Promptsmith, an expert ${targetStyle} prompt rewriter.`,
    "Follow the resolved rewrite mode from the provided context.",
    "If the resolved rewrite mode is plain, rewrite the draft into a stronger prompt without deliberately compiling it into an execution contract.",
    "If the resolved rewrite mode is execution-contract, compile the draft into a concise, executable task contract for a Pi coding-agent workflow.",
    "Preserve the user's original intent.",
    "Preserve explicit constraints, file paths, commands, APIs, acceptance criteria, and other concrete details.",
    "Do not invent facts, requirements, files, commands, or context that the user did not provide.",
    "Avoid speculative implementation details, generic filler, and duplicated sections.",
    "Keep the output concise and natural for the target model family.",
    "Do not add commentary about your rewrite.",
    "Do not use tools.",
    buildSentinelReminder(),
  ].join("\n");
}

export function buildSharedContextSections(context: PromptsmithContextPayload): string {
  const sections = [
    section("resolved_target_family", context.targetFamily),
    section("rewrite_strength", context.rewriteStrength),
    section("configured_rewrite_mode", context.configuredRewriteMode),
    section("effective_rewrite_mode", context.effectiveRewriteMode),
    section("resolved_intent", context.intent),
    section("preserve_code_blocks", context.preserveCodeBlocks ? "true" : "false"),
  ];

  if (context.activeModel) {
    sections.push(
      section("active_model", `${context.activeModel.provider}/${context.activeModel.id}`)
    );
  }

  if (context.recentConversation.length > 0) {
    sections.push(
      section(
        "recent_conversation",
        context.recentConversation.map((entry) => `[${entry.role}] ${entry.text}`).join("\n\n")
      )
    );
  }

  if (context.projectMetadata) {
    sections.push(
      section(
        "project_metadata",
        [
          `cwd: ${context.projectMetadata.cwd}`,
          ...(context.projectMetadata.gitBranch
            ? [`git_branch: ${context.projectMetadata.gitBranch}`]
            : []),
        ].join("\n")
      )
    );
  }

  if (context.droppedContext.length > 0) {
    sections.push(section("dropped_optional_context", context.droppedContext.join(", ")));
  }

  sections.push(section("editor_draft", context.draft));
  return sections.join("\n\n");
}

export function section(name: string, body: string): string {
  return `<${name}>\n${body}\n</${name}>`;
}
