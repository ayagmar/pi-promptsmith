import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_SETTINGS, DEFAULT_SHORTCUT_KEY, EXTENSION_COMMAND } from "../src/constants.js";
import { createPromptsmithExtension } from "../src/index.js";
import { createCommandContext, createMockPi } from "./helpers.js";

void test("extension registers the promptsmith command and shortcut", () => {
  const harness = createMockPi();

  createPromptsmithExtension(harness.pi);

  assert.ok(harness.commands.has(EXTENSION_COMMAND));
  assert.ok(harness.shortcuts.has(DEFAULT_SHORTCUT_KEY));
  assert.ok(!("toolName" in harness));
});

void test("default shortcut does not ignore disabled custom shortcut settings", async () => {
  const originalHome = process.env.HOME;
  const tempHome = mkdtempSync(join(tmpdir(), "promptsmith-home-"));
  process.env.HOME = tempHome;

  try {
    const settingsPath = join(tempHome, ".pi", "agent", "promptsmith-settings.json");
    mkdirSync(join(tempHome, ".pi", "agent"), { recursive: true });
    writeFileSync(
      settingsPath,
      `${JSON.stringify(
        {
          ...DEFAULT_SETTINGS,
          shortcutKey: "ctrl+alt+p",
          shortcutEnabled: false,
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const harness = createMockPi();
    createPromptsmithExtension(harness.pi);

    const ctx = createCommandContext({ editorText: "draft" });
    const sessionStartHandlers = harness.events.get("session_start") ?? [];
    for (const handler of sessionStartHandlers) {
      await handler({}, ctx);
    }

    await harness.shortcuts.get(DEFAULT_SHORTCUT_KEY)?.handler(ctx);

    const messages = ctx.uiState.notifications.map((entry) => entry.message).join("\n");
    assert.match(messages, /shortcut is disabled globally/i);
    assert.doesNotMatch(messages, /shortcut is now ctrl\+alt\+p/i);
  } finally {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
  }
});

void test("custom editor is not reinstalled when the shortcut setting is unchanged", async () => {
  const originalHome = process.env.HOME;
  const tempHome = mkdtempSync(join(tmpdir(), "promptsmith-home-"));
  process.env.HOME = tempHome;

  try {
    const settingsPath = join(tempHome, ".pi", "agent", "promptsmith-settings.json");
    mkdirSync(join(tempHome, ".pi", "agent"), { recursive: true });
    writeFileSync(
      settingsPath,
      `${JSON.stringify(
        {
          ...DEFAULT_SETTINGS,
          shortcutKey: "ctrl+alt+p",
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const harness = createMockPi();
    createPromptsmithExtension(harness.pi);

    const ctx = createCommandContext({ editorText: "draft" });
    for (const handler of harness.events.get("session_start") ?? []) {
      await handler({}, ctx);
    }
    for (const handler of harness.events.get("model_select") ?? []) {
      await handler({}, ctx);
    }

    assert.deepEqual(ctx.uiState.editorComponentHistory, ["set"]);
  } finally {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
  }
});

void test("session shutdown clears the custom editor component", async () => {
  const originalHome = process.env.HOME;
  const tempHome = mkdtempSync(join(tmpdir(), "promptsmith-home-"));
  process.env.HOME = tempHome;

  try {
    const settingsPath = join(tempHome, ".pi", "agent", "promptsmith-settings.json");
    mkdirSync(join(tempHome, ".pi", "agent"), { recursive: true });
    writeFileSync(
      settingsPath,
      `${JSON.stringify(
        {
          ...DEFAULT_SETTINGS,
          shortcutKey: "ctrl+alt+p",
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const harness = createMockPi();
    createPromptsmithExtension(harness.pi);

    const ctx = createCommandContext({ editorText: "draft" });
    for (const handler of harness.events.get("session_start") ?? []) {
      await handler({}, ctx);
    }
    for (const handler of harness.events.get("session_shutdown") ?? []) {
      await handler({}, ctx);
    }

    assert.deepEqual(ctx.uiState.editorComponentHistory, ["set", "clear"]);
  } finally {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
  }
});
