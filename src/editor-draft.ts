import { readFileSync } from "node:fs";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

interface PasteMarker {
  raw: string;
  expectedLineCount?: number;
  expectedCharCount?: number;
}

interface ClipboardCommand {
  command: string;
  args: string[];
}

const PASTE_MARKER_REGEX = /\[paste #\d+(?: (?:\+(\d+) lines|(\d+) chars))?\]/g;
const WINDOWS_CLIPBOARD_COMMAND: ClipboardCommand = {
  command: "powershell.exe",
  args: [
    "-NoProfile",
    "-Command",
    "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-Clipboard -Raw",
  ],
};

export async function resolveEditorDraft(
  ctx: ExtensionContext,
  exec: ExtensionAPI["exec"]
): Promise<string> {
  const draft = ctx.ui.getEditorText();
  const markers = extractPasteMarkers(draft);
  if (markers.length === 0) {
    return draft;
  }
  if (markers.length > 1) {
    throw new Error(unresolvedPasteMarkerMessage());
  }

  const clipboardText = await readClipboardText(exec);
  const clipboardCandidates = buildClipboardCandidates(clipboardText);
  if (clipboardCandidates.length === 0) {
    throw new Error(unresolvedPasteMarkerMessage());
  }

  const marker = markers[0]!;
  const matchingClipboard = clipboardCandidates.find((candidate) =>
    matchesPasteMarker(candidate, marker)
  );
  if (!matchingClipboard) {
    throw new Error(unresolvedPasteMarkerMessage());
  }

  return draft.replaceAll(marker.raw, matchingClipboard);
}

function extractPasteMarkers(text: string): PasteMarker[] {
  return Array.from(text.matchAll(PASTE_MARKER_REGEX), (match) => ({
    raw: match[0],
    ...(match[1] ? { expectedLineCount: Number(match[1]) } : {}),
    ...(match[2] ? { expectedCharCount: Number(match[2]) } : {}),
  }));
}

function matchesPasteMarker(text: string, marker: PasteMarker): boolean {
  if (marker.expectedLineCount !== undefined) {
    return text.split("\n").length === marker.expectedLineCount;
  }
  if (marker.expectedCharCount !== undefined) {
    return text.length === marker.expectedCharCount;
  }
  return text.length > 0;
}

function buildClipboardCandidates(text: string | undefined): string[] {
  if (text === undefined) {
    return [];
  }

  const normalized = normalizeLineEndings(text);
  const variants = new Set([normalized]);
  if (normalized.endsWith("\n")) {
    variants.add(normalized.slice(0, -1));
  }
  return [...variants].filter((value) => value.length > 0);
}

function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

async function readClipboardText(exec: ExtensionAPI["exec"]): Promise<string | undefined> {
  let lastErr: unknown;
  let lastCommand: ClipboardCommand | undefined;

  for (const command of getClipboardReadCommands()) {
    try {
      const result = await exec(command.command, command.args);
      if (result.code === 0) {
        return result.stdout;
      }
    } catch (error) {
      lastErr = error;
      lastCommand = command;
    }
  }

  if (lastErr) {
    if (lastErr instanceof Error) {
      console.error(
        `Promptsmith failed to read the clipboard with ${lastCommand?.command ?? "an unknown command"}: ${lastErr.stack ?? lastErr.message}`
      );
    } else {
      console.error(
        `Promptsmith failed to read the clipboard with ${lastCommand?.command ?? "an unknown command"}:`,
        lastErr
      );
    }
  }

  return undefined;
}

function getClipboardReadCommands(): ClipboardCommand[] {
  if (process.platform === "darwin") {
    return [{ command: "pbpaste", args: [] }];
  }

  if (process.platform === "win32") {
    return [WINDOWS_CLIPBOARD_COMMAND];
  }

  const commands: ClipboardCommand[] = [];
  const isTermux = Boolean(process.env.TERMUX_VERSION || process.env.ANDROID_ROOT);
  if (isWslEnvironment()) {
    commands.push(WINDOWS_CLIPBOARD_COMMAND);
  }
  if (isTermux) {
    commands.push({ command: "termux-clipboard-get", args: [] });
  }
  commands.push(
    { command: "wl-paste", args: ["--no-newline"] },
    { command: "xclip", args: ["-selection", "clipboard", "-o"] },
    { command: "xsel", args: ["--clipboard", "--output"] }
  );
  if (!isTermux) {
    commands.push({ command: "termux-clipboard-get", args: [] });
  }
  return commands;
}

function isWslEnvironment(): boolean {
  if (process.platform !== "linux") {
    return false;
  }
  if (process.env.WSL_DISTRO_NAME || process.env.WSLENV) {
    return true;
  }

  try {
    return /microsoft/i.test(readFileSync("/proc/version", "utf8"));
  } catch {
    return false;
  }
}

function unresolvedPasteMarkerMessage(): string {
  return (
    "Promptsmith found Pi paste markers in the editor, but Pi's extension API only exposed the collapsed marker text. " +
    "Copy the original text again and retry so Promptsmith can recover it from the clipboard."
  );
}
