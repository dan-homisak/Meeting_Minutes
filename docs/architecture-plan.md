# Live-v4 Architecture (Obsidian-Style Live Preview)

## Scope

- Single runtime mode: live preview only.
- Core markdown parity focus (headings, paragraph, emphasis, strong, strike, code, links, wikilinks, blockquotes, lists, tasks, tables, code fences, hr, frontmatter).
- Light theme visual parity target.
- No legacy preview/raw pipelines in runtime.

## Canonical Runtime Pipeline

`source text -> parser/model -> projection -> CodeMirror decorations -> interaction map`

## Key Runtime Modules

- `src/live-v4/createLiveApp.js`: app composition root and probe API.
- `src/live-v4/LiveRuntime.js`: runtime assembly.
- `src/live-v4/LiveStateField.js`: state-driven projection lifecycle.
- `src/live-v4/LiveProjection.js`: active-block selection, virtualization, render budget.
- `src/live-v4/LiveRenderer.js`: decoration builder (block widgets + source transforms).
- `src/live-v4/parser/ObsidianCoreParser.js`: canonical markdown parse + stable block IDs.
- `src/live-v4/model/LiveDocModel.js`: canonical data contract.
- `src/live-v4/InteractionMap.js`: deterministic click-to-source mapping.
- `src/live-v4/PointerController.js`: pointer activation, task toggle, modifier-link behavior.
- `src/live-v4/CursorController.js`: vertical + horizontal cursor policy and list indent/outdent controls.

## Source-Transform Strategy (Current Path)

- Keep exactly one editable active block.
- Render inactive multiline regions as block widgets.
- For single-line syntax-sensitive blocks (`heading`, `list`, `task`, `blockquote`), keep the line in source and apply syntax transforms via marks/widgets.
- Hide syntax markers when cursor is outside marker ranges; reveal marker source only when cursor enters marker syntax.
- Use marker-width-aware inline prefix widgets to keep horizontal geometry stable across hidden/visible marker transitions.

## List Syntax Cursor Policy (Current)

This is the active behavior contract for list-like lines in live view:

1. Bullet, task/checkbox, and ordered list syntax must be directly reachable by cursor.
2. Horizontal movement should remain native inside visible syntax characters.
3. Controller-assisted movement is only used to skip hidden ranges:
- hidden indentation (guide columns)
- hidden marker trailing spacing before content
4. Cursor must not become invisible due to landing in hidden marker ranges.
5. `Tab` / `Shift-Tab` / `Backspace` in the marker/guide zone perform list indent/outdent.

## Non-Negotiable Runtime Contracts

1. Exactly one active editable block.
2. Deterministic pointer mapping from rendered DOM back to source positions.
3. Cursor movement does not jump unexpectedly across rendered/source boundaries.
4. Task toggles mutate markdown source (`[ ]` <-> `[x]`).
5. No mode switching runtime path.

## Validation Gates

1. `npm test`
2. `npm run build`
3. `npm run probe:live-v4 -- --fixture lists-and-tasks`
4. For cursor/list-marker changes, also run:
`npm run probe:live-v4 -- --fixture single-bullet`
`npm run probe:live-v4 -- --fixture single-nested-bullet`

Probe output is the visual/interaction source of truth for regression triage.
