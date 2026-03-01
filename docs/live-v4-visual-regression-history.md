# Live-v4 Visual Regression Matrix + History

## Required Fixture Matrix

Every visual/runtime change must run these fixtures:

1. `default-welcome`
- Baseline rendering and pointer mapping.
- Required screenshot steps: `01-baseline`, click-source steps.

2. `lists-and-tasks`
- Bullet/task/numbered rendering, nesting, syntax reveal, task toggles.
- Required screenshot steps:
  - `01-baseline`
  - `03-cursor-line-3-col-1-syntax`
  - `09-cursor-line-5-col-1-syntax`
  - `15-cursor-line-8-col-1-syntax`
  - `05-arrow-right-line-3-gap`
  - `06-arrow-left-line-3-gap`
  - `17-arrow-right-line-8-gap`
  - `18-arrow-left-line-8-gap`
  - `20-click-task-source-20`
  - `22-click-task-source-87`

3. `mixed-inline`
- Bullet/task interaction with mixed inline markdown and paragraph context.
- Required screenshot steps: `01-baseline`, cursor steps.

4. `empty-markers`
- Empty bullet/task/numbered markers to verify depth/indent updates before line content is typed.
- Required screenshot steps: `01-baseline`, all cursor-line steps for lines 3-8.

5. `nested-guides`
- Deep nested list indentation/connector-line continuity.
- Required screenshot steps: `01-baseline`, indentation cursor steps (`cursor-line-4-col-1-indent`, `cursor-line-4-col-2-indent`, `cursor-line-5-col-3-indent`), and left-arrow regression steps (`arrow-left-line-4-pretext`, `arrow-left-line-4-pretext-second`).

6. `single-bullet`
- Minimal top-level bullet marker traversal regression.
- Required screenshot steps: `01-baseline`, `02-cursor-line-3-col-2-pretext`, `03-arrow-left-line-3-pretext`, `04-arrow-left-line-3-pretext-second`.

7. `single-nested-bullet`
- Minimal nested bullet marker traversal and hidden-indent boundary regression.
- Required screenshot steps: `01-baseline`, `02-cursor-line-3-col-4-pretext`, `03-arrow-left-line-3-pretext`, `04-arrow-left-line-3-pretext-second`.

8. `code-blocks`
- Fenced code rendering parity, active-source code typography, fence traversal, and post-fence boundary behavior.
- Required screenshot steps:
  - `01-baseline`
  - `03-cursor-line-5-col-1-fence-open`
  - `05-arrow-left-line-5-fence-open`
  - `07-cursor-line-6-col-3-code-content`
  - `08-cursor-line-10-col-1-fence-close`
  - `10-arrow-left-line-10-fence-close`
  - `12-cursor-line-14-col-1-fence-open-plain`
  - `15-cursor-line-15-col-5-code-plain-content`
  - `16-cursor-line-18-col-6-outro`

## Required Gates

1. `npm test -- --runInBand`
2. `npm run build`
3. Probe runs for `default-welcome`, `lists-and-tasks`, and `mixed-inline` with explicit output dirs.
4. Probe runs for `empty-markers` and `nested-guides` with explicit output dirs when list behavior or spacing changes.
5. Probe runs for `single-bullet` and `single-nested-bullet` when cursor/list marker behavior changes.
6. Probe run for `code-blocks` when fenced code rendering, source scope, typography, or fence traversal changes.

## Run History

| Date (UTC) | Purpose | Fixtures | Artifact Root |
|---|---|---|---|
| 2026-03-01 | Fence-click cursor placement refinement: pointer clicks on opening/closing fence lines now snap caret to fence-line end (language-aware on opening fence) and added probe coverage for visible closing-fence clicks | code-blocks | `logs/probes/live-v4-probe-2026-03-01T01-39-51-588Z` |
| 2026-03-01 | Hidden-fence click mapping fix: clicks on inactive backtick fence lines now map into fence source range and activate code source editing | code-blocks | `logs/probes/live-v4-probe-2026-03-01T01-21-31-702Z` |
| 2026-03-01 | Code-block keyboard parity follow-up: fixed `Tab` command path to always indent in-editor, hardened copy-button focus deflection, and added probe assertions for `Tab` indentation/focus retention | code-blocks | `logs/probes/live-v4-probe-2026-03-01T01-12-42-178Z` |
| 2026-03-01 | Cursor/tab hardening for code blocks: ArrowDown snaps to opening fence end, copy button removed from tab order, and editor Tab fallback prevents UI/browser focus navigation | code-blocks | `logs/probes/live-v4-probe-2026-03-01T01-00-41-493Z` |
| 2026-03-01 | Code-block UX additions: full fenced block chrome with inactive fence hiding, copy button control, and fence auto-close insertion guardrails | code-blocks | `logs/probes/live-v4-probe-2026-03-01T00-49-52-163Z`, `logs/probes/live-v4-probe-2026-03-01T00-40-18-944Z` |
| 2026-03-01 | Gutter continuity fix for code blocks: switched code blocks to source-transform path so rendered code no longer drops line numbers | code-blocks, lists-and-tasks | `logs/probes/live-v4-probe-2026-03-01T00-23-12-571Z`, `logs/probes/live-v4-probe-2026-03-01T00-23-58-646Z` |
| 2026-03-01 | Code-block follow-up: blank-line boundary now yields no active block, with assertions updated for `activeBlockType: null` | code-blocks | `logs/probes/live-v4-probe-2026-03-01T00-17-35-165Z` |
| 2026-03-01 | Code-block parity pass: fenced range boundary fix, active source monospace/chrome, and native fence traversal probe coverage | code-blocks | `logs/probes/live-v4-probe-2026-03-01T00-11-55-874Z` |
| 2026-03-01 | Initial code-block inspection baseline before fixes | code-blocks | `logs/probes/live-v4-probe-2026-03-01T00-05-35-487Z` |
| 2026-03-01 | List regression sanity run after parser/style updates from code-block pass | lists-and-tasks | `logs/probes/live-v4-probe-2026-03-01T00-14-48-156Z` |
| 2026-02-28 | Syntax-transform + gutter stabilization | default-welcome, lists-and-tasks, mixed-inline | `logs/probes/live-v4-probe-2026-02-28T20-35-34-600Z`, `logs/probes/live-v4-probe-2026-02-28T20-38-03-460Z`, `logs/probes/live-v4-probe-2026-02-28T20-36-22-871Z` |
| 2026-02-28 | List/checkbox spacing refinement | lists-and-tasks, mixed-inline | `logs/probes/lists-refine-2026-02-28T20-58/live-v4-probe-2026-02-28T20-56-19-026Z`, `logs/probes/mixed-refine-2026-02-28T20-58/live-v4-probe-2026-02-28T20-56-19-026Z` |
| 2026-02-28 | Empty-marker depth detection + checkbox vertical centering + numbered-list indent tune | default-welcome, lists-and-tasks, mixed-inline | `logs/probes/default-refine-2026-02-28T21-06/live-v4-probe-2026-02-28T21-10-12-647Z`, `logs/probes/lists-refine-2026-02-28T21-06/live-v4-probe-2026-02-28T21-10-12-647Z`, `logs/probes/mixed-refine-2026-02-28T21-06/live-v4-probe-2026-02-28T21-10-12-647Z` |
| 2026-02-28 | Empty-marker fixture baseline for pre-content indent depth checks | empty-markers | `logs/probes/empty-markers-2026-02-28T21-13/live-v4-probe-2026-02-28T21-12-36-663Z` |
| 2026-02-28 | Horizontal marker-gap cursor traversal + spacing parity tune (ordered/task vs bullet) | lists-and-tasks, mixed-inline, empty-markers | `logs/probes/lists-gap-pass-2026-02-28T22-05/live-v4-probe-2026-02-28T21-34-13-611Z`, `logs/probes/mixed-gap-pass-2026-02-28T22-05/live-v4-probe-2026-02-28T21-34-56-969Z`, `logs/probes/empty-gap-pass-2026-02-28T22-05/live-v4-probe-2026-02-28T21-35-04-434Z` |
| 2026-02-28 | Final list parity tuning: task/ordered spacing rebalance + marker trailing-space visibility while syntax is active | lists-and-tasks, mixed-inline, empty-markers | `logs/probes/lists-gap-pass-2026-02-28T22-45/live-v4-probe-2026-02-28T21-44-53-276Z`, `logs/probes/mixed-gap-pass-2026-02-28T22-45/live-v4-probe-2026-02-28T21-45-58-998Z`, `logs/probes/empty-gap-pass-2026-02-28T22-45/live-v4-probe-2026-02-28T21-45-58-999Z` |
| 2026-02-28 | User-reported list spacing cleanup from screenshot (bullet/task marker-text separation retune) | lists-and-tasks, mixed-inline | `logs/probes/lists-spacing-pass-2026-02-28T23-23/live-v4-probe-2026-02-28T21-54-15-802Z`, `logs/probes/mixed-spacing-pass-2026-02-28T23-23/live-v4-probe-2026-02-28T21-54-15-802Z` |
| 2026-02-28 | Spacing bump + checkbox checkmark centering + vertical nested connector lines | lists-and-tasks, mixed-inline, nested-guides | `logs/probes/lists-guides-pass-2026-02-28T23-35/live-v4-probe-2026-02-28T22-05-16-464Z`, `logs/probes/mixed-guides-pass-2026-02-28T23-35/live-v4-probe-2026-02-28T22-05-16-464Z`, `logs/probes/nested-guides-pass-2026-02-28T23-35/live-v4-probe-2026-02-28T22-05-16-464Z` |
| 2026-02-28 | Follow-up polish: slight extra marker-to-text spacing, cursor visibility fix near guides, connected vertical guides across lines | lists-and-tasks, mixed-inline, nested-guides | `logs/probes/lists-guides-pass-2026-02-28T23-50-rerun/live-v4-probe-2026-02-28T22-12-45-458Z`, `logs/probes/mixed-guides-pass-2026-02-28T23-50/live-v4-probe-2026-02-28T22-12-24-886Z`, `logs/probes/nested-guides-pass-2026-02-28T23-50/live-v4-probe-2026-02-28T22-12-24-886Z` |
| 2026-02-28 | Deep cursor investigation around guide columns: moved guides to background layer + marker-range reveal to prevent caret loss in hidden indent syntax | lists-and-tasks, nested-guides | `logs/probes/lists-guides-cursor-pass-2026-03-01T00-10/live-v4-probe-2026-02-28T22-20-10-395Z`, `logs/probes/nested-guides-cursor-pass-2026-03-01T00-06/live-v4-probe-2026-02-28T22-19-38-441Z` |
| 2026-02-28 | Follow-up fix for left-arrow caret loss across `- ` marker into indent guide area: stop unconditional prefix hiding while marker is active | lists-and-tasks, nested-guides | `logs/probes/lists-guides-cursor-pass-2026-03-01T00-20/live-v4-probe-2026-02-28T22-30-53-682Z`, `logs/probes/nested-guides-cursor-pass-2026-03-01T00-18/live-v4-probe-2026-02-28T22-30-27-152Z` |
| 2026-02-28 | Reverted full-marker reveal regression (no extra left padding spaces), kept only marker-core reveal, added guide-zone Tab/Shift-Tab/Backspace indent controls, and stabilized probe cleanup retries | lists-and-tasks, nested-guides | `logs/probes/live-v4-probe-2026-02-28T22-45-35-630Z`, `logs/probes/live-v4-probe-2026-02-28T22-43-42-093Z` |
| 2026-02-28 | Verification rerun after renderer/cursor revert: nested-guides + lists-and-tasks probes regenerated with same fixture matrix | lists-and-tasks, nested-guides | `logs/probes/live-v4-probe-2026-02-28T22-49-31-382Z`, `logs/probes/live-v4-probe-2026-02-28T22-49-23-189Z` |
| 2026-02-28 | Cursor-boundary simplification for nested lists: use visible marker anchor on indented lines and add left-arrow regression probe steps | nested-guides | `logs/probes/live-v4-probe-2026-02-28T23-06-02-516Z`, `logs/probes/live-v4-probe-2026-02-28T23-04-19-891Z` |
| 2026-02-28 | Added minimal single-line cursor fixtures for top-level and nested bullets to isolate marker-boundary regressions | single-bullet, single-nested-bullet | `logs/probes/live-v4-probe-2026-02-28T23-17-08-922Z`, `logs/probes/live-v4-probe-2026-02-28T23-17-42-632Z` |
| 2026-02-28 | Numbered/task cursor accessibility reset: restore marker-syntax reachability while only skipping hidden ranges (indent/trailing-gap) | lists-and-tasks, single-bullet, single-nested-bullet | `logs/probes/live-v4-probe-2026-02-28T23-34-53-916Z`, `logs/probes/live-v4-probe-2026-02-28T23-23-31-616Z`, `logs/probes/live-v4-probe-2026-02-28T23-23-45-719Z` |

## How To Extend History

For every new run:

1. Add a new row with date, intent, fixtures, and artifact paths.
2. Keep prior rows unchanged for auditability.
3. Note any intentional visual delta in the change summary.
