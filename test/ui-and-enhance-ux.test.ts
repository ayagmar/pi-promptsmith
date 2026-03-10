import test from "node:test";
import assert from "node:assert/strict";
import { handlePromptsmithCommand } from "../src/commands.js";
import { openSelectDialog } from "../src/ui/select-dialog.js";
import {
  createAssistantResponse,
  createCommandContext,
  createCompleteResponse,
  createMockPi,
  createModel,
  createRuntimeState,
} from "./helpers.js";

void test("compact model selector paginates and supports / search", async () => {
  const ctx = createCommandContext({
    customInputSequence: ["/", "0", "9", "\r"],
  });

  const items = Array.from({ length: 12 }, (_, index) => {
    const label = `openai/gpt-5-${String(index + 1).padStart(2, "0")}`;
    return { value: label, label };
  });

  const result = await openSelectDialog(ctx, {
    title: "Choose model",
    items,
    pageSize: 5,
    searchable: true,
  });

  assert.equal(result, "openai/gpt-5-09");
  assert.deepEqual(ctx.uiState.customTitles, ["Choose model"]);

  const initialRender = ctx.uiState.customRenderHistory[0]?.join("\n") ?? "";
  assert.match(initialRender, /Page 1\/3/);
  assert.match(initialRender, /\/ search/);
});

void test("selector navigation wraps from top to bottom", async () => {
  const ctx = createCommandContext({
    customInputSequence: ["\u001b[A", "\r"],
  });

  const result = await openSelectDialog(ctx, {
    title: "Wrap test",
    items: [
      { value: "one", label: "one" },
      { value: "two", label: "two" },
      { value: "three", label: "three" },
    ],
    pageSize: 3,
  });

  assert.equal(result, "three");
});

void test("selector navigation wraps from bottom to top", async () => {
  const ctx = createCommandContext({
    customInputSequence: ["\u001b[B", "\r"],
  });

  const result = await openSelectDialog(ctx, {
    title: "Wrap test",
    items: [
      { value: "one", label: "one" },
      { value: "two", label: "two" },
      { value: "three", label: "three" },
    ],
    pageSize: 3,
    initialValue: "three",
  });

  assert.equal(result, "one");
});

void test("selector navigation crosses page boundaries instead of wrapping inside one page", async () => {
  const ctx = createCommandContext({
    customInputSequence: ["\u001b[B", "\r"],
  });

  const result = await openSelectDialog(ctx, {
    title: "Paged wrap test",
    items: [
      { value: "one", label: "one" },
      { value: "two", label: "two" },
      { value: "three", label: "three" },
      { value: "four", label: "four" },
      { value: "five", label: "five" },
    ],
    pageSize: 2,
    initialValue: "two",
  });

  assert.equal(result, "three");
});

void test("enhancement retries once when the first model response breaks the sentinel contract", async () => {
  const runtime = createRuntimeState();
  const harness = createMockPi();
  const ctx = createCommandContext({ model: createModel(), editorText: "fix this prompt" });

  let callCount = 0;
  await handlePromptsmithCommand("", ctx, runtime, {
    completeFn: () => {
      callCount += 1;
      return Promise.resolve(
        callCount === 1
          ? createAssistantResponse(
              "Sure — here is the improved prompt:\n<promptsmith-enhanced-prompt>Retry me</promptsmith-enhanced-prompt>"
            )
          : createCompleteResponse("Recovered prompt")
      );
    },
    exec: harness.pi.exec.bind(harness.pi),
    refreshStatus: () => undefined,
    runCancellableTask: (_ctx, _message, task) => task(new AbortController().signal),
  });

  assert.equal(callCount, 2);
  assert.equal(ctx.uiState.editorText, "Recovered prompt");
  assert.doesNotMatch(
    ctx.uiState.notifications.map((entry) => entry.message).join("\n"),
    /invalid model output/i
  );
});
