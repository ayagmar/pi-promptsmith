import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setFamilyEnhancerModel } from "../src/enhancer-settings.js";
import { resolveEnhancerModel } from "../src/model-selection.js";
import { matchesPattern, resolveTargetFamily } from "../src/model-routing.js";
import {
  removeExactModelOverride,
  removeFamilyOverride,
  upsertExactModelOverride,
  upsertFamilyOverride,
} from "../src/overrides.js";
import { PromptsmithRuntimeState, sanitizeSettings } from "../src/state.js";
import { detectRuntimeSupport } from "../src/validation.js";
import { createCommandContext, createModel, createRuntimeState } from "./helpers.js";

void test("target family resolution honors exact overrides and pattern overrides", () => {
  const settings = {
    ...createRuntimeState().getSettings(),
    exactModelOverrides: [{ provider: "OpenAI", id: "GPT-5", family: "claude" as const }],
    familyOverrides: [{ pattern: "moonshot/*", family: "claude" as const }],
  };

  assert.equal(resolveTargetFamily(settings, createModel()).family, "claude");
  assert.equal(
    resolveTargetFamily(settings, createModel({ provider: "moonshot", id: "kimi-k2" })).family,
    "claude"
  );
});

void test("target family resolution falls back to built-in defaults and fallback family", () => {
  const runtime = createRuntimeState();
  const settings = runtime.getSettings();

  assert.equal(
    resolveTargetFamily(settings, createModel({ provider: "openai", id: "o3" })).family,
    "gpt"
  );
  assert.equal(
    resolveTargetFamily(settings, createModel({ provider: "moonshot", id: "kimi-k2" })).family,
    "claude"
  );
  assert.equal(
    resolveTargetFamily(
      { ...settings, fallbackFamily: "claude" },
      createModel({ provider: "custom", id: "x1" })
    ).family,
    "claude"
  );
});

void test("upsertExactModelOverride replaces case-variant duplicates", () => {
  const next = upsertExactModelOverride(
    {
      ...createRuntimeState().getSettings(),
      exactModelOverrides: [{ provider: "OpenAI", id: "GPT-5", family: "gpt" as const }],
    },
    { provider: "openai", id: "gpt-5" },
    "claude"
  );

  assert.deepEqual(next.exactModelOverrides, [
    { provider: "openai", id: "gpt-5", family: "claude" },
  ]);
});

void test("removeExactModelOverride clears case-variant duplicates", () => {
  const next = removeExactModelOverride(
    {
      ...createRuntimeState().getSettings(),
      exactModelOverrides: [
        { provider: "OpenAI", id: "GPT-5", family: "gpt" as const },
        { provider: "openai", id: "gpt-5", family: "claude" as const },
        { provider: "anthropic", id: "claude-3-5-sonnet", family: "claude" as const },
      ],
    },
    { provider: "openai", id: "gpt-5" }
  );

  assert.deepEqual(next.exactModelOverrides, [
    { provider: "anthropic", id: "claude-3-5-sonnet", family: "claude" },
  ]);
});

void test("upsertFamilyOverride replaces case-variant duplicate patterns", () => {
  const next = upsertFamilyOverride(
    {
      ...createRuntimeState().getSettings(),
      familyOverrides: [{ pattern: "OpenAI/*", family: "gpt" as const }],
    },
    "openai/*",
    "claude"
  );

  assert.deepEqual(next.familyOverrides, [{ pattern: "openai/*", family: "claude" }]);
});

void test("removeFamilyOverride clears case-variant duplicate patterns", () => {
  const next = removeFamilyOverride(
    {
      ...createRuntimeState().getSettings(),
      familyOverrides: [
        { pattern: "OpenAI/*", family: "gpt" as const },
        { pattern: "openai/*", family: "claude" as const },
        { pattern: "moonshot/*", family: "claude" as const },
      ],
    },
    "openai/*"
  );

  assert.deepEqual(next.familyOverrides, [{ pattern: "moonshot/*", family: "claude" }]);
});

void test("matchesPattern supports provider and raw model-id globs", () => {
  assert.equal(matchesPattern("openai/*", "openai/gpt-5", "gpt-5"), true);
  assert.equal(matchesPattern("kimi-*", "moonshot/kimi-k2", "kimi-k2"), true);
  assert.equal(matchesPattern("anthropic/*", "openai/gpt-5", "gpt-5"), false);
});

void test("resolveEnhancerModel validates configuration and API keys", async () => {
  const model = createModel();
  const ctx = createCommandContext({ model, allModels: [model] });
  const settings = createRuntimeState().getSettings();

  const resolved = await resolveEnhancerModel(settings, "gpt", model, ctx.modelRegistry);
  assert.equal(resolved.label, "active (openai/gpt-5)");

  await assert.rejects(
    resolveEnhancerModel(
      { ...settings, enhancerModelMode: "fixed" },
      "gpt",
      model,
      ctx.modelRegistry
    ),
    /no fixed enhancer model is configured/i
  );

  await assert.rejects(
    resolveEnhancerModel(
      { ...settings, enhancerModelMode: "bogus" as never },
      "gpt",
      model,
      ctx.modelRegistry
    ),
    /unsupported enhancer-model mode: bogus/i
  );

  const noKeyCtx = createCommandContext({
    model,
    allModels: [model],
    apiKeys: new Map([["openai/gpt-5", undefined]]),
  });
  await assert.rejects(
    resolveEnhancerModel(settings, "gpt", model, noKeyCtx.modelRegistry),
    /could not resolve api credentials/i
  );
});

void test("setFamilyEnhancerModel clears orphaned partial family selections", () => {
  const runtime = createRuntimeState();
  const gptModel = { provider: "openai", id: "gpt-5" };
  const claudeModel = { provider: "anthropic", id: "claude-3-5-sonnet" };

  const partial = setFamilyEnhancerModel(
    {
      ...runtime.getSettings(),
      enhancerModelMode: "fixed",
      fixedEnhancerModel: gptModel,
    },
    "gpt",
    gptModel
  );

  assert.equal(partial.enhancerModelMode, "active");
  assert.equal(partial.fixedEnhancerModel, undefined);
  assert.equal(partial.familyEnhancerModels, undefined);

  const linked = setFamilyEnhancerModel(
    {
      ...runtime.getSettings(),
      enhancerModelMode: "family-linked",
      familyEnhancerModels: { gpt: gptModel },
    },
    "claude",
    claudeModel
  );

  assert.equal(linked.enhancerModelMode, "family-linked");
  assert.deepEqual(linked.familyEnhancerModels, {
    gpt: gptModel,
    claude: claudeModel,
  });
});

void test("settings persist across sessions globally", () => {
  const storageDir = mkdtempSync(join(tmpdir(), "promptsmith-state-"));
  const settingsPath = join(storageDir, "promptsmith-settings.json");
  const runtime = new PromptsmithRuntimeState(settingsPath);

  runtime.persistSettings({
    ...runtime.getSettings(),
    enabled: false,
    statusBarEnabled: true,
    shortcutKey: "ctrl+alt+p",
    rewriteMode: "plain",
    enhancementTimeoutMs: 12_000,
  });

  const restoredRuntime = new PromptsmithRuntimeState(settingsPath);
  restoredRuntime.restoreSettings();

  assert.equal(restoredRuntime.getSettings().enabled, false);
  assert.equal(restoredRuntime.getSettings().statusBarEnabled, true);
  assert.equal(restoredRuntime.getSettings().shortcutKey, "ctrl+alt+p");
  assert.equal(restoredRuntime.getSettings().rewriteMode, "plain");
  assert.equal(restoredRuntime.getSettings().enhancementTimeoutMs, 12_000);
});

void test("failed global settings writes do not claim success or corrupt runtime state", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "promptsmith-state-"));
  const filePath = join(tempDir, "not-a-directory");
  writeFileSync(filePath, "x", "utf8");
  const runtime = new PromptsmithRuntimeState(join(filePath, "promptsmith-settings.json"));
  const previousSettings = runtime.getSettings();

  assert.throws(() => {
    runtime.persistSettings({
      ...previousSettings,
      enabled: false,
      statusBarEnabled: true,
    });
  });

  assert.deepEqual(runtime.getSettings(), previousSettings);
});

void test("sanitizeSettings rejects unknown schema versions", () => {
  assert.equal(sanitizeSettings({ version: 2 }), undefined);
});

void test("sanitizeSettings normalizes shortcut keys and falls back on unsafe values", () => {
  const normalized = sanitizeSettings({ version: 1, shortcutKey: "Alt + Shift + P" });
  const invalidFormatFallback = sanitizeSettings({ version: 1, shortcutKey: "plain-p" });
  const unsafeTypingFallback = sanitizeSettings({ version: 1, shortcutKey: "shift+p" });

  assert.equal(normalized?.shortcutKey, "shift+alt+p");
  assert.equal(invalidFormatFallback?.shortcutKey, "alt+p");
  assert.equal(unsafeTypingFallback?.shortcutKey, "alt+p");
});

void test("sanitizeSettings dedupes exact and pattern overrides by normalized key", () => {
  const sanitized = sanitizeSettings({
    version: 1,
    exactModelOverrides: [
      { provider: "OpenAI", id: "GPT-5", family: "gpt" },
      { provider: "openai", id: "gpt-5", family: "claude" },
      { provider: "anthropic", id: "claude-3-5-sonnet", family: "claude" },
    ],
    familyOverrides: [
      { pattern: "OpenAI/*", family: "gpt" },
      { pattern: "moonshot/*", family: "claude" },
      { pattern: "openai/*", family: "claude" },
    ],
  });

  assert.ok(sanitized);
  assert.deepEqual(sanitized.exactModelOverrides, [
    { provider: "openai", id: "gpt-5", family: "claude" },
    { provider: "anthropic", id: "claude-3-5-sonnet", family: "claude" },
  ]);
  assert.deepEqual(sanitized.familyOverrides, [
    { pattern: "moonshot/*", family: "claude" },
    { pattern: "openai/*", family: "claude" },
  ]);
});

void test("sanitizeSettings rejects array-backed objects in record slots", () => {
  const arrayBackedOverride = Object.assign([], {
    provider: "openai",
    id: "gpt-5",
    family: "claude",
  });
  const arrayBackedRef = Object.assign([], {
    provider: "openai",
    id: "gpt-5",
  });
  const arrayBackedFamilyModels = Object.assign([], {
    gpt: { provider: "openai", id: "gpt-5" },
  });

  const sanitized = sanitizeSettings({
    version: 1,
    exactModelOverrides: [arrayBackedOverride],
    fixedEnhancerModel: arrayBackedRef,
    familyEnhancerModels: arrayBackedFamilyModels,
  });

  assert.ok(sanitized);
  assert.deepEqual(sanitized.exactModelOverrides, []);
  assert.equal(sanitized.fixedEnhancerModel, undefined);
  assert.equal(sanitized.familyEnhancerModels, undefined);
});

void test("runtime support relies on hasUI instead of theme enumeration", () => {
  const interactiveCtx = createCommandContext({ hasUI: true, themeCount: 0 });
  const headlessCtx = createCommandContext({ hasUI: false, themeCount: 1 });

  assert.equal(detectRuntimeSupport(interactiveCtx).interactiveTui, true);
  assert.equal(detectRuntimeSupport(headlessCtx).interactiveTui, false);
  assert.match(detectRuntimeSupport(headlessCtx).reason ?? "", /interactive mode/i);
});

void test("replacing settings clears stale draft analysis", () => {
  const runtime = createRuntimeState();
  runtime.rememberDraftResolution({
    intent: "implement",
    effectiveRewriteMode: "execution-contract",
  });

  runtime.replaceSettings({ ...runtime.getSettings(), rewriteMode: "plain" });

  assert.equal(runtime.getLastDraftResolution(), undefined);
});

void test("runtime restore clears transient undo state", () => {
  const runtime = createRuntimeState();
  runtime.undo.store("draft");
  runtime.rememberDraftResolution({
    intent: "implement",
    effectiveRewriteMode: "execution-contract",
  });

  runtime.restoreSettings();

  assert.equal(runtime.undo.hasUndo(), false);
  assert.equal(runtime.getLastDraftResolution(), undefined);
});
