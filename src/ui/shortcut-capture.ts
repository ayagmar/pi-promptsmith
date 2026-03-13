import { parseKey, truncateToWidth, type Component } from "@mariozechner/pi-tui";
import type { ExtensionContext, KeybindingsManager } from "@mariozechner/pi-coding-agent";
import { DEFAULT_SHORTCUT_KEY } from "../constants.js";
import { formatShortcutKey, validateShortcutKey } from "../shortcut-key.js";

export async function captureShortcutKey(
  ctx: ExtensionContext,
  options?: { currentValue?: string }
): Promise<string | undefined> {
  return ctx.ui.custom<string | undefined>((tui, theme, keybindings, done) => {
    return new ShortcutCaptureDialog(theme, keybindings, {
      ...(options?.currentValue ? { currentValue: options.currentValue } : {}),
      requestRender: () => tui.requestRender(),
      onDone: done,
    });
  });
}

type DialogTheme = Pick<ExtensionContext["ui"]["theme"], "fg" | "bold">;

class ShortcutCaptureDialog implements Component {
  private hint = "Press the new shortcut. Esc cancels.";

  constructor(
    private readonly theme: DialogTheme,
    private readonly keybindings: KeybindingsManager,
    private readonly callbacks: {
      currentValue?: string;
      requestRender: () => void;
      onDone: (value: string | undefined) => void;
    }
  ) {}

  invalidate(): void {
    // No cached render state.
  }

  render(width: number): string[] {
    return [
      this.theme.fg("accent", truncateToWidth(this.theme.bold("Set Promptsmith shortcut"), width)),
      this.theme.fg(
        "dim",
        truncateToWidth(
          `Current: ${formatShortcutKey(this.callbacks.currentValue)} · Backspace resets to default`,
          width
        )
      ),
      this.theme.fg("text", truncateToWidth(this.hint, width)),
    ];
  }

  handleInput(data: string): void {
    const parsed = parseKey(data);
    if (!parsed) {
      return;
    }

    if (parsed === "escape") {
      this.callbacks.onDone(undefined);
      return;
    }

    if (parsed === "backspace" || parsed === "delete") {
      this.callbacks.onDone(DEFAULT_SHORTCUT_KEY);
      return;
    }

    const validation = validateShortcutKey(parsed, this.keybindings.getEffectiveConfig());
    if (validation.normalized) {
      this.callbacks.onDone(validation.normalized);
      return;
    }

    this.hint = validation.error ?? "That shortcut is not valid.";
    this.callbacks.requestRender();
  }
}
