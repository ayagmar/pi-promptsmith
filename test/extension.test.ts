import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SHORTCUT_KEY, EXTENSION_COMMAND } from "../src/constants.js";
import { createPromptsmithExtension } from "../src/index.js";
import { createCommandContext, createMockPi, createPersistedRuntimeState } from "./helpers.js";

void test("extension registers the promptsmith command and shortcut", () => {
  const harness = createMockPi();

  createPromptsmithExtension(harness.pi);

  assert.ok(harness.commands.has(EXTENSION_COMMAND));
  assert.ok(harness.shortcuts.has(DEFAULT_SHORTCUT_KEY));
  assert.ok(!("toolName" in harness));
});

void test("default shortcut does not ignore disabled custom shortcut settings", async () => {
  const harness = createMockPi();
  const runtime = createPersistedRuntimeState({
    shortcutKey: "ctrl+alt+p",
    shortcutEnabled: false,
  });
  createPromptsmithExtension(harness.pi, { runtime });

  const ctx = createCommandContext({ editorText: "draft" });
  const sessionStartHandlers = harness.events.get("session_start") ?? [];
  for (const handler of sessionStartHandlers) {
    await handler({}, ctx);
  }

  await harness.shortcuts.get(DEFAULT_SHORTCUT_KEY)?.handler(ctx);

  const messages = ctx.uiState.notifications.map((entry) => entry.message).join("\n");
  assert.match(messages, /shortcut is disabled globally/i);
  assert.doesNotMatch(messages, /shortcut is now ctrl\+alt\+p/i);
});

void test("custom editor is not reinstalled when the shortcut setting is unchanged", async () => {
  const harness = createMockPi();
  const runtime = createPersistedRuntimeState({ shortcutKey: "ctrl+alt+p" });
  createPromptsmithExtension(harness.pi, { runtime });

  const ctx = createCommandContext({ editorText: "draft" });
  for (const handler of harness.events.get("session_start") ?? []) {
    await handler({}, ctx);
  }
  for (const handler of harness.events.get("model_select") ?? []) {
    await handler({}, ctx);
  }

  assert.equal(ctx.uiState.editorComponentHistory.length, 1);
  assert.equal(ctx.uiState.editorComponentHistory[0]?.kind, "set");
});

void test("session shutdown restores an existing custom editor component", async () => {
  const existingFactory = () => ({
    render: () => [],
    invalidate: () => undefined,
    handleInput: () => undefined,
    getText: () => "",
    setText: () => undefined,
  });
  const harness = createMockPi();
  const runtime = createPersistedRuntimeState({ shortcutKey: "ctrl+alt+p" });
  createPromptsmithExtension(harness.pi, { runtime });

  const ctx = createCommandContext({
    editorText: "draft",
    editorComponentFactory: existingFactory,
  });
  for (const handler of harness.events.get("session_start") ?? []) {
    await handler({}, ctx);
  }
  assert.notEqual(ctx.ui.getEditorComponent(), existingFactory);

  for (const handler of harness.events.get("session_shutdown") ?? []) {
    await handler({}, ctx);
  }

  const history = ctx.uiState.editorComponentHistory;
  assert.equal(ctx.ui.getEditorComponent(), existingFactory);
  assert.equal(history.length, 2);
  assert.equal(history[0]?.kind, "set");
  assert.equal(history[1]?.kind, "set");
  assert.notEqual(history[0]?.kind === "set" ? history[0].factory : undefined, existingFactory);
  assert.equal(history[1]?.kind === "set" ? history[1].factory : undefined, existingFactory);
});

void test("session shutdown clears the custom editor component", async () => {
  const harness = createMockPi();
  const runtime = createPersistedRuntimeState({ shortcutKey: "ctrl+alt+p" });
  createPromptsmithExtension(harness.pi, { runtime });

  const ctx = createCommandContext({ editorText: "draft" });
  for (const handler of harness.events.get("session_start") ?? []) {
    await handler({}, ctx);
  }
  for (const handler of harness.events.get("session_shutdown") ?? []) {
    await handler({}, ctx);
  }

  assert.deepEqual(
    ctx.uiState.editorComponentHistory.map((entry) => entry.kind),
    ["set", "clear"]
  );
});
