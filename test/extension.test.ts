import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { type CustomEditor } from "@earendil-works/pi-coding-agent";
import { KeybindingsManager, TUI_KEYBINDINGS } from "@earendil-works/pi-tui";
import { DEFAULT_SETTINGS, DEFAULT_SHORTCUT_KEY, EXTENSION_COMMAND } from "../src/constants.js";
import { createPromptsmithExtension } from "../src/index.js";
import { PromptsmithRuntimeState } from "../src/state.js";
import { createBasePromptsmithEditor } from "../src/ui/promptsmith-editor.js";
import {
  createCommandContext,
  createMockPi,
  createPersistedRuntimeState,
  createRuntimeState,
} from "./helpers.js";

void test("extension registers the promptsmith command and shortcut", () => {
  const harness = createMockPi();

  createPromptsmithExtension(harness.pi, { runtime: createRuntimeState() });

  assert.ok(harness.commands.has(EXTENSION_COMMAND));
  assert.ok(harness.shortcuts.has(DEFAULT_SHORTCUT_KEY));
  assert.ok(!("toolName" in harness));
});

void test("extension leaves Alt+P to pi when pi's keybindings reserve it", () => {
  const harness = createMockPi();

  createPromptsmithExtension(harness.pi, {
    runtime: createRuntimeState({ defaultShortcutReservedAction: "app.model.cycleBackward" }),
  });

  assert.ok(harness.commands.has(EXTENSION_COMMAND));
  assert.equal(harness.shortcuts.has(DEFAULT_SHORTCUT_KEY), false);
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

void test("session start warns when the saved settings cannot be read", async () => {
  const harness = createMockPi();
  const storageDir = mkdtempSync(join(tmpdir(), "promptsmith-extension-"));
  const settingsPath = join(storageDir, "promptsmith-settings.json");
  writeFileSync(settingsPath, "{ not json", "utf8");
  createPromptsmithExtension(harness.pi, { runtime: new PromptsmithRuntimeState(settingsPath) });

  const ctx = createCommandContext();
  for (const handler of harness.events.get("session_start") ?? []) {
    await handler({}, ctx);
  }

  const warning = ctx.uiState.notifications.at(-1);
  assert.equal(warning?.type, "warning");
  assert.match(warning?.message ?? "", /could not parse/);
});

void test("an unreadable settings file warns once, not on every tree navigation", async () => {
  const harness = createMockPi();
  const storageDir = mkdtempSync(join(tmpdir(), "promptsmith-extension-"));
  const settingsPath = join(storageDir, "promptsmith-settings.json");
  writeFileSync(settingsPath, "{ not json", "utf8");
  createPromptsmithExtension(harness.pi, {
    runtime: new PromptsmithRuntimeState(settingsPath, () => undefined),
  });

  const ctx = createCommandContext();
  const fire = async (event: string): Promise<void> => {
    for (const handler of harness.events.get(event) ?? []) {
      await handler({}, ctx);
    }
  };
  const warnings = (): number =>
    ctx.uiState.notifications.filter((entry) => entry.type === "warning").length;

  await fire("session_start");
  await fire("session_tree");
  await fire("session_tree");
  assert.equal(warnings(), 1);

  writeFileSync(settingsPath, JSON.stringify(DEFAULT_SETTINGS), "utf8");
  await fire("session_tree");
  assert.equal(warnings(), 1);

  writeFileSync(settingsPath, "{ not json", "utf8");
  await fire("session_tree");
  assert.equal(warnings(), 2);
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

void test("custom editor is only installed in TUI mode", async () => {
  const harness = createMockPi();
  const runtime = createPersistedRuntimeState({ shortcutKey: "ctrl+alt+p" });
  createPromptsmithExtension(harness.pi, { runtime });

  const ctx = createCommandContext({ mode: "rpc", editorText: "draft" });
  for (const handler of harness.events.get("session_start") ?? []) {
    await handler({}, ctx);
  }
  for (const handler of harness.events.get("session_shutdown") ?? []) {
    await handler({}, ctx);
  }

  assert.equal(ctx.uiState.editorComponentHistory.length, 0);
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

void test("the fallback editor embeds pi's working indicator like pi's default editor", () => {
  const tui = { requestRender: () => undefined, terminal: { rows: 40, columns: 80 } };
  const theme = {
    borderColor: (text: string) => text,
    selectList: {
      selectedPrefix: (text: string) => text,
      selectedText: (text: string) => text,
      description: (text: string) => text,
      scrollInfo: (text: string) => text,
      noMatch: (text: string) => text,
    },
  };

  const editor = createBasePromptsmithEditor(
    tui as unknown as Parameters<typeof createBasePromptsmithEditor>[0],
    theme,
    new KeybindingsManager(TUI_KEYBINDINGS) as unknown as Parameters<
      typeof createBasePromptsmithEditor
    >[2]
  );

  assert.equal((editor as CustomEditor).embedWorkingStatus, true);
});
