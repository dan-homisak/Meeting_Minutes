# Live View Development and Troubleshooting Strategy

This document defines how to iterate on live mode without cursor drift, gutter collapse, or click mapping jumps.

## Shipped Architecture

1. Live mode defaults to source-first architecture (`LIVE_SOURCE_FIRST_MODE`).
2. Source-first mode preserves CodeMirror source lines and renders markdown presentation using line/token decorations.
3. Legacy rendered-block architecture is still available as opt-out via `?liveSourceFirst=false` for comparison.
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

Legacy rendered-block events still exist behind non-default paths and for historical log analysis:

- `block.activate.rendered-*`
- `block.activate.fallback`
- `block.position.mapped*`

## Debug Controls

1. In-app **Live Debug** panel: choose level, clear entries, copy JSON.
2. URL query level override: `?debugLive=trace` (`off|error|warn|info|trace`).
3. Optional live architecture override:
   - `?liveSourceFirst=true`
   - `?liveSourceFirst=false` (legacy rendered-block path)
4. Browser API:

```js
window.__meetingMinutesLiveDebug.setLevel('trace');
window.__meetingMinutesLiveDebug.entries();
window.__meetingMinutesLiveDebug.clear();
```

5. Persisted debug level key: `meetingMinutes.liveDebugLevel`.
6. Persisted architecture key: `meetingMinutes.liveSourceFirst`.

## Log Workflow

1. Capture session logs: `npm run launch`.
2. Read latest log report: `npm run logs:latest -- --last 160`.
3. Run automatic verification gates:

```bash
npm run logs:verify
```

Useful overrides:

```bash
npm run logs:verify -- --max-selection-jumps 0 --max-cursor-suspects 0 --max-gutter-hidden 0 --min-pointer-native 1
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

`tests/livePreviewCore.test.js` covers:

- block collection and overlap handling
- source range annotation
- active-line split behavior
- block selection clamping
- block type classification
- block index generation and position lookup
- fenced marker visibility state reporting

`tests/liveDebugLogger.test.js` covers:

- debug-level resolution and aliases
- level filtering behavior
- timeline bounding and subscriptions
