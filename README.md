# Meeting Minutes Live (Obsidian-Style Live Preview)

A local-first markdown editor focused on a single live preview workflow.

## What Changed

This rewrite is a big-bang cut to a live-only runtime:

- Single mode: live preview editing only.
- New runtime pipeline in `src/live-v3/`.
- Full-block inactive rendering with one active editable block.
- Deterministic source mapping via `data-src-*` and interaction map entries.
- Legacy source/preview mode wiring removed from the runtime entry path.

## Core Runtime Pipeline

`source text -> parser/model -> block projection -> CodeMirror decorations -> interaction map`

Key modules:

- `src/live-v3/createLiveApp.js`: live-only app composition root.
- `src/live-v3/LiveRuntime.js`: runtime assembly (parser, renderer, state, pointer/cursor).
- `src/live-v3/parser/ObsidianCoreParser.js`: core parser/session adapter.
- `src/live-v3/model/LiveDocModel.js`: canonical live document model.
- `src/live-v3/LiveStateField.js`: CodeMirror state field for live projection updates.
- `src/live-v3/LiveRenderer.js`: projection + decorations renderer.
- `src/live-v3/LiveProjection.js`: active block selection, virtualization, render budgeting.
- `src/live-v3/InteractionMap.js`: deterministic source interaction mapping.
- `src/live-v3/PointerController.js`: pointer activation, task toggle, modifier-link open.
- `src/live-v3/CursorController.js`: vertical cursor movement.

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

## Build

```bash
npm run build
```

## Browser Support

- Best support: Chromium desktop browsers (Chrome, Edge, Brave).
- Requires secure context (`https://` or `http://localhost`).
