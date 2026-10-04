import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DEFAULT_SETTINGS } from "../src/constants.js";
import {
  findDefaultShortcutReservedAction,
  readPiKeybindingsEnvironment,
  usesWindowsKeybindings,
} from "../src/pi-keybindings.js";
import {
  findShortcutConflictAction,
  formatShortcutKey,
  getCustomShortcutKey,
  matchesCustomShortcut,
  normalizeShortcutKey,
  validateShortcutKey,
} from "../src/shortcut-key.js";
import { sanitizeSettings } from "../src/state.js";
import { buildStatusReport } from "../src/ui/status.js";
import { createCommandContext, createRuntimeState } from "./helpers.js";

void test("shortcut keys normalize into Pi's canonical format", () => {
  assert.equal(normalizeShortcutKey(" Alt + Shift + P "), "shift+alt+p");
  assert.equal(normalizeShortcutKey("CTRL+return"), "ctrl+enter");
  assert.equal(normalizeShortcutKey("ctrl++"), "ctrl++");
  assert.equal(normalizeShortcutKey("bogus+key"), undefined);
});

void test("shortcut validation rejects plain typing keys and Pi conflicts", () => {
  assert.match(validateShortcutKey("p").error ?? "", /must include ctrl, alt or super/i);

  const conflict = validateShortcutKey("ctrl+p", {
    "app.model.cycleForward": "ctrl+p",
  }).error;
  assert.match(conflict ?? "", /already used by pi/i);
  assert.match(conflict ?? "", /model cycle forward/i);

  assert.equal(validateShortcutKey("ctrl+alt+p").normalized, "ctrl+alt+p");
});

void test("every shortcut the capture dialog accepts also works in the editor", () => {
  const settings = createRuntimeState().getSettings();
  const accepted = ["alt+1", "ctrl+alt+/", "ctrl+alt+insert", "ctrl+alt+pageup", "super+k"];

  for (const shortcutKey of accepted) {
    const normalized = validateShortcutKey(shortcutKey).normalized;
    assert.equal(normalized, shortcutKey);
    assert.equal(getCustomShortcutKey({ ...settings, shortcutKey }), shortcutKey);
  }

  assert.equal(matchesCustomShortcut("\u001b1", { ...settings, shortcutKey: "alt+1" }, {}), true);
  assert.equal(matchesCustomShortcut("\u001b/", { ...settings, shortcutKey: "alt+/" }, {}), true);
});

void test("shortcut validation rejects keys pi cannot match with modifiers", () => {
  const settings = createRuntimeState().getSettings();

  for (const shortcutKey of ["alt+f5", "ctrl+alt+escape", "alt+esc"]) {
    assert.match(validateShortcutKey(shortcutKey).error ?? "", /escape or f1-f12/i);
    assert.equal(getCustomShortcutKey({ ...settings, shortcutKey }), undefined);
  }
});

void test("shortcut validation rejects the + key, which pi cannot match", () => {
  const settings = createRuntimeState().getSettings();

  for (const shortcutKey of ["alt++", "ctrl+alt++"]) {
    assert.match(validateShortcutKey(shortcutKey).error ?? "", /cannot match the \+ key/i);
    assert.equal(getCustomShortcutKey({ ...settings, shortcutKey }), undefined);
  }

  assert.equal(
    sanitizeSettings({ ...DEFAULT_SETTINGS, shortcutKey: "alt++" })?.shortcutKey,
    DEFAULT_SETTINGS.shortcutKey
  );
});

void test("shortcut conflict lookup finds matching built-in actions", () => {
  assert.equal(
    findShortcutConflictAction("ctrl+p", { "app.model.cycleForward": ["ctrl+p", "f7"] }),
    "app.model.cycleForward"
  );
  assert.equal(findShortcutConflictAction("alt+p", { "tui.input.submit": "enter" }), undefined);
});

void test("matchesCustomShortcut ignores invalid persisted shortcuts", () => {
  const runtime = createRuntimeState();
  const settings = {
    ...runtime.getSettings(),
    shortcutKey: "shift+tab",
  };

  assert.equal(matchesCustomShortcut("\u001b[Z", settings, { "tui.input.submit": "enter" }), false);
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

void test("pi uses its Windows keybindings on Windows and WSL", () => {
  assert.equal(usesWindowsKeybindings("win32", {}), true);
  assert.equal(usesWindowsKeybindings("linux", { WSL_DISTRO_NAME: "Ubuntu" }), true);
  assert.equal(usesWindowsKeybindings("linux", { WSL_INTEROP: "/run/WSL/1_interop" }), true);
  assert.equal(usesWindowsKeybindings("linux", {}), false);
  assert.equal(usesWindowsKeybindings("darwin", { WSL_DISTRO_NAME: "Ubuntu" }), false);
});

void test("Alt+P is reserved by pi's default keybindings only with Windows defaults", () => {
  assert.equal(
    findDefaultShortcutReservedAction({ userKeybindings: undefined, windowsDefaults: true }),
    "app.model.cycleBackward"
  );
  assert.equal(
    findDefaultShortcutReservedAction({ userKeybindings: undefined, windowsDefaults: false }),
    undefined
  );
});

void test("Alt+P reservation follows the user's keybindings.json", () => {
  // Windows user who moved previous-model off Alt+P: Alt+P is free again.
  assert.equal(
    findDefaultShortcutReservedAction({
      userKeybindings: { "app.model.cycleBackward": "shift+ctrl+p" },
      windowsDefaults: true,
    }),
    undefined
  );
  // Legacy names are migrated the way pi does.
  assert.equal(
    findDefaultShortcutReservedAction({
      userKeybindings: { cycleModelBackward: ["shift+ctrl+p"] },
      windowsDefaults: true,
    }),
    undefined
  );
  // Linux user who bound a reserved action to Alt+P.
  assert.equal(
    findDefaultShortcutReservedAction({
      userKeybindings: { "app.model.select": ["ctrl+l", "Alt+P"] },
      windowsDefaults: false,
    }),
    "app.model.select"
  );
  // Non-reserved actions only make pi warn, so Promptsmith still registers Alt+P.
  assert.equal(
    findDefaultShortcutReservedAction({
      userKeybindings: { "app.session.tree": "alt+p" },
      windowsDefaults: false,
    }),
    undefined
  );
});

void test("Alt+P reservation reads keybindings.json from pi's agent dir", () => {
  const agentDir = mkdtempSync(join(tmpdir(), "promptsmith-keybindings-"));
  writeFileSync(
    join(agentDir, "keybindings.json"),
    JSON.stringify({ "app.model.cycleBackward": "shift+ctrl+p" }),
    "utf8"
  );
  const remapped = readPiKeybindingsEnvironment(agentDir, "win32", {});
  assert.equal(findDefaultShortcutReservedAction(remapped), undefined);

  writeFileSync(join(agentDir, "keybindings.json"), "{ not json", "utf8");
  const unreadable = readPiKeybindingsEnvironment(agentDir, "win32", {});
  assert.equal(findDefaultShortcutReservedAction(unreadable), "app.model.cycleBackward");
});

void test("status report notes when pi's keybindings hold Alt+P", () => {
  const runtime = createRuntimeState({ defaultShortcutReservedAction: "app.model.select" });
  const report = buildStatusReport(createCommandContext(), runtime);

  assert.match(report, /shortcut key: Alt\+P \(used by Pi for model select;/);
  assert.doesNotMatch(
    buildStatusReport(createCommandContext(), createRuntimeState()),
    /used by Pi/
  );
});
