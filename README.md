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
- `src/main.js`: editor logic, filesystem integration, autosave, IndexedDB restore
- `src/livePreviewCore.js`: testable live-preview block/cursor utilities
- `src/liveDebugLogger.js`: structured live-view logger with persistent levels
- `src/style.css`: UI styling and responsive behavior
- `tests/*.test.js`: node-based regression suite
