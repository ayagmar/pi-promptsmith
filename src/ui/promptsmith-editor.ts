import { CustomEditor, type KeybindingsManager } from "@mariozechner/pi-coding-agent";
import type { EditorTheme, TUI } from "@mariozechner/pi-tui";
import { matchesCustomShortcut } from "../shortcut-key.js";
import type { PromptsmithSettings } from "../types.js";

export class PromptsmithEditor extends CustomEditor {
  constructor(
    tui: TUI,
    theme: EditorTheme,
    private readonly promptsmithKeybindings: KeybindingsManager,
    private readonly getSettings: () => PromptsmithSettings,
    private readonly onPromptsmithShortcut: () => void
  ) {
    super(tui, theme, promptsmithKeybindings);
  }

  handleInput(data: string): void {
    if (
      matchesCustomShortcut(
        data,
        this.getSettings(),
        this.promptsmithKeybindings.getEffectiveConfig()
      )
    ) {
      this.onPromptsmithShortcut();
      return;
    }

    super.handleInput(data);
  }
}
