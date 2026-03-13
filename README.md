# pi-promptsmith

Promptsmith is a prompt-rewriting extension for [Pi](https://github.com/mariozechner/pi-coding-agent). It takes the rough draft in your Pi editor and turns it into a clearer, stronger prompt without making you leave the editor.

![Promptsmith demo](./promptsmith.gif)

It supports two output styles:

- **Plain rewrite** — tighten and clarify the prompt
- **Execution contract** — turn a rough task into a compact, agent-executable spec

## Installation

Run it once in Pi without installing:

```bash
pi -e npm:pi-promptsmith
```

Install it as a Pi package:

```bash
pi install npm:pi-promptsmith
```

Or install directly from git:

```bash
pi install git:github.com/ayagmar/pi-promptsmith
```

## Quick start

Write a rough request in the Pi editor, then:

- press `Alt+P` by default (or your custom Promptsmith shortcut), or
- run `/promptsmith`

Promptsmith rewrites the current draft directly in the editor.

To undo the last enhancement:

- run `/promptsmith undo`

## How it works

Promptsmith looks at:

- the current editor draft
- your configured rewrite mode
- the selected model family / routing rules
- optional context settings, if enabled

Supported target families:

- `gpt`
- `claude`

## Rewrite modes

Promptsmith stores its settings globally in `~/.pi/agent/promptsmith-settings.json`.

### `auto` (default)

Promptsmith uses deterministic local heuristics to decide whether the draft should become:

- a **plain rewrite**, or
- an **execution contract**

`auto` tends to choose **execution-contract** for coding-agent work such as:

- implementing a feature
- debugging or fixing a bug
- refactoring
- reviewing code
- researching an approach
- updating docs
- adding or fixing tests

`auto` tends to choose **plain** for things like:

- explanations
- brainstorming
- ideation
- prose cleanup
- open-ended chat

### `plain`

Always produce a stronger prompt without deliberately compiling it into an execution contract.

### `execution-contract`

Always produce a compact task spec that is easier for a coding agent to execute.

## What execution-contract mode does

Execution-contract rewrites stay compact, but make the task more explicit when useful, including things like:

- goal
- relevant context
- constraints
- files or surfaces to inspect
- expected change
- verification steps
- output expectations

It is intentionally **not** a giant fixed template. Promptsmith keeps concrete user details such as file paths, commands, APIs, and acceptance criteria, while avoiding made-up requirements.

Family-aware behavior still applies:

- **GPT-style** rewrites stay natural and compact
- **Claude-style** rewrites can use stronger structure, including XML-like sections when that genuinely helps

## Examples

### Plain rewrite

Draft:

```text
can you rewrite this prompt so it sounds better and asks for a short explanation of how model routing works
```

Typical result:

```text
Explain how Promptsmith model routing works. Keep the explanation concise and practical. Focus on how the active model, explicit overrides, and fallback rules determine the final target family.
```

### Execution contract

Draft:

```text
add rewrite mode support for promptsmith and make status show what mode it picks
```

Typical result:

```text
Goal
Add rewrite mode support to Promptsmith and update status reporting so it shows both the configured mode and the resolved mode for the current editor draft.

Constraints
- Preserve current preview, undo, timeout, and cancellation behavior.
- Keep settings persisted globally across Pi sessions.
- Do not add extra model calls.

What to inspect
- command handling and persisted settings
- enhancement request shaping
- status reporting
- settings UI

Verification
- update or add tests for mode persistence, command handling, and status output
- run the relevant project checks
```

## Commands

Main commands:

- `/promptsmith` — enhance the current editor draft
- `/promptsmith undo` — restore the previous pre-enhancement draft
- `/promptsmith status` — show current configuration and runtime state
- `/promptsmith settings` — open the interactive settings UI
- `/promptsmith reset-settings` — restore saved global defaults

### Interactive settings UX

Inside the interactive settings and model pickers:

- lists wrap around at the top and bottom
- large model lists are paginated to stay compact
- press `/` to open search in the compact selector
- `PageUp` / `PageDown` switch pages in paginated selectors
- the keyboard shortcut row lets you turn the shortcut on or off, remap it, or reset it to `Alt+P`
- when remapping, press the new key combo directly; `Esc` cancels and `Backspace` resets to default

Quick config:

- `/promptsmith enable`
- `/promptsmith disable`
- `/promptsmith family auto|gpt|claude`
- `/promptsmith mode auto|plain|execution-contract`
- `/promptsmith enhancer-model active`
- `/promptsmith enhancer-model fixed <provider>/<id>`
- `/promptsmith enhancer-model family-linked <gpt-provider>/<gpt-id> <claude-provider>/<claude-id>`
- `/promptsmith map active <gpt|claude>`
- `/promptsmith map set <provider>/<id> <gpt|claude>`
- `/promptsmith map add <pattern> <gpt|claude>`
- `/promptsmith map remove <pattern>`
- `/promptsmith conversation on|off`
- `/promptsmith project-metadata on|off`
- `/promptsmith status-bar on|off`
- `/promptsmith strength light|balanced|strong`
- `/promptsmith preview on|off`
- `/promptsmith preserve-code on|off`
- `/promptsmith timeout <seconds>`

## Settings at a glance

Promptsmith saves global settings in:

```text
~/.pi/agent/promptsmith-settings.json
```

Important defaults:

- keyboard shortcut = `Alt+P`
- rewrite mode = `auto`
- rewrite strength = `balanced`
- status bar = `off`
- recent conversation = `off`
- project metadata = `off`
- preview before replace = `false`
- preserve code blocks = `true`
- enhancement timeout = `45s`

## What context Promptsmith uses

By default, Promptsmith is fairly lightweight. It always uses:

- the current editor draft
- the chosen rewrite mode
- target-family routing
- local intent detection

Optional context:

- **Recent conversation** — recent chat history from the current session branch
- **Project metadata** — current working directory and git branch, if available

It does **not** automatically read your repository files, `AGENTS.md`, or README by default.

## Status

There are two ways to see status:

- optional footer status bar
- `/promptsmith status`

`/promptsmith status` reports things like:

- whether the footer status bar is enabled
- configured rewrite mode
- resolved target family
- timeout
- current draft intent and effective rewrite mode, when the editor is readable

Outside interactive editor mode, draft-aware status degrades gracefully.

## Routing

Target-family routing order:

1. forced family mode when not `auto`
2. exact model overrides
3. pattern overrides
4. built-in defaults
5. fallback family

Built-in defaults include:

- OpenAI GPT / o-series → `gpt`
- Anthropic Claude → `claude`
- Moonshot / Kimi-style identifiers → `claude`

Enhancer model execution is configured separately:

- `active`
- `fixed`
- `family-linked`

## Safety guarantees

Promptsmith keeps a few important guarantees:

- the editor is not mutated on failure
- the editor is not mutated on cancellation
- hung requests time out instead of spinning forever
- preview mode lets you review before replace
- only one enhancement runs at a time
- output must contain exactly one sentinel block
- single collapsed Pi paste markers can be recovered from the clipboard; multi-marker drafts fail closed
- oversized drafts fail clearly instead of being truncated silently
- intent detection is local and deterministic; it does not use a second model call

## Runtime support

- **Interactive TUI:** full support
- **RPC:** status and non-editor settings commands work, but in-place enhancement is blocked because Pi RPC cannot read the current editor buffer
- **print/json:** editor-dependent actions are unsupported

## Development

```bash
git clone https://github.com/ayagmar/pi-promptsmith.git
cd pi-promptsmith
pnpm install
pnpm run check
```

Load the local extension in Pi:

```bash
pi -e ./src/index.ts
```

Maintainer release notes live in [`docs/releasing.md`](./docs/releasing.md).
