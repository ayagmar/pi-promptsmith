import test from "node:test";
import assert from "node:assert/strict";
import { buildClaudeStrategyRequest } from "../src/strategies/claude.js";
import { buildGptStrategyRequest } from "../src/strategies/gpt.js";
import { buildPromptContext } from "../src/context.js";
import {
  analyzeDraftIntent,
  detectTaskIntent,
  resolveEffectiveRewriteMode,
} from "../src/intent.js";
import { buildStatusLine, buildStatusReport, refreshStatusLine } from "../src/ui/status.js";
import { createCommandContext, createModel, createRuntimeState } from "./helpers.js";
import type { PromptsmithContextPayload } from "../src/types.js";

void test("intent classification detects implement-oriented drafts", () => {
  assert.equal(
    detectTaskIntent("Implement support for rewriteMode in src/commands.ts and run tests."),
    "implement"
  );
});

void test("intent classification detects debug-oriented drafts", () => {
  assert.equal(detectTaskIntent("Debug why /promptsmith hangs and fix the timeout bug."), "debug");
});

void test("intent classification detects refactor-oriented drafts", () => {
  assert.equal(
    detectTaskIntent("Refactor the strategy builder to simplify the branching and dedupe logic."),
    "refactor"
  );
});

void test("intent classification detects review-oriented drafts", () => {
  assert.equal(
    detectTaskIntent("Review the current implementation and report findings by severity."),
    "review"
  );
});

void test("intent classification detects research-oriented drafts", () => {
  assert.equal(
    detectTaskIntent(
      "Research the best approach for Pi extension status reporting and cite sources."
    ),
    "research"
  );
});

void test("intent classification detects docs-oriented drafts", () => {
  assert.equal(
    detectTaskIntent("Update the README docs to describe the new rewrite mode behavior."),
    "docs"
  );
});

void test("intent classification detects test-fix-oriented drafts", () => {
  assert.equal(
    detectTaskIntent(
      "Investigate the failing tests, decide whether the bug or test is wrong, and update tests."
    ),
    "test-fix"
  );
});

void test("intent classification detects explain-oriented drafts", () => {
  assert.equal(detectTaskIntent("Explain how Promptsmith model routing works."), "explain");
});

void test("intent classification keeps explanation-first mixed prompts in explain mode when no action is requested", () => {
  assert.equal(detectTaskIntent("Explain why tests fail in CI."), "explain");
});

void test("intent classification treats polite explanation requests as explain mode", () => {
  assert.equal(detectTaskIntent("Can you explain why tests fail in CI?"), "explain");
});

void test("intent classification keeps explanation-first how-to prompts in explain mode", () => {
  assert.equal(detectTaskIntent("Explain how to add tests for this feature."), "explain");
});

void test("intent classification treats how-to fix prompts as debug work", () => {
  assert.equal(detectTaskIntent("How do we fix Alt+P hanging forever?"), "debug");
});

void test("intent classification treats how-to implementation prompts as implement work", () => {
  assert.equal(
    detectTaskIntent("How should I implement rewrite mode support in Promptsmith?"),
    "implement"
  );
});

void test("intent classification treats why-is-it-broken prompts with a fix request as debug work", () => {
  assert.equal(detectTaskIntent("Why is Promptsmith stuck loading and how do we fix it?"), "debug");
});

void test("intent classification still prefers execution when the draft asks to explain and fix", () => {
  assert.equal(detectTaskIntent("Explain why tests fail and fix the root cause."), "debug");
});

void test("intent classification prefers execution when a follow-up sentence requests action", () => {
  assert.equal(detectTaskIntent("Why does this test fail? Fix it."), "debug");
});

void test("intent classification falls back to general for non-operational prompts", () => {
  assert.equal(detectTaskIntent("Brainstorm names for this feature."), "general");
});

void test("rewrite mode resolution honors forced and auto modes", () => {
  assert.equal(resolveEffectiveRewriteMode("plain", "implement"), "plain");
  assert.equal(resolveEffectiveRewriteMode("execution-contract", "explain"), "execution-contract");
  assert.equal(resolveEffectiveRewriteMode("auto", "implement"), "execution-contract");
  assert.equal(resolveEffectiveRewriteMode("auto", "explain"), "plain");
});

void test("draft analysis resolves intent and effective rewrite mode together", () => {
  assert.deepEqual(analyzeDraftIntent("Review this diff and report findings.", "auto"), {
    intent: "review",
    effectiveRewriteMode: "execution-contract",
  });
});

void test("buildPromptContext does not claim missing conversation was dropped", async () => {
  const model = createModel();
  const runtime = createRuntimeState();
  const ctx = createCommandContext({ model, entries: [] });

  const promptContext = await buildPromptContext({
    ctx,
    draft: "Explain how rewrite mode works.",
    settings: { ...runtime.getSettings(), includeRecentConversation: true },
    activeModel: model,
    targetFamily: "gpt",
    enhancerModel: model,
    exec: () => Promise.resolve({ stdout: "", stderr: "", code: 0 }),
  });

  assert.equal(promptContext.recentConversation.length, 0);
  assert.equal(promptContext.droppedContext.includes("recent conversation"), false);
});

void test("buildPromptContext caps the safe input budget to the enhancer model usable room", async () => {
  const model = createModel({ contextWindow: 1_500, maxTokens: 1_000 });
  const runtime = createRuntimeState();
  const ctx = createCommandContext({ model, entries: [] });

  await assert.rejects(
    buildPromptContext({
      ctx,
      draft: "x".repeat(20_000),
      settings: runtime.getSettings(),
      activeModel: model,
      targetFamily: "gpt",
      enhancerModel: model,
      exec: () => Promise.resolve({ stdout: "", stderr: "", code: 0 }),
    }),
    /too large/i
  );
});

void test("gpt strategy request changes instructions between plain and execution-contract modes", () => {
  const plainRequest = buildGptStrategyRequest(
    createPromptContext({ effectiveRewriteMode: "plain", intent: "explain" })
  );
  const contractRequest = buildGptStrategyRequest(
    createPromptContext({ effectiveRewriteMode: "execution-contract", intent: "debug" })
  );

  const plainText = extractUserText(plainRequest);
  const contractText = extractUserText(contractRequest);

  assert.match(plainText, /stronger GPT-style prompt/i);
  assert.doesNotMatch(plainText, /execution contract/i);
  assert.match(contractText, /concise GPT-style execution contract/i);
  assert.match(contractText, /root cause/i);
  assert.match(contractText, /<effective_rewrite_mode>\s*execution-contract/i);
});

void test("claude execution-contract strategy allows stronger explicit structure without bloating", () => {
  const request = buildClaudeStrategyRequest(
    createPromptContext({ effectiveRewriteMode: "execution-contract", intent: "implement" })
  );

  const text = extractUserText(request);
  assert.match(text, /XML-like sections/i);
  assert.match(text, /smallest strong contract/i);
  assert.match(text, /clear feature goal/i);
});

void test("extractUserText finds the user message when system messages are prepended", () => {
  assert.equal(
    extractUserText({
      messages: [
        { role: "system", content: "system guidance" },
        { role: "developer", content: "developer guidance" },
        { role: "user", content: [{ type: "text", text: "Actual user prompt" }] },
      ],
    }),
    "Actual user prompt"
  );
});

void test("status report includes rewrite mode, timeout, and draft intent when interactive", () => {
  const runtime = createRuntimeState();
  runtime.replaceSettings({
    ...runtime.getSettings(),
    rewriteMode: "auto",
    statusBarEnabled: true,
    autoSendEnhancedPrompt: true,
    autoSendBusyBehavior: "followUp",
    enhancementTimeoutMs: 12_000,
  });
  const ctx = createCommandContext({
    model: createModel(),
    editorText: "Implement rewriteMode support in src/state.ts and run tests.",
  });

  const report = buildStatusReport(ctx, runtime);

  assert.match(report, /configured rewrite mode: auto/);
  assert.match(report, /effective rewrite mode: execution-contract/);
  assert.match(report, /task intent: implement/);
  assert.match(report, /status bar enabled: true/);
  assert.match(report, /auto-send enhanced prompt: true/);
  assert.match(report, /auto-send when busy: follow-up/);
  assert.match(report, /enhancement timeout: 12s/);
});

void test("status resolves the fallback family even when no active model is selected", () => {
  const runtime = createRuntimeState();
  runtime.replaceSettings({ ...runtime.getSettings(), fallbackFamily: "claude" });
  const ctx = createCommandContext({ editorText: "" });

  const report = buildStatusReport(ctx, runtime);

  assert.match(report, /active model: none/);
  assert.match(report, /resolved target family: claude via fallback/);
});

void test("status line stays hidden by default", () => {
  const runtime = createRuntimeState();
  const ctx = createCommandContext({
    model: createModel(),
    editorText: "Review this implementation and report findings.",
  });

  refreshStatusLine(ctx, runtime);

  assert.equal(ctx.uiState.status.get("promptsmith"), undefined);
});

void test("status line reflects the current draft analysis when enabled", () => {
  const runtime = createRuntimeState();
  runtime.replaceSettings({ ...runtime.getSettings(), statusBarEnabled: true });
  const ctx = createCommandContext({
    model: createModel(),
    editorText: "Review this implementation and report findings.",
  });

  refreshStatusLine(ctx, runtime);

  const line = ctx.uiState.status.get("promptsmith");
  assert.ok(line);
  assert.match(line, /mode: auto → execution-contract\/review/);
});

void test("status line surfaces the last failed enhancement", () => {
  const runtime = createRuntimeState();
  runtime.replaceSettings({ ...runtime.getSettings(), statusBarEnabled: true });
  runtime.rememberEnhancementAttempt({
    outcome: "failed",
    enhancerModel: { provider: "openai", id: "gpt-5" },
    retryUsed: true,
    recoveredAfterRetry: false,
    detail: "primary: missing sentinel block; retry: unexpected text outside the sentinel block",
  });
  const ctx = createCommandContext({
    model: createModel(),
    editorText: "Review this implementation and report findings.",
  });

  refreshStatusLine(ctx, runtime);

  const line = ctx.uiState.status.get("promptsmith");
  assert.ok(line);
  assert.match(line, /last: failed/);
});

void test("status line clears when the footer status setting is turned off", () => {
  const runtime = createRuntimeState();
  runtime.replaceSettings({ ...runtime.getSettings(), statusBarEnabled: true });
  const ctx = createCommandContext({
    model: createModel(),
    editorText: "Review this implementation and report findings.",
  });

  refreshStatusLine(ctx, runtime);
  assert.ok(ctx.uiState.status.get("promptsmith"));

  runtime.replaceSettings({ ...runtime.getSettings(), statusBarEnabled: false });
  refreshStatusLine(ctx, runtime);
  assert.equal(ctx.uiState.status.get("promptsmith"), undefined);
});

void test("status line falls back to configured rewrite mode when the editor is empty", () => {
  const runtime = createRuntimeState();
  const snapshotLine = buildStatusLine({
    settings: runtime.getSettings(),
    enhancerModeLabel: "active (openai/gpt-5)",
    busy: false,
    undoAvailable: false,
    lastDraftResolution: { intent: "implement", effectiveRewriteMode: "execution-contract" },
  });

  assert.match(snapshotLine, /mode: auto/);
  assert.doesNotMatch(snapshotLine, /execution-contract\/implement/);
});

void test("status report reuses the last analyzed draft resolution outside interactive editor mode", () => {
  const runtime = createRuntimeState();

  const interactiveCtx = createCommandContext({
    model: createModel(),
    editorText: "Implement rewriteMode support in src/state.ts and run tests.",
  });
  buildStatusReport(interactiveCtx, runtime);

  const headlessCtx = createCommandContext({
    hasUI: false,
    model: createModel(),
    editorText: "Explain this",
  });
  const report = buildStatusReport(headlessCtx, runtime);

  assert.match(report, /configured rewrite mode: auto/);
  assert.match(report, /effective rewrite mode: unavailable outside interactive editor mode/);
  assert.match(report, /task intent: unavailable outside interactive editor mode/);
  assert.match(report, /last analyzed effective rewrite mode: execution-contract/);
  assert.match(report, /last analyzed task intent: implement/);
});

void test("status report includes the last enhancement attempt details", () => {
  const runtime = createRuntimeState();
  runtime.rememberEnhancementAttempt({
    outcome: "failed",
    enhancerModel: { provider: "google-gemini-cli", id: "gemini-3.1-pro-preview" },
    retryUsed: true,
    recoveredAfterRetry: false,
    detail: "primary: missing sentinel block;\nretry: unexpected text outside the sentinel block",
  });
  const ctx = createCommandContext({ model: createModel(), editorText: "Implement this." });

  const report = buildStatusReport(ctx, runtime);

  assert.match(report, /last enhancement outcome: failed/);
  assert.match(report, /last enhancement model: google-gemini-cli\/gemini-3.1-pro-preview/);
  assert.match(report, /last enhancement retry: retry used but did not recover/);
  assert.match(
    report,
    /last enhancement detail: primary: missing sentinel block; retry: unexpected text outside the sentinel block/
  );
});

function createPromptContext(
  overrides: Partial<PromptsmithContextPayload>
): PromptsmithContextPayload {
  return {
    draft: "draft",
    activeModel: { provider: "openai", id: "gpt-5" },
    targetFamily: "gpt",
    rewriteStrength: "balanced",
    configuredRewriteMode: "auto",
    effectiveRewriteMode: "plain",
    intent: "general",
    preserveCodeBlocks: true,
    recentConversation: [],
    droppedContext: [],
    ...overrides,
  };
}

function extractUserText(request: {
  messages: { role: string; content: string | unknown[] }[];
}): string {
  const userMessage = request.messages.find((message) => message.role === "user");
  assert.ok(userMessage, "expected a user message");
  if (typeof userMessage.content === "string") {
    return userMessage.content;
  }
  const textPart = userMessage.content.find((part): part is { type: "text"; text: string } => {
    if (!part || typeof part !== "object") {
      return false;
    }

    const candidate = part as { type?: unknown; text?: unknown };
    return candidate.type === "text" && typeof candidate.text === "string";
  });
  return textPart?.text ?? "";
}
