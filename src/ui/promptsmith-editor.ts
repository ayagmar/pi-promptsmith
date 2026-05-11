import { CustomEditor, type KeybindingsManager } from "@earendil-works/pi-coding-agent";
import type { EditorComponent, EditorTheme, TUI } from "@earendil-works/pi-tui";
import { matchesCustomShortcut } from "../shortcut-key.js";
import type { PromptsmithSettings } from "../types.js";

export function createBasePromptsmithEditor(
  tui: TUI,
  theme: EditorTheme,
  keybindings: KeybindingsManager
): EditorComponent {
  return new CustomEditor(tui, theme, keybindings);
}

export function attachPromptsmithShortcut(
  editor: EditorComponent,
  keybindings: KeybindingsManager,
  getSettings: () => PromptsmithSettings,
  onPromptsmithShortcut: () => void
): EditorComponent {
  const handleBaseInput = editor.handleInput.bind(editor);

  editor.handleInput = (data: string): void => {
    if (matchesCustomShortcut(data, getSettings(), keybindings.getEffectiveConfig())) {
      onPromptsmithShortcut();
      return;
    }

    handleBaseInput(data);
  };

  return editor;
}
