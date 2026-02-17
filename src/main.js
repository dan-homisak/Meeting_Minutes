import './style.css';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { indentWithTab } from '@codemirror/commands';
import { autocompletion } from '@codemirror/autocomplete';
import { markdown, insertNewlineContinueMarkup } from '@codemirror/lang-markdown';
import { basicSetup } from 'codemirror';
import MarkdownIt from 'markdown-it';
import DOMPurify from 'dompurify';

const DB_NAME = 'meeting-minutes-mvp';
const DB_VERSION = 1;
const DB_STORE = 'workspace';
const WORKSPACE_KEY = 'active-workspace';
const LAUNCHER_HEARTBEAT_MS = 4000;

const openFolderButton = document.querySelector('#open-folder');
const newNoteButton = document.querySelector('#new-note');
const saveNowButton = document.querySelector('#save-now');
const rawModeButton = document.querySelector('#mode-raw');
const previewModeButton = document.querySelector('#mode-preview');
const statusElement = document.querySelector('#status');
const fileCountElement = document.querySelector('#file-count');
const fileListElement = document.querySelector('#file-list');
const editorElement = document.querySelector('#editor');
const previewElement = document.querySelector('#preview');

const app = {
  folderHandle: null,
  fileHandles: new Map(),
  currentPath: null,
  currentFileHandle: null,
  lastSavedText: '',
  hasUnsavedChanges: false,
  isLoadingFile: false,
  autosaveTimer: null,
  viewMode: 'raw'
};

const launcherToken = new URLSearchParams(window.location.search).get('launcherToken');
let launcherHeartbeatTimer = null;

const markdownEngine = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true
});

const markdownCommands = [
  {
    label: 'h1',
    type: 'keyword',
    detail: 'Heading 1',
    apply: '# '
  },
  {
    label: 'h2',
    type: 'keyword',
    detail: 'Heading 2',
    apply: '## '
  },
  {
    label: 'h3',
    type: 'keyword',
    detail: 'Heading 3',
    apply: '### '
  },
  {
    label: 'bullet',
    type: 'keyword',
    detail: 'Bullet list',
    apply: '- '
  },
  {
    label: 'numbered',
    type: 'keyword',
    detail: 'Numbered list',
    apply: '1. '
  },
  {
    label: 'task',
    type: 'keyword',
    detail: 'Task checkbox',
    apply: '- [ ] '
  },
  {
    label: 'quote',
    type: 'keyword',
    detail: 'Blockquote',
    apply: '> '
  },
  {
    label: 'code',
    type: 'keyword',
    detail: 'Code fence',
    apply: '```\n\n```'
  },
  {
    label: 'link',
    type: 'keyword',
    detail: 'Markdown link',
    apply: '[label](https://example.com)'
  },
  {
    label: 'image',
    type: 'keyword',
    detail: 'Markdown image',
    apply: '![alt text](image-path.png)'
  },
  {
    label: 'table',
    type: 'keyword',
    detail: 'Basic table',
    apply: '| Column | Value |\n| --- | --- |\n| Item | Detail |'
  }
];

function setStatus(message, asError = false) {
  statusElement.textContent = message;
  statusElement.classList.toggle('error', asError);
}

function updateActionButtons() {
  const hasFolder = Boolean(app.folderHandle);
  newNoteButton.disabled = !hasFolder;
  saveNowButton.disabled = !app.currentFileHandle;
}

function isMarkdownFile(name) {
  return /\.(md|markdown|mkd|mdown)$/i.test(name);
}

function joinPath(basePath, segment) {
  return basePath ? `${basePath}/${segment}` : segment;
}

async function walkDirectory(directoryHandle, currentPath = '') {
  const directories = [];
  const markdownFiles = [];

  for await (const [name, handle] of directoryHandle.entries()) {
    if (handle.kind === 'directory') {
      directories.push([name, handle]);
      continue;
    }

    if (handle.kind === 'file' && isMarkdownFile(name)) {
      markdownFiles.push([name, handle]);
    }
  }

  directories.sort(([a], [b]) => a.localeCompare(b));
  markdownFiles.sort(([a], [b]) => a.localeCompare(b));

  const results = new Map();

  for (const [name, handle] of directories) {
    const nested = await walkDirectory(handle, joinPath(currentPath, name));
    for (const [nestedPath, nestedHandle] of nested.entries()) {
      results.set(nestedPath, nestedHandle);
    }
  }

  for (const [name, handle] of markdownFiles) {
    results.set(joinPath(currentPath, name), handle);
  }

  return results;
}

function renderFileList() {
  fileListElement.innerHTML = '';

  const paths = [...app.fileHandles.keys()];
  fileCountElement.textContent = String(paths.length);

  if (paths.length === 0) {
    const empty = document.createElement('li');
    empty.textContent = 'No markdown files yet.';
    empty.className = 'hint';
    fileListElement.append(empty);
    return;
  }

  for (const path of paths) {
    const item = document.createElement('li');
    const button = document.createElement('button');

    button.type = 'button';
    button.className = 'file-button';
    button.textContent = path;
    button.title = path;
    button.classList.toggle('active', path === app.currentPath);
    button.addEventListener('click', () => {
      void openFile(path);
    });

    item.append(button);
    fileListElement.append(item);
  }
}

function renderMarkdownHtml(markdownText) {
  const rendered = markdownEngine.render(markdownText);
  return DOMPurify.sanitize(rendered, {
    USE_PROFILES: { html: true }
  });
}

function renderPreview(markdownText) {
  previewElement.innerHTML = renderMarkdownHtml(markdownText);
}

function setViewMode(nextMode) {
  const mode = nextMode === 'preview' ? 'preview' : 'raw';
  app.viewMode = mode;

  const inRawMode = mode === 'raw';
  editorElement.hidden = !inRawMode;
  previewElement.hidden = inRawMode;

  rawModeButton.classList.toggle('active', inRawMode);
  rawModeButton.setAttribute('aria-pressed', String(inRawMode));

  previewModeButton.classList.toggle('active', !inRawMode);
  previewModeButton.setAttribute('aria-pressed', String(!inRawMode));

  if (inRawMode) {
    editorView.focus();
    return;
  }

  renderPreview(getEditorText());
}

function getEditorText() {
  return editorView.state.doc.toString();
}

function setEditorText(nextText) {
  app.isLoadingFile = true;

  editorView.dispatch({
    changes: {
      from: 0,
      to: editorView.state.doc.length,
      insert: nextText
    },
    selection: { anchor: 0 },
    scrollIntoView: true
  });

  app.isLoadingFile = false;
}

function notifyLauncher(pathname) {
  if (!launcherToken) {
    return;
  }

  const url = `${pathname}?token=${encodeURIComponent(launcherToken)}`;
  void fetch(url, {
    method: 'POST',
    keepalive: true,
    headers: {
      'content-type': 'text/plain'
    },
    body: '1'
  }).catch(() => {
    // Ignore launcher heartbeat failures so normal app usage is unaffected.
  });
}

function startLauncherHeartbeat() {
  if (!launcherToken) {
    return;
  }

  notifyLauncher('/__launcher/heartbeat');

  launcherHeartbeatTimer = window.setInterval(() => {
    notifyLauncher('/__launcher/heartbeat');
  }, LAUNCHER_HEARTBEAT_MS);

  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      notifyLauncher('/__launcher/heartbeat');
    }
  });

  window.addEventListener('beforeunload', () => {
    if (launcherHeartbeatTimer) {
      window.clearInterval(launcherHeartbeatTimer);
      launcherHeartbeatTimer = null;
    }

    if (navigator.sendBeacon) {
      navigator.sendBeacon(
        `/__launcher/disconnect?token=${encodeURIComponent(launcherToken)}`,
        'closing'
      );
      return;
    }

    notifyLauncher('/__launcher/disconnect');
  });
}

function slashCommandCompletion(context) {
  const token = context.matchBefore(/\/[a-z-]*/i);

  if (!token) {
    return null;
  }

  if (!context.explicit && token.from === token.to) {
    return null;
  }

  return {
    from: token.from,
    options: markdownCommands,
    validFor: /\/[a-z-]*/i
  };
}

async function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DB_STORE)) {
        db.createObjectStore(DB_STORE);
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}

async function readWorkspaceFromDb() {
  if (!('indexedDB' in window)) {
    return null;
  }

  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readonly');
    const store = tx.objectStore(DB_STORE);
    const request = store.get(WORKSPACE_KEY);

    request.onsuccess = () => {
      resolve(request.result ?? null);
    };

    request.onerror = () => {
      reject(request.error);
    };

    tx.oncomplete = () => {
      db.close();
    };

    tx.onerror = () => {
      reject(tx.error);
    };
  });
}

async function writeWorkspaceToDb(payload) {
  if (!('indexedDB' in window)) {
    return;
  }

  const db = await openDatabase();

  await new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    const store = tx.objectStore(DB_STORE);
    const request = store.put(payload, WORKSPACE_KEY);

    request.onsuccess = () => {
      resolve();
    };

    request.onerror = () => {
      reject(request.error);
    };

    tx.oncomplete = () => {
      db.close();
    };

    tx.onerror = () => {
      reject(tx.error);
    };
  });
}

async function persistWorkspaceState() {
  if (!app.folderHandle) {
    return;
  }

  try {
    await writeWorkspaceToDb({
      folderHandle: app.folderHandle,
      currentPath: app.currentPath
    });
  } catch (error) {
    console.warn('Unable to persist workspace state:', error);
  }
}

async function ensureReadWritePermission(handle) {
  const options = { mode: 'readwrite' };

  if ((await handle.queryPermission(options)) === 'granted') {
    return true;
  }

  return (await handle.requestPermission(options)) === 'granted';
}

async function saveCurrentFile(force = false) {
  if (!app.currentFileHandle) {
    return;
  }

  if (!force && !app.hasUnsavedChanges) {
    return;
  }

  const permitted = await ensureReadWritePermission(app.currentFileHandle);
  if (!permitted) {
    setStatus('Write permission was denied for this file.', true);
    return;
  }

  const markdownText = getEditorText();
  const writable = await app.currentFileHandle.createWritable();
  await writable.write(markdownText);
  await writable.close();

  app.lastSavedText = markdownText;
  app.hasUnsavedChanges = false;
  updateActionButtons();
  setStatus(`Saved ${app.currentPath}`);
}

function scheduleAutosave() {
  if (app.autosaveTimer) {
    window.clearTimeout(app.autosaveTimer);
  }

  app.autosaveTimer = window.setTimeout(() => {
    void saveCurrentFile().catch((error) => {
      console.error(error);
      setStatus(`Autosave failed: ${error.message}`, true);
    });
  }, 700);
}

async function openFile(path) {
  const handle = app.fileHandles.get(path);
  if (!handle) {
    return;
  }

  const file = await handle.getFile();
  const markdownText = await file.text();

  app.currentPath = path;
  app.currentFileHandle = handle;
  app.lastSavedText = markdownText;
  app.hasUnsavedChanges = false;

  setEditorText(markdownText);
  if (app.viewMode === 'preview') {
    renderPreview(markdownText);
  }
  renderFileList();
  updateActionButtons();

  await persistWorkspaceState();
  setStatus(`Editing ${path}`);
}

async function loadWorkspace(folderHandle, preferredPath = null) {
  app.folderHandle = folderHandle;
  app.fileHandles = await walkDirectory(folderHandle);
  renderFileList();
  updateActionButtons();

  if (app.fileHandles.size === 0) {
    app.currentPath = null;
    app.currentFileHandle = null;
    app.lastSavedText = getEditorText();
    app.hasUnsavedChanges = false;
    updateActionButtons();

    setStatus(
      `Folder "${folderHandle.name}" has no markdown files. Use New Note to create one.`
    );
    await persistWorkspaceState();
    return;
  }

  const firstPath = app.fileHandles.keys().next().value;
  const initialPath = preferredPath && app.fileHandles.has(preferredPath)
    ? preferredPath
    : firstPath;

  await openFile(initialPath);
}

async function restoreWorkspaceState() {
  try {
    const savedState = await readWorkspaceFromDb();

    if (!savedState?.folderHandle) {
      return;
    }

    const permission = await savedState.folderHandle.queryPermission({ mode: 'readwrite' });
    if (permission !== 'granted') {
      setStatus('Re-open your folder to continue editing local markdown files.');
      return;
    }

    await loadWorkspace(savedState.folderHandle, savedState.currentPath ?? null);
    setStatus(`Restored folder "${savedState.folderHandle.name}".`);
  } catch (error) {
    console.warn('Could not restore workspace:', error);
  }
}

async function pickFolder() {
  if (!('showDirectoryPicker' in window)) {
    setStatus('This browser does not support local folder editing. Use Chrome or Edge desktop.', true);
    return;
  }

  try {
    const folderHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
    const permitted = await ensureReadWritePermission(folderHandle);

    if (!permitted) {
      setStatus('Folder permission was not granted.', true);
      return;
    }

    await loadWorkspace(folderHandle);
    await persistWorkspaceState();

    setStatus(`Opened "${folderHandle.name}".`);
  } catch (error) {
    if (error.name === 'AbortError') {
      setStatus('Folder selection cancelled.');
      return;
    }

    setStatus(`Unable to open folder: ${error.message}`, true);
  }
}

async function createNewNote() {
  if (!app.folderHandle) {
    setStatus('Open a folder first.', true);
    return;
  }

  const rawInput = window.prompt('Name the new markdown file (you can include subfolders):', 'notes/new-note.md');
  if (!rawInput) {
    return;
  }

  const trimmed = rawInput.trim().replace(/^\/+/, '').replace(/\/+$/, '');
  if (!trimmed) {
    setStatus('File name cannot be empty.', true);
    return;
  }

  const pathSegments = trimmed.split('/').filter(Boolean);
  if (pathSegments.length === 0) {
    setStatus('File name cannot be empty.', true);
    return;
  }

  let filename = pathSegments.pop();
  if (!isMarkdownFile(filename)) {
    filename = `${filename}.md`;
  }

  try {
    let targetDirectory = app.folderHandle;
    for (const segment of pathSegments) {
      targetDirectory = await targetDirectory.getDirectoryHandle(segment, { create: true });
    }

    const fileHandle = await targetDirectory.getFileHandle(filename, { create: true });
    const fullPath = [...pathSegments, filename].join('/');
    const existingFile = await fileHandle.getFile();

    if (existingFile.size === 0) {
      const starterTitle = filename.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
      const initialText = `# ${starterTitle}\n\n`;
      const writable = await fileHandle.createWritable();
      await writable.write(initialText);
      await writable.close();
    }

    await loadWorkspace(app.folderHandle, fullPath);
    setStatus(`Created ${fullPath}`);
  } catch (error) {
    setStatus(`Could not create note: ${error.message}`, true);
  }
}

const editorView = new EditorView({
  state: EditorState.create({
    doc: '# Welcome\n\nChoose a folder and start editing markdown files.\n\nType `/` for quick markdown snippets.\n',
    selection: { anchor: 0 },
    extensions: [
      basicSetup,
      markdown(),
      EditorView.lineWrapping,
      keymap.of([
        indentWithTab,
        {
          key: 'Enter',
          run: insertNewlineContinueMarkup
        }
      ]),
      autocompletion({
        activateOnTyping: true,
        override: [slashCommandCompletion]
      }),
      EditorView.updateListener.of((update) => {
        if (!update.docChanged) {
          return;
        }

        const markdownText = update.state.doc.toString();
        if (app.viewMode === 'preview') {
          renderPreview(markdownText);
        }

        if (app.isLoadingFile) {
          return;
        }

        app.hasUnsavedChanges = markdownText !== app.lastSavedText;
        updateActionButtons();

        if (!app.hasUnsavedChanges) {
          return;
        }

        setStatus(`Unsaved changes in ${app.currentPath ?? 'scratch buffer'}...`);
        scheduleAutosave();
      })
    ]
  }),
  parent: editorElement
});

renderPreview(editorView.state.doc.toString());
setViewMode(app.viewMode);
updateActionButtons();

openFolderButton.addEventListener('click', () => {
  void pickFolder();
});

newNoteButton.addEventListener('click', () => {
  void createNewNote();
});

saveNowButton.addEventListener('click', () => {
  void saveCurrentFile(true).catch((error) => {
    setStatus(`Save failed: ${error.message}`, true);
  });
});

rawModeButton.addEventListener('click', () => {
  setViewMode('raw');
});

previewModeButton.addEventListener('click', () => {
  setViewMode('preview');
});

window.addEventListener('beforeunload', (event) => {
  if (!app.hasUnsavedChanges) {
    return;
  }

  event.preventDefault();
  event.returnValue = '';
});

void restoreWorkspaceState();
startLauncherHeartbeat();
