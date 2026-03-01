# Live-v4 Probe Runner

Use `npm run probe:live-v4` to run automated live-preview troubleshooting with cursor placement and rendered-click scenarios.

Companion docs:

- `docs/live-v4-screenshot-method.md`
- `docs/live-v4-visual-regression-history.md`

## What It Does

1. Starts the launcher in no-open mode (unless `--url` is provided).
2. Opens a headless Chrome debugging session.
3. Runs deterministic probe steps:
   - fixture load (`default-welcome`, `lists-and-tasks`, `mixed-inline`, `empty-markers`, `nested-guides`, `single-bullet`, `single-nested-bullet`, `code-blocks`)
   - baseline snapshot
   - cursor placement by line/column
   - list/task/ordered marker reveal checks (content column vs syntax column on top-level and nested items)
   - native fence traversal checks for code blocks (`ArrowLeft` over opening/closing fences)
   - keyboard focus/indent checks for code blocks (`Tab` inside code content)
   - rendered click mapping and task-checkbox toggles (fixture dependent)
4. Captures screenshots after each step.
5. Collects structured state snapshots from `window.__MM_LIVE_V4_PROBE__`.
6. Copies and summarizes launcher live-debug events.

## Usage

```bash
npm run probe:live-v4
```

Optional flags:

```bash
npm run probe:live-v4 -- --url "http://127.0.0.1:5173/?launcherToken=..."
npm run probe:live-v4 -- --output-dir logs/probes/custom
npm run probe:live-v4 -- --chrome-path "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
npm run probe:live-v4 -- --keep-launcher-alive
npm run probe:live-v4 -- --fixture lists-and-tasks
```

## Artifacts

Each run creates:

- `logs/probes/live-v4-probe-<timestamp>/report.json`
- `logs/probes/live-v4-probe-<timestamp>/important-events.json`
- `logs/probes/live-v4-probe-<timestamp>/launcher-live-debug.jsonl` (when available)
- step screenshots (`00-*.png`, `01-*.png`, ...)

The report includes assertions for pointer activation and source-fragment mapping, plus per-step snapshots to compare visual/cursor behavior over time.
Snapshots include source lines, DOM lines, gutter lines, widget bounds, typography metrics, and per-line content/prefix rects for list-indent regression triage.
For `code-blocks`, report assertions also verify:

1. code block activation on fence/content lines
2. no code activation on the blank line after a closing fence
3. blank line after a closing fence has no active block (`activeBlockType: null`)
4. cursor visibility while traversing fence syntax with native arrow keys
5. active source code line styling is applied (`mm-live-v4-source-code-line`)
6. fence source text remains intact (` ```js ` / ` ``` `)
7. ArrowDown into opening fence lands at line end (`head === lineTo`) for both language and plain fences
8. `Tab` while in code content keeps editor focus and indents code text (does not move focus to UI/browser controls)
9. Clicking hidden opening fences and visible closing fences places the cursor at line end (`head === lineTo`) and activates/stays in code source mode

## Numbered/Task Cursor Verification

For numbered and checkbox lines, use `lists-and-tasks` plus the single-line fixtures:

```bash
npm run probe:live-v4 -- --fixture lists-and-tasks
npm run probe:live-v4 -- --fixture single-bullet
npm run probe:live-v4 -- --fixture single-nested-bullet
```

Expected behavior:

1. Cursor remains visible while traversing list/task/ordered syntax.
2. Cursor can access visible marker characters (for example `-`, `1.`, `[ ]`) directly.
3. Hidden-only ranges are skipped without introducing mid-syntax cursor loss.

## Code Block Verification

```bash
npm run probe:live-v4 -- --fixture code-blocks
```

Expected behavior:

1. Code source uses monospace lines with code-block chrome, not paragraph typography.
2. Opening/closing fence traversal keeps cursor visible and character-reachable.
3. Cursor on the blank line immediately after a fence does not reactivate code and should leave `activeBlockType` null.
4. Gutter numbering remains continuous across the full code block line range.
5. ArrowDown from the line above a fence places the cursor at end-of-fence text.
6. `Tab` inside a code line inserts indentation while keeping focus in the editor.
7. Clicking where hidden fence syntax sits should place the caret in that fence syntax range.
