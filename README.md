# Meeting Minutes MVP

A local-first markdown note editor built for the browser.

## MVP features

- Split-pane markdown workflow with live preview.
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

## Browser compatibility

- Best support: Chromium desktop browsers (Chrome, Edge, Brave).
- Requirement: secure context (`https://` or `http://localhost`).
- Safari and Firefox currently have limited support for folder-based read/write workflows.

## Project structure

- `index.html`: shell layout
- `src/main.js`: editor logic, filesystem integration, autosave, IndexedDB restore
- `src/style.css`: UI styling and responsive behavior
