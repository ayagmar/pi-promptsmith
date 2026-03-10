import type {
  PromptsmithEffectiveRewriteMode,
  PromptsmithRewriteMode,
  PromptsmithTaskIntent,
} from "./types.js";

export interface IntentMatchRule {
  intent: PromptsmithTaskIntent;
  patterns: RegExp[];
}

export interface DraftIntentAnalysis {
  intent: PromptsmithTaskIntent;
  effectiveRewriteMode: PromptsmithEffectiveRewriteMode;
}

const REVIEW_RULE: IntentMatchRule = {
  intent: "review",
  patterns: [/\breview\b/, /\baudit\b/, /\bfindings?\b/, /\blook for issues?\b/, /\bcode review\b/],
};

const DEBUG_RULE: IntentMatchRule = {
  intent: "debug",
  patterns: [
    /\bdebug\b/,
    /\bfix\b/,
    /\bbug\b/,
    /\bbroken\b/,
    /\bfails?\b/,
    /\bfailing\b/,
    /\bstuck\b/,
    /\bhangs?\b/,
    /\bcrash(?:es|ing)?\b/,
    /\berrors?\b/,
    /\broot cause\b/,
  ],
};

const REFACTOR_RULE: IntentMatchRule = {
  intent: "refactor",
  patterns: [
    /\brefactor\b/,
    /\bclean\s+up\b/,
    /\bcleanup\b/,
    /\bsimplif(?:y|ication)\b/,
    /\bdedupe\b/,
    /\bdeduplicate\b/,
    /\brestructure\b/,
    /\breorganize\b/,
  ],
};

const TEST_FIX_RULE: IntentMatchRule = {
  intent: "test-fix",
  patterns: [
    /\bfailing tests?\b/,
    /\bregression tests?\b/,
    /\bupdate tests?\b/,
    /\badd tests?\b/,
    /\btest fix\b/,
    /\bfix tests?\b/,
  ],
};

const DOCS_RULE: IntentMatchRule = {
  intent: "docs",
  patterns: [/\breadme\b/i, /\bdocs?\b/, /\bdocument(?:ation)?\b/, /\busage guide\b/],
};

const RESEARCH_RULE: IntentMatchRule = {
  intent: "research",
  patterns: [
    /\bresearch\b/,
    /\blook up\b/,
    /\binvestigate\b/,
    /\bcompare\b/,
    /\bfind (?:the )?best approach\b/,
    /\bevaluate\b/,
    /\bspike\b/,
  ],
};

const EXPLAIN_RULE: IntentMatchRule = {
  intent: "explain",
  patterns: [
    /\bexplain\b/,
    /\bhow does this work\b/,
    /\bwhy does this\b/,
    /\bwalk me through\b/,
    /\bhelp me understand\b/,
  ],
};

const IMPLEMENT_PATTERNS = [
  /\bimplement\b/,
  /\badd\b/,
  /\bbuild\b/,
  /\bcreate\b/,
  /\bsupport\b/,
  /\bwire up\b/,
  /\bintegrate\b/,
  /\bupdate\b/,
  /\bchange\b/,
  /\bmodify\b/,
];

const EXECUTION_VERB_PATTERNS = [
  ...IMPLEMENT_PATTERNS,
  /\bdebug\b/,
  /\bfix\b/,
  /\brefactor\b/,
  /\breview\b/,
  /\baudit\b/,
  /\bresearch\b/,
  /\binvestigate\b/,
  /\bdocument\b/,
];

const EXPLAIN_LEAD_PATTERNS = [
  /^explain\b/,
  /^please\s+explain\b/,
  /^(?:can|could|would)\s+you\s+explain\b/,
  /^why\b/,
  /^how\b/,
  /^walk me through\b/,
  /^please\s+walk me through\b/,
  /^(?:can|could|would)\s+you\s+walk me through\b/,
  /^help me understand\b/,
  /^please\s+help me understand\b/,
  /^(?:can|could|would)\s+you\s+help me understand\b/,
];

const EXPLAIN_WITH_ACTION_PATTERNS = [
  /\b(?:and|then|also)\s+(?:debug|fix|implement|add|build|create|support|wire up|integrate|update|change|modify|refactor|clean\s+up|cleanup|simplify|dedupe|deduplicate|restructure|reorganize|review|audit|investigate|compare|evaluate|spike|document)\b/,
  /\b(?:and|then|also)\s+(?:run tests?|verify|check|reproduce)\b/,
  /[.!?]\s*(?:please\s+)?(?:debug|fix|implement|add|build|create|support|wire up|integrate|update|change|modify|refactor|review|audit|investigate|compare|evaluate|document|run tests?|verify|check|reproduce)\b/,
];

const CODE_SURFACE_PATTERNS = [
  /\brepo(?:sitory)?\b/,
  /\bcodebase\b/,
  /\bcode\b/,
  /\bfile\b/,
  /\bfunction\b/,
  /\bclass\b/,
  /\bmodule\b/,
  /\bcomponent\b/,
  /\bapi\b/,
  /\bendpoint\b/,
  /\btest(?:s)?\b/,
  /\bcommand\b/,
  /\bmodel\b/,
  /\beditor\b/,
  /\bsession\b/,
  /\bpromptsmith\b/,
  /\bpi\b/,
  /(?:^|\s)(?:\.{1,2}\/|\/)[\w./-]+/,
  /\b[\w./-]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|java|kt|py|go|rs|rb|php|swift|sql|yaml|yml)\b/,
  /`[^`]+`/,
  /\b(?:pnpm|npm|yarn|bun|pytest|vitest|jest|cargo|mvn|gradle|go test|git)\b/,
];

const VERIFICATION_PATTERNS = [
  /\bverify\b/,
  /\bcheck\b/,
  /\brun tests?\b/,
  /\btest(?:s)?\b/,
  /\blint\b/,
  /\bbuild\b/,
  /\breproduce\b/,
  /\bconfirm\b/,
  /\bregression\b/,
];

const STRONG_INTENT_RULES: IntentMatchRule[] = [
  REVIEW_RULE,
  TEST_FIX_RULE,
  DEBUG_RULE,
  REFACTOR_RULE,
  DOCS_RULE,
  RESEARCH_RULE,
];

const EXECUTION_CONTRACT_INTENTS = new Set<PromptsmithTaskIntent>([
  "implement",
  "debug",
  "refactor",
  "review",
  "research",
  "docs",
  "test-fix",
]);

export function detectTaskIntent(draft: string): PromptsmithTaskIntent {
  const normalizedDraft = normalizeDraft(draft);
  if (!normalizedDraft) {
    return "general";
  }

  const startsAsExplanation = matchesAny(normalizedDraft, EXPLAIN_LEAD_PATTERNS);
  const startsWithQuestionLead = matchesAny(normalizedDraft, [/^why\b/, /^how\b/]);
  const requestsOperationalAction = matchesAny(normalizedDraft, EXPLAIN_WITH_ACTION_PATTERNS);
  const hasCodeSurface = matchesAny(normalizedDraft, CODE_SURFACE_PATTERNS);
  const hasVerificationSignal = matchesAny(normalizedDraft, VERIFICATION_PATTERNS);
  const hasExecutionVerb = matchesAny(normalizedDraft, EXECUTION_VERB_PATTERNS);
  const hasImplementVerb = matchesAny(normalizedDraft, IMPLEMENT_PATTERNS);
  if (startsAsExplanation && !requestsOperationalAction && !startsWithQuestionLead) {
    return "explain";
  }

  for (const rule of STRONG_INTENT_RULES) {
    if (matchesAny(normalizedDraft, rule.patterns)) {
      return rule.intent;
    }
  }

  if (
    startsAsExplanation &&
    !requestsOperationalAction &&
    !(hasImplementVerb && (hasCodeSurface || hasVerificationSignal)) &&
    !(hasExecutionVerb && hasCodeSurface)
  ) {
    return "explain";
  }

  if (hasImplementVerb && (hasCodeSurface || hasVerificationSignal)) {
    return "implement";
  }

  if (hasExecutionVerb && hasCodeSurface) {
    return "implement";
  }

  if (hasCodeSurface && hasVerificationSignal) {
    return "implement";
  }

  if (matchesAny(normalizedDraft, EXPLAIN_RULE.patterns)) {
    return "explain";
  }

  return "general";
}

export function resolveEffectiveRewriteMode(
  configuredMode: PromptsmithRewriteMode,
  intent: PromptsmithTaskIntent
): PromptsmithEffectiveRewriteMode {
  if (configuredMode === "plain") {
    return "plain";
  }

  if (configuredMode === "execution-contract") {
    return "execution-contract";
  }

  return EXECUTION_CONTRACT_INTENTS.has(intent) ? "execution-contract" : "plain";
}

export function analyzeDraftIntent(
  draft: string,
  configuredMode: PromptsmithRewriteMode
): DraftIntentAnalysis {
  const intent = detectTaskIntent(draft);
  return {
    intent,
    effectiveRewriteMode: resolveEffectiveRewriteMode(configuredMode, intent),
  };
}

function normalizeDraft(draft: string): string {
  return draft.toLowerCase().replace(/\r\n/g, "\n").replace(/\s+/g, " ").trim();
}

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}
