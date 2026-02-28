# Obsidian Clone Rewrite Plan (V2)

This document replaces the prior architecture plan and is now the execution source of truth.

## Progress Ledger

| Step | Name | Status | Owner | Start Date | Done Date | Blocking Issues |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | Plan file replacement and tracking scaffold | DONE | Codex | 2026-02-28 | 2026-02-28 | None |
| 1 | Parity spec and fixture vault | DONE | Codex | 2026-02-28 | 2026-02-28 | None |
| 2 | Markdown dialect V2 | DONE | Codex | 2026-02-28 | 2026-02-28 | None |
| 3 | Shared document model V2 | DONE | Codex | 2026-02-28 | 2026-02-28 | None |
| 4 | Hybrid live renderer V2 | DONE | Codex | 2026-02-28 | 2026-02-28 | None |
| 5 | Fragment map and interaction resolver | DONE | Codex | 2026-02-28 | 2026-02-28 | None |
| 6 | Editing semantics parity | DONE | Codex | 2026-02-28 | 2026-02-28 | None |
| 7 | Obsidian-like UI shell rewrite | DONE | Codex | 2026-02-28 | 2026-02-28 | None |
| 8 | Theming and typography parity | DONE | Codex | 2026-02-28 | 2026-02-28 | None |
| 9 | Performance and viewport controls | DONE | Codex | 2026-02-28 | 2026-02-28 | None |
| 10 | Test expansion and hardening | DONE | Codex | 2026-02-28 | 2026-02-28 | None |
| 11 | Big-bang cutover | DONE | Codex | 2026-02-28 | 2026-02-28 | None |
| 12 | Final acceptance and sign-off | DONE | Codex | 2026-02-28 | 2026-02-28 | None |

### Completion Evidence

#### Step 0 Evidence

- PR/commit reference: Working tree implementation session on 2026-02-28.
- Tests added/updated: N/A (documentation scaffold step).
- Acceptance evidence: This document now contains the V2 plan, progress ledger, and acceptance checklist.

#### Step 1 Evidence

- PR/commit reference: Working tree implementation session on 2026-02-28.
- Tests added/updated: Added fixture files and expectation spec under `Markdown_Test_Files/v2/`.
- Acceptance evidence: Fixture vault now includes core live preview fixture, cursor mapping fixture, and explicit expected behaviors.

#### Step 2/3 Evidence

- PR/commit reference: Working tree implementation session on 2026-02-28.
- Tests added/updated:
  - Dialect/parser: `tests/inlineSpanBuilderV2.test.js`, `tests/blockGraphBuilderV2.test.js`, `tests/markdownConfig.test.js`
  - Model/diff stability: `tests/docModelV2.test.js`, `tests/documentSession.test.js`, `tests/modelDiffV2.test.js`
- Acceptance evidence:
  - Wikilinks/embeds/frontmatter are parsed and classified in-model.
  - Stable block IDs now carry across non-structural edits.
  - Diff metadata now includes changed block IDs and inline fragment deltas.

#### Step 4/5/6 Evidence

- PR/commit reference: Working tree implementation session on 2026-02-28.
- Tests added/updated:
  - Hybrid renderer: `tests/liveHybridRenderer.test.js`
  - Pointer mapping and activation: `tests/selectionPolicy.test.js`, `tests/pointerActivationController.test.js`, `tests/e2e/live-click-mapping.test.js`
  - Cursor movement: `tests/cursorNavigationController.test.js`, `tests/e2e/live-cursor-navigation.test.js`
  - Editing semantics: `tests/markdownRenderer.test.js` (task/nested task rendering), task toggle + modifier-link controller tests
- Acceptance evidence:
  - Inactive blocks render as fragment widgets while active block stays source-editable.
  - Fragment-map-first pointer resolution is active with hit/miss telemetry.
  - Task toggles and modifier-link open behavior map correctly through live view interactions.

#### Step 7/8 Evidence

- PR/commit reference: Working tree implementation session on 2026-02-28.
- Tests added/updated:
  - Shell/controller wiring: `tests/createAppShellContext.test.js`, `tests/modeController.test.js`
  - Fixture visual snapshots: `tests/fixtureVaultParity.test.js` + `Markdown_Test_Files/v2/snapshots/*.preview.html`
- Acceptance evidence:
  - Sidebar + note-toolbar + note-pane shell has Obsidian-like hierarchy.
  - Theme tokens and typography are unified across live and preview rendering paths.

#### Step 9/10/11 Evidence

- PR/commit reference: Working tree implementation session on 2026-02-28.
- Tests added/updated:
  - Viewport/budget modules: `tests/viewportWindow.test.js`, `tests/blockVirtualizer.test.js`, `tests/renderBudget.test.js`
  - Large-doc bounded rendering: `tests/liveHybridRenderer.test.js` (5k/20k/50k-line scenarios)
  - Logging/reporting updates: `tests/liveDebugScripts.test.js`, `tests/createLiveDebugBootstrap.test.js`
- Acceptance evidence:
  - Hybrid renderer emits bounded output under large-document workloads.
  - Deprecated source-first runtime path removed (`src/core/render/LiveSourceRenderer.js` deleted).
  - Full test suite passes with V2-only runtime path.

#### Step 12 Progress Evidence

- PR/commit reference: Working tree implementation session on 2026-02-28.
- Tests added/updated:
  - Light/dark theming behavior: `tests/themeController.test.js`
  - UI shell and token contract: `tests/uiParityContract.test.js`
  - Persistence/autosave/restore: `tests/workspaceController.test.js` (expanded)
  - Full suite run (`npm test`) passing with 155 passing tests.
- Acceptance evidence:
  - Automated acceptance gates pass across parser/model/render/map/selection/e2e/fixtures.
  - Light/dark theme behavior and semantic token contract are verified by dedicated tests.
  - Workspace persistence restore and autosave paths are verified by dedicated tests.

## Acceptance Checklist (Must Be Fully Checked Before Cutover)

- [x] Live editing behavior matches defined Obsidian-like parity fixtures.
- [x] Inactive blocks render as hybrid widgets while active block remains source-editable.
- [x] Fragment-map pointer mapping is deterministic and validated by e2e tests.
- [x] Vertical cursor navigation is map-first and stable across rendered/source transitions.
- [x] UI shell and typography align with approved Obsidian-like baseline.
- [x] Performance thresholds pass for 5k/20k/50k-line scenarios.
- [x] Legacy source-first-only path is removed.
- [x] Full test suite, parity tests, and manual checklist all pass.

## Summary

Chosen scope and defaults:

1. Scope: Core rendering parity plus Obsidian-like primary UI and usage flow.
2. Markdown scope: Core minus advanced (include wikilinks, tasks, tables, embeds, frontmatter semantics; defer callouts, footnotes, math).
3. Delivery model: Big-bang rewrite and single cutover after parity gates pass.

## Non-Goals

1. Plugin ecosystem parity.
2. Graph view, canvas, or advanced multi-pane workflows.
3. Callouts, footnotes, and math rendering in this rewrite.
4. Non-Chromium folder-editing parity beyond current browser support.

## Success Criteria

1. Live editing behaves like Obsidian Live Preview for core markdown flows.
2. Inactive content renders while active editing context exposes source markers and preserves cursor stability.
3. Pointer/cursor movement is deterministic without unexpected selection jumps.
4. UI and typography feel Obsidian-like for sidebar, note pane, and live rendering.
5. Existing and new tests pass, including parity fixtures and visual snapshots.
6. Old source-first-only path is fully removed after cutover.

## Architecture Target

1. Markdown source remains the only source of truth.
2. Incremental parsing updates one shared document model.
3. Live and Preview modes consume the same model.
4. Live view is true hybrid rendering:
- Active block edits source.
- Inactive blocks render as widgets/fragments.
5. Source-to-render fragment maps drive deterministic interaction mapping.
6. Selection/cursor policy is map-first with guarded fallback heuristics.
7. Viewport virtualization and render budgets are restored.

## Public Interfaces and Contracts

### Core interfaces

1. `DocModelV2`
- `version: number`
- `text: string`
- `blocks: BlockNodeV2[]`
- `inline: InlineNodeV2[]`
- `frontmatter: FrontmatterNode | null`
- `meta: ParseMetaV2`

2. `BlockNodeV2`
- `id: string`
- `type: 'heading' | 'paragraph' | 'list' | 'task' | 'blockquote' | 'table' | 'code' | 'hr' | 'embed' | 'wikilink' | 'frontmatter'`
- `from: number`
- `to: number`
- `lineFrom: number`
- `lineTo: number`
- `attrs: Record<string, string | number | boolean>`

3. `RenderedFragmentMapEntry`
- `fragmentId: string`
- `blockId: string`
- `sourceFrom: number`
- `sourceTo: number`
- `domPathHint: string`
- `priority: number`

4. `LiveViewStateV2`
- `activeBlockId: string | null`
- `decorations: DecorationSet`
- `fragmentMap: RenderedFragmentMapEntry[]`
- `blockIndex: BlockIndexEntryV2[]`

### Module/API changes

1. Replace `LiveSourceRenderer`-first strategy with `HybridLiveRendererV2`-first behavior.
2. Replace block-only source-map usage with fragment-level mapping index.
3. Replace pointer intent path that always returns `proceed: false` with actionable activation dispatch.
4. Keep top-level bootstrap API stable (`createApp`).
5. Keep workspace controller API stable where possible; update internals and UI bindings.

## File-Level Rewrite Targets

1. Replace content and responsibilities in:
- `src/core/render/LiveHybridRenderer.js`
- `src/live/livePreviewController.js`
- `src/core/selection/SelectionPolicy.js`
- `src/core/selection/ActivationController.js`
- `src/core/mapping/SourceMapIndex.js`

2. Add new parser/render/mapping modules for V2 pipeline.
3. Update bootstrap wiring to V2 controllers/extensions.
4. Replace shell/layout/styles in:
- `index.html`
- `src/style.css`
- `src/ui/workspaceView.js`

## Step-by-Step Implementation

### Step 0: Plan file replacement and tracking scaffold

1. Replace current architecture plan markdown with this V2 structure.
2. Add a progress ledger with per-step status and dates.
3. Add acceptance checklist required for cutover.

Exit gate:

1. V2 plan, ledger, and checklist are present in repo.

### Step 1: Parity spec and fixture vault

1. Build fixture set covering headings, nested lists, task lists, blockquotes, fenced code, tables, links, wikilinks, embeds, frontmatter.
2. Add expected live-view behavior notes per fixture.
3. Add visual target snapshots for key fixtures.

Exit gate:

1. Fixture set and expected outcomes exist and are referenced by tests.

### Step 2: Markdown dialect V2

1. Build parser extensions for wikilinks and embeds.
2. Add task/table/frontmatter normalization in model output.
3. Keep callouts/footnotes/math unsupported but harmlessly rendered as plain markdown.
4. Align line-break behavior to Obsidian-like core behavior.

Exit gate:

1. Unit tests pass for tokenization and block typing of all in-scope syntax.

### Step 3: Shared document model V2

1. Introduce `DocModelV2` plus migration adapter from old model.
2. Preserve incremental parse path with bounded reparse windows.
3. Produce stable block IDs across non-structural edits.
4. Add diff metadata for changed blocks and inline fragments.

Exit gate:

1. Incremental edits update only impacted model regions in tests.

### Step 4: Hybrid live renderer V2

1. Render inactive blocks as widget fragments from shared model.
2. Keep active block editable and source-visible.
3. Apply deterministic source-marker visibility by block activity.
4. Emit fragment map entries per rendered segment.

Exit gate:

1. Live mode is no longer source-line-regex styling as primary render path.

### Step 5: Fragment map and interaction resolver

1. Implement map lookup: click rendered fragment -> source range -> cursor target.
2. Implement vertical cursor mapping with fragment-map-first policy.
3. Add guarded fallback heuristics when map coverage is missing.
4. Keep telemetry for map hit/miss/clamp events.

Exit gate:

1. Pointer/cursor e2e tests show deterministic mapping without jump regressions.

### Step 6: Editing semantics parity

1. Define active-block transitions for click, arrow navigation, and Enter.
2. Implement task checkbox interaction mapping back to source updates.
3. Implement link/wikilink click behavior with modifier key handling.
4. Preserve native typing/selection semantics in active source regions.

Exit gate:

1. Behavior matrix passes for source-render transitions and task toggles.

### Step 7: Obsidian-like UI shell rewrite

1. Replace top-bar/pane layout with Obsidian-like sidebar plus note-pane hierarchy.
2. Default to live-preview-centric usage flow.
3. Keep mode controls but position/style in Obsidian-like note toolbar.
4. Preserve file-list/workspace actions while aligning visual interaction patterns.

Exit gate:

1. Visual snapshots for desktop/mobile match parity baseline.

### Step 8: Theming and typography parity

1. Rebuild CSS tokens for Obsidian-like spacing, borders, rhythm, and editor chrome.
2. Ensure dark/light parity with consistent semantic tokens.
3. Remove dead `.cm-rendered-block` styles not backed by runtime output.
4. Add only meaningful subtle motion.

Exit gate:

1. Live and preview typography spacing is visually consistent across fixtures.

### Step 9: Performance and viewport controls

1. Reintroduce viewport windowing for rendered inactive blocks.
2. Add render budgets and graceful degradation for very large notes.
3. Measure build/map/frame telemetry.
4. Define thresholds for 5k/20k/50k-line docs.

Exit gate:

1. Performance tests pass thresholds without disabling parity behavior.

### Step 10: Test expansion and hardening

1. Unit tests for parser/model/map/selection policy.
2. Integration tests for mode switches, file loads, active-block transitions.
3. E2E tests for click mapping, vertical navigation, task toggles, markdown edits.
4. Visual regression tests for core fixtures in live and preview.
5. Keep `npm test` green and include parity suites in CI.

Exit gate:

1. New parity suites pass without flaky behavior across repeated runs.

### Step 11: Big-bang cutover

1. Switch bootstrap/controller wiring to V2-only runtime.
2. Remove obsolete source-first-only runtime code and dead constants.
3. Remove compatibility wrappers not used by V2.
4. Update docs and troubleshooting guides to V2 terminology/events.

Exit gate:

1. No runtime path references old source-first-only renderer.

### Step 12: Final acceptance and sign-off

1. Run full test suite.
2. Run manual parity checklist on fixture vault.
3. Validate light/dark UI parity.
4. Validate persistence/autosave/workspace restore behaviors remain correct.

Exit gate:

1. All acceptance criteria checked and no open P1/P2 regressions.

## Required Tests and Scenarios

1. Markdown render parity:
- Heading marker visibility by active/inactive block.
- Ordered/unordered lists and nested tasks.
- Blockquotes and fenced code with stable cursor behavior.
- Tables in live/preview consistency.
- Inline links, wikilinks, embeds.

2. Interaction parity:
- Clicking rendered text lands in correct source position.
- Arrow up/down across mixed rendered/source blocks.
- Enter/backspace transitions at block boundaries.
- Task checkbox toggle writes correct source.

3. UI parity:
- Sidebar file navigation.
- Note pane density and spacing.
- Toolbar/mode controls in expected locations.

4. Reliability/performance:
- No unexpected selection jumps.
- No gutter collapse or cursor disappearance regressions.
- Render latency within thresholds for large docs.

## Rollout and Logging Requirements

1. Keep live telemetry for parser/model/render/map/selection lifecycles.
2. Add V2 event names and remove deprecated source-first-only terminology.
3. Add summary scripts for map-hit rate, clamps, selection-jump anomalies.
4. Keep launcher log transport compatibility.

## Assumptions and Defaults

1. Big-bang rewrite is operationally acceptable.
2. Callouts, footnotes, and math are explicitly excluded this cycle.
3. Core + UI parity means Obsidian-like daily editing experience, not full app parity.
4. Existing local-first workspace model remains in place.
5. Browser target remains Chromium-first.
