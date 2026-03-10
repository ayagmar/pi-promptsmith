import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { PromptsmithRuntimeState } from "../state.js";
import { detectRuntimeSupport } from "../validation.js";
import {
  runSettingsAction,
  type SettingsUiServices,
  resetGlobalSettings,
} from "./settings-actions.js";
import { buildSettingsMenuOptions, type SettingsMenuOptionId } from "./settings-menu.js";
import { openSelectDialog } from "./select-dialog.js";

export async function openSettingsUi(
  ctx: ExtensionContext,
  runtime: PromptsmithRuntimeState,
  services: SettingsUiServices
): Promise<void> {
  const support = detectRuntimeSupport(ctx);
  if (!support.interactiveTui) {
    throw new Error(support.reason);
  }

  while (true) {
    const settings = runtime.getSettings();
    const menuOptions = buildSettingsMenuOptions(settings);
    const choice = (await openSelectDialog(ctx, {
      title: "Promptsmith settings",
      items: Object.values(menuOptions),
      pageSize: 10,
      searchable: true,
      emptyLabel: "  No matching settings",
    })) as SettingsMenuOptionId | undefined;

    if (!choice || choice === "done") {
      return;
    }

    await runSettingsAction(choice, { ctx, runtime, services, settings });
  }
}

export { resetGlobalSettings };
export type { SettingsUiServices };
