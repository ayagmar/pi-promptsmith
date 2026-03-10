import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveEnhancerModel } from "../src/model-selection.js";
import { matchesPattern, resolveTargetFamily } from "../src/model-routing.js";
import { PromptsmithRuntimeState, sanitizeSettings } from "../src/state.js";
import { detectRuntimeSupport } from "../src/validation.js";
import { createCommandContext, createModel, createRuntimeState } from "./helpers.js";

void test("target family resolution honors exact overrides and pattern overrides", () => {
  const settings = {
    ...createRuntimeState().getSettings(),
    exactModelOverrides: [{ provider: "openai", id: "gpt-5", family: "claude" as const }],
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

void test("settings persist across sessions globally", () => {
  const storageDir = mkdtempSync(join(tmpdir(), "promptsmith-state-"));
  const settingsPath = join(storageDir, "promptsmith-settings.json");
  const runtime = new PromptsmithRuntimeState(settingsPath);
  const ctx = createCommandContext();

  runtime.persistSettings({
    ...runtime.getSettings(),
    enabled: false,
    statusBarEnabled: true,
    rewriteMode: "plain",
    enhancementTimeoutMs: 12_000,
  });

  const restoredRuntime = new PromptsmithRuntimeState(settingsPath);
  restoredRuntime.restoreSettings(ctx.cwd);

  assert.equal(restoredRuntime.getSettings().enabled, false);
  assert.equal(restoredRuntime.getSettings().statusBarEnabled, true);
  assert.equal(restoredRuntime.getSettings().rewriteMode, "plain");
  assert.equal(restoredRuntime.getSettings().enhancementTimeoutMs, 12_000);
});

void test("legacy local settings migrate to global storage", () => {
  const storageDir = mkdtempSync(join(tmpdir(), "promptsmith-state-"));
  const settingsPath = join(storageDir, "promptsmith-settings.json");
  const projectDir = mkdtempSync(join(tmpdir(), "promptsmith-project-"));
  const legacyDir = join(projectDir, ".pi");
  mkdirSync(legacyDir, { recursive: true });
  writeFileSync(
    join(legacyDir, "promptsmith-settings.json"),
    `${JSON.stringify({
      version: 1,
      enabled: false,
      statusBarEnabled: true,
      rewriteMode: "plain",
      enhancementTimeoutMs: 12_000,
    })}\n`,
    "utf8"
  );

  const runtime = new PromptsmithRuntimeState(settingsPath);
  const restored = runtime.restoreSettings(projectDir);

  assert.equal(restored.settings.enabled, false);
  assert.equal(restored.settings.statusBarEnabled, true);
  assert.equal(restored.settings.rewriteMode, "plain");

  const restoredRuntime = new PromptsmithRuntimeState(settingsPath);
  restoredRuntime.restoreSettings(mkdtempSync(join(tmpdir(), "other-project-")));
  assert.equal(restoredRuntime.getSettings().enabled, false);
  assert.equal(restoredRuntime.getSettings().statusBarEnabled, true);
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

void test("runtime support detects interactive TUI versus rpc-like contexts", () => {
  const interactiveCtx = createCommandContext({ themeCount: 1 });
  const rpcCtx = createCommandContext({ themeCount: 0 });

  assert.equal(detectRuntimeSupport(interactiveCtx).interactiveTui, true);
  assert.equal(detectRuntimeSupport(rpcCtx).interactiveTui, false);
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

  runtime.restoreSettings(createCommandContext().cwd);

  assert.equal(runtime.undo.hasUndo(), false);
  assert.equal(runtime.getLastDraftResolution(), undefined);
});
