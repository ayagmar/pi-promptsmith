import type { Context, Message } from "@mariozechner/pi-ai";
import { buildStrategyInstructions } from "../contracts.js";
import { buildSharedContextSections, buildSharedSystemPrompt } from "./shared.js";
import type { PromptsmithContextPayload } from "../types.js";

export function buildGptStrategyRequest(context: PromptsmithContextPayload): Context {
  const userMessage: Message = {
    role: "user",
    timestamp: Date.now(),
    content: [
      {
        type: "text",
        text: [
          ...buildStrategyInstructions("gpt", context),
          buildSharedContextSections(context),
        ].join("\n\n"),
      },
    ],
  };

  return {
    systemPrompt: buildSharedSystemPrompt("GPT-style"),
    messages: [userMessage],
  };
}
