import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { DEFAULT_SETTINGS } from "../src/constants.js";
import { setFamilyEnhancerModel } from "../src/enhancer-settings.js";
import { matchesPattern, resolveTargetFamily } from "../src/model-routing.js";
import { resolveEnhancerModel } from "../src/model-selection.js";
import {
  removeExactModelOverride,
  removeFamilyOverride,
  upsertExactModelOverride,
  upsertFamilyOverride,
} from "../src/overrides.js";
import { getGlobalSettingsPath, PromptsmithRuntimeState, sanitizeSettings } from "../src/state.js";
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

void test("built-in routing recognizes gateway and Bedrock model ids", () => {
  const settings = { ...createRuntimeState().getSettings(), fallbackFamily: "gpt" as const };
  const claudeModels = [
    { provider: "openrouter", id: "anthropic/claude-haiku-4.5" },
    { provider: "vercel-ai-gateway", id: "anthropic/claude-3-haiku" },
    { provider: "amazon-bedrock", id: "anthropic.claude-haiku-4-5-20251001-v1:0" },
    { provider: "amazon-bedrock", id: "us.anthropic.claude-haiku-4-5-20251001-v1:0" },
    { provider: "nvidia", id: "moonshotai/kimi-k2.6" },
    { provider: "cloudflare-workers-ai", id: "@cf/moonshotai/kimi-k2.6" },
    { provider: "fireworks", id: "accounts/fireworks/models/kimi-k3" },
  ];
  for (const model of claudeModels) {
    const resolved = resolveTargetFamily(settings, createModel(model));
    assert.deepEqual([model.id, resolved.family, resolved.source], [model.id, "claude", "builtin"]);
  }

  const fallbackClaude = { ...settings, fallbackFamily: "claude" as const };
  for (const id of ["openai/gpt-5", "openai/o3"]) {
    const resolved = resolveTargetFamily(
      fallbackClaude,
      createModel({ provider: "openrouter", id })
    );
    assert.deepEqual([id, resolved.family, resolved.source], [id, "gpt", "builtin"]);
  }

  const unknown = resolveTargetFamily(
    settings,
    createModel({ provider: "openrouter", id: "mistralai/mistral-large" })
  );
  assert.equal(unknown.source, "fallback");
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

void test("resolveEnhancerModel validates the enhancer configuration", () => {
  const model = createModel();
  const ctx = createCommandContext({ model, allModels: [model] });
  const settings = createRuntimeState().getSettings();

  const resolved = resolveEnhancerModel(settings, "gpt", model, ctx.modelRegistry);
  assert.equal(resolved.label, "active (openai/gpt-5)");
  assert.equal(resolved.model, model);

  assert.throws(
    () =>
      resolveEnhancerModel(
        { ...settings, enhancerModelMode: "fixed" },
        "gpt",
        model,
        ctx.modelRegistry
      ),
    /no fixed enhancer model is configured/i
  );

  assert.throws(
    () =>
      resolveEnhancerModel(
        { ...settings, enhancerModelMode: "fixed", fixedEnhancerModel: { provider: "x", id: "y" } },
        "gpt",
        model,
        ctx.modelRegistry
      ),
    /could not find the configured enhancer model x\/y/i
  );

  assert.throws(
    () =>
      resolveEnhancerModel(
        { ...settings, enhancerModelMode: "bogus" as never },
        "gpt",
        model,
        ctx.modelRegistry
      ),
    /unsupported enhancer-model mode: bogus/i
  );
});

void test("setFamilyEnhancerModel keeps a single pick until both families are set", () => {
  const runtime = createRuntimeState();
  const fixedModel = { provider: "openai", id: "gpt-5-mini" };
  const gptModel = { provider: "openai", id: "gpt-5" };
  const claudeModel = { provider: "anthropic", id: "claude-3-5-sonnet" };

  const partial = setFamilyEnhancerModel(
    {
      ...runtime.getSettings(),
      enhancerModelMode: "fixed",
      fixedEnhancerModel: fixedModel,
    },
    "gpt",
    gptModel
  );

  assert.equal(partial.enhancerModelMode, "fixed");
  assert.deepEqual(partial.fixedEnhancerModel, fixedModel);
  assert.deepEqual(partial.familyEnhancerModels, { gpt: gptModel });

  const promoted = setFamilyEnhancerModel(partial, "claude", claudeModel);

  assert.equal(promoted.enhancerModelMode, "family-linked");
  assert.equal(promoted.fixedEnhancerModel, undefined);

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
    autoSendEnhancedPrompt: true,
    autoSendBusyBehavior: "followUp",
    enhancementTimeoutMs: 12_000,
  });

  const restoredRuntime = new PromptsmithRuntimeState(settingsPath);
  restoredRuntime.restoreSettings();

  assert.equal(restoredRuntime.getSettings().enabled, false);
  assert.equal(restoredRuntime.getSettings().statusBarEnabled, true);
  assert.equal(restoredRuntime.getSettings().shortcutKey, "ctrl+alt+p");
  assert.equal(restoredRuntime.getSettings().rewriteMode, "plain");
  assert.equal(restoredRuntime.getSettings().autoSendEnhancedPrompt, true);
  assert.equal(restoredRuntime.getSettings().autoSendBusyBehavior, "followUp");
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

void test("settings writes leave no temp file behind, even when the rename fails", () => {
  const storageDir = mkdtempSync(join(tmpdir(), "promptsmith-state-"));
  const settingsPath = join(storageDir, "promptsmith-settings.json");
  const runtime = new PromptsmithRuntimeState(settingsPath);

  runtime.persistSettings({ ...runtime.getSettings(), enabled: false });
  assert.deepEqual(readdirSync(storageDir), ["promptsmith-settings.json"]);
  assert.equal(JSON.parse(readFileSync(settingsPath, "utf8")).enabled, false);

  const blockedPath = join(storageDir, "blocked");
  mkdirSync(join(blockedPath, "child"), { recursive: true });
  assert.throws(() => {
    new PromptsmithRuntimeState(blockedPath).persistSettings(runtime.getSettings());
  });
  assert.deepEqual(readdirSync(storageDir).sort(), ["blocked", "promptsmith-settings.json"]);
});

void test("restoring an unreadable settings file warns and leaves the file alone", () => {
  const storageDir = mkdtempSync(join(tmpdir(), "promptsmith-state-"));
  const settingsPath = join(storageDir, "promptsmith-settings.json");
  const runtime = new PromptsmithRuntimeState(settingsPath);

  assert.equal(runtime.restoreSettings(), undefined);

  writeFileSync(settingsPath, '{ "version": 1, "enabled": false,', "utf8");
  assert.match(runtime.restoreSettings() ?? "", /could not parse .*promptsmith-settings\.json/);
  assert.deepEqual(runtime.getSettings(), createRuntimeState().getSettings());
  assert.equal(readFileSync(settingsPath, "utf8"), '{ "version": 1, "enabled": false,');

  writeFileSync(settingsPath, JSON.stringify({ version: 2 }), "utf8");
  assert.match(runtime.restoreSettings() ?? "", /expected version 1/);
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

void test("runtime support requires the TUI mode instead of hasUI or themes", () => {
  const interactiveCtx = createCommandContext({ hasUI: true, mode: "tui", themeCount: 0 });
  const rpcCtx = createCommandContext({ hasUI: true, mode: "rpc", themeCount: 1 });
  const headlessCtx = createCommandContext({ hasUI: false, mode: "print", themeCount: 1 });

  assert.equal(detectRuntimeSupport(interactiveCtx).interactiveTui, true);
  assert.equal(detectRuntimeSupport(rpcCtx).interactiveTui, false);
  assert.match(detectRuntimeSupport(rpcCtx).reason ?? "", /interactive mode/i);
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
  runtime.rememberEnhancementAttempt({
    outcome: "failed",
    enhancerModel: { provider: "openai", id: "gpt-5" },
    retryUsed: true,
    recoveredAfterRetry: false,
    detail: "primary: missing sentinel block; retry: unexpected text outside the sentinel block",
  });

  runtime.restoreSettings();

  assert.equal(runtime.undo.hasUndo(), false);
  assert.equal(runtime.getLastDraftResolution(), undefined);
  assert.equal(runtime.getLastEnhancementAttempt(), undefined);
});

void test("global settings live in the pi agent dir, honoring PI_CODING_AGENT_DIR", () => {
  const agentDir = mkdtempSync(join(tmpdir(), "promptsmith-agent-dir-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;

  try {
    const settingsPath = join(agentDir, "promptsmith-settings.json");
    assert.equal(getGlobalSettingsPath(), settingsPath);

    const runtime = new PromptsmithRuntimeState();
    runtime.persistSettings({ ...runtime.getSettings(), rewriteMode: "plain" });
    assert.equal(existsSync(settingsPath), true);
  } finally {
    if (previous === undefined) {
      delete process.env.PI_CODING_AGENT_DIR;
    } else {
      process.env.PI_CODING_AGENT_DIR = previous;
    }
  }
});

void test("settings saved in ~/.pi/agent are still read when PI_CODING_AGENT_DIR moves them", () => {
  const agentDir = mkdtempSync(join(tmpdir(), "promptsmith-agent-dir-"));
  const home = mkdtempSync(join(tmpdir(), "promptsmith-home-"));
  const legacyPath = join(home, ".pi", "agent", "promptsmith-settings.json");
  mkdirSync(dirname(legacyPath), { recursive: true });
  writeFileSync(legacyPath, JSON.stringify({ ...DEFAULT_SETTINGS, rewriteMode: "plain" }), "utf8");
  const previous = { agentDir: process.env.PI_CODING_AGENT_DIR, home: process.env.HOME };
  process.env.PI_CODING_AGENT_DIR = agentDir;
  process.env.HOME = home;

  try {
    const runtime = new PromptsmithRuntimeState();
    const warning = runtime.restoreSettings();
    assert.equal(runtime.getSettings().rewriteMode, "plain");
    assert.match(warning ?? "", /loaded its settings from the old location/);
    assert.ok(warning?.includes(legacyPath));

    // Saving moves them to the new location and leaves the old file alone.
    runtime.persistSettings(runtime.getSettings());
    const newPath = join(agentDir, "promptsmith-settings.json");
    assert.equal(existsSync(newPath), true);
    assert.equal(existsSync(legacyPath), true);
    assert.equal(new PromptsmithRuntimeState().restoreSettings(), undefined);
  } finally {
    for (const [name, value] of [
      ["PI_CODING_AGENT_DIR", previous.agentDir],
      ["HOME", previous.home],
    ] as const) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  }
});
