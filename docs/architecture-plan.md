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

### Phase 2: Shared document model and incremental parser (completed)

- Introduce an incremental markdown model pipeline.
- Build block graph and inline spans from transaction deltas.
- Replace full-document parse-on-change paths.

Current checkpoint:

- Completed: added shared core model/document/parser modules under `src/core/*` (`DocumentSession`, `TransactionClassifier`, `DocModel`, `ModelDiff`, `BlockNode`, `IncrementalMarkdownParser`, `BlockGraphBuilder`, `InlineSpanBuilder`).
- Completed: live preview block collection now uses `DocumentSession` incremental transaction updates with full-parse fallback.
- Completed: preview rendering path accepts shared model input and reuses block-fragment HTML cache in preview mode.
- Completed: mode switch and workspace file-open preview renders now pass shared model context when synchronized with editor text.
- Completed: added regression coverage for document session, transaction classification, incremental parser behavior, and model-backed preview rendering.
- Completed: added integration coverage that `docChanged` live preview updates are applied through `DocumentSession` without invoking fallback markdown parser calls in steady-state flow.

### Phase 3: Hybrid live renderer (completed)

- Active block remains editable markdown.
- Inactive blocks render via shared model.
- Maintain deterministic source/map index for all rendered fragments.

Current checkpoint:

- Completed: live preview state now builds a deterministic source-map index (`src/core/mapping/SourceMapIndex.js`) from block + rendered-fragment ranges.
- Completed: source-map index is stored alongside live preview decorations and exposed via bridge/runtime helper delegates for downstream selection/mapping hardening.
- Completed: extracted hybrid-decoration assembly into `src/core/render/LiveHybridRenderer.js`; `src/live/livePreviewController.js` now delegates phase-3 rendering to shared core modules.
- Completed: extracted preview/model rendering to `src/core/render/PreviewRenderer.js` and markdown render composition to `src/core/render/MarkdownRenderer.js`.
- Completed: extracted source-first line/token classification into `src/core/render/LiveSourceRenderer.js`.
- Completed: extracted live block fragment/fence helpers into `src/core/render/LiveBlockHelpers.js`.
- Completed: extracted block typing/indexing/fence visibility logic into `src/core/render/LiveBlockIndex.js`.
- Completed: extracted markdown token source-range mapping utilities into `src/core/mapping/SourceRangeMapper.js`.
- Completed: extracted top-level markdown block range collection into `src/core/parser/BlockRangeCollector.js`.
- Completed: runtime consumers now import hybrid renderer helpers directly from `src/core/*` modules (for example `createApp` and `livePreviewController`).

### Phase 4: Selection and mapping hardening (completed)

- Centralize click, cursor, and keyboard activation logic.
- Remove fallback heuristics where possible.
- Enforce block-bound clamping and deterministic remapping.

Current checkpoint:

- Completed: rendered pointer activation now consults `SourceMapIndex` block/fragment entries before coordinate-heuristic fallback.
- Completed: rendered click resolution can clamp to deterministic source fragment bounds (`source-map-fragment` origin) when token/source-range attributes are unavailable.
- Completed: vertical cursor navigation now reads `SourceMapIndex` and applies bounded target clamping when arrow movement resolves outside deterministic block boundaries.
- Completed: centralized vertical cursor move target/boundary/source-map clamp policy in `src/core/selection/SelectionPolicy.js` (`resolveVerticalCursorMoveContext`) and reduced branching in `CursorNavigator`.
- Completed: extracted rendered-activation heuristics and block/selection clamp helpers into `src/core/selection/LiveActivationHelpers.js`.
- Completed: extracted live pointer and vertical cursor controllers into `src/core/selection/ActivationController.js` and `src/core/selection/CursorNavigator.js`.
- Completed: centralized source-map selection lookup/clamping policy in `src/core/selection/SelectionPolicy.js` and wired both core controllers to consume it.
- Completed: centralized rendered source-position precedence (`source-range` -> `source-map-fragment` -> sticky/fallback DOM anchors) in `src/core/selection/SelectionPolicy.js` and reduced policy branching inside `ActivationController`.
- Completed: centralized rendered boundary/fenced rebound and preferred-selection policy in `src/core/selection/SelectionPolicy.js` (`resolveRenderedBoundaryPolicy`, `resolveRenderedSelectionPreference`) and removed duplicate decision branches from `ActivationController`.
- Completed: centralized rendered activation context orchestration in `src/core/selection/SelectionPolicy.js` (`resolveRenderedActivationContext`) and reduced `ActivationController` to rendered-target gating + event emission orchestration.
- Completed: centralized rendered pointer activation pipeline in `src/core/selection/SelectionPolicy.js` (`resolveRenderedPointerActivation`) to compose rendered-target gating, source-map index/context inputs, and merged rendered activation log batches before controller dispatch.
- Completed: centralized rendered-activation diagnostic payload serialization in `src/core/selection/SelectionPolicy.js` (`buildRenderedActivationLogPayloads`) and reduced repeated trace/warn payload assembly in `ActivationController`.
- Completed: centralized mapped-position diagnostic payload serialization in `src/core/selection/SelectionPolicy.js` (`buildMappedPositionLogPayloads`) and reduced repeated `block.position.mapped*` payload assembly in `ActivationController`.
- Completed: centralized source-first native pointer diagnostic payload serialization in `src/core/selection/SelectionPolicy.js` (`buildSourceFirstPointerLogPayloads`) and reduced repeated `pointer.map.native`/`pointer.map.clamped` payload assembly in `ActivationController`.
- Completed: centralized source-first mapped-position clamp/block lookup decision logic in `src/core/selection/SelectionPolicy.js` (`resolveSourceFirstPointerMapping`) and reduced pointer-mode branching inside `ActivationController`.
- Completed: centralized source-first pointer trace/warn emission policy in `src/core/selection/SelectionPolicy.js` (`buildSourceFirstPointerLogEvents`) and reduced source-first log branching in `ActivationController`.
- Completed: centralized pointer input signal recording + `input.pointer` trace event batch creation in `src/core/selection/SelectionPolicy.js` (`resolvePointerInputSignalEvents`) while preserving reusable payload/event builders.
- Completed: centralized pointer activation intent orchestration in `src/core/selection/SelectionPolicy.js` (`resolvePointerActivationIntent`) to compose live input signal logging, preflight gating, and source-first activation/log policy before controller dispatch.
- Completed: centralized vertical cursor trace/warn payload/event serialization and assoc-correction policy in `src/core/selection/SelectionPolicy.js` (`buildVerticalCursorMoveLogPayloads`, `buildVerticalCursorMoveLogEvents`, `resolveVerticalCursorAssocCorrection`) and reduced cursor log/correction branching in `CursorNavigator`.
- Completed: centralized pointer activation preflight gating (live-mode, missing-target miss, non-rendered pass-through, rendered-target detection) in `src/core/selection/SelectionPolicy.js` (`resolvePointerActivationPreflight`) and reduced early-branch handling in `ActivationController`.
- Completed: centralized rendered activation target/source-attribute gating in `src/core/selection/SelectionPolicy.js` (`resolveRenderedActivationTarget`) and moved invalid `data-source-from` skip logging onto the shared event pipeline.
- Completed: centralized source-first pointer activation flow in `src/core/selection/SelectionPolicy.js` (`resolveSourceFirstPointerActivation`) to compose mapping context, block-line diagnostics, and source-first log emission from one policy helper.
- Completed: centralized live-debug event routing for pointer log batches in `src/core/selection/SelectionPolicy.js` (`emitLiveDebugEvents`) and removed duplicate trace/warn/error routing loops from `ActivationController`.
- Completed: centralized rendered pointer activation request/failed event batches in `src/core/selection/SelectionPolicy.js` (`buildPointerActivationEvents`) and moved `block.activate.request`/`block.activate.failed` emission onto the shared event pipeline.
- Completed: centralized pointer activation request/prevent-default/execute outcome policy in `src/core/selection/SelectionPolicy.js` (`resolvePointerActivationDispatch`) and reduced activation success/failure branching in `ActivationController`.
- Completed: centralized pointer activation miss/pass-through/request/failed payload serialization in `src/core/selection/SelectionPolicy.js` (`buildPointerActivationLogPayloads`) and reduced repeated `block.activate.*` payload assembly in `ActivationController`.
- Completed: centralized activation dispatch success/failure payload serialization in `src/core/selection/SelectionPolicy.js` (`buildBlockActivationDispatchLogPayloads`) and reduced repeated `block.activate.dispatch-failed`/`block.activated` payload assembly in `ActivationController`.
- Completed: centralized block activation selection and dispatch execution policy in `src/core/selection/SelectionPolicy.js` (`resolveBlockActivationSelectionContext`, `resolveBlockActivationDispatch`) and reduced dispatch-side selection/log branching in `ActivationController.activateLiveBlock`.
- Completed: added controller regression coverage that rendered pointer activation emits both `block.activate.dispatch-failed` and `block.activate.failed` when block dispatch throws, preserving failure telemetry parity through shared policy helpers.
- Completed: centralized rendered activation trace/warn event-batch policy in `src/core/selection/SelectionPolicy.js` (`buildRenderedActivationLogEvents`) and removed repeated rendered log branching from `ActivationController`.
- Completed: centralized mapped-position trace/warn event-batch policy in `src/core/selection/SelectionPolicy.js` (`buildMappedPositionLogEvents`) and removed repeated `block.position.mapped*` log-branching from `ActivationController`.
- Completed: centralized mapped-position remap computation/decision policy in `src/core/selection/SelectionPolicy.js` (`resolveMappedSelectionRemap`) and reduced coordinate-remap branching inside `ActivationController`.
- Completed: centralized mapped-position remap preflight/schedule and mapped-update composition in `src/core/selection/SelectionPolicy.js` (`resolveMappedSelectionRemapPreflight`, `resolveMappedSelectionUpdate`) and reduced remap skip/mapped branching in `ActivationController`.
- Completed: centralized mapped-position skipped trace event policy in `src/core/selection/SelectionPolicy.js` (`buildMappedPositionSkippedLogEvents`) and removed direct `block.position.mapped.skipped` emission from `ActivationController`.
- Completed: centralized activation dispatch success/failure event-batch policy in `src/core/selection/SelectionPolicy.js` (`buildBlockActivationDispatchEvents`) and moved `block.activate.dispatch-failed`/`block.activated` emission onto the shared event pipeline.
- Completed: `resolveLiveActivationContext` now treats non-rendered/invalid target logging as a preflight concern and no longer emits direct pass-through-native logs for non-rendered branches.

### Phase 5: Viewport and performance (completed)

- Add viewport windowing and render budget control.
- Avoid rendering outside visible + small buffer ranges.

Current checkpoint:

- Completed (historical): added viewport range/window resolution, block virtualization, and render budget policy modules under `src/core/viewport/*`.
- Completed (historical): `src/core/render/LiveHybridRenderer.js` virtualized rendered blocks to viewport + active-line safety ranges and applied render budgets before widget decoration assembly.
- Completed (historical): live editor updates emitted `viewport-changed` refresh reasons so live preview rebuilds could consume viewport/visible range data.
- Completed (historical): added regression coverage for viewport windowing, block virtualization, render budget policy, and hybrid renderer viewport/budget telemetry.
- Note: this viewport/budget path was removed in Phase 6 when runtime shifted to source-first-only decoration flow.

### Phase 6: E2E validation and cleanup

- Add interaction-focused E2E tests.
- Remove legacy code paths after parity.

Current checkpoint:

- Completed: added interaction-flow E2E coverage for pointer click mapping in `tests/e2e/live-click-mapping.test.js` (source-first native mapping pass-through through editor pointer handlers).
- Completed: added interaction-flow E2E coverage for root keydown vertical navigation in `tests/e2e/live-cursor-navigation.test.js` (diagnostics interception + source-map clamp behavior).
- Completed: shifted controller regression imports to core selection modules (`tests/pointerActivationController.test.js`, `tests/cursorNavigationController.test.js`) to reduce compatibility-wrapper dependency in the test surface.
- Completed: removed compatibility wrapper modules (`src/livePreviewCore.js`, `src/liveSourceRenderer.js`, `src/render/markdownRenderer.js`, `src/live/pointerActivationController.js`, `src/live/cursorNavigationController.js`) after moving all internal imports/tests to core modules.
- Completed: removed runtime live-architecture override path (`liveSourceFirst` query/storage resolution) by hard-wiring app bootstrap to source-first mode and deleting `src/liveArchitecture.js`.
- Completed: removed rendered-block pointer activation dispatch from runtime flow by simplifying `ActivationController` and source-first pointer preflight/intent policy in `SelectionPolicy`.
- Completed: removed dead rendered-pointer config plumbing from bootstrap (`liveConstants`, `createApp`, `createLiveControllerOptions`, `createLiveControllers`) after runtime pointer flow became source-first-only.
- Completed: removed unreachable rendered-activation helper exports and logic from `src/core/selection/SelectionPolicy.js`, keeping only runtime-used vertical-cursor and source-first pointer policy APIs.
- Completed: removed dead rendered-pointer probe/source-mapping runtime helpers and modules (`pointerProbeGeometry`, `pointerMappingProbe`, `pointerSourceMapping`) from bootstrap wiring, and dropped their direct unit suites after source-first pointer mapping was inlined in `createLiveRuntimeHelpers`.
- Completed: removed remaining source-first feature-flag plumbing from app/bootstrap/UI/debug composition (`createApp`, `createExtensions`, `createAppControllers`, `createModeController`, `createLiveDebugBootstrap`, `createLivePreviewController`) now that runtime is source-first-only.
- Completed: simplified `src/core/render/LiveHybridRenderer.js` to source-first-only decoration building, and removed dead live-renderer tuning constants (`LIVE_PREVIEW_FRAGMENT_CACHE_MAX`, `LIVE_PREVIEW_SLOW_BUILD_WARN_MS`, viewport/budget constants) from bootstrap constants/config wiring.
- Completed: removed now-unreferenced viewport/budget policy modules (`src/core/viewport/ViewportWindow.js`, `src/core/viewport/BlockVirtualizer.js`, `src/core/viewport/RenderBudget.js`) and their standalone unit suites after source-first-only live decoration flow no longer consumed them.
- Completed: pruned dead rendered-era helper exports from `src/core/render/LiveBlockHelpers.js` and `src/core/selection/LiveActivationHelpers.js`, keeping only runtime-used source-first APIs and slimming their unit coverage accordingly.
- Completed: removed unused refresh viewport payload + fragment-cache plumbing from `src/live/livePreviewController.js` and aligned `LiveHybridRenderer.buildDecorations` to the minimal source-first runtime signature.
- Completed: removed obsolete `viewport-changed` live-refresh dispatch from `src/live/editorUpdateController.js` now that viewport virtualization is gone and live decorations are no longer viewport-scoped.
- Completed: removed dead live-preview bridge/runtime helper surface (`liveBlockIndexForView` bridge passthrough and `distanceToBlockBounds` pointer helper delegates) that no longer had runtime callers.
- Completed: reduced `src/core/selection/SelectionPolicy.js` export surface to runtime-consumed APIs only, internalizing test-only helpers while preserving behavior coverage through public controller-facing policy functions.
- Completed: simplified `scripts/live-debug-report.mjs` to source-first runtime telemetry, removing stale rendered-era anomaly counters from the default log summary output.
- Completed: updated live-debug verification/reporting to ignore the initial pointer-driven selection jump from document-start baseline (`head=0`) while keeping strict checks for subsequent unexpected jumps.

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
- `src/core/parser/BlockRangeCollector.js`
- `src/core/parser/BlockGraphBuilder.js`
- `src/core/parser/InlineSpanBuilder.js`
- `src/core/parser/FenceStateTracker.js`

### Rendering, mapping, selection, viewport

- `src/core/render/MarkdownRenderer.js`
- `src/core/render/LiveHybridRenderer.js`
- `src/core/render/LiveBlockHelpers.js`
- `src/core/render/LiveBlockIndex.js`
- `src/core/render/LiveSourceRenderer.js`
- `src/core/render/PreviewRenderer.js`
- `src/core/mapping/SourceMapIndex.js`
- `src/core/mapping/SourceRangeMapper.js`
- `src/core/mapping/DomSourceMap.js`
- `src/core/mapping/CoordinateMapper.js`
- `src/core/selection/ActivationController.js`
- `src/core/selection/CursorNavigator.js`
- `src/core/selection/LiveActivationHelpers.js`
- `src/core/selection/SelectionPolicy.js`
- `src/core/layout/LineMetricsStore.js`
- `src/core/layout/ScrollInvariantController.js`

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
- `tests/e2e/live-click-mapping.test.js`
- `tests/e2e/live-cursor-navigation.test.js`
