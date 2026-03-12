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

export async function resolveEditorDraft(
  ctx: ExtensionContext,
  exec: ExtensionAPI["exec"]
): Promise<string> {
  const draft = ctx.ui.getEditorText();
  const markers = extractPasteMarkers(draft);
  if (markers.length === 0) {
    return draft;
  }

  const clipboardText = await readClipboardText(exec);
  const clipboardCandidates = buildClipboardCandidates(clipboardText);
  if (clipboardCandidates.length === 0) {
    throw new Error(unresolvedPasteMarkerMessage());
  }

  let resolved = draft;
  for (const marker of markers) {
    const matchingClipboard = clipboardCandidates.find((candidate) =>
      matchesPasteMarker(candidate, marker)
    );
    if (matchingClipboard) {
      resolved = resolved.replaceAll(marker.raw, matchingClipboard);
    }
  }

  if (extractPasteMarkers(resolved).length > 0) {
    throw new Error(unresolvedPasteMarkerMessage());
  }

  return resolved;
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
  for (const command of getClipboardReadCommands()) {
    try {
      const result = await exec(command.command, command.args);
      if (result.code === 0) {
        return result.stdout;
      }
    } catch {}
  }
  return undefined;
}

function getClipboardReadCommands(): ClipboardCommand[] {
  if (process.platform === "darwin") {
    return [{ command: "pbpaste", args: [] }];
  }

  if (process.platform === "win32") {
    return [
      {
        command: "powershell.exe",
        args: [
          "-NoProfile",
          "-Command",
          "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-Clipboard -Raw",
        ],
      },
    ];
  }

  const commands: ClipboardCommand[] = [];
  if (process.env.TERMUX_VERSION || process.env.ANDROID_ROOT) {
    commands.push({ command: "termux-clipboard-get", args: [] });
  }
  commands.push(
    { command: "wl-paste", args: ["--no-newline"] },
    { command: "xclip", args: ["-selection", "clipboard", "-o"] },
    { command: "xsel", args: ["--clipboard", "--output"] }
  );
  if (!commands.some((entry) => entry.command === "termux-clipboard-get")) {
    commands.push({ command: "termux-clipboard-get", args: [] });
  }
  return commands;
}

function unresolvedPasteMarkerMessage(): string {
  return (
    "Promptsmith found Pi paste markers in the editor, but Pi's extension API only exposed the collapsed marker text. " +
    "Copy the original text again and retry so Promptsmith can recover it from the clipboard."
  );
}
