# Meeting Minutes MVP

A local-first markdown note editor built for the browser.

## MVP features

- Single-pane markdown workflow with `Raw`, `Live`, and `Preview` modes.
- CodeMirror editor with markdown list continuation and snippet autocomplete (`/` commands).
- File and folder access through the browser File System Access API.
- Autosave (debounced) plus manual Save button.
- Persisted workspace restore via IndexedDB.
- Sanitized preview rendering to reduce XSS risk from raw HTML in notes.

## Stack

- HTML, CSS, JavaScript
- [Vite](https://vitejs.dev/) for local dev/build
- [CodeMirror 6](https://codemirror.net/)
- [markdown-it](https://github.com/markdown-it/markdown-it)
- [DOMPurify](https://github.com/cure53/DOMPurify)

## Launch (double-click)

1. In Finder, double-click:

`/Users/danhomisak/Code/Meeting_Minutes/Launch Meeting Minutes.command`

2. The launcher will:
- install dependencies if needed
- start the Vite app
- open your browser automatically
- shut down the server automatically after the browser/tab is closed
- stay running when you refresh the page (refresh sends a new heartbeat)

## Run manually (Terminal)

1. Install dependencies:

```bash
npm install
```

2. Start with auto-open and auto-shutdown:

```bash
npm run launch
```

3. Click **Open Folder** and choose a local folder containing markdown files.

## Testing and live debug

- Run regression tests:

```bash
npm test
```

- Continuous test loop while iterating:

```bash
npm run test:watch
```

- Live debug is auto-enabled to `TRACE` in local dev (`npm run dev`) unless you already set a level.

- Use the in-app **Live Debug** panel (under the status bar) to:
- change level (`OFF/ERROR/WARN/INFO/TRACE`)
- clear timeline entries
- copy JSON logs for bug reports

- To persist logs to disk for after-the-fact debugging, run with launcher:

```bash
npm run launch
```

- Terminal-only launcher (no browser auto-open):

```bash
LAUNCHER_NO_OPEN=1 npm run launch
```

- Launcher sessions write JSONL logs to `logs/live-debug-*.jsonl` and print the exact file path at startup.

- Quick report for latest session:

```bash
npm run logs:latest -- --last 120
```

- Enable live-view debug logs with URL query:

`http://localhost:5173/?debugLive=trace`

- Or toggle from devtools:

```js
window.__meetingMinutesLiveDebug.setLevel('trace');
window.__meetingMinutesLiveDebug.entries();
```

- Full troubleshooting workflow:

`docs/live-view-troubleshooting.md`

- Repro fixture for cursor mapping:

`Markdown_Test_Files/live_view_cursor_fixture.md`

## Browser compatibility

- Best support: Chromium desktop browsers (Chrome, Edge, Brave).
- Requirement: secure context (`https://` or `http://localhost`).
- Safari and Firefox currently have limited support for folder-based read/write workflows.

## Project structure

- `index.html`: shell layout
- `src/main.js`: thin app entrypoint (CSS import + `createApp` call)
- `src/bootstrap/createApp.js`: top-level app composition root and bootstrap wiring
- `src/bootstrap/createLiveControllers.js`: composition root for live interaction/diagnostic controllers
- `src/bootstrap/createEditor.js`: editor state/view assembly and extension wiring
- `src/bootstrap/startAppLifecycle.js`: startup sequence and UI event binding orchestration
- `src/bootstrap/createLiveRuntimeHelpers.js`: shared live-runtime adapter helpers around bridge/probe/snapshot/controller getters
- `src/bootstrap/createAppControllers.js`: workspace+mode controller composition and app action delegates
- `src/bootstrap/createTelemetryBootstrap.js`: launcher bridge + snapshot + debug panel telemetry wiring
- `src/bootstrap/createEditorDocumentAdapter.js`: editor text read/write adapter with programmatic-selection diagnostics
- `src/bootstrap/createAppShellContext.js`: app shell DOM bindings and initial app state construction
- `src/bootstrap/createLiveDebugBootstrap.js`: live-debug logger initialization, persisted level handling, and startup metadata logs
- `src/bootstrap/createLiveEditorExtensions.js`: live pointer/key/focus/blur editor extensions and atomic range wiring
- `src/bootstrap/createExtensions.js`: live preview + editor extension composition (state field, pointer handlers, atomic ranges)
- `src/bootstrap/createLiveControllerOptions.js`: helper/runtime option composition for live controller factory wiring
- `src/bootstrap/liveConstants.js`: shared live-mode timing/threshold constants and keylog key sets
- `src/livePreviewCore.js`: testable live-preview block/cursor utilities
- `src/liveDebugLogger.js`: structured live-view logger with persistent levels
- `src/liveArchitecture.js`: live-mode architecture flag parsing/resolution
- `src/live/logString.js`: shared log-safe string normalization helper
- `src/live/livePreviewController.js`: live-preview state field and decoration orchestration
- `src/live/livePreviewBridge.js`: live-preview controller/view adapter for refresh/state/block access
- `src/live/editorUpdateController.js`: editor update-listener doc/selection handling and autosave flow
- `src/live/pointerActivationController.js`: compatibility export for core pointer activation controller
- `src/live/cursorNavigationController.js`: compatibility export for core vertical cursor navigation controller
- `src/core/selection/ActivationController.js`: live pointer activation context resolution and block selection
- `src/core/selection/CursorNavigator.js`: live vertical cursor navigation and assoc-correction policy
- `src/core/selection/SelectionPolicy.js`: shared source-map lookup/clamping policy for activation and cursor movement
- `src/core/viewport/ViewportWindow.js`: visible-range and buffered viewport source-window resolution
- `src/core/viewport/BlockVirtualizer.js`: viewport-aware block filtering with active-block safety inclusion
- `src/core/viewport/RenderBudget.js`: render-budget capping for viewport block workloads
- `src/live/liveDiagnosticsController.js`: runtime/editor input diagnostics hooks and instrumentation
- `src/live/liveDiagnosticsLogHelpers.js`: shared DOM/selection log serialization helpers for diagnostics
- `src/live/liveLineMappingHelpers.js`: shared numeric clamp and source line/bounds diagnostics readers
- `src/live/pointerInputHelpers.js`: pointer target normalization, coordinate extraction, and block-distance helpers
- `src/live/liveSnapshotController.js`: input signal tracking and editor snapshot telemetry payloads
- `src/live/selectionDiagnosticsController.js`: selection-change/jump diagnostics and transaction summary logging
- `src/live/cursorVisibilityController.js`: cursor visibility probing, recovery, and gutter/cursor anomaly signals
- `src/live/liveViewportProbe.js`: cursor/gutter viewport geometry readers for live diagnostics
- `src/live/pointerProbeGeometry.js`: rendered pointer probe geometry and coordinate sampling helpers
- `src/live/pointerMappingProbe.js`: rendered/fallback pointer-to-source mapping probe builders
- `src/live/pointerSourceMapping.js`: source-range extraction and DOM/coord-to-position mapping helpers
- `src/editor/slashCommands.js`: slash command catalog + completion provider
- `src/render/markdownRenderer.js`: markdown-to-HTML render + sanitized preview output
- `src/ui/modeController.js`: raw/live/preview mode transitions and UI state
- `src/ui/themeController.js`: theme state and browser preference syncing
- `src/ui/workspaceView.js`: status/action/file-list UI rendering helpers
- `src/workspace/fileSystem.js`: markdown file discovery + permission helpers
- `src/workspace/workspaceController.js`: workspace save/open/load/restore workflows
- `src/workspace/workspaceDb.js`: IndexedDB workspace persistence
- `src/telemetry/launcherBridge.js`: launcher heartbeat and live-debug upload transport
- `src/telemetry/liveDebugPanelController.js`: live-debug panel UI mounting, rendering, and control handlers
- `src/style.css`: UI styling and responsive behavior
- `tests/*.test.js`: node-based regression suite
- `docs/architecture-plan.md`: phased Obsidian-style architecture roadmap
