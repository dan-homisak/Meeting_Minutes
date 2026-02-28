# Meeting Minutes Live (Obsidian-Style Live Preview)

A local-first markdown editor focused on a single live preview workflow.

## What Changed

This rewrite is a big-bang cut to a live-only runtime:

- Single mode: live preview editing only.
- New runtime pipeline in `src/live-v4/`.
- Full-block inactive rendering with one active editable block.
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
- `src/live-v4/CursorController.js`: vertical cursor movement.

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
```

See `docs/live-v4-probe.md` for flags and artifact details.

## Build

```bash
npm run build
```

## Browser Support

- Best support: Chromium desktop browsers (Chrome, Edge, Brave).
- Requires secure context (`https://` or `http://localhost`).
