import { type Context, type Message } from "@earendil-works/pi-ai";
import { buildStrategyInstructions } from "../contracts.js";
import { type PromptsmithContextPayload } from "../types.js";
import { buildSharedContextSections, buildSharedSystemPrompt } from "./shared.js";

export function buildClaudeStrategyRequest(context: PromptsmithContextPayload): Context {
  const userMessage: Message = {
    role: "user",
    timestamp: Date.now(),
    content: [
      {
        type: "text",
        text: [
          ...buildStrategyInstructions("claude", context),
          buildSharedContextSections(context),
        ].join("\n\n"),
      },
    ],
  };

  return {
    systemPrompt: buildSharedSystemPrompt("Claude-style"),
    messages: [userMessage],
  };
}
