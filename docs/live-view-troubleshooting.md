# Live View Development and Troubleshooting Strategy

This document defines how to iterate on the CodeMirror live-render mode without losing cursor stability.

## Behavioral Targets (guided by Obsidian/Zettlr/Logseq patterns)

1. The active line remains directly editable markdown (no hidden cursor state).
2. Non-active blocks can render as HTML, but clicks map back to predictable source positions.
3. Block boundaries are stable: pointer events in one rendered block should not jump to unrelated blocks.
4. When coordinate mapping fails, fallback selection stays at the clicked block anchor instead of jumping to document start.

## Instrumentation Added

Live-mode tracing now emits structured events with a stable taxonomy:

- `mode.changed`
- `refresh.requested`
- `blocks.collected`
- `blocks.collect.failed`
- `plugin.update`
- `plugin.update.selection-skipped`
- `decorations.built`
- `decorations.cache.reset`
- `block.activate.request`
- `block.activate.fallback`
- `block.activate.line-source-clamped`
- `block.activate.pass-through-native`
- `block.activate.rendered-pointer-probe`
- `block.activate.rendered-rebound-source-pos-block`
- `block.activate.rendered-dom-anchor-sticky`
- `block.activate.rendered-source-range`
- `block.activate.rendered-fenced-source-sticky`
- `block.activate.rendered-boundary-source-sticky`
- `block.activate.rendered-boundary-crossing`
- `block.activated`
- `block.position.mapped`
- `block.position.mapped.skipped`
- `block.position.mapped.large-delta`
- `block.position.mapped.rejected-large-delta`
- `block.activate.miss`
- `block.activate.rendered-source-pos-outside-block`
- `block.activate.failed`
- `block.activate.dispatch-failed`
- `gutter.visibility.probe`
- `gutter.visibility.hidden`
- `selection.changed`
- `document.changed`

## Debug Controls

1. In-app **Live Debug** panel (under status): choose level, clear events, copy JSON
2. URL query: `?debugLive=trace` (also supports `off`, `error`, `warn`, `info`)
3. Browser devtools API:

```js
window.__meetingMinutesLiveDebug.setLevel('trace');
window.__meetingMinutesLiveDebug.entries();
window.__meetingMinutesLiveDebug.clear();
```

4. Persisted preference: debug level is saved in localStorage (`meetingMinutes.liveDebugLevel`).
5. Local dev default: if no level is set, `npm run dev` starts at `TRACE`.
6. After-the-fact file capture: run `npm run launch`; browser logs are written to `logs/live-debug-*.jsonl`.
7. Read the newest capture with `npm run logs:latest -- --last 120`.
8. Terminal-only launcher option: `LAUNCHER_NO_OPEN=1 npm run launch`.

## Repeatable Iteration Loop

1. Run unit tests: `npm test`
2. Reproduce with a known markdown fixture.
3. Set debug level to `trace`.
4. Perform the exact cursor action (click, touch, mode switch).
5. Inspect log timeline and confirm:
- `block.activate.request` and `block.position.mapped` are emitted in order.
- `sourceFrom`, `mappedPos`, and `resolvedPos` are coherent.
- no invalid `data-source-from` fallback to `0`.
6. Add/adjust a regression test before changing mapping logic.

## Current Regression Coverage

`tests/livePreviewCore.test.js` covers:

- block collection dedupe + overlap merge behavior
- whitespace and invalid token filtering
- active-line fragment splitting behavior
- cursor mapping fallback + clamp behavior
- `data-source-from` parsing safety

`tests/liveDebugLogger.test.js` covers:

- debug-level resolution (query vs stored)
- level aliases (`1`, `true`, `debug`)
- level-based event filtering
- in-memory timeline bounding

## Next Milestones

1. Add Playwright click-to-cursor integration tests for desktop pointer interactions.
2. Add touch interaction integration tests for mobile-like behavior.
3. Add a fixture library for markdown edge cases (nested lists, fenced code, tables, blockquotes).
