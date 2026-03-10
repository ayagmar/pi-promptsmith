import type {
  PromptsmithContextPayload,
  PromptsmithFamily,
  PromptsmithTaskIntent,
} from "./types.js";

export function buildStrategyInstructions(
  family: PromptsmithFamily,
  context: PromptsmithContextPayload
): string[] {
  return context.effectiveRewriteMode === "execution-contract"
    ? buildExecutionContractInstructions(family, context.intent)
    : buildPlainRewriteInstructions(family, context.intent);
}

function buildPlainRewriteInstructions(
  family: PromptsmithFamily,
  intent: PromptsmithTaskIntent
): string[] {
  return [
    `Rewrite the draft into a stronger ${describeFamily(family)} prompt.`,
    family === "claude"
      ? "Use explicit structure when it materially improves clarity, but do not force XML or rigid sections."
      : "Use direct, practical wording with compact sections only when they materially improve clarity.",
    intent === "explain"
      ? "Keep it primarily explanatory instead of turning it into an execution plan."
      : "Improve clarity, scope, and output expectations without turning it into a rigid execution contract unless the draft already asks for that.",
    "Keep the rewrite concise, concrete, and faithful to the user's wording and scope.",
    "Avoid filler, speculative best-practice lists, and duplicated instructions.",
  ];
}

function buildExecutionContractInstructions(
  family: PromptsmithFamily,
  intent: PromptsmithTaskIntent
): string[] {
  return [
    `Compile the draft into a concise ${describeFamily(family)} execution contract for a Pi coding-agent workflow.`,
    "Produce the smallest strong contract that makes the task executable.",
    "Make the objective, relevant context, explicit constraints, inspection surfaces, expected changes, verification, and deliverable expectations clear when they are useful.",
    family === "claude"
      ? "Prefer strong explicit structure. XML-like sections such as <task>, <context>, <constraints>, <verification>, and <deliverable> are allowed when they materially improve clarity."
      : "Prefer compact natural sections or bullets. Avoid XML unless the draft already uses it or it clearly improves execution clarity.",
    "Do not emit empty sections, generic filler, or speculative requirements.",
    ...buildIntentGuidance(intent),
  ];
}

function buildIntentGuidance(intent: PromptsmithTaskIntent): string[] {
  switch (intent) {
    case "implement":
      return [
        "Shape the contract around a clear feature goal, scope boundaries, constraints, validation, and the expected output summary.",
      ];
    case "debug":
      return [
        "Bias toward inspecting before editing, reproducing or confirming the issue, fixing the root cause, adding or updating regression coverage when appropriate, and verifying the fix.",
      ];
    case "refactor":
      return [
        "Bias toward preserving behavior, improving structure, avoiding unnecessary API changes, removing duplication or dead code when appropriate, and running relevant checks.",
      ];
    case "review":
      return [
        "Bias toward inspecting the current implementation first, reporting findings before suggestions, ordering findings by severity or impact, and avoiding speculative redesign unless requested.",
      ];
    case "research":
      return [
        "Bias toward implementation-relevant facts, focused comparison or investigation, citing sources when web research is explicitly requested, and ending with a recommended path.",
      ];
    case "docs":
      return [
        "Bias toward updating the exact user-facing docs affected, aligning them with current runtime behavior, and keeping examples and commands accurate.",
      ];
    case "test-fix":
      return [
        "Bias toward reproducing the failing behavior, deciding whether the bug or the test is wrong, fixing the correct layer, keeping regression coverage close to the change, and rerunning relevant checks.",
      ];
    case "explain":
      return [
        "Keep it explanatory unless the user explicitly asks for structured operational deliverables.",
      ];
    case "general":
      return ["Keep the contract helpful without pretending to know more than the draft provides."];
  }
}

function describeFamily(family: PromptsmithFamily): string {
  return family === "claude" ? "Claude-style" : "GPT-style";
}
