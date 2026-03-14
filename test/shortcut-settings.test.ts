import test from "node:test";
import assert from "node:assert/strict";
import {
  findShortcutConflictAction,
  formatShortcutKey,
  matchesCustomShortcut,
  normalizeShortcutKey,
  validateShortcutKey,
} from "../src/shortcut-key.js";
import { buildStatusReport } from "../src/ui/status.js";
import { createCommandContext, createRuntimeState } from "./helpers.js";

void test("shortcut keys normalize into Pi's canonical format", () => {
  assert.equal(normalizeShortcutKey(" Alt + Shift + P "), "shift+alt+p");
  assert.equal(normalizeShortcutKey("CTRL+return"), "ctrl+enter");
  assert.equal(normalizeShortcutKey("ctrl++"), "ctrl++");
  assert.equal(normalizeShortcutKey("bogus+key"), undefined);
});

void test("shortcut validation rejects plain typing keys and Pi conflicts", () => {
  assert.match(validateShortcutKey("p").error ?? "", /must include alt and\/or ctrl/i);
  assert.match(
    validateShortcutKey("ctrl+p", { cycleModelForward: "ctrl+p" }).error ?? "",
    /already used by pi/i
  );
  assert.equal(validateShortcutKey("ctrl+alt+p").normalized, "ctrl+alt+p");
});

void test("shortcut conflict lookup finds matching built-in actions", () => {
  assert.equal(
    findShortcutConflictAction("ctrl+p", { cycleModelForward: ["ctrl+p", "f7"] }),
    "cycleModelForward"
  );
  assert.equal(findShortcutConflictAction("alt+p", { submit: "enter" }), undefined);
});

void test("matchesCustomShortcut ignores invalid persisted shortcuts", () => {
  const runtime = createRuntimeState();
  const settings = {
    ...runtime.getSettings(),
    shortcutKey: "shift+tab",
  };

  assert.equal(matchesCustomShortcut("\u001b[Z", settings, { submit: "enter" }), false);
});

void test("status report includes the configured shortcut key", () => {
  const runtime = createRuntimeState();
  runtime.replaceSettings({
    ...runtime.getSettings(),
    shortcutKey: "ctrl+alt+p",
  });
  const ctx = createCommandContext();

  const report = buildStatusReport(ctx, runtime);

  assert.match(report, /shortcut key: Ctrl\+Alt\+P/);
  assert.equal(formatShortcutKey("ctrl+alt+p"), "Ctrl+Alt+P");
  assert.equal(formatShortcutKey("ctrl++"), "Ctrl++");
});
