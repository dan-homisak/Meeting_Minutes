# Live View Development and Troubleshooting Strategy

This document defines how to iterate on live mode without cursor drift, gutter collapse, or click mapping jumps.

## Shipped Architecture

1. Live mode runs in source-first architecture.
2. Source-first mode preserves CodeMirror source lines and renders markdown presentation using line/token decorations.
3. Live mode architecture is fixed to source-first in runtime (no URL/storage architecture override).
4. Pointer clicks in source-first mode stay native and are logged (`pointer.map.native`).
5. A block index is rebuilt on document changes for deterministic diagnostics (`block.index.rebuilt`, `block.index.delta`).
6. Fence marker state is logged on selection changes (`fence.visibility.state`).
7. Source-first decorations now rebuild on selection-line changes so active-line markdown visibility stays in sync.

## Behavioral Targets

1. Cursor remains on expected row/column after clicks and key navigation.
2. Gutter line numbers remain visible and stable in live mode.
3. Editing inside fenced code keeps opening and closing fence markers visible.
4. Selection jumps are treated as regressions unless explicitly suppressed by programmatic transitions.

## Instrumentation Taxonomy

Primary events:

- `live.mode.architecture`
- `mode.changed`
- `plugin.update`
- `plugin.update.selection-skipped`
- `selection.changed`
- `selection.jump.detected`
- `cursor.visibility.probe`
- `cursor.visibility.suspect`
- `gutter.visibility.probe`
- `gutter.visibility.hidden`
- `pointer.map.native`
- `pointer.map.clamped`
- `block.index.rebuilt`
- `block.index.delta`
- `fence.visibility.state`
- `document.changed`

Source-first compatibility event:

- `decorations.source-first-built`
- includes per-class counters (`headingLineCount`, `paragraphLineCount`, `listLineCount`, `taskLineCount`, `quoteLineCount`, `tableLineCount`, `hrLineCount`)

## Debug Controls

1. In-app **Live Debug** panel: choose level, clear entries, copy JSON.
2. URL query level override: `?debugLive=trace` (`off|error|warn|info|trace`).
3. Browser API:

```js
window.__meetingMinutesLiveDebug.setLevel('trace');
window.__meetingMinutesLiveDebug.entries();
window.__meetingMinutesLiveDebug.clear();
```

4. Persisted debug level key: `meetingMinutes.liveDebugLevel`.

## Log Workflow

1. Capture session logs: `npm run launch`.
2. Read latest log report: `npm run logs:latest -- --last 160`.
3. Run automatic verification gates:

```bash
npm run logs:verify
```

`logs:verify` ignores the initial pointer-driven selection jump from `head=0` (document start) to the first clicked location.

Useful overrides:

```bash
npm run logs:verify -- --max-selection-jumps 0 --max-selection-skip-line-mismatches 0 --max-cursor-suspects 0 --max-gutter-hidden 0 --min-pointer-native 1
```

## Repeatable Iteration Loop

1. Run tests: `npm test`.
2. Reproduce with fixture markdown.
3. Ensure `debugLive=trace`.
4. Perform exact pointer/key actions.
5. Inspect logs for:
   - `pointer.map.native` records around each click
   - `fence.visibility.state` while moving in/out of fenced code
   - no unexpected `selection.jump.detected`
   - no `gutter.visibility.hidden`
   - `currentPath` in the session matches the file you are testing
6. Add/adjust regression tests before changing behavior.

## Regression Coverage

Core live-preview helper regressions are covered by:

- `tests/blockRangeCollector.test.js` (block collection and overlap handling)
- `tests/sourceRangeMapper.test.js` (source range annotation)
- `tests/liveBlockHelpers.test.js` (line-overlap and fenced-block detection helpers)
- `tests/liveActivationHelpers.test.js` (block lookup and activation-bound resolution helpers)
- `tests/liveBlockIndex.test.js` (block type classification and index lookup)
- `tests/e2e/live-highlighting-selection.test.js` (same-line selection skip vs cross-line decoration rebuild behavior)

`tests/liveDebugLogger.test.js` covers:

- debug-level resolution and aliases
- level filtering behavior
- timeline bounding and subscriptions

`tests/liveDebugScripts.test.js` covers:

- verify/report handling of the initial pointer-driven jump from document start
- verify guard for `plugin.update.selection-skipped` line mismatch anomalies
