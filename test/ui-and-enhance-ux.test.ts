import test from "node:test";
import assert from "node:assert/strict";
import { handlePromptsmithCommand } from "../src/commands.js";
import { runSettingsAction } from "../src/ui/settings-actions.js";
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

void test("custom ui mock waits for async done callbacks before resolving", async () => {
  const ctx = createCommandContext();

  const result = await ctx.ui.custom<string>((_tui, _theme, _keybindings, done) => {
    void Promise.resolve().then(() => done("done"));
    return {
      title: "Async custom",
      invalidate: () => undefined,
      render: () => ["Async custom"],
    };
  });

  assert.equal(result, "done");
});

void test("exact override removal clears case-variant duplicates", async () => {
  const runtime = createRuntimeState();
  runtime.replaceSettings({
    ...runtime.getSettings(),
    exactModelOverrides: [
      { provider: "OpenAI", id: "GPT-5", family: "claude" },
      { provider: "openai", id: "gpt-5", family: "gpt" },
      { provider: "anthropic", id: "claude-3-5-sonnet", family: "claude" },
    ],
  });

  const ctx = createCommandContext();
  const selections = ["Remove rule", "OpenAI/GPT-5 → claude", undefined];
  Object.assign(ctx.ui, {
    custom: (_factory: unknown) => Promise.resolve(selections.shift()),
  });

  let refreshCount = 0;
  await runSettingsAction("exactModelOverrides", {
    ctx,
    runtime,
    services: {
      refreshStatus: () => {
        refreshCount += 1;
      },
    },
    settings: runtime.getSettings(),
  });

  assert.deepEqual(runtime.getSettings().exactModelOverrides, [
    { provider: "anthropic", id: "claude-3-5-sonnet", family: "claude" },
  ]);
  assert.equal(refreshCount, 1);
});

void test("settings actions persist against the latest runtime snapshot", async () => {
  const runtime = createRuntimeState();
  const staleSettings = runtime.getSettings();
  runtime.replaceSettings({ ...runtime.getSettings(), statusBarEnabled: true });

  const ctx = createCommandContext();

  await runSettingsAction("enabled", {
    ctx,
    runtime,
    services: {
      refreshStatus: () => undefined,
    },
    settings: staleSettings,
  });

  assert.equal(runtime.getSettings().enabled, false);
  assert.equal(runtime.getSettings().statusBarEnabled, true);
});

void test("pattern override removal uses the raw pattern as the selected value", async () => {
  const runtime = createRuntimeState();
  const pattern = "openai/with → arrow";
  runtime.replaceSettings({
    ...runtime.getSettings(),
    familyOverrides: [
      { pattern, family: "claude" },
      { pattern: "moonshot/*", family: "gpt" },
    ],
  });

  const ctx = createCommandContext();
  const selections = ["Remove rule", pattern, undefined];
  let removeRuleOptions: { label: string; value: string }[] = [];
  Object.assign(ctx.ui, {
    custom: (factory: unknown) => {
      const component =
        typeof factory === "function"
          ? (
              factory as (
                tui: { requestRender: () => void },
                theme: {
                  fg: (color: string, text: string) => string;
                  bg: (color: string, text: string) => string;
                  bold: (text: string) => string;
                },
                keybindings: unknown,
                done: (value: string | undefined) => void
              ) => unknown
            )(
              { requestRender: () => undefined },
              {
                fg: (_color: string, text: string) => text,
                bg: (_color: string, text: string) => text,
                bold: (text: string) => text,
              },
              undefined,
              () => undefined
            )
          : factory;

      const dialog = component as {
        title?: string;
        allItems?: { label: string; value: string }[];
      };
      if (dialog.title === "Remove pattern style rule") {
        removeRuleOptions = dialog.allItems?.map((item) => ({ ...item })) ?? [];
      }

      return Promise.resolve(selections.shift());
    },
  });

  await runSettingsAction("familyOverrides", {
    ctx,
    runtime,
    services: {
      refreshStatus: () => undefined,
    },
    settings: runtime.getSettings(),
  });

  assert.deepEqual(removeRuleOptions[0], {
    label: `${pattern} → claude`,
    value: pattern,
  });
  assert.deepEqual(runtime.getSettings().familyOverrides, [
    { pattern: "moonshot/*", family: "gpt" },
  ]);
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
