import test from "node:test";
import assert from "node:assert/strict";
import { EXTENSION_COMMAND, SHORTCUT_KEY } from "../src/constants.js";
import { createPromptsmithExtension } from "../src/index.js";
import { createMockPi } from "./helpers.js";

void test("extension registers the promptsmith command and shortcut", () => {
  const harness = createMockPi();

  createPromptsmithExtension(harness.pi);

  assert.ok(harness.commands.has(EXTENSION_COMMAND));
  assert.ok(harness.shortcuts.has(SHORTCUT_KEY));
  assert.ok(!("toolName" in harness));
});
