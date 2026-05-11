import type { Context, Message } from "@earendil-works/pi-ai";
import { buildStrategyInstructions } from "../contracts.js";
import { buildSharedContextSections, buildSharedSystemPrompt } from "./shared.js";
import type { PromptsmithContextPayload } from "../types.js";

const GPT_SYSTEM_GUIDANCE = [
  "For GPT-target rewrites, apply OpenAI prompt guidance: make the generated prompt outcome-first, compact, explicit about success criteria, and only as structured as the task needs.",
  "Prefer decision rules over process-heavy step stacks; reserve absolute words like always, never, must, and only for true invariants.",
  "Use grounding, retrieval budgets, citations, and validation checks only when they materially fit the user's task.",
];

const GPT_PROMPT_GUIDANCE = [
  "Apply OpenAI GPT prompt guidance to the rewrite:",
  "- State the desired outcome first, then add success criteria, constraints, available context, output shape, and stop rules only when they change behavior.",
  "- Keep the prompt as short as possible while preserving the product contract; remove duplicate, contradictory, or legacy process scaffolding.",
  "- Use plain Markdown sections or paragraphs by default. Avoid XML-heavy structure unless the draft already uses it or stable parsing requires it.",
  "- Preserve the requested artifact, length, structure, genre, and concrete details before improving style.",
  "- For grounded factual work, define evidence boundaries, citation behavior, missing-evidence handling, and a retrieval budget.",
  "- For coding-agent work, make tool boundaries, inspection scope, expected edits, verification, and failure behavior clear without scripting every internal step.",
];

export function buildGptStrategyRequest(context: PromptsmithContextPayload): Context {
  const userMessage: Message = {
    role: "user",
    timestamp: Date.now(),
    content: [
      {
        type: "text",
        text: [
          ...GPT_PROMPT_GUIDANCE,
          ...buildStrategyInstructions("gpt", context),
          buildSharedContextSections(context),
        ].join("\n\n"),
      },
    ],
  };

  return {
    systemPrompt: buildSharedSystemPrompt("GPT-style", GPT_SYSTEM_GUIDANCE),
    messages: [userMessage],
  };
}
