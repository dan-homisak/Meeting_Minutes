# Live-V3 Troubleshooting

## Runtime Expectations

1. Live mode is always active.
2. One block is source-editable (active block).
3. Other blocks are rendered widgets with `data-src-from` and `data-src-to`.

## Debug Controls

Use browser devtools:

```js
window.__meetingMinutesLiveDebug.setLevel('trace');
window.__meetingMinutesLiveDebug.entries();
window.__meetingMinutesLiveDebug.clear();
```

## Common Checks

1. Pointer mapping
- Confirm clicked widget DOM has `data-src-from` / `data-src-to`.
- Confirm log event `live-v3.pointer.activate` appears with expected source position.

2. Task toggles
- Confirm checkbox carries `data-task-source-from`.
- Confirm source line toggles `[ ]` <-> `[x]`.

3. Cursor movement
- Confirm `ArrowUp`/`ArrowDown` move line-by-line without jumps.

4. Render budget
- Confirm `live-v3.projection.built` logs `renderedBlockCount` within budget.

## Regression Suite

Run:

```bash
npm test
```

The parity-first suite is under `tests/v3/` and covers parser/model/projection/interaction/pointer/cursor/performance and legacy purge contracts.
