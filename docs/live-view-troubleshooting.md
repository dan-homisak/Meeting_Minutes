# Live-v4 Troubleshooting

## Primary Workflow

Use the probe runner first, not manual debugging:

```bash
npm run probe:live-v4 -- --fixture lists-and-tasks
```

Artifacts:

- `logs/probes/live-v4-probe-<timestamp>/report.json`
- `logs/probes/live-v4-probe-<timestamp>/important-events.json`
- `logs/probes/live-v4-probe-<timestamp>/<step>.png`

## What to Check in Each Probe Run

1. Cursor mapping: step snapshots show `selection.head`, active block, and DOM cursor rect.
2. Syntax reveal boundaries: `cursor-line-*-col-1-syntax` steps should reveal only marker syntax, not full-line markdown.
3. List/task horizontal stability: compare `sourceContentRect.left` and `inlinePrefixRect` across content-vs-syntax steps.
4. Gutter stability: `typography.gutters.visibleLineNumberCount` and `gutterLines` should remain stable through cursor steps.
5. Task toggles: `click-task-source-*` steps should mutate markdown source deterministically.

## Debug Console Controls

```js
window.__meetingMinutesLiveDebug.setLevel('trace');
window.__meetingMinutesLiveDebug.entries();
window.__meetingMinutesLiveDebug.clear();
```

## Fast Triage Commands

```bash
npm test
npm run build
npm run probe:live-v4 -- --fixture default-welcome
npm run probe:live-v4 -- --fixture lists-and-tasks
npm run probe:live-v4 -- --fixture mixed-inline
```

If parity regresses, use the latest probe `report.json` + screenshots as the bug report payload.
