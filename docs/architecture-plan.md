# Obsidian-Style Architecture Plan

## Goal

Move from a source-first approximation to a true Obsidian-like hybrid editor:

1. Markdown source is the only source of truth.
2. Incremental parse/model updates on edit transactions.
3. One shared model for Live and Preview.
4. Active block edits source; inactive blocks render.
5. Deterministic source-to-render mapping index.
6. Deterministic cursor/selection policy.
7. Scroll and line-height invariants.
8. Viewport virtualization and render budgets.
9. End-to-end interaction tests for mapping and navigation.
10. Telemetry tied to parser/model/mapping lifecycle.

## Current Refactor Phases

### Phase 1: Module extraction without behavior change (completed)

- Split `src/main.js` responsibilities into focused modules.
- Keep runtime behavior equivalent.
- Maintain existing tests as baseline safety checks.

Current checkpoint:

- Completed: extracted live diagnostics/pointer/cursor/selection/update controllers into `src/live/*`.
- Completed: centralized live controller wiring in `src/bootstrap/createLiveControllers.js`.
- Completed: extracted editor assembly into `src/bootstrap/createEditor.js`.
- Completed: extracted startup/event-binding flow into `src/bootstrap/startAppLifecycle.js`.
- Completed: extracted live runtime adapter helpers into `src/bootstrap/createLiveRuntimeHelpers.js`.
- Completed: extracted workspace/mode/app action orchestration into `src/bootstrap/createAppControllers.js`.
- Completed: extracted telemetry composition into `src/bootstrap/createTelemetryBootstrap.js`.
- Completed: extracted editor document read/write adapter into `src/bootstrap/createEditorDocumentAdapter.js`.
- Completed: extracted app shell DOM/state setup into `src/bootstrap/createAppShellContext.js`.
- Completed: extracted live-debug bootstrap/logger setup into `src/bootstrap/createLiveDebugBootstrap.js`.
- Completed: extracted live editor extension wiring into `src/bootstrap/createLiveEditorExtensions.js`.
- Completed: extracted live preview + editor extension composition into `src/bootstrap/createExtensions.js`.
- Completed: extracted live controller option composition into `src/bootstrap/createLiveControllerOptions.js`.
- Completed: extracted shared live constants into `src/bootstrap/liveConstants.js`.
- Completed: extracted app composition root into `src/bootstrap/createApp.js`; `src/main.js` is now a thin entrypoint.

### Phase 2: Shared document model and incremental parser

- Introduce an incremental markdown model pipeline.
- Build block graph and inline spans from transaction deltas.
- Replace full-document parse-on-change paths.

### Phase 3: Hybrid live renderer

- Active block remains editable markdown.
- Inactive blocks render via shared model.
- Maintain deterministic source/map index for all rendered fragments.

### Phase 4: Selection and mapping hardening

- Centralize click, cursor, and keyboard activation logic.
- Remove fallback heuristics where possible.
- Enforce block-bound clamping and deterministic remapping.

### Phase 5: Viewport and performance

- Add viewport windowing and render budget control.
- Avoid rendering outside visible + small buffer ranges.

### Phase 6: E2E validation and cleanup

- Add interaction-focused E2E tests.
- Remove legacy code paths after parity.

## Target File/Module Layout

### Bootstrap and app wiring

- `src/main.js`
- `src/bootstrap/createAppShellContext.js`
- `src/bootstrap/createAppControllers.js`
- `src/bootstrap/createLiveControllers.js`
- `src/bootstrap/createLiveRuntimeHelpers.js`
- `src/bootstrap/createLiveDebugBootstrap.js`
- `src/bootstrap/createTelemetryBootstrap.js`
- `src/bootstrap/createEditorDocumentAdapter.js`
- `src/bootstrap/createLiveEditorExtensions.js`
- `src/bootstrap/createLiveControllerOptions.js`
- `src/bootstrap/liveConstants.js`
- `src/bootstrap/createApp.js`
- `src/bootstrap/createEditor.js`
- `src/bootstrap/createExtensions.js`
- `src/bootstrap/startAppLifecycle.js`

### Core document/model/parser

- `src/core/document/DocumentSession.js`
- `src/core/document/TransactionClassifier.js`
- `src/core/model/DocModel.js`
- `src/core/model/BlockNode.js`
- `src/core/model/ModelDiff.js`
- `src/core/parser/IncrementalMarkdownParser.js`
- `src/core/parser/BlockGraphBuilder.js`
- `src/core/parser/InlineSpanBuilder.js`
- `src/core/parser/FenceStateTracker.js`

### Rendering, mapping, selection, viewport

- `src/core/render/MarkdownRenderer.js`
- `src/core/render/LiveHybridRenderer.js`
- `src/core/render/PreviewRenderer.js`
- `src/core/render/RenderedBlockWidget.js`
- `src/core/mapping/SourceMapIndex.js`
- `src/core/mapping/DomSourceMap.js`
- `src/core/mapping/CoordinateMapper.js`
- `src/core/selection/ActivationController.js`
- `src/core/selection/CursorNavigator.js`
- `src/core/selection/SelectionPolicy.js`
- `src/core/layout/LineMetricsStore.js`
- `src/core/layout/ScrollInvariantController.js`
- `src/core/viewport/ViewportWindow.js`
- `src/core/viewport/BlockVirtualizer.js`
- `src/core/viewport/RenderBudget.js`

### Workspace, UI, telemetry

- `src/workspace/WorkspaceStore.js`
- `src/workspace/FileSystemGateway.js`
- `src/workspace/AutosaveController.js`
- `src/ui/ModeController.js`
- `src/ui/FileListController.js`
- `src/ui/StatusController.js`
- `src/ui/ThemeController.js`
- `src/telemetry/LiveTelemetry.js`
- `src/telemetry/TelemetryEvents.js`
- `src/telemetry/DebugPanelController.js`

### Tests

- `tests/unit/parser/IncrementalMarkdownParser.test.js`
- `tests/unit/mapping/SourceMapIndex.test.js`
- `tests/unit/selection/ActivationController.test.js`
- `tests/unit/viewport/BlockVirtualizer.test.js`
- `tests/e2e/live-click-mapping.spec.js`
- `tests/e2e/live-cursor-navigation.spec.js`
