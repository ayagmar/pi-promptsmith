import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Api, AssistantMessage, Model } from "@mariozechner/pi-ai";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  SessionEntry,
} from "@mariozechner/pi-coding-agent";
import { SENTINEL_CLOSE, SENTINEL_OPEN } from "../src/constants.js";
import { PromptsmithRuntimeState } from "../src/state.js";

export interface MockPiHarness {
  pi: ExtensionAPI;
  commands: Map<string, { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> }>;
  shortcuts: Map<string, { handler: (ctx: ExtensionContext) => Promise<void> | void }>;
  events: Map<string, ((event: unknown, ctx: ExtensionContext) => unknown)[]>;
}

export interface MockUiState {
  notifications: { message: string; type: "info" | "warning" | "error" | undefined }[];
  status: Map<string, string | undefined>;
  editorText: string;
  editorResponse: string | undefined;
  nextSelectValue: string | undefined;
  nextInputValue: string | undefined;
  selectTitles: string[];
  selectOptionsHistory: string[][];
  customTitles: string[];
  customOptionsHistory: string[][];
  customRenderHistory: string[][];
  customInputSequence: string[];
  editorComponentHistory: ("set" | "clear")[];
  themeCount: number;
}

export function createMockPi(): MockPiHarness {
  const commands = new Map<
    string,
    { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> }
  >();
  const shortcuts = new Map<string, { handler: (ctx: ExtensionContext) => Promise<void> | void }>();
  const events = new Map<string, ((event: unknown, ctx: ExtensionContext) => unknown)[]>();

  const pi = {
    on: (eventName: string, handler: (event: unknown, ctx: ExtensionContext) => unknown) => {
      const handlers = events.get(eventName) ?? [];
      handlers.push(handler);
      events.set(eventName, handlers);
    },
    registerCommand: (
      name: string,
      command: { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> }
    ) => {
      commands.set(name, command);
    },
    registerShortcut: (
      name: string,
      shortcut: { handler: (ctx: ExtensionContext) => Promise<void> | void }
    ) => {
      shortcuts.set(name, shortcut);
    },
    exec: () => Promise.resolve({ stdout: "", stderr: "", code: 0, killed: false }),
  } as unknown as ExtensionAPI;

  return { pi, commands, shortcuts, events };
}

export function createRuntimeState(): PromptsmithRuntimeState {
  return new PromptsmithRuntimeState(
    join(mkdtempSync(join(tmpdir(), "promptsmith-test-state-")), "promptsmith-settings.json")
  );
}

export function createModel(overrides?: Partial<Model<Api>>): Model<Api> {
  return {
    id: "gpt-5",
    name: "GPT 5",
    api: "openai-responses",
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 8_192,
    ...overrides,
  };
}

export function createCommandContext(options?: {
  hasUI?: boolean;
  editorText?: string;
  editorResponse?: string;
  nextSelectValue?: string;
  nextInputValue?: string;
  customInputSequence?: string[];
  themeCount?: number;
  model?: Model<Api>;
  entries?: SessionEntry[];
  allModels?: Model<Api>[];
  apiKeys?: Map<string, string | undefined>;
  cwd?: string;
}): ExtensionCommandContext & { uiState: MockUiState } {
  const uiState: MockUiState = {
    notifications: [],
    status: new Map<string, string | undefined>(),
    editorText: options?.editorText ?? "",
    editorResponse: options?.editorResponse,
    nextSelectValue: options?.nextSelectValue,
    nextInputValue: options?.nextInputValue,
    selectTitles: [],
    selectOptionsHistory: [],
    customTitles: [],
    customOptionsHistory: [],
    customRenderHistory: [],
    customInputSequence: [...(options?.customInputSequence ?? [])],
    editorComponentHistory: [],
    themeCount: options?.themeCount ?? 1,
  };

  const allModels = options?.allModels ?? [options?.model ?? createModel()];
  const apiKeys =
    options?.apiKeys ?? new Map(allModels.map((model) => [modelKey(model), "test-key"]));

  const ctx = {
    hasUI: options?.hasUI ?? true,
    cwd: options?.cwd ?? `/tmp/project-${Math.random().toString(36).slice(2)}`,
    model: options?.model,
    sessionManager: {
      getBranch: () => options?.entries ?? [],
      getSessionFile: () => "/tmp/session.jsonl",
    },
    modelRegistry: {
      find: (provider: string, id: string) =>
        allModels.find((model) => model.provider === provider && model.id === id),
      getApiKey: (model: Model<Api>) => Promise.resolve(apiKeys.get(modelKey(model))),
      getAll: () => allModels,
    },
    ui: {
      notify: (message: string, type?: "info" | "warning" | "error") => {
        uiState.notifications.push({ message, type });
      },
      setStatus: (key: string, text: string | undefined) => {
        uiState.status.set(key, text);
      },
      getEditorText: () => uiState.editorText,
      setEditorText: (text: string) => {
        uiState.editorText = text;
      },
      editor: () => Promise.resolve(uiState.editorResponse),
      select: (title: string, options?: string[]) => {
        uiState.selectTitles.push(title);
        uiState.selectOptionsHistory.push(options ? [...options] : []);
        return Promise.resolve(uiState.nextSelectValue);
      },
      input: () => Promise.resolve(uiState.nextInputValue),
      getAllThemes: () =>
        Array.from({ length: uiState.themeCount }, (_, index) => ({
          name: `theme-${index}`,
          path: undefined,
        })),
      custom: (factory: unknown) => {
        let resolved = false;
        let result: unknown;
        let resolveResult: ((value: unknown) => void) | undefined;
        let customComponent:
          | {
              render?: (width: number) => string[];
              handleInput?: (data: string) => void;
              title?: string;
              allItems?: { value: string; label: string }[];
              onDone?: (value: string | undefined) => void;
              dispose?: () => void;
            }
          | undefined;
        const done = (value: unknown) => {
          resolved = true;
          result = value;
          customComponent?.dispose?.();
          resolveResult?.(result);
        };

        const theme: {
          fg: (color: string, text: string) => string;
          bg: (color: string, text: string) => string;
          bold: (text: string) => string;
        } = {
          fg: (_color: string, text: string) => text,
          bg: (_color: string, text: string) => text,
          bold: (text: string) => text,
        };

        const captureRender = () => {
          if (customComponent?.render) {
            uiState.customRenderHistory.push(customComponent.render(120));
          }
        };

        const component =
          typeof factory === "function"
            ? (
                factory as (
                  tui: { requestRender: () => void },
                  theme: {
                    fg: (color: string, text: string) => string;
                    bg: (color: string, text: string) => string;
                    bold: (text: string) => string;
                  },
                  keybindings: { getEffectiveConfig: () => Record<string, string | string[]> },
                  done: (value: unknown) => void
                ) => { render?: (width: number) => string[]; handleInput?: (data: string) => void }
              )({ requestRender: captureRender }, theme, { getEffectiveConfig: () => ({}) }, done)
            : factory;

        customComponent = component as {
          render?: (width: number) => string[];
          handleInput?: (data: string) => void;
          title?: string;
          allItems?: { value: string; label: string }[];
          onDone?: (value: string | undefined) => void;
          dispose?: () => void;
        };

        if (resolved) {
          customComponent.dispose?.();
        }

        if (customComponent.title) {
          uiState.customTitles.push(customComponent.title);
        }
        if (Array.isArray(customComponent.allItems)) {
          uiState.customOptionsHistory.push(
            customComponent.allItems.map((item) => item.label ?? item.value)
          );
        }
        captureRender();

        if (uiState.customInputSequence.length > 0 && customComponent.handleInput) {
          for (const input of uiState.customInputSequence) {
            customComponent.handleInput(input);
            captureRender();
            if (resolved) {
              break;
            }
          }
          uiState.customInputSequence = [];
        }

        if (
          !resolved &&
          uiState.nextSelectValue !== undefined &&
          typeof customComponent.onDone === "function"
        ) {
          customComponent.onDone(uiState.nextSelectValue);
        }

        if (!resolved && typeof customComponent.onDone === "function") {
          customComponent.onDone(undefined);
        }

        if (resolved) {
          return Promise.resolve(result);
        }

        return new Promise((resolve) => {
          resolveResult = resolve;
        });
      },
      confirm: () => Promise.resolve(false),
      onTerminalInput: () => () => undefined,
      setWorkingMessage: () => undefined,
      setWidget: () => undefined,
      setFooter: () => undefined,
      setHeader: () => undefined,
      setTitle: () => undefined,
      pasteToEditor: (text: string) => {
        uiState.editorText = text;
      },
      setEditorComponent: (factory: unknown) => {
        uiState.editorComponentHistory.push(factory ? "set" : "clear");
      },
      theme: {
        fg: (_color: string, text: string) => text,
        bg: (_color: string, text: string) => text,
        bold: (text: string) => text,
      },
      getTheme: () => undefined,
      setTheme: () => ({ success: false, error: "unsupported" }),
      getToolsExpanded: () => false,
      setToolsExpanded: () => undefined,
    },
    isIdle: () => true,
    abort: () => undefined,
    hasPendingMessages: () => false,
    shutdown: () => undefined,
    getContextUsage: () => undefined,
    compact: () => undefined,
    getSystemPrompt: () => "",
    waitForIdle: () => Promise.resolve(),
    newSession: () => Promise.resolve({ cancelled: false }),
    fork: () => Promise.resolve({ cancelled: false }),
    navigateTree: () => Promise.resolve({ cancelled: false }),
    switchSession: () => Promise.resolve({ cancelled: false }),
    reload: () => Promise.resolve(),
    uiState,
  };

  return ctx as unknown as ExtensionCommandContext & { uiState: MockUiState };
}

export function createAssistantResponse(text: string): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "openai-responses",
    provider: "openai",
    model: "gpt-5",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

export function createCompleteResponse(prompt: string): AssistantMessage {
  return createAssistantResponse(`${SENTINEL_OPEN}${prompt}${SENTINEL_CLOSE}`);
}

export function createRunTaskStub(result: string | null) {
  return (
    _ctx: ExtensionContext,
    _message: string,
    task: (signal: AbortSignal) => Promise<string | null>
  ): Promise<string | null> => {
    if (result !== "__RUN_TASK__") {
      return Promise.resolve(result);
    }
    return task(new AbortController().signal);
  };
}

export function modelKey(model: Pick<Model<Api>, "provider" | "id">): string {
  return `${model.provider}/${model.id}`;
}

export function createUserEntry(text: string): SessionEntry {
  return {
    type: "message",
    id: `user-${Math.random()}`,
    parentId: null,
    timestamp: new Date().toISOString(),
    message: { role: "user", content: text, timestamp: Date.now() },
  };
}

export function createAssistantEntry(text: string): SessionEntry {
  return {
    type: "message",
    id: `assistant-${Math.random()}`,
    parentId: null,
    timestamp: new Date().toISOString(),
    message: createAssistantResponse(text),
  };
}
