# Live-V3 Architecture (Strict Obsidian-Style Cut)

## Scope

- Live preview only runtime.
- Core markdown parity only.
- Light-theme visual parity focus.
- No preview mode and no raw mode in runtime path.

## Canonical Contracts

### `LiveDocModel`

- `version: number`
- `text: string`
- `blocks: LiveBlock[]`
- `inlines: LiveInline[]`
- `meta: { dialect: 'obsidian-core', parser: 'full' | 'incremental', reparsedFrom: number | null, reparsedTo: number | null }`

### `LiveBlock`

- `id: string`
- `type: 'frontmatter' | 'heading' | 'paragraph' | 'blockquote' | 'list' | 'task' | 'table' | 'code' | 'hr'`
- `from: number`
- `to: number`
- `lineFrom: number`
- `lineTo: number`
- `depth: number | null`
- `attrs: Record<string, string | number | boolean>`

### `RenderProjection`

- `activeBlockId: string | null`
- `decorations: DecorationSet`
- `interactionMap: InteractionMapEntry[]`
- `metrics: { renderedBlockCount, virtualizedBlockCount, budgetTruncated, renderMs }`

## Runtime Layout

- `src/live-v3/createLiveApp.js`
- `src/live-v3/LiveRuntime.js`
- `src/live-v3/LiveStateField.js`
- `src/live-v3/LiveRenderer.js`
- `src/live-v3/LiveProjection.js`
- `src/live-v3/InteractionMap.js`
- `src/live-v3/PointerController.js`
- `src/live-v3/CursorController.js`
- `src/live-v3/parser/ObsidianCoreParser.js`
- `src/live-v3/model/LiveDocModel.js`
- `src/live-v3/model/ModelDiff.js`
- `src/live-v3/render/BlockRenderer.js`
- `src/live-v3/render/InlineRenderer.js`
- `src/live-v3/render/WidgetFactory.js`

## Non-Negotiable Behavior

1. Exactly one active editable block.
2. Inactive blocks render as full block widgets.
3. Pointer activation maps to deterministic source ranges.
4. Task toggles mutate markdown source.
5. Modifier-click opens links.
6. Vertical cursor movement is deterministic and line-based.

## Current Acceptance Gates

1. `npm test` (v3 parity suite).
2. `npm run build`.
3. Legacy contract check via `npm run check:legacy-contracts`.
