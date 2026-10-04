import { type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getPromptsmithArgumentCompletions, handlePromptsmithCommand } from "./commands.js";
import { DEFAULT_SHORTCUT_KEY, EXTENSION_COMMAND } from "./constants.js";
import {
  type CompleteFn,
  createModelRegistryCompleteFn,
  runEnhancementWithLoader,
} from "./enhance.js";
import { handlePromptsmithShortcut } from "./shortcut.js";
import { formatShortcutKey, getCustomShortcutKey } from "./shortcut-key.js";
import { PromptsmithRuntimeState } from "./state.js";
import { attachPromptsmithShortcut, createBasePromptsmithEditor } from "./ui/promptsmith-editor.js";
import { openSettingsUi } from "./ui/settings.js";
import { refreshStatusLine } from "./ui/status.js";

export default function promptsmithExtension(pi: ExtensionAPI): void {
  createPromptsmithExtension(pi);
}

export function createPromptsmithExtension(
  pi: ExtensionAPI,
  options?: { completeFn?: CompleteFn; runtime?: PromptsmithRuntimeState }
): void {
  const runtime = options?.runtime ?? new PromptsmithRuntimeState();
  let ownsEditorComponent = false;
  let previousEditorFactory: ReturnType<ExtensionContext["ui"]["getEditorComponent"]>;
  let installedCustomShortcutKey: string | undefined;
  let activeCustomShortcutKey: string | undefined;
  let lastSettingsWarning: string | undefined;

  const resolveCompleteFn = (ctx: ExtensionContext): CompleteFn =>
    options?.completeFn ?? createModelRegistryCompleteFn(ctx.modelRegistry);

  const clearEditorComponent = (ctx: ExtensionContext): void => {
    installedCustomShortcutKey = undefined;
    activeCustomShortcutKey = undefined;
    if (!ownsEditorComponent) {
      return;
    }

    ctx.ui.setEditorComponent(previousEditorFactory);
    previousEditorFactory = undefined;
    ownsEditorComponent = false;
  };

  const applyEditorComponent = (ctx: ExtensionContext): void => {
    if (ctx.mode !== "tui") {
      return;
    }

    const shortcutKey = getCustomShortcutKey(runtime.getSettings());
    if (!shortcutKey) {
      clearEditorComponent(ctx);
      return;
    }

    if (ownsEditorComponent && installedCustomShortcutKey === shortcutKey) {
      return;
    }

    const baseEditorFactory = ownsEditorComponent
      ? previousEditorFactory
      : ctx.ui.getEditorComponent();

    installedCustomShortcutKey = shortcutKey;
    activeCustomShortcutKey = undefined;
    previousEditorFactory = baseEditorFactory;
    ownsEditorComponent = true;
    ctx.ui.setEditorComponent((tui, theme, keybindings) => {
      activeCustomShortcutKey = getCustomShortcutKey(
        runtime.getSettings(),
        keybindings.getEffectiveConfig()
      );

      const baseEditor =
        baseEditorFactory?.(tui, theme, keybindings) ??
        createBasePromptsmithEditor(tui, theme, keybindings);

      return attachPromptsmithShortcut(
        baseEditor,
        keybindings,
        () => runtime.getSettings(),
        () => {
          void handlePromptsmithShortcut(ctx, runtime, {
            completeFn: resolveCompleteFn(ctx),
            exec: pi.exec.bind(pi),
            sendUserMessage: pi.sendUserMessage.bind(pi),
            refreshStatus,
            runCancellableTask: runEnhancementWithLoader,
            openSettings,
          });
        }
      );
    });
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
    const shortcutServices = {
      completeFn: resolveCompleteFn(ctx),
      exec: pi.exec.bind(pi),
      sendUserMessage: pi.sendUserMessage.bind(pi),
      refreshStatus,
      runCancellableTask: runEnhancementWithLoader,
      openSettings,
    };

    if (!settings.enabled) {
      await handlePromptsmithShortcut(ctx, runtime, shortcutServices);
      return;
    }

    if (!settings.shortcutEnabled) {
      ctx.ui.notify("Promptsmith shortcut is disabled globally.", "info");
      return;
    }

    if (activeCustomShortcutKey && activeCustomShortcutKey !== DEFAULT_SHORTCUT_KEY) {
      ctx.ui.notify(
        `Promptsmith shortcut is now ${formatShortcutKey(activeCustomShortcutKey)}.`,
        "info"
      );
      return;
    }

    await handlePromptsmithShortcut(ctx, runtime, shortcutServices);
  };

  const restorePersistedSettings = (ctx: ExtensionContext): void => {
    // session_tree reloads the settings too; only warn when the problem is new.
    const warning = runtime.restoreSettings();
    if (warning && warning !== lastSettingsWarning && ctx.hasUI) {
      ctx.ui.notify(warning, "warning");
    }
    lastSettingsWarning = warning;
    refreshStatus(ctx);
  };

  pi.on("session_start", (_event, ctx) => {
    restorePersistedSettings(ctx);
  });
  pi.on("session_tree", (_event, ctx) => {
    restorePersistedSettings(ctx);
  });
  pi.on("model_select", (_event, ctx) => {
    refreshStatus(ctx);
  });
  pi.on("session_shutdown", (_event, ctx) => {
    clearEditorComponent(ctx);
  });

  pi.registerCommand(EXTENSION_COMMAND, {
    description: "Enhance the current editor prompt in-place",
    getArgumentCompletions: getPromptsmithArgumentCompletions,
    handler: async (args, ctx) => {
      await handlePromptsmithCommand(args, ctx, runtime, {
        completeFn: resolveCompleteFn(ctx),
        exec: pi.exec.bind(pi),
        sendUserMessage: pi.sendUserMessage.bind(pi),
        refreshStatus,
        runCancellableTask: runEnhancementWithLoader,
      });
    },
  });

  // Where pi's keybindings give Alt+P to a reserved action (by default model
  // cycling on Windows and WSL), pi would skip this registration with a startup
  // warning; a custom shortcut still works there.
  if (!runtime.getDefaultShortcutReservedAction()) {
    pi.registerShortcut(DEFAULT_SHORTCUT_KEY, {
      description: "Enhance the current editor prompt",
      handler: async (ctx) => {
        await triggerDefaultShortcut(ctx);
      },
    });
  }
}
