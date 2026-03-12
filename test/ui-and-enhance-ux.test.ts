import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { visibleWidth } from "@mariozechner/pi-tui";
import { handlePromptsmithCommand } from "../src/commands.js";
import { resolveEditorDraft } from "../src/editor-draft.js";
import { PromptsmithRuntimeState } from "../src/state.js";
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

void test("select dialog truncates long titles to the available width", async () => {
  const ctx = createCommandContext();
  let renderedLines: string[] = [];

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
              ) => { render: (width: number) => string[] }
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

      renderedLines = (component as { render: (width: number) => string[] }).render(12);
      return Promise.resolve(undefined);
    },
  });

  await openSelectDialog(ctx, {
    title: "Promptsmith settings title that should truncate",
    items: [{ value: "one", label: "one" }],
  });

  assert.ok(renderedLines.length > 0);
  assert.ok(visibleWidth(renderedLines[0] ?? "") <= 12);
});

void test("resolveEditorDraft rejects multiple paste markers without reading the clipboard", async () => {
  const ctx = createCommandContext({
    editorText: "First [paste #1 3 chars]\nSecond [paste #2 3 chars]",
  });

  let execCalls = 0;
  await assert.rejects(
    () =>
      resolveEditorDraft(ctx, () => {
        execCalls += 1;
        return Promise.resolve({ stdout: "abc", stderr: "", code: 0, killed: false });
      }),
    /Promptsmith found Pi paste markers/
  );

  assert.equal(execCalls, 0);
});

void test("resolveEditorDraft accepts clipboard text that contains marker-shaped text", async () => {
  const ctx = createCommandContext({ editorText: "Paste here: [paste #1]" });

  const resolved = await resolveEditorDraft(ctx, () =>
    Promise.resolve({ stdout: "literal [paste #2]", stderr: "", code: 0, killed: false })
  );

  assert.equal(resolved, "Paste here: literal [paste #2]");
});

void test("resolveEditorDraft tries the Windows clipboard first on WSL", async () => {
  const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");
  const originalWslDistro = process.env.WSL_DISTRO_NAME;
  const originalTermuxVersion = process.env.TERMUX_VERSION;
  const originalAndroidRoot = process.env.ANDROID_ROOT;

  Object.defineProperty(process, "platform", { value: "linux", configurable: true });
  process.env.WSL_DISTRO_NAME = "Ubuntu";
  process.env.TERMUX_VERSION = "1.0.0";
  delete process.env.ANDROID_ROOT;

  try {
    const ctx = createCommandContext({ editorText: "Paste here: [paste #1]" });
    const commands: string[] = [];

    const resolved = await resolveEditorDraft(ctx, (command) => {
      commands.push(command);
      if (command === "powershell.exe") {
        return Promise.resolve({ stdout: "", stderr: "missing", code: 1, killed: false });
      }
      if (command === "wl-paste") {
        return Promise.resolve({ stdout: "clipboard text", stderr: "", code: 0, killed: false });
      }
      return Promise.resolve({ stdout: "", stderr: "missing", code: 1, killed: false });
    });

    assert.equal(resolved, "Paste here: clipboard text");
    assert.deepEqual(commands.slice(0, 3), ["powershell.exe", "termux-clipboard-get", "wl-paste"]);
    assert.equal(commands.filter((command) => command === "termux-clipboard-get").length, 1);
  } finally {
    if (platformDescriptor) {
      Object.defineProperty(process, "platform", platformDescriptor);
    }
    if (originalWslDistro === undefined) {
      delete process.env.WSL_DISTRO_NAME;
    } else {
      process.env.WSL_DISTRO_NAME = originalWslDistro;
    }
    if (originalTermuxVersion === undefined) {
      delete process.env.TERMUX_VERSION;
    } else {
      process.env.TERMUX_VERSION = originalTermuxVersion;
    }
    if (originalAndroidRoot === undefined) {
      delete process.env.ANDROID_ROOT;
    } else {
      process.env.ANDROID_ROOT = originalAndroidRoot;
    }
  }
});

void test("resolveEditorDraft logs clipboard command failures before giving up", async () => {
  const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");
  const originalConsoleError = console.error;
  const loggedErrors: string[] = [];

  Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
  console.error = (...args: unknown[]) => {
    loggedErrors.push(args.map((value) => String(value)).join(" "));
  };

  try {
    const ctx = createCommandContext({ editorText: "Paste here: [paste #1]" });

    await assert.rejects(
      resolveEditorDraft(ctx, () => Promise.reject(new Error("pbpaste failed"))),
      /Promptsmith found Pi paste markers/
    );

    assert.match(loggedErrors.join("\n"), /Promptsmith failed to read the clipboard/i);
    assert.match(loggedErrors.join("\n"), /pbpaste failed/i);
  } finally {
    console.error = originalConsoleError;
    if (platformDescriptor) {
      Object.defineProperty(process, "platform", platformDescriptor);
    }
  }
});

void test("clearing the fixed enhancer model in fixed mode falls back to active mode", async () => {
  const runtime = createRuntimeState();
  runtime.replaceSettings({
    ...runtime.getSettings(),
    enhancerModelMode: "fixed",
    fixedEnhancerModel: { provider: "openai", id: "gpt-5" },
  });

  const ctx = createCommandContext();
  const selections = ["Clear"];
  Object.assign(ctx.ui, {
    custom: (_factory: unknown) => Promise.resolve(selections.shift()),
  });

  await runSettingsAction("fixedEnhancerModel", {
    ctx,
    runtime,
    services: {
      refreshStatus: () => undefined,
    },
    settings: runtime.getSettings(),
  });

  assert.equal(runtime.getSettings().enhancerModelMode, "active");
  assert.equal(runtime.getSettings().fixedEnhancerModel, undefined);
});

void test("exact override manual routing picker omits the Clear option", async () => {
  const runtime = createRuntimeState();
  const ctx = createCommandContext({ model: createModel() });
  const selections = ["Choose model manually", undefined, undefined];
  let modelPickerOptions: { label: string; value: string }[] = [];

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
      if (dialog.title === "Choose the model to route") {
        modelPickerOptions = dialog.allItems?.map((item) => ({ ...item })) ?? [];
      }

      return Promise.resolve(selections.shift());
    },
  });

  await runSettingsAction("exactModelOverrides", {
    ctx,
    runtime,
    services: {
      refreshStatus: () => undefined,
    },
    settings: runtime.getSettings(),
  });

  assert.equal(
    modelPickerOptions.some((item) => item.value === "Clear"),
    false
  );
  assert.equal(
    modelPickerOptions.some((item) => item.value === "Manual entry"),
    true
  );
});

void test("exact override removal clears case-variant duplicates and uses the raw model ref value", async () => {
  const runtime = createRuntimeState();
  const modelId = "GPT-5 → preview";
  const rawModelRef = `OpenAI/${modelId}`;
  runtime.replaceSettings({
    ...runtime.getSettings(),
    exactModelOverrides: [
      { provider: "OpenAI", id: modelId, family: "claude" },
      { provider: "openai", id: "gpt-5 → preview", family: "gpt" },
      { provider: "anthropic", id: "claude-3-5-sonnet", family: "claude" },
    ],
  });

  const ctx = createCommandContext();
  const selections = ["Remove rule", rawModelRef, undefined];
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
      if (dialog.title === "Remove exact model style rule") {
        removeRuleOptions = dialog.allItems?.map((item) => ({ ...item })) ?? [];
      }

      return Promise.resolve(selections.shift());
    },
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

  assert.deepEqual(removeRuleOptions[0], {
    label: `${rawModelRef} → claude`,
    value: rawModelRef,
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

void test("settings actions report persistence failures without throwing", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "promptsmith-ui-state-"));
  const filePath = join(tempDir, "not-a-directory");
  writeFileSync(filePath, "x", "utf8");

  const runtime = new PromptsmithRuntimeState(join(filePath, "promptsmith-settings.json"));
  const previousSettings = runtime.getSettings();
  const ctx = createCommandContext();
  let refreshCount = 0;

  await runSettingsAction("enabled", {
    ctx,
    runtime,
    services: {
      refreshStatus: () => {
        refreshCount += 1;
      },
    },
    settings: runtime.getSettings(),
  });

  assert.deepEqual(runtime.getSettings(), previousSettings);
  assert.equal(refreshCount, 1);
  assert.equal(ctx.uiState.notifications.at(-1)?.type, "error");
  assert.match(
    ctx.uiState.notifications.at(-1)?.message ?? "",
    /failed to save promptsmith settings/i
  );
});

void test("pattern override removal uses the raw pattern value and clears case-variant duplicates", async () => {
  const runtime = createRuntimeState();
  const pattern = "openai/with → arrow";
  runtime.replaceSettings({
    ...runtime.getSettings(),
    familyOverrides: [
      { pattern: "OpenAI/with → arrow", family: "claude" },
      { pattern, family: "gpt" },
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

  assert.deepEqual(removeRuleOptions[1], {
    label: `${pattern} → gpt`,
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
