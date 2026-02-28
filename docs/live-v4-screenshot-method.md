# Live-v4 Screenshot + Inspection Method (AI Workflow)

This is the required workflow for visual/live-preview changes.

## Goal

Use deterministic probe runs, JSON snapshots, and screenshots to verify behavior before/after code changes.

## Required Loop

1. Pick fixture(s) from the visual matrix.
2. Run probe with explicit output dir:

```bash
npm run probe:live-v4 -- --fixture lists-and-tasks --output-dir logs/probes/<run-label>
npm run probe:live-v4 -- --fixture mixed-inline --output-dir logs/probes/<run-label>
npm run probe:live-v4 -- --fixture default-welcome --output-dir logs/probes/<run-label>
npm run probe:live-v4 -- --fixture empty-markers --output-dir logs/probes/<run-label>
```

3. Inspect `report.json` first:
- `steps[*].snapshot.payload.selection`
- `steps[*].snapshot.payload.domLines`
- `steps[*].snapshot.payload.gutterLines`
- `steps[*].snapshot.payload.typography`

4. Inspect key screenshots for each fixture:
- baseline
- syntax-marker cursor step(s)
- click/toggle verification step(s)

5. Compare against previous run for regressions.
6. Only then adjust code and repeat.

Important:

- Run probes sequentially (not in parallel) when collecting audit artifacts.
- Always pass explicit `--output-dir` to avoid accidental artifact collisions.

## What To Measure

1. Cursor mapping correctness (`selection.head` on click steps).
2. Syntax-reveal scope (only marker syntax exposed when cursor enters marker).
3. Horizontal stability:
- compare `sourceContentRect.left` between content step and syntax step.
4. Gutter stability:
- `visibleLineNumberCount` stable across steps.
- line and gutter heights stay aligned.
5. Task toggle correctness:
- source lines switch `[ ]` <-> `[x]` at expected `sourceFrom`.
6. Horizontal marker-gap traversal:
- `arrow-right-*` and `arrow-left-*` steps must move across marker trailing space in one keypress.

## Acceptance Heuristics

- No list/task line should jump horizontally by more than a small tolerance during expected interactions.
- No disappearing gutter numbers during cursor movement.
- Checkbox and text baseline should stay visually centered.
- Top-level and nested list depth must remain deterministic from source indentation.

## Artifact Conventions

- Keep all runs under `logs/probes/`.
- Use run labels that include purpose and date.
- Never overwrite prior run dirs when validating regressions.

## Required Reporting In PR/Change Notes

- Probe command(s) used.
- Artifact directory paths.
- Which screenshot IDs were checked.
- Any measured deltas that changed intentionally.
