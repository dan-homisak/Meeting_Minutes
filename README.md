# Meeting Minutes Live (Obsidian-Style Live Preview)

A local-first markdown editor focused on a single live preview workflow.

## What Changed

This rewrite is a big-bang cut to a live-only runtime:

- Single mode: live preview editing only.
- New runtime pipeline in `src/live-v4/`.
- Full-block inactive rendering with one active editable block for block-backed lines (`activeBlockId` is `null` on inter-block blank lines).
- Syntax-level source transforms for single-line heading/list/task/blockquote markers.
- Deterministic source mapping via `data-src-*` and interaction map entries.
- Legacy source/preview mode wiring removed from the runtime entry path.

## Core Runtime Pipeline

`source text -> parser/model -> block projection -> CodeMirror decorations -> interaction map`

Key modules:

- `src/live-v4/createLiveApp.js`: live-only app composition root.
- `src/live-v4/LiveRuntime.js`: runtime assembly (parser, renderer, state, pointer/cursor).
- `src/live-v4/parser/ObsidianCoreParser.js`: core parser/session adapter.
- `src/live-v4/model/LiveDocModel.js`: canonical live document model.
- `src/live-v4/LiveStateField.js`: CodeMirror state field for live projection updates.
- `src/live-v4/LiveRenderer.js`: projection + decorations renderer.
- `src/live-v4/LiveProjection.js`: active block selection, virtualization, render budgeting.
- `src/live-v4/InteractionMap.js`: deterministic source interaction mapping.
- `src/live-v4/PointerController.js`: pointer activation, task toggle, modifier-link open.
- `src/live-v4/CursorController.js`: vertical/horizontal cursor movement + list indent/outdent controls.

Operational docs:

- `docs/architecture-plan.md`
- `docs/live-view-troubleshooting.md`
- `docs/live-v4-probe.md`
- `docs/live-v4-screenshot-method.md`
- `docs/live-v4-visual-regression-history.md`

## Run

```bash
npm install
npm run launch
```

Then click **Open Vault** and choose a local folder with markdown files.

## Test

Parity-first suite:

```bash
npm test
```

Watch mode:

```bash
npm run test:watch
```

## Automated Live Preview Probe

The project includes an automated troubleshooting runner that places cursors at exact positions, clicks rendered widgets, and captures screenshots + diagnostics:

```bash
npm run probe:live-v4
npm run probe:live-v4 -- --fixture code-blocks
```

See `docs/live-v4-probe.md` for flags and artifact details.

## Current List Cursor Strategy

This repository currently uses a "visible-syntax first" cursor policy for list lines:

1. Bullet, checkbox/task, and numbered list syntax is cursor-accessible character-by-character.
2. Custom horizontal handling only skips hidden ranges (hidden indentation guides and hidden marker trailing gaps).
3. Cursor never intentionally lands inside hidden syntax ranges.
4. `Tab` / `Shift-Tab` / `Backspace` in guide/marker zone adjust list nesting (indent/outdent).

## Current Code Block Strategy

1. Fenced code blocks use source-transform lines in live preview (no multiline range replacement).
2. Source code lines use explicit code-line styling (`mm-live-v4-source-code-line`) for stable monospace typography/chrome.
3. This keeps gutter line numbers continuous through code blocks while preserving native cursor traversal.
4. Native arrow traversal across fence syntax is validated by probe steps.
5. The blank line after a closing fence is not treated as part of the code block active range.
6. Typing the third backtick on an otherwise empty fence line auto-inserts a closing fence on the next line, shifting existing next-line content down.
7. Code blocks include a right-aligned `Copy` button that copies only content between the opening and closing fences.

## Build

```bash
npm run build
```

## Browser Support

- Best support: Chromium desktop browsers (Chrome, Edge, Brave).
- Requires secure context (`https://` or `http://localhost`).
