import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { DEFAULT_SHORTCUT_KEY } from "./constants.js";

// Pi skips an extension shortcut whose key is bound to one of these actions and
// logs a conflict at startup. Copied from RESERVED_KEYBINDINGS_FOR_EXTENSION_CONFLICTS
// in pi's coding-agent/src/core/extensions/runner.ts, which pi does not export.
const PI_RESERVED_ACTIONS = [
  "app.interrupt",
  "app.clear",
  "app.exit",
  "app.suspend",
  "app.thinking.cycle",
  "app.model.cycleForward",
  "app.model.cycleBackward",
  "app.model.select",
  "app.tools.expand",
  "app.thinking.toggle",
  "app.editor.external",
  "app.message.copy",
  "app.message.followUp",
  "tui.input.submit",
  "tui.select.confirm",
  "tui.select.cancel",
  "tui.input.copy",
  "tui.editor.deleteToLineEnd",
] as const;

// Legacy keybindings.json names pi still migrates, limited to reserved actions.
// From KEYBINDING_NAME_MIGRATIONS in pi's coding-agent/src/core/keybindings.ts.
const LEGACY_RESERVED_NAMES: Record<string, string> = {
  interrupt: "app.interrupt",
  clear: "app.clear",
  exit: "app.exit",
  suspend: "app.suspend",
  cycleThinkingLevel: "app.thinking.cycle",
  cycleModelForward: "app.model.cycleForward",
  cycleModelBackward: "app.model.cycleBackward",
  selectModel: "app.model.select",
  expandTools: "app.tools.expand",
  toggleThinking: "app.thinking.toggle",
  externalEditor: "app.editor.external",
  followUp: "app.message.followUp",
  submit: "tui.input.submit",
  selectConfirm: "tui.select.confirm",
  selectCancel: "tui.select.cancel",
  copy: "tui.input.copy",
  deleteToLineEnd: "tui.editor.deleteToLineEnd",
};

export interface PiKeybindingsEnvironment {
  /** The raw contents of pi's keybindings.json, or undefined when it is missing or unreadable. */
  userKeybindings: Record<string, unknown> | undefined;
  /** Whether pi uses its Windows defaults (Windows and WSL), which bind Alt+P to the previous model. */
  windowsDefaults: boolean;
}

/**
 * Returns the reserved pi action that holds the default Alt+P shortcut, if any;
 * pi then skips Promptsmith's Alt+P. Pi decides this from its resolved keybindings
 * (its defaults plus keybindings.json), so this resolves them the same way. Pi's
 * KeybindingsManager is only exported as a type, so it cannot be used here.
 */
export function findDefaultShortcutReservedAction(
  environment: PiKeybindingsEnvironment = readPiKeybindingsEnvironment()
): string | undefined {
  const userBindings = migrateLegacyNames(environment.userKeybindings ?? {});
  // Like pi, a reserved action wins over any other action bound to the same key.
  for (const action of PI_RESERVED_ACTIONS) {
    const userKeys = readKeyList(userBindings[action]);
    const keys =
      userKeys ??
      (action === "app.model.cycleBackward" && environment.windowsDefaults ? ["alt+p"] : []);
    if (keys.some((key) => key.toLowerCase() === DEFAULT_SHORTCUT_KEY)) {
      return action;
    }
  }
  return undefined;
}

export function readPiKeybindingsEnvironment(
  agentDir: string = getAgentDir(),
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env
): PiKeybindingsEnvironment {
  return {
    userKeybindings: readUserKeybindings(join(agentDir, "keybindings.json")),
    windowsDefaults: usesWindowsKeybindings(platform, env),
  };
}

// Mirrors pi's own `useWindowsKeybindings()`, which it does not export.
export function usesWindowsKeybindings(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return (
    platform === "win32" ||
    (platform === "linux" && Boolean(env.WSL_DISTRO_NAME || env.WSL_INTEROP))
  );
}

// Pi ignores a keybindings.json it cannot read or parse and uses its defaults.
function readUserKeybindings(path: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, ""));
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

// A legacy name is dropped when its new id is also present, as pi does.
function migrateLegacyNames(raw: Record<string, unknown>): Record<string, unknown> {
  const migrated: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(raw)) {
    const id = LEGACY_RESERVED_NAMES[name] ?? name;
    if (id !== name && Object.hasOwn(raw, id)) {
      continue;
    }
    migrated[id] = value;
  }
  return migrated;
}

// Pi keeps a string or a list of strings and ignores any other value.
function readKeyList(value: unknown): string[] | undefined {
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) {
    return value;
  }
  return undefined;
}
