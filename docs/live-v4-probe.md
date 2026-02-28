# Live-v4 Probe Runner

Use `npm run probe:live-v4` to run automated live-preview troubleshooting with cursor placement and rendered-click scenarios.

Companion docs:

- `docs/live-v4-screenshot-method.md`
- `docs/live-v4-visual-regression-history.md`

## What It Does

1. Starts the launcher in no-open mode (unless `--url` is provided).
2. Opens a headless Chrome debugging session.
3. Runs deterministic probe steps:
   - fixture load (`default-welcome`, `lists-and-tasks`, `mixed-inline`, `empty-markers`, `nested-guides`, `single-bullet`, `single-nested-bullet`)
   - baseline snapshot
   - cursor placement by line/column
   - list/task/ordered marker reveal checks (content column vs syntax column on top-level and nested items)
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
