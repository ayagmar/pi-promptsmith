import { matchesKey, type KeyId } from "@mariozechner/pi-tui";
import { DEFAULT_SHORTCUT_KEY } from "./constants.js";
import type { PromptsmithSettings } from "./types.js";

const MODIFIER_ORDER = ["ctrl", "shift", "alt"] as const;
const MODIFIERS = new Set<string>(MODIFIER_ORDER);
const SPECIAL_KEYS = new Set<string>([
  "escape",
  "esc",
  "enter",
  "return",
  "tab",
  "space",
  "backspace",
  "delete",
  "insert",
  "clear",
  "home",
  "end",
  "pageup",
  "pagedown",
  "up",
  "down",
  "left",
  "right",
  "f1",
  "f2",
  "f3",
  "f4",
  "f5",
  "f6",
  "f7",
  "f8",
  "f9",
  "f10",
  "f11",
  "f12",
]);
const SYMBOL_KEYS = new Set<string>([
  "`",
  "-",
  "=",
  "[",
  "]",
  "\\",
  ";",
  "'",
  ",",
  ".",
  "/",
  "!",
  "@",
  "#",
  "$",
  "%",
  "^",
  "&",
  "*",
  "(",
  ")",
  "_",
  "+",
  "|",
  "~",
  "{",
  "}",
  ":",
  "<",
  ">",
  "?",
]);
const DISPLAY_NAMES: Record<string, string> = {
  escape: "Escape",
  esc: "Esc",
  enter: "Enter",
  return: "Return",
  tab: "Tab",
  space: "Space",
  backspace: "Backspace",
  delete: "Delete",
  insert: "Insert",
  clear: "Clear",
  home: "Home",
  end: "End",
  pageup: "PageUp",
  pagedown: "PageDown",
  up: "Up",
  down: "Down",
  left: "Left",
  right: "Right",
};

export function normalizeShortcutKey(value: string | undefined): string | undefined {
  const parts = parseShortcutParts(value);
  if (!parts) {
    return undefined;
  }

  const key = normalizeBaseKey(parts.key);
  if (!key) {
    return undefined;
  }

  const modifierSet = new Set<string>();
  for (const modifier of parts.modifiers) {
    if (!MODIFIERS.has(modifier) || modifierSet.has(modifier)) {
      return undefined;
    }
    modifierSet.add(modifier);
  }

  const orderedModifiers = MODIFIER_ORDER.filter((modifier) => modifierSet.has(modifier));
  return [...orderedModifiers, key].join("+");
}

type EffectiveKeybindings = Record<string, string | string[]>;

export function validateShortcutKey(
  value: string,
  effectiveKeybindings?: EffectiveKeybindings
): { normalized?: string; error?: string } {
  const normalized = normalizeShortcutKey(value);
  if (!normalized) {
    return {
      error: "Use a valid Pi key combo like Alt+P or Ctrl+Alt+P.",
    };
  }

  const parts = normalized.split("+");
  const hasCtrl = parts.includes("ctrl");
  const hasAlt = parts.includes("alt");
  if (!hasCtrl && !hasAlt) {
    return {
      error: "Promptsmith shortcuts must include Alt and/or Ctrl so normal typing keeps working.",
    };
  }

  const conflictAction = effectiveKeybindings
    ? findShortcutConflictAction(normalized, effectiveKeybindings)
    : undefined;
  if (conflictAction) {
    return {
      error: `That key is already used by Pi for ${conflictAction}. Pick a different shortcut.`,
    };
  }

  return { normalized };
}

export function findShortcutConflictAction(
  shortcutKey: string,
  effectiveKeybindings: EffectiveKeybindings
): string | undefined {
  const normalized = normalizeShortcutKey(shortcutKey);
  if (!normalized) {
    return undefined;
  }

  for (const [action, keys] of Object.entries(effectiveKeybindings)) {
    const keyList = Array.isArray(keys) ? keys : [keys];
    if (keyList.some((key) => normalizeShortcutKey(key) === normalized)) {
      return action;
    }
  }

  return undefined;
}

export function formatShortcutKey(value: string | undefined): string {
  const normalized = normalizeShortcutKey(value) ?? DEFAULT_SHORTCUT_KEY;
  const parts = parseShortcutParts(normalized);
  if (!parts) {
    return formatShortcutKey(DEFAULT_SHORTCUT_KEY);
  }

  return [
    ...parts.modifiers.map((modifier) => formatShortcutToken(modifier, false)),
    formatShortcutToken(parts.key, true),
  ].join("+");
}

export function isDefaultShortcutConfigured(settings: PromptsmithSettings): boolean {
  return normalizeShortcutKey(settings.shortcutKey) === DEFAULT_SHORTCUT_KEY;
}

export function matchesCustomShortcut(
  data: string,
  settings: PromptsmithSettings,
  effectiveKeybindings: EffectiveKeybindings
): boolean {
  if (!settings.enabled || !settings.shortcutEnabled) {
    return false;
  }

  const shortcutKey = normalizeShortcutKey(settings.shortcutKey);
  if (!shortcutKey || shortcutKey === DEFAULT_SHORTCUT_KEY) {
    return false;
  }

  if (findShortcutConflictAction(shortcutKey, effectiveKeybindings)) {
    return false;
  }

  return matchesKey(data, shortcutKey as KeyId);
}

function parseShortcutParts(
  value: string | undefined
): { modifiers: string[]; key: string } | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {
    return undefined;
  }

  const parts =
    trimmed === "+"
      ? ["+"]
      : trimmed.endsWith("+")
        ? [
            ...trimmed
              .slice(0, -1)
              .split("+")
              .map((part) => part.trim())
              .filter(Boolean),
            "+",
          ]
        : trimmed
            .split("+")
            .map((part) => part.trim())
            .filter(Boolean);
  if (parts.length === 0) {
    return undefined;
  }

  const key = parts.at(-1);
  if (!key) {
    return undefined;
  }

  return {
    modifiers: parts.slice(0, -1),
    key,
  };
}

function normalizeBaseKey(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  if (/^[a-z0-9]$/.test(value)) {
    return value;
  }

  if (SPECIAL_KEYS.has(value)) {
    if (value === "return") return "enter";
    if (value === "esc") return "escape";
    return value;
  }

  return SYMBOL_KEYS.has(value) ? value : undefined;
}

function formatShortcutToken(token: string, isKey: boolean): string {
  if (!isKey) {
    return token.slice(0, 1).toUpperCase() + token.slice(1);
  }

  if (DISPLAY_NAMES[token]) {
    return DISPLAY_NAMES[token];
  }

  if (/^[a-z]$/.test(token)) {
    return token.toUpperCase();
  }

  if (/^f\d+$/.test(token)) {
    return token.toUpperCase();
  }

  return token;
}
