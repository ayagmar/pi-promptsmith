import { complete } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { CompleteFn } from "./enhance.js";
import { DEFAULT_SHORTCUT_KEY, EXTENSION_COMMAND } from "./constants.js";
import { getPromptsmithArgumentCompletions, handlePromptsmithCommand } from "./commands.js";
import { runEnhancementWithLoader } from "./enhance.js";
import { formatShortcutKey, normalizeShortcutKey } from "./shortcut-key.js";
import { PromptsmithRuntimeState } from "./state.js";
import { handlePromptsmithShortcut } from "./shortcut.js";
import { PromptsmithEditor } from "./ui/promptsmith-editor.js";
import { openSettingsUi } from "./ui/settings.js";
import { refreshStatusLine } from "./ui/status.js";

export default function promptsmithExtension(pi: ExtensionAPI): void {
  createPromptsmithExtension(pi);
}

export function createPromptsmithExtension(
  pi: ExtensionAPI,
  options?: { completeFn?: CompleteFn }
): void {
  const runtime = new PromptsmithRuntimeState();
  let ownsEditorComponent = false;

  const applyEditorComponent = (ctx: ExtensionContext): void => {
    if (!ctx.hasUI) {
      return;
    }

    const settings = runtime.getSettings();
    const shortcutKey = normalizeShortcutKey(settings.shortcutKey) ?? DEFAULT_SHORTCUT_KEY;
    const shouldUseCustomEditor =
      settings.enabled && settings.shortcutEnabled && shortcutKey !== DEFAULT_SHORTCUT_KEY;

    if (!shouldUseCustomEditor) {
      if (ownsEditorComponent) {
        ctx.ui.setEditorComponent(undefined);
        ownsEditorComponent = false;
      }
      return;
    }

    ownsEditorComponent = true;
    ctx.ui.setEditorComponent(
      (tui, theme, keybindings) =>
        new PromptsmithEditor(
          tui,
          theme,
          keybindings,
          () => runtime.getSettings(),
          () => {
            void handlePromptsmithShortcut(ctx, runtime, {
              completeFn: options?.completeFn ?? complete,
              exec: pi.exec.bind(pi),
              refreshStatus,
              runCancellableTask: runEnhancementWithLoader,
              openSettings,
            });
          }
        )
    );
  };

  const refreshStatus = (ctx: ExtensionContext): void => {
    applyEditorComponent(ctx);
    refreshStatusLine(ctx, runtime);
  };

  const openSettings = async (ctx: ExtensionContext): Promise<void> => {
    await openSettingsUi(ctx, runtime, { refreshStatus });
  };

  const triggerDefaultShortcut = async (ctx: ExtensionContext): Promise<void> => {
    const settings = runtime.getSettings();
    const shortcutKey = normalizeShortcutKey(settings.shortcutKey) ?? DEFAULT_SHORTCUT_KEY;
    if (settings.enabled && settings.shortcutEnabled && shortcutKey !== DEFAULT_SHORTCUT_KEY) {
      ctx.ui.notify(`Promptsmith shortcut is now ${formatShortcutKey(shortcutKey)}.`, "info");
      return;
    }

    await handlePromptsmithShortcut(ctx, runtime, {
      completeFn: options?.completeFn ?? complete,
      exec: pi.exec.bind(pi),
      refreshStatus,
      runCancellableTask: runEnhancementWithLoader,
      openSettings,
    });
  };

  const restorePersistedSettings = (ctx: ExtensionContext): void => {
    runtime.restoreSettings();
    refreshStatus(ctx);
  };

  pi.on("session_start", (_event, ctx) => {
    restorePersistedSettings(ctx);
  });
  pi.on("session_switch", (_event, ctx) => {
    restorePersistedSettings(ctx);
  });
  pi.on("session_tree", (_event, ctx) => {
    restorePersistedSettings(ctx);
  });
  pi.on("session_fork", (_event, ctx) => {
    restorePersistedSettings(ctx);
  });
  pi.on("model_select", (_event, ctx) => {
    refreshStatus(ctx);
  });

  pi.registerCommand(EXTENSION_COMMAND, {
    description: "Enhance the current editor prompt in-place",
    getArgumentCompletions: getPromptsmithArgumentCompletions,
    handler: async (args, ctx) => {
      await handlePromptsmithCommand(args, ctx, runtime, {
        completeFn: options?.completeFn ?? complete,
        exec: pi.exec.bind(pi),
        refreshStatus,
        runCancellableTask: runEnhancementWithLoader,
      });
    },
  });

  pi.registerShortcut(DEFAULT_SHORTCUT_KEY, {
    description: "Enhance the current editor prompt",
    handler: async (ctx) => {
      await triggerDefaultShortcut(ctx);
    },
  });
}
