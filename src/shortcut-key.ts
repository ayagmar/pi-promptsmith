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
  enter: "Enter",
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
const VALID_KEY_ID_SPECIAL_KEYS = new Set<string>([
  "escape",
  "enter",
  "tab",
  "space",
  "backspace",
  "delete",
  "home",
  "end",
  "pageup",
  "pagedown",
  "up",
  "down",
  "left",
  "right",
]);

interface ShortcutParts {
  modifiers: string[];
  key: string;
}

type EffectiveKeybindings = Record<string, string | string[] | undefined>;

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

  if (!hasShortcutModifier(normalized.split("+"))) {
    return {
      error: "Promptsmith shortcuts must include Alt and/or Ctrl so normal typing keeps working.",
    };
  }

  const conflictAction = effectiveKeybindings
    ? findShortcutConflictAction(normalized, effectiveKeybindings)
    : undefined;
  if (conflictAction) {
    return {
      error: `That key is already used by Pi for ${formatShortcutConflictAction(conflictAction)}. Pick a different shortcut.`,
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
  const normalized = normalizeShortcutKey(value);
  const parts = normalized ? parseShortcutParts(normalized) : undefined;
  if (parts) {
    return formatShortcutParts(parts);
  }

  const fallbackNormalized = normalizeShortcutKey(DEFAULT_SHORTCUT_KEY);
  const fallbackParts = fallbackNormalized ? parseShortcutParts(fallbackNormalized) : undefined;
  return fallbackParts ? formatShortcutParts(fallbackParts) : DEFAULT_SHORTCUT_KEY;
}

export function isDefaultShortcutConfigured(settings: PromptsmithSettings): boolean {
  return normalizeShortcutKey(settings.shortcutKey) === DEFAULT_SHORTCUT_KEY;
}

export function getCustomShortcutKey(
  settings: PromptsmithSettings,
  effectiveKeybindings?: EffectiveKeybindings
): KeyId | undefined {
  if (!settings.enabled || !settings.shortcutEnabled) {
    return undefined;
  }

  const shortcutKey = normalizeShortcutKey(settings.shortcutKey);
  if (!shortcutKey || shortcutKey === DEFAULT_SHORTCUT_KEY) {
    return undefined;
  }

  if (!isValidKeyId(shortcutKey)) {
    return undefined;
  }

  if (effectiveKeybindings && findShortcutConflictAction(shortcutKey, effectiveKeybindings)) {
    return undefined;
  }

  return shortcutKey;
}

export function matchesCustomShortcut(
  data: string,
  settings: PromptsmithSettings,
  effectiveKeybindings: EffectiveKeybindings
): boolean {
  const shortcutKey = getCustomShortcutKey(settings, effectiveKeybindings);
  if (!shortcutKey) {
    return false;
  }

  return matchesKey(data, shortcutKey);
}

function isValidKeyId(value: string): value is KeyId {
  const parts = parseShortcutParts(value);
  if (!parts) {
    return false;
  }

  const modifierSet = new Set(parts.modifiers);
  if (modifierSet.size !== parts.modifiers.length) {
    return false;
  }

  for (const modifier of modifierSet) {
    if (!MODIFIERS.has(modifier)) {
      return false;
    }
  }

  if (!hasShortcutModifier(modifierSet)) {
    return false;
  }

  if (SYMBOL_KEYS.has(parts.key)) {
    return false;
  }

  if (/^[a-z]$/.test(parts.key)) {
    return true;
  }

  return VALID_KEY_ID_SPECIAL_KEYS.has(parts.key);
}

function parseShortcutParts(value: string | undefined): ShortcutParts | undefined {
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

function hasShortcutModifier(tokens: Iterable<string>): boolean {
  for (const token of tokens) {
    if (token === "ctrl" || token === "alt") {
      return true;
    }
  }

  return false;
}

function formatShortcutConflictAction(action: string): string {
  const normalized = action
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[._\s-]+/)
    .filter(Boolean)
    .map((part) => part.toLowerCase());

  const visibleParts =
    normalized[0] === "app" || normalized[0] === "tui" ? normalized.slice(1) : normalized;

  return visibleParts.join(" ") || action;
}

function formatShortcutParts(parts: ShortcutParts): string {
  return [
    ...parts.modifiers.map((modifier) => formatShortcutToken(modifier, false)),
    formatShortcutToken(parts.key, true),
  ].join("+");
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
