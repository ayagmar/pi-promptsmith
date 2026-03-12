import test from "node:test";
import assert from "node:assert/strict";
import {
  getPromptsmithArgumentCompletions,
  handlePromptsmithCommand,
  parsePromptsmithCommand,
} from "../src/commands.js";
import { handlePromptsmithShortcut } from "../src/shortcut.js";
import { openSettingsUi } from "../src/ui/settings.js";
import {
  createAssistantEntry,
  createCommandContext,
  createCompleteResponse,
  createMockPi,
  createModel,
  createRunTaskStub,
  createRuntimeState,
  createUserEntry,
} from "./helpers.js";

void test("parsePromptsmithCommand splits command name and args", () => {
  assert.deepEqual(parsePromptsmithCommand("map set openai/gpt-5 claude"), {
    name: "map",
    args: ["set", "openai/gpt-5", "claude"],
  });
  assert.deepEqual(parsePromptsmithCommand("  "), { name: "", args: [] });
});

void test("argument completions expose reset-settings", () => {
  assert.deepEqual(getPromptsmithArgumentCompletions("reset-s"), [
    { value: "reset-settings", label: "reset-settings" },
  ]);
});

void test("promptsmith command enhances the current editor draft", async () => {
  const runtime = createRuntimeState();
  const harness = createMockPi();
  const ctx = createCommandContext({ model: createModel(), editorText: "fix this prompt" });

  await handlePromptsmithCommand(
    "",
    ctx,
    runtime,
    createServices(harness, () => Promise.resolve(createCompleteResponse("Enhanced prompt")))
  );

  assert.equal(ctx.uiState.editorText, "Enhanced prompt");
  assert.match(ctx.uiState.notifications.map((entry) => entry.message).join("\n"), /enhanced/i);
});

void test("empty editor opens settings instead of failing", async () => {
  const runtime = createRuntimeState();
  const harness = createMockPi();
  const ctx = createCommandContext({
    model: createModel(),
    editorText: "",
    nextSelectValue: "done",
  });

  await handlePromptsmithCommand(
    "",
    ctx,
    runtime,
    createServices(harness, () => Promise.resolve(createCompleteResponse("unused")))
  );

  assert.deepEqual(ctx.uiState.customTitles, ["Promptsmith settings"]);
  assert.match(ctx.uiState.notifications.at(0)?.message ?? "", /opening promptsmith settings/i);
});

void test("shortcut with empty editor opens settings", async () => {
  const runtime = createRuntimeState();
  const harness = createMockPi();
  const ctx = createCommandContext({
    model: createModel(),
    editorText: "",
    nextSelectValue: "done",
  });

  await handlePromptsmithShortcut(
    ctx,
    runtime,
    createShortcutServices(harness, ctx, () => Promise.resolve(createCompleteResponse("unused")))
  );

  assert.deepEqual(ctx.uiState.selectTitles, ["Promptsmith settings"]);
});

void test("shortcut expands Pi paste markers from the clipboard before enhancement", async () => {
  const runtime = createRuntimeState();
  const ctx = createCommandContext({
    model: createModel(),
    editorText: "[paste #1 +12 lines]",
  });
  const clipboardText = Array.from({ length: 12 }, (_, index) => `line ${index + 1}`).join("\n");

  let requestText = "";
  await handlePromptsmithShortcut(ctx, runtime, {
    completeFn: (_model, context) => {
      const userMessage = context.messages[0];
      if (userMessage?.role === "user" && Array.isArray(userMessage.content)) {
        const textPart = userMessage.content.find(
          (part): part is { type: "text"; text: string } => part.type === "text"
        );
        requestText = textPart?.text ?? "";
      }
      return Promise.resolve(createCompleteResponse("Enhanced prompt"));
    },
    exec: () => Promise.resolve({ stdout: clipboardText, stderr: "", code: 0, killed: false }),
    refreshStatus: () => undefined,
    runCancellableTask: (_ctx, _message, task) => task(new AbortController().signal),
    openSettings: () => Promise.resolve(),
  });

  assert.match(requestText, /line 12/);
  assert.doesNotMatch(requestText, /\[paste #1 \+12 lines\]/);
  assert.equal(ctx.uiState.editorText, "Enhanced prompt");
});

void test("settings ui shows clearer labels and the footer status toggle", async () => {
  const runtime = createRuntimeState();
  const ctx = createCommandContext({ model: createModel(), nextSelectValue: "done" });

  await openSettingsUi(ctx, runtime, { refreshStatus: () => undefined });

  const firstMenu = ctx.uiState.customOptionsHistory[0] ?? [];
  assert.ok(firstMenu.some((option) => /Prompt enhancement · On/i.test(option)));
  assert.ok(firstMenu.some((option) => /Footer status bar · Off/i.test(option)));
  assert.ok(firstMenu.some((option) => /Rewrite mode · Auto/i.test(option)));

  const initialRender = ctx.uiState.customRenderHistory[0]?.join("\n") ?? "";
  assert.match(initialRender, /Master switch for \/promptsmith and Alt\+P/i);
});

void test("default enhancement skips recent conversation context for speed", async () => {
  const runtime = createRuntimeState();
  const harness = createMockPi();
  const ctx = createCommandContext({
    model: createModel(),
    editorText: "short prompt",
    entries: [createUserEntry("older user"), createAssistantEntry("older assistant")],
  });

  let requestText = "";
  await handlePromptsmithCommand(
    "",
    ctx,
    runtime,
    createServices(harness, (_model, context) => {
      const userMessage = context.messages[0];
      if (userMessage?.role === "user" && Array.isArray(userMessage.content)) {
        const textPart = userMessage.content.find(
          (part): part is { type: "text"; text: string } => part.type === "text"
        );
        requestText = textPart?.text ?? "";
      }
      return Promise.resolve(createCompleteResponse("Enhanced prompt"));
    })
  );

  assert.doesNotMatch(requestText, /<recent_conversation>/);
});

void test("preview mode uses the review editor before replacing text", async () => {
  const runtime = createRuntimeState();
  const harness = createMockPi();
  const ctx = createCommandContext({
    model: createModel(),
    editorText: "draft",
    editorResponse: "Reviewed prompt",
  });

  runtime.replaceSettings({ ...runtime.getSettings(), previewBeforeReplace: true });

  await handlePromptsmithCommand(
    "",
    ctx,
    runtime,
    createServices(harness, () => Promise.resolve(createCompleteResponse("Enhanced prompt")))
  );

  assert.equal(ctx.uiState.editorText, "Reviewed prompt");
});

void test("cancelled enhancement leaves the editor unchanged", async () => {
  const runtime = createRuntimeState();
  const harness = createMockPi();
  const ctx = createCommandContext({ model: createModel(), editorText: "original draft" });

  await handlePromptsmithCommand("", ctx, runtime, {
    ...createServices(harness, () => Promise.resolve(createCompleteResponse("unused"))),
    runCancellableTask: () => Promise.resolve(null),
  });

  assert.equal(ctx.uiState.editorText, "original draft");
});

void test("failed enhancement leaves the editor unchanged", async () => {
  const runtime = createRuntimeState();
  const harness = createMockPi();
  const ctx = createCommandContext({ model: createModel(), editorText: "original draft" });

  await handlePromptsmithCommand("", ctx, runtime, {
    ...createServices(harness, () => Promise.resolve(createCompleteResponse("unused"))),
    runCancellableTask: () => Promise.reject(new Error("bad output")),
  });

  assert.equal(ctx.uiState.editorText, "original draft");
  assert.match(ctx.uiState.notifications.at(-1)?.message ?? "", /bad output/);
});

void test("hung enhancement times out and leaves the editor unchanged", async () => {
  const runtime = createRuntimeState();
  const harness = createMockPi();
  const ctx = createCommandContext({ model: createModel(), editorText: "original draft" });

  runtime.replaceSettings({ ...runtime.getSettings(), enhancementTimeoutMs: 5 });

  await handlePromptsmithCommand(
    "",
    ctx,
    runtime,
    createServices(
      harness,
      (_model, _context, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener(
            "abort",
            () => {
              const error = new Error("aborted");
              error.name = "AbortError";
              reject(error);
            },
            { once: true }
          );
        })
    )
  );

  assert.equal(ctx.uiState.editorText, "original draft");
  assert.match(ctx.uiState.notifications.at(-1)?.message ?? "", /timed out/i);
});

void test("mode command updates rewrite mode to execution-contract", async () => {
  const runtime = createRuntimeState();
  const harness = createMockPi();
  const ctx = createCommandContext({ model: createModel() });

  await handlePromptsmithCommand(
    "mode execution-contract",
    ctx,
    runtime,
    createServices(harness, () => Promise.resolve(createCompleteResponse("unused")))
  );

  assert.equal(runtime.getSettings().rewriteMode, "execution-contract");
  assert.match(ctx.uiState.notifications.at(-1)?.message ?? "", /execution-contract/);
});

void test("mode command updates rewrite mode to plain", async () => {
  const runtime = createRuntimeState();
  const harness = createMockPi();
  const ctx = createCommandContext({ model: createModel() });

  await handlePromptsmithCommand(
    "mode plain",
    ctx,
    runtime,
    createServices(harness, () => Promise.resolve(createCompleteResponse("unused")))
  );

  assert.equal(runtime.getSettings().rewriteMode, "plain");
});

void test("mode command updates rewrite mode to auto", async () => {
  const runtime = createRuntimeState();
  const harness = createMockPi();
  const ctx = createCommandContext({ model: createModel() });

  runtime.replaceSettings({ ...runtime.getSettings(), rewriteMode: "plain" });

  await handlePromptsmithCommand(
    "mode auto",
    ctx,
    runtime,
    createServices(harness, () => Promise.resolve(createCompleteResponse("unused")))
  );

  assert.equal(runtime.getSettings().rewriteMode, "auto");
});

void test("mode command rejects invalid values clearly", async () => {
  const runtime = createRuntimeState();
  const harness = createMockPi();
  const ctx = createCommandContext({ model: createModel() });

  await handlePromptsmithCommand(
    "mode noisy",
    ctx,
    runtime,
    createServices(harness, () => Promise.resolve(createCompleteResponse("unused")))
  );

  assert.equal(runtime.getSettings().rewriteMode, "auto");
  assert.match(
    ctx.uiState.notifications.at(-1)?.message ?? "",
    /mode auto\|plain\|execution-contract/i
  );
});

void test("enhancer-model active clears stale fixed and family-linked config", async () => {
  const runtime = createRuntimeState();
  const harness = createMockPi();
  const ctx = createCommandContext({ model: createModel() });

  runtime.replaceSettings({
    ...runtime.getSettings(),
    enhancerModelMode: "family-linked",
    fixedEnhancerModel: { provider: "openai", id: "gpt-5" },
    familyEnhancerModels: {
      gpt: { provider: "openai", id: "gpt-5" },
      claude: { provider: "anthropic", id: "claude-3-5-sonnet" },
    },
  });

  await handlePromptsmithCommand(
    "enhancer-model active",
    ctx,
    runtime,
    createServices(harness, () => Promise.resolve(createCompleteResponse("unused")))
  );

  assert.equal(runtime.getSettings().enhancerModelMode, "active");
  assert.equal(runtime.getSettings().fixedEnhancerModel, undefined);
  assert.equal(runtime.getSettings().familyEnhancerModels, undefined);
});

void test("enhancer-model fixed clears stale family-linked config", async () => {
  const runtime = createRuntimeState();
  const harness = createMockPi();
  const ctx = createCommandContext({ model: createModel() });

  runtime.replaceSettings({
    ...runtime.getSettings(),
    enhancerModelMode: "family-linked",
    familyEnhancerModels: {
      gpt: { provider: "openai", id: "gpt-5" },
      claude: { provider: "anthropic", id: "claude-3-5-sonnet" },
    },
  });

  await handlePromptsmithCommand(
    "enhancer-model fixed openai/gpt-5",
    ctx,
    runtime,
    createServices(harness, () => Promise.resolve(createCompleteResponse("unused")))
  );

  assert.equal(runtime.getSettings().enhancerModelMode, "fixed");
  assert.deepEqual(runtime.getSettings().fixedEnhancerModel, { provider: "openai", id: "gpt-5" });
  assert.equal(runtime.getSettings().familyEnhancerModels, undefined);
});

void test("status-bar command updates the saved footer status setting", async () => {
  const runtime = createRuntimeState();
  const harness = createMockPi();
  const ctx = createCommandContext({ model: createModel() });

  await handlePromptsmithCommand(
    "status-bar on",
    ctx,
    runtime,
    createServices(harness, () => Promise.resolve(createCompleteResponse("unused")))
  );

  assert.equal(runtime.getSettings().statusBarEnabled, true);
  assert.match(ctx.uiState.notifications.at(-1)?.message ?? "", /status bar setting updated/i);
});

void test("timeout command updates the saved project setting", async () => {
  const runtime = createRuntimeState();
  const harness = createMockPi();
  const ctx = createCommandContext({ model: createModel() });

  await handlePromptsmithCommand(
    "timeout 12",
    ctx,
    runtime,
    createServices(harness, () => Promise.resolve(createCompleteResponse("unused")))
  );

  assert.equal(runtime.getSettings().enhancementTimeoutMs, 12_000);
  assert.match(ctx.uiState.notifications.at(-1)?.message ?? "", /12 seconds/);
});

void test("timeout command rejects values outside the supported range", async () => {
  const runtime = createRuntimeState();
  const harness = createMockPi();
  const ctx = createCommandContext({ model: createModel() });

  await handlePromptsmithCommand(
    "timeout 4",
    ctx,
    runtime,
    createServices(harness, () => Promise.resolve(createCompleteResponse("unused")))
  );

  assert.equal(runtime.getSettings().enhancementTimeoutMs, 45_000);
  assert.match(ctx.uiState.notifications.at(-1)?.message ?? "", /timeout <seconds> \(5-300\)/i);
});

void test("undo restores the previous draft after successful enhancement", async () => {
  const runtime = createRuntimeState();
  const harness = createMockPi();
  const ctx = createCommandContext({ model: createModel(), editorText: "first draft" });
  const services = createServices(harness, () =>
    Promise.resolve(createCompleteResponse("second draft"))
  );

  await handlePromptsmithCommand("", ctx, runtime, services);
  assert.equal(ctx.uiState.editorText, "second draft");

  await handlePromptsmithCommand("undo", ctx, runtime, services);
  assert.equal(ctx.uiState.editorText, "first draft");
});

void test("second enhancement request while busy is rejected", async () => {
  const runtime = createRuntimeState();
  const harness = createMockPi();
  const ctx = createCommandContext({ model: createModel(), editorText: "draft" });

  let resolveFirst: ((value: string | null) => void) | undefined;
  const firstTask = new Promise<string | null>((resolve) => {
    resolveFirst = resolve;
  });

  const services = {
    ...createServices(harness, () => Promise.resolve(createCompleteResponse("unused"))),
    runCancellableTask: () => firstTask,
  };

  const firstPromise = handlePromptsmithCommand("", ctx, runtime, services);
  await Promise.resolve();
  await handlePromptsmithCommand("", ctx, runtime, services);
  resolveFirst?.("done");
  await firstPromise;

  assert.match(
    ctx.uiState.notifications.map((entry) => entry.message).join("\n"),
    /already enhancing/
  );
});

void test("theme enumeration alone does not block enhancement", async () => {
  const runtime = createRuntimeState();
  const harness = createMockPi();
  const ctx = createCommandContext({
    model: createModel(),
    editorText: "draft",
    themeCount: 0,
  });

  await handlePromptsmithCommand("", ctx, runtime, {
    ...createServices(harness, () => Promise.resolve(createCompleteResponse("Enhanced prompt"))),
    runCancellableTask: createRunTaskStub("__RUN_TASK__"),
  });

  assert.equal(ctx.uiState.editorText, "Enhanced prompt");
  assert.doesNotMatch(
    ctx.uiState.notifications.map((entry) => entry.message).join("\n"),
    /RPC mode/
  );
});

void test("reset-settings restores default settings", async () => {
  const runtime = createRuntimeState();
  const harness = createMockPi();
  const ctx = createCommandContext({ model: createModel() });

  runtime.replaceSettings({
    ...runtime.getSettings(),
    rewriteMode: "plain",
    statusBarEnabled: true,
    enhancementTimeoutMs: 12_000,
  });

  await handlePromptsmithCommand(
    "reset-settings",
    ctx,
    runtime,
    createServices(harness, () => Promise.resolve(createCompleteResponse("unused")))
  );

  assert.equal(runtime.getSettings().rewriteMode, "auto");
  assert.equal(runtime.getSettings().statusBarEnabled, false);
  assert.equal(runtime.getSettings().enhancementTimeoutMs, 45_000);
});

void test("shortcut starts enhancement without waiting for a timer tick", async () => {
  const runtime = createRuntimeState();
  const harness = createMockPi();
  const ctx = createCommandContext({ model: createModel(), editorText: "draft" });

  const originalSetTimeout = globalThis.setTimeout;
  let scheduledTimeouts = 0;
  globalThis.setTimeout = ((
    callback: (...args: unknown[]) => void,
    delay?: number,
    ...args: unknown[]
  ) => {
    scheduledTimeouts += 1;
    return originalSetTimeout(callback, delay, ...args);
  }) as typeof globalThis.setTimeout;

  try {
    await handlePromptsmithShortcut(
      ctx,
      runtime,
      createShortcutServices(harness, ctx, () =>
        Promise.resolve(createCompleteResponse("Enhanced"))
      )
    );
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }

  assert.equal(scheduledTimeouts, 0);
  assert.equal(ctx.uiState.editorText, "Enhanced");
});

void test("shortcut respects enabled and shortcutEnabled settings", async () => {
  const runtime = createRuntimeState();
  const harness = createMockPi();
  const ctx = createCommandContext({ model: createModel(), editorText: "draft" });

  runtime.replaceSettings({ ...runtime.getSettings(), enabled: false });
  await handlePromptsmithShortcut(
    ctx,
    runtime,
    createShortcutServices(harness, ctx, () => Promise.resolve(createCompleteResponse("unused")))
  );
  assert.match(ctx.uiState.notifications.at(-1)?.message ?? "", /disabled/);

  runtime.replaceSettings({ ...runtime.getSettings(), enabled: true, shortcutEnabled: false });
  await handlePromptsmithShortcut(
    ctx,
    runtime,
    createShortcutServices(harness, ctx, () => Promise.resolve(createCompleteResponse("unused")))
  );
  assert.match(ctx.uiState.notifications.at(-1)?.message ?? "", /shortcut is disabled/i);
});

function createServices(
  harness: ReturnType<typeof createMockPi>,
  completeFn: Parameters<typeof handlePromptsmithCommand>[3]["completeFn"],
  overrides: Partial<Parameters<typeof handlePromptsmithCommand>[3]> = {}
): Parameters<typeof handlePromptsmithCommand>[3] {
  return {
    completeFn,
    exec: harness.pi.exec.bind(harness.pi),
    refreshStatus: () => undefined,
    runCancellableTask: (_ctx, _message, task) => task(new AbortController().signal),
    ...overrides,
  };
}

function createShortcutServices(
  harness: ReturnType<typeof createMockPi>,
  ctx: ReturnType<typeof createCommandContext>,
  completeFn: Parameters<typeof handlePromptsmithShortcut>[2]["completeFn"]
): Parameters<typeof handlePromptsmithShortcut>[2] {
  return {
    completeFn,
    exec: harness.pi.exec.bind(harness.pi),
    refreshStatus: () => undefined,
    runCancellableTask: (_ctx, _message, task) => task(new AbortController().signal),
    openSettings: () => ctx.ui.select("Promptsmith settings", ["Done"]).then(() => undefined),
  };
}
